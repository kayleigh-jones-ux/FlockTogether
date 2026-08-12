/* ==========================================================================
   FLOCK TOGETHER — THE PHONE CONTROLLER
   The player is one sheep in the flock. This surface carries one decision.

   Everything it knows arrives as { t:'state', … } frames; it never guesses at
   game state and never invents a fact the frame does not carry (a placing, a
   group, someone else's answer). Answer text for other players simply is not
   here during 'question', so no code path can leak it.
   ========================================================================== */

import { connect, loadSprites, countdown } from '/shared/net.js';
import { raddleFor } from '/shared/raddle.js';
import {
  FLEECE_COLOURS,
  HATS,
  HAT_OPTIONS,
  colourById,
  hatById,
  colourToken,
  isBareHead,
  lookKey,
  validateLook,
} from '/shared/look.js';
import { placementFor } from '/shared/hat-placement.js';
import { loadArt, paintSheepArt, headroomFor, DEFAULT_POSE } from '/shared/sheep-art.js';

/* ------------------------------------------------------------------ scaffolding */

const $ = (id) => document.getElementById(id);
const show = (el, on) => { if (el) el.hidden = !on; };
const setText = (el, value) => { if (el && el.textContent !== value) el.textContent = value; };

const el = {
  body: document.body,
  wire: $('wire'),
  brand: $('brand'),
  pageH: $('page-h'),
  tag: $('tag'),
  tagName: $('tag-name'),
  tagBigName: $('tag-big-name'),
  round: $('round'),
  roundI: $('round-i'),
  roundN: $('round-n'),

  joinForm: $('join-form'),
  room: $('room'),
  fieldRoom: $('field-room'),
  knownRoom: $('known-room'),
  knownCode: $('known-code'),
  changeRoom: $('change-room'),
  name: $('name'),
  joinError: $('join-error'),
  joinGo: $('join-go'),

  lookSheep: $('look-sheep'),
  lookName: $('look-name'),
  colourGrid: $('colour-grid'),
  hatGrid: $('hat-grid'),
  lookScroll: $('look-scroll'),
  tabColour: $('tab-colour'),
  tabHat: $('tab-hat'),
  panelColour: $('panel-colour'),
  panelHat: $('panel-hat'),
  lookNote: $('look-note'),
  lookGo: $('look-go'),
  lookBack: $('look-back'),
  lookReopen: $('look-reopen'),

  flockCount: $('flock-count'),
  choosingNote: $('choosing-note'),
  lobbySheep: $('lobby-sheep'),
  hostBadge: $('host-badge'),
  lobbyNote: $('lobby-note'),
  lobbyGo: $('lobby-go'),

  question: $('question'),
  sheep: $('sheep'),
  clock: $('clock'),
  clockLabel: $('clock-label'),
  flank: $('flank'),
  answerForm: $('answer-form'),
  answer: $('answer'),
  lockNote: $('lock-note'),
  send: $('send'),
  locked: $('locked'),
  lockedText: $('locked-text'),
  changeAnswer: $('change-answer'),

  saidGrouping: $('said-grouping'),
  saidGroupingText: $('said-grouping-text'),

  rosette: $('rosette'),
  verdictHead: $('verdict-head'),
  verdictSub: $('verdict-sub'),
  groupCard: $('group-card'),
  groupLabel: $('group-label'),
  groupCount: $('group-count'),
  revealScore: $('reveal-score'),
  revealNote: $('reveal-note'),
  revealGo: $('reveal-go'),

  rosetteFinal: $('rosette-final'),
  scoreSheep: $('score-sheep'),
  bigScore: $('big-score'),
  flame: $('flame'),
  scoreUnit: $('score-unit'),
  standing: $('standing'),
  above: $('above'),
  aboveSheep: $('above-sheep'),
  aboveLead: $('above-lead'),
  aboveLine: $('above-line'),
  scoresSub: $('scores-sub'),
  scoresNote: $('scores-note'),
  scoresGo: $('scores-go'),
  rematch: $('rematch'),
  againGo: $('again-go'),
  newgameGo: $('newgame-go'),
};

const screens = {
  join: $('screen-join'),
  look: $('screen-look'),
  lobby: $('screen-lobby'),
  question: $('screen-question'),
  grouping: $('screen-grouping'),
  reveal: $('screen-reveal'),
  scores: $('screen-scores'),
};

const KEY_ID = 'flock.player';
const KEY_ANSWER = 'flock.answer';
const ROOM_LEN = 4;
const NAME_MAX = 14;
const ANSWER_MAX = 80;
const URGENT_AT = 10;
const HANDSHAKE_MS = 6000;

/* localStorage throws in some private-browsing modes. It is a convenience,
   never a dependency — every failure degrades to "ask them again". */
const store = {
  read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* fine */ }
  },
  drop(key) {
    try { localStorage.removeItem(key); } catch { /* fine */ }
  },
};

/* ------------------------------------------------------------------ local state */

/* Who this phone is. The playerId is public — it rides in players[] on every
   state frame the room sends, so anyone who can see a frame can name it and it
   proves nothing on its own. The token is the half the server minted for us and
   sent down our socket alone, and it is the only thing a rejoin can be believed
   on. The two travel together everywhere, including onto disk. */
const me = { playerId: null, token: '', room: '', name: '', look: null };

/* Which paddock the live socket is actually attached to, and the join waiting
   to go down the next one. Distinct from me.room: me.room is the room we intend
   to be in, socketRoom is the one the transport has already committed to, and
   the gap between them is precisely when a reconnect is required. */
let socketRoom = '';
let pendingJoin = null;

let net = null;
let joinState = 'idle';       // idle | rejoining | joining | in
let state = null;             // the last 'state' frame
let handshakeTimer = null;
let currentScreen = null;     // the screen setScreen() last switched to

/* --- the look ---
   `me.look` is what the SERVER holds for us; `draft` is what the picker is
   showing. They are the same until a chip is touched, and the server's answer
   always replaces ours. */
let draft = null;             // { colorId, hatId } on screen right now
let draftDirty = false;       // they have touched the picker since it opened
let taken = new Set();        // 'colorId/hatId' keys, from look.taken
let pickerOpen = false;       // reopened from the lobby by a locked player
let lookPending = false;      // a player.look is in flight
/* The pair we actually SENT, kept because `draft` is not a record of it.
   A rejection has to poison the pair the server refused, and by the time it
   arrives the draft has usually moved off that pair — the taken-frame handler
   moves it, and nothing stops the player tapping chips while a send is in
   flight. Marking `draft` instead struck out a pair that was free, for the rest
   of the session. */
let lookSent = null;
let lockedLocal = false;      // look.ok seen; the next state frame overrules it
let lookAckTimer = null;
let scrollToPick = false;     // bring their current chip into view once

let roundKey = null;          // roundIndex the question screen is set up for
let lastPhase = null;         // the phase the last render drew
let clockFor = null;          // endsAt the countdown is running against
let stopClock = null;
let urgent = false;
let gateShut = false;
let submitted = false;        // the slate is showing a locked-in answer
let answerOnFile = false;     // the SERVER holds an answer for us this round
let myAnswer = '';            // the text we last successfully sent
let pendingSubmit = false;
let submitAckTimer = null;    // bounds the wait for an ack that cannot arrive
/* What was true before the in-flight submit, so a rejected answer can be
   rolled back instead of leaving us claiming an answer the server refused. */
let beforeSubmit = { onFile: false, text: '' };
/* Set once the slate has been reconciled against the server for this round.
   Without it, an unrelated state frame (someone else joining) would land in
   the middle of the player retyping and wipe what they were typing. */
let reconciled = false;

let remembered = false;       // identity already written to localStorage
let everOpen = false;
let offlineTimer = null;

/* ------------------------------------------------------------------ copy */

const JOIN_ERRORS = {
  ROOM_NOT_FOUND: 'No paddock with that code — check the four characters on the big screen and try again.',
  ROOM_FULL: 'That paddock is full. Ask the host to start a fresh game.',
  NAME_TAKEN: 'Someone in there already answers to that. Add an initial and throw the latch again.',
  GAME_STARTED: 'That game is already running. You can join the next one — the big screen will say when.',
  BAD_REQUEST: 'That did not scan. Check the code and your name, then throw the latch again.',
};

/* The picker's own rejections. The server's own wording wins where it sends
   one (validateLook's message is written for the player); this is the floor,
   and LOOK_FIX is the part that says what to do about it. */
const LOOK_ERRORS = {
  LOOK_TAKEN: 'Someone in the paddock is already that sheep.',
  BAD_LOOK: 'That colour or hat is not one of ours.',
  GAME_STARTED: 'The game has already started.',
};

const LOOK_FIX = {
  LOOK_TAKEN: ' Change the colour or the hat.',
  BAD_LOOK: ' Pick another and try again.',
  GAME_STARTED: ' That is the sheep you are playing with.',
};

const LOOK_RULE = 'Two of you can share a colour, or share a hat — never both.';

/* One h1 lives in the header for the whole session, because every screen but
   the first is swapped out from under it. */
const SCREEN_TITLES = {
  join: 'Get in the paddock',
  look: 'Make your sheep',
  lobby: 'Waiting in the paddock',
  question: 'The question',
  grouping: 'Sorting the answers',
  reveal: 'How the round went',
  scores: 'Where you stand',
};

function ordinal(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/* ------------------------------------------------------------------ viewport
   iOS shrinks the visual viewport when the keyboard opens but leaves the
   layout viewport alone, which would hide the send lever behind the keys.
   The frame is sized from the visual viewport instead. */

function measureViewport() {
  const vv = window.visualViewport;
  const h = Math.round((vv && vv.height) || window.innerHeight || 0);
  if (h > 0) document.documentElement.style.setProperty('--vh', `${h}px`);
}
measureViewport();
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', measureViewport);
  window.visualViewport.addEventListener('scroll', measureViewport);
}
window.addEventListener('orientationchange', () => setTimeout(measureViewport, 120));

/* ------------------------------------------------------------------ screens */

function setScreen(name) {
  const incoming = screens[name];
  if (!incoming || currentScreen === name) return;

  const outgoing = currentScreen ? screens[currentScreen] : null;
  /* A phase can flip while they are still typing. Marking the outgoing screen
     inert with focus inside it drops that focus to <body>, which strands a
     screen-reader user at the top of the document at the exact moment the
     screen changed under them. Carry the focus across first, to the incoming
     screen, so their reading position lands on what they are now looking at. */
  const carriesFocus = !!outgoing && outgoing.contains(document.activeElement);

  incoming.classList.add('is-on');
  incoming.removeAttribute('inert');
  if (carriesFocus) incoming.focus({ preventScroll: true });

  for (const node of Object.values(screens)) {
    if (node === incoming) continue;
    node.classList.remove('is-on');
    node.setAttribute('inert', '');
  }

  currentScreen = name;
  el.body.dataset.phase = name;
  setText(el.pageH, SCREEN_TITLES[name] || 'Flock Together');
}

/* ------------------------------------------------------------------ identity */

function applyIdentity() {
  if (!me.playerId) return;
  const { cssVar } = raddleFor(me.playerId);
  el.body.style.setProperty('--mark', `var(${cssVar})`);
  setText(el.tagName, me.name);
  setText(el.tagBigName, me.name);
  show(el.tag, true);
  show(el.brand, false);
}

/* Persist just enough to rejoin our own flock after a lock screen or a
   refresh: the id, the token that proves the id is ours, the room, and the
   sheep they made. The look rides in the same record because it is the same
   fact — who this phone is in this room. The token rides in it for that reason
   and one more: an id in one record and its token in another is a pair that can
   come back half-written from a browser that threw on the second write, and a
   playerId with no token beside it is an identity this phone cannot use. */
function writeIdentity() {
  if (!me.playerId || !me.room) return;
  remembered = true;
  store.write(KEY_ID, {
    playerId: me.playerId,
    token: me.token,
    room: me.room,
    name: me.name,
    look: me.look,
  });
}

/* Written once on the way in, not on every frame. */
function rememberIdentity() {
  if (remembered) return;
  writeIdentity();
}

function forgetIdentity() {
  remembered = false;
  me.playerId = null;
  // The token dies with the id it belonged to. Keeping it would leave a secret
  // on this phone for a place in a paddock we are no longer claiming.
  me.token = '';
  me.look = null;
  draft = null;
  draftDirty = false;
  lockedLocal = false;
  pickerOpen = false;
  taken.clear();
  applyLook(null);
  store.drop(KEY_ID);
  store.drop(KEY_ANSWER);
  show(el.tag, false);
  show(el.brand, true);
  show(el.round, false);
}

/* ------------------------------------------------------------------ join form */

function sanitizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_LEN);
}

function setJoinError(message) {
  if (!message) { show(el.joinError, false); return; }
  setText(el.joinError, message);
  show(el.joinError, true);
}

function setJoinBusy(busy, label) {
  el.joinGo.disabled = busy;
  setText(el.joinGo, label || (busy ? 'Opening the gate…' : 'Throw the latch'));
  el.room.readOnly = busy;
  el.name.readOnly = busy;
}

function revealRoomField() {
  show(el.fieldRoom, true);
  show(el.knownRoom, false);
}

function useKnownRoom(code) {
  setText(el.knownCode, code);
  show(el.knownRoom, true);
  show(el.fieldRoom, false);
}

el.changeRoom.addEventListener('click', () => {
  revealRoomField();
  el.room.value = '';
  el.room.focus();
});

el.room.addEventListener('input', () => {
  const clean = sanitizeCode(el.room.value);
  if (el.room.value !== clean) el.room.value = clean;
});

el.joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (joinState === 'joining' || joinState === 'rejoining') return;

  const room = sanitizeCode(el.room.value);
  const name = el.name.value.trim().slice(0, NAME_MAX);

  if (room.length !== ROOM_LEN) {
    revealRoomField();
    setJoinError('The paddock code is four characters — they are on the big screen.');
    el.room.focus();
    return;
  }
  if (!name) {
    setJoinError('Give yourself a name — whatever the room will shout at you.');
    el.name.focus();
    return;
  }

  setJoinError('');
  joinState = 'joining';
  setJoinBusy(true);

  /* A typed code names a paddock the socket is not attached to — it may not be
     attached to anything at all, since a phone that arrived without ?room= has
     nothing to connect to until this moment. Re-open against the right room and
     let identify() carry the join down the new socket; sending it down the old
     one would deliver it to whichever paddock that socket happened to be on. */
  if (room !== socketRoom) {
    me.room = room;
    pendingJoin = { room, name };
    net.reconnect();
    return;
  }

  if (!net || !net.send({ t: 'player.join', room, name })) {
    joinState = 'idle';
    setJoinBusy(false);
    setJoinError('Could not reach the paddock. Check your signal, then throw the latch again.');
    return;
  }

  me.room = room;
  me.name = name;
  clearTimeout(handshakeTimer);
  handshakeTimer = setTimeout(() => {
    if (joinState !== 'joining') return;
    joinState = 'idle';
    setJoinBusy(false);
    setJoinError('No answer from the paddock. Check your signal, then throw the latch again.');
  }, HANDSHAKE_MS);
});

/* ------------------------------------------------------------------ the look
   A fleece colour and a hat, chosen before they are part of the flock. The
   pair is what has to be unique, so a chip is blocked for one of two quite
   different reasons and the picker keeps them apart.

   SPENT is about the option itself: every partner it has is gone, so no move on
   the other half of the pair can rescue it. A colour is spent only once every
   hat against it is taken, and a hat once every colour is — one pair going does
   not grey out a whole colour.

   CLASH is about this pair only: this exact colour-and-hat is already somebody
   in the paddock, and picking a different partner fixes it. Both refuse the
   pick; only the words differ. */

const colourChips = new Map();
const hatChips = new Map();

/* Our own confirmed look is never a clash with itself — the server excludes
   it when we re-send — so the picker must not strike out the sheep we are
   already wearing. */
function isTaken(colorId, hatId) {
  const key = `${colorId}/${hatId}`;
  if (me.look && lookKey(me.look) === key) return false;
  return taken.has(key);
}

/* HAT_OPTIONS, not HATS: bare is a pickable head like any other (see NO_HAT in
   look.js), so a colour is not spent until it is gone with a bare head too.
   Measuring against HATS would have called a colour spent while one pairing of
   it — the bare one — was still free, and struck out a chip that works. */
const colourSpent = (colorId) => HAT_OPTIONS.every((hat) => isTaken(colorId, hat.id));
const hatSpent = (hatId) => FLEECE_COLOURS.every((colour) => isTaken(colour.id, hatId));

/* --- what blocks a chip, asked in ONE place ------------------------------
 *
 * This pair of functions is the whole of the fix for the bug that let a player
 * pick a clash. There used to be two answers to "is this chip available", and
 * they disagreed: the paint asked `isTaken(colour, hat)` and drew a clash chip
 * struck out, while the click handler asked only `colourSpent`/`hatSpent` — so
 * a struck-out chip was still fully live, pick() went through on it, and the
 * player found out at lock-in when the server came back with LOOK_TAKEN. Two
 * codepaths deciding the same thing is what made that possible, so now there is
 * one, and the paint and the refusal both read it.
 *
 * '' means pickable. 'spent' means every partner is gone, so the OTHER half of
 * the pair cannot rescue it. 'clash' means this exact pair is gone and the
 * other half can. Spent is checked first because it is the stronger fact and
 * the way out of it is different.
 */
function colourBlocked(colorId) {
  if (colourSpent(colorId)) return 'spent';
  if (draft && isTaken(colorId, draft.hatId)) return 'clash';
  return '';
}

function hatBlocked(hatId) {
  if (hatSpent(hatId)) return 'spent';
  if (draft && isTaken(draft.colorId, hatId)) return 'clash';
  return '';
}

/* Bare is the one option whose name will not take a "the" in front of it:
   "taken with the Bobble hat" reads, "taken with the No hat" does not. Every
   sentence in the picker that names a hat goes through one of these three so
   the bare head reads like English wherever it turns up. */
const withHat = (hat) => (isBareHead(hat.id) ? 'with no hat' : `with the ${hat.name}`);

const everyColourWith = (hat) =>
  isBareHead(hat.id)
    ? 'Every colour is taken bare-headed.'
    : `Every colour is taken with the ${hat.name}.`;

const pairSentence = (colour, hat) =>
  isBareHead(hat.id)
    ? `Someone is already ${colour.name} with no hat.`
    : `Someone is already ${colour.name} wearing the ${hat.name}.`;

/* hat-placement.js owns where a hat sits on a sheep, per hat and per pose.
   Nothing about position is written here: paintSheepArt reads the tuned
   placement, so the /admin bench and this surface cannot disagree about where
   a rubber duck goes.

   `headroom` left null means paintSheepArt measures the space above for THIS
   hat alone, which is right for a sheep that only ever wears one. The picker
   passes previewHeadroom instead — see below. */
function setHat(host, hatId, headroom = null) {
  paintSheepArt(host, { hatId, headroom });
}

/* --- the preview stands still -------------------------------------------
 *
 * Headroom is the room a hat needs above the sheep, and headroomFor() measures
 * it from the tuned placement and the art's own aspect. Measured per hat it is
 * genuinely different per hat — on the idle pose a ten-gallon rises 26.7% of
 * the sheep's width above the box and sunglasses rise nothing at all — and
 * since it is applied as padding-top on the sheep, the animal stepped up and
 * down the screen as a thumb ran through the grid. The player is trying to
 * compare hats, and the sheep moving is the loudest thing on the screen while
 * they do it.
 *
 * So the picker reserves the WORST CASE ACROSS EVERY OPTION, once, and never
 * changes it: same call, whole list instead of one id. The sheep is nailed to
 * one spot for all forty options and only the hat changes. It costs the
 * difference — about 27% of the preview's width of empty space above a pair of
 * sunglasses — and that is the price of the thing not jumping.
 *
 * Only the picker needs this. Every other sheep on this surface wears one hat
 * for as long as it is on screen, so measuring it alone is both tighter and
 * stable; a lobby flock is one list sharing one number already.
 *
 * Filled in by buildPicker() rather than at module scope, because headroomFor
 * reads aspect ratios out of the art manifest and the manifest is only loaded
 * by the await at the foot of this file. Measured any earlier, every hat is
 * assumed square and the number is wrong. */
let previewHeadroom = 0;

/* tokens.css owns every colour value; look.js's own hex rides along only as
   the fallback, so a picker painted before that sheet lands is still a picker
   and not thirty blank squares. */
function fleeceValue(colour) {
  return `var(${colourToken(colour.id)}, ${colour.hex})`;
}

/* The look as the rest of this surface wears it: the fleece everywhere a
   sheep is drawn, and the hat on top of it. */
function applyLook(look) {
  const colour = look ? colourById(look.colorId) : null;
  const hat = look ? hatById(look.hatId) : null;
  if (colour) el.body.style.setProperty('--fleece', fleeceValue(colour));
  else el.body.style.removeProperty('--fleece');
  setHat(el.lobbySheep, hat ? hat.id : '');
  setHat(el.sheep, hat ? hat.id : '');
}

/* Sticky messages are the ones a repaint must not talk over: a rejection or a
   send that did not go stays up until the player does something about it,
   rather than being wiped by the next unrelated frame from the room. */
let stickyNote = false;

/* Deliberately not setText for the sticky ones. setText no-ops when the words
   are unchanged, and the message that most needs saying again is the identical
   one: a blocked chip tapped twice, because a control that did nothing visible
   is exactly the control a thumb tries again. #look-note is the only aria-live
   region on this screen, so no mutation is no announcement, and the second tap
   is answered by silence.

   Alternating one trailing space is the smallest mutation that cannot be diffed
   away to "nothing changed" before the accessibility tree sees it; it is not
   spoken and does not print. Only sticky messages get it — those are the ones a
   player caused by touching something. The ambient rule and the clash sentence
   are rewritten by every repaint, and forcing a mutation on those would make an
   unrelated frame from the room talk over whatever is being read out. */
function lookNote(message, warn, sticky) {
  if (sticky && el.lookNote.textContent === message) el.lookNote.textContent = `${message} `;
  else setText(el.lookNote, message);
  el.lookNote.classList.toggle('is-warn', !!warn);
  stickyNote = !!sticky;
}

/* A held look and a locked player are the same fact — locked is set the moment
   a look is accepted — so either one is proof, and a frame that carries only
   the look never strands them in the picker re-confirming a sheep they have. */
function isLocked() {
  if (lockedLocal) return true;
  const you = state && state.you;
  return !!(you && (you.locked || you.look));
}

/* --- the two tabs --------------------------------------------------------
   Both panels stay in the DOM and only one is shown: rebuilding a grid of
   seventy-odd chips on every tab press would drop the scroll position and
   re-run every image, and the hidden panel costs nothing to leave standing. */

let lookTab = 'colour';

function setLookTab(which, { focus = false } = {}) {
  lookTab = which === 'hat' ? 'hat' : 'colour';
  const onColour = lookTab === 'colour';

  el.tabColour.setAttribute('aria-selected', String(onColour));
  el.tabHat.setAttribute('aria-selected', String(!onColour));
  /* Roving tabindex: the tablist is one stop, arrow keys move within it. */
  el.tabColour.tabIndex = onColour ? 0 : -1;
  el.tabHat.tabIndex = onColour ? -1 : 0;

  el.panelColour.hidden = !onColour;
  el.panelHat.hidden = onColour;

  /* Each tab keeps its own scroll, so switching back does not dump them at the
     top of a list they had already worked their way down. */
  el.lookScroll.scrollTop = onColour ? colourScrollTop : hatScrollTop;
  if (focus) (onColour ? el.tabColour : el.tabHat).focus();
}

let colourScrollTop = 0;
let hatScrollTop = 0;

if (el.lookScroll) {
  el.lookScroll.addEventListener('scroll', () => {
    if (lookTab === 'colour') colourScrollTop = el.lookScroll.scrollTop;
    else hatScrollTop = el.lookScroll.scrollTop;
  });
}

el.tabColour.addEventListener('click', () => setLookTab('colour'));
el.tabHat.addEventListener('click', () => setLookTab('hat'));

for (const tab of [el.tabColour, el.tabHat]) {
  tab.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    ev.preventDefault();
    setLookTab(lookTab === 'colour' ? 'hat' : 'colour', { focus: true });
  });
}

/* --- building the chips, once ------------------------------------------- */

function colourChip(colour) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip chip--colour';

  const swatch = document.createElement('span');
  swatch.className = 'chip-swatch';
  swatch.style.background = fleeceValue(colour);

  /* The name is spoken, never printed. Thirty-six swatches with "Stubble gold"
     under each one is a wall of text you have to read to use; without it the
     grid is scannable by colour, which is the only way anyone picks a colour
     anyway. It stays in the accessible name because a swatch that is only a
     colour is unusable to anyone who cannot see it — and unspeakable to voice
     control, which needs something to say. */
  const name = document.createElement('span');
  name.className = 'visually-hidden';
  name.textContent = colour.name;

  chip.append(swatch, name);
  /* The refusal, not just the strike-through. Every branch that turns a chip
     back says out loud, in the one line this screen speaks through, why it did
     and which half of the pair to move — so a control that is deactivated is
     never a control that has gone quiet. */
  chip.addEventListener('click', () => {
    const block = colourBlocked(colour.id);
    if (block === 'spent') {
      lookNote(`Every hat is taken with ${colour.name}. Pick another colour.`, true, true);
      return;
    }
    if (block === 'clash') {
      const hat = hatById(draft.hatId);
      /* Always the hat, never "or another colour": a colour that is not spent
         has at least one free hat by definition, so moving the hat is an escape
         that is always there. Offering the colour instead would be a lie in the
         one case that matters — a hat every one of the thirty-six colours is
         already taken with, where nothing in this grid is pickable at all. */
      lookNote(`${pairSentence(colour, hat)} Try a different hat.`, true, true);
      return;
    }
    pick({ colorId: colour.id });
  });

  colourChips.set(colour.id, chip);
  return chip;
}

function hatChip(hat) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip chip--hat';

  let art;
  if (isBareHead(hat.id)) {
    /* Bare has no art and never will: it is deliberately not in HATS, so there
       is no prompt behind it, no /art/hat-none.png and no tuned placement, and
       `npm run hats` has nothing to check. Its mark is therefore drawn in CSS —
       an empty slot the size and shape of a hat thumb. See .chip-bare in
       play.css for why it is an empty slot and not a drawn object or a slash. */
    art = document.createElement('span');
    art.className = 'chip-bare';
  } else {
    /* The chip shows the hat as the sheep will wear it, flip included — a duck
       facing one way in the picker and the other way on the animal reads as two
       different hats. Nothing else about the placement applies here: a chip has
       no sheep to sit on. */
    art = document.createElement('img');
    art.className = 'chip-hat';
    art.src = `/art/hat-${hat.id}.png`;
    art.alt = '';
    art.loading = 'lazy';
    art.draggable = false;
    if (placementFor(hat.id).flip) art.style.transform = 'scaleX(-1)';
  }

  const name = document.createElement('span');
  name.className = 'chip-name';
  name.textContent = hat.name;

  chip.append(art, name);
  chip.addEventListener('click', () => {
    const block = hatBlocked(hat.id);
    if (block === 'spent') {
      lookNote(`${everyColourWith(hat)} Pick another hat.`, true, true);
      return;
    }
    if (block === 'clash') {
      // The mirror of the colour chip's refusal, and true for the same reason:
      // a hat that is not spent has at least one free colour left.
      lookNote(`${pairSentence(colourById(draft.colorId), hat)} Try a different colour.`, true, true);
      return;
    }
    pick({ hatId: hat.id });
  });

  hatChips.set(hat.id, chip);
  return chip;
}

function buildPicker() {
  const families = [];
  for (const colour of FLEECE_COLOURS) {
    let family = families.find((f) => f.id === colour.family);
    if (!family) {
      family = { id: colour.family, colours: [] };
      families.push(family);
    }
    family.colours.push(colour);
  }

  for (const family of families) {
    const strip = document.createElement('div');
    strip.className = 'fam';

    const name = document.createElement('p');
    name.className = 'legend fam-name';
    // The family id IS the hue word in look.js; this only capitalises it.
    name.textContent = family.id.charAt(0).toUpperCase() + family.id.slice(1);

    const shades = document.createElement('div');
    shades.className = 'fam-shades';
    for (const colour of family.colours) shades.append(colourChip(colour));

    strip.append(name, shades);
    el.colourGrid.append(strip);
  }

  /* HAT_OPTIONS, so bare is the first chip in the grid. First because it is the
     shortest question this screen asks — "do you want anything on your head at
     all?" — and a player who does not should not have to scroll past all
     thirty-nine of them to say so. look.js already puts it at the head of the
     list; this only has to not sort it. */
  for (const hat of HAT_OPTIONS) el.hatGrid.append(hatChip(hat));

  // The manifest is loaded by now (see the await at the foot of this file), so
  // this is the first moment the worst-case rise can be measured truthfully.
  previewHeadroom = headroomFor(HAT_OPTIONS.map((h) => h.id), DEFAULT_POSE);
}

/* --- painting the state onto them --------------------------------------- */

/* `block` is '' | 'clash' | 'spent', straight from colourBlocked/hatBlocked —
 * the same call the click handler makes, which is the point.
 *
 * STILL aria-disabled, not disabled, and the instruction to actually deactivate
 * the control is honoured elsewhere: the handler refuses the pick outright and
 * play.css takes the pointer, the press and the reward off the chip. What the
 * `disabled` attribute would add on top of that is not deactivation, it is
 * silence — it takes the chip out of the tab order and out of hit-testing, so
 * the click handler that is the ONLY thing able to say why can never run, and a
 * screen-reader user swiping the grid never lands on the chip to be told at all.
 * The old comment here was right about that and it is kept.
 *
 * So a blocked chip is dead to the touch and still explains itself, twice:
 *   - to a screen reader, with no interaction at all, because the reason is
 *     folded into its accessible name ("Cobalt — taken with the Bowler") and
 *     aria-disabled announces it as unavailable when it is reached;
 *   - on screen, the moment it is touched, in #look-note — the one line this
 *     screen speaks through — as a sticky message that the next repaint is not
 *     allowed to talk over.
 * The strike-through stays as the at-a-glance half of the same fact. */
/* The chip they are WEARING is never dressed as unavailable, whatever the pair
 * it is half of has become. Pressed and unavailable at once is a contradiction
 * to read out — "Cobalt, taken with the Bowler, pressed, unavailable" — and it
 * is also wrong about what to do next: the way out of a clash is to move the
 * OTHER half, so the chip being struck out is the half that is fine. Both
 * selected chips going grey at once says "everything you have chosen is wrong",
 * when the truth is that one of the two has to move and either will do.
 *
 * The clash itself is not swallowed. It is stated where it belongs — in
 * #look-note, about the pair rather than about a chip — and the lock-in lever
 * refuses it. Tapping the worn chip still explains itself: colourBlocked and
 * hatBlocked are unchanged, so the handler names the pair and says which half
 * to move. */
function dressChip(chip, name, chosen, block, why) {
  if (!chip) return;
  chip.setAttribute('aria-pressed', chosen ? 'true' : 'false');
  const shown = chosen ? '' : block;
  chip.dataset.state = shown || 'free';
  chip.setAttribute('aria-disabled', shown ? 'true' : 'false');
  if (shown) chip.setAttribute('aria-label', `${name} — ${why}`);
  else chip.removeAttribute('aria-label');
}

/* A draft this build cannot name is the one thing on this screen that can go
 * wrong without saying so, and it takes the whole picker down with it.
 *
 * The trap is that a look is a PAIR and a chip only ever moves half of it: if
 * one half is an id colourById/hatById does not know — a hat dropped between
 * builds and still sitting in this room's record, a look restored from a phone
 * that was last here on an older deploy — then every tap on a colour leaves the
 * unknown hat in place, every tap on a hat leaves the unknown colour, and the
 * old `if (!colour || !hat) return` bailed before it painted anything. The chip
 * still took the press, so the picker looked alive and did nothing: no fleece,
 * no hat, no tick moving, no caption, and not a word about why.
 *
 * So an unknown half is repaired rather than returned on. The half we CAN name
 * is kept — it is very likely the one they just tapped — and the other is put on
 * the first free partner, which is the same move a clash gets.
 *
 * Returns what it had to do, and 'seeded' is deliberately not 'repaired': a
 * paint that arrives before the picker has been rendered (a look.taken frame
 * lands the moment we join) legitimately has no draft yet, and telling the
 * player something went wrong with their sheep because the room said hello is
 * worse than saying nothing. Only a pair that was half unreadable is worth a
 * word. */
function repairDraft() {
  if (!draft) {
    draft = me.look ? { ...me.look } : suggestLook();
    return 'seeded';
  }
  const colour = colourById(draft.colorId);
  const hat = hatById(draft.hatId);
  if (colour && hat) return '';
  const fallback = suggestLook();
  draft = firstFree(
    colour ? draft.colorId : fallback.colorId,
    hat ? draft.hatId : fallback.hatId
  );
  return 'repaired';
}

function paintLook() {
  /* Never a silent return. Anything that cannot be drawn is put right first,
     and the repair is announced, because the sheep the player is looking at has
     just changed underneath them without them touching it. */
  const repaired = repairDraft() === 'repaired';
  const colour = colourById(draft.colorId);
  const hat = hatById(draft.hatId);
  /* Belt and braces: repairDraft only ever hands back ids out of FLEECE_COLOURS
     and HAT_OPTIONS, so this cannot fire — but if it ever did, the screen is
     dead and the player deserves to be told rather than left tapping. */
  if (!colour || !hat) {
    lookNote('Something went wrong building your sheep. Reload the page.', true, true);
    return;
  }

  el.lookSheep.style.setProperty('--fleece', fleeceValue(colour));
  /* The one constant number, so the sheep does not step about as hats change.
     Constant here is only half of it: it is spent as a PERCENTAGE padding, so
     it also needs a base that does not move, which is what .look-perch in
     play.css is for. Passing the same number against the caption's width was
     the reason this sheep still jumped. */
  setHat(el.lookSheep, hat.id, previewHeadroom);
  setText(el.lookName, `${colour.name} · ${hat.name}`);

  for (const c of FLEECE_COLOURS) {
    const block = colourBlocked(c.id);
    dressChip(
      colourChips.get(c.id), c.name, c.id === colour.id, block,
      block === 'spent' ? 'taken with every hat' : `taken ${withHat(hat)}`
    );
  }

  for (const h of HAT_OPTIONS) {
    const block = hatBlocked(h.id);
    dressChip(
      hatChips.get(h.id), h.name, h.id === hat.id, block,
      block === 'spent' ? 'taken with every colour' : `taken with ${colour.name}`
    );
  }

  // The lever is dressed by the same paint as the chips, so it cannot drift out
  // of step with them. See gateConfirm.
  gateConfirm();

  /* A send in flight outranks everything: the frame answering it is the fact,
     and until it lands there is nothing truer to say.

     After that, the pair they are WEARING outranks a sticky message. Sticky is
     set by every chip refusal and every failed send, and those are all about a
     chip the player is NOT wearing — so leaving one standing meant the one line
     this screen speaks through kept repeating a stale refusal while the sheep on
     screen had quietly become somebody else's. A message about the sheep they
     have on outranks a message about a chip they have not.

     The clash sentence is not itself sticky: it is recomputed by every paint, so
     it clears itself the moment the pair comes free instead of pinning a warning
     that has stopped being true. */
  if (lookPending) return;
  /* A repair moved the sheep without them asking, so it is said before anything
     else that is not the answer to a send. It cannot be a clash — the pair came
     out of firstFree — so the check below would have nothing to say about it. */
  if (repaired) {
    lookNote(`We could not find one half of that sheep. ${wearingNow()}`, true, true);
    return;
  }
  if (isTaken(colour.id, hat.id)) {
    lookNote(`${pairSentence(colour, hat)} Change the colour or the hat.`, true);
    return;
  }
  if (stickyNote) return;
  lookNote(LOOK_RULE, false);
}

/* Half a pick, merged onto the half they are keeping.
   No silent exit on a missing draft: a tap that reaches here is a tap on a chip
   the handler has already cleared, and answering it with nothing is the failure
   this screen must never have. paintLook seeds a draft through repairDraft, so
   the worst case is that the first tap also decides the other half. */
function pick(part) {
  const base = draft || {};
  draft = {
    colorId: part.colorId || base.colorId,
    hatId: part.hatId || base.hatId,
  };
  draftDirty = true;
  stickyNote = false; // they have answered the last thing we told them
  paintLook();
}

/* The opening suggestion, and only that. raddle.js still hashes the playerId
   to one of eight dyes; it is no longer what they wear, but it is what stops
   the picker opening on the same sheep for all fifty of them.

   Drawn from HATS rather than HAT_OPTIONS on purpose: bare is a choice worth
   making, not a default worth being handed, and a picker that opens on a sheep
   wearing nothing looks like a picker that has not loaded yet. They will find
   it — it is the first chip in the grid. */
function suggestLook() {
  const seed = me.playerId ? raddleFor(me.playerId).index : 1;
  const colour = FLEECE_COLOURS[((seed - 1) * 3 + 1) % FLEECE_COLOURS.length];
  const hat = HATS[(seed - 1) % HATS.length];
  return firstFree(colour.id, hat.id);
}

/* Move the hat before the colour: a suggestion that clashes should keep the
   fleece it opened on. This one DOES search HAT_OPTIONS — it is looking for a
   free pair rather than offering an opinion, and bare is thirty-six pairs it
   would otherwise pretend do not exist. 36 colours x 40 options = 1440 pairs
   against a 50-player cap means the last fallback is unreachable, but it still
   has to return a look. */
function firstFree(colorId, hatId) {
  if (!isTaken(colorId, hatId)) return { colorId, hatId };

  const fromHat = Math.max(0, HAT_OPTIONS.findIndex((h) => h.id === hatId));
  for (let i = 1; i < HAT_OPTIONS.length; i += 1) {
    const hat = HAT_OPTIONS[(fromHat + i) % HAT_OPTIONS.length];
    if (!isTaken(colorId, hat.id)) return { colorId, hatId: hat.id };
  }

  const fromColour = Math.max(0, FLEECE_COLOURS.findIndex((c) => c.id === colorId));
  for (let i = 1; i <= FLEECE_COLOURS.length; i += 1) {
    const colour = FLEECE_COLOURS[(fromColour + i) % FLEECE_COLOURS.length];
    for (const hat of HAT_OPTIONS) {
      if (!isTaken(colour.id, hat.id)) return { colorId: colour.id, hatId: hat.id };
    }
  }

  return { colorId, hatId };
}

/* --- a draft that has gone under it --------------------------------------
 *
 * The pair on screen is not a decision the player gets to keep. Fifty phones
 * are picking at once against one room, so the pair they are looking at can be
 * somebody else's before they reach the lever — and it is not the rare case:
 * suggestLook seeds from raddleFor().index, which is bounded to eight, so nine
 * players opening the picker together GUARANTEES a duplicate by pigeonhole and
 * MAX_PLAYERS is fifty.
 *
 * So a clash that arrives is answered by moving, not by leaving them parked on
 * a pair the room will refuse. Anything else is a dead end: the draft never
 * moves, the next tap sends the identical doomed frame, and it does that
 * forever. firstFree keeps the fleece and walks the hats, so the move is the
 * smallest one that works.
 *
 * Moving the picker under a thumb without a word would be its own bug, so every
 * caller says what happened and what they are wearing now.
 */
function draftTaken() {
  return !!draft && isTaken(draft.colorId, draft.hatId);
}

function moveDraftOffClash() {
  if (!draftTaken()) return false;
  const moved = firstFree(draft.colorId, draft.hatId);
  // firstFree returns the pair it was given when nothing at all is free — 1440
  // pairs against a 50-player cap says that cannot happen, but a move that did
  // not move must not be announced as one.
  if (lookKey(moved) === lookKey(draft)) return false;
  draft = moved;
  draftDirty = true;
  return true;
}

function wearingNow() {
  const colour = colourById(draft.colorId);
  const hat = hatById(draft.hatId);
  return `You are ${colour.name} ${withHat(hat)} now — send that, or pick your own.`;
}

/* --- confirming --------------------------------------------------------- */

/* THE GATE. The lever asks the same question the chips do, out of the same
   call, for the same reason the paint and the click handler were made to share
   one: two codepaths deciding whether a pair may be sent is what let a struck-
   out pair go down the wire. The chips were disabled on a clash and the lever
   was not, so both halves of the pair could be struck through on screen while
   the lever underneath them was still live and still sending.

   Every path that turns the lever back on comes through here rather than
   setting it true, because "was it sendable when I last looked" is never the
   question — the room moves between paints. */
function gateConfirm() {
  el.lookGo.disabled = lookPending || draftTaken();
}

function restoreConfirm() {
  gateConfirm();
  setText(el.lookGo, isLocked() ? 'Change my sheep' : "That's my sheep");
}

function confirmLook() {
  if (lookPending || !draft) return;

  /* The disabled attribute is the visible half of the gate; this is the half
     that cannot be raced. A look.taken frame can land between the last paint and
     the thumb coming down, and validateLook only ever checked the SHAPE of the
     pair — it has never known anything about who is already wearing it. */
  if (draftTaken()) {
    const colour = colourById(draft.colorId);
    const hat = hatById(draft.hatId);
    lookNote(`${pairSentence(colour, hat)} Change the colour or the hat.`, true, true);
    gateConfirm();
    return;
  }

  const checked = validateLook(draft);
  if (checked.error) {
    lookNote(checked.message, true, true);
    return;
  }

  if (!net || !net.send({ t: 'player.look', colorId: checked.look.colorId, hatId: checked.look.hatId })) {
    lookNote('That did not send — you dropped off for a moment. Try again.', true, true);
    return;
  }

  lookPending = true;
  lookSent = { colorId: checked.look.colorId, hatId: checked.look.hatId };
  gateConfirm();
  setText(el.lookGo, 'Marking you up…');
  lookNote('Taking that to the paddock…', false);
  // Bound the wait: an ack that cannot arrive must not leave the lever dead.
  clearTimeout(lookAckTimer);
  lookAckTimer = setTimeout(() => {
    if (!lookPending) return;
    lookPending = false;
    /* No verdict ever came, so we know nothing about that pair — forgetting the
       send is the point. Keeping it would let a later, unrelated rejection
       poison a pair this one was never told about. */
    lookSent = null;
    restoreConfirm();
    lookNote('No word back from the paddock. Try that again.', true, true);
  }, HANDSHAKE_MS);
}

el.lookGo.addEventListener('click', confirmLook);

/* Reopening from the lobby. Legal only while the host has not started, which
   is exactly when the lobby is on screen. */
el.lookReopen.addEventListener('click', () => {
  if (!state || state.phase !== 'lobby') return;
  pickerOpen = true;
  draftDirty = false;
  stickyNote = false; // whatever went wrong last time is last time's business
  if (me.look) draft = { ...me.look };
  render();
});

el.lookBack.addEventListener('click', () => {
  pickerOpen = false;
  draftDirty = false;
  if (me.look) draft = { ...me.look };
  render();
});

/* ------------------------------------------------------------------ answering */

function markFleece() {
  // One authored moment, added once: the raddle sprays onto the fleece here at
  // the same time as it appears on this player's sheep on the big screen.
  if (!el.flank.classList.contains('marked')) el.flank.classList.add('marked');
}

function lockIn(value, mode) {
  submitted = true;
  reconciled = true;
  answerOnFile = true;
  myAnswer = value;
  screens.question.dataset.submitted = 'true';
  el.answer.value = value;
  el.answer.readOnly = true;
  show(el.locked, true);
  // Move focus off the send lever BEFORE it is hidden. Letting the focused
  // element vanish drops the reading position to <body> at the exact moment the
  // answer commits; "Change it" is the one control still worth being on.
  if (
    mode === 'fresh' &&
    (document.activeElement === el.send || document.activeElement === el.answer)
  ) {
    el.changeAnswer.focus();
  }
  show(el.send, false);
  markFleece();

  el.lockNote.classList.remove('is-warn');
  if (mode === 'recovered') {
    setText(el.lockNote, 'Back in — this is the answer we had for you.');
  } else {
    setText(el.lockNote, 'Your mark is on the fleece. The big screen has it too.');
  }
}

/* They answered (the server says so) but this device cannot show the text —
   a refresh on a different round, or a second device. Say so, offer a replace. */
function lockUnknown() {
  submitted = false;
  reconciled = true;
  answerOnFile = true;
  myAnswer = '';
  screens.question.dataset.submitted = 'false';
  el.answer.readOnly = false;
  el.answer.value = '';
  el.answer.placeholder = 'Type again to replace it';
  show(el.locked, false);
  show(el.send, true);
  setText(el.send, 'Replace it');
  markFleece();
  el.lockNote.classList.add('is-warn');
  setText(el.lockNote, 'Your answer is already in — we just cannot show it back after a refresh.');
}

function unlock() {
  submitted = false;
  screens.question.dataset.submitted = 'false';
  el.answer.readOnly = false;
  show(el.locked, false);
  show(el.send, true);
  setText(el.send, 'Send it');
  el.lockNote.classList.remove('is-warn');
  setText(el.lockNote, 'Change it and send again before the gate shuts.');
  el.answer.focus();
  el.answer.setSelectionRange(el.answer.value.length, el.answer.value.length);
}

function resetRound() {
  submitted = false;
  reconciled = false;
  answerOnFile = false;
  myAnswer = '';
  pendingSubmit = false;
  clearTimeout(submitAckTimer);
  screens.question.dataset.submitted = 'false';
  el.answer.value = '';
  el.answer.readOnly = false;
  el.answer.disabled = false;
  el.answer.placeholder = '';
  show(el.locked, false);
  show(el.send, true);
  el.send.disabled = false;
  setText(el.send, 'Send it');
  el.lockNote.classList.remove('is-warn');
  setText(el.lockNote, ' ');
  show(el.changeAnswer, true);
  setText(el.lockedText, 'Locked in — you can change it until the gate shuts.');
  el.flank.classList.remove('marked');
  screens.question.classList.remove('urgent');
  urgent = false;
  gateShut = false;
}

function shutGate() {
  gateShut = true;
  setText(el.clock, '0');
  setText(el.clockLabel, 'gate shut');

  // An edit that was never sent does not count. Put the answer that DOES count
  // back on the slate rather than leaving a lie sitting there.
  if (answerOnFile && !submitted) {
    if (myAnswer) lockIn(myAnswer, 'gate');
    else el.answer.placeholder = 'Your answer went in';
  }

  el.send.disabled = true;
  el.answer.readOnly = true;
  // The strip must stop offering a change it can no longer honour.
  show(el.changeAnswer, false);
  setText(el.lockedText, 'That is your answer for this round.');
  el.lockNote.classList.add('is-warn');
  setText(
    el.lockNote,
    answerOnFile ? 'The gate is shut. That is your answer.' : 'The gate is shut — no answer this round.'
  );
}

el.changeAnswer.addEventListener('click', () => {
  if (gateShut) return;
  unlock();
});

el.answerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state || state.phase !== 'question') return;
  if (gateShut) {
    el.lockNote.classList.add('is-warn');
    setText(el.lockNote, 'The gate is shut — that one is closed.');
    return;
  }

  const value = el.answer.value.trim().slice(0, ANSWER_MAX);
  if (!value) {
    el.lockNote.classList.add('is-warn');
    setText(el.lockNote, 'Put something in the slate first — anything at all.');
    el.answer.focus();
    return;
  }

  if (!net || !net.send({ t: 'player.answer', text: value })) {
    el.lockNote.classList.add('is-warn');
    setText(el.lockNote, 'That did not send — you dropped off for a moment. Try again.');
    return;
  }

  pendingSubmit = true;
  beforeSubmit = { onFile: answerOnFile, text: myAnswer };
  // A REPLACEMENT cannot be acknowledged by a state frame — you.answered is
  // already true for the rest of the round — so nothing must be allowed to
  // clear the gate early. Bound the wait instead, and let resetRound() or a
  // rejection close it.
  clearTimeout(submitAckTimer);
  submitAckTimer = setTimeout(() => { pendingSubmit = false; }, HANDSHAKE_MS);
  store.write(KEY_ANSWER, { room: me.room, roundIndex: state.roundIndex, text: value });
  lockIn(value, 'fresh');
  el.answer.blur(); // drop the keyboard so the mark landing is actually seen
});

/* ------------------------------------------------------------------ the gate
   Three screens now wait for a person rather than a clock. The lobby waits for
   the host to start — the big screen has no Start button any more — and the
   reveal and the scoreboard are parked until the host taps Continue, because
   neither of them arms an advancing alarm now. One block of markup on each of
   the three, one function to paint all of them.

   Every word here goes in through setText, so a player name — which is theirs
   to type and therefore untrusted — is text and can never become markup. */

const gates = {
  lobby:  { go: el.lobbyGo,  note: el.lobbyNote,  label: 'Start the game', wait: 'to start' },
  reveal: { go: el.revealGo, note: el.revealNote, label: 'Carry on',       wait: '' },
  scores: { go: el.scoresGo, note: el.scoresNote, label: 'Next round',     wait: '' },
};

/* The frame names the host outright. The id comparison behind it is only the
   floor for a room that has not shipped `isHost` yet. */
function isHost() {
  const you = state && state.you;
  if (!you) return false;
  if (typeof you.isHost === 'boolean') return you.isHost;
  return !!(state.hostId && state.hostId === you.id);
}

/* --- proving this phone is still running --------------------------------
 *
 * net.js already sends a heartbeat, but the runtime answers it without ever
 * waking the Room, so the server cannot tell a host who is thinking from a host
 * whose tab the OS froze. In the lobby that difference is the whole game: there
 * is no clock there and no way out except this phone's Start, so a frozen host
 * used to strand everyone with no recourse.
 *
 * So while this phone holds the controls it says so, on a timer, in a frame the
 * server actually receives. The cost is one small frame every fifteen seconds
 * from exactly one phone in the room, and only until the game starts.
 *
 * Fifteen against the server's forty-five: three chances to be heard before the
 * lobby gives up, so a single missed beat on a bad connection costs nothing.
 * A frozen tab stops sending entirely, which is the only case worth acting on —
 * and a host taking their time keeps sending, so they keep the controls.
 */
const LIVENESS_MS = 15000;
let liveness = null;

function updateLiveness() {
  /* Only the lobby acts on it; every later phase carries its own deadline, so
     sending past the lobby would be noise the server throws away. */
  const wanted = !!net && isHost() && !!state && state.phase === 'lobby';
  if (wanted && liveness === null) {
    /* Immediately as well as on the interval: the phone that just became host
       should not wait a full beat to be counted, and the handover that made it
       host may have been the lobby giving up on somebody else. */
    net.send({ t: 'player.alive' });
    liveness = setInterval(() => {
      if (net) net.send({ t: 'player.alive' });
    }, LIVENESS_MS);
  } else if (!wanted && liveness !== null) {
    clearInterval(liveness);
    liveness = null;
  }
}

/* A phone that goes away entirely should not leave a timer running behind it. */
window.addEventListener('pagehide', () => {
  if (liveness !== null) {
    clearInterval(liveness);
    liveness = null;
  }
});

/* Whoever everyone else is waiting for. A frame in flight during a disconnect
   is enough to name a host who is not in players[] for one paint, so a missing
   name is a missing name and not a fault — the line still has to say something. */
function hostName() {
  const id = state && state.hostId;
  if (!id) return '';
  const found = (state.players || []).find((p) => p.id === id);
  return (found && found.name) || '';
}

/* One release per phase per round. The server drops a second tap silently — the
   continue frame is stamped with the phase it was drawn on, so a double-tap on
   the reveal cannot skip the scoreboard — but the lever should not sit there
   inviting one either. */
let gateSent = null;
let gateWarn = '';
let gateAckTimer = null;

const gateKey = () => (state ? `${state.phase}:${state.roundIndex || 0}` : '');

function paintGate(which, open) {
  const gate = gates[which];
  const host = isHost();

  show(gate.go, open && host);
  setText(gate.go, gate.label);
  gate.go.disabled = gateSent === gateKey();

  gate.note.classList.toggle('is-warn', !!gateWarn);
  if (gateWarn) { setText(gate.note, gateWarn); return; }
  // The host is holding the lever; it says what it does. Nobody else can move
  // the room, so they are told who can.
  if (!open || host) { setText(gate.note, ' '); return; }

  const who = hostName() || 'the host';
  setText(gate.note, gate.wait ? `Waiting for ${who} ${gate.wait}.` : `Waiting for ${who}.`);
}

function release(which) {
  if (!state || state.phase !== which || !isHost()) return;
  if (gateSent === gateKey()) return;

  const frame = which === 'lobby' ? { t: 'player.start' } : { t: 'player.continue', phase: which };
  if (!net || !net.send(frame)) {
    gateWarn = 'That did not send — you dropped off for a moment. Try again.';
    paintGate(which, true);
    return;
  }

  gateSent = gateKey();
  gateWarn = '';
  paintGate(which, true);

  // Bound the wait, the same way the look and the answer do: the next state
  // frame is the only acknowledgement, and one that cannot arrive must not
  // leave the lever dead for the rest of the game.
  clearTimeout(gateAckTimer);
  gateAckTimer = setTimeout(() => {
    if (gateSent !== gateKey()) return;
    gateSent = null;
    gateWarn = 'No word back from the paddock. Try that again.';
    render();
  }, HANDSHAKE_MS);
}

el.lobbyGo.addEventListener('click', () => release('lobby'));
el.revealGo.addEventListener('click', () => release('reveal'));
el.scoresGo.addEventListener('click', () => release('scores'));

/* The two endings. Both are host-only and both are refused anywhere but the
   final scoreboard, so the server answers a stale tap with silence rather than
   an error — which is why these disable themselves on the tap and wait for the
   state frame to tell them what happened, rather than waiting for a reply that
   is never coming. */
function endGame(frame, saying) {
  if (!net || !isHost()) return;
  if (!net.send(frame)) {
    lookNote('That did not send — you dropped off for a moment. Try again.', true, true);
    return;
  }
  el.againGo.disabled = true;
  el.newgameGo.disabled = true;
  setText(el.scoresNote, saying);
}

el.againGo.addEventListener('click', () =>
  endGame({ t: 'player.again' }, 'Rounding them up for another go…'));

el.newgameGo.addEventListener('click', () =>
  endGame({ t: 'player.newgame' }, 'Opening a fresh paddock…'));

/* ------------------------------------------------------------------ countdown */

function startClock(endsAt) {
  if (!endsAt) return;
  if (clockFor === endsAt) return;
  clockFor = endsAt;
  if (stopClock) stopClock();
  stopClock = countdown(endsAt, (whole) => {
    if (whole <= 0) { shutGate(); return; }
    setText(el.clock, String(whole));
    setText(el.clockLabel, plural(whole, 'second left', 'seconds left'));
    // One authored urgency change, at the threshold — not per tick.
    if (whole <= URGENT_AT && !urgent) {
      urgent = true;
      screens.question.classList.add('urgent');
    }
  });
}

function stopClockNow() {
  if (stopClock) stopClock();
  stopClock = null;
  clockFor = null;
}

/* ------------------------------------------------------------------ rendering */

function render() {
  if (joinState !== 'in' || !state || !state.you) {
    setScreen('join');
    return;
  }

  const you = state.you;
  me.name = you.name || me.name;
  applyIdentity();

  /* Re-evaluated on every frame rather than only when the role changes: the
     controls can arrive or leave without this phone doing anything, and the
     phase moving off the lobby is what stops the timer. */
  updateLiveness();

  const total = state.totalRounds || 0;
  if (total > 0 && state.phase !== 'lobby') {
    setText(el.roundI, String((state.roundIndex || 0) + 1));
    setText(el.roundN, String(total));
    show(el.round, true);
  } else {
    show(el.round, false);
  }

  if (state.phase !== 'question') stopClockNow();
  // The picker is a lobby thing. Once the game is running it cannot reopen.
  if (state.phase !== 'lobby') pickerOpen = false;

  /* The room moved, so whatever the gate was holding is last phase's business:
     the tap has landed, and anything it had to say about it is spent. */
  if (state.phase !== lastPhase) {
    clearTimeout(gateAckTimer);
    gateSent = null;
    gateWarn = '';
  }

  switch (state.phase) {
    case 'question': renderQuestion(you); setScreen('question'); break;
    case 'grouping': renderGrouping(); setScreen('grouping'); break;
    case 'reveal': renderReveal(you); setScreen('reveal'); break;
    case 'scores':
    case 'final': renderScores(you); setScreen('scores'); break;
    default:
      // Joined but not locked is not yet in the flock: they are choosing.
      if (!isLocked() || pickerOpen) {
        if (currentScreen !== 'look') scrollToPick = true;
        renderLook();
        setScreen('look');
      } else {
        renderLobby();
        setScreen('lobby');
      }
      break;
  }

  lastPhase = state.phase;
}

function renderLook() {
  if (!draft) draft = me.look ? { ...me.look } : suggestLook();
  show(el.lookBack, isLocked());
  if (!lookPending) restoreConfirm();
  paintLook();

  if (!scrollToPick) return;
  scrollToPick = false;
  // Open on the sheep they are wearing, not at the top of thirty colours.
  const chip = colourChips.get(draft.colorId);
  if (chip) chip.scrollIntoView({ block: 'center' });
}

function renderLobby() {
  const others = Math.max(0, (state.players || []).length - 1);
  setText(
    el.flockCount,
    others === 0
      ? "You're first in the paddock."
      : `You and ${others} ${plural(others, 'other', 'others')} in the paddock.`
  );

  // The headcount above counts locked players only, so say where the rest
  // are rather than letting the number look wrong.
  const choosing = Math.max(0, Number(state.choosing) || 0);
  setText(
    el.choosingNote,
    choosing > 0 ? `${choosing} more still choosing` : ' '
  );

  // The badge goes on the sheep, and only on the host's own phone: it is not a
  // scoreboard of who is in charge, it is this player being told they are.
  show(el.hostBadge, isHost());
  paintGate('lobby', true);
}

function renderQuestion(you) {
  const q = state.question || '';
  setText(el.question, q);
  el.question.dataset.len = q.length <= 34 ? 'short' : q.length <= 72 ? 'mid' : 'long';

  // Entering the question phase is always a fresh round — including round 0 of
  // a second game in the same room, which a roundIndex check alone would miss.
  if (lastPhase !== 'question' || roundKey !== state.roundIndex) {
    roundKey = state.roundIndex;
    resetRound();
  }

  // The server is the authority on whether an answer is in — but reconcile
  // exactly once per round, never on top of live typing.
  if (you.answered && !submitted && !reconciled) {
    const saved = store.read(KEY_ANSWER);
    if (saved && saved.room === me.room && saved.roundIndex === state.roundIndex && saved.text) {
      lockIn(saved.text, 'recovered');
    } else {
      lockUnknown();
    }
  }

  startClock(state.endsAt);
}

function renderGrouping() {
  if (myAnswer) {
    setText(el.saidGroupingText, `“${myAnswer}”`);
    show(el.saidGrouping, true);
  } else {
    show(el.saidGrouping, false);
  }
}

function renderReveal(you) {
  const groups = state.groups || [];
  const mine = groups.find((g) => g.id === you.myGroupId) || null;
  const sizes = groups.map((g) => (g.answers || []).length);
  const biggest = sizes.length ? Math.max(...sizes) : 0;
  const winners = groups.filter((g) => (g.answers || []).length === biggest && biggest > 0);
  const missed = (state.noAnswer || []).some((n) => n.playerId === you.id) || (!you.answered && !mine);

  if (you.scoredThisRound) {
    show(el.rosette, true);
    setText(el.verdictHead, '+1 — you are with the flock');
    setText(
      el.verdictSub,
      winners.length > 1
        ? 'Joint majority. Every tied group scores.'
        : `That was the majority — ${biggest} of you said it.`
    );
  } else if (missed) {
    show(el.rosette, false);
    setText(el.verdictHead, 'The gate shut without you');
    setText(el.verdictSub, 'No answer went in, so no point this round. The next question is on its way.');
  } else {
    show(el.rosette, false);
    setText(el.verdictHead, 'Odd one out this round');
    setText(
      el.verdictSub,
      winners.length && winners[0].label
        ? `The majority went with “${winners[0].label}” — ${biggest} of them.`
        : 'The majority went elsewhere this time.'
    );
  }

  if (mine) {
    setText(el.groupLabel, mine.label || (myAnswer ? `“${myAnswer}”` : 'Your group'));
    setText(el.groupCount, String((mine.answers || []).length));
    show(el.groupCard, true);
  } else {
    show(el.groupCard, false);
  }

  setText(el.revealScore, String(you.score || 0));
  paintGate('reveal', !!state.awaitingHost);
}

/* The face they are wearing on the scoreboard.
   Rank thirds, exactly as the server orders the field: their place divided by
   the size of it. A streak overrides all of it — two scoring rounds back to
   back and the sheep is running, whatever the standing says, because a run is
   the more interesting fact about them at that moment. */
function scorePose(you, total) {
  if ((Number(you.streak) || 0) >= 2) return 'sheep-running';
  const rank = Number(you.rank) || 0;
  if (!rank || !total) return 'sheep-idle';
  const share = rank / total;
  if (share <= 1 / 3) return 'sheep-happy';
  if (share <= 2 / 3) return 'sheep-idle';
  return 'sheep-confused';
}

/* --- who is immediately above you ----------------------------------------
 *
 * The scoreboard's one social fact, and the only one this surface should carry:
 * the big screen already has the whole board, so the phone's job is to name the
 * single player worth catching rather than reprint a table nobody can read
 * one-handed at a party.
 *
 * `rank` is a STRICT TOTAL ORDER on both YouView and PublicPlayer — the server
 * breaks ties on cumulative answer cost, which never comes down the wire — so
 * the player at rank - 1 is exactly one person and is unambiguous. It also
 * cannot be worked out here any other way, and players[] is in JOIN order, so
 * this is a search for a rank, never an index into the array.
 *
 * Their sheep is drawn MUCH smaller than the player's own (see .above-sheep in
 * play.css): it is somebody else's animal on a screen about you, and it has to
 * read as a glance up the field rather than as a second contender for the
 * middle of the screen.
 *
 * Both halves of them are untrusted. The NAME is theirs to type, so it only
 * ever goes in through setText — a text node cannot become markup, which is the
 * same guarantee tv.js's esc() gives and one fewer place to forget it. The LOOK
 * arrives over the same socket and both ids end up somewhere that would carry
 * an injection — the colour inside a custom property, the hat inside an image
 * URL — so it goes back through validateLook exactly as tv.js does, and an id
 * this build has never heard of is treated as no look rather than passed on.
 */
function renderAbove(place, players, isFinal) {
  if (place <= 1) {
    /* Nothing above them. On the FINAL board the rosette and "First in the
       flock" have already said this, louder and in the right tense — "keep it
       up" is advice for a game that is still running — so it is said once. */
    if (isFinal) { show(el.above, false); return; }
    show(el.aboveSheep, false);
    show(el.aboveLead, false);
    setText(el.aboveLine, 'You are on top of the flock, keep it up!');
    show(el.above, true);
    return;
  }

  const ahead = players.find((p) => Number(p.rank) === place - 1);
  /* A frame can carry a rank whose player is not in players[] for one paint —
     a disconnect landing between the ranking and the serialising. Say nothing
     rather than name the wrong person or invent a placeholder. */
  if (!ahead) { show(el.above, false); return; }

  const checked = ahead.look ? validateLook(ahead.look) : null;
  const colour = checked && !checked.error ? colourById(checked.look.colorId) : null;
  /* transparent, not removeProperty: --fleece is set on <body> to THIS player's
     colour, so clearing it here would let the sheep above them inherit their
     fleece and quietly become a second copy of their own animal. Transparent
     leaves the plain enamel art, which is what an unknown look should look
     like. */
  el.aboveSheep.style.setProperty('--fleece', colour ? fleeceValue(colour) : 'transparent');
  setHat(el.aboveSheep, checked && !checked.error ? checked.look.hatId : '');

  show(el.aboveSheep, true);
  show(el.aboveLead, true);
  setText(el.aboveLine, ahead.name || 'Someone');
  show(el.above, true);
}

function renderScores(you) {
  const isFinal = state.phase === 'final' || state.scoreboardReason === 'final';
  const players = state.players || [];
  const total = players.length;
  const mine = you.score || 0;
  const streak = Math.max(0, Number(you.streak) || 0);

  /* The server ranks the field — score first, then who answered faster, then
     join order — and it is a strict total order, so nobody is joint anything
     any more. It cannot be worked out here either: the answer times that break
     the ties never come down the wire. Counting the players ahead is only the
     floor for a frame that arrived without a rank on it. */
  const place = Number(you.rank) || players.filter((p) => (p.score || 0) > mine).length + 1;

  screens.scores.dataset.final = isFinal ? 'true' : 'false';

  /* The evening is over and this phone is the one holding the controls. Shown
     only at the final board: mid-game scoreboards have a Continue, and the two
     are different jobs — one moves the game on, these two end it. Re-enabled on
     every final frame, so a tap that did not take (a dropped socket, a frame
     that crossed the room changing hands) leaves a working button rather than a
     dead one. */
  const canEnd = isFinal && isHost();
  show(el.rematch, canEnd);
  if (canEnd) {
    el.againGo.disabled = false;
    el.newgameGo.disabled = false;
  }
  setText(el.bigScore, String(mine));
  setText(el.scoreUnit, plural(mine, 'point', 'points'));

  /* The sheep is long-lived: paintSheepArt swaps the pose and re-places the hat
     on the element that is already standing there, so the art is not re-fetched
     and nothing restarts. hat-placement.js has this hat tuned for all four
     poses, so the pose is the only thing that has to change here. */
  paintSheepArt(el.scoreSheep, {
    pose: scorePose(you, total),
    hatId: me.look ? me.look.hatId : '',
  });

  // The flame is the loud half of the streak; the line below says it in words,
  // which is why the emoji itself is not announced.
  show(el.flame, streak >= 3);
  const run = streak >= 3 ? `${streak} rounds in a row. ` : '';

  if (isFinal && place === 1) {
    show(el.rosetteFinal, true);
    setText(el.standing, 'First in the flock');
    setText(el.scoresSub, `${run}That is the flock you read best. Take the rosette.`);
  } else {
    show(el.rosetteFinal, false);
    setText(el.standing, total > 0 ? `${ordinal(place)} of ${total}` : '');
    setText(el.scoresSub, `${run}The whole board is on the big screen.`);
  }

  renderAbove(place, players, isFinal);

  // 'final' is not gated — there is nothing left to advance to.
  paintGate('scores', !!state.awaitingHost && state.phase === 'scores');
}

/* ------------------------------------------------------------------ frames */

function onFrame(frame) {
  if (!frame || typeof frame.t !== 'string') return;

  /* This paddock has been packed up and a new one is open. The server sends
     this and then closes the socket, so net.js will reconnect on its own — the
     job here is to make sure it reconnects to the RIGHT place. Everything tying
     this phone to the old paddock has to go: the remembered room, the playerId
     and the rejoin token are all worthless in a paddock that never issued them,
     and a phone that keeps them spends the next game trying to rejoin a room
     that answers ROOM_NOT_FOUND.

     The new code is offered rather than joined. Kayleigh chose "a brand new
     paddock" knowing everyone rescans, and a phone that silently teleported
     itself into a game its owner has not looked at yet would be a worse
     surprise than a screen saying where to go. */
  if (frame.t === 'room.closed') {
    /* forgetIdentity() is the existing way to stop being somebody here: it
       drops the stored id and token, the saved answer, the look and the picker
       state. The room goes with it, because the code we were remembering is the
       one that just closed. */
    forgetIdentity();
    me.room = '';
    joinState = 'out';
    state = null;
    setScreen('join');
    setJoinError(
      frame.next
        ? `That game is finished. The next paddock is ${sanitizeCode(frame.next)} — scan the code on the big screen.`
        : 'That game is finished. Scan the code on the big screen to join the next one.',
    );
    return;
  }

  if (frame.t === 'joined') {
    clearTimeout(handshakeTimer);
    joinState = 'in';
    me.playerId = frame.playerId || me.playerId;
    me.room = frame.room || me.room;
    me.name = frame.name || me.name;
    /* The rejoin token, minted on the way in and sent down this socket and no
       other — it is on no state frame, in no players[] entry, and never on the
       display. Written to disk the moment it lands rather than left to the
       usual once-per-session write: the phone that needs it is the one that got
       locked or refreshed a second later, and a token still sitting in memory
       when that happens is a token this phone can never prove anything with. */
    const minted = typeof frame.token === 'string' ? frame.token : '';
    if (minted && minted !== me.token) {
      me.token = minted;
      writeIdentity();
    }
    rememberIdentity();
    applyIdentity();
    setJoinBusy(false);
    setJoinError('');
    // Until the first state frame lands (same tick), go where a joined player
    // goes: the picker if they have no sheep yet, the lobby if they have.
    if (!state) {
      if (me.look) {
        setScreen('lobby');
      } else {
        scrollToPick = true;
        renderLook();
        setScreen('look');
      }
    }
    return;
  }

  /* Advisory about everyone else's sheep — the server is the authority and
     rejects a race anyway — but not advisory about ours: a set that arrives
     carrying the pair on screen has just made the player's own selection
     unsendable, and leaving them on it is leaving them on a dead end (see
     moveDraftOffClash). */
  if (frame.t === 'look.taken') {
    taken = new Set((Array.isArray(frame.taken) ? frame.taken : []).map(String));
    const was = draft ? { ...draft } : null;
    if (moveDraftOffClash()) {
      lookNote(
        `${pairSentence(colourById(was.colorId), hatById(was.hatId))} ${wearingNow()}`,
        true,
        true
      );
    }
    paintLook();
    return;
  }

  if (frame.t === 'look.ok') {
    clearTimeout(lookAckTimer);
    lookPending = false;
    lookSent = null;
    const checked = validateLook(frame.look);
    me.look = checked.error ? (draft ? { ...draft } : null) : checked.look;
    if (me.look) {
      draft = { ...me.look };
      draftDirty = false;
    }
    lockedLocal = true;
    pickerOpen = false;
    writeIdentity();
    applyLook(me.look);
    /* Repaint the grid against the look the server has just confirmed. Every
       chip was last dressed while this send was in flight, when me.look was
       still the old pair — and isTaken excuses only me.look — so the strike-
       throughs and the "taken with" names are one look out of date until this
       runs. It goes before the note because paintLook writes to #look-note too,
       and the last word on a confirmed sheep is this one. */
    paintLook();
    restoreConfirm();
    lookNote('That is your sheep. The big screen has it too.', false);
    if (state) render();
    return;
  }

  if (frame.t === 'error') {
    onError(frame);
    return;
  }

  if (frame.t === 'state') {
    if (frame.you) {
      // A player frame is proof we are in, even if 'joined' went missing.
      clearTimeout(handshakeTimer);
      joinState = 'in';
      if (!me.playerId && frame.you.id) me.playerId = frame.you.id;
      if (frame.room) me.room = frame.room;
      if (frame.you.name) me.name = frame.you.name;
      rememberIdentity();

      /* The server record is the authority on the look. Anything this device
         restored from storage is optimistic, and stands only until here. */
      lockedLocal = false;
      const held = lookKey(me.look);
      const checked = frame.you.look ? validateLook(frame.you.look) : null;
      me.look = checked && !checked.error ? checked.look : null;
      if (me.look && !draftDirty) draft = { ...me.look };
      // Only when it actually moved: this runs on every frame in the room.
      if (lookKey(me.look) !== held) {
        writeIdentity();
        applyLook(me.look);
      }
    }
    state = frame;
    // you.answered is derived from the server's answers map, which stays true
    // for the whole round once ANY answer landed — so it can only ever
    // acknowledge a first answer. Accepting it for a replacement would let an
    // unrelated frame satisfy the gate and silently swallow the rejection.
    if (pendingSubmit && !beforeSubmit.onFile && frame.you && frame.you.answered) {
      pendingSubmit = false;
      clearTimeout(submitAckTimer);
    }
    render();
  }
}

function onError(frame) {
  const code = frame.code || 'BAD_REQUEST';
  const message = JOIN_ERRORS[code] || JOIN_ERRORS.BAD_REQUEST;

  /* A refused look. The colour and the hat they were working in stay on screen —
     they are not sent back to the start — but the exact pair the server just
     refused cannot stay under the lever. Leaving it there is a loop with no way
     out of it: the lever comes back, nothing about the draft has changed, and
     the next tap sends the same doomed frame to the same refusal, forever. */
  if (lookPending && LOOK_ERRORS[code]) {
    clearTimeout(lookAckTimer);
    lookPending = false;
    let moved = false;
    /* The REFUSED pair, which is the one we sent — not whatever is under the
       thumb now. Those are routinely different: the taken-frame handler moves
       the draft, and the chips stay live while a send is in flight, so marking
       the draft here struck out a pair nobody had claimed and left it struck out
       for the session. Falls back to the draft only if we somehow have no record
       of the send, which is better than poisoning nothing at all. */
    const refused = lookSent || draft;
    if (code === 'LOOK_TAKEN' && refused) {
      // Our advisory list was behind the room. Catch it up first, so the pair is
      // struck out before they look for it — and so the move below, and the gate
      // in restoreConfirm, both read a taken-set that knows about it.
      taken.add(lookKey(refused));
      moved = moveDraftOffClash();
    }
    lookSent = null;
    restoreConfirm();
    /* Said before the repaint, so the repaint leaves the server's own words up.
       LOOK_FIX is the "change the colour or the hat" half of those words, and it
       is only true while they are still standing on the refused pair — once we
       have moved them off it, telling them to move is telling them to undo it. */
    const refusal = frame.message || LOOK_ERRORS[code];
    lookNote(moved ? `${refusal} ${wearingNow()}` : `${refusal}${LOOK_FIX[code] || ''}`, true, true);
    paintLook();
    return;
  }

  /* The host started while they were still choosing, so the server has let
     them out of the room. Factual, not a telling-off. */
  if (code === 'NOT_LOCKED') {
    clearTimeout(handshakeTimer);
    forgetIdentity();
    joinState = 'idle';
    state = null;
    setJoinBusy(false);
    setJoinError(
      `${frame.message || 'The gate shut while you were still choosing.'} There will be another game — the big screen will say when.`
    );
    setScreen('join');
    return;
  }

  if (joinState === 'rejoining') {
    // The game moved on without us. Say so plainly and ask for a name again.
    clearTimeout(handshakeTimer);
    forgetIdentity();
    joinState = 'idle';
    state = null;
    setJoinBusy(false);
    setJoinError(
      code === 'ROOM_NOT_FOUND'
        ? 'That paddock has been packed up. Get the code off the big screen and join again.'
        : 'We lost track of you. Put your name in and throw the latch again.'
    );
    setScreen('join');
    return;
  }

  if (joinState === 'joining') {
    clearTimeout(handshakeTimer);
    joinState = 'idle';
    setJoinBusy(false);
    setJoinError(message);
    if (code === 'ROOM_NOT_FOUND') revealRoomField();
    setScreen('join');
    return;
  }

  if (code === 'ROOM_NOT_FOUND') {
    forgetIdentity();
    joinState = 'idle';
    state = null;
    setJoinBusy(false);
    setJoinError('That paddock has been packed up. Get the code off the big screen and join again.');
    setScreen('join');
    return;
  }

  /* A refused host control. In the lobby that is almost always the player
     minimum, which the server words better than we could; NOT_HOST means it
     passed to someone else while their thumb was coming down. Both are things
     the lever comes back from, said where the lever is. */
  if (gateSent && state && gateSent === gateKey()) {
    clearTimeout(gateAckTimer);
    gateSent = null;
    gateWarn = frame.message || 'That did not take. Try it again.';
    render();
    return;
  }

  // Mid-game rejection — almost always a late answer. Hand the slate back and
  // roll our idea of what the server holds back to what it held before.
  if (pendingSubmit) {
    pendingSubmit = false;
    clearTimeout(submitAckTimer);
    answerOnFile = beforeSubmit.onFile;
    myAnswer = beforeSubmit.text;
    if (!gateShut) unlock();
    el.lockNote.classList.add('is-warn');
    setText(el.lockNote, frame.message || 'That answer did not take. Try again.');
  }
}

/* ------------------------------------------------------------------ transport */

/* The rejoin budget must measure the SERVER's response time, not how long the
   socket took to come up: net.js backs off between attempts, so a phone whose
   radio is reassociating can burn the whole budget before a frame is ever sent.
   Armed — and re-armed — the moment identify()'s frame actually goes out. */
function armRejoinHandshake() {
  clearTimeout(handshakeTimer);
  handshakeTimer = setTimeout(() => {
    if (joinState !== 'rejoining') return;
    // A transport that never opened is not a server rejection. Say so on the
    // wire and keep the stored identity — the room may still be holding it.
    if (!everOpen) {
      setText(el.wire, 'Cannot reach the paddock — check you are on the same network.');
      show(el.wire, true);
      return;
    }
    joinState = 'idle';
    forgetIdentity();
    setJoinBusy(false);
    setJoinError('Could not get you back in. Put your name in and throw the latch again.');
  }, HANDSHAKE_MS);
}

function onStatus(status) {
  if (status === 'open') {
    everOpen = true;
    clearTimeout(offlineTimer);
    show(el.wire, false);
    if (joinState === 'rejoining') armRejoinHandshake();
    return;
  }
  if (status === 'reconnecting') {
    setText(el.wire, 'Lost the paddock for a moment — getting you back in.');
    show(el.wire, true);
    return;
  }
  if (status === 'connecting') {
    if (everOpen) {
      setText(el.wire, 'Lost the paddock for a moment — getting you back in.');
      show(el.wire, true);
    } else {
      clearTimeout(offlineTimer);
      offlineTimer = setTimeout(() => {
        if (everOpen) return;
        setText(el.wire, 'Cannot reach the paddock — check you are on the same network.');
        show(el.wire, true);
      }, 4000);
    }
  }
}

function identify() {
  /* The token is the whole of the proof; the playerId is only the address. The
     server refuses a rejoin whose token does not match the one it holds for
     that player, and it is right to — without it, anyone who has read a state
     frame knows every id in the room and could ask to be any of them.

     So an identity that has lost its token is not an identity at all. That is a
     record written by an older build, or a half-written one, and a phone that
     keeps offering it would sit on "Getting you back in…" through every
     reconnect for the rest of the evening, being refused each time and never
     saying so. Drop it here and hand the join form back: joining fresh costs
     them a name, and a silent forever-rejoin costs them the game. */
  if (me.playerId && me.room) {
    if (me.token) {
      return { t: 'player.rejoin', room: me.room, playerId: me.playerId, token: me.token };
    }
    clearTimeout(handshakeTimer);
    /* The form is what they are being sent back to, so it has to be usable:
       this phone knows the paddock it was in even though the player may never
       have typed the code — it arrived on a link — and asking for four
       characters they have never seen is a dead end, not a fresh start. */
    if (!el.room.value) el.room.value = me.room;
    if (!el.name.value) el.name.value = me.name;
    forgetIdentity();
    joinState = 'idle';
    state = null;
    setJoinBusy(false);
    setJoinError('We could not prove this phone is yours. Put your name in and throw the latch again.');
    setScreen('join');
  }
  /* A join deferred by the reconnect above: the socket is now on the right
     paddock, so this is the first thing it should say. */
  if (pendingJoin) {
    const frame = { t: 'player.join', room: pendingJoin.room, name: pendingJoin.name };
    pendingJoin = null;
    return frame;
  }
  return null;
}

/* ------------------------------------------------------------------ boot */

function boot() {
  // Built once, before anything can ask for it: sixty controls whose state is
  // repainted in place, so a look.taken frame never rebuilds what is under a
  // player's thumb.
  buildPicker();

  setScreen('join');

  /* #lock-note carries every status message the answer form has — the commit,
     an empty slate, a send that did not go, a server rejection, the gate
     shutting. It is permanently rendered with its height reserved, so it is a
     reliable live region: announce it, and describe the slate with it so the
     text is reachable on demand as well. */
  el.lockNote.setAttribute('role', 'status');
  el.lockNote.setAttribute('aria-live', 'polite');
  el.lockNote.setAttribute('aria-atomic', 'true');
  el.answer.setAttribute('aria-describedby', 'lock-note');

  const params = new URLSearchParams(location.search);
  const queryRoom = sanitizeCode(params.get('room'));
  const saved = store.read(KEY_ID);

  if (queryRoom.length === ROOM_LEN) {
    el.room.value = queryRoom;
    useKnownRoom(queryRoom);
  } else {
    revealRoomField();
  }

  /* The token is as much a part of a usable record as the id is. A record with
     an id and no token is one this build cannot rejoin on — an older session,
     or a write that only half landed — and asking anyway would put the phone on
     "Getting you back in…" for a handshake that can only ever be refused. It is
     treated as no record at all, so the branch below drops it and they join
     fresh, which is a name and one tap rather than a screen that never moves. */
  const canRejoin =
    saved && saved.playerId && typeof saved.token === 'string' && saved.token && saved.room &&
    (queryRoom.length !== ROOM_LEN || saved.room === queryRoom);

  if (canRejoin) {
    me.playerId = saved.playerId;
    me.token = saved.token;
    me.room = saved.room;
    me.name = saved.name || '';
    remembered = true;
    applyIdentity();

    /* Draw them back as the sheep they were straight away, rather than as a
       blank one for the length of a handshake. It is optimism only: the first
       state frame carrying our record replaces it, whatever it says. */
    const savedLook = saved.look ? validateLook(saved.look) : null;
    if (savedLook && !savedLook.error) {
      me.look = savedLook.look;
      draft = { ...me.look };
      applyLook(me.look);
    }

    el.name.value = me.name;
    joinState = 'rejoining';
    setJoinBusy(true, 'Getting you back in…');
    // The handshake timer is armed by onStatus('open'), once there is a socket
    // to have sent player.rejoin down. Never from here.
  } else {
    if (saved) { store.drop(KEY_ID); store.drop(KEY_ANSWER); }
    if (queryRoom.length === ROOM_LEN) el.name.focus({ preventScroll: true });
  }

  /* Null means "do not open yet". A phone with no room — arrived without a
     ?room= link and has not typed a code — has no paddock to attach to, and
     opening against none would put it in a room of its own making. */
  net = connect({
    onFrame,
    onStatus,
    identify,
    query: () => {
      const room = me.room || (pendingJoin && pendingJoin.room) || '';
      socketRoom = room;
      return room ? { room, role: 'player' } : null;
    },
  });
}

/* Sprites still carry the eartag, the gate and the tally. The sheep and the
   forty hats are art, and the manifest carries the aspect ratio every hat is
   placed by — so both must land before the picker paints, or the first hat a
   player sees is assumed square and sits wrong. */
await Promise.all([loadSprites(), loadArt()]);
boot();
