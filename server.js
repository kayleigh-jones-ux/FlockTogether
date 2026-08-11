/**
 * Flock Together — transport layer.
 *
 * This file owns ONLY:
 *   - the HTTP server and static hosting of ./public
 *   - the WebSocket endpoint at /socket
 *   - the room registry (codes, join URL, QR)
 *   - broadcasting frames to a room's connections
 *   - heartbeats and graceful shutdown
 *
 * ALL game state transitions live in src/game.js. If you find yourself
 * reasoning about phases, scores, or timers in this file, it belongs there.
 */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import express from 'express';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';

import config from './src/config.js';
import { createGame } from './src/game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Constants (transport-only; game tunables live in src/config.js)
// ---------------------------------------------------------------------------

/** Room code alphabet with every ambiguous glyph removed: no O, 0, I, 1, L. */
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;
const MAX_ROOM_CODE_ATTEMPTS = 500;

/** WebSocket keepalive: ping every 30s, terminate anything that misses a beat. */
const HEARTBEAT_MS = 30_000;

/** Reject absurd frames outright — answers are short strings. */
const MAX_FRAME_BYTES = 64 * 1024;

/** Rooms with zero live connections are swept after this long. */
const EMPTY_ROOM_TTL_MS = 15 * 60_000;
const ROOM_SWEEP_MS = 60_000;

/** How long to wait for sockets to close on SIGINT/SIGTERM before forcing exit. */
const SHUTDOWN_GRACE_MS = 5_000;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}
function warn(...args) {
  console.warn(`[${new Date().toISOString()}]`, ...args);
}
function logError(...args) {
  console.error(`[${new Date().toISOString()}]`, ...args);
}

// ---------------------------------------------------------------------------
// Protocol errors — anything thrown with a code becomes a clean error frame.
// ---------------------------------------------------------------------------

class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

const ERROR_CODES = new Set([
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'NAME_TAKEN',
  'GAME_STARTED',
  'BAD_REQUEST',
  // The picker's codes. Unlisted codes are flattened to BAD_REQUEST on the way
  // out, which would turn "that sheep is taken" into a dead end on the phone.
  'LOOK_TAKEN',
  'BAD_LOOK',
  'NOT_LOCKED',
]);

// ---------------------------------------------------------------------------
// Sibling modules (written by other agents) — resolved leniently so a
// half-built checkout still boots and says clearly what is missing.
// ---------------------------------------------------------------------------

const FALLBACK_QUESTIONS = [
  // Placeholder prototype content, used only when src/questions.js is absent.
  'Name a hot beverage',
  'Name something you find in a kitchen drawer',
  'Name a reason you might be late',
];

async function loadQuestions() {
  try {
    const mod = await import('./src/questions.js');
    const list = mod.questions ?? mod.QUESTIONS ?? mod.default;
    if (Array.isArray(list) && list.length > 0) return list;
    warn('src/questions.js loaded but exported no usable question array — using placeholders.');
  } catch (err) {
    warn(`src/questions.js not available (${err.code ?? err.message}) — using placeholder questions.`);
  }
  return FALLBACK_QUESTIONS;
}

async function loadGroupAnswers() {
  try {
    const mod = await import('./src/grouping.js');
    const fn = mod.groupAnswers ?? mod.default;
    if (typeof fn === 'function') return fn;
    warn('src/grouping.js loaded but exported no groupAnswers function — using exact-match fallback.');
  } catch (err) {
    warn(`src/grouping.js not available (${err.code ?? err.message}) — using exact-match fallback grouping.`);
  }
  // Honest last resort: normalised exact-match clustering, reported as 'fallback'
  // so the display can say so out loud (PRODUCT.md principle 5).
  // Signature matches src/grouping.js and the engine's call: (question, answers).
  return async function exactMatchFallback(question, answers) {
    if (!Array.isArray(answers)) return { source: 'fallback', groups: [] };
    const buckets = new Map();
    for (const answer of answers) {
      const key = String(answer.text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(answer);
    }
    return {
      source: 'fallback',
      groups: [...buckets.entries()].map(([key, members]) => ({
        label: members[0]?.text ?? key,
        answers: members,
      })),
    };
  };
}

const questions = await loadQuestions();
const groupAnswers = await loadGroupAnswers();

// ---------------------------------------------------------------------------
// Join URL resolution — PUBLIC_URL, then first non-internal IPv4, then localhost
// ---------------------------------------------------------------------------

function firstNonInternalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      const family = address.family;
      const isIPv4 = family === 'IPv4' || family === 4;
      if (isIPv4 && !address.internal) {
        return { address: address.address, iface: name };
      }
    }
  }
  return null;
}

function resolveOrigin() {
  if (config.PUBLIC_URL) {
    return {
      origin: config.PUBLIC_URL.replace(/\/+$/, ''),
      source: 'PUBLIC_URL',
    };
  }
  const lan = firstNonInternalIPv4();
  if (lan) {
    return {
      origin: `http://${lan.address}:${config.PORT}`,
      source: `first non-internal IPv4 (${lan.iface})`,
    };
  }
  return {
    origin: `http://localhost:${config.PORT}`,
    source: 'localhost fallback (no external network interface found)',
  };
}

function joinUrlFor(roomCode) {
  const { origin } = resolveOrigin();
  return `${origin}/play?room=${roomCode}`;
}

async function qrDataUri(text) {
  const svg = await QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Room registry
// ---------------------------------------------------------------------------

/** @type {Map<string, {code:string, joinUrl:string, qr:string, createdAt:number, emptySince:number|null, connections:Set<object>, game:object}>} */
const rooms = new Map();

function generateRoomCode() {
  for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt += 1) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new ProtocolError('BAD_REQUEST', 'Could not allocate a free room code');
}

function normalizeRoomCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function attach(conn, room) {
  if (conn.roomCode && conn.roomCode !== room.code) detach(conn);
  conn.roomCode = room.code;
  room.connections.add(conn);
  room.emptySince = null;
  // The engine only learns about a socket once that socket has a room.
  try {
    room.game?.addConnection(conn);
  } catch (err) {
    logError(`engine addConnection threw for ${conn.id} in ${room.code}:`, err);
  }
}

function detach(conn) {
  if (!conn.roomCode) return;
  const room = rooms.get(conn.roomCode);
  if (room) {
    room.connections.delete(conn);
    try {
      room.game?.removeConnection(conn);
    } catch (err) {
      logError(`engine removeConnection threw for ${conn.id} in ${room.code}:`, err);
    }
    if (room.connections.size === 0) room.emptySince = Date.now();
  }
  conn.roomCode = undefined;
}

function sweepEmptyRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.connections.size > 0) continue;
    if (room.emptySince === null) {
      room.emptySince = now;
      continue;
    }
    if (now - room.emptySince < EMPTY_ROOM_TTL_MS) continue;
    rooms.delete(code);
    // Drop the room's engine so its timers/state die with the room.
    if (room.game && typeof room.game.dispose === 'function') {
      try {
        room.game.dispose();
      } catch (err) {
        logError(`engine dispose(${code}) threw:`, err);
      }
    }
    log(`room ${code} swept (idle ${Math.round((now - room.emptySince) / 1000)}s)`);
  }
}

// ---------------------------------------------------------------------------
// Frame send / broadcast
// ---------------------------------------------------------------------------

const WS_OPEN = 1;

function send(conn, frame) {
  if (!conn || !conn.socket || conn.socket.readyState !== WS_OPEN) return false;
  try {
    conn.socket.send(JSON.stringify(frame));
    return true;
  } catch (err) {
    logError(`send to ${conn.id} failed:`, err.message);
    return false;
  }
}

function sendError(conn, code, message) {
  const safeCode = ERROR_CODES.has(code) ? code : 'BAD_REQUEST';
  send(conn, { t: 'error', code: safeCode, message: message ?? safeCode });
}

/**
 * Provided BY server.js TO the engine.
 *
 * `buildFrameForConn(conn)` is called once per live connection in the room and
 * should return the frame that connection should receive, or a falsy value to
 * send nothing to it. A throw for one connection never affects the others.
 */
function broadcast(roomCode, buildFrameForConn) {
  const room = rooms.get(normalizeRoomCode(roomCode));
  if (!room || typeof buildFrameForConn !== 'function') return 0;
  let delivered = 0;
  for (const conn of [...room.connections]) {
    let frame;
    try {
      frame = buildFrameForConn(conn);
    } catch (err) {
      logError(`broadcast builder threw for ${conn.id} in ${room.code}:`, err);
      continue;
    }
    if (frame && send(conn, frame)) delivered += 1;
  }
  return delivered;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');

function sendPage(res, file) {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, file), (err) => {
    if (!err) return;
    logError(`failed to serve ${file}:`, err.message);
    if (!res.headersSent) res.status(500).type('text/plain').send(`Missing public/${file}`);
  });
}

app.get('/', (_req, res) => sendPage(res, 'tv.html'));
app.get('/play', (_req, res) => sendPage(res, 'play.html'));

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    connections: [...rooms.values()].reduce((n, r) => n + r.connections.size, 0),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.use(express.static(PUBLIC_DIR, { index: false, extensions: ['html'] }));

const server = http.createServer(app);

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({
  server,
  path: '/socket',
  maxPayload: MAX_FRAME_BYTES,
});

wss.on('connection', (socket, req) => {
  /**
   * The connection handle handed to the engine.
   * server.js owns `id`, `socket`, `roomCode`; the engine owns `kind`
   * (once it knows) and `playerId`.
   */
  const conn = {
    id: `c_${randomUUID().replaceAll('-', '').slice(0, 10)}`,
    socket,
    kind: 'unknown',
    playerId: undefined,
    roomCode: undefined,
  };
  socket.__conn = conn;
  socket.__isAlive = true;

  log(`socket open ${conn.id} from ${req.socket.remoteAddress ?? 'unknown'}`);

  // No engine is known until this socket creates or joins a room, so there is
  // nothing to register here.

  socket.on('pong', () => {
    socket.__isAlive = true;
  });

  socket.on('message', (raw, isBinary) => {
    socket.__isAlive = true;

    let msg;
    try {
      if (isBinary) throw new SyntaxError('binary frames are not supported');
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      sendError(conn, 'BAD_REQUEST', 'Frame was not valid JSON');
      return;
    }

    // Never let a bad frame take the process down.
    Promise.resolve()
      .then(() => routeFrame(conn, msg))
      .catch((err) => {
        if (err instanceof ProtocolError) {
          sendError(conn, err.code, err.message);
        } else {
          logError(`handler error for ${conn.id} (${msg?.t}):`, err);
          sendError(conn, 'BAD_REQUEST', 'Could not handle that request');
        }
      });
  });

  socket.on('error', (err) => {
    warn(`socket error ${conn.id}:`, err.message);
  });

  socket.on('close', (code) => {
    log(`socket close ${conn.id} (${code})`);
    // detach() tells this room's engine the socket is gone.
    detach(conn);
  });
});

wss.on('error', (err) => {
  logError('websocket server error:', err);
});

// ---------------------------------------------------------------------------
// Frame routing
// ---------------------------------------------------------------------------

async function routeFrame(conn, msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') {
    throw new ProtocolError('BAD_REQUEST', 'Frame must be an object with a string "t"');
  }

  switch (msg.t) {
    case 'ping':
      send(conn, { t: 'pong' });
      return;

    case 'host.create':
      await handleHostCreate(conn);
      return;

    // A display re-attaching to a room it already owns, after its socket
    // dropped. Deliberately NOT host.create: that allocates a fresh code and
    // resets the lobby, which would orphan every phone already in the paddock.
    case 'host.resume': {
      const code = normalizeRoomCode(msg.room);
      const room = rooms.get(code);
      if (!room) throw new ProtocolError('ROOM_NOT_FOUND', `No room "${code}"`);
      conn.kind = 'host';
      attach(conn, room);
      send(conn, { t: 'room.created', room: room.code, joinUrl: room.joinUrl, qr: room.qr });
      dispatch(conn, { t: 'host.resume', room: code });
      log(`room ${code} resumed by ${conn.id}`);
      return;
    }

    case 'player.join':
    case 'player.rejoin': {
      // server.js owns the registry, so ROOM_NOT_FOUND is decided here.
      const code = normalizeRoomCode(msg.room);
      const room = rooms.get(code);
      if (!room) throw new ProtocolError('ROOM_NOT_FOUND', `No room "${code}"`);
      attach(conn, room);
      dispatch(conn, { ...msg, room: code });
      return;
    }

    // The picker. Routed explicitly, not by falling through, because it is only
    // meaningful on a socket that has already joined a room — and because the
    // reply (look.ok, plus a look.taken push to the room) is decided entirely by
    // state this file must not hold a copy of.
    case 'player.look':
      dispatch(conn, msg);
      return;

    default:
      // Everything else (host.start, player.answer, future frames) is the
      // engine's business.
      dispatch(conn, msg);
  }
}

/** Routes a frame to the engine that owns the connection's room. */
function dispatch(conn, msg) {
  const room = conn.roomCode ? rooms.get(conn.roomCode) : null;
  if (!room || !room.game) {
    throw new ProtocolError('ROOM_NOT_FOUND', 'You are not in a room');
  }
  const result = room.game.handleMessage(conn, msg);
  // The engine may be async (grouping calls the Claude API). Surface rejections
  // as errors rather than unhandled promises.
  if (result && typeof result.then === 'function') {
    return result;
  }
  return undefined;
}

async function handleHostCreate(conn) {
  const code = generateRoomCode();
  const joinUrl = joinUrlFor(code);
  const qr = await qrDataUri(joinUrl);

  const room = {
    code,
    joinUrl,
    qr,
    createdAt: Date.now(),
    emptySince: null,
    connections: new Set(),
    // One engine per room, told the code server.js allocated so every frame's
    // `room` field matches the code players actually joined with.
    game: createGame({ config, questions, groupAnswers, broadcast, room: code }),
  };
  rooms.set(code, room);

  conn.kind = 'host';
  attach(conn, room);

  send(conn, { t: 'room.created', room: code, joinUrl, qr });
  log(`room ${code} created by ${conn.id} — join at ${joinUrl}`);

  // Tell this room's engine to spin up lobby state. The room code is added to
  // the frame because the engine does not allocate codes.
  await dispatch(conn, { t: 'host.create', room: code });
}

// ---------------------------------------------------------------------------
// Heartbeat + room sweep
// ---------------------------------------------------------------------------

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.__isAlive === false) {
      const id = socket.__conn?.id ?? 'unknown';
      warn(`terminating dead socket ${id}`);
      socket.terminate();
      continue;
    }
    socket.__isAlive = false;
    try {
      socket.ping();
    } catch {
      socket.terminate();
    }
  }
}, HEARTBEAT_MS);
heartbeat.unref?.();

const roomSweep = setInterval(sweepEmptyRooms, ROOM_SWEEP_MS);
roomSweep.unref?.();

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

server.listen(config.PORT, () => {
  const { origin, source } = resolveOrigin();
  const lines = [
    '',
    '  ┌─────────────────────────────────────────────────────────────',
    '  │  Flock Together',
    '  ├─────────────────────────────────────────────────────────────',
    `  │  Display (open this on the TV / laptop):  http://localhost:${config.PORT}/`,
    `  │  Player join URL (encoded in the QR):     ${origin}/play`,
    `  │  Join URL resolved from:                  ${source}`,
    `  │  WebSocket:                               ${origin.replace(/^http/, 'ws')}/socket`,
    `  │  Rounds: ${config.DEFAULT_ROUNDS}   Answer timer: ${config.ANSWER_SECONDS}s   Players: ${config.LOBBY_MIN_PLAYERS}–${config.MAX_PLAYERS}`,
    '  └─────────────────────────────────────────────────────────────',
  ];
  for (const line of lines) console.log(line);

  if (!config.PUBLIC_URL) {
    console.log(
      '  HINT: playing over a screenshare, a tunnel, or any host outside this LAN?\n' +
        '        The QR above points at a LAN address remote players cannot reach.\n' +
        '        Set PUBLIC_URL to the origin players will actually type, e.g.\n' +
        '          PUBLIC_URL=https://your-tunnel.example.com npm start\n'
    );
  } else {
    console.log(`  PUBLIC_URL is set — QR codes point at ${config.PUBLIC_URL}\n`);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      '  NOTE: ANTHROPIC_API_KEY is not set. Semantic grouping needs it; without it\n' +
        "        rounds fall back to plain text matching and the display will say so.\n"
    );
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logError(`Port ${config.PORT} is already in use. Set PORT to something else.`);
    process.exit(1);
  }
  logError('http server error:', err);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received — shutting down`);

  clearInterval(heartbeat);
  clearInterval(roomSweep);

  for (const [code, room] of rooms) {
    try {
      room.game?.dispose();
    } catch (err) {
      logError(`engine dispose(${code}) threw:`, err);
    }
  }

  for (const socket of wss.clients) {
    try {
      socket.close(1001, 'server shutting down');
    } catch {
      socket.terminate();
    }
  }

  wss.close(() => log('websocket server closed'));
  server.close(() => {
    log('http server closed — bye');
    process.exit(0);
  });

  setTimeout(() => {
    warn('forcing exit after shutdown grace period');
    for (const socket of wss.clients) socket.terminate();
    process.exit(0);
  }, SHUTDOWN_GRACE_MS).unref?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logError('unhandled rejection (ignored, server stays up):', reason);
});
process.on('uncaughtException', (err) => {
  logError('uncaught exception (ignored, server stays up):', err);
});
