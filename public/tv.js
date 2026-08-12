/* ==========================================================================
   FLOCK TOGETHER — the shared display.

   Renders server state onto the paddock map. It owns no game state of its
   own: every frame is a full snapshot, so rendering is a pure function of it.
   ========================================================================== */

import { connect, loadSprites, countdown } from '/shared/net.js';
import { raddleVarForRank } from '/shared/raddle.js';
import { colourById, hatById, colourToken } from '/shared/look.js';
import { loadArt, headroomFor, sheepArtHTML } from '/shared/sheep-art.js';

const $ = (sel, root = document) => root.querySelector(sel);
const bind = (name) => document.querySelector(`[data-bind="${name}"]`);
const region = (name) => document.querySelector(`[data-region="${name}"]`);

const el = {
  field: $('.field'),
  scenes: Object.fromEntries(
    [...document.querySelectorAll('[data-scene]')].map((n) => [n.dataset.scene, n]),
  ),
  clock: $('.clock'),
  startBtn: document.querySelector('[data-action="start"]'),
  packInput: document.getElementById('pack-code'),
  packApply: document.querySelector('[data-action="pack-apply"]'),
  packClear: document.querySelector('[data-action="pack-clear"]'),
  link: bind('link'),
};

/* The set-code alphabet, matched to the server: no O, 0, I, 1 or L. */
const PACK_ALPHABET = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;
const sanitizePack = (v) => String(v || '').toUpperCase().replace(PACK_ALPHABET, '').slice(0, 6);

let latest = null;
let stopClock = null;
let lastRoundRendered = -1;

/* --- Small helpers ------------------------------------------------------ */

const text = (node, value) => {
  if (node && node.textContent !== String(value)) node.textContent = String(value);
};

/** Escaping matters: player names and answers are untrusted free text. */
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* --- The player's look --------------------------------------------------
   A look is server state, but it still arrives over a socket, so both halves
   are run back through look.js before they touch the DOM: the colour id ends
   up inside a style attribute and the hat id inside a sprite href, and an id
   this build has never heard of is treated as no look rather than passed
   through. Anyone without one — a simulated player, anyone who never chose —
   keeps the raddleFor(id) hash and the enamel fleece they have always had. */
function lookOf(who) {
  const raw = who && who.look;
  if (!raw) return null;
  const colour = colourById(raw.colorId);
  const hat = hatById(raw.hatId);
  return colour || hat ? { colour, hat } : null;
}

/* The token name comes from look.js so it can never drift from the stylesheet
   that defines it. The enamel fallback is not decoration: a --fleece-* that is
   not defined yet makes `fill` invalid at computed-value time, and the sheep
   would render black on a screen a room is watching. Unchosen is the right
   failure. */
const fleeceStyle = (look) =>
  look && look.colour ? `--fleece:var(${colourToken(look.colour.id)}, var(--enamel));` : '';

/* --- Does the ink still separate this fleece from the field? -------------
   The sheep's outline is hedgerow ink, and it is the only thing holding the
   fleece apart from the ground it stands on. A fleece from the deep band of
   the palette is nearly as dark as that ink — measured, around 2:1 — and the
   pasture and the paddock tints are dark too, so the outline stops being an
   edge and the sheep collapses into a blotch at video-call scale. Those
   colours, and only those, get a pale rim outside the ink (see tv.css).

   Measured rather than listed: the fleece hexes come from look.js and the ink
   from the token it is actually drawn with, so this stays honest if either
   moves. The floor is 3:1, the same one any non-text graphic has to clear;
   the margin above it is there because this line is one sprite unit wide by
   the time a paddock sheep renders inside a screenshared window. Every deep
   fleece measures 1.0-1.5:1 against the ground, so once the ink goes there is
   nothing else holding the animal off the field. */
const INK_SEPARATION = 3.5;

const HEX = /^#([0-9a-f]{6})$/i;

function luminance(value) {
  const m = HEX.exec(String(value).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = (byte) => {
    const c = byte / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

let inkLuminance;
const rimByColour = new Map();

function fleeceNeedsRim(colour) {
  if (!colour) return false;
  const cached = rimByColour.get(colour.id);
  if (cached !== undefined) return cached;
  if (inkLuminance === undefined) {
    inkLuminance = luminance(
      getComputedStyle(document.documentElement).getPropertyValue('--hedge'),
    );
  }
  const fleece = luminance(colour.hex);
  /* If either colour is unreadable, leave the sprite exactly as authored. */
  const needs =
    fleece !== null &&
    inkLuminance !== null &&
    (fleece + 0.05) / (inkLuminance + 0.05) < INK_SEPARATION;
  rimByColour.set(colour.id, needs);
  return needs;
}

/* Hats stick out of the sheep's own box and the trimmed art gives them no
   shared one to stick out of, so the room above is measured rather than
   assumed — see headroomFor. The lobby flock and every paddock clip their
   overflow, and a sliced-off crown reads as a rendering fault.

   A whole list shares one number, because sheep sitting at different heights
   reads as a fault too, and a list with no hats in it reserves nothing at all
   — so a flock of unchosen sheep sits exactly where it always did. */
const headroomOf = (looks) =>
  headroomFor(looks.map((look) => ((look || {}).hat || {}).id).filter(Boolean));

function sheepArt(cls, look, headroom, marked) {
  const hat = look && look.hat;
  return sheepArtHTML({ className: cls, hatId: hat ? hat.id : '', headroom, marked });
}

function sheepMarkup(p, { marked, headroom }) {
  const look = lookOf(p);
  return `
    <li class="sheep" style="${fleeceStyle(look)}"
        data-marked="${marked ? 'true' : 'false'}"
        data-deep="${fleeceNeedsRim(look && look.colour) ? 'true' : 'false'}"
        data-connected="${p.connected === false ? 'false' : 'true'}">
      ${sheepArt('sheep__art', look, headroom, marked)}
      <span class="sheep__name">${esc(p.name)}</span>
    </li>`;
}

/* Only rewrite a list when its content actually changed — the display runs for
   a whole party and needless DOM churn restarts the mark animations. */
function setHTML(node, html) {
  if (!node) return;
  if (node.dataset.sig === html) return;
  node.dataset.sig = html;
  node.innerHTML = html;
}

/* --- Scenes ------------------------------------------------------------- */

function showScene(name) {
  for (const [key, node] of Object.entries(el.scenes)) {
    node.hidden = key !== name;
  }
  el.field.dataset.phase = name;
}

const SCENE_FOR_PHASE = {
  lobby: 'lobby',
  question: 'question',
  grouping: 'grouping',
  reveal: 'reveal',
  scores: 'record',
  final: 'record',
};

/* --- Header ------------------------------------------------------------- */

function renderHeader(s) {
  const lot = region('lot');
  const rot = region('rotation');

  if (s.room) {
    lot.hidden = false;
    text(bind('room'), s.room);
  }

  if (s.totalRounds > 0) {
    rot.hidden = false;
    const pips = Array.from({ length: s.totalRounds }, (_, i) => {
      const state = i < s.roundIndex ? 'done' : i === s.roundIndex ? 'now' : 'todo';
      return `<li data-state="${state}"></li>`;
    }).join('');
    setHTML(bind('pips'), pips);
    bind('pips').setAttribute(
      'aria-label',
      `Round ${s.roundIndex + 1} of ${s.totalRounds}`,
    );
  } else {
    rot.hidden = true;
  }
}

/* --- Lobby -------------------------------------------------------------- */

function renderLobby(s) {
  const n = s.players.length;
  text(
    bind('lobbyHeadline'),
    n === 0 ? 'Waiting for the flock' : n === 1 ? 'One sheep in the paddock' : `${n} sheep in the paddock`,
  );

  const min = 2;
  const ready = n >= min;
  text(
    bind('lobbyNote'),
    ready ? 'Open the gate when everyone is in' : `${min - n} more needed to open the gate`,
  );

  el.startBtn.disabled = !ready;

  renderChoosing(s);
  renderPack(s);

  const headroom = headroomOf(s.players.map(lookOf));
  setHTML(
    bind('lobbyFlock'),
    s.players.map((p) => sheepMarkup(p, { marked: false, headroom })).join(''),
  );
}

/* Joined, but still at the gate picking a fleece and a hat. The headcount
   above counts only the flock proper, so without this the host watches four
   phones join and reads three sheep. It is reassurance, not a status board:
   one line, no count of who, and gone the moment everyone has chosen. */
let choosingLine = null;

function renderChoosing(s) {
  const n = Number(s.choosing) || 0;
  if (!choosingLine) {
    const note = bind('lobbyNote');
    if (!note) return;
    choosingLine = document.createElement('p');
    /* Same size step as the note it follows — the surface scales `legend` for
       a television — but tv.css takes the stencil back off it. */
    choosingLine.className = 'lobbyflock__choosing legend';
    note.insertAdjacentElement('afterend', choosingLine);
  }
  choosingLine.hidden = n <= 0;
  if (n > 0) {
    text(
      choosingLine,
      n === 1 ? 'One more still choosing a sheep' : `${n} more still choosing their sheep`,
    );
  }
}

/* Which question set the next game will draw from. The pack rides on every
   frame, but only the lobby shows it — the input has no meaning once the gate
   is open. The input value is never written from state, so a host mid-type is
   never interrupted; only the status line and the clear button reflect the
   server's answer. */
function renderPack(s) {
  const pack = s.pack || null;
  if (pack) {
    text(
      bind('packStatus'),
      `Set “${pack.name}” — ${pack.size} ${pack.size === 1 ? 'question' : 'questions'}`,
    );
  } else {
    text(bind('packStatus'), 'Using the full question bank');
  }
  if (el.packClear) el.packClear.hidden = !pack;
}

/* --- Question ----------------------------------------------------------- */

function renderQuestion(s) {
  text(bind('question'), s.question ?? '');

  const answered = s.players.filter((p) => p.answered).length;
  const total = s.players.filter((p) => p.connected !== false).length;
  text(bind('answerTally'), `${answered} of ${total} marked`);

  const headroom = headroomOf(s.players.map(lookOf));
  setHTML(
    bind('waitingFlock'),
    s.players.map((p) => sheepMarkup(p, { marked: p.answered, headroom })).join(''),
  );

  startClock(s);
}

/* The gate that swung shut across the round used to be driven from here. It is
   gone: countdown() only calls back when the whole second changes, so the angle
   moved in one jump per second and the CSS transition ratcheted through each
   one. Nothing is left to interpolate — the clock is a number, and a number
   changing once a second is exactly right. */
function startClock(s) {
  if (stopClock) stopClock();
  stopClock = null;
  if (!s.endsAt) return;

  stopClock = countdown(s.endsAt, (whole) => {
    text(bind('seconds'), whole);
    el.clock.dataset.state = whole <= 10 ? 'urgent' : 'calm';
  });
}

/* --- Reveal ------------------------------------------------------------- */

/* --- Field subdivision -------------------------------------------------
   A squarified treemap. This is the reveal: the field is divided into
   paddocks whose AREA is the headcount, so hedgerows turn corners and the
   winning group is the biggest piece of land rather than the longest bar.
   Returns rects in a 0..100 coordinate space. */
function subdivide(weights, x, y, w, h) {
  const out = [];
  const items = weights.map((value, i) => ({ value, i }));
  const total = items.reduce((t, it) => t + it.value, 0);
  if (total <= 0) return out;

  let scale = (w * h) / total;
  let rest = items.slice();
  let rx = x;
  let ry = y;
  let rw = w;
  let rh = h;

  const worst = (row, side) => {
    const sum = row.reduce((t, it) => t + it.value, 0) * scale;
    const mx = Math.max(...row.map((it) => it.value * scale));
    const mn = Math.min(...row.map((it) => it.value * scale));
    if (sum <= 0 || side <= 0) return Infinity;
    return Math.max((side * side * mx) / (sum * sum), (sum * sum) / (side * side * mn));
  };

  while (rest.length) {
    const side = Math.min(rw, rh);
    const row = [rest[0]];
    let k = 1;
    while (k < rest.length && worst([...row, rest[k]], side) <= worst(row, side)) {
      row.push(rest[k]);
      k += 1;
    }

    const rowSum = row.reduce((t, it) => t + it.value, 0) * scale;
    const thickness = side > 0 ? rowSum / side : 0;

    let offset = 0;
    for (const it of row) {
      const len = rowSum > 0 ? (it.value * scale * side) / rowSum : 0;
      out[it.i] =
        rw <= rh
          ? { x: rx + offset, y: ry, w: len, h: thickness }
          : { x: rx, y: ry + offset, w: thickness, h: len };
      offset += len;
    }

    if (rw <= rh) {
      ry += thickness;
      rh -= thickness;
    } else {
      rx += thickness;
      rw -= thickness;
    }
    rest = rest.slice(row.length);
    if (rw <= 0.01 || rh <= 0.01) break;
  }

  /* Any cell the loop could not place (degenerate geometry) still gets land
     rather than vanishing — an unrendered answer is lost content. */
  for (let i = 0; i < items.length; i += 1) {
    if (!out[i]) out[i] = { x, y: y + h - 0.01, w, h: 0.01 };
  }
  return out;
}

function renderReveal(s) {
  const groups = s.groups ?? [];
  const max = groups.reduce((m, g) => Math.max(m, g.answers.length), 0);
  const winners = groups.filter((g) => g.scored).length;

  text(
    bind('revealEyebrow'),
    groups.length === 0
      ? 'Nobody made it through the gate'
      : winners > 1
        ? `${winners} paddocks tied — every one of them scores`
        : 'The flock sorted itself',
  );

  /* Land is dealt by headcount, then each field settles in — smallest first,
     so the biggest paddock is the last thing to arrive. */
  const rects = subdivide(groups.map((g) => g.answers.length), 0, 0, 100, 100);

  /* An answer carries a playerId, so the sheep standing in a paddock is the
     same sheep that stood in the flock. Read the look off the answer first in
     case the server ever sends it inline, then off the player it belongs to. */
  const playerById = new Map(s.players.map((p) => [p.id, p]));
  const lookForAnswer = (a) => lookOf(a) || lookOf(playerById.get(a.playerId)) || null;
  const headroom = headroomOf(groups.flatMap((g) => g.answers.map(lookForAnswer)));

  const html = groups
    .map((g, i) => {
      const cssVar = raddleVarForRank(i);
      const count = g.answers.length;
      const r = rects[i];
      const delay = (groups.length - 1 - i) * 110;
      /* Crop rows run a different way in every field, as on a real map where
         each plot was drilled on its own pass. Deterministic on rank, so a
         re-render never reshuffles the map under the room. */
      const rows = 14 + ((i * 37) % 5) * 26;

      const answers = g.answers
        .map((a) => {
          const look = lookForAnswer(a);
          const style = fleeceStyle(look);
          return `<li class="pad-sheep"${style ? ` style="${style}"` : ''}
              data-deep="${fleeceNeedsRim(look && look.colour) ? 'true' : 'false'}">
              ${sheepArt('pad-sheep__art', look, headroom, false)}
              <span class="pad-sheep__text">${esc(a.text)}</span>
              <span class="pad-sheep__who">${esc(a.name)}</span>
            </li>`;
        })
        .join('');

      return `
        <li class="paddock" data-scored="${g.scored ? 'true' : 'false'}"
            style="--tint:${cssVar}; --x:${r.x.toFixed(3)}; --y:${r.y.toFixed(3)}; --w:${r.w.toFixed(3)}; --h:${r.h.toFixed(3)}; --rows:${rows}deg; --delay:${delay}ms">
          <span class="paddock__stake">
            ${g.scored ? `<svg class="paddock__rosette" viewBox="0 0 104 132" aria-hidden="true"><use href="#sp-rosette"/></svg>` : ''}
            <span class="paddock__label">${esc(g.label)}</span>
            <strong class="numerals paddock__count">${count}</strong>
          </span>
          <ul class="paddock__flock">${answers}</ul>
          <span class="visually-hidden">${
            g.scored ? 'Scored a point' : 'Did not score'
          }, ${count} ${count === 1 ? 'answer' : 'answers'}</span>
        </li>`;
    })
    .join('');

  setHTML(bind('paddocks'), html);

  const missed = s.noAnswer ?? [];
  const missedBox = bind('missed');
  missedBox.hidden = missed.length === 0;
  if (missed.length) {
    setHTML(
      bind('missedList'),
      missed.map((m) => `<li>${esc(m.name)}</li>`).join(''),
    );
  }

  text(
    bind('sourceNote'),
    s.groupingSource === 'fallback'
      ? 'Grouped by spelling — the shepherd was offline for that one'
      : s.groupingSource === 'claude'
        ? 'Grouped by meaning'
        : '',
  );

  void max;
}

/* --- Record sheet ------------------------------------------------------- */

const WHY = {
  third: 'A third of the way round',
  penultimate: 'One paddock left',
  final: 'Final count',
};

function renderRecord(s) {
  const isFinal = s.phase === 'final';
  const ranked = [...s.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const top = ranked.length ? ranked[0].score : 0;

  text(bind('recordTitle'), isFinal ? 'Best in show' : 'Grazing record');
  text(bind('recordWhy'), WHY[s.scoreboardReason] ?? '');

  /* Joint places are stated honestly: equal scores share a rank. */
  let rank = 0;
  let prev = null;
  const rows = ranked
    .map((p, i) => {
      if (p.score !== prev) {
        rank = i + 1;
        prev = p.score;
      }
      const lead = isFinal && p.score === top && top > 0;
      const fives = Math.floor(p.score / 5);
      const rest = p.score % 5;
      const tally =
        Array.from({ length: fives }, () => `<svg viewBox="0 0 60 48"><use href="#sp-tally"/></svg>`).join('') +
        (rest ? `<svg class="part" viewBox="0 0 60 48"><use href="#sp-tally"/></svg>` : '');

      return `
        <li class="record__row" data-lead="${lead ? 'true' : 'false'}">
          <span class="record__rank">${rank}</span>
          <span class="record__name">${esc(p.name)}</span>
          <span class="record__tally" aria-hidden="true">${tally}</span>
          <span class="record__score">${p.score}${
            lead ? `<svg class="record__rosette" viewBox="0 0 104 132" aria-hidden="true"><use href="#sp-rosette"/></svg>` : ''
          }</span>
        </li>`;
    })
    .join('');

  setHTML(bind('recordRows'), rows);
}

/* --- Render ------------------------------------------------------------- */

function render(s) {
  latest = s;
  renderHeader(s);

  const scene = SCENE_FOR_PHASE[s.phase] ?? 'lobby';
  showScene(scene);

  if (s.phase !== 'question' && stopClock) {
    stopClock();
    stopClock = null;
  }

  switch (s.phase) {
    case 'lobby':
      renderLobby(s);
      break;
    case 'question':
      /* Re-arm the clock only when the round actually changed, so a state
         broadcast mid-round does not restart the gate. */
      if (s.roundIndex !== lastRoundRendered) {
        lastRoundRendered = s.roundIndex;
        renderQuestion(s);
      } else {
        renderQuestion(s);
      }
      break;
    case 'grouping':
      break;
    case 'reveal':
      renderReveal(s);
      break;
    case 'scores':
    case 'final':
      renderRecord(s);
      break;
    default:
      break;
  }
}

/* --- Wire up ------------------------------------------------------------ */

/* Sprites still carry the rosette, the tally and the gate. The sheep and the
   forty hats come from the art manifest, and it must be in hand before the
   first flock is painted: without it every hat is assumed square and sits
   wrong for one frame. */
await Promise.all([loadSprites(), loadArt()]);

/* The display's own room, remembered per tab. If this tab's socket drops we
   must re-attach to the SAME paddock: asking for a new one would hand out a
   fresh code and silently orphan every phone already joined. */
const ROOM_KEY = 'flock.host.room';
let myRoom = sessionStorage.getItem(ROOM_KEY) || null;

const net = connect({
  /* The room has to be in the URL, not only in the frame: the socket is routed
     to one paddock before host.resume is ever read. Without this a reconnect
     would open a brand-new paddock and orphan every phone already joined —
     which is the exact failure the ROOM_KEY above exists to prevent. */
  query: () => (myRoom ? { room: myRoom } : {}),
  identify: () => (myRoom ? { t: 'host.resume', room: myRoom } : { t: 'host.create' }),
  onFrame(frame) {
    switch (frame.t) {
      case 'room.created': {
        myRoom = frame.room;
        sessionStorage.setItem(ROOM_KEY, frame.room);
        text(bind('roomBig'), frame.room);
        text(bind('room'), frame.room);
        text(bind('joinUrl'), frame.joinUrl.replace(/^https?:\/\//, ''));
        const holder = bind('qr');
        if (frame.qr) holder.innerHTML = `<img src="${frame.qr}" alt="QR code to join at ${esc(frame.joinUrl)}">`;
        break;
      }
      case 'state':
        render(frame);
        break;
      case 'error':
        /* A bad set code is a lobby-local problem: say so on the set line and
           leave the room alone, rather than raising the connection banner. */
        if (frame.code === 'PACK_NOT_FOUND') {
          text(bind('packStatus'), frame.message || 'No set with that code.');
          break;
        }
        /* The room we were resuming is genuinely gone — the server restarted,
           or it was swept while empty. Forget it and open a fresh paddock
           rather than sitting on a dead code. */
        if (frame.code === 'ROOM_NOT_FOUND' && myRoom) {
          myRoom = null;
          sessionStorage.removeItem(ROOM_KEY);
          net.send({ t: 'host.create' });
          break;
        }
        el.link.hidden = false;
        text(el.link, frame.message || frame.code);
        break;
      default:
        break;
    }
  },
  onStatus(status) {
    if (status === 'open') {
      el.link.hidden = true;
      return;
    }
    el.link.hidden = false;
    text(el.link, status === 'reconnecting' ? 'Reconnecting to the field' : 'Connecting');
  },
});

el.startBtn.addEventListener('click', () => {
  el.startBtn.disabled = true;
  net.send({ t: 'host.start' });
});

/* Arming a custom set. The server validates the code and echoes the resolved
   set back on the next state frame; a miss comes back as PACK_NOT_FOUND. */
if (el.packInput) {
  el.packInput.addEventListener('input', () => {
    const clean = sanitizePack(el.packInput.value);
    if (el.packInput.value !== clean) el.packInput.value = clean;
  });
  el.packInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); el.packApply.click(); }
  });
}
if (el.packApply) {
  el.packApply.addEventListener('click', () => {
    net.send({ t: 'host.pack', code: sanitizePack(el.packInput.value) });
  });
}
if (el.packClear) {
  el.packClear.addEventListener('click', () => {
    el.packInput.value = '';
    net.send({ t: 'host.pack', code: '' });
  });
}

/* A host leaving the tab open all evening should not accumulate timers. */
window.addEventListener('pagehide', () => {
  if (stopClock) stopClock();
  net.close();
});

void latest;
