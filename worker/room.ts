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
/* The grouping screen must be SEEN. A grouper that answers in 200ms would blink
   the dog on and straight off again, which reads as a bug rather than as work
   happening, so the room refuses to leave 'grouping' before this much has
   passed. Enforced here and only here: the bar on the surfaces is told the
   instant (groupingProgress.minUntil) rather than the duration, so a phone that
   joins mid-phase lands on a part-filled bar instead of restarting it. */
const GROUPING_MIN_MS = 5000;
/* What grouping is EXPECTED to cost, wired out as groupingProgress.expectedMs
   so the easing constant lives with whoever knows the API budget. This tracks
   CALL_TIMEOUT_MS in grouping.ts — that module does not export it, so if this
   number and that one drift the bar eases at the wrong rate (it still holds at
   ~90% and still snaps at the end; only the pace is wrong). It is a budget, not
   a deadline: overrunning it holds the bar, it does not fail anything. */
const GROUPING_EXPECTED_MS = 10000;
/* The reveal and the scoreboard are host-gated, and the gate is meant to be the
   only way out of them. It is not enough on its own. "The host is here" is
   inferred from a `connected` flag that nothing ever verifies: the heartbeat is
   answered by setWebSocketAutoResponse, which by design never wakes this object,
   so a phone whose tab was backgrounded, frozen by the OS or simply put in a
   pocket looks exactly like a phone whose owner is about to tap Continue. With
   no alarm armed, that phone parks the room forever and every other player is
   answered NOT_HOST — the party is over and nobody can end it.
   So reveal and scores ALWAYS carry a deadline now. Two minutes is chosen to be
   far longer than any real "let them talk about it" pause, so the host gate is
   still what moves the game in every ordinary party, and far shorter than "the
   evening", so a dead host costs one long beat per phase instead of the game. */
const HOST_BACKSTOP_MS = 120000;
/* Succession must not fire on a blip. A phone that loses its socket for three
   seconds — a tunnel, a lift, a wifi handover — reconnects on its own, and
   before this the room had already handed the controls to somebody else by
   then; the host's Continue button vanished mid-party for no reason they could
   see, and #ensureHost deliberately never gives it back. So a departing host is
   given this long to come back before anyone succeeds them. Long enough to
   cover a reconnect (net.js retries well inside it), short enough that a real
   walk-out is handed over within one beat of the room noticing. */
const HOST_BLIP_MS = 6000;

/* How long the host's phone may go without proving it is awake before the lobby
   hands the controls on. It must comfortably exceed the phone's own keepalive
   interval (see LIVENESS_MS in play.js) or a host on a slow connection loses the
   room for missing one beat; three missed beats is the margin here.

   Only the LOBBY uses it, and only because the lobby has no other clock. It is
   deliberately NOT a "the host is taking too long" timer — a host reading the
   room, waiting for a friend to park the car, or arguing about the question set
   keeps the controls indefinitely, because their phone keeps sending while they
   do. What loses the controls is a phone that has stopped running, which is the
   only case anyone needed rescuing from. */
const LOBBY_HOST_IDLE_MS = 45000;
/* Alarms do not fire to the millisecond, and a handler that re-arms an alarm it
   thinks is early would spin. Anything within this of its deadline counts as
   having arrived. */
const ALARM_SLOP_MS = 250;
/* How long a start claim stands before it is treated as abandoned. #start makes
   two RPCs to the question bank and the DO input gate does NOT hold across
   them, so the claim is what stops a second frame starting the same game twice;
   persisting it means an isolate evicted mid-start would otherwise leave a
   lobby that can never be started, hence the expiry. Comfortably longer than
   both RPCs and their retries. */
const START_CLAIM_STALE_MS = 30000;

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
  /** Consecutive rounds ended in a scoring group WITH SOMEBODY ELSE IN IT, the
      round just scored included. Deliberately not the same test as
      scoredThisRound — see the long note in #scoreRound. Maintained there for
      EVERY player — including ones who were in no group at all — and
      deliberately NOT touched by #beginQuestion, because a streak's whole job is
      to survive into the next question. */
  streak: number;
  /** The cumulative tiebreak charge, in ROUNDS — each round contributes a
      fraction of its own answer window, between 0 (instant) and 1 (never
      answered), so after nine rounds this sits somewhere in 0..9.

      NOT milliseconds, and the rename is the fix. Per-question timers are
      editor-settable from 5s to 300s (MIN_SECONDS/MAX_SECONDS in questions.ts),
      so a raw ms sum compares numbers that were never measured on the same
      ruler: sitting out a 5s round costs 5,000 and answering a 300s round in
      twenty seconds costs 20,000, and the player who contributed nothing ends
      up ahead of the player who answered. Normalising per round makes every
      round worth the same one point of tiebreak no matter how long it ran, and
      keeps the ordering inside a round exactly as it was.

      INTERNAL ONLY — never serialized. Shipping it would hand both surfaces the
      ingredients of the comparator and make each re-implement it; the first one
      that sorts score-only disagrees with the server about who is winning, on a
      screen the whole room is staring at. It would also put "Kayleigh averages
      2.1s" on the wire, which is a fact about a person that no screen was ever
      going to show. The server does the sort once and ships `rank`. */
  answerCostTotal: number;
  /** The secret this phone must present to reclaim this seat. Minted on join,
      handed to that one socket in the `joined` frame, and never wired again —
      not in players[], not in `you`, not to the display. See the rejoin token
      notes in protocol.ts for why a playerId cannot do this job: hostId is
      published to every socket in the room, so an id-only rejoin lets anyone in
      the party become the host. Compared on every player.rejoin. */
  token: string;
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

  /* --- who holds the controls --------------------------------------------- */
  /** The player whose phone starts the game and releases every host-gated hold.
      Assigned the first time anyone locks in, so it is ALWAYS a locked player
      and #start's drop of the still-choosing can never orphan it. Reassigned on
      disconnect, never on reconnect: see #ensureHost. */
  hostId: string | null;
  /** Epoch ms the host's last socket went away, or null while they are here.
      The blip grace is measured from it: succession does not happen until
      HOST_BLIP_MS has passed, so a phone that drops for three seconds and
      reconnects keeps the controls. Cleared the moment the host is live again,
      and cleared when the grace is spent whether or not there was anybody to
      hand to — see #ensureHost, where a stale value would keep re-arming the
      handover alarm at a time already past. */
  hostGoneAt: number | null;
  /** Epoch ms the host's phone last PROVED it was awake, or null before it ever
      did. This is not `connected`, and the difference is the whole point.
      `connected` says a socket is open, which a frozen tab, a locked pocket and
      a backgrounded browser all satisfy — the 25s heartbeat is answered by
      setWebSocketAutoResponse and never wakes this object, so it can prove
      nothing. The host's phone therefore sends a real frame on a timer while it
      holds the controls (player.alive), and only that stamps this.

      It exists for the LOBBY, which is the one phase with nothing else ticking
      and no way out except the host's Start. A host whose tab freezes there used
      to park the room for everyone with no recourse. Anywhere else a deadline
      already covers it. */
  hostSeenAt: number | null;

  /* --- the round engine --------------------------------------------------- */
  /** The exact ordered list this game asks, resolved once at start. */
  questions: Array<{ text: string; seconds: number | null }>;
  /** The current prompt (public — it is the question, not an answer). */
  question: string | null;
  /** playerId -> answer text. The ONLY home of live answer text. Never wired. */
  answers: Record<string, string>;
  /** playerId -> epoch ms of that player's LAST submission before the gate shut.
      Parallel to `answers` and cleared with it. Last write wins on purpose:
      editing an answer must not be free, or the fast play is to fire off "a"
      and think afterwards. Internal — never wired, and it carries no answer
      text, so the safety invariant at the top of this file is untouched. */
  answerAt: Record<string, number>;
  groups: GroupRecord[];
  noAnswer: Array<{ playerId: string; name: string }>;
  /** Epoch ms the answer gate shuts (wire value during 'question'). */
  endsAt: number | null;
  /** Epoch ms this question phase opened — the round's t=0. Needed because the
      per-question `seconds` varies, so endsAt alone cannot recover where the
      round started, and every answer is charged as an offset from here rather
      than from a phone's clock (which is not ours to trust). Internal. */
  questionStartedAt: number | null;
  /** Epoch ms an early close fires once everyone has answered, else null. */
  graceUntil: number | null;
  /** Epoch ms the reveal/scores hold ends. Internal — never wired. Since the
      host gates those two phases this is no longer how they normally advance:
      it is the deadlock fallback, armed only when the room has nobody left who
      could tap Continue. See #armAlarm. */
  deadline: number | null;
  /** Epoch ms the reveal/scores BACKSTOP expires — the deadline that is armed
      even while a host is present and apparently connected. Separate from
      `deadline` because the two are different promises with different lengths:
      `deadline` is the short "nobody is here, play the game out" hold, this is
      the long "your host has stopped responding" one, and a single field would
      have each overwrite the other every time somebody's socket flickered.
      Internal, never wired. Set on entry to reveal and to scores. */
  backstopAt: number | null;
  /** Epoch ms #enterGrouping ran — the grouping bar's t=0. Wired out inside
      groupingProgress during 'grouping' only. */
  groupingStartedAt: number | null;
  /** groupingStartedAt + GROUPING_MIN_MS. The room will not leave 'grouping'
      before this instant even if the grouper answered instantly. */
  groupingMinUntil: number | null;
  /** Groups for this round are computed and stored. The single alarm now serves
      two different grouping outcomes and alarm() MUST branch on this flag:
      without it the min-hold alarm is indistinguishable from the watchdog, and
      a perfectly good Claude grouping gets thrown away and replaced with the
      fuzzy one five seconds after it landed. Cleared in #beginQuestion. */
  groupingReady: boolean;
  scoreboardReason: ScoreboardReason | null;
  groupingSource: GroupingSource | null;
  /** The default answer time this game inherits, resolved at start. */
  defaultSeconds: number;
  /** Bumped every round; guards a late async grouping result. */
  roundToken: number;
  /** Epoch ms somebody claimed the start, or null. #start's phase guard is not
      enough on its own: `phase` does not become 'question' until #beginQuestion,
      and two awaits on the question bank sit in between. The DO input gate does
      not hold across an RPC, so both frames of a double-tap (or of a host with
      /play open in two tabs) pass the guard, and the second one re-resolves the
      questions, restarts the clock and wipes the answers of a game already
      running. This is claimed synchronously before the first await, so the
      second frame sees it. Expires after START_CLAIM_STALE_MS so an isolate
      evicted mid-start cannot leave a lobby nobody can ever start. */
  startingAt: number | null;

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
        streak: p.streak ?? 0,
        answerCostTotal: p.answerCostTotal ?? 0,
        /* A record written before tokens existed has none, and no phone in the
           room is holding one either — so there is nothing to migrate and
           nothing to accept. It is given a FRESH token that nobody will ever
           present, which is the deliberate outcome: those seats can no longer
           be rejoined, and their owners have to come back in as new players if
           the game is still in its lobby.
           Minting rather than leaving '' is the important half. An empty stored
           token would invite exactly one line of code — "if there is no stored
           token, let them in" — and that line is the whole vulnerability back
           again, granted to precisely the records an attacker would claim to
           hold. There is no empty-token state anywhere, so that branch cannot
           be written. Nothing is persisted here (#normalize does not save), so
           a legacy record simply gets a different unguessable value on each
           wake; since none of them is ever accepted, that costs nothing. */
        token: p.token ?? this.#mintToken(),
      })),
      /* Without this line a room sitting in its lobby across a deploy comes
         back with no host and no way to get one short of everyone re-picking
         their sheep, because hostId is only ever assigned on a fresh lock-in. */
      hostId: r.hostId ?? null,
      hostGoneAt: r.hostGoneAt ?? null,
      /* A record from before this field cannot be treated as "never seen", or a
         lobby crossing that deploy would hand the controls on the next alarm to
         a host who is sitting there perfectly awake. Dated to now: the host gets
         a full idle window to prove itself, exactly as a fresh one would. */
      hostSeenAt: r.hostSeenAt ?? Date.now(),
      questions: r.questions ?? [],
      question: r.question ?? null,
      answers: r.answers ?? {},
      answerAt: r.answerAt ?? {},
      groups: r.groups ?? [],
      noAnswer: r.noAnswer ?? [],
      endsAt: r.endsAt ?? null,
      questionStartedAt: r.questionStartedAt ?? null,
      graceUntil: r.graceUntil ?? null,
      deadline: r.deadline ?? null,
      /* A room caught mid-reveal by the deploy that introduced the backstop has
         none stored; #armAlarm measures a fresh one from now rather than
         treating "no backstop" as "no alarm", which is the parked room again. */
      backstopAt: r.backstopAt ?? null,
      groupingStartedAt: r.groupingStartedAt ?? null,
      groupingMinUntil: r.groupingMinUntil ?? null,
      groupingReady: r.groupingReady ?? false,
      scoreboardReason: r.scoreboardReason ?? null,
      groupingSource: r.groupingSource ?? null,
      defaultSeconds: r.defaultSeconds ?? Number(this.env.ANSWER_SECONDS ?? 45),
      roundToken: r.roundToken ?? 0,
      startingAt: r.startingAt ?? null,
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
      hostId: null,
      hostGoneAt: null,
      hostSeenAt: null,
      questions: [],
      question: null,
      answers: {},
      answerAt: {},
      groups: [],
      noAnswer: [],
      endsAt: null,
      questionStartedAt: null,
      graceUntil: null,
      deadline: null,
      backstopAt: null,
      groupingStartedAt: null,
      groupingMinUntil: null,
      groupingReady: false,
      scoreboardReason: null,
      groupingSource: null,
      defaultSeconds: Number(this.env.ANSWER_SECONDS ?? 45),
      roundToken: 0,
      startingAt: null,
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
    const room = this.#room;
    if (!meta?.playerId || !room) return;
    const player = room.players.find((p) => p.id === meta.playerId);
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
    /* Start the blip clock if it was the host's phone. This is the only place
       it is set: it dates the departure, and #ensureHost decides whether enough
       of it has passed to count as a departure at all. */
    if (player.id === room.hostId && room.hostGoneAt === null) {
      room.hostGoneAt = Date.now();
    }
    /* The host walking out of the room is the one disconnect that can freeze the
       game, because reveal and scores are gated on them. Pass the controls on
       BEFORE saving, so the frame this broadcast sends already names the new
       host and nobody sees a "waiting for" with nobody in it. Inside the blip
       grace this holds instead of handing over, and the fallback below is what
       keeps the room moving in the meantime. */
    this.#ensureHost();
    /* Whatever the succession decided, if the room is now sitting on a gated
       phase with nobody live to release it, the fallback hold starts NOW. */
    this.#refreshHostlessHold();
    await this.#save();
    this.#broadcastState();
    /* Ordered after the broadcast on purpose: if that succession found nobody,
       #armAlarm is what arms the deadlock fallback. */
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

  /* ---------------------------------------------------------------- host */

  /** The host, if there is one and they are actually here. Returns null when
      hostId is unset, points at a player who has been dropped, or points at a
      phone that has gone away — which are three different stories with the same
      consequence: nobody can tap Continue. Everything that decides whether the
      room is host-driven or has to fend for itself asks this, not hostId. */
  #liveHost(): PlayerRecord | null {
    const room = this.#room;
    if (!room || !room.hostId) return null;
    const host = room.players.find((p) => p.id === room.hostId);
    return host && host.connected && host.locked ? host : null;
  }

  /** Make sure the controls are in a pair of hands that are still in the room.
      Pure mutation — the caller saves.

      Succession is JOIN order off players[], which is why players[] must never
      be sorted by score: the array IS the queue. A departing host hands to the
      first still-connected locked player behind them.

      Two deliberate non-behaviours:

      1. If there is nobody connected to hand to, hostId is LEFT POINTING AT THE
         PERSON WHO LEFT rather than nulled. Nulling it would tell every surface
         "this room has no host and never had one", which is a different screen
         from "your host dropped out"; and the moment anybody reconnects this
         runs again and hands the controls over properly. #liveHost is what
         callers use to tell a stale hostId from a live one, so the stale value
         costs nothing.
      2. A returning ex-host does NOT get the controls back. Once succession has
         happened it stands. Re-taking them would mean the Continue button moves
         out from under whoever has been driving the game, at whatever moment a
         phone in someone's pocket happens to reconnect — and reconnects are
         invisible to the room, so it would look like the app deciding on its
         own that somebody else is in charge now. The one case that reads as a
         return is the ex-host who was the only one here: hostId still points at
         them, so the check below finds a live host and leaves it alone.

      And because succession is permanent, it must not fire on a NON-departure.
      A socket dropping is not the same event as a person leaving the room: a
      lift, a tunnel, a wifi handover, an OS deciding a backgrounded tab has had
      enough all produce a close followed by net.js reconnecting a couple of
      seconds later. Handing the controls over on the close meant the host came
      back to a game somebody else was now driving, having done nothing but walk
      past a thick wall — and rule 2 above is exactly why they never got it back.
      So a host who has gone is given HOST_BLIP_MS to return before anyone
      succeeds them, and the room simply holds. Note the grace is spent whether
      or not there was anybody to hand to: leaving hostGoneAt set after that
      would leave #armAlarm re-arming a handover that has already been decided,
      at an instant already in the past, forever. */
  #ensureHost(): void {
    const room = this.#room;
    if (!room) return;
    if (this.#liveHost()) {
      /* They are here — whether they never left or came back inside the grace,
         the pending handover is off. */
      room.hostGoneAt = null;
      return;
    }
    if (room.hostGoneAt !== null && Date.now() - room.hostGoneAt < HOST_BLIP_MS) return;
    room.hostGoneAt = null;
    const next = room.players.find((p) => p.locked && p.connected);
    if (next) room.hostId = next.id;
  }

  /** The host's phone reporting that it is still running. Stamped only for the
      socket that actually holds the controls — anyone else sending this is
      ignored rather than failed, since a phone that was host a moment ago and
      has not heard otherwise yet is not doing anything wrong.

      Persisted, because the whole value of the stamp is surviving the eviction
      that a quiet lobby invites. Re-arms, because in the lobby this stamp IS
      the alarm: without that the handover would still fire at the time computed
      from a stamp three beats old. */
  async #hostAlive(ws: WebSocket): Promise<void> {
    const room = this.#room;
    if (!room || !this.#isHostSocket(ws)) return;
    room.hostSeenAt = Date.now();
    await this.#save();
    await this.#armAlarm();
  }

  /** The instant the lobby gives up on a silent host, or null if it has no
      reason to. Null the moment the lobby is not the phase in question: every
      other phase has a deadline of its own and does not need rescuing. */
  #lobbyIdleDueAt(): number | null {
    const room = this.#room;
    if (!room || room.phase !== 'lobby') return null;
    /* Nobody to hand to — the room is one person, or everyone else is still
       choosing a sheep. Taking the controls off the only player present would
       leave the lobby worse than it found it. */
    if (!room.players.some((p) => p.locked && p.connected && p.id !== room.hostId)) return null;
    if (!this.#liveHost()) return null;
    return (room.hostSeenAt ?? Date.now()) + LOBBY_HOST_IDLE_MS;
  }

  /** The instant a deferred handover becomes due, or null if none is pending.
      Only meaningful where nothing else would wake the object to run it — see
      #armAlarm, which uses it in the lobby alone. */
  #handoverDueAt(): number | null {
    const room = this.#room;
    if (!room || room.hostGoneAt === null) return null;
    if (this.#liveHost()) return null;
    return room.hostGoneAt + HOST_BLIP_MS;
  }

  /** Grant the hostless fallback a FRESH full hold. Pure mutation — the caller
      saves.

      `deadline` in reveal and scores is set once, on entry to the phase, and it
      was written for a room that had a host: by the time the room actually
      empties out it is usually already in the past. Arming that stale timestamp
      fires the alarm immediately, which advances the phase, which sets another
      deadline that is immediately stale for the same reason — and an abandoned
      room rips through every remaining round in a few hundred milliseconds,
      scoring nobody and resetting every streak it passes. Whoever comes back
      finds the game over and their flame gone. The fallback is a real hold, so
      it is measured from the moment it is actually taken up. */
  #refreshHostlessHold(): void {
    const room = this.#room;
    if (!room) return;
    if (room.phase !== 'reveal' && room.phase !== 'scores') return;
    if (this.#liveHost()) return;
    const hold =
      room.phase === 'reveal'
        ? Number(this.env.REVEAL_MS ?? 9000)
        : Number(this.env.SCORES_MS ?? 8000);
    room.deadline = Date.now() + hold;
  }

  /** Is this socket the host's phone? A display has no playerId and so is never
      the host, which is the whole point: the TV no longer runs the game. */
  #isHostSocket(ws: WebSocket): boolean {
    const room = this.#room;
    const meta = this.#metaOf(ws);
    return !!room && !!room.hostId && !!meta?.playerId && meta.playerId === room.hostId;
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

      /* There is no 'host.start' any more. The display opens the paddock and
         arms a pack, and that is the end of its authority — the game is started
         from the host's phone. A TV still running the old build sends it, falls
         through to the default case and gets 'Unknown frame.', which is the
         correct answer: its Start button no longer means anything here. */
      /* Not a ping. The runtime answers the real heartbeat itself and never
         wakes this object, which is exactly why a frozen host was invisible —
         so the host's phone sends THIS instead while it holds the controls, and
         it is handled here, awake, where it can be recorded. Deliberately
         silent: no state frame goes out, because nothing anyone can see has
         changed and a lobby full of phones does not need a repaint every
         fifteen seconds. */
      case 'player.alive':
        return this.#hostAlive(ws);

      case 'player.start':
        return this.#start(ws);

      case 'player.continue':
        return this.#continue(ws, frame.phase);

      case 'player.join':
        return this.#join(ws, frame.name);

      case 'player.rejoin':
        return this.#rejoin(ws, frame.playerId, frame.token);

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

  /** A seat's proof of ownership: 24 random bytes as hex, from the runtime CSPRNG.
      Not randomUUID, and not derived from the playerId, the name or the clock —
      anything a person in the room could observe or guess is not a credential,
      and the id it protects is broadcast to the whole party. There is no
      expiry and no rotation: it is worth exactly one seat in one paddock for one
      party, and re-minting it on every rejoin would only give the phone another
      chance to lose it mid-game. */
  #mintToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
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
      groupId: null,
      scoredThisRound: false,
      streak: 0,
      answerCostTotal: 0,
      token: this.#mintToken(),
    };
    room.players.push(player);
    await this.#save();

    const meta: SocketMeta = { role: 'player', playerId: player.id };
    ws.serializeAttachment(meta);

    /* The ONE frame the token rides on, and it goes to this socket alone —
       #send, never #broadcast. Everything else about this player is public;
       this is not. */
    this.#send(ws, {
      t: 'joined',
      playerId: player.id,
      room: room.code,
      name: player.name,
      token: player.token,
    });
    /* They land on the picker, so they need the taken set immediately. */
    this.#send(ws, { t: 'look.taken', taken: this.#takenLooks() });
    this.#broadcastState();
  }

  /** Claim an existing seat. THE ONE FRAME THAT HANDS A SOCKET AN IDENTITY, and
      therefore the one that has to prove the identity is the sender's.

      What it used to do was look the playerId up and attach it, full stop. That
      is an open door with a signpost: hostId goes out on every state frame to
      every socket in the room, so anyone connected could read it, send it
      straight back as their own playerId, and become the host — driving the
      host-gated advance, or just flipping the real host's `connected` to true so
      #liveHost() stops being null and #armAlarm arms nothing at all, which parks
      the room until the party gives up. The same door opened onto any player's
      identity mid-game, not only the host's.

      So the token, and only the token, decides. Note what does NOT happen on a
      failure: no attachment is written, so a socket that fails this is exactly
      as anonymous afterwards as it was before — it does not half-become
      somebody. And a bad token is answered with the same words as an unknown
      playerId on purpose. Two different messages would turn this frame into an
      oracle for "does this id exist in this room", which is a question a phone
      that cannot prove who it is has no business getting an answer to. */
  async #rejoin(ws: WebSocket, playerId: string, rawToken: unknown): Promise<void> {
    const room = this.#room;
    if (!room) return this.#fail(ws, 'ROOM_NOT_FOUND', 'That paddock is gone.');

    /* isClientFrame only vouches for `t`; a token off a socket is as untrusted
       as anything else, and comparing a non-string here would be comparing
       undefined to a stored secret. */
    const token = typeof rawToken === 'string' ? rawToken : '';
    const player = room.players.find((p) => p.id === playerId);
    if (!player || !token || token !== player.token) {
      return this.#fail(ws, 'ROOM_NOT_FOUND', 'We lost your place in that paddock.');
    }

    player.connected = true;
    /* A returning player who has not answered must un-arm any pending early end. */
    this.#recomputeGrace();
    /* Re-evaluate succession now that somebody is back. This is the path that
       rescues a room whose host dropped while it was the only phone connected:
       webSocketClose had nobody to hand to and left hostId stale, and the first
       reconnect — whoever it is — picks the controls up. */
    this.#ensureHost();
    await this.#save();

    const meta: SocketMeta = { role: 'player', playerId };
    ws.serializeAttachment(meta);

    /* The same token back, not a new one: this phone has just proved it holds
       it, so this tells it nothing it did not already know, and it means a
       phone whose storage was cleared between the join and the rejoin — a
       private tab, an evicted origin — is left holding a working pair rather
       than half of one. */
    this.#send(ws, { t: 'joined', playerId, room: room.code, name: player.name, token: player.token });
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
    /* First one through the gate runs the game. Not "first to join" — joining is
       typing a name, and a phone can sit on the picker for a minute; locking in
       is the first moment somebody is definitely playing. #ensureHost is a no-op
       for everyone after them, because by then there is a live host. */
    this.#ensureHost();
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
    /* Authority before phase, deliberately: a non-host phone that fires this at
       an already-started game should be told it is not the host, not handed
       "that game has already started" — which reads as a race it lost rather
       than a button it was never holding. */
    if (!this.#isHostSocket(ws)) {
      return this.#fail(ws, 'NOT_HOST', 'Only the host can start the game.');
    }
    if (room.phase !== 'lobby') {
      return this.#fail(ws, 'GAME_STARTED', 'That game has already started.');
    }
    /* The phase guard above does NOT close this door on its own, and that is the
       trap. `phase` stays 'lobby' until #beginQuestion, which is two question-
       bank RPCs away, and the Durable Object input gate is released across an
       await on another object — so two player.start frames (a host with /play
       open in two tabs, a double-tap that beats the button's own disable) both
       walk past the guard, and the second one re-resolves the questions,
       re-stamps questionStartedAt and wipes the answers of a round already being
       played. Claim the start on the record FIRST, synchronously, before the
       first await exists to be interleaved on. */
    const claimedAt = room.startingAt;
    if (claimedAt !== null && Date.now() - claimedAt < START_CLAIM_STALE_MS) {
      return this.#fail(ws, 'GAME_STARTED', 'That game is already starting.');
    }

    /* Only the flock counts towards the minimum: a room of five where three are
       still picking is a room of two. */
    const locked = room.players.filter((p) => p.locked);
    const minPlayers = Number(this.env.LOBBY_MIN_PLAYERS ?? 2);
    if (locked.length < minPlayers) {
      return this.#fail(ws, 'BAD_REQUEST', `Need at least ${minPlayers} players.`);
    }

    /* THE CLAIM. Every check above is synchronous, so nothing has yielded since
       the guard read it and this write is the last thing that happens on this
       turn of the event loop — the second frame is already looking at it by the
       time it runs. Persisted immediately after, so the claim survives an
       eviction as well as an interleave; it expires, so an eviction cannot lock
       the lobby out of ever starting. Every exit below clears it. */
    room.startingAt = Date.now();
    await this.#save();

    const defaultRounds = Number(this.env.DEFAULT_ROUNDS ?? 9);
    const envSeconds = Number(this.env.ANSWER_SECONDS ?? 45);
    let settings;
    let resolved;
    try {
      const bank = this.env.QUESTIONS.getByName('bank');
      settings = await bank.getSettings();
      resolved = await bank.resolveGame(room.packCode, defaultRounds);
    } catch (error) {
      /* A bank that threw leaves a lobby that never started, so it must leave a
         lobby that can be started again — on the next tap, not in thirty
         seconds. #handle logs this and tells the phone to try again. */
      room.startingAt = null;
      await this.#save();
      throw error;
    }
    const defaultSeconds = settings.answerSeconds ?? (Number.isFinite(envSeconds) ? envSeconds : 45);

    if (resolved.questions.length === 0) {
      room.startingAt = null;
      await this.#save();
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
      p.streak = 0;
      /* Zeroed with the score, and for the same reason: a second game in the
         same paddock must not be tie-broken on how fast people typed in the
         first one. */
      p.answerCostTotal = 0;
    }
    /* hostId needs no fixing here even though the roster just shrank: it is only
       ever assigned to a player who has locked in, and the filter above keeps
       exactly the locked players. The host cannot be among the dropped. */

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

  /* --------------------------------------------------- releasing the hold */

  /** The host tapping Continue on a reveal or a scoreboard. This is now the only
      thing that moves those two phases; there is no timer behind them.

      `phase` is the phase the button was DRAWN on, and the room drops the frame
      unless it is still in it. That stamp is the entire point of the field: the
      reveal is the screen people talk over, so the host taps, nothing looks
      different for a beat, and they tap again — and without the stamp the second
      tap advances a second time and skips the scoreboard it was never aimed at.
      A mismatch is answered with SILENCE rather than an error frame, because it
      is always either that double-tap or a frame drawn on the phase we have just
      left, and neither deserves a red toast on the phone of the one person in
      the room who has to keep looking at their screen.

      Unlike #start, this needs no claim on the record. The guard here and the
      mutation it protects are separated by NO AWAIT: `room.phase !== rawPhase`
      falls straight into #afterReveal / #nextRound, and every one of those paths
      (#toFinal, the scores branch, #beginQuestion) writes room.phase before its
      own first await. The input gate is therefore still held for the whole
      guard-to-mutation window and a second frame cannot interleave into it. That
      is the difference the start bug turns on, so if a bank call or any other
      await is ever added between this guard and the phase write, this comment
      stops being true and #continue needs the same treatment #start got. */
  async #continue(ws: WebSocket, rawPhase: unknown): Promise<void> {
    const room = this.#room;
    if (!room) return this.#fail(ws, 'ROOM_NOT_FOUND', 'That paddock is gone.');
    if (!this.#isHostSocket(ws)) {
      return this.#fail(ws, 'NOT_HOST', 'Only the host can move the game on.');
    }
    /* isClientFrame only vouches for `t`; the payload is as untrusted as any
       other field off a socket, so the union is re-checked at runtime. */
    if (rawPhase !== 'reveal' && rawPhase !== 'scores') {
      return this.#fail(ws, 'BAD_REQUEST', 'That phase does not wait for anyone.');
    }
    if (room.phase !== rawPhase) return;

    if (rawPhase === 'reveal') return this.#afterReveal();
    return this.#nextRound();
  }

  /* -------------------------------------------------------------- the round */

  async #beginQuestion(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    room.roundToken += 1;
    room.answers = {};
    room.answerAt = {};
    room.groups = [];
    room.noAnswer = [];
    for (const p of room.players) {
      p.groupId = null;
      p.scoredThisRound = false;
      /* p.streak is conspicuously NOT reset here. A streak is a fact about
         rounds that have already happened; zeroing it at the top of a question
         would wipe it every single round and nobody would ever reach two. It is
         maintained in exactly one place, #scoreRound. */
    }
    room.phase = 'question';
    /* The start claim has done its job the moment the phase moves off 'lobby' —
       from here the phase guard in #start rejects on its own. Released here
       rather than back in #start so that it is cleared by the same write that
       persists the started game, and not one save later. */
    room.startingAt = null;
    const q = room.questions[room.roundIndex];
    room.question = q ? q.text : null;
    const secs = q && q.seconds != null ? q.seconds : room.defaultSeconds;
    /* One `now` for both, so the round's t=0 and its deadline cannot disagree by
       the millisecond it takes to read the clock twice. */
    const now = Date.now();
    room.questionStartedAt = now;
    room.endsAt = now + secs * 1000;
    room.graceUntil = null;
    room.deadline = null;
    /* Cleared with `deadline`: a backstop belongs to the reveal or scoreboard it
       was armed for, and carrying last round's into this question would leave a
       stale instant lying around for #armAlarm to find on the next gated phase
       before #finishRound has written a fresh one. */
    room.backstopAt = null;
    room.groupingStartedAt = null;
    room.groupingMinUntil = null;
    room.groupingReady = false;
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
    /* Stamped on EVERY write, so an edit re-starts the clock for this player.
       Last write wins because the thing being timed is when they settled on an
       answer, not when they first touched the keyboard — otherwise the quickest
       route to the tiebreak is to fire off a single letter and think afterwards.
       Server clock only: a phone's idea of the time is not ours, and the whole
       measurement is an offset from questionStartedAt, which we set. */
    room.answerAt[player.id] = Date.now();
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
    } else if (room.phase === 'grouping') {
      /* ONE alarm, TWO deadlines, and which one is in `deadline` depends on
         groupingReady — this is the trap in the whole grouping change. While the
         grouper is in flight `deadline` is the watchdog (+25s), which recovers a
         grouping that outlived its isolate. The moment groups land, #settleGroup
         overwrites it with groupingMinUntil (+5s from the start of the phase),
         which is the min-hold. The two can never both be pending because the
         later one is only ever written after the earlier one stops mattering,
         and alarm() reads groupingReady to know which one just fired. */
      at = room.deadline;
    } else if (room.phase === 'lobby') {
      /* The lobby has no deadline of its own — it waits on the host's Start and
         nothing else — which makes it the one phase where a DEFERRED HOST
         HANDOVER would never be run by anybody. Everywhere else something is
         already ticking that will call #ensureHost when it fires; here, a host
         who drops out of a lobby of four would leave the Start button on a phone
         that is never coming back, with nothing scheduled to notice. So while a
         handover is pending, the blip expiry IS the lobby's alarm.

         The second candidate is the silent-host deadline. A host who never
         closed a socket but whose phone has stopped running leaves no departure
         to defer, so #handoverDueAt has nothing to say about them — and the
         lobby would sit there, Start unpressable, until the party gave up.
         Whichever comes first wins; both hand the controls on. */
      const pending = this.#handoverDueAt();
      const idle = this.#lobbyIdleDueAt();
      at = pending === null ? idle : idle === null ? pending : Math.min(pending, idle);
    } else if (room.phase === 'reveal' || room.phase === 'scores') {
      /* HOST-GATED, and the host's Continue is still the normal way out: these
         two phases exist to be talked over, and the whole point of the gate is
         that the room moves when the room is ready. But "no alarm at all"
         cannot be right, because the thing it trusts is not trustworthy.
         `connected` is a flag set when a socket opens and cleared when it
         closes; nothing in between ever verifies it. The heartbeat that would
         is answered by setWebSocketAutoResponse, which by design never wakes
         this object — so a host whose tab has been frozen, backgrounded or
         locked in a pocket is indistinguishable from a host who is about to
         tap, and with nothing armed the room stays on that reveal until the
         party gives up. Every other player asking to move gets NOT_HOST.

         So there are always TWO candidate deadlines and this picks between:

         1. A live host: the BACKSTOP (HOST_BACKSTOP_MS from entering the
            phase). Long enough that no real pause ever reaches it — the gate
            governs every ordinary party and there is no race worth the name
            between a two-minute timer and a host who taps in eight seconds —
            and short enough that a dead phone costs one long beat rather than
            the rest of the game.
         2. No live host: the short REVEAL_MS / SCORES_MS FALLBACK in
            `deadline`, refreshed to a full hold at the moment the room lost its
            host (see #refreshHostlessHold), which plays an abandoned game out
            so the TV finishes and returns to a usable state.

         #armAlarm is called from webSocketClose, so the fallback replaces the
         backstop the instant the room empties; it is called from #rejoin too,
         so the first phone back restores the long one. A record written before
         the backstop existed has none stored, and is measured from now rather
         than being treated as "no alarm" — which would be the parked room all
         over again, arriving via a deploy. */
      at = this.#liveHost() ? (room.backstopAt ?? Date.now() + HOST_BACKSTOP_MS) : room.deadline;
    }
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  override async alarm(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    if (room.phase === 'question') return this.#closeAnswers();
    if (room.phase === 'lobby') {
      /* Two ways to arrive: a departed host whose blip grace has run out, or a
         host still holding an open socket whose phone has gone silent. The
         first is #ensureHost's own case and it handles it. The second it cannot
         see — #liveHost() is perfectly happy, because the socket really is open
         — so it is settled here, and only after re-checking the clock, since
         this alarm may have been set from a stamp that has since been renewed
         by a phone that woke back up. */
      this.#ensureHost();
      const due = this.#lobbyIdleDueAt();
      if (due !== null && Date.now() >= due - ALARM_SLOP_MS) {
        /* Straight past the current holder to whoever joined next and is still
           here. Not #ensureHost: that asks "is anyone host", and the answer is
           yes — the point is that this one cannot act. */
        const next = room.players.find((p) => p.locked && p.connected && p.id !== room.hostId);
        if (next) {
          room.hostId = next.id;
          room.hostGoneAt = null;
          /* Dated now, not left stale: the new holder is owed a full window to
             prove itself before the lobby comes for them too. */
          room.hostSeenAt = Date.now();
        }
      }
      await this.#save();
      /* The controls moved, so every phone has to find out whose they are. */
      this.#broadcastState();
      return this.#armAlarm();
    }
    if (room.phase === 'grouping') {
      /* Branch on the flag, not on the clock. Both grouping deadlines land in
         this one handler, and getting it wrong means throwing away a Claude
         grouping that arrived four seconds ago and re-doing it with the fuzzy
         grouper, which the room would see as the answers being regrouped for no
         reason halfway through the dog's run. */
      return room.groupingReady ? this.#finishRound(room.roundToken) : this.#recoverGrouping();
    }
    if (room.phase === 'reveal' || room.phase === 'scores') {
      /* Either deadline in #armAlarm can land here — the hostless fallback or
         the backstop — and this handler is also the deferred handover's only
         reliable chance to run in these phases, so succession is settled FIRST.
         A host who dropped out longer ago than the blip grace loses the controls
         here, to whoever is still in the room. */
      this.#ensureHost();
      /* Whichever deadline is the live one NOW, after that succession: a room
         that just acquired a host is waiting on the long backstop, not on the
         short fallback that woke us. If it has not actually arrived, this alarm
         is stale — a phone reconnected, or the controls just changed hands — and
         the right answer is to re-arm rather than yank the screen out from under
         someone who is about to tap Continue. The slop is because an alarm is
         not a promise about the millisecond, and re-arming one that has all but
         arrived would spin. */
      const due = this.#liveHost()
        ? (room.backstopAt ?? Date.now() + HOST_BACKSTOP_MS)
        : (room.deadline ?? 0);
      if (Date.now() + ALARM_SLOP_MS < due) {
        /* Persist and publish first: the succession above may have moved the
           controls, and the room should see its new host now rather than
           whenever the next frame happens to arrive. */
        await this.#save();
        this.#broadcastState();
        return this.#armAlarm();
      }
      await this.#save();
      return room.phase === 'reveal' ? this.#afterReveal() : this.#nextRound();
    }
    /* The lobby is handled at the top, where both of the things it can arm —
       a deferred handover and a host that has gone silent — are settled
       together. 'final' has no deadline to service. */
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
    await this.#settleGrouping(token);
  }

  async #closeAnswers(): Promise<void> {
    const room = this.#room;
    if (!room || room.phase !== 'question') return;
    /* THE REAL CLOSE, not the nominal one. Two clocks are in play and only this
       one is the window players were actually racing:
         - the grace close, which is the common case: everyone answered, the
           round shut 1.5s later, and the window was those few seconds — NOT the
           45 (or 300) the question was advertised for;
         - the hard gate, where `now` may be a beat past endsAt because an alarm
           is not a promise about the millisecond and a woken object can be
           later still. Charging that overshoot to the round would quietly
           stretch everyone's window by however long the runtime took to get
           here.
       min() of the two gives the grace close its real moment and the hard gate
       its nominal one, which is the instant each phone's countdown showed.
       Computed BEFORE endsAt is cleared, for obvious reasons. */
    const closedAt = room.endsAt !== null ? Math.min(Date.now(), room.endsAt) : Date.now();
    this.#chargeAnswerTime(closedAt);
    room.endsAt = null;
    room.graceUntil = null;
    /* No deleteAlarm here. It used to sit on this line and it opened a window:
       the alarm was gone before the phase change had been persisted, so an
       eviction in between left a stored room in 'question' with nothing armed
       and nothing that would ever re-arm it — a round frozen at zero seconds.
       #enterGrouping writes the watchdog through #armAlarm a few lines later
       and that setAlarm REPLACES this one (there is only ever one alarm), so
       the delete was never doing anything except creating that gap. */
    await this.#enterGrouping();
  }

  /** Bill every player for this round into their cumulative tiebreak, as a
      FRACTION OF THIS ROUND'S OWN WINDOW. Called once, from the single point
      where answers close — both the hard gate and the all-answered grace arrive
      here through the same alarm — with the instant the round actually shut.

      THE TRAP IS THE MISSED ROUND. Charging 0 for "no answer" makes not
      answering the fastest thing a player can do, and the tiebreak then rewards
      the person who sat out. So a player with no answer is charged the whole
      window — the maximum anyone who did answer could possibly have spent.
      Disconnected players are billed the same way; being gone is not a strategy.

      THE SECOND TRAP IS THAT ROUNDS ARE NOT THE SAME LENGTH. Per-question timers
      are editor-settable anywhere from 5s to 300s, so a raw millisecond sum is
      not a comparison at all: sitting out a 5s round used to cost 5,000 while
      answering a 300s round in a brisk twenty seconds cost 20,000, and the
      tiebreak then ranked the player who contributed nothing above the player
      who turned up. Dividing by the window each charge was measured in makes
      every round worth at most one, whatever its length, and leaves the ordering
      WITHIN a round exactly as it was — the fast answer is still the cheap one.
      It also makes the number readable: 2.4 after nine rounds means "this player
      has spent about two and a half rounds' worth of thinking time".

      This is a TIEBREAK and nothing else. It never touches score; #ranksOf reads
      it only after scores are equal.

      Every charge is clamped into 0..1. Both clocks are ours, but a frame that
      lands a millisecond either side of the timestamp it is measured against —
      or a deploy in the middle of a round — must not hand somebody negative time
      and a permanent hold on first place, nor charge an answerer more than a
      no-show. The window itself is floored at 1ms so a degenerate round (a
      question whose start and close are the same instant, which #normalize's
      fallbacks can produce across a deploy) divides by something. */
  #chargeAnswerTime(closedAt: number): void {
    const room = this.#room;
    if (!room) return;
    const startedAt = room.questionStartedAt ?? closedAt;
    const window = Math.max(1, closedAt - startedAt);
    for (const p of room.players) {
      if (!p.locked) continue;
      const at = room.answerAt[p.id];
      const spent = typeof at === 'number' ? Math.max(0, at - startedAt) : window;
      p.answerCostTotal += Math.min(1, spent / window);
    }
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
    const startedAt = Date.now();
    room.groupingStartedAt = startedAt;
    room.groupingMinUntil = startedAt + GROUPING_MIN_MS;
    room.groupingReady = false;
    /* Arm a watchdog so a grouping that outlives its isolate still completes:
       on wake, alarm() -> #recoverGrouping finishes the round with the fuzzy
       grouper. The normal path below finishes far sooner and re-arms the alarm
       to the min-hold, so this deadline is only ever reached on failure. It is
       25s against the min-hold's 5s, and it is written FIRST, so there is never
       a moment where the shorter one is pending and the watchdog is what fires:
       the min-hold replaces it, it does not compete with it. */
    room.deadline = startedAt + GROUPING_WATCHDOG_MS;
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
      /* Nobody answered, so there is nothing to group and this returns in zero
         milliseconds — which is precisely the case the min-hold exists for. Down
         #settleGrouping like everything else rather than straight to the reveal,
         or a silent round flashes the grouping screen for one frame. */
      await this.#settleGrouping(token);
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
    await this.#settleGrouping(token);
  }

  /** Groups exist for this round — now leave 'grouping', but not before the room
      has had five seconds to watch the dog work.

      The single gate between "grouped" and "revealed". Everything that can
      produce groups goes through it: the model, the fuzzy fallback, the
      watchdog recovery, and the nobody-answered case that produces none at all.

      When the grouper beat the floor, the groups are STORED and groupingReady is
      raised before the alarm is moved to groupingMinUntil. That ordering is what
      makes the hold safe across an eviction: the object can be thrown away in
      the gap and woken by that alarm with the good grouping already on disk, and
      alarm() reads groupingReady to know it is holding rather than watchdogging.
      Store after arming and a wake in the gap loses the grouping. */
  async #settleGrouping(token: number): Promise<void> {
    const room = this.#room;
    if (!room || room.roundToken !== token || room.phase !== 'grouping') return;

    room.groupingReady = true;
    const minUntil = room.groupingMinUntil ?? 0;
    if (Date.now() >= minUntil) return this.#finishRound(token);

    room.deadline = minUntil;
    await this.#save();
    /* Nothing visible changed — the phase, the bar's start and its floor are all
       as they were — but the state is re-broadcast anyway so a surface that
       missed the entry frame is holding a bar it can still finish. */
    this.#broadcastState();
    await this.#armAlarm();
  }

  /* --------------------------------------------------------------- scoring */

  #scoreRound(): void {
    const room = this.#room;
    if (!room) return;
    const answered = new Set<string>();
    for (const g of room.groups) for (const a of g.answers) answered.add(a.playerId);

    let max = 0;
    for (const g of room.groups) if (g.answers.length > max) max = g.answers.length;

    /* Who actually FLOCKED — scored in a group with somebody else in it. Not the
       same set as "scored", and the difference is the whole of the streak fix
       below. */
    const flocked = new Set<string>();

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
        if (g.scored && g.answers.length > 1) flocked.add(p.id);
      }
    }

    /* Streaks, over EVERY player and not just the ones in a group. A player who
       answered into a losing group and a player who did not answer at all have
       both broken their run, and only a sweep over the whole roster catches the
       second kind — the loop above never visits them. Run after that loop, so
       scoredThisRound is final for this round.

       THE STREAK IS NOT scoredThisRound, AND MUST NOT BE "FIXED" BACK TO IT.
       Scoring and flocking are deliberately different tests:

       - SCORING is `g.answers.length === max`, and a group of one clears it when
         every answer that round was unique. That is intentional, it is written
         down in PRODUCT.md, and nothing here changes it: a round where everyone
         said something different gives everyone who answered a point.
       - A STREAK is a claim about agreement — the flame says "this player keeps
         landing with the flock". Fed off scoredThisRound it fired on exactly the
         rounds where nobody agreed with anybody: in a two-player room, three
         all-unique rounds put a flame on both players for three rounds of
         complete disagreement, which is the opposite of what the icon means.

       So a streak advances only for a player whose scoring group had MORE THAN
       ONE member — a real majority, with someone else in it. Everyone else, in
       a losing group or in no group at all, is back to zero. */
    for (const p of room.players) {
      p.streak = flocked.has(p.id) ? p.streak + 1 : 0;
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
    /* A host can walk out during the question or the grouping, and nothing on
       those two paths runs succession — so settle it here, before the deadlines
       below are chosen. A reveal that opens with a new host then opens on the
       backstop rather than the short hostless fallback, and the very first frame
       the room sees already names whoever is holding Continue. Inside the blip
       grace this is a no-op and the fallback covers the wait, as everywhere
       else. */
    this.#ensureHost();
    /* No longer how the reveal ends — the host's Continue is. Kept, and kept
       current, purely as the deadlock fallback #armAlarm reaches for when the
       room has emptied out and nobody is left to tap; #refreshHostlessHold
       re-dates it to a full hold at the moment that actually happens, since by
       then this timestamp is long past. */
    room.deadline = Date.now() + Number(this.env.REVEAL_MS ?? 9000);
    /* And the backstop, which IS armed while the host is here — the reveal
       cannot be left with no deadline at all, or a frozen host tab parks the
       party on it forever. See #armAlarm. */
    room.backstopAt = Date.now() + HOST_BACKSTOP_MS;
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
      /* Fallback and backstop, exactly as in #finishRound: the scoreboard waits
         on the host, but never without a deadline behind it. */
      room.deadline = Date.now() + Number(this.env.SCORES_MS ?? 8000);
      room.backstopAt = Date.now() + HOST_BACKSTOP_MS;
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
    /* Nothing waits on anything from here — the game is over and the podium
       stays up until the display is closed — so both deadlines go with the
       alarm rather than leaving a stale instant for a later phase to find. */
    room.backstopAt = null;
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

  /** The standing, computed once here and shipped as a number, because the wire
      does not carry enough for anyone else to work it out.

      Score descending, then cumulative answer COST ascending — the normalised
      per-round charge from #chargeAnswerTime, so a 5s round and a 300s round
      weigh the same. Speed is a tiebreak and nothing else, so a fast player
      never outranks a higher score — then position in players[] as an
      unconditional final tiebreak.

      That last clause is not decoration. This must be a TOTAL order: no two
      players may ever share a rank, because the phone picks its sheep's face
      from which THIRD of the field its rank falls in, and a shared rank puts two
      people in the same third and leaves another third with nobody in it. Two
      players on the same score with the same charge is unlikely and entirely
      possible on round one, where everyone who did not answer is charged the
      identical 1.0. Join order settles it, deterministically, forever.
      Never competition-style ranking (1, 1, 3) for the same reason.

      Returns a map rather than a sorted array on purpose: rank is a FIELD, and
      players[] must stay in join order. Sorting that array would reshuffle the
      flock on every repaint — the waiting sheep are redrawn through innerHTML
      each time anyone answers — and host succession reads join order off it. */
  #ranksOf(locked: PlayerRecord[]): Map<string, number> {
    const order = locked
      .map((p, joinIndex) => ({ p, joinIndex }))
      .sort(
        (a, b) =>
          b.p.score - a.p.score ||
          a.p.answerCostTotal - b.p.answerCostTotal ||
          a.joinIndex - b.joinIndex,
      );
    const ranks = new Map<string, number>();
    order.forEach((entry, i) => ranks.set(entry.p.id, i + 1));
    return ranks;
  }

  #stateFor(playerId: string | null): StateFrame {
    const room = this.#room;
    const players = room?.players ?? [];
    const phase: Phase = room?.phase ?? 'lobby';
    /* players[] is LOCKED players only: an unlocked player has no colour, so
       there is no sheep to draw for them. They are not invisible any more — they
       go out as choosingPlayers below, with a name and no look, and the lobby
       draws a silhouette each. */
    const locked = players.filter((p) => p.look && p.locked);
    /* The EXACT complement of `locked`, from the negation of that same test
       rather than a second test that happens to agree today. Both the count and
       the array are built from this one list, so the TV can never be told that
       four people are choosing and handed three names to draw — which is the
       failure the count on its own already had a mild version of, and which
       would be plainly visible the moment there are silhouettes to count.
       Order is inherited from players[], i.e. join order: the lobby is redrawn
       through innerHTML on every join and every lock-in, and a list that
       resorted itself would shuffle the silhouettes under their own names. */
    const stillChoosing = players.filter((p) => !(p.look && p.locked));
    const revealed = phase === 'reveal' || phase === 'scores' || phase === 'final';
    /* Ranked over exactly the set that goes out in players[], so every rank on
       the wire has a row to belong to and 1..N covers it with no gaps. */
    const ranks = this.#ranksOf(locked);

    const state: StateFrame = {
      t: 'state',
      room: room?.code ?? '',
      phase,
      roundIndex: room?.roundIndex ?? 0,
      totalRounds: room?.totalRounds ?? 0,
      /* The prompt is public — it is the question, not an answer. */
      question: phase === 'lobby' ? null : (room?.question ?? null),
      endsAt: phase === 'question' ? (room?.endsAt ?? null) : null,
      hostId: room?.hostId ?? null,
      /* DERIVED, never stored. Storing it would give the same fact two homes,
         and the stored one is stale the first time a deploy lands mid-round.

         Derived from the LIVE host, not from the phase alone. hostId is left
         pointing at a host who has walked out (#ensureHost, non-behaviour 1),
         so phase alone had both surfaces announcing that they were waiting for
         someone who was already gone — while the room was in fact running on
         the hostless fallback and about to move on its own. This asks the same
         question #armAlarm asks, so the flag and the alarm can never tell the
         room two different stories: true means a real phone is being waited on,
         false means nothing is holding this screen up. */
      awaitingHost: (phase === 'reveal' || phase === 'scores') && !!this.#liveHost(),
      /* Null in every phase but 'grouping', so a bar still on screen because a
         surface missed a frame has nothing left to keep filling itself from. */
      groupingProgress:
        phase === 'grouping' && room && room.groupingStartedAt !== null
          ? {
              startedAt: room.groupingStartedAt,
              minUntil: room.groupingMinUntil ?? room.groupingStartedAt + GROUPING_MIN_MS,
              expectedMs: GROUPING_EXPECTED_MS,
            }
          : null,
      players: locked.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        streak: p.streak,
        /* Ranked above; the fallback can only be reached by a player who is not
           in `locked`, which by construction is nobody in this map. */
        rank: ranks.get(p.id) ?? 0,
        /* A boolean off the answers map — never the text itself. And never
           answerAt either: the timings stay off the wire entirely. */
        answered: room ? room.answers[p.id] !== undefined : false,
        connected: p.connected,
        look: p.look as Look,
      })),
      choosing: stillChoosing.length,
      /* LOBBY ONLY, and empty — not absent, not null — everywhere else, so the
         surfaces can loop over it unguarded exactly as they do groups[] and
         noAnswer[]. Sending it in the other phases would be dead weight on
         every frame of every round, and worse than useless: #start drops
         everyone still choosing at the gate, so any name in here after the
         lobby would be a person who is no longer in the room.
         Id and name only. These players have no look BY DEFINITION, and the
         half-made one on their picker is not ours to publish — a colour that
         reached the TV before it was locked could be spoiled on the big screen
         and then lost anyway to whoever claims that pair first. */
      choosingPlayers:
        phase === 'lobby' ? stillChoosing.map((p) => ({ id: p.id, name: p.name })) : [],
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
          streak: me.streak,
          /* 0 for a player who is still picking a look: they are not in the
             ranked set because they are not in players[] either. The phone only
             reads rank on the score screen, which they cannot reach unranked. */
          rank: ranks.get(me.id) ?? 0,
          isHost: !!room?.hostId && me.id === room.hostId,
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
