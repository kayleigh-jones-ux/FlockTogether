/* The hat bench.
 *
 * Placement is stored as fractions of the sheep's box (see hat-placement.js),
 * which is what makes one number right at every render size. This page is the
 * only sane way to arrive at those fractions: type 0.68 and you are guessing;
 * drag the hat onto the head and you are not.
 *
 * Nothing here writes to disk — a static page cannot. It produces the source
 * for the PLACEMENTS object and you paste it in, which keeps the tuned values
 * in version control where they belong rather than in a database nobody backs
 * up.
 */

import { HATS, FLEECE_COLOURS, colourVar } from '/shared/look.js';
import { PLACEMENTS, DEFAULT_PLACEMENT, placementFor } from '/shared/hat-placement.js';

const $ = (id) => document.getElementById(id);
const POSES = ['sheep-idle', 'sheep-happy', 'sheep-confused', 'sheep-running'];

/* Live working copy. Seeded from the committed placements so a session starts
   where the last one finished. */
const work = JSON.parse(JSON.stringify(PLACEMENTS));

let manifest = {};
let current = HATS[0];
let pose = 'sheep-idle';
let perPose = false;

/* --- placement plumbing --------------------------------------------------- */

const baseOf = (id) => {
  const entry = work[id];
  if (!entry) return { ...DEFAULT_PLACEMENT };
  const { poses, ...rest } = entry;
  return { ...DEFAULT_PLACEMENT, ...rest };
};

/** What is on screen right now: the shared placement, or this pose's override. */
function activeOf(id, forPose = pose) {
  const entry = work[id];
  const base = baseOf(id);
  const over = entry && entry.poses && entry.poses[forPose];
  return over ? { ...base, ...over } : base;
}

const hasOverride = (id, forPose = pose) =>
  !!(work[id] && work[id].poses && work[id].poses[forPose]);

/** Write a change to whichever layer the "override this pose" switch selects. */
function commit(id, patch) {
  const entry = (work[id] ||= {});
  if (perPose) {
    entry.poses ||= {};
    entry.poses[pose] = { ...(entry.poses[pose] || {}), ...patch };
  } else {
    Object.assign(entry, patch);
  }
  render();
  paintList();
  paintFlock();
}

const round = (n, dp = 3) => +n.toFixed(dp);

/* --- rendering ------------------------------------------------------------ */

function sheepBox() {
  const art = $('sheep-art');
  return { w: art.clientWidth, h: art.clientHeight };
}

function place(imgEl, hatId, p, box) {
  const art = manifest[`hat-${hatId}`];
  const aspect = art ? art.aspect : 1;
  const w = p.scale * box.w;
  const h = w / aspect;
  imgEl.style.width = `${w}px`;
  imgEl.style.height = `${h}px`;
  imgEl.style.left = `${p.x * box.w - w / 2}px`;
  imgEl.style.top = `${p.y * box.h - h / 2}px`;
  /* Read right to left: mirror the sprite, then rotate the mirrored thing in
     the parent's space. Rotating first would make the rot control run backwards
     the moment a hat was flipped, which is a maddening way to lose an hour. */
  imgEl.style.transform = `rotate(${p.rot}deg)${p.flip ? ' scaleX(-1)' : ''}`;
}

function render() {
  const p = activeOf(current.id);
  const box = sheepBox();

  $('sheep-art').src = `/art/${pose}.png`;
  $('sheep-fleece').style.setProperty('--fleece-mask', `url('/art/${pose}-fleece.png')`);

  const hat = $('hat');
  hat.src = `/art/hat-${current.id}.png`;
  hat.alt = current.name;
  place(hat, current.id, p, box);

  $('in-x').value = round(p.x);
  $('in-y').value = round(p.y);
  $('in-scale').value = round(p.scale);
  $('in-rot').value = round(p.rot, 1);
  $('in-flip').checked = !!p.flip;

  const guides = $('guides').checked;
  for (const g of ['guide-v', 'guide-h']) $(g).hidden = !guides;
  $('guide-v').style.left = `${p.x * box.w}px`;
  $('guide-h').style.top = `${p.y * box.h}px`;

  const tuned = !!work[current.id];
  $('state').textContent = !tuned
    ? 'untuned — using the default'
    : hasOverride(current.id)
      ? `override for ${pose.replace('sheep-', '')}`
      : 'shared across all poses';

  $('override').checked = perPose;
}

function paintList() {
  const filter = $('filter').value.trim().toLowerCase();
  const list = $('hat-list');
  list.textContent = '';
  let tunedCount = 0;
  for (const hat of HATS) {
    if (work[hat.id]) tunedCount += 1;
    if (filter && !hat.name.toLowerCase().includes(filter) && !hat.id.includes(filter)) continue;

    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'hats__btn';
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(hat.id === current.id));
    btn.dataset.tuned = String(!!work[hat.id]);

    const img = document.createElement('img');
    img.className = 'hats__thumb';
    img.src = `/art/hat-${hat.id}.png`;
    img.alt = '';
    img.loading = 'lazy';
    /* The list mirrors too, so a glance down it shows which way each prop is
       actually facing rather than which way it was drawn. */
    if (activeOf(hat.id).flip) img.style.transform = 'scaleX(-1)';

    const name = document.createElement('span');
    name.className = 'hats__name';
    name.textContent = hat.name;

    btn.append(img, name);
    btn.addEventListener('click', () => {
      current = hat;
      render();
      paintList();
    });
    li.append(btn);
    list.append(li);
  }
  $('tally').textContent = `${tunedCount} / ${HATS.length} tuned`;
}

/* Every tuned hat at paddock size. A placement that reads well at 460px can be
   a smudge at 86, and this is the only place that difference is visible. */
function paintFlock() {
  const flock = $('flock');
  flock.textContent = '';
  for (const hat of HATS) {
    if (!work[hat.id]) continue;
    const p = activeOf(hat.id);
    const fig = document.createElement('figure');
    fig.className = 'flock__cell';

    const s = document.createElement('img');
    s.className = 's';
    s.src = `/art/${pose}.png`;
    s.alt = '';

    const h = document.createElement('img');
    h.className = 'h';
    h.src = `/art/hat-${hat.id}.png`;
    h.alt = '';

    const cap = document.createElement('figcaption');
    cap.textContent = hat.name;

    fig.append(s, h, cap);
    flock.append(fig);

    /* The sheep's height is only known once it has laid out. */
    s.addEventListener('load', () => place(h, hat.id, p, { w: s.clientWidth, h: s.clientHeight }), {
      once: true,
    });
    if (s.complete) place(h, hat.id, p, { w: s.clientWidth || 86, h: s.clientHeight || 76 });
  }
}

/* --- dragging ------------------------------------------------------------- */

const hatEl = $('hat');
let drag = null;

hatEl.addEventListener('pointerdown', (ev) => {
  const box = sheepBox();
  const p = activeOf(current.id);
  hatEl.setPointerCapture(ev.pointerId);
  drag = { startX: ev.clientX, startY: ev.clientY, x: p.x, y: p.y, box };
  ev.preventDefault();
});

hatEl.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const dx = (ev.clientX - drag.startX) / drag.box.w;
  const dy = (ev.clientY - drag.startY) / drag.box.h;
  const next = { x: clamp01(drag.x + dx), y: clamp01(drag.y + dy) };
  /* Repaint directly while dragging; committing on every pointermove would
     rebuild the hat list and the flock strip sixty times a second. */
  const p = { ...activeOf(current.id), ...next };
  place(hatEl, current.id, p, drag.box);
  $('guide-v').style.left = `${p.x * drag.box.w}px`;
  $('guide-h').style.top = `${p.y * drag.box.h}px`;
  $('in-x').value = round(p.x);
  $('in-y').value = round(p.y);
  drag.last = next;
});

const endDrag = () => {
  if (drag && drag.last) commit(current.id, { x: round(drag.last.x), y: round(drag.last.y) });
  drag = null;
};
hatEl.addEventListener('pointerup', endDrag);
hatEl.addEventListener('pointercancel', endDrag);

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/* Scroll to scale, shift-scroll to rotate — both on the hat itself, so the
   hand never leaves the thing it is adjusting. */
$('pen').addEventListener(
  'wheel',
  (ev) => {
    ev.preventDefault();
    const p = activeOf(current.id);
    if (ev.shiftKey) {
      commit(current.id, { rot: round(p.rot - Math.sign(ev.deltaY) * 2, 1) });
    } else {
      commit(current.id, { scale: round(Math.max(0.02, p.scale * (ev.deltaY > 0 ? 0.96 : 1.0417))) });
    }
  },
  { passive: false },
);

/* --- controls ------------------------------------------------------------- */

for (const [id, key] of [['in-x', 'x'], ['in-y', 'y'], ['in-scale', 'scale'], ['in-rot', 'rot']]) {
  $(id).addEventListener('input', (ev) => {
    const v = Number(ev.target.value);
    if (Number.isFinite(v)) commit(current.id, { [key]: v });
  });
}

$('in-flip').addEventListener('change', (ev) => {
  commit(current.id, { flip: ev.target.checked });
});

/* F flips. Half the props face the wrong way, so this is the most-pressed
   control on the page and it should not require aiming at a checkbox. Ignored
   while typing into a field, or it would eat the f in a filter. */
window.addEventListener('keydown', (ev) => {
  if (ev.key !== 'f' && ev.key !== 'F') return;
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
  ev.preventDefault();
  commit(current.id, { flip: !activeOf(current.id).flip });
});

$('reset').addEventListener('click', () => {
  delete work[current.id];
  render();
  paintList();
  paintFlock();
});

$('override').addEventListener('change', (ev) => {
  perPose = ev.target.checked;
  /* Turning it off removes this pose's override rather than leaving an
     invisible one behind to surprise somebody later. */
  if (!perPose && work[current.id] && work[current.id].poses) {
    delete work[current.id].poses[pose];
    if (!Object.keys(work[current.id].poses).length) delete work[current.id].poses;
  }
  render();
});

$('guides').addEventListener('change', render);
$('filter').addEventListener('input', paintList);

for (const btn of document.querySelectorAll('.seg__btn')) {
  btn.addEventListener('click', () => {
    pose = btn.dataset.pose;
    for (const b of document.querySelectorAll('.seg__btn')) {
      b.setAttribute('aria-pressed', String(b === btn));
    }
    render();
    paintFlock();
  });
}

const fleeceSel = $('fleece');
for (const c of FLEECE_COLOURS) {
  const opt = document.createElement('option');
  opt.value = c.id;
  opt.textContent = c.name;
  fleeceSel.append(opt);
}
fleeceSel.value = 'raddle-red';
const applyFleece = () => {
  $('sheep-fleece').style.setProperty('--fleece', colourVar(fleeceSel.value));
};
fleeceSel.addEventListener('change', applyFleece);

/* --- export --------------------------------------------------------------- */

function source() {
  const lines = ['export const PLACEMENTS = {'];
  for (const hat of HATS) {
    const entry = work[hat.id];
    if (!entry) continue;
    const b = baseOf(hat.id);
    /* flip is emitted only when true. It is a flag, not a measurement, and
       `flip: false` on forty entries is noise that hides the ones that matter. */
    const head =
      `  '${hat.id}': { x: ${round(b.x)}, y: ${round(b.y)}, scale: ${round(b.scale)}, ` +
      `rot: ${round(b.rot, 1)}${b.flip ? ', flip: true' : ''}`;
    const overrides = entry.poses && Object.keys(entry.poses).length ? entry.poses : null;
    if (!overrides) {
      lines.push(`${head} },`);
      continue;
    }
    lines.push(`${head},`);
    lines.push('    poses: {');
    for (const [p, o] of Object.entries(overrides)) {
      const parts = Object.entries(o).map(([k, v]) =>
        typeof v === 'boolean' ? `${k}: ${v}` : `${k}: ${round(v, k === 'rot' ? 1 : 3)}`,
      );
      lines.push(`      '${p}': { ${parts.join(', ')} },`);
    }
    lines.push('    },');
    lines.push('  },');
  }
  lines.push('};');
  return lines.join('\n');
}

$('export').addEventListener('click', () => {
  $('out-text').value = source();
  $('out-note').textContent = '';
  $('out').showModal();
});
$('out-close').addEventListener('click', () => $('out').close());
$('out-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('out-text').value);
    $('out-note').textContent = 'Copied.';
  } catch {
    $('out-text').select();
    $('out-note').textContent = 'Select-all and copy — the clipboard was refused.';
  }
});

/* --- boot ----------------------------------------------------------------- */

try {
  manifest = (await (await fetch('/art/manifest.json')).json()).assets || {};
} catch {
  /* Without the manifest every hat is assumed square, which is wrong but still
     draggable — better than a blank page. */
  manifest = {};
}

applyFleece();
paintList();
paintFlock();
$('sheep-art').addEventListener('load', render, { once: true });
render();
window.addEventListener('resize', render);

void placementFor;
