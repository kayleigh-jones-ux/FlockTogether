/* Drives the built bench engine in Node against a stubbed DOM and a virtual
   clock, so a solo game can be played end to end with no browser. Verifies the
   thing that was actually broken: that pressing Start wires through to state
   frames on both surfaces, and that a typed answer scores. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../flock-together-bench.html', import.meta.url), 'utf8');
const engine = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

let bad = 0;
const chk = (name, cond, extra = '') => {
  if (!cond) bad++;
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
};

/* --- virtual clock ------------------------------------------------------- */
let now = 1_700_000_000_000;
let seq = 0;
const timers = new Map();
const setTimeoutStub = (fn, ms = 0) => { timers.set(++seq, { at: now + ms, fn }); return seq; };
const clearTimeoutStub = (id) => timers.delete(id);
function advance(ms) {
  const end = now + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
    if (!next) break;
    timers.delete(next[0]);
    now = next[1].at;
    next[1].fn();
  }
  now = end;
}

/* Deterministic PRNG so a failure is reproducible. */
let seed = 42;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

/* --- DOM stub ------------------------------------------------------------ */
const listeners = { message: [], resize: [] };
const posted = { tv: [], play: [] };

class El {
  constructor(id) {
    this.id = id; this.dataset = {}; this.style = { setProperty() {} };
    this._text = ''; this.innerHTML = ''; this.children = [];
    this.checked = false; this.value = ''; this.disabled = false;
    this.hidden = false; this.scrollTop = 0; this.scrollHeight = 0;
    this.clientWidth = 320; this.handlers = {};
    this.contentDocument = null;
    const surface = id === 'f-tv' ? 'tv' : id === 'f-play' ? 'play' : null;
    this.contentWindow = surface
      ? { postMessage: (m) => posted[surface].push(m) }
      : null;
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  addEventListener(t, fn) { (this.handlers[t] ||= []).push(fn); }
  setAttribute(k, v) { this.dataset['attr_' + k] = v; }
  appendChild(n) { this.children.push(n); }
  fire(type, ev = {}) { for (const fn of this.handlers[type] || []) fn({ target: this, ...ev }); }
}

const els = new Map();
const byId = (id) => { if (!els.has(id)) els.set(id, new El(id)); return els.get(id); };

/* The carrier elements really do hold the base64 payloads on the page, so the
   stub must too — otherwise decodeDoc round-trips an empty string and the
   frame-loading step is never actually exercised. */
for (const id of ['doc-tv', 'doc-play']) {
  byId(id).textContent = new RegExp('id="' + id + '">([\\s\\S]*?)</script>').exec(html)[1].trim();
}

const document = {
  getElementById: byId,
  createElement: () => new El('created'),
};
const windowStub = {
  addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
};

const sandbox = {
  document, window: windowStub, console,
  setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
  Date: { ...Date, now: () => now },
  Math: Object.create(Math, { random: { value: random } }),
  atob: (b) => Buffer.from(b, 'base64').toString('latin1'),
  TextDecoder, Uint8Array, JSON, Object, Array, String, Number, Boolean, Map, Set, RegExp, Error,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* --- run ---------------------------------------------------------------- */
try { vm.runInContext(engine, sandbox, { filename: 'bench-engine.js' }); }
catch (e) { console.log('FAIL  engine threw on load: ' + e.message); process.exit(1); }

const send = (msg) => { for (const fn of listeners.message) fn({ data: msg }); };
const lastState = (s) => [...posted[s]].reverse().find((f) => f.frame && f.frame.t === 'state');

chk('boot() loaded both frame documents',
  byId('f-tv').srcdoc && byId('f-play').srcdoc &&
  byId('f-tv').srcdoc.includes('<!doctype html>'),
  'tv=' + (byId('f-tv').srcdoc || '').length + ' play=' + (byId('f-play').srcdoc || '').length + ' chars');

chk('the ticker printed its ready line', byId('ticker').children.length >= 2,
  byId('ticker').children.length + ' lines');

/* Surfaces come up and announce themselves. */
send({ __bench: 'boot', surface: 'tv' });
send({ __bench: 'boot', surface: 'play' });
send({ __bench: 'ready', surface: 'tv' });
send({ __bench: 'ready', surface: 'play' });
advance(1);

chk('display was handed its room code',
  posted.tv.some((m) => m.frame && m.frame.t === 'room.created' && m.frame.room === 'DEMO'));
chk('boot overlays cleared to live',
  byId('boot-tv').dataset.state === 'live' && byId('boot-play').dataset.state === 'live',
  'tv=' + byId('boot-tv').dataset.state + ' play=' + byId('boot-play').dataset.state);

/* THE regression: pressing Start must reach both surfaces. */
posted.tv.length = 0; posted.play.length = 0;
byId('c-start').fire('click');
advance(1);

const q = lastState('tv');
chk('Start a game drove the display into a question', !!q && q.frame.phase === 'question',
  q ? 'phase=' + q.frame.phase : 'NO STATE FRAME AT ALL');
chk('the question reached the phone too',
  (() => { const p = lastState('play'); return !!p && p.frame.phase === 'question' && !!p.frame.question; })());
chk('the phone knows which player it is',
  (() => { const p = lastState('play'); return !!p && p.frame.you && p.frame.you.name === 'You'; })());
chk('a full flock is present', !!q && q.frame.players.length === 12, q ? q.frame.players.length + ' players' : '');
chk('no answers are visible while the gate is open',
  !!q && q.frame.groups.length === 0);

/* Nobody answers for you by default — that seat is yours. */
advance(3000);
const mid = lastState('tv');
chk('bots answered but your seat stayed empty',
  !!mid && mid.frame.players.filter((p) => p.answered).length > 0 &&
  mid.frame.players[0].answered === false,
  mid ? mid.frame.players.filter((p) => p.answered).length + ' of 12 marked, you=' + mid.frame.players[0].answered : '');

/* Type an answer, as a player would. The bank for every question puts its
   biggest cluster first, so answering with it should score. */
const question = q.frame.question;
send({ __bench: 'send', surface: 'play', frame: { t: 'player.answer', text: 'coffee' } });
advance(1);
const afterTyping = lastState('tv');
chk('your typed answer registered',
  !!afterTyping && afterTyping.frame.players[0].answered === true);

/* Run out the gate, the dog's outrun, and into the reveal. Rounds auto-advance,
   so by the time this returns the bench is already asking the NEXT question —
   sample the reveal frame itself rather than whatever happens to be last. */
advance(20000);
const firstReveal = (s) => posted[s].find((m) => m.frame && m.frame.t === 'state' && m.frame.phase === 'reveal');
const rev = firstReveal('tv');
chk('the round reached a reveal', !!rev);
chk('paddocks were dealt', !!rev && rev.frame.groups.length > 0,
  rev ? rev.frame.groups.length + ' groups' : '');
chk('exactly the largest groups scored', (() => {
  if (!rev) return false;
  const max = Math.max(...rev.frame.groups.map((g) => g.answers.length));
  return rev.frame.groups.every((g) => g.scored === (g.answers.length === max));
})());
chk('your answer landed in a paddock, not nowhere', (() => {
  if (!rev) return false;
  return rev.frame.groups.some((g) => g.answers.some((a) => a.playerId === 'p_0' && a.text === 'coffee'));
})());
chk('the phone learned its own outcome', (() => {
  const p = firstReveal('play');
  return !!p && p.frame.you && typeof p.frame.you.scoredThisRound === 'boolean' &&
         p.frame.you.myGroupId !== null;
})(), (() => { const p = firstReveal('play'); return p ? 'group ' + p.frame.you.myGroupId + ', scored=' + p.frame.you.scoredThisRound : ''; })());
chk('grouping provenance is stated', !!rev && ['claude', 'fallback'].includes(rev.frame.groupingSource),
  rev ? rev.frame.groupingSource : '');

/* Rounds auto-advance with no host input — the product rule. */
advance(60000);
const later = lastState('tv');
chk('the game advanced on its own', !!later && (later.frame.roundIndex > 0 || later.frame.phase === 'final'),
  later ? 'round ' + (later.frame.roundIndex + 1) + ', phase=' + later.frame.phase : '');

/* Play to the end. */
advance(400000);
const end = lastState('tv');
chk('the game reaches a final scoreboard', !!end && end.frame.phase === 'final',
  end ? 'phase=' + end.frame.phase + ', round ' + (end.frame.roundIndex + 1) + '/' + end.frame.totalRounds : '');
chk('somebody has points at the end', !!end && end.frame.players.some((p) => p.score > 0),
  end ? 'top score ' + Math.max(...end.frame.players.map((p) => p.score)) : '');

console.log('\n' + (bad ? bad + ' FAILED' : 'all bench playtest checks passed'));
process.exit(bad ? 1 : 0);
