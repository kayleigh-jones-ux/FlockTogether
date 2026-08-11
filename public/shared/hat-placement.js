/* Where each hat sits on the sheep.
 *
 * The SVG hats shared one 60x60 box anchored at the crown, which worked because
 * they were authored to it. The generated art is not: every hat is trimmed to
 * its own ink, so a UFO and a pair of sunglasses arrive as wildly different
 * shapes with no common anchor at all. Placement therefore has to be DATA, one
 * entry per hat, and it has to be tunable by eye — which is what /admin is for.
 *
 * Numbers are FRACTIONS OF THE SHEEP'S BOX, never pixels, so a placement holds
 * at any render size from the phone's preview down to a sheep in a paddock:
 *
 *   x      0..1 across the sheep, of the hat's CENTRE
 *   y      0..1 down the sheep, of the hat's CENTRE
 *   scale  hat width as a fraction of the sheep's width
 *   rot    degrees, clockwise
 *   flip   mirror horizontally
 *
 * `flip` exists because the sheep always faces right and the props do not. Each
 * was generated alone, with nothing to face, so a fish or a pigeon comes back
 * pointing whichever way the model felt like — and a duck facing backwards off
 * the back of a sheep's head reads as a mistake rather than a joke. Mirroring
 * is free and lossless here, so it is a flag rather than a regenerated asset.
 * It pivots about the hat's own centre, so flipping never moves it.
 *
 * `poses` overrides the shared placement for one pose. Most hats need none —
 * the head barely moves between idle, happy and confused — but the running
 * sheep's head is lower and thrown forward, so anything tall enough to lever
 * off it gets an entry there.
 *
 * EDIT THIS BY HAND ONLY IF YOU ENJOY IT. Open /admin, drag the hat until it
 * sits right, and copy out what it gives you.
 */

/** Sensible starting point for a hat nobody has tuned yet: on the crown. */
export const DEFAULT_PLACEMENT = Object.freeze({
  x: 0.7,
  y: 0.16,
  scale: 0.34,
  rot: 0,
  flip: false,
});

export const PLACEMENTS = {
  /* Tuned via /admin. Anything absent falls back to DEFAULT_PLACEMENT and is
     reported as untuned by `npm run hats`, so a new hat cannot quietly ship
     sitting in the wrong place. */
};

/**
 * Resolve a hat's placement on a given pose.
 * @param {string} hatId
 * @param {string} [pose] e.g. 'sheep-running'
 */
export function placementFor(hatId, pose = 'sheep-idle') {
  const entry = PLACEMENTS[hatId];
  if (!entry) return { ...DEFAULT_PLACEMENT, tuned: false };
  const base = { ...DEFAULT_PLACEMENT, ...entry, tuned: true };
  delete base.poses;
  const override = entry.poses && entry.poses[pose];
  return override ? { ...base, ...override } : base;
}

/** Which hats have never been tuned. Used by the hat registry check. */
export const untunedHats = (hats) => hats.filter((h) => !PLACEMENTS[h.id]).map((h) => h.id);

export default { PLACEMENTS, DEFAULT_PLACEMENT, placementFor };
