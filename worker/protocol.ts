/* The wire protocol, as types.
 *
 * One WebSocket endpoint carries every frame in both directions, and every
 * frame is a JSON object with a `t` discriminator. On the Node server this
 * contract lived only in the heads of whoever wrote server.js and the two
 * surfaces; here it is checked. When the front ends become TypeScript they
 * import these same types, so a frame the display sends and a frame the server
 * expects cannot drift apart without the build failing.
 *
 * Colours and hats are NOT redefined here — public/shared/look.js is their one
 * source of truth and is imported by the Worker and the surfaces alike.
 */

/** A player's chosen appearance. Ids are validated against look.js. */
export interface Look {
  colorId: string;
  hatId: string;
}

export type Phase = 'lobby' | 'question' | 'grouping' | 'reveal' | 'scores' | 'final';

export type ScoreboardReason = 'third' | 'penultimate' | 'final';

export type GroupingSource = 'claude' | 'fallback';

/* --- what the display and the phones are sent ----------------------------- */

export interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  answered: boolean;
  connected: boolean;
  /** Always present: players[] contains only locked-in players. */
  look: Look;
}

export interface PublicAnswer {
  playerId: string;
  name: string;
  text: string;
}

export interface PublicGroup {
  id: string;
  label: string;
  scored: boolean;
  answers: PublicAnswer[];
}

/** The phone's private view of itself. Never sent to the display. */
export interface YouView {
  id: string;
  name: string;
  score: number;
  answered: boolean;
  look: Look | null;
  locked: boolean;
  /** Arrives only from the reveal phase onward, so nothing can leak early. */
  myGroupId: string | null;
  scoredThisRound: boolean;
}

export interface StateFrame {
  t: 'state';
  room: string;
  phase: Phase;
  roundIndex: number;
  totalRounds: number;
  question: string | null;
  /** Epoch ms the answer gate shuts. Null outside the question phase. */
  endsAt: number | null;
  players: PublicPlayer[];
  /** Joined but still picking a look, so not yet part of the flock. */
  choosing: number;
  groups: PublicGroup[];
  noAnswer: Array<{ playerId: string; name: string }>;
  scoreboardReason: ScoreboardReason | null;
  groupingSource: GroupingSource | null;
  you?: YouView;
}

/* --- server -> client ----------------------------------------------------- */

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_STARTED'
  | 'NAME_TAKEN'
  | 'BAD_REQUEST'
  | 'LOOK_TAKEN'
  | 'BAD_LOOK'
  | 'NOT_LOCKED';

export type ServerFrame =
  | { t: 'room.created'; room: string; joinUrl: string; qr: string }
  | { t: 'joined'; playerId: string; room: string; name: string }
  | StateFrame
  | { t: 'look.ok'; look: Look }
  /** Advisory only — the server still rejects a race. Keys are lookKey(). */
  | { t: 'look.taken'; taken: string[] }
  | { t: 'error'; code: ErrorCode; message: string };

/* --- client -> server ----------------------------------------------------- */

export type ClientFrame =
  | { t: 'host.create' }
  | { t: 'host.resume'; room: string }
  | { t: 'host.start' }
  | { t: 'player.join'; room: string; name: string }
  | { t: 'player.rejoin'; room: string; playerId: string }
  | { t: 'player.look'; colorId: string; hatId: string }
  | { t: 'player.answer'; text: string };

/* --- socket identity -----------------------------------------------------
 * Attached to each hibernatable WebSocket. The DO can be evicted and woken
 * with its sockets intact, and when that happens the only thing it knows about
 * a socket is this attachment — so it must carry everything needed to route a
 * frame. Keep it small: the attachment has a hard size limit and is serialised
 * on every hibernation.
 */
export type SocketRole = 'display' | 'player';

export interface SocketMeta {
  role: SocketRole;
  /** Set for players once they have joined; null for a display. */
  playerId: string | null;
}

/** Narrow an untrusted parsed frame to a ClientFrame. */
export function isClientFrame(value: unknown): value is ClientFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { t?: unknown }).t === 'string'
  );
}
