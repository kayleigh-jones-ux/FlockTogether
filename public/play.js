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
  HAT_BOX,
  colourById,
  hatById,
  colourToken,
  lookKey,
  validateLook,
} from '/shared/look.js';

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
  lookHat: $('look-hat'),
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
  lobbyHat: $('lobby-hat'),

  question: $('question'),
  sheepHat: $('sheep-hat'),
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

  rosetteFinal: $('rosette-final'),
  bigScore: $('big-score'),
  scoreUnit: $('score-unit'),
  standing: $('standing'),
  scoresSub: $('scores-sub'),
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

const me = { playerId: null, room: '', name: '', look: null };

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
   refresh: the id, the room, and the sheep they made. The look rides in the
   same record because it is the same fact — who this phone is in this room. */
function writeIdentity() {
  if (!me.playerId || !me.room) return;
  remembered = true;
  store.write(KEY_ID, { playerId: me.playerId, room: me.room, name: me.name, look: me.look });
}

/* Written once on the way in, not on every frame. */
function rememberIdentity() {
  if (remembered) return;
  writeIdentity();
}

function forgetIdentity() {
  remembered = false;
  me.playerId = null;
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
   pair is what has to be unique, so nothing here greys out a whole colour
   because one pair using it has gone: a colour is only spent once every hat
   against it is taken, and a hat once every colour is. */

const SVG_NS = 'http://www.w3.org/2000/svg';

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

const colourSpent = (colorId) => HATS.every((hat) => isTaken(colorId, hat.id));
const hatSpent = (hatId) => FLEECE_COLOURS.every((colour) => isTaken(colour.id, hatId));

/* look.js owns where a hat sits on a sheep. Reading HAT_BOX here rather than
   writing 78/-30/60 into the markup keeps that one place true. */
function placeHats() {
  for (const use of document.querySelectorAll('.use-hat')) {
    use.setAttribute('x', String(HAT_BOX.x));
    use.setAttribute('y', String(HAT_BOX.y));
    use.setAttribute('width', String(HAT_BOX.size));
    use.setAttribute('height', String(HAT_BOX.size));
  }
}

function setHat(use, hatId) {
  if (!use) return;
  if (!hatId) {
    use.setAttribute('hidden', '');
    return;
  }
  use.setAttribute('href', `#sp-hat-${hatId}`);
  use.removeAttribute('hidden');
}

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
  setHat(el.lobbyHat, hat ? hat.id : '');
  setHat(el.sheepHat, hat ? hat.id : '');
}

/* Sticky messages are the ones a repaint must not talk over: a rejection or a
   send that did not go stays up until the player does something about it,
   rather than being wiped by the next unrelated frame from the room. */
let stickyNote = false;

function lookNote(message, warn, sticky) {
  setText(el.lookNote, message);
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
  chip.addEventListener('click', () => {
    if (colourSpent(colour.id)) {
      lookNote(`Every hat is taken with ${colour.name}. Pick another colour.`, true, true);
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

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'chip-hat');
  svg.setAttribute('viewBox', `0 0 ${HAT_BOX.size} ${HAT_BOX.size}`);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#sp-hat-${hat.id}`);
  svg.append(use);

  const name = document.createElement('span');
  name.className = 'chip-name';
  name.textContent = hat.name;

  chip.append(svg, name);
  chip.addEventListener('click', () => {
    if (hatSpent(hat.id)) {
      lookNote(`Every colour is taken with the ${hat.name}. Pick another hat.`, true, true);
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

  for (const hat of HATS) el.hatGrid.append(hatChip(hat));
}

/* --- painting the state onto them --------------------------------------- */

function dressChip(chip, name, chosen, spent, clash, why) {
  if (!chip) return;
  chip.setAttribute('aria-pressed', chosen ? 'true' : 'false');
  chip.dataset.state = spent ? 'spent' : clash ? 'clash' : 'free';
  /* aria-disabled, not disabled: a control nobody can reach is a control that
     cannot tell anybody why it is unavailable. The click handler refuses it
     and says the same thing out loud. */
  chip.setAttribute('aria-disabled', spent ? 'true' : 'false');
  if (spent || clash) chip.setAttribute('aria-label', `${name} — ${why}`);
  else chip.removeAttribute('aria-label');
}

function paintLook() {
  const colour = draft ? colourById(draft.colorId) : null;
  const hat = draft ? hatById(draft.hatId) : null;
  if (!colour || !hat) return;

  el.lookSheep.style.setProperty('--fleece', fleeceValue(colour));
  setHat(el.lookHat, hat.id);
  setText(el.lookName, `${colour.name} · ${hat.name}`);

  for (const c of FLEECE_COLOURS) {
    const spent = colourSpent(c.id);
    const clash = !spent && isTaken(c.id, hat.id);
    dressChip(
      colourChips.get(c.id), c.name, c.id === colour.id, spent, clash,
      spent ? 'taken with every hat' : `taken with the ${hat.name}`
    );
  }

  for (const h of HATS) {
    const spent = hatSpent(h.id);
    const clash = !spent && isTaken(colour.id, h.id);
    dressChip(
      hatChips.get(h.id), h.name, h.id === hat.id, spent, clash,
      spent ? 'taken with every colour' : `taken with ${colour.name}`
    );
  }

  // Never talk over a rejection that is still standing.
  if (lookPending || stickyNote) return;
  if (isTaken(colour.id, hat.id)) {
    lookNote(
      `Someone is already ${colour.name} wearing the ${hat.name}. Change the colour or the hat.`,
      true
    );
  } else {
    lookNote(LOOK_RULE, false);
  }
}

function pick(part) {
  if (!draft) return;
  draft = {
    colorId: part.colorId || draft.colorId,
    hatId: part.hatId || draft.hatId,
  };
  draftDirty = true;
  stickyNote = false; // they have answered the last thing we told them
  paintLook();
}

/* The opening suggestion, and only that. raddle.js still hashes the playerId
   to one of eight dyes; it is no longer what they wear, but it is what stops
   the picker opening on the same sheep for all twenty of them. */
function suggestLook() {
  const seed = me.playerId ? raddleFor(me.playerId).index : 1;
  const colour = FLEECE_COLOURS[((seed - 1) * 3 + 1) % FLEECE_COLOURS.length];
  const hat = HATS[(seed - 1) % HATS.length];
  return firstFree(colour.id, hat.id);
}

/* Move the hat before the colour: a suggestion that clashes should keep the
   fleece it opened on. 600 pairs against a 20-player cap means the last
   fallback is unreachable, but it still has to return a look. */
function firstFree(colorId, hatId) {
  if (!isTaken(colorId, hatId)) return { colorId, hatId };

  const fromHat = Math.max(0, HATS.findIndex((h) => h.id === hatId));
  for (let i = 1; i < HATS.length; i += 1) {
    const hat = HATS[(fromHat + i) % HATS.length];
    if (!isTaken(colorId, hat.id)) return { colorId, hatId: hat.id };
  }

  const fromColour = Math.max(0, FLEECE_COLOURS.findIndex((c) => c.id === colorId));
  for (let i = 1; i <= FLEECE_COLOURS.length; i += 1) {
    const colour = FLEECE_COLOURS[(fromColour + i) % FLEECE_COLOURS.length];
    for (const hat of HATS) {
      if (!isTaken(colour.id, hat.id)) return { colorId: colour.id, hatId: hat.id };
    }
  }

  return { colorId, hatId };
}

/* --- confirming --------------------------------------------------------- */

function restoreConfirm() {
  el.lookGo.disabled = false;
  setText(el.lookGo, isLocked() ? 'Change my sheep' : "That's my sheep");
}

function confirmLook() {
  if (lookPending || !draft) return;

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
  el.lookGo.disabled = true;
  setText(el.lookGo, 'Marking you up…');
  lookNote('Taking that to the paddock…', false);
  // Bound the wait: an ack that cannot arrive must not leave the lever dead.
  clearTimeout(lookAckTimer);
  lookAckTimer = setTimeout(() => {
    if (!lookPending) return;
    lookPending = false;
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
}

function renderScores(you) {
  const isFinal = state.phase === 'final' || state.scoreboardReason === 'final';
  const players = state.players || [];
  const scores = players.map((p) => p.score || 0);
  const mine = you.score || 0;
  const ahead = scores.filter((s) => s > mine).length;
  const level = Math.max(0, scores.filter((s) => s === mine).length - 1);
  const place = ahead + 1;
  const total = players.length;

  screens.scores.dataset.final = isFinal ? 'true' : 'false';
  setText(el.bigScore, String(mine));
  setText(el.scoreUnit, plural(mine, 'point', 'points'));

  // Ties are stated honestly: joint 2nd is joint 2nd, never rounded to 2nd.
  const placeText = total > 0 ? `${level > 0 ? 'Joint ' : ''}${ordinal(place)} of ${total}` : '';

  if (isFinal) {
    if (place === 1) {
      show(el.rosetteFinal, true);
      setText(el.standing, level > 0 ? `Joint first with ${level} ${plural(level, 'other', 'others')}` : 'First in the flock');
      setText(el.scoresSub, 'That is the flock you read best. Take the rosette.');
    } else {
      show(el.rosetteFinal, false);
      setText(el.standing, placeText);
      setText(el.scoresSub, 'The whole board is on the big screen.');
    }
  } else {
    show(el.rosetteFinal, false);
    setText(el.standing, placeText);
    setText(el.scoresSub, 'The whole board is on the big screen.');
  }
}

/* ------------------------------------------------------------------ frames */

function onFrame(frame) {
  if (!frame || typeof frame.t !== 'string') return;

  if (frame.t === 'joined') {
    clearTimeout(handshakeTimer);
    joinState = 'in';
    me.playerId = frame.playerId || me.playerId;
    me.room = frame.room || me.room;
    me.name = frame.name || me.name;
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

  /* Advisory only — the server is the authority and rejects a race anyway —
     so this never touches what they have chosen, only what is struck out. */
  if (frame.t === 'look.taken') {
    taken = new Set((Array.isArray(frame.taken) ? frame.taken : []).map(String));
    paintLook();
    return;
  }

  if (frame.t === 'look.ok') {
    clearTimeout(lookAckTimer);
    lookPending = false;
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

  /* A refused look. What they made stays exactly as it is on screen — they
     are told which half of the pair to move, not sent back to the start. */
  if (lookPending && LOOK_ERRORS[code]) {
    clearTimeout(lookAckTimer);
    lookPending = false;
    restoreConfirm();
    if (code === 'LOOK_TAKEN' && draft) {
      // Our advisory list was behind the room. Catch it up so the chip they
      // need to move is struck out before they look for it.
      taken.add(lookKey(draft));
    }
    // Said before the repaint, so the repaint leaves the server's own words up.
    lookNote(`${frame.message || LOOK_ERRORS[code]}${LOOK_FIX[code] || ''}`, true, true);
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
  if (me.playerId && me.room) return { t: 'player.rejoin', room: me.room, playerId: me.playerId };
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
  placeHats();
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

  const canRejoin =
    saved && saved.playerId && saved.room &&
    (queryRoom.length !== ROOM_LEN || saved.room === queryRoom);

  if (canRejoin) {
    me.playerId = saved.playerId;
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

await loadSprites(); // symbols must exist before the first <use> is painted
boot();
