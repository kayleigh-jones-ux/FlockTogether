# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Node.js server (Express + `ws`) serving two vanilla HTML/CSS/JS front ends — no bundler, no build step, no client-side npm install. Confirmed by the user. Answer clustering calls the Claude API (`claude-opus-5`) server-side via `@anthropic-ai/sdk`.

## Users

Primary users are a **host** and **10–20 players** at a social gathering. The host opens the display view on a laptop or TV; players join from their own phones by scanning a QR code. Two confirmed play scenarios:

1. **Co-located party (10–20 people).** Display on a TV or laptop in the room, everyone holding their own phone.
2. **Remote play over screenshare.** The host shares the display view over Zoom/Discord/Meet; players are elsewhere, joining from phones. This means the display is often viewed at laptop scale inside a video-call window, not at 8-foot TV distance, and the join URL must be reachable beyond the host's LAN.

Nobody installs anything. Players arrive mid-party, possibly tipsy, and must be playing within seconds of scanning.

## Product Purpose

A party game where players are asked a question and score a point only by answering **in the majority** — regardless of what they actually think. The pleasure is second-guessing the room rather than expressing yourself.

Each round: a question appears, all answers stay hidden while a timer runs, submissions close when the timer ends, and the display then reveals every answer sorted into similarity groups with the largest group on top. Everyone in a winning group scores.

Success means a room of people shouting at a screen — the reveal is the entertainment product, not an incidental results table.

## Positioning

Free-text answers clustered by **meaning, not string matching**. "soda", "pop", and "a coke" land in one group. That is what makes an open-ended majority game playable at all: multiple choice makes the majority trivial to find, and exact-match text makes it impossible. Semantic grouping is the mechanism the game is built on.

## Operating Context

- Two simultaneous surfaces, one shared and one private, over a LAN or a tunneled/deployed URL.
- Host device: laptop or TV browser, landscape, often being screenshared.
- Player device: phone browser, portrait, one-handed, thumb-reachable.
- The room's attention lives on the shared display; phones are input devices that should demand as little reading as possible.
- Play is punctuated by dead time (waiting for stragglers) that the display must fill without going inert.

## Capabilities and Constraints

**Confirmed rules:**
- Series of questions per game; free-text answers.
- Answers hidden from everyone until the timer expires; timer expiry closes submissions.
- Display then groups answers by semantic similarity, largest group first.
- Groups animate in bottom-to-top so the winning group lands last.
- **Ties: every tied largest group scores.** All members of all tied groups get a point.
- **Non-submitters score nothing** and are shown in a "didn't answer" bucket on the display.
- Scores are shown at exactly **three** moments: one third of the way through, immediately before the final question, and at the end. Not between other rounds.
- Rounds **auto-advance** after the reveal (the user did not choose host-controlled pacing), with a generous reveal window.

**Technical constraints:**
- Semantic clustering requires `ANTHROPIC_API_KEY` and adds latency between timer end and reveal — the display must cover that gap as part of the show, not as a spinner.
- Grouping is a judgment call made by a model; it can be wrong, and the design should let a room laugh at a bad grouping rather than hide it.
- 10–20 concurrent answers per round is the layout target; up to ~8 clusters.
- Join URL must work off-LAN for the screenshare scenario (public URL / tunnel override).

**Explicitly undecided:** persistence across server restarts, reconnect-after-refresh behavior, question-pack authoring UI, and whether the host is also a player.

## Brand Commitments

Name: **Flock Together** (user-supplied, "for now" — treat as current, not permanent).

## Evidence on Hand

None. There are no real players, transcripts, logos, or prior art for this product. Question content and any example answers shown in the interface are authored for the prototype and must be labeled as such where a viewer could mistake them for real play data. No usage claims, install counts, or testimonials may be invented.

## Product Principles

1. **The reveal is the product.** Every other screen exists to set up the moment answers sort themselves into groups.
2. **Zero onboarding.** Scanning the code is the tutorial. A player who reads nothing should still play correctly.
3. **The room reads the display; the player reads their thumb.** Shared surface carries all the information; the private surface carries one decision.
4. **Waiting is part of the show.** Lobby, timer, and clustering latency are designed states, never dead states.
5. **Wrong groupings are content.** Surface how answers were grouped so a room can argue with it.

## Accessibility & Inclusion

No product-specific standard was established by the user. Baseline craft still applies: group identity must not rest on hue alone (position, label, and count carry it), the reveal animation must respect `prefers-reduced-motion`, and the display must stay legible when downscaled inside a video-call window.
