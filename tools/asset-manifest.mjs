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

/* COLOUR_PUSH cannot be used on a black object, because it argues with itself:
 * "vivid saturated poster colour" is a description black fails, so asking for a
 * black bowler and then demanding vividness pushed both the bowler and the top
 * hat out to light grey. Black needs the opposite instruction — pinned to the ink
 * rather than pushed away from beige — which is the same fix the grey border
 * collie needed, for the same reason. */
const BLACK_PUSH =
  'The black is DEEP SOLID BLACK, the same near-black as the ink outline — properly black, ' +
  'definitely NOT grey, not silver, not charcoal, not washed out, not pale.';

/* How hard the style reference pulls, per group.
 *
 * The sheep sits at full strength because it IS the reference subject and shares
 * its white-and-grey palette, so there is nothing to lose. Anything that has to
 * own a colour is pulled back until the colour survives, accepting slightly more
 * drift in the outline weight — a hat whose colour is wrong is useless, a hat
 * whose outline is 10% thinner is still fine. */
const STRENGTH = {
  sheep: 0.55,
  dog: 0.20,
  hats: 0.34,
  ribbons: 0.32,
  extras: 0.36,
  'hats-new': 0.34,
  'hats-silly': 0.32,
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
/* Naming a material is what summons a texture.
 *
 * The first hat run asked for "tweed herringbone", "woven straw", "brown
 * checked" and "oilskin" and got back exactly that: a rendered herringbone weave
 * on the flat cap and a checkerboard on the deerstalker, both breaking the flat
 * ink style every other sprite holds. Compounding it, hats run at style strength
 * 0.34 so the reference's own flat-ink pull is weakest exactly here. So a
 * material may only be named where it reads as a colour, and this clause states
 * the ban outright. A printed motif — the headscarf's flowers — is still fine,
 * because that is drawn ON the fabric rather than being the weave of it. */
const NO_TEXTURE =
  'Drawn as flat solid blocks of colour on a plain smooth surface: no fabric texture, no visible weave, ' +
  'no herringbone, no knitted stitches, no checkerboard, no material grain, no straw or leather texture, no sheen.';

/* Hats whose colour IS black. These take BLACK_PUSH instead of COLOUR_PUSH;
 * see the note on BLACK_PUSH for why the two cannot both apply. */
/* The band handed to deepenNeutrals for assets that must read black. 34 is above
 * the ink outline so the outline is never lifted; 150 is below white fleece and
 * below the top hat's grey band, so both survive. See tools/lib/cutout.mjs. */
const DEEPEN_BLACK = Object.freeze({ lo: 34, hi: 150, to: 20 });

const BLACK_HATS = new Set(['bowler', 'top-hat']);

const HAT_DESCRIPTIONS = {
  'flat-cap': 'a flat cap in plain warm brown, with a short stubby peak at the front',
  bobble: 'a winter bobble hat in chunky red and cream horizontal stripes, with a big fluffy cream pom-pom on top',
  /* The silhouette IS the hat. Without the long flared back brim this came back
   * as a generic floppy yellow sun hat, indistinguishable from the boater. */
  'sou-wester':
    "a bright yellow rain hat (a sou'wester) seen from the side, with a small rounded crown and a markedly " +
    'asymmetric brim: short and turned up at the front, sweeping long and wide at the back to throw rain off the neck, ' +
    'with a thin chin strap hanging loose below',
  boater:
    'a boater hat in pale straw yellow with a completely flat circular top, a low straight crown, ' +
    'a narrow flat brim, and a red ribbon band',
  bucket: 'a bucket hat in plain olive green, with a downward-sloping brim all the way round',
  beanie: 'a snug beanie in plain teal, with a thick rolled brim',
  beret: 'a beret in plain dark red, slouching to one side, with a tiny stalk on top',
  /* A headscarf is worn framing a face, so the model obligingly left the face
   * out — a big blank white oval in the middle that reads as an empty head-shaped
   * hole. It has to be described as a piece of cloth, not as something worn. */
  /* Two attempts left a blank white oval in the middle — the face the scarf would
   * frame. The word 'headscarf' is what does it, so the subject is now a folded
   * square of cloth and the hat reading is left to the knot alone. */
  headscarf:
    'a square cloth bandana folded once into a triangle and lying FLAT on a table, seen from straight above, ' +
    'with its two long ends knotted together in a small knot at one corner. ' +
    'Plain cream cloth with a simple pattern of small flat blue flowers drawn across it, ' +
    'solid unbroken cloth from edge to edge — no head, no face, no opening, no gap, no hole, ' +
    'and absolutely NO blank white oval or egg shape anywhere in it',
  visor: 'a sun visor, bright white with a green peak and no crown, so the top is open',
  'baseball-cap': 'a baseball cap in plain royal blue with a curved peak and a button on top',
  earmuffs: 'a pair of fluffy pink earmuffs joined by a padded headband over the top',
  'daisy-chain': 'a flower crown ring of white daisies with round yellow centres and small green leaves',
  bowler: 'a bowler hat in plain solid black with a rounded dome crown and a narrow brim curled up at the sides',
  /* Both peaks and the flaps, or it is just a cap with a bow on it — which is
   * exactly what the first attempt produced. */
  deerstalker:
    'a deerstalker hunting cap seen from the side, in ONE single flat shade of muted brown over the whole hat with no ' +
    'lighter or paler panels anywhere, with a peak at the FRONT and a second matching peak at the BACK, and two ' +
    'brown ear flaps folded up against the crown and tied on top with a small bow',
  /* Came back two-tone — a pale cream crown on a brown brim, reading as two
   * different hats stuck together. The single colour is now stated as such. */
  cowboy:
    'a cowboy hat filled with ONE single flat shade of medium tan brown over the entire hat — the crown and the brim ' +
    'are the identical same colour with no darker area, no lighter area and no shading between them, separated only by ' +
    'the black outline — with a smooth crown of ordinary modest height and a wide brim upturned at the sides',
  'hard-hat': 'a construction hard hat in bright yellow with a few moulded ridges running front to back over the top',
  'top-hat': 'a tall top hat in plain solid black with a straight cylindrical crown and a grey band',
  crown:
    'a crown in bright gleaming golden yellow with five rounded points, each tipped with a round red or blue jewel',
  'party-hat': 'a cone-shaped party hat in bright pink and yellow diagonal stripes, with a small pom-pom at the tip',
  /* The first version left a wide pale ellipse at the base that read as an empty
   * head-shaped hole, which is the one thing these props must never show. */
  antlers:
    'a pair of brown branching deer antlers mounted on a simple thin headband, seen straight from the front. ' +
    'The headband is a narrow flat strip like a hairband, drawn edge-on as a single thin curved line, ' +
    'NOT a wide ring, NOT an oval, NOT a circle, with no gap or hole of any kind in the middle',
  /* Only earns its own slot if it is obviously not the cowboy hat, so the height
   * is stated as a comparison and pushed to the point of absurdity. */
  'ten-gallon':
    'an absurdly oversized ten-gallon cowboy hat in plain tan brown with a dark brown band. ' +
    'The crown is enormously, comically TALL — at least twice the height of a normal cowboy hat and taller than the ' +
    'brim is wide, a huge rounded tower of a crown — above a broad sweeping brim curled up at both sides',
  propeller:
    "a children's propeller beanie: a small round skullcap in bright red, yellow, blue and green quarter panels, " +
    'with a thin post on top carrying a two-bladed propeller',
};

/* The completeness check moved to the bottom of this file, once every group of
   descriptions exists. It used to sit here and only knew about HAT_DESCRIPTIONS,
   so promoting a SILLY prop into look.js threw an error claiming the prompt was
   missing when it was written twenty lines further down. */

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

/* The dog's colouring, stated far harder than feels necessary.
 *
 * First run asked for "flat black and white fur" and got three mid-GREY dogs.
 * The cause is the style reference: its only dark tone is the warm grey of the
 * sheep's face, so at strength 0.46 "black" was pulled straight to that grey. A
 * grey collie beside a white sheep loses the whole black-and-white read the
 * sheepdog depends on, so black is now asserted and grey explicitly refused. */
const DOG_COAT =
  'The dark fur is DEEP SOLID BLACK, the same near-black as the ink outline — pure black, definitely NOT grey, ' +
  'not silver, not charcoal, not washed out — in bold simple flat patches against pure white fur.';

const DOG = [
  {
    id: 'dog-sit',
    subject:
      'A cartoon border collie sheepdog in side view facing right, sitting upright and alert, ' +
      `with a white blaze down the muzzle, one ear up and one ear folded, a bushy tail curled round, pink tongue out. ${DOG_COAT}`,
    goofy: true,
  },
  {
    id: 'dog-run',
    subject:
      'A cartoon border collie sheepdog in side view facing right, running flat out with all four legs stretched wide, ' +
      `ears pinned back, tongue flapping out of the side of its mouth. ${DOG_COAT}`,
    goofy: true,
  },
  {
    id: 'dog-herding',
    subject:
      'A cartoon border collie sheepdog in side view facing right, crouched low in the classic herding stalk with its ' +
      `head down, shoulders low, eyes locked forward in an intense comical stare, tail straight out behind. ${DOG_COAT}`,
    goofy: true,
  },
];

/* --- Silly "hats" that are not hats -------------------------------------
 *
 * Requested: a fish, a flower pot with a rose, sunglasses, reading glasses, and
 * whatever else is funny. The joke only lands if the thing is instantly
 * recognisable as itself while being an absurd choice of headwear, so every one
 * here is picked for a silhouette that survives at sheep-head size — a prop that
 * needs a second look has already lost the gag.
 *
 * These are generated but NOT wired into the game: like any new hat they need an
 * `sp-hat-<id>` symbol drawn on the shared 60x60 crown anchor and an id in
 * look.js before a player can pick one, and `npm run hats` fails if art, symbol
 * and id do not all three exist. `sitsOn` records the intended anchor so whoever
 * draws the symbol knows whether it perches on the crown or sits over the eyes.
 */
const SILLY = {
  fish: {
    isAnimal: true,
    sitsOn: 'crown',
    description:
      'a single plump cartoon fish lying flat on its side, seen from the side, with a fat rounded blue-green body, ' +
      'a big triangular tail fin, one round googly eye and a comically glum downturned mouth',
  },
  flowerpot: {
    sitsOn: 'crown',
    description:
      'a small terracotta orange flower pot with a rim, holding one single tall red rose in full bloom on a green stem ' +
      'with two green leaves',
  },
  sunglasses: {
    sitsOn: 'eyes',
    description:
      'a pair of sunglasses seen straight from the front, with two big rounded very dark black lenses and thick black frames ' +
      'and short arms folded out to each side',
  },
  'reading-glasses': {
    sitsOn: 'eyes',
    description:
      'a pair of ordinary round reading glasses seen straight from the front, with thin dark wire frames, ' +
      'two clear round empty lenses, a small bridge between them and short arms out to each side',
  },
  'rubber-duck': {
    sitsOn: 'crown',
    description:
      'a classic bath-time rubber duck in bright yellow, seen from the side, with a flat orange beak and one small black dot eye',
  },
  'traffic-cone': {
    sitsOn: 'crown',
    description: 'a road traffic cone: a bright orange cone with one white reflective band round it, on a square orange base',
  },
  teacup: {
    sitsOn: 'crown',
    description:
      'a dainty white china teacup with a curly handle, sitting on a matching round saucer, with a small blue floral band, ' +
      'seen from the side',
  },
  watermelon: {
    sitsOn: 'crown',
    description:
      'a single thick wedge of watermelon seen from the side, curved rind side down: bright red-pink flesh with a few black ' +
      'seeds, a thin white line, and a green rind',
  },
  'birthday-cake': {
    sitsOn: 'crown',
    description:
      'a small round birthday cake seen from the side, with pink icing, a scalloped white cream border, ' +
      'and one single lit candle on top with a little orange flame',
  },
  'rain-cloud': {
    sitsOn: 'crown',
    description:
      'a small grumpy grey rain cloud, a fat bumpy cloud shape with four blue teardrop raindrops falling in a row beneath it',
  },
  'sleeping-cat': {
    isAnimal: true,
    sitsOn: 'crown',
    description:
      'a small ginger tabby cat curled up fast asleep in a tight circle, seen from the side, with its tail wrapped round, ' +
      'eyes closed as two small curved lines, and one ear flopped',
  },
  saucepan: {
    sitsOn: 'crown',
    description:
      'a metal saucepan turned completely upside down like a helmet, seen from the side, in flat grey steel ' +
      'with one long black handle sticking straight out to the side',
  },
  'ice-cream': {
    sitsOn: 'crown',
    description:
      'an ice cream cone standing upright, seen from the side, with a pale tan waffle cone below and two round scoops ' +
      'stacked on top — one pink, one mint green — and a red cherry on the very top',
  },
  pigeon: {
    isAnimal: true,
    sitsOn: 'crown',
    description:
      'a fat scruffy cartoon pigeon standing in side view, plump blue-grey body, a small orange beak, ' +
      'one round unimpressed googly eye, and two little orange feet',
  },
  cactus: {
    sitsOn: 'crown',
    description:
      'a small potted cactus: a fat rounded green cactus with two short arms and simple little spines, ' +
      'in a plain terracotta orange pot, with one tiny pink flower on top',
  },
  'fried-egg': {
    sitsOn: 'crown',
    description:
      'a single fried egg, sunny side up, seen from above: a soft wobbly white with a big round bright yellow yolk in the middle',
  },
  snail: {
    isAnimal: true,
    sitsOn: 'crown',
    description:
      'a small cheerful cartoon snail in side view, with a big round spiral shell in warm brown, a soft pale green body, ' +
      'and two long eye stalks with round googly eyes on the ends',
  },
  'deely-boppers': {
    sitsOn: 'crown',
    description:
      'a novelty party headband with two thin bouncy springs standing up from it, each topped with a round glittery pink ball, ' +
      'seen straight from the FRONT. The headband is a narrow flat strip like a hairband, drawn edge-on as a single thin ' +
      'curved line — NOT a wide ring, NOT an oval, NOT an ellipse, NOT a disc, NOT seen in perspective from above, ' +
      'with no gap or hole of any kind in the middle',
  },
  ufo: {
    sitsOn: 'crown',
    description:
      'a tiny cartoon flying saucer seen from the side: a flat silver-grey disc with a clear glass dome on top, ' +
      'three round coloured lights along the rim, and a small green alien with one eye peeking out of the dome',
  },
  'banana-peel': {
    sitsOn: 'crown',
    description:
      'a single banana peel draped open like a floppy hat, seen from the side, with a bright yellow skin ' +
      'and three limp peel strips flopping down and outwards, the fruit gone',
  },
};

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

/* Every headwear prop is drawn with nothing under it, because the game layers it
 * over the sheep sprite rather than baking it in — and a stray head in the art is
 * the failure mode that keeps recurring, so it is refused item by item. */
const NOTHING_WEARING_IT =
  'drawn on its own as one single object with nothing wearing it and nothing underneath it: ' +
  'no head, no face, no person, no animal, no sheep, no mannequin, no stand, no hook — just the object by itself.';

/* Four of the silly props ARE animals — a fish, a curled-up cat, a pigeon, a
 * snail — so the blanket "no animal" above contradicts the subject. In practice
 * the model resolves it by context and draws the fish anyway, but a prompt that
 * argues with itself is one regeneration away from obeying the wrong half, so
 * animals get the same clause with just that phrase dropped. "No sheep" stays:
 * the failure to prevent is a sheep drawn wearing the prop. */
const NOTHING_WEARING_IT_ANIMAL =
  'drawn on its own as one single object with nothing wearing it and nothing underneath it: ' +
  'no head, no face, no person, no sheep, no mannequin, no stand, no hook — just the creature by itself.';

/** Which ids look.js actually offers. The one authority on "in the game". */
const IN_GAME = new Set(HATS.map((h) => h.id));

/** Every asset, with the style preamble already composed into `prompt`. */
export const ASSETS = [
  ...SHEEP.map((a) => ({ ...a, group: 'sheep' })),
  /* Each hat is emitted from exactly ONE of the three description sets. The
     filter matters: promoting a SILLY prop into look.js used to emit it twice,
     once from here with an undefined description ("undefined, drawn on its own
     as a single object") and once from its own block — so the promoted hats
     would have been regenerated from a prompt that was literally the word
     undefined. */
  ...HATS.filter((hat) => HAT_DESCRIPTIONS[hat.id]).map((hat) => ({
    id: `hat-${hat.id}`,
    group: 'hats',
    coloured: !BLACK_HATS.has(hat.id),
    black: BLACK_HATS.has(hat.id),
    ...(BLACK_HATS.has(hat.id) ? { styleStrength: 0.16, deepen: DEEPEN_BLACK } : {}),
    inGame: true,
    flat: true,
    subject: `${HAT_DESCRIPTIONS[hat.id]}, ${NOTHING_WEARING_IT}`,
  })),
  ...Object.entries(EXTRA_HATS).map(([id, hat]) => ({
    id: `hat-${id}`,
    group: 'hats-new',
    coloured: true,
    inGame: IN_GAME.has(id),
    flat: true,
    subject: `${hat.description}, ${NOTHING_WEARING_IT}`,
  })),
  ...Object.entries(SILLY).map(([id, prop]) => ({
    id: `hat-${id}`,
    group: 'hats-silly',
    coloured: true,
    /* Derived, never asserted: a prop is in the game precisely when look.js
       says so, and nothing here gets a second opinion. */
    inGame: IN_GAME.has(id),
    flat: true,
    sitsOn: prop.sitsOn,
    subject: `${prop.description}, ${prop.isAnimal ? NOTHING_WEARING_IT_ANIMAL : NOTHING_WEARING_IT}`,
  })),
  ...DOG.map((a) => ({ ...a, group: 'dog', deepen: DEEPEN_BLACK })),
  ...RIBBONS.map((a) => ({ ...a, group: 'ribbons' })),
  ...EXTRAS.map((a) => ({ ...a, group: 'extras', coloured: true })),
].map((a) => ({
  aspectRatio: '1:1',
  goofy: false,
  coloured: false,
  black: false,
  flat: false,
  deepen: null,
  ...a,
  styleStrength: a.styleStrength ?? STRENGTH[a.group],
  prompt: [
    STYLE,
    a.subject,
    a.goofy ? GOOFY : '',
    a.coloured ? COLOUR_PUSH : '',
    a.black ? BLACK_PUSH : '',
    a.flat ? NO_TEXTURE : '',
    FRAMING,
  ]
    .filter(Boolean)
    .join(' '),
}));

export const GROUPS = [...new Set(ASSETS.map((a) => a.group))];

/* Completeness, checked once everything above exists.
 *
 * Two ways to get this wrong, and both are silent. A hat in look.js with no
 * prompt can never be regenerated, so the day the art is rebuilt it vanishes.
 * A hat emitted twice gets generated twice, costs twice, and whichever prompt
 * runs last wins — which is how you end up debugging a rubber duck that keeps
 * coming back as a description of itself. */
{
  const byId = new Map();
  for (const a of ASSETS) {
    if (!a.group.startsWith('hat')) continue;
    byId.set(a.id, (byId.get(a.id) || 0) + 1);
  }
  const duplicated = [...byId].filter(([, n]) => n > 1).map(([id]) => id);
  if (duplicated.length) {
    throw new Error(`asset-manifest: emitted twice — ${duplicated.join(', ')}`);
  }
  const missing = HATS.filter((h) => !byId.has(`hat-${h.id}`));
  if (missing.length) {
    throw new Error(
      `asset-manifest: hat(s) ${missing.map((h) => `"${h.id}"`).join(', ')} from shared/look.js have no ` +
        'description. Add one to HAT_DESCRIPTIONS, EXTRA_HATS or SILLY.',
    );
  }
}

/** USD per style-referenced Krea 2 Large image, from the published price list. */
export const PRICE_PER_IMAGE = 0.065;

export default { ASSETS, GROUPS, STYLE, FRAMING, PRICE_PER_IMAGE };
