#!/usr/bin/env node
/* Build PNG contact grids of the generated sprites, one per group.
 *
 * assets/generated/index.html already shows the set in a browser, which is the
 * right tool when a person is reviewing. This exists for the other case: getting
 * the whole set in front of something that can only look at an image — a review
 * pass by a model, a paste into a chat, a diff between two runs.
 *
 * Grids render on pasture green by default because that is the only ground these
 * sprites ever sit on. A cutout that looks perfect on white can still show a pale
 * halo on saturated green, so reviewing on white hides the exact defect most
 * likely to be present.
 *
 *   node tools/asset-grid.mjs                       # every group, on green
 *   node tools/asset-grid.mjs --group hats --cols 6
 *   node tools/asset-grid.mjs --bg enamel --out /tmp/review
 *
 * Usage: node tools/asset-grid.mjs [--group a,b] [--cols N] [--bg green|enamel]
 *                                  [--cell N] [--out DIR]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN_DIR = path.join(ROOT, 'assets', 'generated');
const STATE_FILE = path.join(GEN_DIR, '.state.json');

/* Straight from tokens.css: --pasture, and --enamel for the outline check. */
const GROUNDS = { green: '#2f6b33', enamel: '#f5efe0' };

function parseArgs(argv) {
  const opts = { groups: null, cols: 0, bg: 'green', cell: 260, out: GEN_DIR };
  for (let i = 0; i < argv.length; i++) {
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${argv[i - 1]} needs a value`);
      return v;
    };
    switch (argv[i]) {
      case '--group':
        opts.groups = next().split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--cols':
        opts.cols = Math.max(1, Number(next()));
        break;
      case '--bg': {
        const bg = next();
        if (!GROUNDS[bg]) throw new Error(`--bg must be one of: ${Object.keys(GROUNDS).join(', ')}`);
        opts.bg = bg;
        break;
      }
      case '--cell':
        opts.cell = Math.max(64, Number(next()));
        break;
      case '--out':
        opts.out = path.resolve(next());
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw new Error(`Unknown flag: ${argv[i]}`);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      'Usage: node tools/asset-grid.mjs [--group a,b] [--cols N] [--bg green|enamel] [--cell N] [--out DIR]',
    );
    return;
  }

  let state;
  try {
    state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    console.error(`No generated assets found (${path.relative(ROOT, STATE_FILE)} missing).\nRun: node tools/make-assets.mjs --yes`);
    process.exit(1);
  }

  const byGroup = {};
  for (const [id, meta] of Object.entries(state.assets ?? {})) {
    (byGroup[meta.group] ||= []).push(id);
  }
  for (const ids of Object.values(byGroup)) ids.sort();

  const groups = opts.groups ?? Object.keys(byGroup);
  const unknown = groups.filter((g) => !byGroup[g]);
  if (unknown.length) {
    console.error(`Unknown group(s): ${unknown.join(', ')}. Have: ${Object.keys(byGroup).join(', ')}`);
    process.exit(2);
  }

  await fs.mkdir(opts.out, { recursive: true });
  const CELL = opts.cell;
  const LABEL = Math.round(CELL * 0.1);
  const ink = opts.bg === 'enamel' ? '#12180f' : '#f5efe0';

  for (const group of groups) {
    const ids = byGroup[group];
    // Default to a roughly square grid, which keeps a 20-sprite group readable
    // without becoming a very long strip.
    const cols = opts.cols || Math.min(6, Math.ceil(Math.sqrt(ids.length)));
    const rows = Math.ceil(ids.length / cols);

    const cells = [];
    for (let i = 0; i < ids.length; i++) {
      const file = path.join(GEN_DIR, `${ids[i]}.png`);
      let sprite;
      try {
        sprite = await sharp(file)
          .resize(CELL - 16, CELL - 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .toBuffer();
      } catch {
        console.log(`  skipping ${ids[i]} — ${path.relative(ROOT, file)} unreadable`);
        continue;
      }
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * CELL;
      const y = row * (CELL + LABEL);
      cells.push({ input: sprite, left: x + 8, top: y + 8 });
      cells.push({
        input: Buffer.from(
          `<svg width="${CELL}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg">` +
            `<text x="${CELL / 2}" y="${LABEL * 0.75}" font-family="sans-serif" font-size="${Math.round(LABEL * 0.6)}" ` +
            `font-weight="700" fill="${ink}" text-anchor="middle">${ids[i]}</text></svg>`,
        ),
        left: x,
        top: y + CELL,
      });
    }

    const out = path.join(opts.out, `grid-${group}.png`);
    await sharp({
      create: {
        width: cols * CELL,
        height: rows * (CELL + LABEL),
        channels: 4,
        background: GROUNDS[opts.bg],
      },
    })
      .composite(cells)
      .png({ compressionLevel: 9 })
      .toFile(out);

    console.log(`${path.relative(ROOT, out)}  ${ids.length} sprites, ${cols}x${rows}, on ${opts.bg}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
