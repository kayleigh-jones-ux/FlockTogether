/* Throwaway: apply the requested asset edits to the manifest atomically. */
import fs from 'node:fs';

const p = 'tools/asset-manifest.mjs';
let s = fs.readFileSync(p, 'utf8');
const edits = [];

function rep(from, to, what, optional = false) {
  if (!s.includes(from)) {
    if (optional) return console.log(`  (skipped, already applied: ${what})`);
    throw new Error(`anchor not found: ${what}`);
  }
  s = s.replace(from, to);
  edits.push(what);
}

/* 1. sou-wester — no strap. The strap only ever rendered as a raindrop-ish tag. */
rep(
  `  'sou-wester':
    "a bright yellow rain hat (a sou'wester) seen from the side, with a small rounded crown and a markedly " +
    'asymmetric brim: short and turned up at the front, sweeping long and wide at the back to throw rain off the neck, ' +
    'with a thin chin strap hanging loose below',`,
  `  'sou-wester':
    "a bright yellow rain hat (a sou'wester) seen from the side, with a small rounded crown and a markedly " +
    'asymmetric brim: short and turned up at the front, sweeping long and wide at the back to throw rain off the neck. ' +
    'Just the hat: NO chin strap, no cord, no tie, no ribbon and nothing hanging down from it',`,
  'sou-wester: strap removed',
);

/* 2. daisy-chain — front row only.
 * Drawn as a full ring you see the far side of, which reads as a flat hoop lying
 * on the head rather than a garland going around it. Showing only the near arc
 * lets the rest of the ring be implied behind the sheep. */
rep(
  `  'daisy-chain': 'a flower crown ring of white daisies with round yellow centres and small green leaves',`,
  `  'daisy-chain':
    'a garland of white daisies with round yellow centres and small green leaves, drawn as a single shallow ' +
    'left-to-right ARC of flowers seen straight from the front, curving gently downwards at both ends. ' +
    'Only the near row of flowers is drawn: this is the front of the garland alone, NOT a complete ring, ' +
    'NOT an oval, NOT a circle, with no second row of flowers behind and no far side visible',`,
  'daisy-chain: front arc only',
);

/* 3. antlers — no headband at all. */
rep(
  `  antlers:
    'a pair of brown branching deer antlers mounted on a simple thin headband, seen straight from the front. ' +
    'The headband is a narrow flat strip like a hairband, drawn edge-on as a single thin curved line, ' +
    'NOT a wide ring, NOT an oval, NOT a circle, with no gap or hole of any kind in the middle',`,
  `  antlers:
    'a pair of brown branching deer antlers on their own, seen straight from the front, the two antlers rising apart ' +
    'from a small shared base at the bottom. Just the bare antlers: NO headband, no hairband, no strip, no band, ' +
    'no ring, no oval and no line joining them across the bottom',`,
  'antlers: headband removed',
);

/* 4. cactus / 5. flowerpot — squat pot, bigger plant. */
rep(
  `  cactus: {
    sitsOn: 'crown',
    description:
      'a small potted cactus: a fat rounded green cactus with two short arms and simple little spines, ' +
      'in a plain terracotta orange pot, with one tiny pink flower on top',
  },`,
  `  cactus: {
    sitsOn: 'crown',
    description:
      'a potted cactus in which the CACTUS IS LARGE and the pot is small: a big fat rounded bright green cactus ' +
      'with two short arms and simple little spines, filling most of the picture, with a bright pink flower on top. ' +
      'It sits in a SHORT SQUAT SHALLOW terracotta orange pot — a low wide dish of a pot no more than a quarter of ' +
      'the height of the cactus above it, deliberately stubby',
  },`,
  'cactus: squat pot, larger plant',
);

rep(
  `  flowerpot: {
    sitsOn: 'crown',
    description:
      'a small terracotta orange flower pot with a rim, holding one single tall red rose in full bloom on a green stem ' +
      'with two green leaves',
  },`,
  `  flowerpot: {
    sitsOn: 'crown',
    description:
      'a potted rose in which the ROSE IS LARGE and the pot is small: one single big red rose in full open bloom, ' +
      'with a bold clearly drawn spiral of petals, on a green stem with two green leaves, filling most of the picture. ' +
      'It sits in a SHORT SQUAT SHALLOW terracotta orange pot with a rim — a low wide pot no more than a quarter of ' +
      'the height of the rose above it, deliberately stubby',
  },`,
  'flowerpot: squat pot, larger bloom',
);

/* 6. ice-cream — dropped, so it has a flat base to perch on. */
rep(
  `  'ice-cream': {
    sitsOn: 'crown',
    description:
      'an ice cream cone standing upright, seen from the side, with a pale tan waffle cone below and two round scoops ' +
      'stacked on top — one pink, one mint green — and a red cherry on the very top',
  },`,
  `  'ice-cream': {
    sitsOn: 'crown',
    description:
      'a DROPPED ice cream, seen from the side: the pale tan waffle cone lies toppled over on its side, and the two ' +
      'round scoops — one pink, one mint green — have fallen out and squashed into a soft splat beside it, ' +
      'with a red cherry rolled loose. The whole thing is low, spread out and flat along the bottom as if it just ' +
      'landed on the ground. Sad and funny, not neat',
  },`,
  'ice-cream: dropped and splatted',
);

/* 7 & 8. Glasses — narrow bridge so they straddle a sheep's eyes, and a lens
 * tone light enough that the translucency pass can find it. The lens must not be
 * near-black or it is indistinguishable from the ink outline. */
rep(
  `  sunglasses: {
    sitsOn: 'eyes',
    description:
      'a pair of sunglasses seen straight from the front, with two big rounded very dark black lenses and thick black frames ' +
      'and short arms folded out to each side',
  },`,
  `  sunglasses: {
    sitsOn: 'eyes',
    translucent: 130,
    description:
      'a pair of sunglasses seen straight from the front, with two big round lenses in thick black frames and short arms ' +
      'out to each side. The two lenses sit CLOSE TOGETHER, almost touching, joined by a very SHORT NARROW nose bridge ' +
      'that is just a small notch between them — not a long wide bridge. ' +
      'Each lens is filled with a flat medium smoky grey-blue tint, clearly lighter than the black frame around it, ' +
      'like a tinted glass you can see through — not solid black, not opaque, not dark',
  },`,
  'sunglasses: narrow bridge, tinted lens',
);

rep(
  `  'reading-glasses': {
    sitsOn: 'eyes',
    description:
      'a pair of ordinary round reading glasses seen straight from the front, with thin dark wire frames, ' +
      'two clear round empty lenses, a small bridge between them and short arms out to each side',
  },`,
  `  'reading-glasses': {
    sitsOn: 'eyes',
    translucent: 90,
    description:
      'a pair of round reading glasses seen straight from the front, with thin dark wire frames and short arms out to ' +
      'each side. The two lenses sit CLOSE TOGETHER, almost touching, joined by a very SHORT NARROW nose bridge that is ' +
      'just a small notch between them — not a long wide bridge. ' +
      'Each lens is filled with a flat very pale cool grey, like plain clear glass you look straight through',
  },`,
  'reading-glasses: narrow bridge, clear lens',
);

/* Carry `translucent` from the SILLY table onto the asset, and default it. */
rep(
  `    sitsOn: prop.sitsOn,`,
  `    sitsOn: prop.sitsOn,
    translucent: prop.translucent ?? null,`,
  'pass translucent through',
);
rep(`  deepen: null,`, `  deepen: null,\n  translucent: null,`, 'default translucent');

fs.writeFileSync(p, s);
console.log(`applied ${edits.length} edits:`);
for (const e of edits) console.log(`  - ${e}`);
