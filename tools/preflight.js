#!/usr/bin/env node
/**
 * Flock Together — preflight.
 *
 *   node tools/preflight.js
 *
 * Answers one question before a party starts: will this thing work, and will the
 * people I want to play with actually be able to join?
 *
 * Reports every check as PASS / WARN / FAIL.
 *   PASS  fine.
 *   WARN  the game still runs, but something is degraded — most often grouping
 *         falling back to fuzzy matching, or a QR remote players cannot reach.
 *   FAIL  the game will not run as configured. Exit code 1.
 *
 * Pure ESM, zero dependencies of its own. Reads nothing it does not own; starts
 * no server beyond a momentary listen to prove the port is free.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import config from '../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** The model src/grouping.js calls. Kept in sync by hand — it is a message, not logic. */
const GROUPING_MODEL = 'claude-opus-5';

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (colour ? `[${code}m${text}[0m` : text);

const LEVELS = {
  PASS: { label: 'PASS', code: '32' },
  WARN: { label: 'WARN', code: '33' },
  FAIL: { label: 'FAIL', code: '31' },
};

const tally = { PASS: 0, WARN: 0, FAIL: 0 };

/**
 * Print one check line, plus optional indented detail lines.
 * @param {'PASS'|'WARN'|'FAIL'} level
 * @param {string} title
 * @param {string|string[]} [detail]
 */
function report(level, title, detail) {
  tally[level] += 1;
  const { label, code } = LEVELS[level];
  console.log(`  ${paint(code, label)}  ${title}`);
  const lines = detail === undefined ? [] : Array.isArray(detail) ? detail : [detail];
  for (const line of lines) console.log(`        ${paint('90', line)}`);
}

function section(name) {
  console.log('');
  console.log(`  ${paint('1', name)}`);
}

// ---------------------------------------------------------------------------
// 1. Node version
// ---------------------------------------------------------------------------

/** Read the minimum major from package.json engines.node, e.g. ">=20" -> 20. */
function requiredMajor(pkg, fallback = 20) {
  const range = pkg?.engines?.node;
  const found = typeof range === 'string' ? range.match(/(\d+)/) : null;
  return found ? Number(found[1]) : fallback;
}

function checkNode(pkg) {
  const min = requiredMajor(pkg);
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isFinite(major) && major >= min) {
    report('PASS', `Node ${process.version} (needs >= ${min})`);
  } else {
    report('FAIL', `Node ${process.version} is too old — needs >= ${min}`, [
      'The server uses top-level await, node: imports and modern ESM.',
      'Install a current Node (nvm install 20, or nodejs.org) and retry.',
    ]);
  }
}

// ---------------------------------------------------------------------------
// 2. Dependencies resolvable
// ---------------------------------------------------------------------------

/** True if a bare specifier resolves by any mechanism the server might use. */
function resolves(name) {
  try {
    if (typeof import.meta.resolve === 'function') {
      import.meta.resolve(name);
      return true;
    }
  } catch {
    /* fall through to require.resolve — some packages are CJS-resolvable only */
  }
  try {
    require.resolve(name);
    return true;
  } catch {
    /* fall through to a bare directory check */
  }
  return fs.existsSync(path.join(ROOT, 'node_modules', name, 'package.json'));
}

function checkDependencies(pkg) {
  const deps = Object.keys(pkg?.dependencies ?? {});
  if (deps.length === 0) {
    report('WARN', 'package.json declares no dependencies', 'Expected express, ws, qrcode, @anthropic-ai/sdk.');
    return;
  }

  const missing = deps.filter((name) => !resolves(name));
  const installed = deps.length - missing.length;

  if (missing.length === 0) {
    report('PASS', `All ${deps.length} dependencies resolve`, deps.join(', '));
    return;
  }

  report('FAIL', `${missing.length} of ${deps.length} dependencies do not resolve`, [
    `Missing: ${missing.join(', ')}`,
    installed > 0 ? `Resolved: ${installed}` : 'Nothing is installed yet.',
    'Run: npm install',
  ]);
}

// ---------------------------------------------------------------------------
// 3. Grouping credentials
// ---------------------------------------------------------------------------

function checkGroupingKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  const token = process.env.ANTHROPIC_AUTH_TOKEN;

  if (key) {
    const shape = key.startsWith('sk-ant-') ? '' : ' (does not start with "sk-ant-" — check it is the right value)';
    report('PASS', `ANTHROPIC_API_KEY is set${shape}`, [
      `Answers will be grouped by meaning using ${GROUPING_MODEL}, server-side.`,
      'The display will report groupingSource: "claude".',
    ]);
    if (token) {
      report('WARN', 'ANTHROPIC_AUTH_TOKEN is also set', 'Set one credential, not both — the SDK may not pick the one you expect.');
    }
    return;
  }

  if (token) {
    report('PASS', 'ANTHROPIC_AUTH_TOKEN is set (no ANTHROPIC_API_KEY)', [
      `Grouping will attempt ${GROUPING_MODEL} using this token.`,
    ]);
    return;
  }

  report('WARN', 'ANTHROPIC_API_KEY is not set — grouping falls back to fuzzy matching', [
    'This is NOT fatal: the game still runs end to end.',
    'Fallback grouping compares normalised text, so it will split synonyms —',
    '"soda", "pop" and "a coke" land in three groups instead of one.',
    'The display says groupingSource: "fallback" rather than hiding it.',
    'To enable semantic grouping: set ANTHROPIC_API_KEY (see .env.example).',
  ]);
}

// ---------------------------------------------------------------------------
// 4. Join URL / QR reachability
//    Mirrors server.js resolveOrigin(): PUBLIC_URL, then first non-internal
//    IPv4, then localhost.
// ---------------------------------------------------------------------------

function firstNonInternalIPv4() {
  for (const [iface, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      const isIPv4 = address.family === 'IPv4' || address.family === 4;
      if (isIPv4 && !address.internal) return { address: address.address, iface };
    }
  }
  return null;
}

function checkJoinUrl() {
  const lan = firstNonInternalIPv4();

  if (lan) {
    report('PASS', `LAN address: ${lan.address} (${lan.iface})`);
  } else {
    report('WARN', 'No non-internal IPv4 address found', [
      'The join URL will fall back to localhost, which no phone can reach.',
      'Connect this machine to Wi-Fi, or set PUBLIC_URL.',
    ]);
  }

  const origin = config.PUBLIC_URL
    ? config.PUBLIC_URL.replace(/\/+$/, '')
    : lan
      ? `http://${lan.address}:${config.PORT}`
      : `http://localhost:${config.PORT}`;

  const joinUrl = `${origin}/play`;

  if (config.PUBLIC_URL) {
    const detail = [
      `Display:  http://localhost:${config.PORT}/`,
      `QR / join: ${joinUrl}?room=ABCD`,
      'Confirm that URL opens on a phone that is NOT on this network before you start.',
    ];
    if (!/^https?:\/\//.test(config.PUBLIC_URL)) {
      report('FAIL', `PUBLIC_URL has no scheme: "${config.PUBLIC_URL}"`, [
        'Include http:// or https://, e.g. PUBLIC_URL=https://your-tunnel.example.com',
      ]);
    } else if (/\/[^/]/.test(config.PUBLIC_URL.replace(/^https?:\/\//, ''))) {
      report('WARN', `PUBLIC_URL looks like it contains a path: "${config.PUBLIC_URL}"`, [
        'It should be an origin only — the server appends /play?room=ABCD itself.',
      ]);
    } else {
      report('PASS', `PUBLIC_URL is set — the QR will encode ${joinUrl}`, detail);
    }
    return;
  }

  report('WARN', `PUBLIC_URL is unset — the QR will encode ${joinUrl}`, [
    'Fine for a co-located party: everyone is on this Wi-Fi and can reach it.',
    'NOT fine for remote play. If you screenshare the display over Zoom/Discord/Meet,',
    'that address is private to this network and remote players cannot reach it —',
    'they will scan the QR and get nothing, with no error to explain why.',
    'Fix: expose the port (cloudflared / ngrok / tailscale funnel) and start with',
    '  PUBLIC_URL=https://your-tunnel.example.com npm start',
  ]);
}

// ---------------------------------------------------------------------------
// 5. Self-hosted fonts
//    Expected filenames are read out of tokens.css so this check cannot drift
//    from what the stylesheet actually asks for.
// ---------------------------------------------------------------------------

function expectedFontFiles() {
  const tokens = path.join(ROOT, 'public', 'shared', 'tokens.css');
  try {
    const css = fs.readFileSync(tokens, 'utf8');
    const names = [...css.matchAll(/fonts\/([\w.-]+\.woff2)/g)].map((m) => m[1]);
    return [...new Set(names)];
  } catch {
    return [];
  }
}

function checkFonts() {
  const dir = path.join(ROOT, 'public', 'fonts');
  let present = [];
  try {
    present = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.woff2'));
  } catch {
    report('WARN', 'public/fonts/ does not exist — no .woff2 files at all', [
      'Type falls back to a system face: Bricolage Grotesque and Archivo are what',
      'carry the display voice, so the whole thing will look generic.',
      'These files are checked into the repo deliberately so the game runs offline.',
    ]);
    return;
  }

  const expected = expectedFontFiles();
  const missing = expected.filter((name) => !present.includes(name));

  if (expected.length > 0 && missing.length === 0) {
    report('PASS', `Fonts present: ${present.join(', ')}`);
    return;
  }

  if (expected.length === 0) {
    if (present.length > 0) {
      report('PASS', `Fonts present: ${present.join(', ')}`, 'Could not read tokens.css to confirm the expected filenames.');
    } else {
      report('WARN', 'No .woff2 files in public/fonts/', 'Type falls back to a system face.');
    }
    return;
  }

  report('WARN', `Missing font file(s): ${missing.join(', ')}`, [
    `tokens.css asks for ${expected.length}, found ${present.length}.`,
    'Type falls back to a system face — display headlines and the monumental',
    'numerals will not look right, but the game still plays.',
  ]);
}

// ---------------------------------------------------------------------------
// 6. Port availability
// ---------------------------------------------------------------------------

/** Bind PORT briefly and release it. Resolves to null on success or an Error code. */
function portProbe(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    const done = (result) => {
      server.removeAllListeners();
      try {
        server.close(() => resolve(result));
      } catch {
        resolve(result);
      }
    };
    server.once('error', (err) => {
      server.removeAllListeners();
      resolve(err);
    });
    server.once('listening', () => done(null));
    server.listen(port, '0.0.0.0');
  });
}

async function checkPort() {
  const port = config.PORT;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    report('FAIL', `PORT is not a usable port number: ${port}`, 'Use an integer from 1 to 65535.');
    return;
  }

  const err = await portProbe(port);

  if (err === null) {
    report('PASS', `Port ${port} is free`);
    return;
  }

  if (err.code === 'EADDRINUSE') {
    report('FAIL', `Port ${port} is already in use`, [
      'Something else is listening there — very likely another copy of this server.',
      `Stop it, or start on another port:  PORT=${port + 1} npm start`,
    ]);
    return;
  }

  if (err.code === 'EACCES') {
    report('FAIL', `Port ${port} needs elevated privileges`, 'Ports below 1024 are restricted. Use 3000, or run behind a proxy.');
    return;
  }

  report('FAIL', `Could not bind port ${port}: ${err.code ?? err.message}`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function readPackageJson() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  } catch (err) {
    report('FAIL', 'Cannot read package.json', String(err.message));
    return null;
  }
}

console.log('');
console.log(`  ${paint('1', 'Flock Together — preflight')}`);
console.log(`  ${paint('90', ROOT)}`);

const pkg = readPackageJson();

section('Runtime');
checkNode(pkg);
checkDependencies(pkg);

section('Grouping');
checkGroupingKey();

section('How players will join');
checkJoinUrl();

section('Assets');
checkFonts();

section('Port');
await checkPort();

section('Settings in effect');
console.log(
  `        ${paint('90', `rounds ${config.DEFAULT_ROUNDS} · answer ${config.ANSWER_SECONDS}s · reveal ${config.REVEAL_MS}ms · scores ${config.SCORES_MS}ms · players ${config.LOBBY_MIN_PLAYERS}–${config.MAX_PLAYERS}`)}`
);

console.log('');
const summary = `${tally.PASS} pass · ${tally.WARN} warn · ${tally.FAIL} fail`;
if (tally.FAIL > 0) {
  console.log(`  ${paint('31', 'NOT READY')}  ${summary}`);
  console.log(`  ${paint('90', 'Fix the FAIL lines above, then run this again.')}`);
  console.log('');
  process.exit(1);
}

if (tally.WARN > 0) {
  console.log(`  ${paint('33', 'READY, WITH CAVEATS')}  ${summary}`);
  console.log(`  ${paint('90', 'The game will run. Read the WARN lines so nothing surprises you mid-party.')}`);
} else {
  console.log(`  ${paint('32', 'READY')}  ${summary}`);
  console.log(`  ${paint('90', 'npm start')}`);
}
console.log('');
process.exit(0);
