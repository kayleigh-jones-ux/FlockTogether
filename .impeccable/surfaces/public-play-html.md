---
version: 1
slug: "public-play-html"
primary_target: "public/play.html"
related_targets: ["public/play.css","public/play.js"]
---

## Scope

The phone controller at `/play` (public/play.html, play.css, play.js). One per player,
portrait, held one-handed, often at a party and often not entirely sober.

## Visitor mode

Operate. The room's attention belongs to the shared display; this surface carries exactly
one decision per round and should demand as little reading as possible.

## Audience and job

A player who arrived by scanning a QR code and has read no instructions. Their whole job:
read the question, type one to three words, send before the gate shuts. Everything else —
who else has answered, how the groups fell out, the running scores — is the display's job,
not theirs.

## Content and proof

The question, their own answer, their own outcome. No leaderboards, no other players'
answers, no history. `you.myGroupId` and `you.scoredThisRound` arrive only from the reveal
phase onward, so nothing before that can hint at the result.

## Chosen direction

Inherits the Paddock Rotation world (seed key 75aaed95). The player IS one sheep:

- identity -> an ear tag carrying their name, tinted with their own raddle dye
- the raddle colour is derived from playerId alone (public/shared/raddle.js), so it is the
  same colour on the phone and on the big screen, and survives a reconnect
- the answer field -> a chalk slate; the submit control -> a hazard-yellow gate lever
- submitting sprays the raddle mark onto their fleece, mirroring the mark that appears on
  their sheep on the shared display at the same moment

## Memorable moment

That mirrored spray. One action, two screens, same colour — the private confirmation and
the public one are the same event.

## Constraints

- Input font-size at least 16px equivalent, or iOS zooms the viewport on focus.
- Submit lever clears `env(safe-area-inset-bottom)` and stays out of the thumb-hidden zone.
- No layout shift between phases; space is reserved, not reflowed.
- Answers remain editable until `endsAt`; the player must always be able to see what they said.
- Losing is never scolded. "The gate shut without you" is factual, not a telling-off.
- Untrusted text is escaped at every insertion point.

## Unresolved

- `setScreen()` marks the outgoing screen `inert` without moving focus, so a player focused
  in the answer field when the phase flips loses focus to `<body>`.
- After joining, no `<h1>` remains in the accessibility tree (`#join-h` is the only one and
  its screen becomes hidden and inert).
