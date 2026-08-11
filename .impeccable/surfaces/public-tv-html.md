---
version: 1
slug: "public-tv-html"
primary_target: "public/tv.html"
related_targets: ["public/tv.css","public/tv.js"]
---

## Scope

The shared display at `/` (public/tv.html, tv.css, tv.js). Host-operated, landscape,
shown on a TV or laptop and frequently screenshared over a video call.

## Visitor mode

Experience. The room is inside the work: the artifact leads from the first viewport and
the interface recedes. This is the game's stage, not a results table.

## Audience and job

A room of 10-20 players plus one host. The room's job is to read the question, watch who
has answered, and then witness the reveal. Nobody operates this surface except the host,
once, to open the gate.

## Content and proof

Questions come from src/questions.js (authored for the prototype — no real content exists).
Answers are player free text. Group labels come from Claude's clustering, and the surface
states its own provenance: "Grouped by meaning" vs "Grouped by spelling — the shepherd was
offline for that one". Wrong groupings are content, not failures to hide.

## Chosen direction

Paddock Rotation (seed key 75aaed95, candidate 7). Aerial farmland seen from above. Every
game state maps to a real farm artifact rather than invented chrome:

- groups -> paddocks, proportionally sized bands divided by 8px hedgerow ink, largest on top
- who has answered -> a raddle dye mark sprayed on that player's fleece
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

## Unresolved

- Behaviour of the reveal above 8 groups is untested; the treemap keeps tiling but fields
  get small enough that `data-roomy="false"` drops sprites for most of them.
- Behaviour above 20 players is undefined (MAX_PLAYERS caps it, layout untested beyond).
