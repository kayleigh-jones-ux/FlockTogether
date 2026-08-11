/**
 * Flock Together — single source of truth for tunable values.
 *
 * Every value is overridable by an environment variable of the same name.
 * The exported object is frozen: import it, read it, never mutate it.
 *
 *   import config from './src/config.js';   // default export
 *   import { config } from './src/config.js'; // named export (same object)
 */

/**
 * Read an integer env var, falling back to `fallback` when unset, empty,
 * or not a finite number. Never throws — a typo in the environment degrades
 * to the documented default rather than taking the server down.
 */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const parsed = Number(String(raw).trim());
  if (!Number.isFinite(parsed)) {
    console.warn(`[config] ${name}="${raw}" is not a number — using default ${fallback}`);
    return fallback;
  }
  return Math.trunc(parsed);
}

/** Read a string env var, returning null when unset or empty. */
function envString(name, fallback = null) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  return String(raw).trim();
}

export const config = Object.freeze({
  // ---- Transport ---------------------------------------------------------
  /** HTTP + WebSocket port. */
  PORT: envInt('PORT', 3000),

  /**
   * Public origin the QR code and join URL should point at, e.g.
   * "https://flock.example.com" or a tunnel URL. When null, the server
   * falls back to the first non-internal IPv4 address, then to localhost.
   * Set this whenever the display is being screenshared and players are
   * off-LAN — otherwise the QR encodes a LAN address they cannot reach.
   */
  PUBLIC_URL: envString('PUBLIC_URL', null),

  // ---- Timings ----------------------------------------------------------
  /** Seconds players have to submit an answer before submissions close. */
  ANSWER_SECONDS: envInt('ANSWER_SECONDS', 45),

  /** How long the reveal stays on screen before the round auto-advances (ms). */
  REVEAL_MS: envInt('REVEAL_MS', 9000),

  /** How long a scoreboard stays on screen (ms). */
  SCORES_MS: envInt('SCORES_MS', 8000),

  // ---- Room shape -------------------------------------------------------
  /** Players required before the display can start the game. */
  LOBBY_MIN_PLAYERS: envInt('LOBBY_MIN_PLAYERS', 2),

  /** Hard cap on players per room. */
  MAX_PLAYERS: envInt('MAX_PLAYERS', 20),

  /** Number of questions in a game unless overridden. */
  DEFAULT_ROUNDS: envInt('DEFAULT_ROUNDS', 9),
});

export default config;
