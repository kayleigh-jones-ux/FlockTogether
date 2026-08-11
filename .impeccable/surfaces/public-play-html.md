---
version: 1
slug: "public-play-html"
primary_target: "public/play.html"
related_targets: ["public/play.css","public/play.js"]
---

## Scope

The phone controller at `/play` (public/play.html, play.css, play.js). One per player,
portrait, held one-handed, often at a party and often not entirely sober. Includes the
customise step between joining and the lobby, where a player makes their own sheep.

## Visitor mode

Operate. The room's attention belongs to the shared display; this surface carries exactly
one decision per round and should demand as little reading as possible.

## Audience and job

A player who arrived by scanning a QR code and has read no instructions. Their whole job:
read the question, type one to three words, send before the gate shuts. Everything else —
who else has answered, how the groups fell out, the running scores — is the display's job,
not theirs. On the way in — and again from the lobby, if they want to — they have a second
job: choose a fleece colour and a hat.

## Content and proof

The question, their own answer, their own outcome. No leaderboards, no other players'
answers, no history. `you.myGroupId` and `you.scoredThisRound` arrive only from the reveal
phase onward, so nothing before that can hint at the result.

The customise step is the one screen that carries more than one decision, and it is still
about one thing: the sheep the player is looking at. Thirty colours and twenty hats, both
read from `shared/look.js` and named in text beside the swatch, with the player's own sheep
previewed live above them. Uniqueness is on the pair, so a colour only greys out once every
hat against it is gone, and a hat only once every colour is — and the player's own confirmed
pair is never struck out against itself, because re-confirming is a change, not a clash.
The `look.taken` list is advisory: the server is the authority, and a race comes back as
`LOOK_TAKEN` against the draft rather than being prevented in the picker.

## Chosen direction

Inherits the Paddock Rotation world (seed key 75aaed95). The player IS one sheep:

- identity -> an ear tag carrying their name, plus the fleece colour and hat they chose,
  worn by every sheep this surface draws
- the customise step -> a sheep being built. The preview is the largest thing on the screen
  because it is the player looking at themselves
- the raddle colour is still derived from playerId alone (public/shared/raddle.js) and is
  still byte-identical on the phone and the big screen, but it is no longer what says which
  player this is — it is the spray mark that says they answered
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
- A look is changeable from the lobby until the host starts; the picker reopens with the
  player's current pair intact and an escape back to it that costs nothing.
- Colour and hat, ids and validation come from `shared/look.js` and are defined nowhere
  else. The hat's placement comes from `HAT_BOX`, never from literals in markup.
- Being dropped for not choosing in time is stated plainly and points at the next game.

## Unresolved

- Nothing on the picker warns a first-time chooser that the host can start without them.
  `NOT_LOCKED` is the first they hear of it, after the room has gone.
- Neither the picker nor a hatted sheep has been rendered by anyone. Whether fifty chips in
  the scrolling region stay thumb-reachable on a short frame, and whether a 60x60 hat still
  reads at chip size, is unknown.
- The picker is fifty plain buttons in two labelled groups, so a keyboard or switch user
  passes thirty colours to reach the hats and fifty to reach the confirm. No roving tabindex,
  no radio-group semantics; whether that is acceptable or needs both, undecided.
