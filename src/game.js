/**
 * src/game.js — Flock Together game state machine.
 *
 * This module is the ONLY owner of game state. Nothing else may mutate a room.
 *
 * Phase flow:
 *   lobby -> ( question -> grouping -> reveal -> [scores] -> )* -> final
 *
 * Wire contract (see PRODUCT.md + the protocol spec):
 *   GameState = {
 *     room, phase, roundIndex, totalRounds, question, endsAt,
 *     players:[{id,name,score,answered,connected,look}],
 *     choosing, groups:[{id,label,answers:[{playerId,name,text}],scored}],
 *     noAnswer:[{playerId,name}],
 *     scoreboardReason, groupingSource
 *   }
 *   Player frames add: you:{id,name,score,answered,myGroupId,scoredThisRound,
 *                           look,locked}
 *
 * THE FLOCK IS THE LOCKED PLAYERS. Joining only reserves a name; a player is
 * part of the flock once they confirm a look (see setLook). `players[]` on the
 * wire therefore holds only locked players, and `choosing` counts the ones
 * still in the picker so the display can say how many are yet to decide.
 *
 * SAFETY INVARIANT: while phase === 'question' the emitted state is built by a
 * dedicated serializer that has no access path to answer text at all. Answer
 * text lives only in `this._answers` (a Map) and, after grouping, in
 * `this._groups`. Player records never hold text, and the question serializer
 * never reads either collection. Leaking is structurally impossible rather than
 * prevented by deleting fields from a fuller object.
 *
 * Pure ESM. No npm dependencies — the one import is the look module the phones
 * load over HTTP, imported off disk so server and surfaces cannot disagree
 * about which colours and hats exist.
 */

import { lookKey, validateLook } from '../public/shared/look.js';

const DEFAULTS = {
  ANSWER_SECONDS: 45,
  REVEAL_MS: 9000,
  SCORES_MS: 8000,
  LOBBY_MIN_PLAYERS: 2,
  MAX_PLAYERS: 20,
  DEFAULT_ROUNDS: 9,
  GROUPING_TIMEOUT_MS: 12000,
  ALL_ANSWERED_GRACE_MS: 1500,
};

const MAX_ANSWER_CHARS = 80;
const MAX_NAME_CHARS = 24;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O — unambiguous on a TV

/* ------------------------------------------------------------------ helpers */

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function makeRoomCode() {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return out;
}

let idSeq = 0;
function makePlayerId() {
  idSeq += 1;
  return `p_${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Accepts a string question or an object with .text/.question/.prompt. */
function questionText(q) {
  if (typeof q === 'string') return q;
  if (q && typeof q === 'object') {
    const v = q.text ?? q.question ?? q.prompt ?? q.body;
    if (typeof v === 'string') return v;
  }
  return String(q ?? '');
}

/** Fisher-Yates over a copy — random pick without repeats. */
function sampleWithoutRepeats(list, count) {
  const pool = list.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}

/** Loose text key used by the offline fallback grouper and text->player matching. */
function textKey(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function timeoutRace(promise, ms) {
  let handle = null;
  const timeout = new Promise((_resolve, reject) => {
    handle = setTimeout(() => reject(new Error('GROUPING_TIMEOUT')), ms);
    if (handle && typeof handle.unref === 'function') handle.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (handle) clearTimeout(handle);
  });
}

/* -------------------------------------------------------------- the factory */

/**
 * @param {object} opts
 * @param {object} opts.config        timings/limits (see DEFAULTS); missing keys fall back
 * @param {Array<string|object>} opts.questions   question pool
 * @param {(question:string, answers:Array<{playerId:string,name:string,text:string}>)=>Promise<any>} opts.groupAnswers
 * @param {(room:string, buildFrameForConn:(conn:object)=>object|null)=>number} opts.broadcast
 *        called after EVERY state change; server.js calls the builder once per
 *        live connection in the room and skips any falsy return
 * @param {string} [opts.room]       room code; generated if omitted
 * @returns {object} game
 */
export function createGame(opts = {}) {
  const config = { ...DEFAULTS, ...(opts.config || {}) };
  const ANSWER_MS = num(config.ANSWER_SECONDS, DEFAULTS.ANSWER_SECONDS) * 1000;
  const REVEAL_MS = num(config.REVEAL_MS, DEFAULTS.REVEAL_MS);
  const SCORES_MS = num(config.SCORES_MS, DEFAULTS.SCORES_MS);
  const LOBBY_MIN_PLAYERS = num(config.LOBBY_MIN_PLAYERS, DEFAULTS.LOBBY_MIN_PLAYERS);
  const MAX_PLAYERS = num(config.MAX_PLAYERS, DEFAULTS.MAX_PLAYERS);
  const DEFAULT_ROUNDS = num(config.DEFAULT_ROUNDS, DEFAULTS.DEFAULT_ROUNDS);
  const GROUPING_TIMEOUT_MS = num(config.GROUPING_TIMEOUT_MS, DEFAULTS.GROUPING_TIMEOUT_MS);
  const GRACE_MS = num(config.ALL_ANSWERED_GRACE_MS, DEFAULTS.ALL_ANSWERED_GRACE_MS);

  const questionPool = Array.isArray(opts.questions) ? opts.questions.slice() : [];
  const groupAnswers = typeof opts.groupAnswers === 'function' ? opts.groupAnswers : null;
  const broadcastFn = typeof opts.broadcast === 'function' ? opts.broadcast : null;

  // Mutable because the transport owns room-code allocation: 'host.create'
  // arrives with the code server.js registered, and broadcasts must use it.
  let room =
    typeof opts.room === 'string' && opts.room.trim() ? opts.room.trim().toUpperCase() : makeRoomCode();

  /* ------------------------------------------------------------------ state */

  const state = {
    phase: 'lobby',
    roundIndex: 0,
    totalRounds: 0,
    question: null,
    endsAt: null,
    scoreboardReason: null,
    groupingSource: null,
  };

  /** @type {Array<{id:string,name:string,score:number,connected:boolean,groupId:string|null,scoredThisRound:boolean,look:{colorId:string,hatId:string}|null,locked:boolean}>} */
  const players = [];
  /** @type {Map<string, string>} playerId -> answer text. THE ONLY home of live answer text. */
  const answers = new Map();
  /** @type {Array<{id:string,label:string,answers:Array<{playerId:string,name:string,text:string}>,scored:boolean}>} */
  let groups = [];
  /** @type {Array<{playerId:string,name:string}>} */
  let noAnswer = [];

  let chosenQuestions = [];
  /** @type {Map<number,'third'|'penultimate'|'final'>} */
  let scoreboardRounds = new Map();

  let phaseTimer = null;
  let graceTimer = null;
  let disposed = false;
  let roundToken = 0; // invalidates late async grouping results

  /* ----------------------------------------------------------------- timers */

  function clearPhaseTimer() {
    if (phaseTimer) {
      clearTimeout(phaseTimer);
      phaseTimer = null;
    }
  }

  function clearGraceTimer() {
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  }

  function clearAllTimers() {
    clearPhaseTimer();
    clearGraceTimer();
  }

  function setPhaseTimer(fn, ms) {
    clearPhaseTimer();
    const token = roundToken;
    phaseTimer = setTimeout(() => {
      phaseTimer = null;
      if (disposed || token !== roundToken) return;
      fn();
    }, Math.max(0, ms));
  }

  /* ------------------------------------------------------------ serializers */

  function publicPlayers() {
    // Only the locked players: someone still in the picker has no sheep to draw
    // and must not appear in the flock, on the scoreboard, or in a paddock.
    // `answered` is a boolean derived from Map.has — never the text itself.
    return lockedPlayers().map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      answered: answers.has(p.id),
      connected: p.connected,
      look: p.look ? { ...p.look } : null,
    }));
  }

  function publicGroups() {
    return groups.map((g) => ({
      id: g.id,
      label: g.label,
      answers: g.answers.map((a) => ({ playerId: a.playerId, name: a.name, text: a.text })),
      scored: g.scored,
    }));
  }

  function publicNoAnswer() {
    return noAnswer.map((n) => ({ playerId: n.playerId, name: n.name }));
  }

  function baseFrame() {
    return {
      room,
      phase: state.phase,
      roundIndex: state.roundIndex,
      totalRounds: state.totalRounds,
      question: state.question,
      endsAt: null,
      players: publicPlayers(),
      // Joined but still picking. Sibling of players[] rather than a member of
      // it, so a half-chosen sheep is countable without being drawable.
      choosing: choosingCount(),
      groups: [],
      noAnswer: [],
      scoreboardReason: null,
      groupingSource: null,
    };
  }

  // --- one serializer per phase. Only the post-timer ones can see text. ---

  function serializeLobby() {
    const f = baseFrame();
    f.question = null;
    f.roundIndex = 0;
    return f;
  }

  /** ZERO answer text. Does not read `answers` values or `groups` at all. */
  function serializeQuestion() {
    const f = baseFrame();
    f.endsAt = state.endsAt;
    return f;
  }

  /** Grouping is in flight: still zero answer text, groups not ready. */
  function serializeGrouping() {
    const f = baseFrame();
    f.groupingSource = null;
    return f;
  }

  function serializeReveal() {
    const f = baseFrame();
    f.groups = publicGroups();
    f.noAnswer = publicNoAnswer();
    f.groupingSource = state.groupingSource;
    return f;
  }

  function serializeScores() {
    const f = baseFrame();
    f.groups = publicGroups();
    f.noAnswer = publicNoAnswer();
    f.groupingSource = state.groupingSource;
    f.scoreboardReason = state.scoreboardReason;
    return f;
  }

  function serializeFinal() {
    const f = serializeScores();
    f.scoreboardReason = 'final';
    return f;
  }

  const SERIALIZERS = {
    lobby: serializeLobby,
    question: serializeQuestion,
    grouping: serializeGrouping,
    reveal: serializeReveal,
    scores: serializeScores,
    final: serializeFinal,
  };

  function getDisplayState() {
    const fn = SERIALIZERS[state.phase] || serializeLobby;
    return fn();
  }

  function youFor(playerId) {
    const p = findPlayer(playerId);
    if (!p) return null;
    const revealed = state.phase === 'reveal' || state.phase === 'scores' || state.phase === 'final';
    return {
      id: p.id,
      name: p.name,
      score: p.score,
      answered: answers.has(p.id),
      myGroupId: revealed ? p.groupId : null,
      scoredThisRound: revealed ? p.scoredThisRound : false,
      // Carried on every frame so a reconnecting phone knows whether to reopen
      // the picker or go straight back to the lobby.
      look: p.look ? { ...p.look } : null,
      locked: p.locked,
    };
  }

  /** Display frame + the player's own private summary. Still never leaks others' text. */
  function getPlayerState(playerId) {
    const frame = getDisplayState();
    frame.you = youFor(playerId);
    return frame;
  }

  /* ---------------------------------------------------------------- emitter */

  /**
   * Hands the transport a per-connection frame builder: hosts get the display
   * state, players get their own state, and anything not yet identified gets a
   * falsy return so it is skipped.
   */
  function emit() {
    if (disposed || !broadcastFn) return;
    try {
      broadcastFn(room, (conn) => {
        if (!conn) return null;
        if (conn.kind === 'host') return { t: 'state', ...getDisplayState() };
        if (conn.kind === 'player' && conn.playerId) {
          return { t: 'state', ...getPlayerState(conn.playerId) };
        }
        return null;
      });
    } catch {
      /* a broken transport must never stall the state machine */
    }
  }

  /** One frame to one connection, using the same transport primitive as emit(). */
  function sendTo(conn, frame, roomCode = room) {
    if (!broadcastFn || !conn || !frame) return;
    try {
      broadcastFn(roomCode, (c) => (c === conn ? frame : null));
    } catch {
      /* a broken transport must never stall the state machine */
    }
  }

  function sendResultError(conn, result, roomCode = room) {
    sendTo(
      conn,
      { t: 'error', code: result.error, message: result.message ?? result.error },
      roomCode,
    );
  }

  /**
   * Pushes the taken-look set to every phone in the room. Advisory only — it
   * lets a picker grey out combinations, but two phones can still confirm the
   * same pair in the same instant, so setLook stays the authority that rejects.
   * Displays never pick, so they are not sent it.
   */
  function broadcastLookTaken() {
    if (disposed || !broadcastFn) return;
    const frame = { t: 'look.taken', taken: lookTaken() };
    try {
      broadcastFn(room, (c) => (c && c.kind === 'player' ? frame : null));
    } catch {
      /* a broken transport must never stall the state machine */
    }
  }

  /* ---------------------------------------------------------------- players */

  function findPlayer(playerId) {
    return players.find((p) => p.id === playerId) || null;
  }

  /** The flock: everyone who has confirmed a look. */
  function lockedPlayers() {
    return players.filter((p) => p.locked);
  }

  /** Joined, named, still in the picker. */
  function choosingCount() {
    return players.reduce((n, p) => n + (p.locked ? 0 : 1), 0);
  }

  /**
   * Look keys spoken for, optionally ignoring one player's own.
   *
   * Derived on demand rather than kept as a stored Set: a look can change, a
   * player can be dropped at start, disconnect, or be wiped by initLobby, and a
   * cached set that missed any one of those would lock a perfectly free sheep
   * out of the picker for the rest of the party.
   */
  function takenLooks(exceptPlayerId = null) {
    const keys = new Set();
    for (const p of players) {
      if (!p.locked || p.id === exceptPlayerId) continue;
      const key = lookKey(p.look);
      if (key) keys.add(key);
    }
    return keys;
  }

  /** The taken set as wire-shaped `colorId/hatId` strings. */
  function lookTaken() {
    return [...takenLooks()];
  }

  /**
   * Confirm or change a look. Accepting one is what puts a player in the flock.
   *
   * Uniqueness is on the PAIR, and the sender's own current look is excluded
   * from the taken set: re-confirming what they already wear, or changing only
   * the hat, must not collide with themselves.
   */
  function setLook(playerId, rawLook) {
    if (disposed) return { error: 'ROOM_NOT_FOUND', message: 'That room is gone.' };
    const p = findPlayer(playerId);
    if (!p) return { error: 'BAD_REQUEST', message: 'Unknown player.' };
    // Lobby only. Mid-round the display is already drawing this sheep, and the
    // flock a question was asked of must not change shape underneath it.
    if (state.phase !== 'lobby') {
      return { error: 'GAME_STARTED', message: 'That game has already started.' };
    }

    // look.js owns which ids exist and the wording when they do not.
    const checked = validateLook(rawLook);
    if (checked.error) return checked;

    if (takenLooks(p.id).has(lookKey(checked.look))) {
      return { error: 'LOOK_TAKEN', message: 'Someone in the paddock is already that sheep.' };
    }

    p.look = checked.look;
    p.locked = true; // a locked player may change their look, never un-lock
    emit();
    return { ok: true, look: { ...p.look } };
  }

  /**
   * Drops a player and every trace of them from the round collections.
   *
   * Only start() calls this, and only from the lobby where answers/groups/
   * noAnswer are already empty — but leaving a dangling entry behind would put
   * a player nobody can find into a paddock at the reveal, so it scrubs all
   * three regardless of when it is called.
   */
  function removePlayer(playerId) {
    const index = players.findIndex((p) => p.id === playerId);
    if (index === -1) return false;
    players.splice(index, 1);
    answers.delete(playerId);
    noAnswer = noAnswer.filter((n) => n.playerId !== playerId);
    for (const g of groups) g.answers = g.answers.filter((a) => a.playerId !== playerId);
    groups = groups.filter((g) => g.answers.length > 0);
    return true;
  }

  function nameTaken(name) {
    const key = name.toLowerCase();
    return players.some((p) => p.name.toLowerCase() === key);
  }

  function addPlayer(rawName) {
    if (disposed) return { error: 'ROOM_NOT_FOUND', message: 'That room is gone.' };
    if (state.phase !== 'lobby') {
      return { error: 'GAME_STARTED', message: 'That game has already started.' };
    }
    const name = String(rawName ?? '').trim().slice(0, MAX_NAME_CHARS);
    if (!name) return { error: 'BAD_REQUEST', message: 'Pick a name first.' };
    if (players.length >= MAX_PLAYERS) {
      return { error: 'ROOM_FULL', message: 'That room is full.' };
    }
    if (nameTaken(name)) return { error: 'NAME_TAKEN', message: 'Someone already took that name.' };

    const player = {
      id: makePlayerId(),
      name,
      score: 0,
      connected: true,
      groupId: null,
      scoredThisRound: false,
      // Joining reserves the name only. Until setLook accepts a pair this
      // player is choosing, not part of the flock.
      look: null,
      locked: false,
    };
    players.push(player);
    emit();
    return { ok: true, playerId: player.id, name: player.name, look: null, locked: false };
  }

  function rejoin(playerId) {
    if (disposed) return { error: 'ROOM_NOT_FOUND', message: 'That room is gone.' };
    const p = findPlayer(playerId);
    if (!p) return { error: 'BAD_REQUEST', message: 'We lost track of you — rejoin with your name.' };
    p.connected = true;
    // A returning player who has not answered must un-arm any pending early end.
    checkAllAnswered();
    emit();
    // The look is server state, so a refreshed phone gets its sheep back rather
    // than being sent through the picker to re-pick a pair it already holds.
    return {
      ok: true,
      playerId: p.id,
      name: p.name,
      look: p.look ? { ...p.look } : null,
      locked: p.locked,
    };
  }

  function disconnect(playerId) {
    const p = findPlayer(playerId);
    if (!p || !p.connected) return { ok: false };
    p.connected = false;
    // Keep the player and their score so a phone refresh can rejoin.
    // A disconnect must never stall the all-answered early end.
    checkAllAnswered();
    emit();
    return { ok: true };
  }

  /* ------------------------------------------------------------ game start */

  function computeScoreboardRounds(totalRounds) {
    // Highest priority last: final > penultimate > third. Dedupes by index, so a
    // scoreboard can never appear twice in a row on tiny round counts.
    const map = new Map();
    const put = (idx, reason) => {
      if (!Number.isInteger(idx) || idx < 0 || idx >= totalRounds) return;
      map.set(idx, reason);
    };
    put(Math.ceil(totalRounds / 3) - 1, 'third');
    put(totalRounds - 2, 'penultimate');
    put(totalRounds - 1, 'final');
    return map;
  }

  function start() {
    if (disposed) return { error: 'ROOM_NOT_FOUND', message: 'That room is gone.' };
    if (state.phase !== 'lobby') {
      return { error: 'GAME_STARTED', message: 'That game has already started.' };
    }
    // Only the flock counts towards the minimum: a room of five where three are
    // still picking is a room of two, and starting it would prove it the hard way.
    if (lockedPlayers().length < LOBBY_MIN_PLAYERS) {
      return { error: 'BAD_REQUEST', message: `Need at least ${LOBBY_MIN_PLAYERS} players.` };
    }
    if (questionPool.length === 0) {
      return { error: 'BAD_REQUEST', message: 'No questions available.' };
    }

    // The gate shuts on anyone still choosing. Giving them a default look would
    // put a sheep on the TV that its owner never chose and cannot recognise, so
    // they are dropped instead; the caller tells them why.
    const notLocked = players.filter((p) => !p.locked).map((p) => p.id);
    for (const playerId of notLocked) removePlayer(playerId);

    chosenQuestions = sampleWithoutRepeats(questionPool, DEFAULT_ROUNDS).map(questionText);
    state.totalRounds = chosenQuestions.length;
    scoreboardRounds = computeScoreboardRounds(state.totalRounds);
    state.roundIndex = 0;
    for (const p of players) {
      p.score = 0;
      p.groupId = null;
      p.scoredThisRound = false;
    }
    beginQuestion();
    return { ok: true, notLocked };
  }

  /* -------------------------------------------------------------- the round */

  function beginQuestion() {
    roundToken += 1;
    clearAllTimers();
    answers.clear();
    groups = [];
    noAnswer = [];
    for (const p of players) {
      p.groupId = null;
      p.scoredThisRound = false;
    }
    state.phase = 'question';
    state.question = chosenQuestions[state.roundIndex] ?? null;
    state.endsAt = Date.now() + ANSWER_MS;
    state.scoreboardReason = null;
    state.groupingSource = null;
    emit();
    setPhaseTimer(closeAnswers, ANSWER_MS);
    // Degenerate case: a room where everybody already left.
    checkAllAnswered();
  }

  function submitAnswer(playerId, rawText) {
    if (disposed) return { error: 'ROOM_NOT_FOUND', message: 'That room is gone.' };
    const p = findPlayer(playerId);
    if (!p) return { error: 'BAD_REQUEST', message: 'Unknown player.' };
    if (state.phase !== 'question') {
      return { error: 'BAD_REQUEST', message: 'Answers are closed.' };
    }
    if (state.endsAt !== null && Date.now() > state.endsAt) {
      return { error: 'BAD_REQUEST', message: 'Answers are closed.' };
    }
    const text = String(rawText ?? '').trim().slice(0, MAX_ANSWER_CHARS);
    if (!text) return { error: 'BAD_REQUEST', message: 'Type something first.' };

    // Overwriting freely before the timer ends is allowed.
    answers.set(p.id, text);
    emit();
    checkAllAnswered();
    return { ok: true };
  }

  function everyConnectedAnswered() {
    const connected = players.filter((p) => p.connected);
    if (connected.length === 0) return false;
    return connected.every((p) => answers.has(p.id));
  }

  /** Arms (or disarms) the 1.5s grace before an early close. */
  function checkAllAnswered() {
    if (disposed || state.phase !== 'question') return;
    if (everyConnectedAnswered()) {
      if (graceTimer) return;
      const token = roundToken;
      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (disposed || token !== roundToken || state.phase !== 'question') return;
        closeAnswers();
      }, GRACE_MS);
    } else {
      clearGraceTimer();
    }
  }

  /* ------------------------------------------------------------- grouping */

  function collectAnswers() {
    const out = [];
    for (const p of players) {
      const text = answers.get(p.id);
      if (typeof text === 'string' && text) {
        out.push({ playerId: p.id, name: p.name, text });
      }
    }
    return out;
  }

  /** Exact-ish text match grouping. Always available, never throws. */
  function fallbackGroups(list) {
    const byKey = new Map();
    for (const a of list) {
      const key = textKey(a.text) || a.text.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(a);
    }
    return [...byKey.values()].map((members, i) => ({
      id: `g${i + 1}`,
      label: members[0].text,
      answers: members,
      scored: false,
    }));
  }

  /**
   * Normalize whatever the grouper returned into the wire shape, defensively.
   * Accepts: Array<group> | {groups:[...]} | {clusters:[...]}
   * Group members may be playerIds, {playerId|id}, or raw answer strings.
   * Any answer the grouper dropped is re-added as its own singleton group so
   * nobody's answer can silently vanish from the reveal.
   *
   * @returns {{groups:Array, matched:number}|null} `matched` = answers the
   *   grouper itself placed (rescued singletons excluded), so the caller can
   *   report groupingSource honestly.
   */
  function normalizeGroups(result, list) {
    const raw = Array.isArray(result)
      ? result
      : Array.isArray(result?.groups)
        ? result.groups
        : Array.isArray(result?.clusters)
          ? result.clusters
          : null;
    if (!raw) return null;

    const byId = new Map(list.map((a) => [a.playerId, a]));
    const byText = new Map();
    for (const a of list) {
      const key = textKey(a.text);
      if (!byText.has(key)) byText.set(key, []);
      byText.get(key).push(a);
    }
    const used = new Set();

    const take = (member) => {
      if (member == null) return null;
      if (typeof member === 'object') {
        const id = member.playerId ?? member.id;
        if (typeof id === 'string' && byId.has(id) && !used.has(id)) {
          used.add(id);
          return byId.get(id);
        }
        if (typeof member.text === 'string') return take(member.text);
        return null;
      }
      const s = String(member);
      if (byId.has(s) && !used.has(s)) {
        used.add(s);
        return byId.get(s);
      }
      const bucket = byText.get(textKey(s));
      if (bucket) {
        const hit = bucket.find((a) => !used.has(a.playerId));
        if (hit) {
          used.add(hit.playerId);
          return hit;
        }
      }
      return null;
    };

    const out = [];
    for (const g of raw) {
      const rawMembers =
        (Array.isArray(g?.answers) && g.answers) ||
        (Array.isArray(g?.members) && g.members) ||
        (Array.isArray(g?.items) && g.items) ||
        (Array.isArray(g?.playerIds) && g.playerIds) ||
        (Array.isArray(g?.ids) && g.ids) ||
        (Array.isArray(g?.texts) && g.texts) ||
        [];
      const members = [];
      for (const m of rawMembers) {
        const hit = take(m);
        if (hit) members.push(hit);
      }
      if (members.length === 0) continue;
      const label = [g?.label, g?.name, g?.title, g?.summary].find(
        (v) => typeof v === 'string' && v.trim(),
      );
      out.push({
        id: `g${out.length + 1}`,
        label: (label || members[0].text).trim().slice(0, 60),
        answers: members,
        scored: false,
      });
    }

    const matched = used.size;

    // Rescue anything the grouper forgot.
    for (const a of list) {
      if (used.has(a.playerId)) continue;
      used.add(a.playerId);
      out.push({
        id: `g${out.length + 1}`,
        label: a.text,
        answers: [a],
        scored: false,
      });
    }

    return out.length ? { groups: out, matched } : null;
  }

  async function enterGrouping() {
    const token = roundToken;
    clearAllTimers();
    state.phase = 'grouping';
    state.endsAt = null;
    state.groupingSource = null;
    state.scoreboardReason = null;
    emit(); // display covers the latency from here

    const list = collectAnswers();

    if (list.length === 0) {
      groups = [];
      state.groupingSource = null;
      finishRound(token);
      return;
    }

    let built = null;
    let source = 'fallback';
    if (groupAnswers) {
      try {
        const result = await timeoutRace(
          Promise.resolve().then(() => groupAnswers(state.question, list.map((a) => ({ ...a })))),
          GROUPING_TIMEOUT_MS,
        );
        if (disposed || token !== roundToken) return; // stale round, drop it
        const normalized = normalizeGroups(result, list);
        // A response that placed none of the real answers is not a grouping.
        if (normalized && normalized.matched > 0) {
          built = normalized.groups;
          const declared = result && typeof result === 'object' ? result.source : null;
          source = declared === 'fallback' ? 'fallback' : 'claude';
        }
      } catch {
        if (disposed || token !== roundToken) return;
        built = null;
      }
    }

    if (disposed || token !== roundToken) return;

    if (!built) {
      built = fallbackGroups(list);
      source = 'fallback';
    }

    groups = built;
    state.groupingSource = source;
    finishRound(token);
  }

  function closeAnswers() {
    if (disposed || state.phase !== 'question') return;
    clearAllTimers();
    state.endsAt = null;
    // enterGrouping is async; its rejection path is handled internally.
    void enterGrouping();
  }

  /* --------------------------------------------------------------- scoring */

  function scoreRound() {
    const answered = new Set();
    for (const g of groups) for (const a of g.answers) answered.add(a.playerId);

    let max = 0;
    for (const g of groups) if (g.answers.length > max) max = g.answers.length;

    for (const g of groups) {
      // EVERY group tied at the max size scores. One lone answer is still the
      // majority and still scores. Zero answers => no groups => nobody scores.
      g.scored = max > 0 && g.answers.length === max;
      for (const a of g.answers) {
        const p = findPlayer(a.playerId);
        if (!p) continue;
        p.groupId = g.id;
        p.scoredThisRound = g.scored;
        if (g.scored) p.score += 1;
      }
    }

    // Groups sorted largest-first; ties keep grouper order.
    groups.sort((a, b) => b.answers.length - a.answers.length);

    noAnswer = players
      .filter((p) => !answered.has(p.id))
      .map((p) => ({ playerId: p.id, name: p.name }));
  }

  /* ------------------------------------------------- reveal / scores / next */

  function finishRound(token) {
    if (disposed || token !== roundToken) return;
    scoreRound();
    state.phase = 'reveal';
    state.endsAt = null;
    state.scoreboardReason = null;
    emit();
    setPhaseTimer(afterReveal, REVEAL_MS);
  }

  function afterReveal() {
    if (disposed) return;
    const isLast = state.roundIndex >= state.totalRounds - 1;
    if (isLast) {
      state.phase = 'final';
      state.scoreboardReason = 'final';
      clearAllTimers();
      emit();
      return;
    }
    const reason = scoreboardRounds.get(state.roundIndex);
    if (reason && reason !== 'final') {
      state.phase = 'scores';
      state.scoreboardReason = reason;
      emit();
      setPhaseTimer(nextRound, SCORES_MS);
      return;
    }
    nextRound();
  }

  function nextRound() {
    if (disposed) return;
    state.roundIndex += 1;
    if (state.roundIndex >= state.totalRounds) {
      state.roundIndex = state.totalRounds - 1;
      state.phase = 'final';
      state.scoreboardReason = 'final';
      clearAllTimers();
      emit();
      return;
    }
    beginQuestion();
  }

  /* -------------------------------------------------------------- teardown */

  function dispose() {
    disposed = true;
    roundToken += 1;
    clearAllTimers();
    answers.clear();
    groups = [];
    noAnswer = [];
  }

  /* --------------------------------------------------- transport adapter */

  /**
   * server.js owns sockets and the room registry; this section owns the frame
   * vocabulary. One instance hosts one room at a time: 'host.create' (re)binds
   * this machine to the code the transport just registered and resets to lobby.
   */

  /** @type {Set<object>} connection handles currently held open by the transport. */
  const connections = new Set();

  function addConnection(conn) {
    if (!conn) return;
    connections.add(conn);
  }

  function removeConnection(conn) {
    if (!conn) return;
    connections.delete(conn);
    if (conn.kind !== 'player' || !conn.playerId) return;
    // A phone that opened a second socket is still present — only the last one
    // leaving counts as a disconnect.
    for (const other of connections) {
      if (other.kind === 'player' && other.playerId === conn.playerId) return;
    }
    disconnect(conn.playerId);
  }

  function initLobby(roomCode) {
    if (disposed) return { error: 'ROOM_NOT_FOUND', message: 'That room is gone.' };
    roundToken += 1;
    clearAllTimers();
    players.length = 0;
    answers.clear();
    groups = [];
    noAnswer = [];
    chosenQuestions = [];
    scoreboardRounds = new Map();
    state.phase = 'lobby';
    state.roundIndex = 0;
    state.totalRounds = 0;
    state.question = null;
    state.endsAt = null;
    state.scoreboardReason = null;
    state.groupingSource = null;
    if (typeof roomCode === 'string' && roomCode.trim()) room = roomCode.trim().toUpperCase();
    emit();
    // Every player just ceased to exist, so every look is free again. Any phone
    // still holding the old list would grey out sheep nobody owns.
    broadcastLookTaken();
    return { ok: true, room };
  }

  /** The room code a join/rejoin frame is aimed at, or null if it is elsewhere. */
  function targetRoom(msg) {
    if (typeof msg.room !== 'string' || !msg.room.trim()) return room;
    const code = msg.room.trim().toUpperCase();
    return code === room ? room : null;
  }

  function handleMessage(conn, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
      sendTo(conn, {
        t: 'error',
        code: 'BAD_REQUEST',
        message: 'Frame must be an object with a string "t".',
      });
      return undefined;
    }

    switch (msg.t) {
      case 'host.create': {
        conn.kind = 'host';
        const result = initLobby(msg.room);
        if (result.error) sendResultError(conn, result, msg.room);
        return undefined;
      }

      // A display whose socket dropped mid-party re-attaches to the SAME room.
      // Unlike host.create this must not touch state: initLobby() would wipe
      // every player and score, so a host reconnect would silently end the game.
      case 'host.resume': {
        conn.kind = 'host';
        sendTo(conn, { t: 'state', ...getDisplayState() });
        return undefined;
      }

      case 'host.start': {
        const result = start();
        if (result.error) {
          sendResultError(conn, result);
          return undefined;
        }
        // start() has already dropped them, so this is the last frame their
        // socket will get that makes any sense of it.
        for (const playerId of result.notLocked ?? []) {
          for (const other of connections) {
            if (other.kind !== 'player' || other.playerId !== playerId) continue;
            sendTo(other, {
              t: 'error',
              code: 'NOT_LOCKED',
              message: 'The gate shut while you were still choosing.',
            });
          }
        }
        return undefined;
      }

      case 'player.look': {
        if (!conn.playerId) {
          sendTo(conn, { t: 'error', code: 'BAD_REQUEST', message: 'Join the room first.' });
          return undefined;
        }
        // The pair travels inline on the frame; a nested `look` object is
        // accepted too so the picker cannot fail on shape alone.
        const wanted = msg.look && typeof msg.look === 'object' ? msg.look : msg;
        const result = setLook(conn.playerId, wanted);
        if (result.error) {
          sendResultError(conn, result);
          return undefined;
        }
        sendTo(conn, { t: 'look.ok', look: result.look });
        // One pair just left the pool: every other picker in the room needs to
        // grey it out before someone reaches for it.
        broadcastLookTaken();
        return undefined;
      }

      case 'player.join':
      case 'player.rejoin': {
        const code = targetRoom(msg);
        if (!code) {
          sendTo(
            conn,
            { t: 'error', code: 'ROOM_NOT_FOUND', message: 'That room is gone.' },
            msg.room,
          );
          return undefined;
        }
        const result =
          msg.t === 'player.join'
            ? addPlayer(msg.name)
            : rejoin(typeof msg.playerId === 'string' ? msg.playerId : conn.playerId);
        if (result.error) {
          sendResultError(conn, result);
          return undefined;
        }
        conn.kind = 'player';
        conn.playerId = result.playerId;
        sendTo(conn, {
          t: 'joined',
          room,
          playerId: result.playerId,
          name: result.name,
          // Null and false on a fresh join; a rejoin carries the sheep back so
          // the phone can skip the picker it already finished.
          look: result.look ?? null,
          locked: result.locked === true,
        });
        // addPlayer/rejoin already emitted, but this socket was still untagged
        // then, so it was skipped. Emit again now that it has an identity.
        emit();
        // Nothing changed for the room, but this phone has never seen the list
        // and is about to open a picker with it.
        sendTo(conn, { t: 'look.taken', taken: lookTaken() });
        return undefined;
      }

      case 'player.answer': {
        if (!conn.playerId) {
          sendTo(conn, { t: 'error', code: 'BAD_REQUEST', message: 'Join the room first.' });
          return undefined;
        }
        const result = submitAnswer(conn.playerId, msg.text);
        if (result.error) sendResultError(conn, result);
        return undefined;
      }

      default:
        sendTo(conn, {
          t: 'error',
          code: 'BAD_REQUEST',
          message: `Unknown frame "${msg.t}".`,
        });
        return undefined;
    }
  }

  /* ------------------------------------------------------------ public API */

  const game = {
    config,

    /** Getter, not a snapshot: 'host.create' rebinds the active room code. */
    get room() {
      return room;
    },
    get phase() {
      return state.phase;
    },
    get roundIndex() {
      return state.roundIndex;
    },
    get totalRounds() {
      return state.totalRounds;
    },
    /** Everyone in the room, locked or still picking — what MAX_PLAYERS caps. */
    get playerCount() {
      return players.length;
    },
    /** The flock — what LOBBY_MIN_PLAYERS gates on. */
    get lockedCount() {
      return lockedPlayers().length;
    },
    get choosingCount() {
      return choosingCount();
    },
    get connectedCount() {
      return players.filter((p) => p.connected).length;
    },
    get isJoinable() {
      return !disposed && state.phase === 'lobby' && players.length < MAX_PLAYERS;
    },
    get isDisposed() {
      return disposed;
    },
    get canStart() {
      return !disposed && state.phase === 'lobby' && lockedPlayers().length >= LOBBY_MIN_PLAYERS;
    },
    /** 0-based round indices that trigger a scoreboard -> reason. */
    get scoreboardRounds() {
      return new Map(scoreboardRounds);
    },

    // Transport-facing surface used by server.js.
    addConnection,
    removeConnection,
    handleMessage,

    addPlayer,
    rejoin,
    disconnect,
    hasPlayer: (playerId) => !!findPlayer(playerId),
    getPlayer: (playerId) => {
      const p = findPlayer(playerId);
      return p
        ? {
            id: p.id,
            name: p.name,
            score: p.score,
            connected: p.connected,
            look: p.look ? { ...p.look } : null,
            locked: p.locked,
          }
        : null;
    },
    setLook,
    lookTaken,
    start,
    submitAnswer,
    getDisplayState,
    getPlayerState,
    dispose,
  };

  return game;
}

export default createGame;
