#!/usr/bin/env node
/* Assembles the Flock Together test bench into ONE self-contained HTML file.
 *
 * It reads the real public/ sources rather than a retyped copy, so whatever you
 * look at in the bench is genuinely the shipped design. Each surface runs in its
 * own iframe: the two stylesheets really do collide on .question/.clock/.field,
 * and the phone needs a real narrow viewport for its container queries and
 * safe-area rules to behave honestly.
 *
 * Usage: node tools/build-artifact.js  ->  writes flock-together-bench.html
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const b64 = (p) => readFileSync(join(root, p)).toString('base64');

const fontArchivo = b64('public/fonts/archivo-latin.woff2');
const fontBricolage = b64('public/fonts/bricolage-grotesque-latin.woff2');

/* Fonts must be data URIs: the artifact CSP blocks every external host. */
let tokens = read('public/shared/tokens.css')
  .replace("url('../fonts/bricolage-grotesque-latin.woff2') format('woff2-variations')",
           `url(data:font/woff2;base64,${fontBricolage}) format('woff2-variations')`)
  .replace("url('../fonts/archivo-latin.woff2') format('woff2-variations')",
           `url(data:font/woff2;base64,${fontArchivo}) format('woff2-variations')`);

const tvCss = read('public/tv.css');
const playCss = read('public/play.css');
const sprites = read('public/shared/sprites.svg');
const raddleSrc = read('public/shared/raddle.js');
const lookSrc = read('public/shared/look.js');

/* Body markup only — the bench supplies its own head. */
const bodyOf = (html) => {
  const m = /<body([^>]*)>([\s\S]*?)<\/body>/i.exec(html);
  return { attrs: m[1].trim(), inner: m[2].replace(/<script[\s\S]*?<\/script>/gi, '') };
};
const tvBody = bodyOf(read('public/tv.html'));
const playBody = bodyOf(read('public/play.html'));

/* The surface modules import a WebSocket transport. In the bench the transport
 * is postMessage to the parent, so rewrite only the import lines — every other
 * line of tv.js / play.js is the real shipped code. */
const shimImports = (src) =>
  src
    .replace(/^import \{[^}]*\} from '\/shared\/net\.js';$/m,
             'const { connect, loadSprites, countdown } = window.__bench;')
    .replace(/^import \{[^}]*\} from '\/shared\/raddle\.js';$/m,
             'const { raddleVar, raddleVarForRank, raddleFor } = window.__bench;')
    /* The look import spans many lines, so unlike the two above it cannot be
       matched a line at a time. Its own binding list is kept rather than
       rewritten to a fixed one: both surfaces import a different subset of
       look.js, and whichever names they add next are already shimmed. */
    .replace(/^import (\{[\s\S]*?\}) from '\/shared\/look\.js';$/m,
             'const $1 = window.__bench;');

const tvJs = shimImports(read('public/tv.js'));
const playJs = shimImports(read('public/play.js'));

/* A shared module inlined as plain statements. The bodies are untouched — only
   the export keywords go — so the ids, hexes and validation in the bench are
   the ones look.js actually ships rather than a retyped copy that can drift. */
const asStatements = (src) =>
  src.replace(/^export (function|const)/gm, '$1').replace(/^export default .*$/gm, '');

const raddleModule = asStatements(raddleSrc);
const lookModule = asStatements(lookSrc);

/* Storage is guarded: a sandboxed frame throws on access rather than returning
 * null, which would take the surface down before it rendered. */
const BENCH_RUNTIME = `
(function () {
  const surfaceName = window.__SURFACE__;
  const tell = (kind, detail) => {
    try { parent.postMessage({ __bench: kind, surface: surfaceName, detail }, '*'); } catch (e) {}
  };

  /* A surface that dies during module evaluation used to do so in total
     silence: the frame stayed black, no 'ready' ever arrived, and the bench
     had no way to say why. Every death now has a voice. Registered FIRST,
     before the storage probe below, which is itself a plausible way to die. */
  window.addEventListener('error', (ev) => {
    tell('error', ev.message + (ev.filename ? '' : '') +
      (ev.lineno ? ' (line ' + ev.lineno + ')' : ''));
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    tell('error', 'unhandled rejection: ' + ((r && r.message) || String(r)));
  });
  tell('boot');

  const mem = {};
  const shim = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
    clear: () => { for (const k in mem) delete mem[k]; },
    key: (i) => Object.keys(mem)[i] ?? null,
    get length() { return Object.keys(mem).length; },
  };
  for (const name of ['localStorage', 'sessionStorage']) {
    let ok = false;
    try { window[name].setItem('__t', '1'); window[name].removeItem('__t'); ok = true; } catch (e) { ok = false; }
    if (!ok) { try { Object.defineProperty(window, name, { value: shim, configurable: true }); } catch (e) {} }
  }

  ${raddleModule}

  ${lookModule}

  let onFrameCb = null;
  const surface = window.__SURFACE__;

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.__bench !== 'frame') return;
    if (onFrameCb) onFrameCb(d.frame);
  });

  window.__bench = {
    raddleVar, raddleVarForRank, raddleFor,
    /* The whole look surface, not just the names the surfaces import today:
       the shim keeps each file's own binding list, so anything look.js exports
       has to be reachable here or a new import lands as undefined. */
    FLEECE_COLOURS, HATS, HAT_BOX, colourById, hatById, colourToken, colourVar,
    lookKey, sameLook, validateLook, LOOK_COMBINATIONS,
    loadSprites: async () => {},
    countdown(endsAt, onTick) {
      let raf = null, lastWhole = null;
      const tick = () => {
        const msLeft = Math.max(0, endsAt - Date.now());
        const whole = Math.ceil(msLeft / 1000);
        if (whole !== lastWhole) { lastWhole = whole; onTick(whole, msLeft); }
        if (msLeft > 0) raf = requestAnimationFrame(tick);
      };
      tick();
      return () => raf && cancelAnimationFrame(raf);
    },
    connect({ onFrame, onStatus, identify } = {}) {
      onFrameCb = onFrame;
      const send = (frame) => { parent.postMessage({ __bench: 'send', surface, frame }, '*'); return true; };
      setTimeout(() => {
        if (onStatus) onStatus('open');
        const f = identify && identify();
        if (f) send(f);
        parent.postMessage({ __bench: 'ready', surface }, '*');
      }, 0);
      return { send, close() {} };
    },
  };
})();
`;

const frameDoc = (surface, bodyAttrs, bodyInner, css, js) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>${tokens}\n${css}\nhtml,body{overflow:hidden}</style>
</head><body ${bodyAttrs}>
${sprites}
${bodyInner}
<script>window.__SURFACE__=${JSON.stringify(surface)};${BENCH_RUNTIME}<\/script>
<script type="module">${js}<\/script>
</body></html>`;

const tvDoc = frameDoc('tv', tvBody.attrs, tvBody.inner, tvCss, tvJs);
const playDoc = frameDoc('play', playBody.attrs, playBody.inner, playCss, playJs);

/* The iframe documents travel base64-encoded.
   They were previously embedded as text with their closing script tags written
   `<\/script>`, which is a JAVASCRIPT string escape — but the content is raw
   text read back via textContent, where nothing interprets the backslash. The
   iframe then received a literal `<\/script>`, never closed its script element,
   and rendered nothing. Base64 has no `<` in it at all, so the class of bug
   cannot recur. UTF-8 is preserved explicitly; atob alone is latin1 and would
   mangle every em dash and curly quote in the copy. */
const enc = (s) => Buffer.from(s, 'utf8').toString('base64');

/* A genuine QR, generated by the same library the server uses, encoding the
   bench's stand-in join URL. Real code, honestly labelled — not a decorative
   square pretending to be one. */
const QR = await import('qrcode');
const qrSvg = await QR.default.toString('http://10.0.0.113:3000/play?room=DEMO', {
  type: 'svg', margin: 0, color: { dark: '#12180f', light: '#00000000' },
});
const qrDataUri = 'data:image/svg+xml;base64,' + Buffer.from(qrSvg).toString('base64');

const bench = read('tools/bench-shell.html')
  .replace('/*__TOKENS__*/', () => tokens)
  /* The bench engine mirrors the server's look rules, so it needs the colours,
     the hats and validateLook itself. Injected rather than restated: a second
     copy of the id list is exactly the drift look.js exists to prevent. */
  .replace('/*__LOOK__*/', () => lookModule)
  .replace('<!--__TV_DOC__-->', () => enc(tvDoc))
  .replace('<!--__PLAY_DOC__-->', () => enc(playDoc))
  .replace('window.__QR__ || \'\'', () => JSON.stringify(qrDataUri));

writeFileSync(join(root, 'flock-together-bench.html'), bench);
const kb = (Buffer.byteLength(bench) / 1024).toFixed(0);
console.log(`flock-together-bench.html  ${kb} KB`);
if (Buffer.byteLength(bench) > 15.5 * 1024 * 1024) console.error('WARNING: over the 16MB artifact ceiling');
