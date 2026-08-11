---
version: 1
slug: "public-tv-html"
primary_target: "public/tv.html"
related_targets: ["public/tv.css","public/tv.js"]
---

## Scope

The shared display at `/` (public/tv.html, tv.css, tv.js). Host-operated, landscape,
shown on a TV or laptop and frequently screenshared over a video call. It renders every
player's chosen sheep and never edits one; a look is made on the phone.

## Visitor mode

Experience. The room is inside the work: the artifact leads from the first viewport and
the interface recedes. This is the game's stage, not a results table.

## Audience and job

A room of 10-20 players plus one host. The room's job is to read the question, watch who
has answered, and then witness the reveal. Nobody operates this surface except the host,
once, to open the gate — and before that, to see who is in the flock and who is still
making their sheep.

## Content and proof

Questions come from src/questions.js (authored for the prototype — no real content exists).
Answers are player free text. Group labels come from Claude's clustering, and the surface
states its own provenance: "Grouped by meaning" vs "Grouped by spelling — the shepherd was
offline for that one". Wrong groupings are content, not failures to hide.

Player looks arrive as server state: `players[]` carries each locked player's `look`, and a
sibling `choosing` count says how many have joined but not confirmed one — the headcount
counts the flock proper, so without that line the host watches four phones join and reads
three sheep. Both halves of a look are run back through `shared/look.js` before they touch
the DOM, because the colour id ends up inside a style attribute and the hat id inside a
sprite href; an id this build has never heard of is treated as no look rather than passed
through. Anyone without one — a simulated player, anyone who never chose — keeps the hashed
raddle mark and the enamel fleece they always had.

## Chosen direction

Paddock Rotation (seed key 75aaed95, candidate 7). Aerial farmland seen from above. Every
game state maps to a real farm artifact rather than invented chrome:

- groups -> paddocks, proportionally sized bands divided by 8px hedgerow ink, largest on top
- who is who -> the fleece colour and hat that player chose, worn by their sheep everywhere
  it appears: the lobby flock, the waiting flock during a question, and the sheep inside its
  paddock at the reveal
- who has answered -> a raddle dye mark sprayed on that player's fleece. The dye is still
  hashed from playerId and keeps this one job; identity moved to the fleece and the hat
- the timer -> a five-bar gate swinging shut on its hinge, plus monumental figures
- clustering latency -> the sheepdog's outrun, so the wait is designed rather than dead
- winning group -> a tractor-red prize rosette pinned on, plus gold stubble ground and a
  heavier frame, so the winner never depends on hue alone
- scoreboard -> a livestock grazing record sheet with five-bar tally marks

## Memorable moment

The reveal: paddocks settle in from the bottom up so the largest lands last, and the rosette
pins on after it arrives.

## Constraints

- Must stay legible downscaled inside a video-call window; no reliance on 8-foot distance.
- Group identity carried by position, label and headcount as well as dye.
- prefers-reduced-motion: gate drawn already shut, paddocks already settled, dog still.
- Player names and answers are untrusted text and are escaped at every insertion point.
- The host has exactly one control ever (open the gate). Rounds auto-advance by product rule.
- The paddock tint stays the group's rank dye. A player's colour never tints ground, and the
  sheep's hedgerow-ink outline is what holds the two apart — so a deep fleece, which measures
  around 2:1 against that ink, gets a pale rim outside it. Measured at runtime from look.js,
  not from a list of colours somebody keeps up to date.
- A hat needs headroom the sheep's own 132x104 box does not have, and every render site
  clips. A list opens its viewBox by `HAT_BOX` so no crown is sliced, and the whole list
  shares one box hatted or not, because sheep sitting at different heights reads as a fault
  as badly as a clipped hat does.
- Hats shed with the sprite they are part of. When a tight cell sets `data-roomy="false"`
  the sprite goes and the hat goes with it; the hat is never a separate layer that survives.

## Unresolved

- Behaviour of the reveal above 8 groups is untested; the treemap keeps tiling but fields
  get small enough that `data-roomy="false"` drops sprites for most of them.
- Behaviour above 20 players is undefined (MAX_PLAYERS caps it, layout untested beyond).
- How twenty hats read at reveal size has never been looked at. A hat is 60 units on a
  132-unit sheep, inside a paddock, inside a window that is often a downscaled video-call
  tile — and the sprite disappears entirely below 150px of cell height, so the band where a
  hat is drawn but small is narrow and unobserved. Whether the eight `tall` hats are
  distinguishable from each other in it, or whether they only work in the lobby flock and
  the picker, is unknown. Nobody has rendered this surface with hats on it.
- The `choosing` line is created in tv.js and inserted after the lobby note on first use
  rather than existing in tv.html with its space reserved, so the lobby column shifts the
  first time a player is mid-pick. That is against the reserved-space rule the phone holds.
