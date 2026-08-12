/* Headless end-to-end game against a running Worker.
   Drives a full 2-round game through a custom set over real WebSockets:
   display + two phones, arm a pack, start, answer, and walk the phases to
   'final'. Exercises the ported round engine and the custom-set path together.

   Usage: node tools/smoke-game.mjs [wss-or-https-base]
   Default base: the deployed Worker. */

import WebSocket from 'ws';
import { FLEECE_COLOURS, HATS } from '../public/shared/look.js';

const RAW = process.argv[2] || 'https://flock-together.uxif-devhouse.workers.dev';
const HTTP = RAW.replace(/\/$/, '').replace(/^ws/, 'http');
const WSB = HTTP.replace(/^http/, 'ws') + '/socket';

let bad = 0;
const chk = (name, cond, extra = '') => {
  if (!cond) bad++;
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --- a tiny socket client --------------------------------------------------- */
function client(url, { onOpen } = {}) {
  const ws = new WebSocket(url);
  const c = { ws, frames: [], last: null, state: null, joined: null };
  ws.on('message', (data) => {
    let f;
    try { f = JSON.parse(data.toString()); } catch { return; }
    if (f.t === 'pong') return;
    c.frames.push(f);
    c.last = f;
    if (f.t === 'state') c.state = f;
    if (f.t === 'joined') c.joined = f;
  });
  ws.on('open', () => onOpen && onOpen(c));
  return c;
}
const send = (c, frame) => c.ws.readyState === WebSocket.OPEN && c.ws.send(JSON.stringify(frame));

async function waitFor(pred, label, ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return true;
    await sleep(120);
  }
  chk(`timeout waiting for ${label}`, false);
  return false;
}

async function main() {
  /* 1. A 2-question custom set, mode 'all', so the game is exactly 2 rounds. */
  const created = await (await fetch(HTTP + '/api/sets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Game Smoke' }),
  })).json();
  const setId = created.id;
  const code = created.code;
  await fetch(`${HTTP}/api/questions?set=${setId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions: [{ text: 'Say a colour.' }, { text: 'Say a number.' }] }),
  });
  chk('custom set created with a code', !!setId && /^[A-Z0-9]{6}$/.test(code), code);

  /* 2. The display opens a paddock. */
  const host = client(`${WSB}`, { onOpen: (c) => send(c, { t: 'host.create' }) });
  await waitFor(() => host.frames.some((f) => f.t === 'room.created'), 'room.created');
  const room = host.frames.find((f) => f.t === 'room.created').room;
  chk('display opened a paddock', !!room, room);

  /* 3. Arm the custom set on the lobby. */
  send(host, { t: 'host.pack', code });
  await waitFor(() => host.state && host.state.pack && host.state.pack.code === code, 'pack echoed');
  chk('pack armed on the lobby', host.state?.pack?.code === code, JSON.stringify(host.state?.pack));

  /* 4. Two phones join and lock a look each. */
  const looks = [
    { colorId: FLEECE_COLOURS[0].id, hatId: HATS[0].id },
    { colorId: FLEECE_COLOURS[1].id, hatId: HATS[0].id },
  ];
  const players = [];
  for (let i = 0; i < 2; i++) {
    const p = client(`${WSB}?room=${room}&role=player`, {
      onOpen: (c) => send(c, { t: 'player.join', room, name: `P${i + 1}` }),
    });
    await waitFor(() => p.joined, `P${i + 1} joined`);
    send(p, { t: 'player.look', colorId: looks[i].colorId, hatId: looks[i].hatId });
    await waitFor(() => p.state?.you?.locked, `P${i + 1} locked`);
    players.push(p);
  }
  await waitFor(() => (host.state?.players?.length ?? 0) === 2, 'two sheep in the flock');
  chk('two players locked into the flock', host.state?.players?.length === 2);

  /* 5. Start — from the HOST'S PHONE, not the display.
     The TV has no Start button any more: it opens the paddock and arms a pack,
     and that is the end of its authority. The first player to lock in holds the
     controls, and this test has to hold them too or the lobby never opens. */
  const hostPhone = players.find((p) => p.state?.you?.isHost);
  chk('a phone holds the controls', !!hostPhone,
    `hostId=${host.state?.hostId} isHost=${players.map((p) => p.state?.you?.isHost).join(',')}`);
  chk('the host is the first phone to lock in', hostPhone === players[0]);

  send(hostPhone, { t: 'player.start' });
  await waitFor(() => host.state?.phase === 'question', 'round 1 question');
  chk('game started on the custom set', host.state?.phase === 'question' && host.state?.totalRounds === 2,
    `phase=${host.state?.phase} totalRounds=${host.state?.totalRounds}`);

  /* Answer text must NEVER appear on the wire during the question phase. */
  const leaked = JSON.stringify(host.state).includes('__answer__');

  /* Reveal and scores no longer advance on their own — they wait for the host's
     Continue, so the room can talk over the answers for as long as it likes.
     A backstop alarm does eventually move a room whose host has gone silent,
     but it is two minutes: far longer than this test should sit, and waiting on
     it would be testing the backstop rather than the gate. So the test taps.

     The stamp matters. player.continue carries the phase the button was drawn
     on and the server drops it unless the room is still in that phase, which is
     what stops a double-tap on the reveal skipping the scoreboard behind it. */
  const release = async (phase) => {
    if (host.state?.phase !== phase) return;
    send(hostPhone, { t: 'player.continue', phase });
    await waitFor(() => host.state?.phase !== phase, `${phase} to release`, 15000);
  };

  const playRound = async (roundIndex, answer) => {
    await waitFor(() => host.state?.phase === 'question' && host.state?.roundIndex === roundIndex, `round ${roundIndex} question`);
    for (const p of players) send(p, { t: 'player.answer', text: answer });
    // all answered -> ~1.5s grace -> grouping (>= 5s floor) -> reveal
    await waitFor(() => host.state?.phase === 'reveal', `round ${roundIndex} reveal`, 25000);
    const g = host.state.groups || [];
    chk(`round ${roundIndex}: reveal has a scored group`, g.length >= 1 && g.some((x) => x.scored),
      `groups=${g.length}`);

    /* Out of the reveal, and out of the scoreboard behind it if this round
       raised one — the round is not over until the room is moving again. */
    await release('reveal');
    await release('scores');
  };

  await playRound(0, 'blue');
  await playRound(1, 'seven');

  /* 6. The game ends. */
  await waitFor(() => host.state?.phase === 'final', 'final', 25000);
  const top = Math.max(...(host.state.players || []).map((p) => p.score));
  chk('reached final', host.state?.phase === 'final');
  chk('both players scored every round (all agreed)', top === 2, `top score=${top}`);
  chk('no answer text leaked during the question phase', !leaked);
  chk('players saw their own round result', players.every((p) => p.state?.you?.score === 2),
    players.map((p) => p.state?.you?.score).join(','));

  /* 7. Cleanup. */
  host.ws.close();
  for (const p of players) p.ws.close();
  await fetch(`${HTTP}/api/sets/${setId}`, { method: 'DELETE' });

  console.log(bad ? `\n${bad} FAILED` : '\nfull game played end to end — all checks passed');
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
