# Art assets

Generated with the Krea API by `tools/make-assets.mjs`, style-referenced from
`style-reference/sheep-clipart.png`.

```sh
npm run assets -- --dry-run              # what it would cost, no API calls
npm run assets -- --yes                  # generate everything missing
npm run assets -- --group hats-silly --yes
npm run assets -- --only hat-fish --force   # redo one
npm run assets -- --reprocess            # redo the cutout from raw/, free
npm run assets:grid                      # PNG contact grids, per group
open generated/index.html                # browser contact sheet
```

`--reprocess` re-derives every sprite from the kept raw images without calling
the API, so cutout settings can be tuned for nothing. Use it after changing the
output size, the paper tolerance, or a deepen band; use `--force` only when you
actually want new art.

The API key is read from `KREA_API_KEY` in the environment or from
`.env.local.txt` in the project root. That file is gitignored and must stay that
way.

## What is where

| Path | Tracked | What |
| --- | --- | --- |
| `style-reference/sheep-clipart.png` | yes | The drawing every prompt is styled against. Changing it re-uploads and changes everything. |
| `generated/*.png` | yes | The sprites. Transparent, trimmed, square. |
| `generated/index.html` | yes | Contact sheet — every sprite on pasture green and on enamel. |
| `generated/raw/` | no | Pre-cutout images straight from the API. Kept to diagnose a bad cutout. |
| `generated/.state.json` | no | Run cache: prompt hash, seed, source URL per sprite. Delete to force a full regenerate. |

Costs $0.065 per image. A full run of all 56 is about $3.60. Nothing is
submitted without `--yes`, and finished sprites are skipped on a re-run unless
their prompt changed or `--force` is passed — so re-running after a failure is
free for everything that already worked.

## These are not drop-in replacements for the live sprites

The game does **not** use these. It uses the inline SVG symbols in
`public/shared/sprites.svg`, and there are two hard reasons a PNG cannot take
their place:

1. **Fleece colour is a player's identity.** A sheep is recoloured at runtime
   through `--fleece-*` custom properties — 30 colours against one drawing. A
   raster sheep is one colour forever.
2. **Hats swap on a shared anchor.** Every `sp-hat-*` symbol is authored in one
   60×60 box whose bottom centre sits on the sheep's crown (`HAT_BOX` in
   `public/shared/look.js`), which is what lets a hat be swapped by id alone.
   Generated hats are each trimmed to their own bounding box, so they share no
   anchor.

So this set is art direction — reference to redraw an SVG symbol from, and a way
to see a new hat before committing to drawing it.

## Adding a hat to the game

A hat lives in three places and `npm run hats` fails if they disagree:

1. `tools/asset-manifest.mjs` — a description, so its art can be regenerated.
2. `public/shared/sprites.svg` — a `<symbol id="sp-hat-ID" viewBox="0 0 60 60">`
   on the shared crown anchor.
3. `public/shared/look.js` — an id in `HATS`, which is what makes it selectable.

Order matters. A hat in `look.js` with no symbol is the dangerous case: `<use>`
against a missing symbol is not an SVG error, it just draws nothing — so the
picker offers the hat, the server accepts it, and one player in twenty wears
something invisible.

`hats-silly` sprites (fish, flowerpot, sunglasses, reading glasses, and the rest)
are generated but deliberately at step 1 only. Each carries a `sitsOn` note in
the manifest — `crown` or `eyes` — because the glasses want a different anchor
from a hat, and the current `HAT_BOX` only describes the crown.

## Prompt notes worth keeping

Things that cost a run to learn, all of them recorded in the manifest comments
next to the prompt they apply to:

- **The style reference outvotes the prompt on background.** Asking for a chroma
  magenta background is ignored; it paints the reference's off-white every time.
  So the cutout flood-fills from the frame edge and stops at the ink outline
  instead of keying on colour — which also means it only works because every
  asset is drawn with one closed, thick outline. Fleece survives because the
  outline encloses it.
- **The reference is near-monochrome, so it drains colour.** At strength 0.55,
  gold, silver and bronze all came back the same beige. Coloured props run at
  0.32–0.36 with an explicit "saturated, not washed out" clause.
- **Naming a material summons a texture.** "Tweed herringbone" and "brown
  checked" produced a rendered weave and a checkerboard, breaking the flat-ink
  style. Materials are now named only where they read as a colour.
- **Black cannot be prompted at all — it has to be computed.** The reference has
  no black *fill* anywhere, only black outlines over white and warm grey, so any
  large dark area gets pulled to grey by its tonal statistics. Asserting "deep
  solid black, not grey" changed nothing. Dropping the reference strength from
  0.46 to 0.20 moved the fill from luminance 171 to 67 — charcoal, and going
  lower costs the even outline weight that makes the set cohere. So the bowler,
  the top hat and the three dogs finish with `deepen` (`tools/lib/cutout.mjs`),
  which snaps *neutral* greys in a luminance band down to near-black. Neutral-only
  is what makes it safe: the dark red beret and olive bucket hat sit at the same
  luminance and are left untouched, and the band's floor is above the ink so the
  outline never lifts.
- **A colour push and a black push cannot both apply.** "Vivid saturated poster
  colour" is a description black fails, so asking for a black bowler *and*
  vividness pushed it to light grey. Black-bodied assets take `BLACK_PUSH`
  instead of `COLOUR_PUSH`, never both.
- **Naming a garment can summon the head it is worn on.** "Headscarf" produced a
  blank white oval where the face would be, twice, and the antlers and
  deely-boppers came back as wide ovals rather than headbands. What worked was
  describing the object as cloth or as a strip seen edge-on, and refusing the
  hole in as many words as possible. The headscarf was dropped in the end.
- **"Remove X" leaves X's fittings behind.** Dropping the sou'wester's chin strap
  left the buckle loop stitched under the brim; dropping the headband from the
  antlers and the deely-boppers left a curved connector across their feet. Naming
  the part is not enough — the fix is to describe the halves as fully separate
  objects with a gap between them, and to refuse each fitting by name.
- **Two halves drawn separately drift apart in colour.** The moment the antlers
  stopped sharing a base they came back one grey and one brown, so anything drawn
  as a separated pair has to say the two are the same colour.
- **See-through glass is an alpha edit, not a prompt.** The API returns an opaque
  image, so a lens can only be made transparent afterwards. `translucentInteriors`
  finds a lens geometrically — it is the region you cannot reach from outside
  without crossing ink, the background flood fill run one level further in — and
  fades and tints it. That also means the sunglasses/reading-glasses distinction
  is two numbers in the manifest that `--reprocess` retunes for free, rather than
  a prompt that has to be re-rolled. A lens must not be near-black in the prompt,
  or it is indistinguishable from the ink frame and the region is never found.
- **Numerals survive better described as shapes.** "The single large digit 1"
  renders reliably; quoted text does not. Still checked by eye every run.
