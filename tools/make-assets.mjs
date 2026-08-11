#!/usr/bin/env node
/* Generate Flock Together's art assets with the Krea API.
 *
 *   node tools/make-assets.mjs --dry-run              # what it would cost
 *   node tools/make-assets.mjs --group ribbons --yes  # generate one group
 *   node tools/make-assets.mjs --yes                  # everything missing
 *
 * Costs real money, so nothing is submitted without --yes and the estimate is
 * always printed first. Finished sprites are cached on disk and skipped on a
 * re-run unless the prompt changed or --force is passed, which makes it safe to
 * re-run after a partial failure without paying twice.
 *
 * Output goes to assets/generated/, NOT to public/. These are raster PNGs and
 * the game's live sprites are inline SVG symbols in public/shared/sprites.svg
 * that get recoloured per player through CSS custom properties — see the
 * caveats printed at the end of a run.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { ASSETS, GROUPS, PRICE_PER_IMAGE } from './asset-manifest.mjs';
import { cutout } from './lib/cutout.mjs';
import { Krea, KreaError } from './lib/krea.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'generated');
const STYLE_REF = path.join(ROOT, 'assets', 'style-reference', 'sheep-clipart.png');
const STATE_FILE = path.join(ROOT, 'assets', 'generated', '.state.json');
const RAW_DIR = path.join(OUT_DIR, 'raw');

/* --- CLI ---------------------------------------------------------------- */

function parseArgs(argv) {
  const opts = {
    yes: false,
    dryRun: false,
    force: false,
    groups: null,
    only: null,
    concurrency: 3,
    size: 512,
    seed: 11,
    keepRaw: true,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--yes':
      case '-y':
        opts.yes = true;
        break;
      case '--dry-run':
      case '-n':
        opts.dryRun = true;
        break;
      case '--force':
        opts.force = true;
        break;
      case '--group':
        opts.groups = next()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case '--only':
        opts.only = next()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case '--concurrency':
        opts.concurrency = Math.max(1, Number(next()));
        break;
      case '--size':
        opts.size = Math.max(64, Number(next()));
        break;
      case '--seed':
        opts.seed = Number(next());
        break;
      case '--no-raw':
        opts.keepRaw = false;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error(`Unknown flag: ${a}`);
    }
  }
  return opts;
}

const HELP = `
Generate Flock Together's art assets with the Krea API.

Usage: node tools/make-assets.mjs [options]

  -n, --dry-run        List what would be generated and the cost. No API calls.
  -y, --yes            Actually spend money and generate.
      --group <a,b>    Only these groups. Available: ${GROUPS.join(', ')}
      --only <id,id>   Only these asset ids (e.g. ribbon-1st,dog-run).
      --force          Regenerate even if the sprite already exists.
      --concurrency N  Jobs in flight at once (default 3).
      --size N         Output sprite size in px, square (default 512).
      --seed N         Base seed; each asset offsets from it (default 11).
      --no-raw         Don't keep the pre-cutout image from the API.
  -h, --help           This.

The API key is read from KREA_API_KEY in the environment, or from
.env.local.txt / .env.local / .env in the project root.
`;

/* --- Key loading -------------------------------------------------------- */

async function loadApiKey() {
  if (process.env.KREA_API_KEY) return process.env.KREA_API_KEY.trim();
  for (const name of ['.env.local.txt', '.env.local', '.env']) {
    try {
      const text = await fs.readFile(path.join(ROOT, name), 'utf8');
      const m = text.match(/^\s*KREA_API_KEY\s*=\s*(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {
      /* next candidate */
    }
  }
  throw new Error(
    'No KREA_API_KEY found. Put it in .env.local.txt as KREA_API_KEY=... or set it in the environment.',
  );
}

/* --- State -------------------------------------------------------------- */

const promptHash = (asset, size) =>
  createHash('sha256')
    .update(JSON.stringify({ p: asset.prompt, a: asset.aspectRatio, s: asset.styleStrength, size }))
    .digest('hex')
    .slice(0, 12);

/* The seed has to come from the asset's own id, not its position in the batch.
 * Deriving it from the loop index made a sprite's seed depend on what else was
 * being generated alongside it, so `--only hat-fish --force` rerolled to a
 * different drawing than the same asset in a full run — which is the opposite of
 * what --force is for. Hashing the id makes a seed a property of the asset, so a
 * re-run is a genuine do-over of that one sprite. --seed still shifts the whole
 * set if you want a fresh take on everything. */
const seedFor = (asset, base) =>
  (createHash('sha256').update(asset.id).digest().readUInt32BE(0) + base) % 2_147_483_647;

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return { styleRef: null, assets: {} };
  }
}

const writeState = (state) => fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

/* --- Concurrency -------------------------------------------------------- */

/** Run `worker` over `items`, at most `limit` in flight. Never rejects. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await worker(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/* --- Contact sheet ------------------------------------------------------ */

/* A plain HTML page showing every sprite on the game's own pasture green,
 * because that is the only ground these ever sit on — a sprite that looks clean
 * on white can still show a pale halo on saturated green, and a run is not
 * reviewable until you have seen it where it will actually live. */
async function writeContactSheet(rows) {
  const groups = [...new Set(rows.map((r) => r.group))];
  const cells = (group) =>
    rows
      .filter((r) => r.group === group)
      .map(
        (r) => `      <figure>
        <img src="${r.file}" alt="${r.id}" width="220" height="220" loading="lazy">
        <figcaption>${r.id}</figcaption>
      </figure>`,
      )
      .join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flock Together — generated assets</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 2rem; background: #1c4a22; color: #f5efe0;
         font: 16px/1.5 system-ui, sans-serif; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  p.note { margin: 0 0 2rem; opacity: .8; max-width: 60ch; }
  h2 { font-size: .8rem; letter-spacing: .14em; text-transform: uppercase;
       margin: 2.5rem 0 1rem; padding-bottom: .5rem; border-bottom: 3px solid #12180f; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  figure { margin: 0; background: #2f6b33; border: 3px solid #12180f; border-radius: 4px;
           padding: .5rem; text-align: center; }
  img { display: block; width: 100%; height: auto; image-rendering: auto; }
  figcaption { font-size: .75rem; letter-spacing: .08em; text-transform: uppercase;
               opacity: .85; margin-top: .5rem; }
  .alt .grid figure { background: #f5efe0; }
  .alt figcaption { color: #12180f; }
</style>
</head>
<body>
  <h1>Generated assets</h1>
  <p class="note">Krea 2 Large, style-referenced from
    <code>assets/style-reference/sheep-clipart.png</code>. Shown on pasture green
    (<code>--pasture</code>), the ground these actually sit on, so any leftover halo from the
    background cutout is visible. ${rows.length} sprite${rows.length === 1 ? '' : 's'}.</p>
${groups
  .map(
    (g) => `  <section>
    <h2>${g}</h2>
    <div class="grid">
${cells(g)}
    </div>
  </section>`,
  )
  .join('\n')}
  <section class="alt">
    <h2>every sprite on enamel, for outline check</h2>
    <div class="grid">
${rows
  .map(
    (r) => `      <figure>
        <img src="${r.file}" alt="${r.id}" width="220" height="220" loading="lazy">
        <figcaption>${r.id}</figcaption>
      </figure>`,
  )
  .join('\n')}
    </div>
  </section>
</body>
</html>
`;
  const file = path.join(OUT_DIR, 'index.html');
  await fs.writeFile(file, html);
  return file;
}

/* --- Main --------------------------------------------------------------- */

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n${HELP}`);
    process.exit(2);
  }
  if (opts.help) return console.log(HELP);

  // Select the work.
  let selected = ASSETS;
  if (opts.groups) {
    const bad = opts.groups.filter((g) => !GROUPS.includes(g));
    if (bad.length) {
      console.error(`Unknown group(s): ${bad.join(', ')}. Available: ${GROUPS.join(', ')}`);
      process.exit(2);
    }
    selected = selected.filter((a) => opts.groups.includes(a.group));
  }
  if (opts.only) {
    const ids = new Set(opts.only);
    const known = new Set(ASSETS.map((a) => a.id));
    const bad = opts.only.filter((id) => !known.has(id));
    if (bad.length) {
      console.error(`Unknown asset id(s): ${bad.join(', ')}`);
      process.exit(2);
    }
    selected = selected.filter((a) => ids.has(a.id));
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  if (opts.keepRaw) await fs.mkdir(RAW_DIR, { recursive: true });

  const state = await readState();

  // Decide what actually needs generating: a sprite is fresh if the file is on
  // disk and was made from this exact prompt at this size.
  const todo = [];
  const skipped = [];
  for (const asset of selected) {
    const hash = promptHash(asset, opts.size);
    const file = path.join(OUT_DIR, `${asset.id}.png`);
    const prior = state.assets[asset.id];
    const onDisk = await fs
      .access(file)
      .then(() => true)
      .catch(() => false);
    if (!opts.force && onDisk && prior?.hash === hash) skipped.push(asset);
    else todo.push({ ...asset, hash, file });
  }

  const cost = todo.length * PRICE_PER_IMAGE;
  console.log(
    `\nFlock Together asset generation\n` +
      `  selected     ${selected.length}\n` +
      `  already done ${skipped.length}${skipped.length ? '  (use --force to redo)' : ''}\n` +
      `  to generate  ${todo.length}\n` +
      `  model        krea-2/large, style ref strength 0.55\n` +
      `  est. cost    $${cost.toFixed(2)} (${todo.length} x $${PRICE_PER_IMAGE})\n`,
  );

  if (todo.length) {
    const byGroup = todo.reduce((m, a) => ((m[a.group] = (m[a.group] || 0) + 1), m), {});
    console.log(
      `  ${Object.entries(byGroup)
        .map(([g, n]) => `${g}:${n}`)
        .join('  ')}\n`,
    );
  }

  if (opts.dryRun) {
    for (const a of todo) console.log(`  would generate  ${a.id}`);
    console.log('\nDry run, nothing submitted. Re-run with --yes to generate.\n');
    return;
  }
  if (!todo.length) {
    console.log('Nothing to do.\n');
    return;
  }
  if (!opts.yes) {
    console.log('Refusing to spend money without --yes. Add --yes to generate.\n');
    process.exit(1);
  }

  const apiKey = await loadApiKey();
  const krea = new Krea(apiKey, { log: (m) => console.log(`    ${m}`) });

  // Upload the style reference once and remember it. `url` on a style reference
  // is capped at 1024 chars so a local file has to be hosted first; re-uploading
  // per asset would be 30-odd pointless uploads per run.
  const refBytes = await fs.readFile(STYLE_REF);
  const refHash = createHash('sha256').update(refBytes).digest('hex').slice(0, 12);
  if (state.styleRef?.hash !== refHash) {
    console.log(`Uploading style reference (${path.basename(STYLE_REF)})...`);
    const asset = await krea.uploadAsset(STYLE_REF, 'Flock Together style reference');
    state.styleRef = { hash: refHash, id: asset.id, url: asset.image_url };
    await writeState(state);
    console.log(`  -> ${asset.image_url}\n`);
  } else {
    console.log(`Style reference already uploaded (${state.styleRef.url})\n`);
  }
  const refUrl = state.styleRef.url;

  const started = Date.now();
  let spend = 0;

  const results = await pool(todo, opts.concurrency, async (asset, i) => {
    const label = asset.id;
    const seed = seedFor(asset, opts.seed);
    console.log(`  [${i + 1}/${todo.length}] ${label}`);

    const { bytes, url } = await krea.generate(
      {
        prompt: asset.prompt,
        aspect_ratio: asset.aspectRatio,
        resolution: '1K',
        creativity: 'low',
        seed,
        image_style_references: [{ url: refUrl, strength: asset.styleStrength }],
      },
      { label },
    );
    spend += PRICE_PER_IMAGE;

    if (opts.keepRaw) await fs.writeFile(path.join(RAW_DIR, `${asset.id}.png`), bytes);

    const { png, coverage, leak } = await cutout(bytes, { size: opts.size });
    await fs.writeFile(asset.file, png);

    if (leak) {
      console.log(
        `    ! ${label}: background cutout looks wrong (kept ${(coverage * 100).toFixed(1)}% of the frame).` +
          ` The raw image is in assets/generated/raw/ — check it.`,
      );
    }

    state.assets[asset.id] = {
      hash: asset.hash,
      group: asset.group,
      prompt: asset.prompt,
      seed,
      sourceUrl: url,
      coverage: Number(coverage.toFixed(4)),
      suspect: leak,
      size: opts.size,
      at: new Date().toISOString(),
    };
    await writeState(state);

    return { id: asset.id, group: asset.group, file: `${asset.id}.png`, coverage, leak };
  });

  const ok = results.filter((r) => r?.ok).map((r) => r.value);
  const failed = results
    .map((r, i) => (r?.ok ? null : { id: todo[i].id, error: r?.error }))
    .filter(Boolean);

  // Contact sheet covers everything on disk, not just this run's output.
  const allRows = selected
    .filter((a) => state.assets[a.id])
    .map((a) => ({ id: a.id, group: a.group, file: `${a.id}.png` }));
  const sheet = await writeContactSheet(allRows);

  const secs = Math.round((Date.now() - started) / 1000);
  console.log(
    `\nDone in ${Math.floor(secs / 60)}m ${secs % 60}s\n` +
      `  generated  ${ok.length}\n` +
      `  failed     ${failed.length}\n` +
      `  spent      ~$${spend.toFixed(2)}\n` +
      `  sprites    ${path.relative(ROOT, OUT_DIR)}\n` +
      `  review     ${path.relative(ROOT, sheet)}\n`,
  );

  const suspect = ok.filter((r) => r.leak);
  if (suspect.length) {
    console.log(
      `  ${suspect.length} sprite(s) had a questionable cutout: ${suspect.map((s) => s.id).join(', ')}\n` +
        `  Re-run just those with --only <id> --force to reroll.\n`,
    );
  }
  if (failed.length) {
    for (const f of failed) console.log(`  FAILED ${f.id}: ${f.error?.message ?? f.error}`);
    console.log(`\n  Re-run the command to retry only what failed — finished sprites are cached.\n`);
  }

  console.log(
    `Note: these are raster PNGs. The game's live sprites are SVG symbols in\n` +
      `public/shared/sprites.svg, recoloured per player via --fleece-* custom properties,\n` +
      `and hats there share one 60x60 anchor box (HAT_BOX in shared/look.js). A PNG sheep\n` +
      `cannot be recoloured 30 ways and these hats are not anchor-aligned, so treat this set\n` +
      `as art direction to redraw from rather than a drop-in replacement.\n`,
  );

  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  if (e instanceof KreaError) console.error(`\nKrea API error: ${e.message}\n`);
  else console.error(`\n${e.stack || e.message}\n`);
  process.exit(1);
});
