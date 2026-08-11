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
 * @returns {Promise<{png: Buffer, coverage: number, leak: boolean}>}
 *   `coverage` is the fraction of pixels kept; `leak` is set when the fill
 *   escaped through a gap in the outline and ate most of the art.
 */
export async function cutout(input, opts = {}) {
  const { tolerance = 52, size = 512, padding = 0.04 } = opts;

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

  return { png, coverage, leak };
}

export default { cutout };
