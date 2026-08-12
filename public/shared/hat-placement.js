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
 *   behind draw the prop UNDER the sheep instead of over it
 *
 * `behind` buys depth for nothing. A fish or a pigeon tucked behind the head
 * reads as peeking out from behind the sheep, where the same sprite drawn on
 * top reads as stuck to its face. It is also the only way to make something
 * large — a UFO, a rain cloud — hover without burying the head it belongs to.
 *
 * The fleece tint never touches a prop drawn behind: the colour is painted
 * through the fleece mask, so it only exists where the wool is, and the wool is
 * opaque. Whatever sticks out past the body is untinted, which is what you want.
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
  behind: false,
});

/* Layer numbers, shared so the admin bench and the two surfaces cannot disagree
   about what "behind" means. The fleece tint sits between the art and anything
   drawn over it, because it must colour the wool without colouring the hat.
   The raddle mark sits above the tint and below the hat: it is dye sprayed onto
   an already-coloured fleece, and a hat must never be sprayed with it. */
export const LAYER = Object.freeze({ behind: 0, sheep: 1, fleece: 2, raddle: 3, hat: 4 });

/* Tuned by eye in /admin, 2026-08-11. All forty, every one with per-pose
   overrides — the heads move more between poses than they look like they do,
   and a hat that sits right on the idle sheep rides visibly high on the happy
   one, whose head is thrown back.
   Anything absent falls back to DEFAULT_PLACEMENT and is reported as untuned by
   `npm run hats`, so a new hat cannot quietly ship sitting in the wrong place. */
export const PLACEMENTS = {
  'flat-cap': { x: 0.777, y: 0.079, scale: 0.369, rot: -6, flip: true,
    poses: {
      'sheep-confused': { x: 0.693, y: 0.071 },
      'sheep-happy': { x: 0.752, y: 0.044 },
    },
  },
  'bobble': { x: 0.741, y: 0, scale: 0.326, rot: -10,
    poses: {
      'sheep-confused': { x: 0.655, y: 0.002 },
      'sheep-happy': { x: 0.699, y: 0 },
    },
  },
  'sou-wester': { x: 0.708, y: 0.089, scale: 0.491, rot: -22, flip: true,
    poses: {
      'sheep-happy': { x: 0.637, y: 0.052 },
      'sheep-confused': { x: 0.616, y: 0.077 },
    },
  },
  'boater': { x: 0.754, y: 0.094, scale: 0.434, rot: -12,
    poses: {
      'sheep-confused': { x: 0.664, y: 0.086 },
      'sheep-happy': { x: 0.704, y: 0.057 },
    },
  },
  'bucket': { x: 0.751, y: 0.078, scale: 0.384, rot: -12,
    poses: {
      'sheep-happy': { x: 0.696, y: 0.053 },
      'sheep-confused': { x: 0.673, y: 0.072 },
    },
  },
  'beanie': { x: 0.746, y: 0.063, scale: 0.34, rot: -12,
    poses: {
      'sheep-confused': { x: 0.658, y: 0.051 },
      'sheep-happy': { x: 0.695, y: 0.026 },
    },
  },
  'beret': { x: 0.766, y: 0.052, scale: 0.384, rot: -12,
    poses: {
      'sheep-happy': { x: 0.701, y: 0.05 },
      'sheep-confused': { x: 0.665, y: 0.082 },
    },
  },
  'visor': { x: 0.803, y: 0.123, scale: 0.417, rot: -6, flip: true,
    poses: {
      'sheep-running': { x: 0.797, y: 0.158, rot: -6, scale: 0.369 },
      'sheep-confused': { x: 0.742, y: 0.187 },
      'sheep-happy': { x: 0.782, y: 0.111 },
    },
  },
  'baseball-cap': { x: 0.788, y: 0.106, scale: 0.4, rot: -10, flip: true,
    poses: {
      'sheep-confused': { x: 0.714, y: 0.1 },
      'sheep-happy': { x: 0.757, y: 0.067 },
    },
  },
  'daisy-chain': { x: 0.763, y: 0.123, scale: 0.34, rot: -10,
    poses: {
      'sheep-happy': { x: 0.712, y: 0.105, rot: -18, scale: 0.326 },
      'sheep-confused': { x: 0.683, y: 0.133 },
      'sheep-running': { scale: 0.265, rot: -22, x: 0.732, y: 0.118 },
    },
  },
  'bowler': { x: 0.746, y: 0.085, scale: 0.4, rot: -10,
    poses: {
      'sheep-happy': { x: 0.695, y: 0.048 },
      'sheep-confused': { x: 0.672, y: 0.081 },
      'sheep-running': { x: 0.731, y: 0.088 },
    },
  },
  'deerstalker': { x: 0.763, y: 0.086, scale: 0.471, rot: -10, flip: true,
    poses: {
      'sheep-confused': { x: 0.681, y: 0.086 },
      'sheep-happy': { x: 0.727, y: 0.065 },
    },
  },
  'cowboy': { x: 0.746, y: 0.072, scale: 0.471, rot: -10, flip: true,
    poses: {
      'sheep-happy': { x: 0.684, y: 0.051, rot: -22 },
      'sheep-confused': { x: 0.666, y: 0.082 },
    },
  },
  'hard-hat': { x: 0.767, y: 0.086, scale: 0.4, rot: -14,
    poses: {
      'sheep-confused': { x: 0.683, y: 0.082 },
      'sheep-happy': { x: 0.731, y: 0.078 },
    },
  },
  'top-hat': { x: 0.733, y: 0, scale: 0.384, rot: -10,
    poses: {
      'sheep-happy': { x: 0.702, y: 0 },
      'sheep-confused': { x: 0.655, y: 0 },
    },
  },
  'crown': { x: 0.737, y: 0.041, scale: 0.384, rot: -14,
    poses: {
      'sheep-confused': { x: 0.651, y: 0.047 },
      'sheep-happy': { x: 0.689, y: 0.029 },
    },
  },
  'party-hat': { x: 0.722, y: 0, scale: 0.199, rot: -16,
    poses: {
      'sheep-happy': { x: 0.682, y: 0 },
      'sheep-confused': { x: 0.638, y: 0 },
      'sheep-running': { x: 0.703, y: 0 },
    },
  },
  'antlers': { x: 0.74, y: 0.011, scale: 0.34, rot: -12,
    poses: {
      'sheep-running': { x: 0.711, y: 0.011 },
      'sheep-confused': { x: 0.645, y: 0.003 },
      'sheep-happy': { x: 0.685, y: 0 },
    },
  },
  'ten-gallon': { x: 0.733, y: 0, scale: 0.491, rot: -10,
    poses: {
      'sheep-happy': { x: 0.679, y: 0, rot: -16, scale: 0.434 },
      'sheep-confused': { x: 0.655, y: 0 },
      'sheep-running': { x: 0.704, y: 0, rot: -14, scale: 0.417 },
    },
  },
  'propeller': { x: 0.744, y: 0.034, scale: 0.313, rot: -10,
    poses: {
      'sheep-confused': { x: 0.662, y: 0.038, rot: -10, scale: 0.354 },
      'sheep-running': { x: 0.717, y: 0.038, scale: 0.288, rot: -14 },
      'sheep-happy': { x: 0.7, y: 0.001 },
    },
  },
  'sunglasses': { x: 0.811, y: 0.274, scale: 0.326, rot: -10,
    poses: {
      'sheep-running': { rot: -20, x: 0.809, y: 0.264 },
      'sheep-confused': { x: 0.746, y: 0.29, rot: -14 },
      'sheep-happy': { x: 0.757, y: 0.214, rot: -16, scale: 0.3 },
      'sheep-idle': { x: 0.807, y: 0.27 },
    },
  },
  'reading-glasses': { x: 0.814, y: 0.283, scale: 0.384, rot: -8,
    poses: {
      'sheep-happy': { x: 0.766, y: 0.223 },
      'sheep-confused': { x: 0.747, y: 0.295 },
      'sheep-running': { x: 0.812, y: 0.268, rot: -16, scale: 0.354 },
    },
  },
  'banana-peel': { x: 0.74, y: 0.027, scale: 0.34, rot: -8,
    poses: {
      'sheep-confused': { x: 0.654, y: 0.025 },
      'sheep-happy': { x: 0.706, y: 0.017 },
    },
  },
  'fried-egg': { x: 0.755, y: 0.117, scale: 0.354, rot: -4,
    poses: {
      'sheep-happy': { x: 0.707, y: 0.049 },
      'sheep-confused': { x: 0.681, y: 0.105 },
      'sheep-running': { x: 0.747, y: 0.1 },
    },
  },
  'sleeping-cat': { x: 0.721, y: 0.027, scale: 0.4, rot: 0,
    poses: {
      'sheep-confused': { x: 0.649, y: 0.045 },
      'sheep-happy': { x: 0.696, y: 0.039 },
    },
  },
  'fish': { x: 0.734, y: 0.035, scale: 0.417, rot: 0,
    poses: {
      'sheep-happy': { x: 0.664, y: 0.051, rot: -16 },
      'sheep-running': { rot: -18, x: 0.688, y: 0.065 },
      'sheep-confused': { x: 0.627, y: 0.067, rot: -12 },
    },
  },
  'snail': { x: 0.763, y: 0.001, scale: 0.313, rot: -4,
    poses: {
      'sheep-running': { rot: -22, x: 0.717, y: 0 },
      'sheep-confused': { x: 0.662, y: 0.017, rot: -16 },
      'sheep-happy': { rot: -14, x: 0.698, y: 0.001 },
    },
  },
  'watermelon': { x: 0.75, y: 0.029, scale: 0.34, rot: 0,
    poses: {
      'sheep-happy': { rot: -16, x: 0.695, y: 0.029 },
      'sheep-confused': { rot: -20, x: 0.668, y: 0.045 },
      'sheep-running': { rot: -38, x: 0.718, y: 0.044 },
    },
  },
  'saucepan': { x: 0.649, y: 0.083, scale: 0.554, rot: -6,
    poses: {
      'sheep-confused': { x: 0.565, y: 0.097, rot: -8 },
      'sheep-happy': { x: 0.58, y: 0.042 },
    },
  },
  'teacup': { x: 0.762, y: 0.029, scale: 0.3, rot: -2,
    poses: {
      'sheep-happy': { x: 0.696, y: 0.023, rot: -22 },
      'sheep-confused': { x: 0.669, y: 0.033, rot: -16 },
      'sheep-running': { rot: -28, x: 0.709, y: 0.034 },
    },
  },
  'rubber-duck': { x: 0.748, y: 0.013, scale: 0.276, rot: -4,
    poses: {
      'sheep-running': { rot: -24, x: 0.693, y: 0.015 },
      'sheep-confused': { x: 0.653, y: 0.013, rot: -12 },
      'sheep-happy': { rot: -14, x: 0.683, y: 0.005 },
    },
  },
  'pigeon': { x: 0.765, y: 0, scale: 0.254, rot: 2,
    poses: {
      'sheep-happy': { x: 0.708, y: 0, rot: -10 },
      'sheep-confused': { x: 0.693, y: 0, rot: -6 },
      'sheep-running': { x: 0.733, y: 0, rot: -18 },
    },
  },
  'ice-cream': { x: 0.75, y: 0.066, scale: 0.326, rot: -2,
    poses: {
      'sheep-running': { rot: -26, x: 0.677, y: 0.068, scale: 0.369 },
      'sheep-confused': { x: 0.636, y: 0.062, rot: -20, scale: 0.417 },
      'sheep-happy': { rot: -12, scale: 0.384, x: 0.657, y: 0.043 },
      'sheep-idle': { rot: -10, scale: 0.417, x: 0.729, y: 0.055 },
    },
  },
  'flowerpot': { x: 0.763, y: 0, scale: 0.191, rot: 0,
    poses: {
      'sheep-idle': { x: 0.761, y: 0 },
      'sheep-happy': { x: 0.687, y: 0, scale: 0.163, rot: -12 },
      'sheep-confused': { x: 0.642, y: 0, rot: -14 },
      'sheep-running': { x: 0.705, y: 0, rot: -14, scale: 0.183 },
    },
  },
  'cactus': { x: 0.75, y: 0, scale: 0.254, rot: -6,
    poses: {
      'sheep-running': { x: 0.695, y: 0, rot: -22, scale: 0.234 },
      'sheep-happy': { x: 0.693, y: 0, scale: 0.216 },
      'sheep-confused': { x: 0.643, y: 0, scale: 0.265, rot: -14 },
    },
  },
  'birthday-cake': { x: 0.76, y: 0.01, scale: 0.313, rot: -2,
    poses: {
      'sheep-running': { rot: -22, x: 0.705, y: 0.037 },
      'sheep-idle': { rot: -8, scale: 0.369, x: 0.751, y: 0.025 },
      'sheep-happy': { x: 0.71, y: 0.022 },
      'sheep-confused': { x: 0.654, y: 0.05, rot: -10, scale: 0.369 },
    },
  },
  'traffic-cone': { x: 0.733, y: 0, scale: 0.288, rot: -12,
    poses: {
      'sheep-running': { x: 0.71, y: 0 },
      'sheep-confused': { x: 0.643, y: 0 },
      'sheep-happy': { x: 0.689, y: 0 },
    },
  },
  'rain-cloud': { x: 0.761, y: 0, scale: 0.34, rot: 0,
    poses: {
      'sheep-happy': { x: 0.683, y: 0.002, scale: 0.326, rot: -12 },
      'sheep-confused': { x: 0.652, y: 0, rot: -8 },
      'sheep-running': { rot: -8, x: 0.734, y: 0 },
    },
  },
  'deely-boppers': { x: 0.755, y: 0, scale: 0.234, rot: -2,
    poses: {
      'sheep-running': { rot: -14, x: 0.709, y: 0 },
      'sheep-confused': { x: 0.65, y: 0, rot: -12 },
      'sheep-happy': { x: 0.694, y: 0, rot: -14 },
    },
  },
  'ufo': { x: 0.757, y: 0, scale: 0.417, rot: 2,
    poses: {
      'sheep-happy': { rot: -12, x: 0.694, y: 0 },
      'sheep-confused': { x: 0.649, y: 0, rot: -14 },
      'sheep-running': { rot: -16, x: 0.713, y: 0 },
    },
  },
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
