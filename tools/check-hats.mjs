#!/usr/bin/env node
/* A hat lives in three places and they must agree.
 *
 *   1. public/shared/look.js  HATS            — what a player may pick
 *   2. public/shared/sprites.svg  sp-hat-<id> — what they actually see
 *   3. tools/asset-manifest.mjs  DESCRIPTIONS — the words that generate its art
 *
 * None of the three fails loudly on its own. The dangerous direction is a hat
 * in look.js with no symbol: `<use href="#sp-hat-x">` against a missing symbol
 * is not an error in SVG, it simply draws nothing — so the picker offers a hat,
 * the server accepts it, and the player wears something no one can see. That is
 * a content bug that looks like a rendering bug and reproduces for one player
 * out of twenty. This check exists so adding a hat cannot half-happen.
 *
 * Usage: node tools/check-hats.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { HATS, FLEECE_COLOURS, LOOK_COMBINATIONS } from '../public/shared/look.js';
import { PLACEMENTS } from '../public/shared/hat-placement.js';
import { ASSETS } from './asset-manifest.mjs';

const sprites = readFileSync(new URL('../public/shared/sprites.svg', import.meta.url), 'utf8');
const artDir = new URL('../public/art/', import.meta.url);
const manifestPath = new URL('manifest.json', artDir);
const artManifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8')).assets || {}
  : null;

let bad = 0;
const fail = (msg) => { bad += 1; console.log('FAIL  ' + msg); };
const pass = (msg) => console.log('PASS  ' + msg);

/* --- 1 vs 2: every selectable hat is drawn --------------------------------- */

const drawn = new Set(
  [...sprites.matchAll(/<symbol id="sp-hat-([a-z0-9-]+)"/g)].map((m) => m[1]),
);

/* The shipped art. Since the switch to generated sprites this is what the
   surfaces actually draw; the SVG symbols below are the legacy set and only
   some hats still have one. Missing ART is what breaks a player's look. */
if (!artManifest) {
  fail('public/art/manifest.json is missing — run `npm run art`');
} else {
  const missingArt = HATS.filter((h) => !artManifest[`hat-${h.id}`]);
  if (missingArt.length) {
    fail(`selectable but no art: ${missingArt.map((h) => h.id).join(', ')}
      Generate it (npm run assets) then build it (npm run art).`);
  } else {
    pass(`all ${HATS.length} selectable hats have shipped art`);
  }

  /* Placement is what puts a hat on the head rather than through it. An untuned
     hat still renders — it takes the default — so this is a warning, not a
     failure, but it is the list of work /admin exists to clear. */
  const untuned = HATS.filter((h) => !PLACEMENTS[h.id]).map((h) => h.id);
  if (untuned.length) {
    console.log(
      `NOTE  ${untuned.length} of ${HATS.length} hats are untuned and sit at the default placement:\n` +
        `      ${untuned.join(', ')}\n` +
        `      Open /admin, drag each onto the sheep, and paste the result into hat-placement.js.`,
    );
  } else {
    pass('every hat has a tuned placement');
  }
}

const undrawn = HATS.filter((h) => !drawn.has(h.id));
if (undrawn.length) {
  console.log(`NOTE  no legacy SVG symbol (art is used instead): ${undrawn.length} hats`);
}

/* The other direction is a warning, not a failure: a drawn-but-unlisted hat is
   how a hat waits to be promoted, which is legitimate. */
const orphans = [...drawn].filter((id) => !HATS.some((h) => h.id === id));
if (orphans.length) {
  console.log(`NOTE  drawn but not selectable yet: ${orphans.join(', ')}`);
}

/* --- the shared anchor ---------------------------------------------------
   Hats are swapped by id alone against one placement (HAT_BOX), so a symbol on
   a different viewBox does not sit slightly wrong — it sits somewhere else
   entirely, and only for the players who picked it. */

for (const hat of HATS) {
  const symbol = new RegExp(`<symbol id="sp-hat-${hat.id}"([^>]*)>`).exec(sprites);
  if (!symbol) continue;
  if (!/viewBox="0 0 60 60"/.test(symbol[1])) {
    fail(`sp-hat-${hat.id} is not on the shared 60x60 box: ${symbol[1].trim()}`);
  }
}

/* --- 1 vs 3: every selectable hat can be regenerated ----------------------- */

const generated = new Set(ASSETS.filter((a) => a.group.startsWith('hat')).map((a) => a.id));
const ungenerated = HATS.filter((h) => !generated.has(`hat-${h.id}`));
if (ungenerated.length) {
  fail(`no art prompt: ${ungenerated.map((h) => h.id).join(', ')}
      Add a description to HAT_DESCRIPTIONS in tools/asset-manifest.mjs.`);
} else {
  pass(`all ${HATS.length} selectable hats have an art prompt`);
}

/* --- names ---------------------------------------------------------------- */

const unnamed = HATS.filter((h) => !h.name || !h.name.trim());
if (unnamed.length) fail(`hats with no display name: ${unnamed.map((h) => h.id).join(', ')}`);

const dupeIds = HATS.map((h) => h.id).filter((id, i, all) => all.indexOf(id) !== i);
if (dupeIds.length) fail(`duplicate hat ids: ${[...new Set(dupeIds)].join(', ')}`);

/* --- the headroom the uniqueness rule depends on --------------------------
   Looks are unique on the PAIR, and the room caps at MAX_PLAYERS. The rule is
   only comfortable while combinations vastly exceed that cap; this states the
   margin out loud so shrinking either list is a visible decision. */

const MAX_PLAYERS = 20;
if (LOOK_COMBINATIONS < MAX_PLAYERS * 4) {
  fail(`only ${LOOK_COMBINATIONS} looks for up to ${MAX_PLAYERS} players — too tight`);
} else {
  pass(`${FLEECE_COLOURS.length} colours x ${HATS.length} hats = ${LOOK_COMBINATIONS} looks`);
}

console.log(bad ? `\n${bad} problem(s)` : '\nhat registry consistent');
process.exit(bad ? 1 : 0);
