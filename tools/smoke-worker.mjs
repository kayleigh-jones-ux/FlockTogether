/* End-to-end smoke test against a running Worker.
   Usage: node smoke.mjs http://127.0.0.1:8787
   Drives the real socket protocol: a display opens a paddock, two phones join,
   both pick a look, the second collides deliberately. */
import WebSocket from 'ws';

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const WSB = BASE.replace(/^http/, 'ws');

let bad = 0;
const chk = (name, cond, extra = '') => {
  if (!cond) bad++;
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
};

const openSocket = (path) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(WSB + path);
    const frames = [];
    ws.on('message', (d) => { try { frames.push(JSON.parse(d.toString())); } catch {} });
    ws.on('open', () => resolve({ ws, frames }));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('socket open timed out: ' + path)), 10000);
  });

const waitFor = async (conn, pred, ms = 6000) => {
  const started = Date.now();
  for (;;) {
    const hit = conn.frames.find(pred);
    if (hit) return hit;
    if (Date.now() - started > ms) return null;
    await new Promise((r) => setTimeout(r, 60));
  }
};

const send = (conn, frame) => conn.ws.send(JSON.stringify(frame));

/* --- HTTP --------------------------------------------------------------- */
const health = await fetch(BASE + '/healthz');
chk('/healthz responds', health.ok, String(health.status));
chk('/healthz names the service', (await health.json()).service === 'flock-together');

const tv = await fetch(BASE + '/');
const tvHtml = await tv.text();
chk('/ serves the display', tv.ok && tvHtml.includes('data-scene'), String(tv.status));

const play = await fetch(BASE + '/play');
const playHtml = await play.text();
chk('/play serves the phone', play.ok && playHtml.includes('screen-join'), String(play.status));

const asset = await fetch(BASE + '/shared/look.js');
const assetText = await asset.text();
chk('static assets serve from public/', asset.ok && assetText.includes('FLEECE_COLOURS'));
chk('the sprite sheet serves', (await fetch(BASE + '/shared/sprites.svg')).ok);

/* --- display opens a paddock -------------------------------------------- */
const display = await openSocket('/socket');
send(display, { t: 'host.create' });

const created = await waitFor(display, (f) => f.t === 'room.created');
chk('display is given a room code', !!created && /^[A-Z2-9]{4}$/.test(created.room || ''),
  created ? created.room : 'none');
const ROOM = created?.room;
chk('join URL points at /play with the code', !!created && created.joinUrl.includes('/play?room=' + ROOM),
  created ? created.joinUrl : '');

const lobby0 = await waitFor(display, (f) => f.t === 'state');
chk('display gets a lobby state', !!lobby0 && lobby0.phase === 'lobby');
chk('lobby starts empty', !!lobby0 && lobby0.players.length === 0 && lobby0.choosing === 0);

/* --- heartbeat ----------------------------------------------------------- */
send(display, { t: 'ping' });
const pong = await waitFor(display, (f) => f.t === 'pong', 3000);
chk('heartbeat is answered with pong, not an error', !!pong);
chk('heartbeat produced no error frame', !display.frames.some((f) => f.t === 'error'));

/* --- two phones join ----------------------------------------------------- */
const p1 = await openSocket(`/socket?room=${ROOM}&role=player`);
send(p1, { t: 'player.join', room: ROOM, name: 'Ama' });
const j1 = await waitFor(p1, (f) => f.t === 'joined');
chk('phone one joins', !!j1 && j1.name === 'Ama', j1 ? j1.playerId.slice(0, 8) : 'none');

const taken0 = await waitFor(p1, (f) => f.t === 'look.taken');
chk('phone one is sent the taken set on join', !!taken0 && Array.isArray(taken0.taken));

const afterJoin = await waitFor(display, (f) => f.t === 'state' && f.choosing === 1);
chk('display counts one player still choosing', !!afterJoin,
  afterJoin ? `choosing=${afterJoin.choosing} players=${afterJoin.players.length}` : 'never saw choosing=1');
chk('an unlocked player is NOT in the flock', !!afterJoin && afterJoin.players.length === 0);

const p2 = await openSocket(`/socket?room=${ROOM}&role=player`);
send(p2, { t: 'player.join', room: ROOM, name: 'Bex' });
chk('phone two joins', !!(await waitFor(p2, (f) => f.t === 'joined')));

/* --- looks --------------------------------------------------------------- */
send(p1, { t: 'player.look', colorId: 'meadow', hatId: 'propeller' });
const ok1 = await waitFor(p1, (f) => f.t === 'look.ok');
chk('phone one locks in a look', !!ok1 && ok1.look.hatId === 'propeller');

const locked = await waitFor(display, (f) => f.t === 'state' && f.players.length === 1);
chk('a locked player joins the flock', !!locked,
  locked ? `players=${locked.players.length} choosing=${locked.choosing}` : 'never appeared');
chk('the flock carries the look', !!locked && locked.players[0].look.colorId === 'meadow',
  locked ? JSON.stringify(locked.players[0].look) : '');

/* The whole point of the uniqueness rule. */
p2.frames.length = 0;
send(p2, { t: 'player.look', colorId: 'meadow', hatId: 'propeller' });
const clash = await waitFor(p2, (f) => f.t === 'error');
chk('an exact duplicate look is refused', !!clash && clash.code === 'LOOK_TAKEN',
  clash ? clash.code : 'no error');

/* Same colour, different hat — legal under pair uniqueness. */
p2.frames.length = 0;
send(p2, { t: 'player.look', colorId: 'meadow', hatId: 'ten-gallon' });
const ok2 = await waitFor(p2, (f) => f.t === 'look.ok');
chk('same colour with a different hat is allowed', !!ok2, ok2 ? '' : 'refused');

/* A hat that does not exist. */
p2.frames.length = 0;
send(p2, { t: 'player.look', colorId: 'meadow', hatId: 'sombrero' });
const badLook = await waitFor(p2, (f) => f.t === 'error');
chk('an invented hat is refused', !!badLook && badLook.code === 'BAD_LOOK', badLook ? badLook.code : 'none');

const both = await waitFor(display, (f) => f.t === 'state' && f.players.length === 2);
chk('both players are in the flock', !!both, both ? `players=${both.players.length}` : 'never');
chk('nobody is left choosing', !!both && both.choosing === 0);

/* --- durability: the room survives a fresh socket ------------------------ */
let display2 = null;
try {
  display2 = await openSocket(`/socket?room=${ROOM}`);
} catch (e) {
  chk('a reconnecting display can open a socket', false, e.message);
}
if (display2) {
  send(display2, { t: 'host.resume', room: ROOM });
  const resumed = await waitFor(display2, (f) => f.t === 'state');
  chk('a reconnecting display finds the same paddock', !!resumed && resumed.room === ROOM,
    resumed ? resumed.room : 'none');
  chk('the flock survived the reconnect', !!resumed && resumed.players.length === 2,
    resumed ? `players=${resumed.players.length}` : '');
}

/* --- a room that was never opened ---------------------------------------- */
let rejected = false;
try {
  await openSocket('/socket?room=ZZZZ&role=player');
} catch {
  rejected = true;
}
chk('a phone cannot join a paddock nobody opened', rejected);

for (const c of [display, display2, p1, p2]) if (c) c.ws.close();
console.log(bad ? `\n${bad} FAILED` : '\nall smoke checks passed');
process.exit(bad ? 1 : 0);
