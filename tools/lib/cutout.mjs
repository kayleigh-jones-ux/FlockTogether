/* Turning a generated PNG into a game sprite.
 *
 * Krea returns an opaque image. Every model we tried paints the background the
 * colour the style reference uses (a warm off-white) and ignores an instruction
 * to use a chroma green or magenta — the style reference outvotes the prompt. So
 * we cannot ask for a keyable background, and we cannot key on colour either:
 * the fleece is the same white as the paper behind it.
 *
 * What saves us is the art style itself. Every asset is drawn with one closed,
 * thick, near-black ink outline, so the background is exactly the region
 * reachable from the frame edge without crossing ink. We flood fill from the
 * border and stop at the ink. Fleece is enclosed by the outline, so it is never
 * reached — which is the whole reason this works where a colour key does not.
 */

import sharp from 'sharp';

/** Squared distance in RGB, so we can compare against a squared tolerance. */
function dist2(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/**
 * Replace the outer background with transparency, then trim and pad.
 *
 * @param {Buffer} input                PNG/JPEG bytes as returned by the API.
 * @param {object} [opts]
 * @param {number} [opts.tolerance=52]  How far a pixel may drift from the
 *   sampled paper colour and still count as background. Too high eats the
 *   pale fleece highlight through an outline gap; too low leaves a bright halo.
 * @param {number} [opts.size=512]      Output square size in px.
 * @param {number} [opts.padding=0.04]  Margin kept around the trimmed art, as a
 *   fraction of `size`, so nothing touches the sprite's edge.
 * @param {{lo:number,hi:number,to:number}} [opts.deepen]  Optional: snap neutral
 *   greys in the luminance band [lo,hi] down to `to`. See deepenNeutrals.
 * @param {number} [opts.translucent]  Optional: set enclosed interior regions
 *   (lenses) to this alpha, 0-255. See translucentInteriors.
 * @returns {Promise<{png: Buffer, coverage: number, leak: boolean, deepened: number}>}
 *   `coverage` is the fraction of pixels kept; `leak` is set when the fill
 *   escaped through a gap in the outline and ate most of the art; `deepened` is
 *   the fraction of pixels the deepen pass moved.
 */
export async function cutout(input, opts = {}) {
  const { tolerance = 52, size = 512, padding = 0.04, deepen = null, translucent = null } = opts;

  // Flatten onto white first: if the source already carries alpha we want a
  // known paper colour under it rather than black fringing.
  const { data, info } = await sharp(input)
    .flatten({ background: '#ffffff' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h } = info;
  const tol2 = tolerance * tolerance;

  // Sample the paper colour from the four corners and take the median-ish
  // average. A corner occasionally clips a stray mark, so averaging four is
  // steadier than trusting pixel (0,0).
  const corners = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ];
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (const [x, y] of corners) {
    const i = (y * w + x) * 4;
    sr += data[i];
    sg += data[i + 1];
    sb += data[i + 2];
  }
  const [br, bg, bb] = [sr / 4, sg / 4, sb / 4];

  // Scanline flood fill from every border pixel. An explicit stack keeps this
  // iterative — a recursive fill blows the stack on a 1024x1024 image.
  const bgMask = new Uint8Array(w * h); // 1 = background
  const stack = [];
  const isPaper = (p) =>
    dist2(data[p * 4], data[p * 4 + 1], data[p * 4 + 2], br, bg, bb) <= tol2;

  const push = (x, y) => {
    const p = y * w + x;
    if (!bgMask[p] && isPaper(p)) {
      bgMask[p] = 1;
      stack.push(p);
    }
  };

  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }

  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }

  /* The fill stops where the anti-aliased edge of the ink gets too dark to read
   * as paper, which leaves a one-to-two pixel ring of near-white pixels clinging
   * to every outline. Left alone that ring reads as a bright halo once the
   * sprite sits on saturated pasture green. So for kept pixels that touch the
   * background we set alpha from how far the pixel has already moved away from
   * paper: still paper-coloured -> nearly transparent, clearly ink -> opaque.
   * That converts the halo into a soft edge instead of erasing it, which keeps
   * the outline from looking chewed. */
  const alpha = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) alpha[p] = bgMask[p] ? 0 : 255;

  const feathered = new Uint8Array(alpha);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (bgMask[p]) continue;
      const touches =
        (x > 0 && bgMask[p - 1]) ||
        (x < w - 1 && bgMask[p + 1]) ||
        (y > 0 && bgMask[p - w]) ||
        (y < h - 1 && bgMask[p + w]);
      if (!touches) continue;
      const d = Math.sqrt(
        dist2(data[p * 4], data[p * 4 + 1], data[p * 4 + 2], br, bg, bb),
      );
      // Ramp across the tolerance band: at the tolerance edge it is ~0, and by
      // 2.5x tolerance it is fully opaque.
      const t = Math.min(1, Math.max(0, (d - tolerance) / (tolerance * 1.5)));
      feathered[p] = Math.round(255 * t);
    }
  }

  let kept = 0;
  for (let p = 0; p < w * h; p++) {
    data[p * 4 + 3] = feathered[p];
    if (feathered[p] > 8) kept++;
  }
  const coverage = kept / (w * h);

  const deepened = deepen ? deepenNeutrals(data, w * h, deepen) : 0;
  const seeThrough = translucent != null ? translucentInteriors(data, w, h, { alpha: translucent }) : 0;

  // A closed outline yields something in the 8-45% range for these sprites.
  // Far above that means the fill never got in behind the art (paper colour
  // mis-sampled); near zero means it leaked through a gap and ate everything.
  const leak = coverage > 0.92 || coverage < 0.005;

  // Trim to the art's own bounding box so every sprite is framed the same way
  // regardless of how much margin the model happened to leave.
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (feathered[y * w + x] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const rgba = sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } });
  const cropped =
    maxX >= minX && maxY >= minY
      ? rgba.extract({
          left: minX,
          top: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        })
      : rgba;

  const inner = Math.max(1, Math.round(size * (1 - padding * 2)));
  const png = await cropped
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: Math.round((size - inner) / 2),
      bottom: size - inner - Math.round((size - inner) / 2),
      left: Math.round((size - inner) / 2),
      right: size - inner - Math.round((size - inner) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { png, coverage, leak, deepened, seeThrough };
}

/**
 * Make enclosed interior regions partly transparent, in place.
 *
 * Glasses sit over the sheep's eyes, so the lenses have to be see-through — and
 * no prompt can produce that, because the API returns an opaque image and the
 * lens is just a filled shape like any other. It has to be done to the alpha
 * channel afterwards.
 *
 * A lens is found geometrically rather than by colour: it is the region you
 * cannot reach from outside the sprite without crossing ink. The frame is a
 * closed dark loop, so flooding inwards from the transparent border through
 * non-ink pixels reaches everything EXCEPT the lens interiors. That is the same
 * trick the background cutout uses, run once more one level further in.
 *
 * The frame itself is ink and keeps its full alpha, so the glasses still read as
 * glasses — only the glass goes soft.
 *
 * @param {Uint8Array|Buffer} data RGBA pixels, mutated in place.
 * @param {number} w
 * @param {number} h
 * @param {object} opts
 * @param {number} opts.alpha         Target alpha for enclosed pixels, 0-255.
 * @param {number} [opts.inkMax=78]   Luminance at or below which a pixel counts
 *   as the ink frame. Must sit below the lens tint or the lens is mistaken for
 *   frame and nothing is found — which is why the prompt asks for a mid smoky
 *   grey lens rather than a black one.
 * @returns {number} Fraction of pixels made translucent.
 */
export function translucentInteriors(data, w, h, { alpha, inkMax = 78 }) {
  const n = w * h;
  const isInk = (p) => {
    const i = p * 4;
    if (data[i + 3] < 8) return false; // transparent is not ink
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] <= inkMax;
  };
  const isOutside = (p) => data[p * 4 + 3] < 8;

  /* Reachable = transparent background, plus any non-ink pixel connected to it.
   * Anything left over is walled in by ink. */
  const reached = new Uint8Array(n);
  const stack = [];
  const push = (p) => {
    if (reached[p] || isInk(p)) return;
    reached[p] = 1;
    stack.push(p);
  };

  for (let x = 0; x < w; x++) {
    if (isOutside(x)) push(x);
    if (isOutside((h - 1) * w + x)) push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    if (isOutside(y * w)) push(y * w);
    if (isOutside(y * w + w - 1)) push(y * w + w - 1);
  }

  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }

  let moved = 0;
  for (let p = 0; p < n; p++) {
    if (reached[p] || isInk(p)) continue;
    if (data[p * 4 + 3] < 8) continue; // already background
    data[p * 4 + 3] = Math.min(data[p * 4 + 3], alpha);
    moved++;
  }
  return moved / n;
}

/**
 * Snap neutral greys inside a luminance band down to near-black, in place.
 *
 * Some assets are meant to be black — a bowler, a top hat, a border collie — and
 * the model will not draw them black. The cause is the style reference: it
 * contains no black FILL anywhere, only black outlines over white and warm grey,
 * so its tonal statistics pull any large dark area towards grey no matter how the
 * prompt is worded. Asserting "deep solid black, not grey" did nothing; dropping
 * the reference strength from 0.46 to 0.20 moved the fill from luminance 171 to
 * 67, which is charcoal, and going lower starts costing the even outline weight
 * that makes the set cohere.
 *
 * So the last step is done arithmetically instead of asking again. It is safe here
 * only because of what these sprites are: flat fills of a single tone, with the
 * outline already far below the band and white far above it. The band is applied
 * to NEUTRAL pixels only, so a coloured fill of the same luminance — the dark red
 * beret, the olive bucket hat — is left alone.
 *
 * @param {Uint8Array|Buffer} data RGBA pixels, mutated in place.
 * @param {number} count           Pixel count.
 * @param {object} band
 * @param {number} band.lo   Luminance floor. Pixels darker than this are the ink
 *   outline and must not be touched, or the outline lifts and the sprite greys.
 * @param {number} band.hi   Luminance ceiling. Above this is white fleece, a grey
 *   hat band, or highlight, all of which must survive.
 * @param {number} band.to   Target luminance, e.g. 20 for near-black.
 * @param {number} [band.sat=26] Max channel spread to still count as neutral.
 * @returns {number} Fraction of pixels moved.
 */
export function deepenNeutrals(data, count, { lo, hi, to, sat = 26 }) {
  let moved = 0;
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    if (data[i + 3] < 8) continue; // transparent background
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Neutral only: a saturated fill of the same luminance is a real colour.
    if (Math.max(r, g, b) - Math.min(r, g, b) > sat) continue;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < lo || lum > hi) continue;
    /* Scale rather than flatten to a constant, so whatever slight modelling the
     * fill has is compressed instead of erased — a single constant makes the
     * shape read as a silhouette with its interior detail gone. */
    const k = to / Math.max(lum, 1);
    data[i] = Math.round(r * k);
    data[i + 1] = Math.round(g * k);
    data[i + 2] = Math.round(b * k);
    moved++;
  }
  return moved / count;
}

export default { cutout, deepenNeutrals };
