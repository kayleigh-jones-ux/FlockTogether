# Art assets

Generated with the Krea API by `tools/make-assets.mjs`, style-referenced from
`style-reference/sheep-clipart.png`.

```sh
npm run assets -- --dry-run              # what it would cost, no API calls
npm run assets -- --yes                  # generate everything missing
npm run assets -- --group hats-silly --yes
npm run assets -- --only hat-fish --force   # redo one
npm run assets:grid                      # PNG contact grids, per group
open generated/index.html                # browser contact sheet
```

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
- **"Black" needs asserting.** The reference's darkest tone is the sheep's warm
  grey face, so the border collie came back grey until black was stated outright
  and grey explicitly refused.
- **Numerals survive better described as shapes.** "The single large digit 1"
  renders reliably; quoted text does not. Still checked by eye every run.
