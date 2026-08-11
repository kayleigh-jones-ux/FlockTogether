/* What to generate, and the exact words that get the house style.
 *
 * The style was calibrated against live output rather than guessed. Three probe
 * runs at style-reference strengths 0.30 / 0.42 / 0.55 showed 0.55 with
 * `creativity: 'low'` is the one that stays recognisably the reference drawing
 * while still reading as goofier: below ~0.45 the even outline weight and the
 * warm-grey face start drifting, and `creativity: 'raw'` reproduced the
 * reference so faithfully that the goofiness instructions were ignored outright.
 *
 * The hat list is derived from shared/look.js, not retyped, so a hat added to
 * the game cannot silently go ungenerated — DESCRIPTIONS is asserted complete
 * against HATS at import time.
 */

import { HATS } from '../public/shared/look.js';

/** Line, colour and framing. Every prompt opens with this. */
export const STYLE = [
  "Children's-book clip-art illustration.",
  'Thick uniform black ink outline of completely even weight around every shape.',
  'Flat solid colour fill only: no gradients, no shading, no hatching, no texture, no sketch lines.',
  'Simple, bold, chunky shapes readable at small size.',
].join(' ');

/** Framing and background. The cutout depends on the first two clauses. */
export const FRAMING = [
  'The subject is drawn as one single object, whole and complete, centred with generous empty margin on every side, nothing cropped or touching the edge.',
  'Plain flat empty background with nothing in it: no ground line, no shadow, no grass, no scenery, no frame, no border, no text, no lettering, no watermark, no colour swatches.',
].join(' ');

/* Pushed at anything whose colour actually carries meaning.
 *
 * The style reference is a near-monochrome drawing — white fleece, grey face,
 * black ink — so at strength 0.55 it drags every colour towards beige. The first
 * ribbon run proved it: "gold", "silver" and "bronze" all came back the same
 * washed-out khaki, leaving 1st, 2nd and 3rd indistinguishable at a glance. The
 * fix is two-part: drop the style strength for coloured props (see STRENGTH
 * below) and say plainly that the colour is saturated. */
const COLOUR_PUSH =
  'Rich, strongly saturated, vivid poster colour — bold and unmistakable, definitely not pale, ' +
  'not washed out, not muted, not beige, not desaturated.';

/* How hard the style reference pulls, per group.
 *
 * The sheep sits at full strength because it IS the reference subject and shares
 * its white-and-grey palette, so there is nothing to lose. Anything that has to
 * own a colour is pulled back until the colour survives, accepting slightly more
 * drift in the outline weight — a hat whose colour is wrong is useless, a hat
 * whose outline is 10% thinner is still fine. */
const STRENGTH = {
  sheep: 0.55,
  dog: 0.46,
  hats: 0.34,
  ribbons: 0.32,
  extras: 0.36,
  'hats-new': 0.34,
};

/** The goofiness dial, applied to anything with a face. */
const GOOFY = [
  'Silly, corny and comedic: a big goofy lopsided grin, wide googly eyes set slightly too far apart,',
  'exaggerated cartoon proportions, cheerfully dopey expression.',
].join(' ');

/** The sheep's fixed anatomy — repeated so every sheep pose matches the others. */
const SHEEP_BODY = [
  'A cartoon sheep in side view facing right.',
  'Flat white fleece drawn as a ring of soft rounded bumps forming a cloud-like body,',
  'a flat light warm-grey face and four flat light warm-grey legs, dark grey hooves,',
  'tiny solid black dot eyes, a small white curl of fleece on top of the head, and floppy grey ears.',
].join(' ');

/* --- Hats ---------------------------------------------------------------
 * Each is drawn as a prop on its own, with no head under it, because the game
 * layers a hat over the sheep sprite rather than baking it in.
 *
 * Caveat worth knowing before wiring these in: the SVG hats in sprites.svg all
 * share one 60x60 authoring box anchored at its bottom centre (see HAT_BOX in
 * shared/look.js), which is what makes them swappable by id. Generated raster
 * hats do NOT come out on a shared anchor — each is trimmed to its own bounding
 * box — so they are concept art for redrawing, not drop-in replacements.
 */
const HAT_DESCRIPTIONS = {
  'flat-cap': 'a tweed flat cap, brown herringbone, with a short stubby peak',
  bobble: 'a knitted winter bobble hat, chunky red and cream stripes, with a big fluffy pom-pom on top',
  'sou-wester': "a bright yellow oilskin sou'wester rain hat with a wide flared brim that is longer at the back",
  boater: 'a straw boater hat, pale yellow woven straw with a flat top and a red ribbon band',
  bucket: 'a soft canvas bucket hat, olive green, with a downward-sloping brim all the way round',
  beanie: 'a plain snug knitted beanie, teal, with a rolled brim',
  beret: 'a soft wool beret, dark red, slouching to one side with a tiny stalk on top',
  headscarf: 'a floral headscarf knotted under the chin, cream with small blue flowers',
  visor: 'a plastic sun visor, bright white with a green translucent peak and no crown',
  'baseball-cap': 'a baseball cap, royal blue with a curved peak and a button on top',
  earmuffs: 'a pair of fluffy pink earmuffs joined by a padded headband',
  'daisy-chain': 'a woven flower crown of white daisies with yellow centres and small green leaves',
  bowler: 'a black bowler hat with a rounded dome crown and a narrow curled brim',
  deerstalker: 'a brown checked deerstalker hat with ear flaps tied up and a small peak front and back',
  cowboy: 'a tan leather cowboy hat with a tall creased crown and wide upturned brim',
  'hard-hat': 'a bright yellow construction hard hat with moulded ridges across the top',
  'top-hat': 'a tall black silk top hat with a straight crown and a grey band',
  crown: 'a chunky gold crown with five rounded points topped with red and blue jewels',
  'party-hat': 'a striped cone party hat, pink and yellow, with a small pom-pom at the tip',
  antlers: 'a pair of brown branching deer antlers on a thin headband',
  'ten-gallon':
    'an enormous ten-gallon cowboy hat, comically oversized, with a very tall rounded crown far taller than a normal hat ' +
    'and a broad sweeping brim curled up at both sides, in warm tan leather with a braided dark brown band',
  propeller:
    'a childrens propeller beanie: a small round skullcap in bright red, yellow, blue and green quarter panels, ' +
    'with a thin post on top carrying a two-bladed spinning propeller',
};

for (const hat of HATS) {
  if (!HAT_DESCRIPTIONS[hat.id]) {
    throw new Error(
      `asset-manifest: hat "${hat.id}" (${hat.name}) from shared/look.js has no description. Add one to HAT_DESCRIPTIONS.`,
    );
  }
}

/* Hats that are NOT in the game yet.
 *
 * Requested directly, and generated so the art exists to judge — but
 * deliberately kept out of shared/look.js. That list is validated server-side
 * and every entry needs a matching `sp-hat-<id>` symbol in sprites.svg; adding
 * an id there without drawing the symbol would show players an empty hat slot
 * and let them pick a look that renders as nothing. Drawing the symbols is the
 * step that promotes one of these into the game. */
const EXTRA_HATS = {
  /* Empty on purpose. Propeller and ten-gallon started here, were generated so
     the art existed to judge, and have now been promoted: SVG symbols drawn
     from the generated PNGs, ids added to look.js, descriptions moved up into
     HAT_DESCRIPTIONS. Promotion is always those three steps together, and
     `npm run hats` fails if any one of them is skipped.

     Anything parked here is generated but NOT selectable, which is the correct
     place for a hat whose art exists but whose symbol nobody has drawn yet. */
};

/* --- The assets ---------------------------------------------------------- */

const SHEEP = [
  {
    id: 'sheep-idle',
    subject: `${SHEEP_BODY} Standing still and calm, looking straight ahead with a small pleasant closed smile.`,
    goofy: true,
  },
  {
    id: 'sheep-happy',
    subject: `${SHEEP_BODY} Delighted and celebrating: beaming wide open-mouthed smile, eyes squeezed shut with joy, front legs kicked up mid-jump.`,
    goofy: true,
  },
  {
    id: 'sheep-confused',
    subject: `${SHEEP_BODY} Baffled and sheepish: head tilted to one side, one eyebrow raised, mouth a small wavy uncertain line, ears drooping at odd angles.`,
    goofy: true,
  },
  {
    id: 'sheep-running',
    subject: `${SHEEP_BODY} Running hard to the right, legs stretched out front and back mid-gallop, ears flying backwards, mouth open in a happy panic.`,
    goofy: true,
  },
];

const DOG = [
  {
    id: 'dog-sit',
    subject:
      'A cartoon border collie sheepdog in side view facing right, sitting upright and alert. Flat black and white fur in bold simple patches, a white blaze down the muzzle, one ear up and one ear folded, a bushy tail curled round, pink tongue out.',
    goofy: true,
  },
  {
    id: 'dog-run',
    subject:
      'A cartoon border collie sheepdog in side view facing right, running flat out with all four legs stretched wide, ears pinned back, tongue flapping out of the side of its mouth. Flat black and white fur in bold simple patches.',
    goofy: true,
  },
  {
    id: 'dog-herding',
    subject:
      'A cartoon border collie sheepdog in side view facing right, crouched low in the classic herding stalk with its head down, shoulders low, eyes locked forward in an intense comical stare, tail straight out behind. Flat black and white fur in bold simple patches.',
    goofy: true,
  },
];

/* Ribbons carry a numeral, which is the thing this model is least reliable at.
 * Describing it as a shape ("the single large digit 1") rather than as quoted
 * text survives noticeably better — the first run rendered 1, 2 and 3 correctly
 * this way. Each numeral is still checked by eye every run.
 *
 * The three must also be told apart instantly across a room, so each names one
 * unambiguous metal and repeats it. */
const RIBBON = (digit, metal, colour, ring) => ({
  id: `ribbon-${digit === 1 ? '1st' : digit === 2 ? '2nd' : '3rd'}`,
  aspectRatio: '2:3',
  coloured: true,
  subject: [
    'A prize rosette award ribbon hanging vertically, drawn straight on.',
    `A big round pleated fan-shaped rosette at the top made of ${colour},`,
    `with a circular white centre medallion showing the single large digit ${digit} in thick solid black,`,
    `ringed by a ${ring} band, and two long ribbon tails in the same ${metal} hanging straight down below it.`,
    `The whole rosette and both tails are clearly ${metal}.`,
  ].join(' '),
});

const RIBBONS = [
  RIBBON(1, 'bright metallic gold', 'bright golden yellow gold, gleaming and richly saturated', 'deep red'),
  RIBBON(2, 'bright metallic silver', 'cool bright silver grey, gleaming like polished metal', 'strong royal blue'),
  RIBBON(3, 'warm metallic bronze', 'deep coppery orange-brown bronze, warm and richly saturated', 'dark green'),
];

const EXTRAS = [
  {
    id: 'gate',
    aspectRatio: '3:2',
    subject:
      'A five-bar wooden farm field gate seen straight on from the side, closed. Five horizontal bars with a diagonal brace across them, warm brown timber with visible plank shapes, and a simple metal latch on the right.',
  },
  {
    id: 'eartag',
    subject:
      'A livestock ear tag: a rounded rectangular plastic tag, bright yellow, with a small hole punched at the top and a blank flat face, seen straight on.',
  },
  {
    id: 'trough',
    aspectRatio: '3:2',
    subject:
      'A galvanised metal water trough seen from the side, filled with flat blue water, standing on two short legs.',
  },
  {
    id: 'haybale',
    subject:
      'A round bale of hay seen from the side, flat golden yellow with simple curved lines suggesting coiled straw, and two dark twine bands around it.',
  },
];

/** Every asset, with the style preamble already composed into `prompt`. */
export const ASSETS = [
  ...SHEEP.map((a) => ({ ...a, group: 'sheep' })),
  ...HATS.map((hat) => ({
    id: `hat-${hat.id}`,
    group: 'hats',
    coloured: true,
    inGame: true,
    subject: `${HAT_DESCRIPTIONS[hat.id]}, drawn on its own as a single object with nothing wearing it. No head, no person, no animal, no mannequin, no stand — just the hat by itself.`,
  })),
  ...Object.entries(EXTRA_HATS).map(([id, hat]) => ({
    id: `hat-${id}`,
    group: 'hats-new',
    coloured: true,
    inGame: false,
    subject: `${hat.description}, drawn on its own as a single object with nothing wearing it. No head, no person, no animal, no mannequin, no stand — just the hat by itself.`,
  })),
  ...DOG.map((a) => ({ ...a, group: 'dog' })),
  ...RIBBONS.map((a) => ({ ...a, group: 'ribbons' })),
  ...EXTRAS.map((a) => ({ ...a, group: 'extras', coloured: true })),
].map((a) => ({
  aspectRatio: '1:1',
  goofy: false,
  coloured: false,
  ...a,
  styleStrength: a.styleStrength ?? STRENGTH[a.group],
  prompt: [STYLE, a.subject, a.goofy ? GOOFY : '', a.coloured ? COLOUR_PUSH : '', FRAMING]
    .filter(Boolean)
    .join(' '),
}));

export const GROUPS = [...new Set(ASSETS.map((a) => a.group))];

/** USD per style-referenced Krea 2 Large image, from the published price list. */
export const PRICE_PER_IMAGE = 0.065;

export default { ASSETS, GROUPS, STYLE, FRAMING, PRICE_PER_IMAGE };
