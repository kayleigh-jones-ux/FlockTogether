/* The sheep as it is actually drawn.
 *
 * Both surfaces used to draw `#sp-sheep` plus `#sp-hat-<id>` out of sprites.svg.
 * That only ever worked for the twenty hats authored as SVG symbols; the other
 * twenty exist solely as generated art, and a `<use>` pointing at a symbol that
 * is not there is not an error — it simply draws nothing, so one player in two
 * picked a hat and got a bare head. This module is the other half of the fix
 * that `hat-placement.js` started: the placements are tuned, so now the sheep
 * that wears them is the art too.
 *
 * A sheep is four stacked layers inside one box (see LAYER in hat-placement):
 *
 *   behind   a prop tucked under the animal — a fish, a pigeon, a UFO
 *   sheep    the pose itself, straight off /art/<pose>.png
 *   fleece   the player's colour, multiplied through <pose>-fleece.png so it
 *            lands on wool and nowhere else — the face and legs stay grey
 *   hat      everything else, placed from placementFor(hatId, pose)
 *
 * Everything is sized in PERCENTAGES of the box rather than pixels, because a
 * placement is already fractions of the sheep (see hat-placement.js) and the
 * same sheep is drawn at four wildly different sizes — 58px in the lobby flock,
 * a third of a phone in the picker. Percentages mean one markup string works at
 * all of them and nothing has to be re-placed on resize.
 */

import { placementFor, LAYER } from '/shared/hat-placement.js';
import { NO_HAT } from '/shared/look.js';

/* Bare is a choice with an id, not an empty string (see NO_HAT in look.js), so
   every entry point has to know that one hat id means "draw nothing" rather
   than "fetch /art/hat-none.png". Asked once, here, so the three places that
   reach for hat art cannot disagree about it. */
const wearsAHat = (hatId) => !!hatId && hatId !== NO_HAT;

export const DEFAULT_POSE = 'sheep-idle';

/* Trimmed art has no common box — a UFO and a pair of sunglasses come back as
   wildly different shapes — so every aspect ratio is read from the manifest the
   art build writes. Without it every asset is assumed square, which is wrong
   but still draws a sheep rather than nothing. */
let ASSETS = Object.create(null);

export async function loadArt(src = '/art/manifest.json') {
  try {
    const res = await fetch(src);
    if (!res.ok) return false;
    ASSETS = (await res.json()).assets || Object.create(null);
    return true;
  } catch {
    return false;
  }
}

/* Every asset URL goes through here. The surfaces always want /art, but the
   test bench is one self-contained file with no server behind it: it inlines
   the sheep and all forty hats as data URIs and points this at its own map, so
   the bench draws the same animal the game does rather than a stand-in that
   can quietly drift from it. */
let resolve = (name) => `/art/${name}.png`;

export function setArtSource(fn, assets) {
  resolve = fn;
  if (assets) ASSETS = assets;
}

/** Width divided by height, as the art build measured it. */
export function aspectOf(name) {
  const a = ASSETS[name];
  return a && a.aspect ? a.aspect : 1;
}

/* --- headroom -------------------------------------------------------------
 *
 * Hats sit at the top of the sheep's box and most of them stick out of it. The
 * SVG sheep solved this by opening its viewBox upward by one shared HAT_BOX,
 * which worked because every symbol was authored to that box. Trimmed art is
 * not, so the space above has to be MEASURED: how far the tallest hat in this
 * particular list actually rises, and never more, or every sheep floats on a
 * band of nothing.
 *
 * Returned as a fraction of the sheep's WIDTH so it can go straight into a
 * percentage padding, which resolves against width. One number for a whole
 * list, because sheep sitting at different heights reads as a fault.
 */
export function headroomFor(hatIds, pose = DEFAULT_POSE) {
  const sheep = aspectOf(pose);
  let worst = 0;
  for (const id of hatIds) {
    if (!wearsAHat(id)) continue;
    const p = placementFor(id, pose);
    const w = p.scale; /* of the sheep's width */
    const h = p.scale / aspectOf(`hat-${id}`);
    /* Rotation grows the box it needs: a 22-degree sou'wester reaches higher
       than its own height. Same formula the browser uses for a rotated bound. */
    const rad = (p.rot || 0) * (Math.PI / 180);
    const half = (Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad))) / 2;
    /* p.y is a fraction of HEIGHT; everything else here is width. */
    const rise = half - p.y / sheep;
    if (rise > worst) worst = rise;
  }
  return worst;
}

/* --- rendering ------------------------------------------------------------ */

const pct = (n) => `${+(n * 100).toFixed(3)}%`;

/** Inline style placing one hat on one pose. */
export function hatStyle(hatId, pose = DEFAULT_POSE) {
  const p = placementFor(hatId, pose);
  return [
    `width:${pct(p.scale)}`,
    `aspect-ratio:${aspectOf(`hat-${hatId}`)}`,
    `left:${pct(p.x)}`,
    `top:${pct(p.y)}`,
    /* Read right to left: mirror the sprite, rotate the mirrored thing, then
       shift it half its own size so the placement's x/y name its CENTRE. Doing
       the mirror last would make `rot` run backwards on every flipped hat. */
    `transform:translate(-50%,-50%) rotate(${p.rot}deg)${p.flip ? ' scaleX(-1)' : ''}`,
    `z-index:${p.behind ? LAYER.behind : LAYER.hat}`,
  ].join(';');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);

/**
 * A whole sheep, as markup.
 *
 * @param {object} o
 * @param {string} [o.pose]      one of the four sheep poses
 * @param {string} [o.hatId]     '' for a bare sheep
 * @param {string} [o.className] extra classes on the outer element
 * @param {number} [o.headroom]  fraction of width to reserve above, from headroomFor
 * @param {boolean} [o.marked]   this player's answer is in; styled statically
 *                               by the surface, never animated (see the note
 *                               about repainting in sheep-art.css)
 * @param {string} [o.alt]       accessible name; omitted means decorative
 */
export function sheepArtHTML({
  pose = DEFAULT_POSE, hatId = '', className = '', headroom = 0, marked = false, alt = '',
} = {}) {
  const hat = wearsAHat(hatId)
    ? `<img class="sheepart__hat" src="${resolve(`hat-${hatId}`)}" alt="" style="${hatStyle(hatId, pose)}" draggable="false">`
    : '';
  return `<span class="sheepart ${className}" style="--art-headroom:${pct(headroom)}" data-marked="${marked ? 'true' : 'false'}"${
    alt ? ` role="img" aria-label="${esc(alt)}"` : ' aria-hidden="true"'
  }><span class="sheepart__box" style="--fleece-mask:url('${resolve(`${pose}-fleece`)}')"
    ><img class="sheepart__body" src="${resolve(pose)}" alt="" draggable="false"
    ><span class="sheepart__fleece"></span
    >${hat}</span></span>`;
}

/**
 * The same sheep, painted into an element that already exists.
 *
 * play.js keeps three long-lived sheep — the picker preview, the lobby badge
 * and the flank — and swapping innerHTML under them on every frame would
 * restart the mark animation and re-fetch the art. This only touches what
 * actually changed.
 */
export function paintSheepArt(host, { pose = DEFAULT_POSE, hatId = '', headroom = null, marked = null } = {}) {
  if (!host) return;
  if (marked !== null) host.dataset.marked = marked ? 'true' : 'false';
  if (host.dataset.pose !== pose) {
    host.dataset.pose = pose;
    const body = host.querySelector('.sheepart__body');
    const box = host.querySelector('.sheepart__box');
    if (body) {
      /* The mask below is swapped in this same branch, and it takes effect at
         once. The body's HEIGHT does not: it comes from the PNG's intrinsic
         size, and a src that has only just been assigned has none until it
         decodes. The box collapses to zero for
         those frames and the fleece, which is inset:0 against it, is stretched
         over nothing; when the art does land the sheep pops into place. The
         poses are not the same shape either — idle is 448x396 and confused is
         448x428 — so the jump is real and not a rounding step.

         Declaring the ratio makes the box the right height on the same frame the
         pose changes, so the mask and the body are never a different shape from
         each other. Only when the manifest actually knows this pose: without it
         aspectOf() answers 1 for everything, and a square sheep is worse than a
         late one. */
      if (ASSETS[pose]) body.style.aspectRatio = String(aspectOf(pose));
      body.src = resolve(pose);
    }
    if (box) box.style.setProperty('--fleece-mask', `url('${resolve(`${pose}-fleece`)}')`);
  }

  let hat = host.querySelector('.sheepart__hat');
  if (!wearsAHat(hatId)) {
    if (hat) hat.remove();
  } else {
    if (!hat) {
      hat = document.createElement('img');
      hat.className = 'sheepart__hat';
      hat.alt = '';
      hat.draggable = false;
      host.querySelector('.sheepart__box').append(hat);
    }
    const src = resolve(`hat-${hatId}`);
    if (hat.getAttribute('src') !== src) hat.setAttribute('src', src);
    hat.style.cssText = hatStyle(hatId, pose);
  }

  /* Left to the caller when a list has to share one box; computed here when a
     sheep stands on its own and only ever wears its own hat. */
  const room = headroom === null ? headroomFor([hatId], pose) : headroom;
  host.style.setProperty('--art-headroom', pct(room));
}

export default {
  loadArt, setArtSource, aspectOf, headroomFor, hatStyle, sheepArtHTML, paintSheepArt, DEFAULT_POSE,
};
