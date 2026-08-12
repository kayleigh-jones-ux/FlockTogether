/* One paddock, one Durable Object.
 *
 * Everything about a single game lives here: the phase, the players, the hidden
 * answers, and the sockets of everyone watching. Two things differ from the
 * Node server and both are consequences of the runtime, not choices:
 *
 * 1. TIMERS ARE ALARMS. src/game.js drove every phase change with setTimeout.
 *    A Durable Object can be evicted between requests and a pending setTimeout
 *    dies with it, which on a Node server never happened. Every deadline is
 *    therefore storage.setAlarm(). There is exactly ONE alarm per object, and
 *    the round only ever waits on one thing at a time — the answer gate, the
 *    reveal hold, or the scoreboard hold — so a single alarm fits. The one
 *    place src/game.js ran two timers at once is the answer phase: the hard
 *    gate at endsAt AND the 1.5s grace once everyone has answered. Both close
 *    the answers, so the alarm is simply set to whichever comes first.
 *
 * 2. SOCKETS HIBERNATE. ctx.acceptWebSocket, not server.accept(). A party has
 *    long stretches where twenty phones are connected and silent — everyone is
 *    watching the reveal — and hibernation is what stops that costing anything.
 *    The object can be evicted with its sockets still open and woken by the
 *    next frame, so NOTHING may live only in a class property: on wake, all the
 *    object knows about a socket is the attachment serialised onto it, and all
 *    it knows about the game is the RoomRecord in storage. Every mutation is
 *    persisted before it is broadcast.
 *
 * SAFETY INVARIANT (ported verbatim from src/game.js): while the phase is
 * 'question' or 'grouping', the emitted state carries NO answer text. Answer
 * text lives only in RoomRecord.answers and, after grouping, in the group
 * records; the serializer emits groups only from 'reveal' onward, and a
 * player's `answered` flag is a boolean derived from the answers map, never the
 * text. Leaking is structurally impossible rather than scrubbed after the fact.
 */

import { DurableObject } from 'cloudflare:workers';
import QRCode from 'qrcode';
import { validateLook, lookKey } from '../public/shared/look.js';
import { groupAnswersWithFallback, fuzzyGroup } from './grouping';
import type {
  ClientFrame,
  ErrorCode,
  GroupingSource,
  Look,
  Phase,
  ScoreboardReason,
  ServerFrame,
  SocketMeta,
  StateFrame,
} from './protocol';
import { isClientFrame } from './protocol';

const MAX_NAME_CHARS = 14;
const MAX_ANSWER_CHARS = 80;
const GRACE_MS = 1500;
/* A grouping call can outlive its isolate (a redeploy, a hung API call). This
   watchdog alarm makes the object recover on wake instead of freezing on the
   grouping screen — the one phase whose progress is otherwise not backed by a
   persisted deadline. Comfortably longer than the API timeout + one retry. */
const GROUPING_WATCHDOG_MS = 25000;

interface PlayerRecord {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  look: Look | null;
  locked: boolean;
  /** Set from the reveal onward: which paddock this sheep landed in. */
  groupId: string | null;
  scoredThisRound: boolean;
}

interface GroupRecord {
  id: string;
  label: string;
  scored: boolean;
  answers: Array<{ playerId: string; name: string; text: string }>;
}

interface RoomRecord {
  code: string;
  origin: string;
  phase: Phase;
  roundIndex: number;
  totalRounds: number;
  players: PlayerRecord[];

  /* --- the round engine --------------------------------------------------- */
  /** The exact ordered list this game asks, resolved once at start. */
  questions: Array<{ text: string; seconds: number | null }>;
  /** The current prompt (public — it is the question, not an answer). */
  question: string | null;
  /** playerId -> answer text. The ONLY home of live answer text. Never wired. */
  answers: Record<string, string>;
  groups: GroupRecord[];
  noAnswer: Array<{ playerId: string; name: string }>;
  /** Epoch ms the answer gate shuts (wire value during 'question'). */
  endsAt: number | null;
  /** Epoch ms an early close fires once everyone has answered, else null. */
  graceUntil: number | null;
  /** Epoch ms the reveal/scores hold ends. Internal — never wired. */
  deadline: number | null;
  scoreboardReason: ScoreboardReason | null;
  groupingSource: GroupingSource | null;
  /** The default answer time this game inherits, resolved at start. */
  defaultSeconds: number;
  /** Bumped every round; guards a late async grouping result. */
  roundToken: number;

  /* --- the armed custom set ---------------------------------------------- */
  packCode: string | null;
  packName: string | null;
  packSize: number;
}

const STATE_KEY = 'room';

export class Room extends DurableObject<Env> {
  #room: RoomRecord | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    /* Load once, on the way up. Every later read is from memory; every write
       goes to storage first. blockConcurrencyWhile is correct here and ONLY
       here — holding it per request would serialise the whole party. */
    ctx.blockConcurrencyWhile(async () => {
      const raw = await ctx.storage.get<RoomRecord>(STATE_KEY);
      this.#room = raw ? this.#normalize(raw) : null;
    });
  }

  /** Fill any field a record written by an earlier version is missing, so a
      room mid-lobby across a deploy cannot crash the engine on first read. */
  #normalize(r: Partial<RoomRecord>): RoomRecord {
    return {
      code: r.code ?? '',
      origin: r.origin ?? '',
      phase: r.phase ?? 'lobby',
      roundIndex: r.roundIndex ?? 0,
      totalRounds: r.totalRounds ?? 0,
      players: (r.players ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score ?? 0,
        connected: p.connected ?? false,
        look: p.look ?? null,
        locked: p.locked ?? false,
        groupId: p.groupId ?? null,
        scoredThisRound: p.scoredThisRound ?? false,
      })),
      questions: r.questions ?? [],
      question: r.question ?? null,
      answers: r.answers ?? {},
      groups: r.groups ?? [],
      noAnswer: r.noAnswer ?? [],
      endsAt: r.endsAt ?? null,
      graceUntil: r.graceUntil ?? null,
      deadline: r.deadline ?? null,
      scoreboardReason: r.scoreboardReason ?? null,
      groupingSource: r.groupingSource ?? null,
      defaultSeconds: r.defaultSeconds ?? Number(this.env.ANSWER_SECONDS ?? 45),
      roundToken: r.roundToken ?? 0,
      packCode: r.packCode ?? null,
      packName: r.packName ?? null,
      packSize: r.packSize ?? 0,
    };
  }

  /**
   * Take this code if nobody holds it. Called by the Worker while allocating a
   * fresh room. Atomic by virtue of being a Durable Object method: two displays
   * racing for the same code cannot both win.
   */
  async claim(code: string): Promise<boolean> {
    if (this.#room) return false;
    await this.#persist({
      code,
      origin: '',
      phase: 'lobby',
      roundIndex: 0,
      totalRounds: 0,
      players: [],
      questions: [],
      question: null,
      answers: {},
      groups: [],
      noAnswer: [],
      endsAt: null,
      graceUntil: null,
      deadline: null,
      scoreboardReason: null,
      groupingSource: null,
      defaultSeconds: Number(this.env.ANSWER_SECONDS ?? 45),
      roundToken: 0,
      packCode: null,
      packName: null,
      packSize: 0,
    });
    return true;
  }

  async #persist(next: RoomRecord): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, next);
    this.#room = next;
  }

  /** Persist the current record in place (it is mutated, then saved). */
  async #save(): Promise<void> {
    if (this.#room) await this.ctx.storage.put(STATE_KEY, this.#room);
  }

  /* ------------------------------------------------------------- sockets */

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = String(url.searchParams.get('room') ?? '');
    const role = url.searchParams.get('role') === 'player' ? 'player' : 'display';
    const origin = String(url.searchParams.get('origin') ?? '');

    /* A player can reach a room code that no display ever opened — a typo, or a
       link from a party that ended. Say so instead of inventing a room. */
    if (!this.#room && role === 'player') {
      return new Response('No such paddock.', { status: 404 });
    }
    if (!this.#room) {
      await this.claim(code);
    }
    if (origin && this.#room && this.#room.origin !== origin) {
      this.#room.origin = origin;
      await this.#save();
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const meta: SocketMeta = { role, playerId: null };
    /* Tags make it possible to find a socket again after hibernation without
       walking every connection. */
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment(meta);

    /* net.js heartbeats every 25s. Answered by the runtime itself, so twenty
       idle phones cannot wake this object 48 times a minute between rounds —
       which would make hibernation worth precisely nothing. The pair must match
       the client's frame byte for byte. */
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ t: 'ping' }),
        JSON.stringify({ t: 'pong' }),
      ),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return this.#send(ws, { t: 'error', code: 'BAD_REQUEST', message: 'That frame was not JSON.' });
    }
    if (!isClientFrame(parsed)) {
      return this.#send(ws, { t: 'error', code: 'BAD_REQUEST', message: 'That frame had no type.' });
    }

    /* Belt and braces behind setWebSocketAutoResponse: a heartbeat that reaches
       here anyway must not be answered with an error, or a healthy idle phone
       collects a rejection every 25 seconds. */
    if ((parsed as { t: string }).t === 'ping') {
      return this.#send(ws, { t: 'pong' } as unknown as ServerFrame);
    }

    try {
      await this.#handle(ws, parsed);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'frame failed', frame: parsed.t, error: String(error) }));
      this.#send(ws, { t: 'error', code: 'BAD_REQUEST', message: 'That did not work. Try again.' });
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const meta = this.#metaOf(ws);
    if (!meta?.playerId || !this.#room) return;
    const player = this.#room.players.find((p) => p.id === meta.playerId);
    if (!player || !player.connected) return;
    /* A phone that opened a second socket is still present — only the LAST one
       leaving counts as a disconnect. Without this, the old hibernated socket
       closing right after a reconnect would clobber connected back to false
       (and, mid-question, arm the early close on a player who is still here). */
    const stillHere = this.ctx
      .getWebSockets()
      .some((s) => s !== ws && this.#metaOf(s)?.playerId === meta.playerId);
    if (stillHere) return;
    player.connected = false;
    /* A disconnect must never stall the all-answered early end: with one fewer
       phone to wait on, the rest may now have all answered. */
    this.#recomputeGrace();
    await this.#save();
    this.#broadcastState();
    await this.#armAlarm();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  #metaOf(ws: WebSocket): SocketMeta | null {
    const raw = ws.deserializeAttachment() as SocketMeta | null;
    return raw ?? null;
  }

  #send(ws: WebSocket, frame: ServerFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      /* A socket that has gone away is not an error worth propagating; the
         close handler will reconcile the roster. */
    }
  }

  #fail(ws: WebSocket, code: ErrorCode, message: string): void {
    this.#send(ws, { t: 'error', code, message });
  }

  /* ------------------------------------------------------------- frames */

  async #handle(ws: WebSocket, frame: ClientFrame): Promise<void> {
    switch (frame.t) {
      case 'host.create':
      case 'host.resume': {
        const room = this.#room;
        if (!room) return this.#fail(ws, 'ROOM_NOT_FOUND', 'That paddock is gone.');
        const joinUrl = this.#joinUrl();
        this.#send(ws, {
          t: 'room.created',
          room: room.code,
          joinUrl,
          qr: await this.#qr(joinUrl),
        });
        this.#send(ws, this.#stateFor(null));
        return;
      }

      case 'host.pack':
        return this.#setPack(ws, frame.code);

      case 'host.start':
        return this.#start(ws);

      case 'player.join':
        return this.#join(ws, frame.name);

      case 'player.rejoin':
        return this.#rejoin(ws, frame.playerId);

      case 'player.look':
        return this.#setLook(ws, { colorId: frame.colorId, hatId: frame.hatId });

      case 'player.answer':
        return this.#submitAnswer(ws, frame.text);

      default:
        return this.#fail(ws, 'BAD_REQUEST', 'Unknown frame.');
    }
  }

  /* The join code as a square, drawn in hedgerow ink on nothing so the display
     can sit it on its own paper. Percent-encoded rather than base64: the SVG is
     ASCII and btoa would only add a step that can mangle it. Never fatal — a
     room whose QR fails to draw still shows a four-character code that works. */
  async #qr(joinUrl: string): Promise<string> {
    if (!joinUrl) return '';
    try {
      const svg = await QRCode.toString(joinUrl, {
        type: 'svg',
        margin: 0,
        errorCorrectionLevel: 'M',
        color: { dark: '#12180f', light: '#00000000' },
      });
      return 'data:image/svg+xml,' + encodeURIComponent(svg);
    } catch (error) {
      console.error(JSON.stringify({ level: 'warn', message: 'qr failed', error: String(error) }));
      return '';
    }
  }

  #joinUrl(): string {
    const room = this.#room;
    if (!room) return '';
    const base = room.origin || '';
    return `${base}/play?room=${room.code}`;
  }

  /* --------------------------------------------------------------- lobby */

  async #join(ws: WebSocket, rawName: string): Promise<void> {
    const room = this.#room;
    if (!room) return this.#fail(ws, 'ROOM_NOT_FOUND', 'That paddock is gone.');
    if (room.phase !== 'lobby') {
      return this.#fail(ws, 'GAME_STARTED', 'That game has already started.');
    }

    const name = String(rawName ?? '').trim().slice(0, MAX_NAME_CHARS);
    if (!name) return this.#fail(ws, 'BAD_REQUEST', 'Pick a name first.');

    const maxPlayers = Number(this.env.MAX_PLAYERS ?? 20);
    if (room.players.length >= maxPlayers) {
      return this.#fail(ws, 'ROOM_FULL', 'That room is full.');
    }
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return this.#fail(ws, 'NAME_TAKEN', 'Someone already took that name.');
    }

    const player: PlayerRecord = {
      id: crypto.randomUUID(),
      name,
      score: 0,
      connected: true,
      look: null,
      locked: false,
      groupId: null,
      scoredThisRound: false,
    };
    room.players.push(player);
    await this.#save();

    const meta: SocketMeta = { role: 'player', playerId: player.id };
    ws.serializeAttachment(meta);

    this.#send(ws, { t: 'joined', playerId: player.id, room: room.code, name: player.name });
    /* They land on the picker, so they need the taken set immediately. */
    this.#send(ws, { t: 'look.taken', taken: this.#takenLooks() });
    this.#broadcastState();
  }

  async #rejoin(ws: WebSocket, playerId: string): Promise<void> {
    const room = this.#room;
    if (!room) return this.#fail(ws, 'ROOM_NOT_FOUND', 'That paddock is gone.');

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return this.#fail(ws, 'ROOM_NOT_FOUND', 'We lost your place in that paddock.');

    player.connected = true;
    /* A returning player who has not answered must un-arm any pending early end. */
    this.#recomputeGrace();
    await this.#save();

    const meta: SocketMeta = { role: 'player', playerId };
    ws.serializeAttachment(meta);

    this.#send(ws, { t: 'joined', playerId, room: room.code, name: player.name });
    this.#send(ws, { t: 'look.taken', taken: this.#takenLooks() });
    this.#send(ws, this.#stateFor(playerId));
    this.#broadcastState();
    await this.#armAlarm();
  }

  /** Every pair currently held, as lookKey() strings. */
  #takenLooks(): string[] {
    const room = this.#room;
    if (!room) return [];
    return room.players.filter((p) => p.look).map((p) => lookKey(p.look));
  }

  async #setLook(ws: WebSocket, raw: Look): Promise<void> {
    const room = this.#room;
    if (!room) return this.#fail(ws, 'ROOM_NOT_FOUND', 'That paddock is gone.');
    if (room.phase !== 'lobby') {
      return this.#fail(ws, 'GAME_STARTED', 'The game has started — your look is set.');
    }

    const meta = this.#metaOf(ws);
    if (!meta?.playerId) return this.#fail(ws, 'BAD_REQUEST', 'Join the paddock first.');
    const me = room.players.find((p) => p.id === meta.playerId);
    if (!me) return this.#fail(ws, 'ROOM_NOT_FOUND', 'We lost your place in that paddock.');

    const checked = validateLook(raw);
    if ('error' in checked) {
      return this.#fail(ws, 'BAD_LOOK', checked.message);
    }

    /* Uniqueness is on the PAIR, and a player re-confirming their own current
       look must not collide with themselves. */
    const wanted = lookKey(checked.look);
    const clash = room.players.some((p) => p.id !== me.id && p.look && lookKey(p.look) === wanted);
    if (clash) {
      return this.#fail(ws, 'LOOK_TAKEN', 'Someone in the paddock is already that sheep.');
    }

    me.look = checked.look;
    me.locked = true;
    await this.#save();

    this.#send(ws, { t: 'look.ok', look: checked.look });
    this.#broadcastLookTaken();
    this.#broadcastState();
  }

  /* --------------------------------------------------------- custom sets */

  async #setPack(ws: WebSocket, rawCode: string): Promise<void> {
    const room = this.#room;
    if (!room) return this.#fail(ws, 'ROOM_NOT_FOUND', 'That paddock is gone.');
    if (room.phase !== 'lobby') {
      return this.#fail(ws, 'GAME_STARTED', 'That game has already started.');
    }

    const code = String(rawCode ?? '').trim().toUpperCase();
    if (!code) {
      /* Empty code clears the pack — back to the main bank. */
      room.packCode = null;
      room.packName = null;
      room.packSize = 0;
      await this.#save();
      this.#broadcastState();
      return;
    }

    const bank = this.env.QUESTIONS.getByName('bank');
    const pack = await bank.packByCode(code);
    if (!pack) return this.#fail(ws, 'PACK_NOT_FOUND', 'No set with that code.');

    room.packCode = code;
    room.packName = pack.name;
    room.packSize = pack.size;
    await this.#save();
    this.#broadcastState();
  }

  /* --------------------------------------------------------- game start */

  async #start(ws: WebSocket): Promise<void> {
    const room = this.#room;
    if (!room) return this.#fail(ws, 'ROOM_NOT_FOUND', 'That paddock is gone.');
    if (room.phase !== 'lobby') {
      return this.#fail(ws, 'GAME_STARTED', 'That game has already started.');
    }

    /* Only the flock counts towards the minimum: a room of five where three are
       still picking is a room of two. */
    const locked = room.players.filter((p) => p.locked);
    const minPlayers = Number(this.env.LOBBY_MIN_PLAYERS ?? 2);
    if (locked.length < minPlayers) {
      return this.#fail(ws, 'BAD_REQUEST', `Need at least ${minPlayers} players.`);
    }

    const defaultRounds = Number(this.env.DEFAULT_ROUNDS ?? 9);
    const bank = this.env.QUESTIONS.getByName('bank');
    const settings = await bank.getSettings();
    const envSeconds = Number(this.env.ANSWER_SECONDS ?? 45);
    const defaultSeconds = settings.answerSeconds ?? (Number.isFinite(envSeconds) ? envSeconds : 45);

    const resolved = await bank.resolveGame(room.packCode, defaultRounds);
    if (resolved.questions.length === 0) {
      return this.#fail(ws, 'BAD_REQUEST', 'That set has no questions to ask.');
    }

    /* The gate shuts on anyone still choosing. Giving them a default look would
       put a sheep on the TV that its owner never chose, so they are dropped and
       told why. */
    const notLocked = room.players.filter((p) => !p.locked).map((p) => p.id);
    room.players = room.players.filter((p) => p.locked);
    for (const p of room.players) {
      p.score = 0;
      p.groupId = null;
      p.scoredThisRound = false;
    }

    room.questions = resolved.questions;
    room.totalRounds = resolved.questions.length;
    room.defaultSeconds = defaultSeconds;
    if (resolved.pack) {
      room.packCode = resolved.pack.code;
      room.packName = resolved.pack.name;
      room.packSize = resolved.pack.size;
    }
    room.roundIndex = 0;

    await this.#beginQuestion();

    /* start() has already dropped them, so this is the last frame their socket
       gets that makes any sense of it. */
    for (const playerId of notLocked) {
      for (const s of this.ctx.getWebSockets()) {
        const m = this.#metaOf(s);
        if (m?.playerId === playerId) {
          this.#send(s, { t: 'error', code: 'NOT_LOCKED', message: 'The gate shut while you were still choosing.' });
        }
      }
    }
  }

  /* -------------------------------------------------------------- the round */

  async #beginQuestion(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    room.roundToken += 1;
    room.answers = {};
    room.groups = [];
    room.noAnswer = [];
    for (const p of room.players) {
      p.groupId = null;
      p.scoredThisRound = false;
    }
    room.phase = 'question';
    const q = room.questions[room.roundIndex];
    room.question = q ? q.text : null;
    const secs = q && q.seconds != null ? q.seconds : room.defaultSeconds;
    room.endsAt = Date.now() + secs * 1000;
    room.graceUntil = null;
    room.deadline = null;
    room.scoreboardReason = null;
    room.groupingSource = null;
    /* If everyone still connected has somehow already answered, this arms the
       early close; an empty or all-disconnected room simply waits out the hard
       timer armed below. */
    this.#recomputeGrace();
    await this.#save();
    this.#broadcastState();
    await this.#armAlarm();
  }

  async #submitAnswer(ws: WebSocket, rawText: string): Promise<void> {
    const room = this.#room;
    if (!room) return this.#fail(ws, 'ROOM_NOT_FOUND', 'That paddock is gone.');
    const meta = this.#metaOf(ws);
    if (!meta?.playerId) return this.#fail(ws, 'BAD_REQUEST', 'Join the room first.');
    const player = room.players.find((p) => p.id === meta.playerId);
    if (!player) return this.#fail(ws, 'BAD_REQUEST', 'Unknown player.');
    if (room.phase !== 'question') return this.#fail(ws, 'BAD_REQUEST', 'Answers are closed.');
    if (room.endsAt !== null && Date.now() > room.endsAt) {
      return this.#fail(ws, 'BAD_REQUEST', 'Answers are closed.');
    }
    const text = String(rawText ?? '').trim().slice(0, MAX_ANSWER_CHARS);
    if (!text) return this.#fail(ws, 'BAD_REQUEST', 'Type something first.');

    /* Overwriting freely before the gate shuts is allowed. */
    room.answers[player.id] = text;
    this.#recomputeGrace();
    await this.#save();
    this.#broadcastState();
    await this.#armAlarm();
  }

  /** Arm or disarm the 1.5s grace before an early close. Pure mutation. */
  #recomputeGrace(): void {
    const room = this.#room;
    if (!room || room.phase !== 'question') return;
    const connected = room.players.filter((p) => p.connected);
    const everyone = connected.length > 0 && connected.every((p) => room.answers[p.id] !== undefined);
    if (everyone) {
      if (room.graceUntil === null) room.graceUntil = Date.now() + GRACE_MS;
    } else {
      room.graceUntil = null;
    }
  }

  /* -------------------------------------------------------------- alarms */

  /** Set the one alarm to whatever the current phase is waiting on. */
  async #armAlarm(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    let at: number | null = null;
    if (room.phase === 'question') {
      const hard = room.endsAt ?? null;
      at =
        room.graceUntil !== null && hard !== null
          ? Math.min(hard, room.graceUntil)
          : (room.graceUntil ?? hard);
    } else if (room.phase === 'reveal' || room.phase === 'scores' || room.phase === 'grouping') {
      /* 'grouping' rides on a watchdog deadline so it recovers after eviction. */
      at = room.deadline;
    }
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  override async alarm(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    if (room.phase === 'question') return this.#closeAnswers();
    if (room.phase === 'grouping') return this.#recoverGrouping();
    if (room.phase === 'reveal') return this.#afterReveal();
    if (room.phase === 'scores') return this.#nextRound();
    /* 'lobby' and 'final' have no deadline to service. */
  }

  /* The watchdog fired (or a woken object found itself stuck in 'grouping'):
     the in-flight grouping call is gone, so finish the round deterministically
     with the fuzzy grouper rather than leave the room frozen on the dog. */
  async #recoverGrouping(): Promise<void> {
    const room = this.#room;
    if (!room || room.phase !== 'grouping') return;
    const token = room.roundToken;
    const list: Array<{ playerId: string; name: string; text: string }> = [];
    for (const p of room.players) {
      const text = room.answers[p.id];
      if (typeof text === 'string' && text) list.push({ playerId: p.id, name: p.name, text });
    }
    if (list.length === 0) {
      room.groups = [];
      room.groupingSource = null;
    } else {
      const groups = fuzzyGroup(room.question ?? '', list);
      room.groups = groups.map((g) => ({ id: g.id, label: g.label, scored: false, answers: g.answers }));
      room.groupingSource = 'fallback';
    }
    await this.#finishRound(token);
  }

  async #closeAnswers(): Promise<void> {
    const room = this.#room;
    if (!room || room.phase !== 'question') return;
    room.endsAt = null;
    room.graceUntil = null;
    await this.ctx.storage.deleteAlarm();
    await this.#enterGrouping();
  }

  /* ------------------------------------------------------------- grouping */

  async #enterGrouping(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    const token = room.roundToken;
    room.phase = 'grouping';
    room.endsAt = null;
    room.groupingSource = null;
    room.scoreboardReason = null;
    /* Arm a watchdog so a grouping that outlives its isolate still completes:
       on wake, alarm() -> #recoverGrouping finishes the round with the fuzzy
       grouper. The normal path below finishes far sooner and re-arms the alarm
       to the reveal hold, so this deadline is only ever reached on failure. */
    room.deadline = Date.now() + GROUPING_WATCHDOG_MS;
    await this.#save();
    this.#broadcastState(); // display covers the latency from here
    await this.#armAlarm();

    const list: Array<{ playerId: string; name: string; text: string }> = [];
    for (const p of room.players) {
      const text = room.answers[p.id];
      if (typeof text === 'string' && text) list.push({ playerId: p.id, name: p.name, text });
    }

    if (list.length === 0) {
      room.groups = [];
      room.groupingSource = null;
      await this.#finishRound(token);
      return;
    }

    let groups;
    let source: GroupingSource;
    try {
      const res = await groupAnswersWithFallback(room.question ?? '', list, this.env.ANTHROPIC_API_KEY);
      groups = res.groups;
      source = res.source;
    } catch {
      groups = fuzzyGroup(room.question ?? '', list);
      source = 'fallback';
    }

    /* A round that moved on while grouping was in flight drops the stale result. */
    const now = this.#room;
    if (!now || now.roundToken !== token || now.phase !== 'grouping') return;
    now.groups = groups.map((g) => ({ id: g.id, label: g.label, scored: false, answers: g.answers }));
    now.groupingSource = source;
    await this.#finishRound(token);
  }

  /* --------------------------------------------------------------- scoring */

  #scoreRound(): void {
    const room = this.#room;
    if (!room) return;
    const answered = new Set<string>();
    for (const g of room.groups) for (const a of g.answers) answered.add(a.playerId);

    let max = 0;
    for (const g of room.groups) if (g.answers.length > max) max = g.answers.length;

    for (const g of room.groups) {
      /* EVERY group tied at the max size scores. One lone answer is still the
         majority and still scores. Zero answers => no groups => nobody scores. */
      g.scored = max > 0 && g.answers.length === max;
      for (const a of g.answers) {
        const p = room.players.find((x) => x.id === a.playerId);
        if (!p) continue;
        p.groupId = g.id;
        p.scoredThisRound = g.scored;
        if (g.scored) p.score += 1;
      }
    }

    /* Groups sorted largest-first; ties keep grouper order. */
    room.groups.sort((a, b) => b.answers.length - a.answers.length);

    room.noAnswer = room.players
      .filter((p) => !answered.has(p.id))
      .map((p) => ({ playerId: p.id, name: p.name }));
  }

  /* ------------------------------------------------- reveal / scores / next */

  async #finishRound(token: number): Promise<void> {
    const room = this.#room;
    if (!room || room.roundToken !== token) return;
    this.#scoreRound();
    room.phase = 'reveal';
    room.endsAt = null;
    room.scoreboardReason = null;
    room.deadline = Date.now() + Number(this.env.REVEAL_MS ?? 9000);
    await this.#save();
    this.#broadcastState();
    await this.#armAlarm();
  }

  async #afterReveal(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    const isLast = room.roundIndex >= room.totalRounds - 1;
    if (isLast) return this.#toFinal();

    const reason = this.#scoreboardReasonFor(room.roundIndex);
    if (reason && reason !== 'final') {
      room.phase = 'scores';
      room.scoreboardReason = reason;
      room.deadline = Date.now() + Number(this.env.SCORES_MS ?? 8000);
      await this.#save();
      this.#broadcastState();
      await this.#armAlarm();
      return;
    }
    await this.#nextRound();
  }

  async #nextRound(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    room.roundIndex += 1;
    if (room.roundIndex >= room.totalRounds) {
      room.roundIndex = room.totalRounds - 1;
      return this.#toFinal();
    }
    await this.#beginQuestion();
  }

  async #toFinal(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    room.phase = 'final';
    room.scoreboardReason = 'final';
    room.endsAt = null;
    room.deadline = null;
    await this.ctx.storage.deleteAlarm();
    await this.#save();
    this.#broadcastState();
  }

  /** 0-based round index -> the scoreboard it triggers, or null. */
  #scoreboardReasonFor(index: number): ScoreboardReason | null {
    const total = this.#room?.totalRounds ?? 0;
    /* Highest priority last: final > penultimate > third. Deduped by index, so
       a scoreboard can never appear twice in a row on tiny round counts. */
    const map = new Map<number, ScoreboardReason>();
    const put = (idx: number, reason: ScoreboardReason) => {
      if (Number.isInteger(idx) && idx >= 0 && idx < total) map.set(idx, reason);
    };
    put(Math.ceil(total / 3) - 1, 'third');
    put(total - 2, 'penultimate');
    put(total - 1, 'final');
    return map.get(index) ?? null;
  }

  /* --------------------------------------------------------- broadcasting */

  #stateFor(playerId: string | null): StateFrame {
    const room = this.#room;
    const players = room?.players ?? [];
    const phase: Phase = room?.phase ?? 'lobby';
    /* players[] is LOCKED players only: an unlocked player has no colour, so
       there is literally nothing to draw for them. The display gets a count
       instead so the room knows someone is still deciding. */
    const locked = players.filter((p) => p.look && p.locked);
    const revealed = phase === 'reveal' || phase === 'scores' || phase === 'final';

    const state: StateFrame = {
      t: 'state',
      room: room?.code ?? '',
      phase,
      roundIndex: room?.roundIndex ?? 0,
      totalRounds: room?.totalRounds ?? 0,
      /* The prompt is public — it is the question, not an answer. */
      question: phase === 'lobby' ? null : (room?.question ?? null),
      endsAt: phase === 'question' ? (room?.endsAt ?? null) : null,
      players: locked.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        /* A boolean off the answers map — never the text itself. */
        answered: room ? room.answers[p.id] !== undefined : false,
        connected: p.connected,
        look: p.look as Look,
      })),
      choosing: players.length - locked.length,
      /* Groups (which carry answer text) are emitted only from the reveal on. */
      groups: revealed
        ? (room?.groups ?? []).map((g) => ({
            id: g.id,
            label: g.label,
            scored: g.scored,
            answers: g.answers,
          }))
        : [],
      noAnswer: revealed ? (room?.noAnswer ?? []) : [],
      scoreboardReason: phase === 'scores' || phase === 'final' ? (room?.scoreboardReason ?? null) : null,
      groupingSource: revealed ? (room?.groupingSource ?? null) : null,
      pack: room?.packCode ? { code: room.packCode, name: room.packName ?? '', size: room.packSize } : null,
    };

    if (playerId) {
      const me = players.find((p) => p.id === playerId);
      if (me) {
        state.you = {
          id: me.id,
          name: me.name,
          score: me.score,
          answered: room ? room.answers[me.id] !== undefined : false,
          look: me.look,
          locked: me.locked,
          /* Arrives only from the reveal phase onward, so nothing leaks early. */
          myGroupId: revealed ? me.groupId : null,
          scoredThisRound: revealed ? me.scoredThisRound : false,
        };
      }
    }
    return state;
  }

  #broadcastState(): void {
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.#metaOf(ws);
      this.#send(ws, this.#stateFor(meta?.playerId ?? null));
    }
  }

  #broadcastLookTaken(): void {
    const frame: ServerFrame = { t: 'look.taken', taken: this.#takenLooks() };
    for (const ws of this.ctx.getWebSockets()) this.#send(ws, frame);
  }
}
