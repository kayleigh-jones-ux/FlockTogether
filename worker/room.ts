/* One paddock, one Durable Object.
 *
 * Everything about a single game lives here: the phase, the players, the hidden
 * answers, and the sockets of everyone watching. Two things differ from the
 * Node server and both are consequences of the runtime, not choices:
 *
 * 1. TIMERS ARE ALARMS. src/game.js drove every phase change with setTimeout.
 *    A Durable Object can be evicted between requests and a pending setTimeout
 *    dies with it, which on a Node server never happened. Every deadline is
 *    therefore storage.setAlarm(). There is exactly one alarm per object, and
 *    the game only ever waits on one thing at a time, so this fits precisely.
 *
 * 2. SOCKETS HIBERNATE. ctx.acceptWebSocket, not server.accept(). A party has
 *    long stretches where twenty phones are connected and silent — everyone is
 *    watching the reveal — and hibernation is what stops that costing anything.
 *    The object can be evicted with its sockets still open and woken by the
 *    next frame, so NOTHING may live only in a class property: on wake, all the
 *    object knows about a socket is the attachment serialised onto it.
 */

import { DurableObject } from 'cloudflare:workers';
import { validateLook, lookKey } from '../public/shared/look.js';
import type {
  ClientFrame,
  ErrorCode,
  Look,
  ServerFrame,
  SocketMeta,
  StateFrame,
} from './protocol';
import { isClientFrame } from './protocol';

const MAX_NAME_CHARS = 14;

interface PlayerRecord {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  look: Look | null;
  locked: boolean;
}

interface RoomRecord {
  code: string;
  origin: string;
  phase: StateFrame['phase'];
  roundIndex: number;
  totalRounds: number;
  players: PlayerRecord[];
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
      this.#room = (await ctx.storage.get<RoomRecord>(STATE_KEY)) ?? null;
    });
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
      totalRounds: Number(this.env.DEFAULT_ROUNDS ?? 9),
      players: [],
    });
    return true;
  }

  async #persist(next: RoomRecord): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, next);
    this.#room = next;
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
      await this.#persist({ ...this.#room, origin });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const meta: SocketMeta = { role, playerId: null };
    /* Tags make it possible to find a socket again after hibernation without
       walking every connection. */
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment(meta);

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
    const players = this.#room.players.map((p) =>
      p.id === meta.playerId ? { ...p, connected: false } : p,
    );
    await this.#persist({ ...this.#room, players });
    this.#broadcastState();
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
        this.#send(ws, {
          t: 'room.created',
          room: room.code,
          joinUrl: this.#joinUrl(),
          /* The display renders its own QR when this is empty, so an absent
             encoder degrades to a typed code rather than to nothing. */
          qr: '',
        });
        this.#send(ws, this.#stateFor(null));
        return;
      }

      case 'player.join':
        return this.#join(ws, frame.name);

      case 'player.rejoin':
        return this.#rejoin(ws, frame.playerId);

      case 'player.look':
        return this.#setLook(ws, { colorId: frame.colorId, hatId: frame.hatId });

      case 'host.start':
      case 'player.answer':
        /* ===================== ENGINE SEAM =====================
           Round machinery — questions, the answer gate, grouping, scoring and
           the scoreboard cadence — is the direct port of src/game.js and lands
           in the next commit. Everything above this line is transport and room
           lifecycle, which src/game.js never owned.
           ======================================================= */
        return this.#fail(ws, 'BAD_REQUEST', 'The round engine is not wired up yet.');

      default:
        return this.#fail(ws, 'BAD_REQUEST', 'Unknown frame.');
    }
  }

  #joinUrl(): string {
    const room = this.#room;
    if (!room) return '';
    const base = room.origin || '';
    return `${base}/play?room=${room.code}`;
  }

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
    };
    await this.#persist({ ...room, players: [...room.players, player] });

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

    const players = room.players.map((p) => (p.id === playerId ? { ...p, connected: true } : p));
    await this.#persist({ ...room, players });

    const meta: SocketMeta = { role: 'player', playerId };
    ws.serializeAttachment(meta);

    this.#send(ws, { t: 'joined', playerId, room: room.code, name: player.name });
    this.#send(ws, { t: 'look.taken', taken: this.#takenLooks() });
    this.#send(ws, this.#stateFor(playerId));
    this.#broadcastState();
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

    const players = room.players.map((p) =>
      p.id === me.id ? { ...p, look: checked.look, locked: true } : p,
    );
    await this.#persist({ ...room, players });

    this.#send(ws, { t: 'look.ok', look: checked.look });
    this.#broadcastLookTaken();
    this.#broadcastState();
  }

  /* --------------------------------------------------------- broadcasting */

  #stateFor(playerId: string | null): StateFrame {
    const room = this.#room;
    const players = room?.players ?? [];
    /* players[] is LOCKED players only: an unlocked player has no colour, so
       there is literally nothing to draw for them. The display gets a count
       instead so the room knows someone is still deciding. */
    const locked = players.filter((p) => p.look && p.locked);

    const state: StateFrame = {
      t: 'state',
      room: room?.code ?? '',
      phase: room?.phase ?? 'lobby',
      roundIndex: room?.roundIndex ?? 0,
      totalRounds: room?.totalRounds ?? 0,
      question: null,
      endsAt: null,
      players: locked.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        answered: false,
        connected: p.connected,
        look: p.look as Look,
      })),
      choosing: players.length - locked.length,
      groups: [],
      noAnswer: [],
      scoreboardReason: null,
      groupingSource: null,
    };

    if (playerId) {
      const me = players.find((p) => p.id === playerId);
      if (me) {
        state.you = {
          id: me.id,
          name: me.name,
          score: me.score,
          answered: false,
          look: me.look,
          locked: me.locked,
          myGroupId: null,
          scoredThisRound: false,
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

  /* -------------------------------------------------------------- alarms */

  override async alarm(): Promise<void> {
    /* ===================== ENGINE SEAM =====================
       Every phase deadline arrives here: the answer gate shutting, the reveal
       hold, the scoreboard hold. Dispatch lands with the engine port.
       ======================================================= */
  }
}
