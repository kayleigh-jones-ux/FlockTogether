/* Raddle dye assignment — shared by BOTH surfaces.
 *
 * Raddle marks flock membership, so a player's mark must be the SAME colour on
 * the phone and on the big screen, and must survive a reconnect. It is therefore
 * derived from the playerId alone: no server field, no join order, no random.
 *
 * The hash is FNV-1a (32-bit), using Math.imul so the multiply stays exact in
 * JS number space. Do not "improve" it — the display and the phone must agree
 * byte for byte, so any change here is a change to both surfaces at once.
 */

/** How many raddle colours tokens.css defines (--raddle-1 … --raddle-8). */
export const RADDLE_COUNT = 8;

/**
 * @param {string} id  A playerId (or any stable identity string).
 * @returns {{ index: number, cssVar: string }} index is 1-based (1…8),
 *   cssVar is the custom property name, e.g. "--raddle-3".
 */
export function raddleFor(id) {
  const key = String(id ?? '');
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0; // FNV prime, kept in uint32
  }
  // Avalanche before taking the modulus. `% 8` reads only the low three bits,
  // and raw FNV keeps short similar keys ("p_a1", "p_b2") clustered there —
  // which would hand half a party the same dye. This spreads them.
  h ^= h >>> 16;
  h = Math.imul(h, 0x2b2ae35d) >>> 0;
  h ^= h >>> 15;

  const index = ((h >>> 0) % RADDLE_COUNT) + 1;
  return { index, cssVar: `--raddle-${index}` };
}

/** Convenience: the value you can drop straight into a CSS declaration. */
export function raddleVar(id) {
  return `var(${raddleFor(id).cssVar})`;
}

/* --- Group dyes, by rank ------------------------------------------------
 * Answer-groups are a different problem from players. Groups are rendered as
 * adjacent paddock bands in rank order, so hashing would sometimes hand two
 * neighbouring paddocks the same dye. Assign by position instead, walking a
 * spread order so consecutive bands are always far apart in hue.
 *
 * @param {number} rank 0-based position in the ranked group list.
 */
const RANK_SPREAD = [1, 3, 4, 6, 2, 8, 5, 7];

export function raddleForRank(rank) {
  const index = RANK_SPREAD[((rank % RANK_SPREAD.length) + RANK_SPREAD.length) % RANK_SPREAD.length];
  return { index, cssVar: `--raddle-${index}` };
}

export function raddleVarForRank(rank) {
  return `var(${raddleForRank(rank).cssVar})`;
}

export default raddleFor;
