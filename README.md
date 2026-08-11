# Flock Together

A party game for 10–20 people. A question appears on a shared display, everyone
types a free-text answer on their phone, and **you only score by answering with
the majority**. Answers stay hidden until the timer ends, then the display sorts
them into similarity groups — largest group on top — and everyone in a winning
group takes a point.

Read `PRODUCT.md` first: it is the authority on the rules.

## Requirements

- Node.js 20 or newer (developed on Node 24)
- An `ANTHROPIC_API_KEY` for semantic grouping (optional — see below)
- No build step, no bundler, no client-side npm. The two front ends in
  `public/` are plain HTML/CSS/JS served as-is.

## Install

```sh
npm install
```

## Run

```sh
npm start          # node server.js
npm run dev        # node --watch server.js  (restarts on file changes)
```

On startup the server prints the two URLs you need:

- **Display** — `http://localhost:3000/` → open on the TV or laptop
- **Player join URL** — printed alongside it, and encoded in the on-screen QR code

Players scan the QR (or type the join URL), type a name, then **make their sheep**
— a fleece colour and a hat — and confirm it. Confirming is what puts them in the
flock; the display counts how many are still choosing, and anyone still choosing
when the host starts is dropped from the room. A look can be changed from the
lobby until the game starts. Nobody installs anything.

## Screenshare / remote play: set `PUBLIC_URL`

By default the join URL uses the first non-internal IPv4 address of this
machine — perfect for a co-located party on one Wi-Fi network, useless if you
are sharing the display over Zoom/Discord/Meet and players are elsewhere. A LAN
address in the QR is unreachable for them.

When the game is reachable at some other origin — a tunnel, a deploy, a
reverse proxy — set `PUBLIC_URL` to that origin and the QR and join URL follow:

```sh
# tunnel (cloudflared, ngrok, tailscale funnel, …)
PUBLIC_URL=https://your-tunnel.example.com npm start

# deployed behind a proxy on the default port
PUBLIC_URL=https://flock.example.com npm start
```

`PUBLIC_URL` should include the scheme and, if non-standard, the port. Do not
add a trailing path — the server appends `/play?room=ABCD` itself.

Resolution order for the join URL, highest priority first:

1. `PUBLIC_URL`
2. the first non-internal IPv4 address from `os.networkInterfaces()`
3. `http://localhost:<PORT>`

## Where the API key goes

Semantic grouping calls the Claude API **server-side only** — the key is never
sent to a browser. Provide it as an environment variable named
`ANTHROPIC_API_KEY`:

```sh
# macOS / Linux
export ANTHROPIC_API_KEY=sk-ant-...
npm start

# Windows PowerShell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
npm start
```

If the key is missing, the server says so at startup and grouping degrades to
plain text matching. The display reports which method was used
(`groupingSource: 'claude' | 'fallback'`) rather than hiding it — a room should
be able to argue with a bad grouping.

Never commit the key. Do not put it in `public/`.

## Configuration

Everything is an environment variable with a sane default. See `src/config.js`.

| Variable            | Default | What it does                                          |
| ------------------- | ------- | ----------------------------------------------------- |
| `PORT`              | `3000`  | HTTP + WebSocket port                                 |
| `PUBLIC_URL`        | *unset* | Origin used for the join URL and QR (see above)       |
| `ANSWER_SECONDS`    | `45`    | Seconds to answer before submissions close            |
| `REVEAL_MS`         | `9000`  | How long the reveal holds before auto-advancing       |
| `SCORES_MS`         | `8000`  | How long a scoreboard holds                           |
| `LOBBY_MIN_PLAYERS` | `2`     | Players needed before the display can start           |
| `MAX_PLAYERS`       | `20`    | Hard cap per room                                     |
| `DEFAULT_ROUNDS`    | `9`     | Questions per game                                    |
| `ANTHROPIC_API_KEY` | *unset* | Enables semantic grouping                             |

## Layout

```
server.js             transport only: HTTP, /socket, rooms, QR, broadcast
src/config.js         frozen config object, all env-overridable
src/game.js           the game engine — owns every state transition
src/questions.js      question pack
src/grouping.js       semantic grouping via the Claude API, with a fallback
public/tv.*           the shared display
public/play.*         the phone view
public/shared/        design tokens, sprite sheet, transport, raddle colours
public/shared/look.js the 30 fleece colours and 20 hats — imported by both sides
public/fonts/         self-hosted variable fonts, so the game works offline
tools/preflight.js    pre-party diagnostic
tools/simulate.js     headless player simulator
```

`GET /healthz` returns room and connection counts if you need a liveness probe.

## Before the party: `preflight`

```sh
node tools/preflight.js
```

Checks Node's version, that dependencies resolve, whether semantic grouping is
enabled, the exact join URL the QR will encode, that the fonts are present, and
that the port is free. It tells you the two things that actually ruin a party —
an unreachable join URL and a missing API key — before anyone is in the room.

## Testing without 15 phones

```sh
# whole game, no browser at all: creates the room, joins N players, starts it
node tools/simulate.js --auto-create --players 12

# join a room you already opened on the display
node tools/simulate.js --room ABCD --players 8 --miss 2 --slow 3
```

`--miss N` makes N players never answer, exercising the non-submitter rule and
the "missed the gate" bucket. `--slow N` makes N answer in the last two seconds.
The simulator prints each round's groups, which ones scored, and a `check` line
comparing the grouping against the answers it intended — which is how you judge
grouping quality. Run it against a short game to iterate quickly:

```sh
DEFAULT_ROUNDS=3 ANSWER_SECONDS=5 npm start
```

## Notes

- One WebSocket endpoint: `/socket`. Every frame is JSON with a `t` field.
- Rooms use 4-character codes from an alphabet with no `O`, `0`, `I`, `1`, or
  `L`, so nobody mistypes a code read off a screen.
- Answer text is never sent to any client while the answer timer is running.
- `public/shared/look.js` is the single source of truth for fleece colours and
  hats. The server imports it off disk to validate what a phone sends; both
  surfaces load the same file over HTTP at `/shared/look.js`. Colours, hats, ids
  and validation are defined there and nowhere else — if the two sides disagree
  about what is selectable, a player gets told their own choice does not exist.
  `tokens.css` and `sprites.svg` carry copies of the values (a `--fleece-<id>`
  per colour, a `sp-hat-<id>` per hat) that must not drift from it.
- Rounds auto-advance after the reveal. There is no host "next" button.
- Nothing persists across a server restart; an in-progress game does not
  survive `npm run dev` reloading.
- Question content and any example answers in the interface are authored for
  this prototype, not captured from real play.
