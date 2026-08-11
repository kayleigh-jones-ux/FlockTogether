/* Static checks on the assembled bench. There is no browser here, so these
   verify structure and self-containment — not appearance. */
import { readFileSync } from 'node:fs';
/* The look lists come from the module the whole system imports, never from a
   copy typed in here: a check with its own idea of which hats exist would pass
   a bench that is missing the one hat nobody remembered to draw. */
import { FLEECE_COLOURS, HATS } from '../public/shared/look.js';

const h = readFileSync(new URL('../flock-together-bench.html', import.meta.url), 'utf8');
let bad = 0;
const chk = (name, cond, extra = '') => {
  if (!cond) bad++;
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
};

chk('under the 16MB ceiling', Buffer.byteLength(h) < 16 * 1024 * 1024, (Buffer.byteLength(h) / 1024).toFixed(0) + 'KB');
chk('no external http(s) resource refs', !/(?:src|href)\s*=\s*["']https?:/i.test(h));
/* Two faces in the outer bench; the iframes carry their own copies inside the
   base64 payload, checked after decoding below. @font-face does not cross an
   iframe boundary, so the duplication is required, not waste. */
chk('both fonts inlined in the bench shell', (h.match(/data:font\/woff2;base64,/g) || []).length === 2);
chk('QR inlined as a data URI', h.includes('data:image/svg+xml;base64,'));
chk('no unresolved build placeholders', !h.includes('__TV_DOC__') && !h.includes('__PLAY_DOC__') && !h.includes('/*__TOKENS__*/'));

/* The artifact host wraps this file in its own doctype/head/body. Shipping a
   complete document nested a second one inside the first; the parser drops the
   inner tags and splices the children into the body, so it renders but not by
   contract. Base64 contains no '<', so the frame documents — which ARE whole
   documents, correctly — cannot trip these. */
/* The bench's own inline script is raw text to the HTML parser: the first
   closing script sequence anywhere in it — comment, string, regex, anything —
   ends the element, and every line after it becomes page text. That is exactly
   how the shell shipped cut in half, with the wiring on the wrong side of the
   cut and a Start button that had no listener. Assert the element survives
   whole by checking the engine still contains its own last statement. */
const engineBlocks = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];
chk('exactly one inline engine script', engineBlocks.length === 1, engineBlocks.length + ' found');
const engine = engineBlocks.length ? engineBlocks[0][1] : '';
chk('engine element is not truncated early', engine.includes("log('head', 'Bench ready"),
  engine.length + ' chars');
chk('engine wiring survived the parse',
  engine.includes("addEventListener('message'") && engine.includes("$('c-start')") && /\bboot\(\);/.test(engine));

/* The look protocol is ported into the engine, not stubbed: the bench is the
   only place the customise step can be looked at, so a bench that accepts
   every pair would show a screen the server would have refused. */
chk('engine ports setLook and its taken set',
  /function setLook\(/.test(engine) && /function takenLooks\(/.test(engine) &&
  engine.includes("t: 'look.taken'") && engine.includes("t: 'look.ok'"));
chk('engine gates on locked players, not on the room',
  engine.includes('lockedPlayers()') && engine.includes('LOBBY_MIN_PLAYERS') &&
  engine.includes('choosingCount()'));
chk('engine drops the still-choosing at the gate',
  /function dropUnlocked\(/.test(engine) && engine.includes("code: 'NOT_LOCKED'"));
/* BAD_LOOK is look.js's own wording, so its presence also proves the injected
   module reached the engine's validation rather than being paraphrased. */
chk('engine speaks every look error code',
  ['LOOK_TAKEN', 'BAD_LOOK', 'GAME_STARTED'].every((code) => engine.includes(code)) &&
  engine.includes('validateLook('));
/* Injected from look.js rather than restated. A retyped list is the one thing
   look.js exists to prevent, so prove the real module's own text is in here. */
chk('engine carries look.js itself, not a retyped copy',
  engine.includes("id: 'blossom'") && engine.includes(FLEECE_COLOURS[0].hex) &&
  engine.includes("id: 'antlers'") && !engine.includes('/*__LOOK__*/'));
chk('the rail can force a look collision',
  h.includes('id="c-clash"') && /function stealLook\(/.test(engine));
chk('the rail can send you through the picker',
  h.includes('id="c-customise"') && h.includes('id="c-choosing"'));
try { new Function(engine); chk('engine parses as JavaScript', true); }
catch (e) { chk('engine parses as JavaScript', false, e.message); }

const markup = h.replace(/<!--[\s\S]*?-->/g, '');   // prose about tags is not tags
chk('ships as a body fragment, not a nested document', !/<!doctype/i.test(markup));
for (const tag of ['html', 'head', 'body']) {
  chk('no wrapper <' + tag + '> in the fragment', !new RegExp('</?' + tag + '[\\s>]', 'i').test(markup));
}

/* The docs travel base64, so decode them and check the REAL document the
   iframe will parse — which is what the earlier text-escaping bug slipped past. */
const grab = (id) => {
  const m = new RegExp('<script type="text/plain" id="' + id + '">([\\s\\S]*?)</script>').exec(h);
  if (!m) return '';
  return Buffer.from(m[1].trim(), 'base64').toString('utf8');
};
const tv = grab('doc-tv');
const pl = grab('doc-play');

/* The specific failure that shipped: a script element that never closes. */
for (const [n, d] of [['display', tv], ['phone', pl]]) {
  const opens = (d.match(/<script(?:\s[^>]*)?>/g) || []).length;
  const closes = (d.match(/<\/script>/g) || []).length;
  chk(n + ': every script element closes', opens === closes && opens === 2, opens + ' open / ' + closes + ' close');
  chk(n + ': no stray backslash-escaped tags', !d.includes('<\\/script'));
  chk(n + ': utf-8 survived the round trip', d.includes('—') || d.includes('’'));
}

chk('display doc extracted intact', tv.length > 20000, tv.length + ' chars');
chk('phone doc extracted intact', pl.length > 20000, pl.length + ' chars');

for (const [n, d] of [['display', tv], ['phone', pl]]) {
  chk(n + ': module imports rewritten to the shim', !/^import\s*\{/m.test(d));
  chk(n + ': transport shim present', d.includes('window.__bench'));
  chk(n + ': sprite sheet inlined', d.includes('id="sp-sheep"'));
  chk(n + ': design tokens inlined', d.includes('--pasture-deep'));
  chk(n + ': storage guard present', d.includes('sessionStorage'));
  chk(n + ': both fonts inlined in this frame', d.split('data:font/woff2;base64,').length - 1 === 2);

  /* A hat is referenced by id alone (`#sp-hat-<id>`), so a missing symbol is
     not an error anywhere — it is a sheep that renders bare-headed and a
     player told they are wearing something they cannot see. All twenty or the
     picker is lying. */
  const missingHats = HATS.filter((hat) => !d.includes('id="sp-hat-' + hat.id + '"'));
  chk(n + ': all ' + HATS.length + ' hat symbols inlined', missingHats.length === 0,
    missingHats.map((hat) => hat.id).join(', '));
  chk(n + ': hats are authored to the one 60x60 box',
    (d.match(/viewBox="0 0 60 60"/g) || []).length >= HATS.length);

  /* The fleece is driven by a custom property, and the token it reads is
     derived from the colour id — so a colour whose token never made it into
     the sheet falls back to enamel and the player gets somebody else's sheep,
     silently. Every one of the thirty, with its hex. */
  const missingTokens = FLEECE_COLOURS.filter(
    (c) => !new RegExp('--fleece-' + c.id + ':\\s*' + c.hex, 'i').test(d),
  );
  chk(n + ': all ' + FLEECE_COLOURS.length + ' fleece tokens inlined, with look.js\'s hexes',
    missingTokens.length === 0, missingTokens.map((c) => c.id).join(', '));

  /* Everything below is asserted against the sheep symbol itself, not the whole
     document: the stylesheets mention --fleece too, and a check that any copy
     of the string survived would pass a sheep whose fleece went back to a
     hardcoded fill. */
  const sheep = /<symbol id="sp-sheep"[\s\S]*?<\/symbol>/.exec(d);
  chk(n + ': the sheep symbol survived', !!sheep);
  const sheepSvg = sheep ? sheep[0] : '';
  chk(n + ': the sheep reads its fleece from the property',
    /fill="var\(--fleece,[^"]*\)"/.test(sheepSvg));

  /* The face: two eyes and a nose. Counted by distinct eye positions rather
     than by element, so how an eye is built stays the author's business while
     a sheep that lost one still fails. */
  const eyes = new Set([...sheepSvg.matchAll(/<circle[^>]*cx="([\d.]+)"/g)].map((m) => m[1]));
  chk(n + ': the sheep has two eyes', eyes.size >= 2, [...eyes].join('/'));
  chk(n + ': and a nose', /<(ellipse|path)[^>]*fill="var\(--hedge\)"/.test(sheepSvg));
  /* A gradient or a filter would be the first in the whole sprite sheet. */
  chk(n + ': the face brought no gradients or filters with it',
    !/gradient|filter=/i.test(sheepSvg));

  /* The surfaces destructure the look module off the transport shim, so a name
     they import that the shim never set arrives as undefined and dies deep
     inside a render instead of here. */
  const shimmed = [...d.matchAll(/const \{([^}]*)\} = window\.__bench;/g)]
    .flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
  const exposed = /window\.__bench = \{([\s\S]*?)\n  \};/.exec(d);
  chk(n + ': the shim object was found', !!exposed);
  const unshimmed = shimmed.filter(
    (name) => !exposed || !new RegExp('(^|[\\s,{])' + name + '\\s*[,:(}]').test(exposed[1]),
  );
  chk(n + ': every imported binding is on the shim', unshimmed.length === 0, unshimmed.join(', '));
  chk(n + ': the look module is inlined beside the shim',
    d.includes("id: 'blossom'") && d.includes("id: 'antlers'") && d.includes('function validateLook'));
}

/* A frame that dies during boot must be able to say so. Without these the
   failure mode is a black rectangle, which is what shipped. */
for (const [n, d] of [['display', tv], ['phone', pl]]) {
  chk(n + ': reports its own boot', d.includes("tell('boot')"));
  chk(n + ': forwards uncaught errors', d.includes("addEventListener('error'"));
  chk(n + ': forwards rejected promises', d.includes("addEventListener('unhandledrejection'"));
}
chk('bench shows per-surface boot state', h.includes("id=\"boot-tv\"") && h.includes("id=\"boot-play\""));
chk('bench times out a silent frame', h.includes("never ran its script at all"));

chk('display carries the real treemap', tv.includes('function subdivide'));
chk('display carries the container tiers', tv.includes('@container'));
chk('display carries the direction contract', tv.includes('seed key 75aaed95'));
chk('phone carries the grid-area placement fix', pl.includes('grid-area: mid'));
chk('phone carries the live region on lock-note', pl.includes('aria-live="polite"'));

process.exit(bad ? 1 : 0);
