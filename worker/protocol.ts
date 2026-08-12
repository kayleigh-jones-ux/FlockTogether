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

/** The phases that no longer advance on an alarm. The host taps Continue and
 *  the room moves; nothing else can move it. Naming them as a type means the
 *  continue frame cannot be sent from a phase that was never gated, and the
 *  serializer and the alarm both read the same list rather than two hand-kept
 *  copies of it drifting apart. */
export type HostGatedPhase = 'reveal' | 'scores';

export type ScoreboardReason = 'third' | 'penultimate' | 'final';

export type GroupingSource = 'claude' | 'fallback';

/* --- what the display and the phones are sent ----------------------------- */

export interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  /** Consecutive rounds ending in a scoring group THAT HAD SOMEBODY ELSE IN IT,
   *  current round included. Not the same as "scored every round": a round where
   *  every answer was unique scores everyone who answered (see PRODUCT.md) and
   *  advances nobody's streak, because the flame claims agreement and there was
   *  none. Reset to 0 the moment a round is missed or answered alone. The
   *  display cannot derive this — it only ever sees the latest frame, and a
   *  streak is a fact about rounds that have already scrolled past. */
  streak: number;
  /** 1-based standing, and a TOTAL order: no two players ever share a rank.
   *  Score alone cannot be sorted client-side any more, because ties break on
   *  cumulative answer COST — a normalised per-round fraction — and that never
   *  goes on the wire (see notes on
   *  StateFrame). Ranking server-side also stops the display and the phones
   *  disagreeing about who is second. players[] itself stays in JOIN order —
   *  sorting it would reshuffle the lobby flock on every repaint. */
  rank: number;
  answered: boolean;
  connected: boolean;
  /** Always present: players[] contains only locked-in players. */
  look: Look;
}

/** Somebody who has joined and given a name but has not locked a look yet, so
 *  the lobby can draw a silhouette with a name under it instead of leaving them
 *  as a number in a sentence.
 *
 *  A SEPARATE ARRAY, not a flag on PublicPlayer, and that is not tidiness — the
 *  two lists are different lists with different rules and different lifetimes:
 *
 *  - players[] is the FLOCK. Every consumer of it, in every phase, assumes each
 *    row has a look to draw and a rank to stand on. Folding these people in
 *    would make `look` nullable for all of them and put the first surface that
 *    forgets the check one repaint away from drawing a colourless sheep on a
 *    television. It would also drag the still-choosing into the ranking, which
 *    has to stay a total order over exactly the people who are playing.
 *  - This list is DELETED at the gate. #start drops anyone still choosing,
 *    while players[] survives into the game. One array cannot have two
 *    lifetimes, so there are two.
 *
 *  Id and name, and deliberately nothing else. There is no look here, not even
 *  a partial one: what a phone is currently hovering over in the picker is that
 *  phone's own business until it locks in, and a colour that reached the TV
 *  before it was committed could be spoiled on the big screen and then lost to
 *  somebody else's claim (uniqueness is on the pair, and the loser of that race
 *  has to pick again). By definition these players have no look, so there is
 *  nothing to invent and nothing in progress to leak.
 */
export interface ChoosingPlayer {
  /** The same id the flock is keyed by, and that is its whole job: the display
   *  keys the silhouette on it and can swap that silhouette for the real sheep
   *  the moment this id appears in players[]. Nobody is ever in both arrays —
   *  they are exact complements of the roster — so the lobby renders one after
   *  the other with no dedupe and nobody drawn twice. */
  id: string;
  /** UNTRUSTED, exactly as in PublicPlayer: somebody typed it on a phone. The
   *  server only trims it and cuts it to length; escaping is the surface's job
   *  (tv.js has esc()). */
  name: string;
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
  /** Mirrors this player's PublicPlayer.streak. Duplicated for the same reason
   *  score is: the phone renders itself long before it renders the flock, and
   *  a phone that has to scan players[] for its own row gets it wrong exactly
   *  once — in the lobby, before it is in players[] at all. */
  streak: number;
  /** Mirrors this player's PublicPlayer.rank. The phone's score screen picks a
   *  pose from which THIRD of the field this rank falls in, so it needs its own
   *  place in the order, not just its score. Divide by players.length. */
  rank: number;
  /** This phone is the one holding the controls: it draws Start in the lobby
   *  and Continue on reveal and scores. Every other phone draws "Waiting for
   *  host" instead. Without it each phone would have to compare its own id to
   *  hostId, which is the same test written twenty times. */
  isHost: boolean;
  answered: boolean;
  look: Look | null;
  locked: boolean;
  /** Arrives only from the reveal phase onward, so nothing can leak early. */
  myGroupId: string | null;
  scoredThisRound: boolean;
}

/** The custom question set a lobby is armed with, echoed back so the display
 *  can show which pack the next game will draw from. Null = the main bank. */
export interface PackInfo {
  code: string;
  name: string;
  /** How many questions the resolved game will actually ask. */
  size: number;
}

/** Everything the grouping bar needs to fill itself without inventing numbers.
 *  The bar eases toward ~90% and waits there if the model is slow, so it needs
 *  a start and a budget, not a countdown: an interval it can be told is over at
 *  any moment. All three are epoch/duration ms because the phone that joins
 *  mid-phase must land on the bar already part-filled rather than at zero. */
export interface GroupingProgress {
  /** Epoch ms the grouping phase began. The bar's t=0. */
  startedAt: number;
  /** Epoch ms before which the room will NOT leave grouping, even if the
   *  answers came back instantly. The dog needs a run; a grouping screen that
   *  flashes past in 200ms reads as a bug. Enforced server-side — this is the
   *  wire copy so the bar can snap to 100% exactly when the phase ends rather
   *  than a frame later. */
  minUntil: number;
  /** How long grouping is EXPECTED to take, from the server's own API budget.
   *  The easing constant belongs to whoever knows the timeout; a hardcoded
   *  guess on the surfaces goes stale the day that budget changes. Not a
   *  deadline: overrunning it holds the bar, it does not fail anything. */
  expectedMs: number;
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
  /** Whoever holds the controls: the first player to lock in, and after that
   *  the first still-connected player in join order. Null only while nobody has
   *  locked in yet. Both surfaces need it — the display puts the HOST badge on
   *  that sheep in the lobby and names the person everyone is waiting for, and
   *  a phone with no hostId cannot tell "no host yet" from "not me". */
  hostId: string | null;
  /** The room is parked and there is a real, live host being waited on: true in
   *  the host-gated phases (reveal, scores) AND only while the phone named by
   *  hostId is actually connected. The display and every non-host phone render
   *  "Waiting for host" off this single flag rather than each re-deriving the
   *  gate from phase — and deriving it from phase alone was a lie: when the host
   *  has walked out, hostId still names them (it is left pointing at the person
   *  who left, on purpose) while the room is really running on its own timer, so
   *  both surfaces sat there naming somebody who was never coming back. False in
   *  that case means "nobody is holding this up"; the room advances on the
   *  fallback and, once succession has run, the flag comes back true under the
   *  new host's name. Deliberately NOT true in the lobby: the lobby has its own
   *  screen (code, QR, flock) and its own gate — the player minimum — which the
   *  surfaces compute from players[]. */
  awaitingHost: boolean;
  players: PublicPlayer[];
  /** Joined but still picking a look, so not yet part of the flock. Kept
   *  alongside the array below rather than left for the surfaces to derive with
   *  .length: the phone shows only the number and never draws the silhouettes,
   *  and outside the lobby the array is empty on purpose while this count keeps
   *  meaning what it always did. Both come off the same test server-side, so
   *  they cannot disagree — see #stateFor. */
  choosing: number;
  /** Those same people, named, in JOIN order — one silhouette each for the
   *  lobby to draw beside the flock, so a host watching four phones join does
   *  not read three sheep and a sentence.
   *
   *  LOBBY ONLY. Empty in every other phase, and empty rather than null so the
   *  render loop needs no guard — the surfaces already treat groups[] and
   *  noAnswer[] the same way. Two reasons it is not simply always sent: it is
   *  dead weight on every frame of every round for up to fifty players once the
   *  game is running, and after #start it could not be honest anyway, because
   *  the gate drops everyone who was still choosing. A non-empty array outside
   *  the lobby would be a claim about people who are no longer in the room.
   *
   *  Join order, and it matters: the lobby is repainted through innerHTML every
   *  time anybody joins or locks in, so a list that reordered itself would make
   *  the silhouettes swap places under the names. Same reason players[] is
   *  never sorted.
   *
   *  A player who joined and then dropped their socket is STILL HERE. There is
   *  no `connected` flag on these rows and they are not filtered out: their name
   *  is reserved against NAME_TAKEN and their seat counts against MAX_PLAYERS
   *  either way, so hiding them would show a lobby with a free space that is not
   *  free — and it would put the count and the array at odds, which is the one
   *  thing this pair must never do. */
  choosingPlayers: ChoosingPlayer[];
  groups: PublicGroup[];
  noAnswer: Array<{ playerId: string; name: string }>;
  scoreboardReason: ScoreboardReason | null;
  groupingSource: GroupingSource | null;
  /** Present only during the grouping phase; null everywhere else, so a bar
   *  left on screen by a missed frame has nothing to keep filling from. */
  groupingProgress: GroupingProgress | null;
  /** The armed custom set, or null for the main bank. */
  pack: PackInfo | null;
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
  | 'NOT_LOCKED'
  | 'NOT_HOST'
  | 'PACK_NOT_FOUND';

/* --- the rejoin token ------------------------------------------------------
 * A playerId is NOT a credential. It is on every state frame inside players[],
 * hostId names one of them out loud, and both go to the display and to every
 * phone in the room — so anything that authenticates on playerId alone
 * authenticates on a value the whole party can read. The room mints a second
 * value at join time that nobody else ever sees, and rejoin has to present it.
 *
 * The rules, and all three matter:
 *   1. Minted server-side on a successful player.join, stored on the player's
 *      record, and sent back in the `joined` frame — to THAT socket, once.
 *   2. It never appears in a state frame, never in players[], never in `you`,
 *      and never reaches the display, which has no business holding a
 *      credential for a phone. There is exactly one frame it rides on.
 *   3. player.rejoin must carry it. No token, or the wrong one, and the room
 *      does not attach that playerId to the socket — the socket stays anonymous
 *      rather than becoming somebody.
 */

export type ServerFrame =
  | { t: 'room.created'; room: string; joinUrl: string; qr: string }
  /** The one frame that carries the rejoin token, and it goes to the joining
   *  phone alone. The phone stores `token` next to the `playerId` it already
   *  keeps and sends both back on every player.rejoin; a phone that loses it
   *  cannot get back into that game, which is the point. */
  | { t: 'joined'; playerId: string; room: string; name: string; token: string }
  | StateFrame
  | { t: 'look.ok'; look: Look }
  /** Advisory only — the server still rejects a race. Keys are lookKey(). */
  | { t: 'look.taken'; taken: string[] }
  | { t: 'error'; code: ErrorCode; message: string };

/* --- client -> server ----------------------------------------------------- */

/* The prefix names the SENDER, not the authority: `host.*` is what the display
 * socket sends, `player.*` is what a phone sends. The game is now started and
 * advanced from the host's phone, so those two frames are `player.*` and the
 * display's old `host.start` is gone — the TV has no Start button to send it.
 * Host-ONLY-ness is not in the name; it is enforced by comparing the sending
 * socket's playerId to hostId, which is the only check that survives a phone
 * reconnecting or the host passing on. */
export type ClientFrame =
  | { t: 'host.create' }
  | { t: 'host.resume'; room: string }
  /** Arm (non-empty code) or clear (empty code) the lobby's custom set. */
  | { t: 'host.pack'; code: string }
  | { t: 'player.join'; room: string; name: string }
  /** Claiming an existing seat, which means proving it is yours: `token` is the
   *  secret minted for this playerId at join time and returned in the `joined`
   *  frame. Both fields are required. The server does not fall back to
   *  "playerId alone is good enough" for any record, ever — that fallback is
   *  the whole vulnerability, because hostId is published to everyone. */
  | { t: 'player.rejoin'; room: string; playerId: string; token: string }
  | { t: 'player.look'; colorId: string; hatId: string }
  | { t: 'player.answer'; text: string }
  /** The host's phone proving it is still running, sent on a timer while it
   *  holds the controls. This is NOT the heartbeat: `ping` is answered by
   *  setWebSocketAutoResponse and by design never wakes the Room, which is what
   *  made a frozen host indistinguishable from a thinking one. Only the lobby
   *  acts on it — every other phase has a deadline of its own — and a host who
   *  is simply taking their time keeps the controls, because their phone goes
   *  on sending while they do. */
  | { t: 'player.alive' }
  /** The host closing the lobby and starting the game. */
  | { t: 'player.start' }
  /** The host releasing a host-gated hold. `phase` is the phase the button was
   *  drawn on, and the server drops the frame unless the room is still in it:
   *  without that stamp an impatient double-tap on the reveal advances twice
   *  and skips the scoreboard the second tap was never meant to touch. */
  | { t: 'player.continue'; phase: HostGatedPhase };

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
