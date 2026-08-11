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

import { readFileSync } from 'node:fs';
import { HATS, FLEECE_COLOURS, LOOK_COMBINATIONS } from '../public/shared/look.js';
import { ASSETS } from './asset-manifest.mjs';

const sprites = readFileSync(new URL('../public/shared/sprites.svg', import.meta.url), 'utf8');

let bad = 0;
const fail = (msg) => { bad += 1; console.log('FAIL  ' + msg); };
const pass = (msg) => console.log('PASS  ' + msg);

/* --- 1 vs 2: every selectable hat is drawn --------------------------------- */

const drawn = new Set(
  [...sprites.matchAll(/<symbol id="sp-hat-([a-z0-9-]+)"/g)].map((m) => m[1]),
);

const undrawn = HATS.filter((h) => !drawn.has(h.id));
if (undrawn.length) {
  fail(`selectable but never drawn: ${undrawn.map((h) => h.id).join(', ')}
      Add a <symbol id="sp-hat-ID" viewBox="0 0 60 60"> to public/shared/sprites.svg.`);
} else {
  pass(`all ${HATS.length} selectable hats have a symbol`);
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
  const symbol = new RegExp(
    `<symbol id="sp-hat-${hat.id}"([^>]*)>`,
  ).exec(sprites);
  if (!symbol) continue;
  if (!/viewBox="0 0 60 60"/.test(symbol[1])) {
    fail(`sp-hat-${hat.id} is not on the shared 60x60 box: ${symbol[1].trim()}`);
  }
}
if (!bad) pass('every hat symbol is on the shared 60x60 crown anchor');

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
