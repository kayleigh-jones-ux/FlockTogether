---
name: Flock Together
description: Aerial farmland seen from above — saturated pasture, hedgerow ink, enamel farm signs, and raddle dye for identity.
colors:
  pasture-deep: "#1c4a22"
  pasture: "#2f6b33"
  pasture-lit: "#478b3b"
  growth: "#8fbf3f"
  growth-pale: "#b7d768"
  stubble: "#e0ae35"
  stubble-pale: "#f0d391"
  earth: "#a8562c"
  earth-deep: "#7d3d1f"
  hedge: "#12180f"
  hedge-soft: "#263021"
  enamel: "#f5efe0"
  enamel-shade: "#e2d9c4"
  steel: "#b7bcb2"
  steel-dark: "#8b9188"
  hazard: "#f2c400"
  tractor-red: "#d6402a"
  buff: "#e8dcc0"
  raddle-1: "#e8501e"
  raddle-2: "#d9257a"
  raddle-3: "#1e63c8"
  raddle-4: "#f2a100"
  raddle-5: "#7a2fbf"
  raddle-6: "#0e9c8a"
  raddle-7: "#b5123f"
  raddle-8: "#4a6fd4"
  fleece-blossom: "#f2a79b"
  fleece-raddle-red: "#d1503c"
  fleece-barn-red: "#8f2f22"
  fleece-apricot: "#f5bd93"
  fleece-marmalade: "#de7c33"
  fleece-rust: "#9a4c15"
  fleece-oat: "#f3d79a"
  fleece-stubble-gold: "#d8a13a"
  fleece-harvest: "#94661a"
  fleece-new-hay: "#d8e39a"
  fleece-meadow: "#a8bc45"
  fleece-olive: "#6b7a22"
  fleece-mint: "#a5dcb4"
  fleece-pasture: "#4ea86c"
  fleece-hedge-green: "#2b6b43"
  fleece-dew: "#9adcd6"
  fleece-teal: "#35a89c"
  fleece-deep-teal: "#1d6a63"
  fleece-sky: "#a8d4ec"
  fleece-kingfisher: "#3f96c9"
  fleece-slate-blue: "#1f5e83"
  fleece-haze: "#b0c2ee"
  fleece-cobalt: "#5470c4"
  fleece-midnight: "#2e4283"
  fleece-lilac: "#c9b6e8"
  fleece-thistle: "#8360c0"
  fleece-damson: "#503a7d"
  fleece-clover: "#eeb0d0"
  fleece-foxglove: "#cc4f92"
  fleece-mulberry: "#862c5c"
typography:
  display:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.4rem, 2.5vw, 2.5rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 3.4vw, 3.4rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  question:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.7rem, 3.9vw, 4.4rem)"
    fontWeight: 800
    lineHeight: 1.03
    letterSpacing: "-0.032em"
  numerals:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(3rem, 7.5vw, 8rem)"
    fontWeight: 900
    lineHeight: 0.86
    letterSpacing: "-0.03em"
    fontVariation: "font-stretch: 125%"
    fontFeature: "tabular-nums lining-nums"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "normal"
  legend:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(0.75rem, 0.72vw, 0.95rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.14em"
    fontVariation: "font-stretch: 112%"
rounded:
  stamp: "2px"
  plate: "3px"
  sign: "4px"
  token: "999px"
spacing:
  s-1: "0.25rem"
  s-2: "0.5rem"
  s-3: "0.75rem"
  s-4: "1rem"
  s-5: "1.5rem"
  s-6: "2rem"
  s-7: "3rem"
  s-8: "4.5rem"
  s-9: "7rem"
components:
  enamel-sign:
    backgroundColor: "{colors.enamel}"
    textColor: "{colors.hedge}"
    rounded: "{rounded.sign}"
  latch:
    backgroundColor: "{colors.hazard}"
    textColor: "{colors.hedge}"
    rounded: "{rounded.sign}"
    padding: "0.75rem 1.5rem"
    typography: "{typography.display}"
  latch-hover:
    backgroundColor: "color-mix(in oklab, #f2c400 84%, #f5efe0)"
  latch-disabled:
    backgroundColor: "{colors.steel-dark}"
    textColor: "color-mix(in oklab, #12180f 70%, #b7bcb2)"
  latch-phone:
    backgroundColor: "{colors.hazard}"
    textColor: "{colors.hedge}"
    rounded: "{rounded.sign}"
    padding: "0.75rem 1rem"
    width: "100%"
    height: "60px"
  slot:
    backgroundColor: "{colors.enamel-shade}"
    textColor: "{colors.hedge}"
    rounded: "{rounded.sign}"
    padding: "0.5rem 0.75rem"
    height: "3.25rem"
  slate:
    backgroundColor: "{colors.enamel}"
    textColor: "{colors.hedge}"
    rounded: "{rounded.sign}"
    padding: "0.75rem 1rem"
    height: "3.5rem"
  slate-readonly:
    backgroundColor: "{colors.enamel-shade}"
    textColor: "{colors.hedge}"
  quiet:
    backgroundColor: "transparent"
    textColor: "{colors.earth-deep}"
    padding: "0.25rem 0"
    height: "2.75rem"
  painted-error:
    backgroundColor: "color-mix(in srgb, #f0d391 55%, #f5efe0)"
    textColor: "{colors.earth-deep}"
    padding: "0.5rem 0.75rem"
  legend-plate:
    backgroundColor: "rgb(18 24 15 / 0.62)"
    textColor: "{colors.enamel}"
    rounded: "{rounded.stamp}"
    padding: "3px 0.75rem"
    typography: "{typography.legend}"
  paddock:
    backgroundColor: "color-mix(in oklab, var(--tint) 32%, #2f6b33)"
    textColor: "{colors.enamel}"
    padding: "0.5rem"
  paddock-scored:
    backgroundColor: "color-mix(in oklab, #e0ae35 78%, var(--tint))"
    textColor: "{colors.hedge}"
  paddock-stake:
    backgroundColor: "{colors.enamel}"
    textColor: "{colors.hedge}"
    rounded: "{rounded.plate}"
    padding: "3px 0.5rem"
  ear-tag:
    backgroundColor: "{colors.enamel}"
    textColor: "{colors.hedge}"
    rounded: "{rounded.sign}"
    padding: "0.25rem 0.75rem 0.25rem 0.25rem"
  record-sheet:
    backgroundColor: "{colors.buff}"
    textColor: "{colors.hedge}"
    rounded: "{rounded.plate}"
    padding: "clamp(1rem, 2vw, 2rem)"
  clock-tv:
    backgroundColor: "{colors.hedge}"
    textColor: "{colors.enamel}"
    rounded: "{rounded.sign}"
    padding: "0.75rem 1rem"
    typography: "{typography.numerals}"
---

# Design System: Flock Together

## Overview

**Creative North Star: "Paddock Rotation"**

The world is a working farm map seen from directly above. Not a party-game card
grid on a purple gradient, not a dashboard: the ground of every screen is a
saturated pasture, and the things on it are the things you would actually find in
a field — hedgerows, gates, enamel signs, galvanised steel, hazard paint, raddle
dye, a rosette. The system was built at full farm colour on purpose. Nothing here
is pastel, nothing is tinted-neutral, and nothing sits on a white page.

The organising conviction is that **structure is drawn, not implied**. Division
between one region and the next is carried by heavy hedgerow ink at one of four
stroke weights, never by a 1px grey rule, never by a card shadow, and never by a
gap in a neutral surface. That single decision is what makes the aerial-map
reading hold: a screen looks like surveyed land because it is genuinely divided
into bounded regions rather than assembled out of floating panels.

Colour does four jobs and they never trade places. Field colour owns whole
regions of ground. Farm hardware — enamel, steel, hazard, tractor red, buff — is
the only vocabulary controls and content wells are allowed to speak. Raddle dye
carries assigned identity, and only identity. Chosen fleece — thirty colours a
player picks for their own sheep — is the fourth, and it appears on nothing but a
fleece. The palette is large but it is not loose: each family has a job, and the
discipline is in never borrowing across them.

**Key Characteristics:**

- Saturated field colour as ground, at full strength, never as an accent
- All structure in hedgerow ink at four weights (2px / 3px / 5px / 8px)
- No cards; the white enamel sign is the only content well
- Two self-hosted variable faces — Bricolage Grotesque speaks, Archivo labels
- Monumental wide figures for every number that matters
- Identity by raddle dye, always redundantly coded
- Thirty chosen fleece colours and twenty hats, worn by sheep and nothing else
- One authored motion moment per phase, and nothing travels under reduced motion

## Colors

Four separate colour systems that share a stylesheet and never share a job.

### Primary

**Field colour** — the ground itself. These are used as *whole regions*, never as
accents scattered on a neutral surface.

- **Deep Pasture** (`pasture-deep`): the page ground on both surfaces, and the
  unallocated ground behind the paddock map. This is the default body background.
- **Pasture** (`pasture`): the display's main field, laid under two overlaid
  gradients (a 104° repeating stripe at 2.8% white for mown lines, and a radial
  lift from the top-left corner in `pasture-lit`).
- **Lit Pasture** (`pasture-lit`): the sunlit corner of the map, and the default
  `--tint` fallback for an untinted paddock cell.
- **Growth** / **Pale Growth** (`growth`, `growth-pale`): the lit patch of grass
  the phone's collie works on, the tally icon, and the calm-state label inside the
  display's countdown box.
- **Stubble** / **Pale Stubble** (`stubble`, `stubble-pale`): cut-field gold. It
  marks the winning paddock's ground, the leading row on the record sheet, the
  final score figure on the phone, and warning-toned text on dark ground.
- **Earth** / **Deep Earth** (`earth`, `earth-deep`): ploughed ground. Deep earth
  is the workhorse — the holding pen for players who missed the gate, the
  connection notice, secondary text on light signs, and the phone's quiet action.

### Secondary

**Farm hardware** — the entire vocabulary available to controls and content wells.
Nothing outside this list may be a button or a panel.

- **Enamel** (`enamel`): white enamel farm sign. The only content-well ground on
  either surface, and the sheep's fleece. Also the default body text colour.
- **Enamel Shade** (`enamel-shade`): the same sign, weathered. Reserved for input
  grounds and read-only states, so a field reads as recessed against a fresh sign.
- **Steel** / **Dark Steel** (`steel`, `steel-dark`): galvanised gate metal. The
  gate leaf's stroke, the latch's throw-bolt, the hinge post, and disabled
  controls. Steel is what a control looks like when it cannot be used.
- **Hazard** (`hazard`): gate paint. The header bar across the display, the phone's
  connection strip, every primary action, and the default focus ring.
- **Buff** (`buff`): ledger paper, ruled with `earth` at 18% opacity on a 2.1em
  rhythm. It exists for exactly one component — the grazing record sheet.
- **Tractor Red** (`tractor-red`): the prize. See the reserve rule below.

### Tertiary

**Raddle dye** — eight values (`raddle-1` … `raddle-8`) marking flock membership,
because marking which flock an animal belongs to is literally what raddle is for.
The eight are spread across the hue circle (orange, magenta, blue, amber, violet,
teal, crimson, periwinkle) so that any two are separable, and they are assigned
two different ways depending on what is being marked:

- **Players** get a dye derived from `playerId` alone by a 32-bit FNV-1a hash with
  an avalanche step before the modulus. Nothing about join order, server state, or
  randomness enters it, so a player's mark is byte-identical on the phone and the
  big screen and survives a reconnect.
- **Answer groups** get a dye by rank, walking a fixed spread order
  (`1, 3, 4, 6, 2, 8, 5, 7`) rather than hashing, because groups render as
  adjacent bands and a hash would sometimes hand two neighbouring paddocks the
  same colour.

Since players choose a fleece, the hashed player dye is no longer what says
*which player this is* — the fleece and the hat say that. The dye kept its other
job: it is the mark that sprays on when a player answers, so it now reads as
*this one has answered* more than as *this one is you*. Anyone with no look at all
— a simulated player, anyone who never chose — keeps the hashed dye and the enamel
fleece, and so renders exactly as they always did.

### Chosen fleece

**The thirty colours a player may pick for their own sheep.** Ten hue families,
three shades each, ordered light → deep, laid out in the picker as families so
the three shades of one hue read as a set rather than as three unrelated
swatches. Every value is declared once in `public/shared/look.js` — imported by
both the server and both surfaces — and mirrored into `public/shared/tokens.css`
as `--fleece-<id>`, one custom property per colour. The hexes below are that
list. **This section is the design system's record of them**; a fleece hex that
is not written here is palette drift by definition, because the design hook has
no other place to look.

- **Red** — Blossom `#f2a79b`, Raddle red `#d1503c`, Barn red `#8f2f22`
- **Orange** — Apricot `#f5bd93`, Marmalade `#de7c33`, Rust `#9a4c15`
- **Gold** — Oat `#f3d79a`, Stubble gold `#d8a13a`, Harvest `#94661a`
- **Lime** — New hay `#d8e39a`, Meadow `#a8bc45`, Olive `#6b7a22`
- **Green** — Mint `#a5dcb4`, Pasture `#4ea86c`, Hedge green `#2b6b43`
- **Teal** — Dew `#9adcd6`, Teal `#35a89c`, Deep teal `#1d6a63`
- **Sky** — Sky `#a8d4ec`, Kingfisher `#3f96c9`, Slate blue `#1f5e83`
- **Blue** — Haze `#b0c2ee`, Cobalt `#5470c4`, Midnight `#2e4283`
- **Violet** — Lilac `#c9b6e8`, Thistle `#8360c0`, Damson `#503a7d`
- **Pink** — Clover `#eeb0d0`, Foxglove `#cc4f92`, Mulberry `#862c5c`

The band edges are the constraint that shaped the set. The pale band is never so
pale it reads as the default enamel fleece, and the deep band never so dark it
reads as the hedgerow ink outlining it — both ends are a real fill behind that
outline, at sheep size, on a screenshared television.

Nothing reaches for a `--fleece-*` token except a fleece, and the one exception is
the picker's swatch, where the colour stands for itself. Not a paddock tint, not a
chip border, not a hat — a hat is a prop and carries its own object colours. The
sprite reads the chosen value through a single property, `--fleece`, set on
whatever wraps the sheep and defaulting to `var(--enamel)` — so a sheep nobody has
chosen for renders exactly as it did before the feature existed.

### Neutral

- **Hedge** (`hedge`): near-black with a warm cast. Every border, every divider,
  every sprite stroke, and the text colour on all light grounds. This is the ink
  of the whole system.
- **Hedge Soft** (`hedge-soft`): the one step lighter — dashed rules on signs,
  a disabled control's offset shadow, secondary text on the winning gold ground.

### Named Rules

**The Reserved Rosette Rule.** Tractor red belongs to winning and to nothing else.
It is the rosette sprite's fill, the winning paddock's frame, and the leading
record row's inset stroke. It is deliberately *not* used for the current-round
pip (which is marked by an enamel fill plus a ring), and *not* used for form
errors (which are painted in earth on pale stubble). If a new element wants red,
the answer is earth or hazard.

**The Four Palettes Rule.** Field colour paints regions, hardware paints controls
and wells, raddle paints assigned identity, fleece paints a chosen sheep. A
control never takes a field colour; a field never takes hazard; raddle never
appears on anything that is not an identity mark; a `--fleece-*` never appears on
anything that is not a fleece.

**The Never-Hue-Alone Rule.** Group and player identity never rests on colour. A
group carries its dye *and* its position on the map, *and* its label on a stake,
*and* its headcount, *and* — for the winner — a rosette, gold stubble ground, a
red frame, the largest area, and a visually-hidden "Scored a point" sentence. A
player carries their fleece *and* their hat *and* their name plate. Thirty
colours is well past the number anyone can tell apart, which is exactly why the
hat exists: it is a second, shape-carried mark on the same animal, and in the
picker both are named in text beside the swatch.

**The Ink-Separation Rule.** The sheep's hedgerow-ink outline is the only thing
holding its fleece apart from the ground it stands on, and a deep-band fleece is
nearly as dark as that ink. Any fleece measuring under 3.5:1 against `--hedge`
gets a pale rim *outside* the ink — two stacked 1.5px enamel drop-shadows, so the
silhouette is carried by a light line no pasture or paddock tint can match; the
rest are left exactly as authored. The
threshold is applied by measurement at runtime (`fleeceNeedsRim()` in `tv.js`
reads the hexes from `look.js` and the ink from the token it is actually drawn
with) rather than from a hand-kept list of deep colours, so it stays true if
either side moves. The floor is the 3:1 any non-text graphic has to clear; the
margin above it is there because that outline is about one sprite unit wide by
the time a paddock sheep renders inside a video-call tile.

**The Plated Legend Rule.** Small text never sits directly on grass. Pale growth
on pasture computes 2.46:1 at the lit end of the ground gradient, so every legend
that carries real content (tallies, provenance, counts, notes) is painted on an
ink plate at `rgb(18 24 15 / 0.62)` first.

## Typography

**Display Font:** Bricolage Grotesque (variable, weight axis 400–800), self-hosted
**Body / UI Font:** Archivo (variable, weight axis 400–900 *and* width axis
62%–125%), self-hosted

Both faces are shipped as local `woff2-variations` with a Latin subset and
preloaded, because the game is designed to run on a LAN with no internet. The
width axis on Archivo is not decoration — it is the mechanism behind two of the
three type idioms below.

**Character:** Bricolage is the voice with an opinion: tight negative tracking,
always at 800, always the thing being said. Archivo is the sober hand that labels
and counts, and it does both jobs by moving along its width axis rather than by
changing family.

### Hierarchy

- **Wordmark** (Bricolage 800, `clamp(1.4rem, 2.5vw, 2.5rem)`, lh 1, ls -0.035em,
  uppercase): the product name in the hazard header bar.
- **Question** (Bricolage 800, `clamp(1.7rem, 3.9vw, 4.4rem)`, lh 1.03, ls
  -0.032em, `text-wrap: balance`): the one thing the whole room must read. On the
  display it is set on an enamel sign rotated -0.5deg, as if staked in the ground.
- **Headline** (Bricolage 800, `clamp(1.6rem, 3.4vw, 3.4rem)`, lh 1.02, ls -0.03em,
  balanced): scene titles on the display.
- **Hero** (Bricolage 800, `clamp(1.6rem, 8.5vw, 2.4rem)`, lh 1.02, ls -0.02em):
  the phone's equivalent. The 8.5vw middle term is a phone measure, not a display
  one — the same role, sized for one hand.
- **Numerals** (`.numerals`: Archivo 900 at 125% width, tabular lining figures,
  lh 0.86, ls -0.03em): the countdown, every headcount, every score, the room
  code. Monumental figures are their own voice; they are the one thing that must
  read across a room *and* survive being downscaled inside a video-call window.
- **Body / aside** (Archivo 600, 0.95rem, lh 1.35, `text-wrap: pretty`):
  explanatory copy on the phone.
- **Legend** (`.legend`: Archivo 700 at 112% width, `clamp(0.75rem, 0.72vw,
  0.95rem)`, ls 0.14em, uppercase): silkscreened panel labels, as painted on farm
  signage and stencilled on bales. The 0.75rem floor is deliberate — below about
  12px, uppercase at 0.14em tracking stops being readable one-handed mid-party.

#### Phone controls

Three fixed steps that are not on the fluid ramp and should not be. Each is
fixed because something other than the composition decides its size, and each
was being read as drift for want of being written down.

- **Field** (`.slot`: Archivo 700, **1.25rem**): every text input on the phone.
  Fixed, and never below 1rem, because iOS zooms the viewport when a focused
  input is under 16px — which on a `position: fixed` pen means the player is
  suddenly panning around a game that no longer fits. This is a platform floor,
  not a typographic choice, so the fluid ramp must not be allowed near it.
- **Code field** (`.slot--code`: Numerals at **1.9rem**, ls 0.22em): the room
  code, and only the room code. Four characters copied off a television across a
  room, so it is sized to be legible while typing rather than to sit on the
  ramp; the length is fixed at four, so it cannot overflow the narrowest phone.
- **Latch** (`.latch`: Bricolage 800, **1.3rem**, min-height 60px): the one
  primary action on any phase — send, join, confirm. Sized with the 60px target
  rather than against other type, because it is a thumb destination first and a
  label second.

### Named Rules

**The Downscaled-Display Rule.** Every display-side size is anchored to a `vw`
middle term rather than a fixed rem, because the shared screen is routinely a
browser window inside a video call, not a full-bleed television. When the window
shrinks, the type shrinks with it and the composition survives; a fixed ramp would
either blow out on a 4K panel or overflow in a shared tile. The one place this is
overridden explicitly is `.legend`, whose shared clamp caps at 0.95rem — right for
a phone, far too small on a television — so `tv.css` re-clamps it to
`clamp(0.8rem, 0.95vw, 1.45rem)`.

**The Two Voices Rule.** Bricolage says things. Archivo labels and counts. A
number never gets the display face; a question never gets the UI face.

**The Length-Tiered Question Rule.** The phone never truncates a question. It
tiers the size by character count instead — `short` (≤34 chars) at
`clamp(1.9rem, 9.5vw, 2.7rem)`, `mid` (≤72) at `clamp(1.5rem, 7.2vw, 2.1rem)`,
`long` at `clamp(1.2rem, 5.6vw, 1.7rem)` — and if it still will not fit, the sign
scrolls internally rather than cutting the text.

## Layout

Both surfaces are **fixed frames that never scroll the page**. The display is a
two-row grid (hazard header, then the field filling the rest) at `100dvh` with
`overflow: hidden`. The phone is a `position: fixed` pen inset to zero, padded by
`env(safe-area-inset-*)` on all four sides, also `overflow: hidden` with
`overscroll-behavior: none`.

**Spacing** runs on a nine-step scale from 0.25rem to 7rem, deliberately
non-linear at the top end (0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4.5 / 7rem). The
rhythm is *tight inside a group, generous between groups*: steps 1–3 hold the
inside of a component, 4–5 separate components, and 7–9 appear only as the
display's scene padding and the lobby's column gap.

**Scenes occupy one grid cell.** On the display every scene is placed in
`grid-area: 1 / 1` and toggled with `[hidden]`, so the frame never resizes as the
game advances. On the phone every screen shares one `grid-template-areas: 'stack'`
cell and is toggled with `visibility` (keeping its space) rather than `display`.

**The phone measures its own viewport.** `play.js` writes `--vh` from
`visualViewport.height`, and every height-sensitive rule keys off that rather off
`vh` or a `max-height` media query. The reason is load-bearing: an open keyboard
does not resize the layout viewport, so a media query cannot see the frame the
player is actually looking at. A `container-type: size` container named `pen` is
what those rules query instead, at 780px and 620px tiers.

**Responsive behaviour** is composition change, not shrinkage. Below 900px or in
portrait, the display stacks the lobby into a column and turns the question row
into a column with the countdown laid out horizontally, rather than letting the
question drop below readability. On a short phone frame the flock sprite is the
first thing dropped, then the countdown's label goes to screen readers only; the
question and the working end (slate plus lever) are never sacrificed.

### Named Rules

**The Reserved Strip Rule.** Anything that can appear must already have its space.
The phone reserves `--strip` (1.5rem) at the top of the pen for the connection
notice, reserves 1.15rem for the lock-note line, and gives the send lever and the
locked-in confirmation one shared 60px cell — so a socket drop, a status message,
or a submitted answer never shifts the layout under a thumb.

## Elevation & Depth

The system uses **paired depth**: a real hard offset in hedgerow ink for the
object's own thickness, plus a soft blur tinted from the ground rather than grey,
because everything sits on saturated green and a grey shadow would read as dirt.
It is not a floating-card elevation model — nothing hovers. An enamel sign has
6px of visible edge because a real enamel sign is a plate with an edge.

### Shadow Vocabulary

- **Sign lift** (`0 6px 0 var(--hedge), 0 14px 28px -8px rgb(10 24 8 / 0.55)`):
  the enamel sign, the record sheet, and the phone's primary lever. Plate
  thickness plus a cast shadow on the ground.
- **Token lift** (`0 3px 0 rgb(18 24 15 / 0.85), 0 8px 14px -6px rgb(10 24 8 / 0.5)`):
  the smaller version, for the ear tag and the locked-in confirmation.
- **Panel lift** (`0 10px 30px -10px rgb(10 24 8 / 0.6)`): blur only, no offset.
  For dark objects sitting *on* the map — the countdown box, the paddock plot, the
  connection notice — which read as pressed onto the ground, not lifted off it.
- **Press-in** (`inset 0 3px 8px -2px rgb(10 24 8 / 0.45)`): the only inset. Every
  text input on the phone carries it, so a slot reads as a recess cut into a sign.

Press states are travel, not shadow change alone: the display's latch translates
6px down and collapses its offset to 1px; the phone's lever translates 6px and
collapses to a flat ring. A disabled lever is *drawn already pressed* — steel, no
offset, translated down — so it looks mechanically stuck rather than greyed out.

### Named Rules

**The Ground-Tinted Shadow Rule.** Shadows are `rgb(10 24 8 / …)` — a dark green —
never neutral black or grey. On saturated pasture a grey shadow reads as a smudge.

## Shapes

The form language is **rectangles with heavy ink edges and almost no radius**. The
world is surveyed land and stamped metal; curves belong to the sprites, not the
layout.

**Line weight** is one scale, and it carries all division:

- `--line-hair` (2px): pip borders, dashed rules, the gate hinge post, small stakes
- `--line` (3px): the focus ring, the record sheet's head rule, the holding pen
- `--line-bold` (5px): enamel signs, inputs, levers — the standard hardware edge
- `--line-hedge` (8px): the header's bottom edge and the paddock plot's boundary.
  This is the true hedgerow weight and it appears only where land meets land.

**Radius** is effectively four steps and the build uses the small two most:
2px (`stamp` — name plates, pips, small legend plates), 3px (`plate` — the paddock
plot, the record sheet, the connection notice, boxed figures), 4px
(`--radius-sign`, the canonical value for signs, inputs and levers), and 999px
(`--radius-token`, a pill). Note that the 2px and 3px values are written as raw
literals throughout rather than as tokens, and `--radius-token` is used exactly
once (the dye-splat bloom behind the fleece).

**Signage leans.** Three surfaces are rotated by a fraction of a degree — the join
sign at -1.1deg, the question at -0.5deg, the record sheet at -0.4deg — as objects
staked into ground or laid on a table. Nothing else in the system is rotated.

**Sprites** are one authored set in `shared/sprites.svg`: sheep, five-bar gate,
rosette, sheepdog, stake, ear tag, five-bar tally, and twenty hats. One stroke
language throughout — hedgerow ink at 5 units, round caps and joins, no gradients,
no filters. State is driven from outside, but only through what crosses a `<use>`:
these symbols always render in a shadow tree, so a document rule like
`.sheep__svg .fleece { fill: … }` never matches them. Inherited values and custom
properties do get through, so a symbol that carries state reads a property and the
class is a label only — `.fleece` (wool, filled `var(--fleece, var(--enamel))`),
`.raddle` (the dye blotch, `fill: currentColor` so `color` alone drives it), and
`.ink` (structure). The sheep carries a face — two eyes and a nose, same 5-unit
ink, no new vocabulary. The `sp-stake` symbol is authored but not currently
referenced by either surface.

**The hat set** is twenty symbols, `sp-hat-<id>` for every id in `shared/look.js`:
flat cap, bobble, sou'wester, boater, bucket, beanie, beret, headscarf, visor,
baseball cap, earmuffs, daisy chain, bowler, deerstalker, cowboy, hard hat, top
hat, crown, party hat, antlers. Each is authored in a **60×60 viewBox whose bottom
centre (30,60) is the sheep's crown**. That single convention is what makes hats
interchangeable by id: the sheep is 132×104 with its crown near (108,30), so every
hat is placed identically at `x=78 y=-30 width=60 height=60` — the values carried
by `HAT_BOX` in `look.js` and read from there rather than written into markup.
There is no per-hat positioning anywhere in the build, and there must not be.

A hat is a **prop, not identity**, so it carries its own object colours and inherits
nothing from the animal underneath: without that it would take the fleece fill and
the dye colour and vanish into the sheep. Straw (`--stubble`) stands in for any part
of a hat that asks for the inherited paint.

The box sits *above* the sheep's own 132×104 space, so a hatted sheep needs its
viewBox opened upward by `HAT_BOX.y` rather than being allowed to overflow — the
lobby flock and every paddock clip. A whole list shares one box whether each sheep
is hatted or not, because sheep sitting at different heights reads as a fault too;
a list with no hats in it keeps the original box, so a flock of unchosen sheep is
pixel-for-pixel what it was. The eight hats flagged `tall: true` in `look.js`
(bowler, deerstalker, cowboy, hard hat, top hat, crown, party hat, antlers) run
high above the anchor and are the first thing a tight cell costs.

### Named Rules

**The Crown-Anchor Rule.** Every hat is authored in the same 60×60 box with its
bottom centre on the crown, and placed from `HAT_BOX`. A hat that needs its own
offset to sit right is drawn wrong, not placed wrong — fix the artwork inside the
box. The moment one hat gets a bespoke `x`/`y`, twenty hats become twenty
positioning cases across three render sites.

**The Hedgerow Rule.** All division is ink. There is no 1px grey rule, no
`border-color: rgba(…)` hairline, and no reliance on a background-colour step to
separate two regions. If two things must be distinguished, a hedge goes between
them at one of the four weights.

## Components

### The Enamel Sign — the only content well

**There are no cards in this system.** `.enamel-sign` is the sole content
container: enamel ground, `--line-bold` (5px) hedge border, 4px radius, sign lift.
It is the *only* sanctioned way to put content on a light ground, and it is used
for the join sign, the question, the phone's join form, notes, the "you said"
confirmation, and the group card. This is the rule most likely to be broken by
someone extending the system later. A rounded panel with a soft shadow and a
tinted background is not a component in this world — it is a card, and it does not
exist here.

The one deliberate exception is the **record sheet**, which is buff ledger paper
rather than enamel: 5px hedge border, ruled with earth at 18% on a 2.1em rhythm,
rotated -0.4deg. It is a different material for a different job (a written
record), not a second card style.

### Buttons — the latch

- **Shape:** rectangular, 4px radius, 5px hedge border, hazard ground, display face
  at 800.
- **Display latch:** inline-flex, includes a literal steel throw-bolt
  (`.latch__bar`, 30×11px steel with a hair border) that slides 5px right on hover.
  Hard offset of 7px plus panel lift; presses 6px down to a 1px offset.
- **Phone lever:** full width, 60px minimum, sign lift, `touch-action: manipulation`.
  Presses 6px down to a flat ring.
- **Hover:** the display latch lightens toward enamel (`color-mix(in oklab,
  hazard 84%, enamel)`). The phone has no hover state, correctly.
- **Disabled:** steel ground, text mixed toward hedge, drawn already pressed.
- **Quiet (secondary):** no hardware at all. Deep earth text with a 2px chalk
  underline at 3px offset, 2.75rem minimum target. On dark ground it flips to pale
  stubble (`.quiet--onfield`).

### Inputs — slot and slate

- **Slot** (join form): enamel-shade ground, 5px hedge border, 4px radius,
  press-in inset, 3.25rem minimum height. The room-code variant sets Archivo at
  900/125% with 0.22em tracking, centred and uppercased.
- **Slate** (the answer field): the same construction on fresh enamel rather than
  weathered, 3.5rem minimum. Its placeholder is *content* — `play.js` writes state
  into it ("Type again to replace it", "Your answer went in") — so the placeholder
  colour is held at `color-mix(in srgb, hedge 68%, enamel)` to clear 4.5:1 on both
  the enamel and the read-only enamel-shade ground.
- Both are set at ≥1.25rem specifically so iOS never zooms the viewport on focus.
- **Read-only:** the slate drops to enamel-shade, so a locked answer reads as
  weathered rather than disabled.
- **Error:** the painted error is earth text on pale-stubble-tinted enamel with a
  hazard hair border. It is not red — red is the rosette's.

### The Paddock Map — the signature component

The reveal is the centrepiece of the system, and it is a **squarified treemap**
computed by `subdivide()` in `tv.js`, not a chart component.

**The mechanism.** `subdivide(weights, x, y, w, h)` takes each group's headcount
as its weight and returns rectangles in a 0..100 coordinate space. It walks the
remaining items, greedily accumulating a row while the row's worst aspect ratio
keeps improving (`worst()` returns the larger of the row's tallest-to-widest
ratios), lays that row along the shorter side of the remaining rectangle, then
subtracts the row's thickness and repeats on what is left. Cells are emitted as
percentage `inset`/`inline-size`/`block-size` on absolutely positioned children,
so **they tile the plot exactly** — no gaps, no gutters. Any cell the loop cannot
place because the geometry degenerated still gets a sliver of land rather than
vanishing, because an unrendered answer is lost content.

**Why area.** A group's *area* is its headcount. The winning group is therefore
the biggest piece of ground rather than the longest bar, hedgerows turn corners,
and the screen reads as a real subdivision of land. This is the thesis of the
whole world made mechanical: a majority is not a bar chart, it is the paddock the
flock actually crowded into.

**Half a hedge each.** Every cell carries `border: calc(var(--line-hedge) / 2)`
(4px) of hedge on all sides. Because cells tile exactly, two neighbours each
contribute half, and a shared edge reads as one continuous 8px hedge — the same
weight as the plot's outer boundary. Do not change a cell's border to the full
hedge weight; shared edges would double.

**Per-field texture.** Each cell gets crop rows at its own angle
(`14 + ((i * 37) % 5) * 26` degrees), deterministic on rank so a re-render never
reshuffles the map under the room. Ground is `color-mix(in oklab, var(--tint) 32%,
pasture)` — the group's raddle dye pulled down into the pasture rather than
painted on top of it.

**Content sheds by container query.** Each cell is a `container-type: size`, and
content is dropped by expendability as the cell gets small. The group's label and
its answers are the content; the sprite, the player's name and the headcount are
trimmings. Measured on the rendered cell, never guessed from its weight:

- **≤150px tall:** the sheep sprite goes; answers align to the start instead of
  centring.
- **≤110px tall:** the player's name goes; the label, headcount, stake padding and
  answer text all step down a size.
- **≤74px tall:** the headcount goes, and cell padding drops to 3px. The field's
  own area already states the count, so the number is the redundant one.

**The winner** is marked five ways at once: a rosette pinned to the stake, gold
stubble ground, a tractor-red frame with an inset hedge stroke, the largest area,
and the headcount — plus a visually-hidden "Scored a point" sentence.

### Sheep tokens

A sheep is a sprite plus a name plate. The fleece is the colour that player chose,
carried in as `--fleece` and falling back to enamel for anyone who has not chosen;
the hat rides on top of it wherever the sheep is drawn — the lobby flock, the
waiting flock during a question, and the sheep inside a paddock at the reveal. The
raddle blotch is `opacity: 0` and `scale: 0.4` until the player answers, at which
point it sprays in. The name sits on its own ink plate at 55% so it stays legible
on any field. A disconnected player's sheep drops to 40% opacity *and* strikes
through the name — never opacity alone.

Two things ride on the fleece being chosen rather than fixed. A deep fleece gets
the pale rim (see the Ink-Separation Rule) — marked per sheep as `data-deep`, so
the rest of the flock is untouched. And the hat obeys the existing shedding rule
rather than inventing one: when the reveal drops a paddock's sprite at
`data-roomy="false"`, the hat goes with it, because it is part of the sprite and
not a separate layer of information. The paddock tint behind the sheep stays
whatever the group's rank dye says; a paddock is never tinted by a player.

### Navigation — the rotation strip

There is no navigation in the conventional sense. Round progress is a row of
square pips in the hazard header: `--line-hair` hedge border, 2px radius,
transparent for future rounds, filled hedge for completed ones, and enamel with a
soft ring for the current one. The current round is deliberately *not* marked in
tractor red.

## Do's and Don'ts

### Do:

- **Do** put every new value in `public/shared/tokens.css` first, and derive
  anything not defined there with `color-mix()` or `calc()` from something that is.
  Both surfaces already hold this line.
- **Do** draw division with hedgerow ink at one of the four weights (2/3/5/8px).
- **Do** add a colour or a hat in `public/shared/look.js` first — it is the single
  source of truth both the server and the surfaces import — then its
  `--fleece-<id>` in `tokens.css`, then its hex in the Chosen fleece list above.
  All three, or the design hook reads the new value as palette drift.
- **Do** author a new hat inside the 60×60 crown-anchored box, and place it by
  reading `HAT_BOX` rather than writing `78 / -30 / 60` anywhere.
- **Do** use `.enamel-sign` when content needs a light ground. It is the only well.
- **Do** carry identity redundantly — position, label, headcount, and shape before
  colour. Assume the viewer cannot distinguish two dyes.
- **Do** plate small text on `rgb(18 24 15 / 0.62)` before putting it on grass.
- **Do** anchor display-side type to a `vw` middle term; the shared screen is often
  a downscaled tile inside a video call.
- **Do** honour reduced motion in JS as well as CSS. `tv.js` gates the
  `--gate-open` write on `matchMedia('(prefers-reduced-motion: reduce)')` and draws
  the gate shut, because killing only the CSS transition would leave the gate
  stepping ~76deg/N across the screen once a second — that is still motion, just
  uninterpolated.
- **Do** give each phase exactly one authored moment: the raddle sprays, the gate
  swings, the dog casts, the paddocks settle, the rosette pins. Easing is
  `--ease-out-expo` `cubic-bezier(0.16, 1, 0.3, 1)` for arrivals and
  `--ease-gate` `cubic-bezier(0.22, 1, 0.36, 1)` for the rosette's quintic
  deceleration; durations are `--t-fast` 160ms, `--t-base` 320ms, `--t-slow` 620ms.
- **Do** reserve space for anything that can appear, so nothing shifts when it does.

### Don't:

- **Don't** add a card. No rounded tinted panel with a soft shadow. If it holds
  content on a light ground it is an enamel sign, or it does not exist.
- **Don't** use tractor red for anything but winning. Errors take earth on pale
  stubble; warnings take hazard; the current round takes an enamel fill and a ring.
- **Don't** cross the four palettes. A control never takes a field colour, a field
  never takes hazard, raddle dye never appears on anything that is not an identity
  mark, and a `--fleece-*` token never paints anything but a fleece — least of all
  a hat, which is a prop with its own colours.
- **Don't** define a colour, a hat, an id or a validation rule anywhere but
  `shared/look.js`. If the server and the surfaces disagree about what is
  selectable, a player is told their own choice does not exist.
- **Don't** distinguish anything by hue alone, and don't convey a state with
  opacity alone (the disconnected sheep strikes through its name as well).
- **Don't** give a paddock cell the full `--line-hedge` border. Each cell carries
  half; shared edges would double.
- **Don't** put a grey or black shadow on the map. Shadows are ground-tinted green.
- **Don't** use a `max-height` media query for anything the phone's keyboard
  affects. The layout viewport does not resize; query the `pen` size container.
- **Don't** truncate a question. Tier its size, and let the sign scroll.
- **Don't** let the `.legend` size fall below 0.75rem. Uppercase at 0.14em tracking
  stops being readable one-handed below about 12px.
- **Don't** "improve" the raddle hash in `shared/raddle.js`. The display and the
  phone must agree byte for byte; any change there is a change to both surfaces at
  once.

### Known inconsistencies in the built system

Recorded rather than smoothed over, because both surfaces ship this way:

- **The phone breaks the tractor-red reserve.** Under 10 seconds, `play.css` turns
  the countdown figures, the rail border and the slate's ring tractor red. The
  display, at the same threshold, goes hazard. One of the two is wrong against the
  Reserved Rosette Rule; the display is the one that follows it.
- **Six class names mean different things on the two surfaces.** `.field` is the
  display's map area and the phone's form-field group; `.question`, `.clock`,
  `.tally`, `.sheep` and `.latch` are all reused with different construction. They
  never collide because the surfaces never share a document, but a shared component
  extracted from one will not survive being dropped into the other.
- **The focus ring needs a second mechanism on the phone.** The shared ring is
  hazard held 3px clear of the control (hedge is 1.76:1 on deep pasture; hazard is
  1.44:1 on enamel), flipped to hedge inside light-ground containers. But the
  offset means the control's own hedge border cannot rescue it, so every control in
  the join form additionally paints a hedge halo *outside* the ring via box-shadow
  at `calc(var(--line) * 3)` — the ring's width plus its offset plus a stroke —
  so both edges clear 3:1.
- **Three tokens are defined but effectively unused.** `--t-run` (900ms) is never
  referenced; `--radius-token` is used once; `var(--earth)` is never used as a
  variable, though its hex is hardcoded as the record sheet's rule lines.
- **The 2px and 3px radii are not tokenised** despite being the most-used radii in
  the build; only 4px and 999px have names.
- **Three fleece tokens are named after colours they are not.** `--fleece-pasture`
  (`#4ea86c`) is not `--pasture` (`#2f6b33`), `--fleece-stubble-gold` (`#d8a13a`)
  is not `--stubble` (`#e0ae35`), and `--fleece-raddle-red` (`#d1503c`) is not any
  `--raddle-*`. The names are the words a player reads in the picker, which is the
  right thing for them to be; the `--fleece-` prefix is the only thing keeping the
  two apart in the stylesheet, so read the prefix before assuming a match.
- **The deep-fleece rim is a CSS filter on a sprite**, in a system whose sprite
  rule reads "no gradients, no filters". The authored SVG still holds that line —
  the filter is applied from `tv.css` to the wrapper — but it is the first thing to
  cite if someone argues the rule has already been broken. The alternative was a
  second authored outline path on every fleece, which would have put the rule in
  the sprite instead.
- **The fleece palette and the hat set have never been seen on a screen.** Every
  claim here about them — that the pale band does not read as enamel, that the
  deep band is the one needing a rim, that a 60-unit hat survives a paddock — is
  computed from the hexes and the geometry. The ink-separation threshold is at
  least measured at runtime rather than asserted; the rest is not.
