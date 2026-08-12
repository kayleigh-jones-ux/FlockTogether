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
  /* No start control. The first phone to lock in becomes the host and opens
     the gate from their own hand; this screen only ever says who that is. */
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

/* There is deliberately no luminance test here any more.
 *
 * This file used to measure every chosen fleece against hedgerow ink and hand
 * the dark ones a doubled enamel rim outside the outline, on the grounds that
 * a deep fleece and the ink are near enough the same value that the silhouette
 * gives out. The measurement was right and the cure was wrong: it made a
 * sheep's edge a function of its colour, so two players standing side by side
 * in the same flock were drawn with different outlines, and a pale halo reads
 * as a glow on a screen where nothing else glows. Every sheep now carries the
 * same slight dark drop shadow instead (tv.css), which separates the animal
 * from the field the same way for everyone — legibility stops being something
 * a player can lose by picking the colour they liked. */

/* --- Which sheep a player is drawn as -----------------------------------
   The phone shows each player their own animal on the score screen and this
   display shows the same player at the same moment, so the rule is copied
   exactly rather than approximated: the room must never watch one screen call
   someone happy while the other calls them lost.

   Thirds of the field by rank, and a streak that overrides all of it. `rank` is
   a strict TOTAL order from the server (see protocol.ts) — no two players ever
   share one — which is what makes thirds safe to take: shared ranks would put
   two people in the same third and leave another third empty. */
const POSE_TOP = 'sheep-happy';
const POSE_MID = 'sheep-idle';
const POSE_LOW = 'sheep-confused';
const POSE_STREAK = 'sheep-running';

/* Two consecutive scoring rounds and the animal runs; three and it also earns
   a flame beside its score. Both thresholds are the phone's, and both are
   stated once here rather than inline at each site that tests them. */
const STREAK_RUNNING = 2;
const STREAK_FLAME = 3;

const streakOf = (p) => Number(p && p.streak) || 0;

function poseFor(p, total) {
  if (!p) return POSE_MID;
  /* A streak is about momentum, not position: a player climbing from last
     place is running whatever third they are still standing in. */
  if (streakOf(p) >= STREAK_RUNNING) return POSE_STREAK;
  const rank = Number(p.rank) || 0;
  const n = Number(total) || 0;
  /* Before anyone has been ranked — the lobby, or a frame from a build that
     predates `rank` — every sheep stands the way it always did, rather than a
     third of the flock looking defeated for no reason at all. */
  if (rank < 1 || n < 1) return POSE_MID;
  const third = rank / n;
  return third <= 1 / 3 ? POSE_TOP : third <= 2 / 3 ? POSE_MID : POSE_LOW;
}

/* The streak flame. A count, not a name, but it still goes through esc() on the
   way into an attribute: the rule on this surface is that nothing off the wire
   reaches the DOM unescaped, and an exception is the thing someone forgets. */
function flameHTML(p) {
  const streak = streakOf(p);
  if (streak < STREAK_FLAME) return '';
  return `<span class="flame" role="img" aria-label="${esc(streak)} rounds in a row">🔥</span>`;
}

/* Hats stick out of the sheep's own box and the trimmed art gives them no
   shared one to stick out of, so the room above is measured rather than
   assumed — see headroomFor. The lobby flock and every paddock clip their
   overflow, and a sliced-off crown reads as a rendering fault.

   A whole list shares one number, because sheep sitting at different heights
   reads as a fault too, and a list with no hats in it reserves nothing at all
   — so a flock of unchosen sheep sits exactly where it always did.

   Poses changed the shape of this: headroomFor measures a hat against the pose
   it is worn on, and the podium puts a happy sheep next to a confused one. So
   each pose is measured against its OWN hats and the list reserves the worst of
   them — still one number, still no sheep floating on a band of nothing. */
function headroomOf(entries) {
  const byPose = new Map();
  for (const e of entries) {
    const pose = (e && e.pose) || POSE_MID;
    const id = ((e && e.look && e.look.hat) || {}).id;
    const ids = byPose.get(pose) || [];
    if (id) ids.push(id);
    byPose.set(pose, ids);
  }
  let worst = 0;
  for (const [pose, ids] of byPose) worst = Math.max(worst, headroomFor(ids, pose));
  return worst;
}

function sheepArt(cls, look, headroom, marked, pose) {
  const hat = look && look.hat;
  return sheepArtHTML({ pose, className: cls, hatId: hat ? hat.id : '', headroom, marked });
}

function sheepMarkup(p, { marked, headroom, pose, host }) {
  const look = lookOf(p);
  return `
    <li class="sheep" style="${fleeceStyle(look)}"
        data-marked="${marked ? 'true' : 'false'}"
        data-host="${host ? 'true' : 'false'}"
        data-connected="${p.connected === false ? 'false' : 'true'}">
      <span class="sheep__perch">${sheepArt('sheep__art', look, headroom, marked, pose)}</span>
      <span class="sheep__name">${esc(p.name)}</span>
      ${host ? '<span class="sheep__host legend">Host</span>' : ''}
    </li>`;
}

/* Who the room is waiting on, named. Both gates need it — the lobby and every
   host-gated hold — so the lookup lives once.

   A miss is not an error and must not throw: hostId is always a locked player
   server-side, but a frame in flight while that player's phone drops names an
   id that is no longer in players[], and one bad paint is enough to take down
   the one screen everybody in the room is looking at. No name means the role. */
function hostName(s) {
  if (!s || !s.hostId) return null;
  const host = (s.players || []).find((p) => p.id === s.hostId);
  return host ? host.name : null;
}

/* Reveal and the record sheet no longer advance on their own: the room is
   parked until the host taps Continue on their phone. `awaitingHost` is the
   server's single word for that (protocol.ts) — every surface reading one flag
   rather than each re-deriving the gate from phase, which is how one of them
   ends up disagreeing about whether anything is going to happen. */
function renderHostWait(node, s) {
  if (!node) return;
  node.hidden = !s.awaitingHost;
  if (!s.awaitingHost) return;
  const who = hostName(s);
  setHTML(
    node,
    who
      ? `Waiting for <strong>${esc(who)}</strong> to carry on`
      : 'Waiting for the host to carry on',
  );
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

/* How tightly a flock is packed, chosen by how many are in it. Used by BOTH
 * the lobby list and the waiting flock on the question screen — same fifty
 * people, same problem.
 *
 * MAX_PLAYERS is 50 and each list is one flex-wrap box, so the only two things
 * that can give are the size of an animal and the size of the box. The box is
 * already the whole column; the animal is what is left. Fifty sheep at the size
 * three sheep are drawn at is not a flock, it is a queue that runs off the
 * bottom of the screen — so the sheep shrinks in steps as the room fills, and
 * fifty fit an ordinary laptop without anyone having to scroll at all.
 *
 * The thresholds live here, next to the count that picks them; what each step
 * actually does to the animal, the gaps and the column is tv.css's business.
 * Four steps rather than a continuous function of n on purpose: a size that
 * slid a little on every single join would make the whole flock twitch each
 * time somebody's phone connected, on a screen a room is watching.
 *
 * Read as "up to this many". Anything past the last row is `tight`. */
const DENSITY_STEPS = [
  [12, 'roomy'],
  [24, 'packed'],
  [36, 'dense'],
];

const densityFor = (n) => {
  for (const [upTo, name] of DENSITY_STEPS) if (n <= upTo) return name;
  return 'tight';
};

/* ONE COUNT, both flocks. This exists because there were two.
 *
 * The lobby stamped its list from flock.length — the players with the host
 * filtered out, because the host is pinned above the scroller — and the question
 * screen stamped its list from s.players.length, host included, because nobody
 * is pinned out of that one. Two numbers one apart, read against thresholds at
 * 12/24/36: at exactly 13, 25 or 37 people in the room the two landed on
 * different sides of the same step, and the moment the gate opened every sheep
 * on the display changed size at once. Nothing had happened to the flock; the
 * two screens had simply counted it differently.
 *
 * The headcount in the ROOM is the honest number for both. It is what the
 * display is being asked to fit, and the lobby is fitting the host too — pinned
 * outside the scroller is still on the screen, and drawn at full size at that.
 * Taking it from s in one place is what stops the two drifting again. */
const densityForRoom = (s) => densityFor(s.players.length);

/* How many sheep were in the scrolling list last paint, so a join can be told
   from a repaint. Reset on leaving the lobby — see render(). */
let flockDrawn = -1;

function renderLobby(s) {
  const n = s.players.length;
  text(
    bind('lobbyHeadline'),
    n === 0 ? 'Waiting for the flock' : n === 1 ? 'One sheep in the paddock' : `${n} sheep in the paddock`,
  );

  const min = 2;
  const ready = n >= min;
  /* The note stopped being an instruction the moment the Start button left.
     Nobody is standing at this keyboard waiting to be told what to press — the
     gate is opened from the host's phone — so the line states who the room is
     waiting on instead. text() sets textContent, so the name needs no escaping
     here; every other place it lands does. */
  const who = hostName(s);
  text(
    bind('lobbyNote'),
    !ready
      ? `${min - n} more needed to open the gate`
      : who
        ? `Waiting for ${who} to open the gate`
        : 'Waiting for the host to open the gate',
  );

  renderGate(s);
  renderPack(s);

  /* THE HOST STANDS OUTSIDE THE SCROLLER, and is therefore taken out of the
     list below: the flock scrolls now, and the one player a room must always
     be able to find is exactly the one a scroller can hide. Nobody is drawn
     twice — this is a filter on the same array, not a second copy of anyone.

     Its own headroom, from its own hat. headroomOf() reserves the space one
     LIST needs above it so that no sheep in that list floats on a band of
     nothing (see the note on the function); the pin is a list of one, and
     handing it the flock's number would hang it in the air whenever somebody
     down in the flock happened to be wearing a taller hat than the host. */
  const host = s.hostId ? s.players.find((p) => p.id === s.hostId) : null;
  const pin = bind('hostPin');
  pin.hidden = !host;
  if (host) {
    setHTML(
      pin,
      sheepMarkup(host, {
        marked: false,
        headroom: headroomOf([{ look: lookOf(host) }]),
        host: true,
      }),
    );
  }

  const flock = s.players.filter((p) => p.id !== s.hostId);
  const list = bind('lobbyFlock');
  /* From the room, not from this list — see densityForRoom. The host is missing
     from `flock` and would put the lobby a whole step out from the question
     screen on the three counts where that one player crosses a threshold. */
  list.dataset.density = densityForRoom(s);

  /* One pose for the whole lobby. Ranks exist from the first frame — everyone
     on nothing, so rank degenerates to join order — and taking thirds of that
     would seat a third of the flock as "confused" before a question has been
     asked. The pose says how the game is going; in the lobby it is not going
     yet. */
  const headroom = headroomOf(flock.map((p) => ({ look: lookOf(p) })));
  setHTML(
    list,
    flock.map((p) => sheepMarkup(p, { marked: false, headroom, host: false })).join(''),
  );

  /* When the list overflows, follow the newest arrival down.
   *
   * players[] is JOIN ORDER, so a new sheep is always appended at the end —
   * which is the end that a scrolled list hides. The person most in need of
   * seeing their own animal is the one who just this second scanned the QR
   * code, and nobody in a party gets up to scroll a television.
   *
   * Only ON A JOIN, never on a repaint. The lobby is rewritten every time
   * anybody picks a colour, and a list that snapped to the bottom on all of
   * those would yank the screen out from under a host who had deliberately
   * scrolled up to look for somebody.
   *
   * And never on the FIRST paint, which is what the -1 is for. A display that
   * reloads mid-lobby is handed all forty people in one frame, and there is no
   * newest arrival among them — following that down would open the screen
   * halfway through the list for no reason anybody in the room could see. The
   * first frame establishes the count; joins after it are joins. */
  const grew = flockDrawn >= 0 && flock.length > flockDrawn;
  flockDrawn = flock.length;
  if (grew && list.scrollHeight > list.clientHeight) list.scrollTop = list.scrollHeight;
}

/* --- Still at the gate ---------------------------------------------------
   Joined and named, and not yet locked to a fleece and a hat. The headcount
   above counts only the flock proper, so without this a host watches four
   phones join and reads three sheep.

   They used to be a sentence with a number in it, because a number was all the
   wire carried. The frame names them now — `choosingPlayers`, id and name and
   deliberately no look at all, lobby-only and in join order (worker/protocol.ts
   is the contract) — so each one gets a silhouette of the idle sheep with a
   question mark on it and their own name underneath. That has to read as
   "somebody is here, still deciding", which is why it is the real animal
   emptied out rather than a placeholder shape: the sheep they are about to
   become, not an error where a sheep should be.

   BOTH fields are read, and they are not redundant. `choosing` is the count and
   is sent in every phase; `choosingPlayers` is empty outside the lobby by
   design, and after the gate shuts it could not be honest anyway because #start
   drops everyone still standing there. Taking the larger of the two is not
   defensive noise either — it is what keeps the caption true if this display is
   ever talking to a Worker that sends the count and not the array: the sentence
   still appears, with no silhouettes under it, which is exactly the old
   behaviour rather than a lobby that has quietly stopped mentioning them. */
function renderGate(s) {
  const pen = bind('gatePen');
  if (!pen) return;

  const counted = Math.max(0, Number(s.choosing) || 0);
  const named = Array.isArray(s.choosingPlayers) ? s.choosingPlayers : [];
  const n = Math.max(counted, named.length);

  pen.hidden = n === 0;
  if (n === 0) {
    /* Emptied rather than merely hidden: a hidden pen still holding last
       frame's silhouettes would flash them back for one paint the next time
       anybody arrived at the gate. */
    setHTML(bind('gateFlock'), '');
    return;
  }

  text(
    bind('gateLabel'),
    n === 1 ? 'One more still choosing a sheep' : `${n} more still choosing their sheep`,
  );
  setHTML(bind('gateFlock'), named.map(ghostMarkup).join(''));
}

/* No look, by definition — so no fleece style, no hat, and no headroom to
   reserve above one. The pose is sheep-art.js's default idle, which is the same
   pose the lobby flock stands in: the silhouette has to be recognisably the
   animal beside it, or it reads as a different creature rather than as an
   unfinished one. Flattening to a silhouette is tv.css's job (.ghost__art); the
   art itself comes back through sheep-art.js's own resolver, so the bench keeps
   drawing the same sheep the game does.

   AND IT STANDS ON THE SAME PERCH EVERY OTHER SHEEP DOES. This one went out
   without one, on the reasoning that a ghost has no hat and therefore no
   headroom to resolve against the wrong width — true, and beside the point,
   because the perch is also what CARRIES THE SIZE. Without it the art was a
   direct child of .sheep at `inline-size: 100%`, so it filled the grid column —
   --sheep-col, which the name floor makes wider than the animal — and every
   silhouette in the pen was drawn broader than the locked-in sheep it is meant
   to be an unfinished copy of. Worse, .ghost__mark is placed at `grid-area:
   1 / 1` (tv.css) so the question mark lands ON the flank: the art had no
   placement of its own, so auto-placement found row 1 already taken and put the
   animal in row 2 — the mark stencilled on the empty ground ABOVE a sheep it
   was supposed to be written across. The perch is what holds that cell, so
   giving the ghost one puts the mark back on the animal and the animal back at
   the animal's width, in a single structure rather than a second pattern.

   The name is UNTRUSTED — somebody typed it on a phone — and goes through
   esc() like every other name on this surface. */
function ghostMarkup(who) {
  return `
    <li class="sheep sheep--ghost">
      <span class="sheep__perch">${sheepArtHTML({
        className: 'sheep__art ghost__art',
        headroom: 0,
      })}</span>
      <span class="ghost__mark" aria-hidden="true">?</span>
      <span class="sheep__name">${esc(who.name)}</span>
    </li>`;
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

  /* One pose here too, and for a sharper reason than the lobby's: this list is
     rewritten through innerHTML every time anybody answers, so a pose driven
     off last round's standings would have sheep changing stance mid-question
     as unrelated players submitted. What this flock is about is who is still
     out — held back, or brought forward — and nothing else. */
  const headroom = headroomOf(s.players.map((p) => ({ look: lookOf(p) })));
  const waiting = bind('waitingFlock');
  /* Same step ladder the lobby uses, off the same count, and for the same
     reason: this is the same fifty people, and they must not change size on the
     way between the two screens. The host is NOT pinned out of this list — during
     a question nobody is waiting on the host, they are waiting on whoever has not
     answered, and lifting one player out of that list would be a claim about them
     that is not true. */
  waiting.dataset.density = densityForRoom(s);
  setHTML(
    waiting,
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

  /* Up to three sheep per field, big, in the bottom-right corner of it.
     Every answer used to carry its own sprite inline, which put an 18px animal
     beside 18px text: at the size this display is actually watched — a laptop
     across a room, or a screenshared window — that is a smudge, and eleven of
     them are eleven smudges. The names and the answers already say who is in
     the field, so the pen does not have to be a roll call; it has to be legible.
     Three is what fits a small paddock without crowding the answers out. */
  const PEN_MAX = 3;
  const total = s.players.length;
  const penOf = (g) => g.answers.slice(0, PEN_MAX);
  const headroom = headroomOf(
    groups.flatMap((g) =>
      penOf(g).map((a) => ({
        look: lookForAnswer(a),
        pose: poseFor(playerById.get(a.playerId), total),
      })),
    ),
  );

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
        .map(
          (a) => `<li class="pad-sheep">
              <span class="pad-sheep__text">${esc(a.text)}</span>
              <span class="pad-sheep__who">${esc(a.name)}</span>
            </li>`,
        )
        .join('');

      const pen = penOf(g)
        .map((a) => {
          const look = lookForAnswer(a);
          const style = fleeceStyle(look);
          return `<li class="pen-sheep"${style ? ` style="${style}"` : ''}>${sheepArt(
            'pen-sheep__art',
            look,
            headroom,
            false,
            poseFor(playerById.get(a.playerId), total),
          )}</li>`;
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
          <ul class="paddock__pen" aria-hidden="true">${pen}</ul>
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

  renderHostWait(bind('revealHostWait'), s);

  void max;
}

/* --- Record sheet ------------------------------------------------------- */

const WHY = {
  third: 'A third of the way round',
  penultimate: 'One paddock left',
  final: 'Final count',
};

/* How many get a plinth. Three is the shape a room already knows how to read;
   a fourth turns a podium back into a list with big type on it. */
const PODIUM = 3;

/* The tally strip: a five-bar gate per five points, and a faint one for the
   remainder. Same marks the paper record has always carried. */
function tallyHTML(score) {
  const fives = Math.floor(score / 5);
  const rest = score % 5;
  return (
    Array.from(
      { length: fives },
      () => `<svg viewBox="0 0 60 48"><use href="#sp-tally"/></svg>`,
    ).join('') +
    (rest ? `<svg class="part" viewBox="0 0 60 48"><use href="#sp-tally"/></svg>` : '')
  );
}

function renderRecord(s) {
  const isFinal = s.phase === 'final';
  const total = s.players.length;

  /* The order is the server's and only the server's.
     Ties break on cumulative answer time, and that number deliberately never
     goes on the wire (protocol.ts): shipping it would hand both surfaces the
     ingredients and let each re-implement the comparator, and the first one
     that sorts on score alone puts somebody second here and third on their own
     phone — on a screen the whole room is staring at. `rank` is a strict total
     order, so sorting by it is the entire job. The rest of the comparator only
     catches a frame from a build that predates rank, where every rank is 0. */
  const ranked = [...s.players].sort(
    (a, b) =>
      (Number(a.rank) || 0) - (Number(b.rank) || 0) ||
      b.score - a.score ||
      a.name.localeCompare(b.name),
  );

  text(bind('recordTitle'), isFinal ? 'Best in show' : 'Grazing record');
  text(bind('recordWhy'), WHY[s.scoreboardReason] ?? '');

  /* The plinths. Each player is drawn as the same animal their own phone is
     showing them at this moment — see poseFor — because the two screens are
     side by side in the room and a player whose phone says running while the
     television says lost has been told two different things about themselves.

     data-place is the position on the podium, not the rank: it drives the
     2-1-3 painting order and the size step, and it has to stay 1..3 even in a
     three-player game where the ranks happen to agree with it. */
  const podium = ranked.slice(0, PODIUM);
  const rest = ranked.slice(PODIUM);

  const headroom = headroomOf(
    podium.map((p) => ({ look: lookOf(p), pose: poseFor(p, total) })),
  );

  const plinths = podium
    .map((p, i) => {
      const look = lookOf(p);
      const place = Number(p.rank) || i + 1;
      /* The rosette is the prize, so it is only ever pinned to a finished
         game — and never to a nought, which would crown whoever happened to
         be first in join order before anyone had scored. */
      const lead = isFinal && i === 0 && p.score > 0;
      return `
        <li class="plinth" data-place="${i + 1}" style="${fleeceStyle(look)}">
          ${sheepArt('plinth__art', look, headroom, false, poseFor(p, total))}
          <span class="plinth__block">
            <span class="numerals plinth__place">${place}</span>
            <span class="plinth__name">${esc(p.name)}</span>
            <span class="numerals plinth__score">${Number(p.score) || 0}${flameHTML(p)}${
              lead
                ? `<svg class="plinth__rosette" viewBox="0 0 104 132" aria-hidden="true"><use href="#sp-rosette"/></svg>`
                : ''
            }</span>
          </span>
        </li>`;
    })
    .join('');

  setHTML(bind('podium'), plinths);

  /* Fourth and below, compactly. No sheep and no plinth: the point of the
     podium is that the top of the field is legible from the back of the room,
     and that only holds if everything else stays a line of text. */
  const rows = rest
    .map((p, i) => {
      const place = Number(p.rank) || PODIUM + i + 1;
      const score = Number(p.score) || 0;
      return `
        <li class="record__row">
          <span class="record__rank">${place}</span>
          <span class="record__name">${esc(p.name)}</span>
          <span class="record__tally" aria-hidden="true">${tallyHTML(score)}</span>
          <span class="record__score">${score}${flameHTML(p)}</span>
        </li>`;
    })
    .join('');

  setHTML(bind('recordRows'), rows);

  renderHostWait(bind('recordHostWait'), s);
}

/* --- Grouping ------------------------------------------------------------
   THERE IS NO CODE HERE ANY MORE, AND THAT IS THE POINT.

   This screen used to drive a progress bar: an exponential ease toward a hold
   at 90%, off groupingProgress.startedAt and the server's own expectedMs, on a
   requestAnimationFrame loop with a sampled-once branch for reduced motion,
   plus an endGrouping() that snapped the fill to 1 on the way out. All of it
   was correct and all of it was in service of a drawing that read as broken:
   a bar is understood as a distance to an end, so one that eases up to 90% and
   waits there — which is the honest thing for a wait whose end nobody can know
   — looks stalled, and looked most stalled on exactly the slow groupings the
   room was already uneasy about. It is a wheel now (tv.html, tv.css), which
   makes no claim about how far along anything is and therefore has no stalled
   state to be misread as.

   So the whole phase is CSS on authored markup and this file does nothing for
   it. Nothing to arm on entry, nothing to cancel on exit, no rAF loop to leak
   if a display sits in this scene when the socket drops.

   THE SPINNER NEEDS NOTHING OFF THE WIRE. groupingProgress still arrives on
   every grouping frame — startedAt, minUntil, expectedMs (worker/protocol.ts) —
   and this surface no longer reads any of it, deliberately rather than by
   omission: each of those three numbers exists to answer "how far along?", and
   that is the question the wheel is here to stop pretending to answer. Nothing
   is lost with them. The server's five-second floor is enforced server-side and
   always was — minUntil is only the wire copy of it — so the room still cannot
   leave this scene before the dog has had its run, whether or not anything on
   this screen has read the number. The frame is left alone; it is protocol.ts's
   to trim if the phone ever stops wanting it too. */

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

  /* Forget how big the flock was. The lobby's follow-the-newest scroll only
     fires when the list GREW, and this display outlives a game: if it is ever
     handed a fresh paddock — the room it was resuming has gone, so it opens a
     new one — a remembered count of forty would swallow the first thirty-nine
     joins of the next lobby without the list ever following one of them down. */
  if (s.phase !== 'lobby') flockDrawn = -1;

  switch (s.phase) {
    case 'lobby':
      renderLobby(s);
      break;
    case 'question':
      /* Every frame, unguarded. There used to be a round-change test here that
         claimed to re-arm the clock only when the round actually changed, but
         both of its branches called renderQuestion(s) — lastRoundRendered was
         written and never read to any effect. It was scaffolding left behind
         when the swinging gate came off this screen, and it has gone with it
         rather than being made real, because there is nothing left for it to
         protect: startClock() cancels the previous countdown before arming the
         next, countdown() is rAF-driven off the ABSOLUTE endsAt rather than off
         a duration measured from the call, and it only writes when the whole
         second changes. So re-arming mid-round lands on the same number the old
         one was already showing. A real guard would also have to be right about
         a frame that arrives with a new endsAt and the same roundIndex, which
         is one more thing to get wrong for a saving of nothing. */
      renderQuestion(s);
      break;
    /* Nothing. showScene() above has already put the grouping scene on, and
       the dog and the wheel on it are CSS over markup authored in tv.html —
       see the note above. Stated as a case rather than left to fall through to
       `default`, so the next reader finds the answer at the place they look
       for it instead of wondering which of the two omissions this was. */
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

/* There is no start handler here any more, and `host.start` has been deleted
   from the protocol along with the button that sent it. The host's phone sends
   `player.start`, authorised by comparing that socket's playerId to the room's
   hostId — the only check that survives a phone reconnecting or the host
   passing on, neither of which a display-side button could have known about. */

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

/* A host leaving the tab open all evening should not accumulate timers. The
   grouping bar's rAF loop used to be cancelled here too; there is no loop left
   to cancel now that the wheel is CSS, so the clock is the last one standing. */
window.addEventListener('pagehide', () => {
  if (stopClock) stopClock();
  net.close();
});

void latest;
