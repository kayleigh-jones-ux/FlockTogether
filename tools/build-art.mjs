#!/usr/bin/env node
/* Turn assets/generated into art the game can actually serve.
 *
 *   node tools/build-art.mjs
 *
 * The generated PNGs are 512x512 with the subject floating in a sea of
 * transparency, which is wrong for the game in three ways: every sprite would
 * carry a different invisible margin (so no two hats could share a placement),
 * the whole set is ~9MB (which a party's wifi will feel), and the sheep's
 * fleece is white when it needs to be the player's colour.
 *
 * So each asset is trimmed to its own ink, scaled to a sane ceiling, and
 * written to public/art/ with its true proportions recorded in a manifest. The
 * sheep additionally gets a FLEECE MASK — see deriveFleeceMask below.
 *
 * assets/generated is the darkroom; public/art is what ships.
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets', 'generated');
const OUT = path.join(ROOT, 'public', 'art');

/* Ceilings, not targets. A hat is drawn at maybe 60px on the phone's preview
   and a great deal less inside a paddock, so 256 is already generous; the sheep
   is the one thing ever seen large. */
const MAX = { hat: 256, sheep: 448, other: 320 };

const kindOf = (name) =>
  name.startsWith('hat-') ? 'hat' : name.startsWith('sheep-') ? 'sheep' : 'other';

/* --- geometry ------------------------------------------------------------ */

/** The tightest box containing anything at all opaque. */
function inkBounds(data, width, height, channels) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/* --- morphology ----------------------------------------------------------
 * Square kernels, done as two separable passes: a 2D min over an NxN box is a
 * horizontal min followed by a vertical one, which turns an O(N^2) filter per
 * pixel into O(N). At 512x512 with a radius of 3 that is the difference
 * between instant and noticeable.
 */
function morph(mask, width, height, radius, pick) {
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let v = mask[row + x];
      for (let d = -radius; d <= radius; d += 1) {
        const nx = x + d;
        if (nx < 0 || nx >= width) continue;
        v = pick(v, mask[row + nx]);
      }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let v = tmp[y * width + x];
      for (let d = -radius; d <= radius; d += 1) {
        const ny = y + d;
        if (ny < 0 || ny >= height) continue;
        v = pick(v, tmp[ny * width + x]);
      }
      mask[y * width + x] = v;
    }
  }
}

const erode = (m, w, h, r) => morph(m, w, h, r, Math.min);
const dilate = (m, w, h, r) => morph(m, w, h, r, Math.max);

/** Delete anything thinner than the kernel; leave everything broader alone. */
function open(mask, width, height, radius) {
  erode(mask, width, height, radius);
  dilate(mask, width, height, radius);
}

/* --- the fleece mask -----------------------------------------------------
 * The player's colour is painted through this, so it must cover the wool and
 * nothing else. Near-white is the obvious test and on its own it is wrong: the
 * whites of the eyes pass it too, and a sheep with two brightly coloured eyes
 * is a horror. So candidates are grouped into connected regions and only the
 * big ones survive — the body, and the curl of fleece on the head, which is
 * genuinely wool and should take the colour. Eye whites are tiny and fall out.
 *
 * The grey face, the grey legs, the dark hooves and the black outline all fail
 * the brightness test and are never touched, which is the whole point: a
 * coloured sheep still reads as a sheep rather than as a silhouette.
 */
function deriveFleeceMask(data, width, height, channels) {
  const total = width * height;
  const candidate = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    const o = i * channels;
    const a = data[o + 3];
    if (a < 128) continue;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    /* Bright and unsaturated: white wool, not the warm-grey face. The first
       cut used 205 and the face came out freckled — the muzzle's lighter
       patches and the model's faint paper texture both cleared it, and the
       result was a sheep with the measles in its own colour. */
    if (max > 224 && max - min < 30) candidate[i] = 1;
  }

  /* Threshold alone cannot separate a broad white field from a scatter of
     bright specks on a grey one, because locally they look identical. Shape
     can: an opening (erode, then dilate by the same amount) deletes anything
     thinner than the kernel and leaves everything broader untouched. The specks
     and the thin ring of near-white around each eye go; the fleece, which is
     hundreds of pixels across, comes back the size it started. */
  open(candidate, width, height, 3);

  /* Flood the candidates into regions, iteratively — a recursive fill blows the
     stack on a region this size. */
  const label = new Int32Array(total).fill(-1);
  const areas = [];
  const stack = new Int32Array(total);
  for (let start = 0; start < total; start += 1) {
    if (!candidate[start] || label[start] !== -1) continue;
    const id = areas.length;
    let area = 0;
    let sp = 0;
    stack[sp++] = start;
    label[start] = id;
    while (sp > 0) {
      const p = stack[--sp];
      area += 1;
      const x = p % width;
      const y = (p - x) / width;
      if (x > 0) { const n = p - 1; if (candidate[n] && label[n] === -1) { label[n] = id; stack[sp++] = n; } }
      if (x < width - 1) { const n = p + 1; if (candidate[n] && label[n] === -1) { label[n] = id; stack[sp++] = n; } }
      if (y > 0) { const n = p - width; if (candidate[n] && label[n] === -1) { label[n] = id; stack[sp++] = n; } }
      if (y < height - 1) { const n = p + width; if (candidate[n] && label[n] === -1) { label[n] = id; stack[sp++] = n; } }
    }
    areas.push(area);
  }

  /* Sizes are judged RELATIVE TO THE BODY, not to the frame.
   *
   * An absolute floor cannot win here. Set it low enough to keep the curl of
   * fleece on the head and the wider eye of the confused sheep comes with it;
   * set it high enough to drop that eye and the curl vanishes on the two poses
   * whose heads are turned, leaving a white toupee on a coloured sheep. The
   * poses differ too much for one number.
   *
   * Against the body the three sizes separate cleanly and consistently: the
   * body is the largest region by a wide margin, the curl is a tenth of it or
   * so, and an eye white is a small fraction of that. Anchoring to the body
   * makes the rule hold whatever size the sheep was drawn at.
   *
   * Measured across the four poses: curls land at 5.2-12.7% of the body and eye
   * whites at 1.1-3.3%, so 4% sits in the gap with margin at both ends. Rerun
   * with ART_DEBUG=1 to print the regions if a new pose ever crowds it. */
  const largest = areas.length ? Math.max(...areas) : 0;
  const floor = Math.max(largest * 0.04, total * 0.002);
  const keep = areas.map((a) => a >= floor);
  const kept = keep.filter(Boolean).length;

  if (process.env.ART_DEBUG) {
    const pct = (a) => ((a / total) * 100).toFixed(2) + '%';
    const rel = (a) => ((a / largest) * 100).toFixed(1) + '% of body';
    console.log(
      '      regions: ' +
        areas
          .map((a, i) => `${pct(a)} (${rel(a)})${keep[i] ? ' KEEP' : ''}`)
          .sort()
          .reverse()
          .join('  '),
    );
  }

  const kept8 = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    if (label[i] !== -1 && keep[label[i]]) kept8[i] = 1;
  }

  /* Grow the survivors back under the ink. The white wool stops a pixel or two
     short of its own outline, and colour that stops there too leaves a pale
     halo tracing every scallop — most visible at exactly the size a sheep is
     drawn in a paddock. Dilating tucks the colour beneath the black line,
     which has its own opacity and covers the overshoot. */
  dilate(kept8, width, height, 2);

  const mask = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i += 1) {
    const o = i * 4;
    mask[o] = 255; mask[o + 1] = 255; mask[o + 2] = 255;
    mask[o + 3] = kept8[i] ? 255 : 0;
  }
  return { mask, regions: areas.length, kept };
}

/* --- run ----------------------------------------------------------------- */

await mkdir(OUT, { recursive: true });

const files = (await readdir(SRC)).filter((f) => f.endsWith('.png')).sort();
if (!files.length) {
  console.error(`No PNGs in ${SRC}. Run \`npm run assets\` first.`);
  process.exit(1);
}

const manifest = {};
let bytesIn = 0;
let bytesOut = 0;

for (const file of files) {
  const id = path.basename(file, '.png');
  const kind = kindOf(id);
  const src = sharp(path.join(SRC, file));
  const meta = await src.metadata();
  const { data, info } = await src.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const box = inkBounds(data, info.width, info.height, info.channels);
  if (!box) {
    console.log(`SKIP  ${id} — nothing but transparency`);
    continue;
  }

  const cap = MAX[kind];
  const scale = Math.min(1, cap / Math.max(box.width, box.height));
  const outW = Math.max(1, Math.round(box.width * scale));
  const outH = Math.max(1, Math.round(box.height * scale));

  const body = await sharp(path.join(SRC, file))
    .extract(box)
    .resize(outW, outH, { fit: 'fill' })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  await writeFile(path.join(OUT, `${id}.png`), body);

  bytesIn += (meta.size ?? 0) || 0;
  bytesOut += body.length;

  const entry = { w: outW, h: outH, aspect: +(outW / outH).toFixed(4) };

  if (kind === 'sheep') {
    const { mask, regions, kept } = deriveFleeceMask(data, info.width, info.height, info.channels);
    const maskBuf = await sharp(mask, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .extract(box)
      .resize(outW, outH, { fit: 'fill' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(path.join(OUT, `${id}-fleece.png`), maskBuf);
    bytesOut += maskBuf.length;
    entry.fleece = `${id}-fleece.png`;
    entry.fleeceRegions = kept;
    console.log(
      `OK    ${id.padEnd(22)} ${outW}x${outH}  fleece: kept ${kept} of ${regions} regions`,
    );
  } else {
    console.log(`OK    ${id.padEnd(22)} ${outW}x${outH}`);
  }

  manifest[id] = entry;
}

await writeFile(
  path.join(OUT, 'manifest.json'),
  JSON.stringify({ generated: Object.keys(manifest).length, assets: manifest }, null, 2) + '\n',
);

const mb = (n) => (n / 1024 / 1024).toFixed(2) + 'MB';
console.log(
  `\n${Object.keys(manifest).length} assets -> public/art  ${mb(bytesIn)} in, ${mb(bytesOut)} out`,
);
