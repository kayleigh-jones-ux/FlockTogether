/* A player's LOOK — fleece colour plus hat.
 *
 * This module is the single source of truth for both, and it is imported by
 * BOTH sides: the browser surfaces load it over HTTP from /shared/look.js, and
 * the server imports it off disk to validate what a phone sends. Nothing about
 * a look may be defined anywhere else, or the server and the surfaces will
 * disagree about what is selectable and a player will be told their own choice
 * does not exist.
 *
 * Colour used to be derived from the playerId by hashing (see raddle.js). It is
 * now CHOSEN, so it is server state that must survive a reconnect — the hash is
 * kept only as the opening suggestion in the picker and as the stand-in for
 * flock members who never choose, such as simulated players.
 *
 * Uniqueness is on the PAIR. Two players may share a colour, or share a hat,
 * but not both at once: 30 x 20 = 600 combinations against a 20-player cap, so
 * a real party never runs out and the clash error only fires on an exact
 * collision.
 */

/* --- Fleece colours ------------------------------------------------------
 * Ten hue families, three shades each, ordered light -> deep within a family.
 * The picker lays this out as a grid of families so the shades of one hue read
 * as a set rather than as three unrelated swatches.
 *
 * Every one of these is a real fill behind the hedgerow-ink outline, so they
 * are chosen to hold their identity at sheep size on a screenshared TV — the
 * pale band is never so pale it reads as the default enamel fleece, and the
 * deep band never so dark it reads as the ink itself.
 */
export const FLEECE_COLOURS = Object.freeze([
  { id: 'blossom',      name: 'Blossom',       hex: '#f2a79b', family: 'red' },
  { id: 'raddle-red',   name: 'Raddle red',    hex: '#d1503c', family: 'red' },
  { id: 'barn-red',     name: 'Barn red',      hex: '#8f2f22', family: 'red' },

  { id: 'apricot',      name: 'Apricot',       hex: '#f5bd93', family: 'orange' },
  { id: 'marmalade',    name: 'Marmalade',     hex: '#de7c33', family: 'orange' },
  { id: 'rust',         name: 'Rust',          hex: '#9a4c15', family: 'orange' },

  { id: 'oat',          name: 'Oat',           hex: '#f3d79a', family: 'gold' },
  { id: 'stubble-gold', name: 'Stubble gold',  hex: '#d8a13a', family: 'gold' },
  { id: 'harvest',      name: 'Harvest',       hex: '#94661a', family: 'gold' },

  { id: 'new-hay',      name: 'New hay',       hex: '#d8e39a', family: 'lime' },
  { id: 'meadow',       name: 'Meadow',        hex: '#a8bc45', family: 'lime' },
  { id: 'olive',        name: 'Olive',         hex: '#6b7a22', family: 'lime' },

  { id: 'mint',         name: 'Mint',          hex: '#a5dcb4', family: 'green' },
  { id: 'pasture',      name: 'Pasture',       hex: '#4ea86c', family: 'green' },
  { id: 'hedge-green',  name: 'Hedge green',   hex: '#2b6b43', family: 'green' },

  { id: 'dew',          name: 'Dew',           hex: '#9adcd6', family: 'teal' },
  { id: 'teal',         name: 'Teal',          hex: '#35a89c', family: 'teal' },
  { id: 'deep-teal',    name: 'Deep teal',     hex: '#1d6a63', family: 'teal' },

  { id: 'sky',          name: 'Sky',           hex: '#a8d4ec', family: 'sky' },
  { id: 'kingfisher',   name: 'Kingfisher',    hex: '#3f96c9', family: 'sky' },
  { id: 'slate-blue',   name: 'Slate blue',    hex: '#1f5e83', family: 'sky' },

  { id: 'haze',         name: 'Haze',          hex: '#b0c2ee', family: 'blue' },
  { id: 'cobalt',       name: 'Cobalt',        hex: '#5470c4', family: 'blue' },
  { id: 'midnight',     name: 'Midnight',      hex: '#2e4283', family: 'blue' },

  { id: 'lilac',        name: 'Lilac',         hex: '#c9b6e8', family: 'violet' },
  { id: 'thistle',      name: 'Thistle',       hex: '#8360c0', family: 'violet' },
  { id: 'damson',       name: 'Damson',        hex: '#503a7d', family: 'violet' },

  { id: 'clover',       name: 'Clover',        hex: '#eeb0d0', family: 'pink' },
  { id: 'foxglove',     name: 'Foxglove',      hex: '#cc4f92', family: 'pink' },
  { id: 'mulberry',     name: 'Mulberry',      hex: '#862c5c', family: 'pink' },
]);

/* --- Hats ----------------------------------------------------------------
 * Twenty, each a symbol in sprites.svg with the id `sp-hat-<id>`. Every hat
 * symbol shares one viewBox and one anchor point so a hat can be swapped
 * without re-positioning it on the sheep — see the HAT_ANCHOR note below.
 *
 * `tall` marks hats whose silhouette runs high above the anchor. The reveal
 * gives a sheep very little headroom inside a paddock, so tall hats are the
 * first thing clipped when a cell is tight.
 */
export const HATS = Object.freeze([
  { id: 'flat-cap',     name: 'Flat cap',      tall: false },
  { id: 'bobble',       name: 'Bobble hat',    tall: false },
  { id: 'sou-wester',   name: "Sou'wester",    tall: false },
  { id: 'boater',       name: 'Straw boater',  tall: false },
  { id: 'bucket',       name: 'Bucket hat',    tall: false },
  { id: 'beanie',       name: 'Beanie',        tall: false },
  { id: 'beret',        name: 'Beret',         tall: false },
  { id: 'headscarf',    name: 'Headscarf',     tall: false },
  { id: 'visor',        name: 'Sun visor',     tall: false },
  { id: 'baseball-cap', name: 'Baseball cap',  tall: false },
  { id: 'earmuffs',     name: 'Earmuffs',      tall: false },
  { id: 'daisy-chain',  name: 'Daisy chain',   tall: false },
  { id: 'bowler',       name: 'Bowler',        tall: true },
  { id: 'deerstalker',  name: 'Deerstalker',   tall: true },
  { id: 'cowboy',       name: 'Cowboy hat',    tall: true },
  { id: 'hard-hat',     name: 'Hard hat',      tall: true },
  { id: 'top-hat',      name: 'Top hat',       tall: true },
  { id: 'crown',        name: 'Crown',         tall: true },
  { id: 'party-hat',    name: 'Party hat',     tall: true },
  { id: 'antlers',      name: 'Antlers',       tall: true },
  { id: 'ten-gallon',   name: 'Ten-gallon hat', tall: true },
  { id: 'propeller',    name: 'Propeller beanie', tall: true },
]);

/* Adding a hat means THREE places, and they are checked against each other by
 * `npm run hats` — nothing here is a list you can update on its own:
 *   1. this array                          — what a player may pick
 *   2. sprites.svg `sp-hat-<id>`           — what they actually see
 *   3. asset-manifest.mjs HAT_DESCRIPTIONS — the words that generate its art
 * An id present here but missing from sprites.svg is the worst of the three: it
 * is not an error anywhere at runtime, it is a player wearing something nobody
 * else can see. */

/* Every hat symbol is authored in a 60x60 box whose BOTTOM CENTRE (30,60) sits
 * on the sheep's crown. The sheep sprite is 132x104 with its head centred near
 * (112,52) and the crown at roughly (108,30), so a hat is placed with
 *   <use href="#sp-hat-x" x="78" y="-30" width="60" height="60"/>
 * inside the sheep's own coordinate space. Authoring every hat to that one box
 * is what makes the hat swappable by id alone. */
export const HAT_BOX = Object.freeze({ size: 60, x: 78, y: -30 });

const COLOUR_BY_ID = new Map(FLEECE_COLOURS.map((c) => [c.id, c]));
const HAT_BY_ID = new Map(HATS.map((h) => [h.id, h]));

export const colourById = (id) => COLOUR_BY_ID.get(String(id)) || null;
export const hatById = (id) => HAT_BY_ID.get(String(id)) || null;

/** The CSS custom property carrying a colour, defined in tokens.css. */
export const colourToken = (id) => `--fleece-${id}`;
export const colourVar = (id) => `var(--fleece-${id})`;

/** Stable key for a look, used for the taken-set and for equality. */
export const lookKey = (look) =>
  look && look.colorId && look.hatId ? `${look.colorId}/${look.hatId}` : '';

export const sameLook = (a, b) => !!lookKey(a) && lookKey(a) === lookKey(b);

/**
 * Validate a look off the wire. Returns the normalised look, or an error code.
 * @returns {{ look: {colorId:string,hatId:string} } | { error: string, message: string }}
 */
export function validateLook(raw) {
  const colorId = String((raw && raw.colorId) ?? '');
  const hatId = String((raw && raw.hatId) ?? '');
  if (!colourById(colorId)) {
    return { error: 'BAD_LOOK', message: 'That fleece colour is not one of ours.' };
  }
  if (!hatById(hatId)) {
    return { error: 'BAD_LOOK', message: 'That hat is not one of ours.' };
  }
  return { look: { colorId, hatId } };
}

/** How many distinct looks exist. Sanity: must exceed any sane MAX_PLAYERS. */
export const LOOK_COMBINATIONS = FLEECE_COLOURS.length * HATS.length;

export default { FLEECE_COLOURS, HATS, validateLook, lookKey, sameLook };
