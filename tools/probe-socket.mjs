/* Why did an upgrade fail? `ws` throws away the response body, which is exactly
   where the reason lives, and fetch() refuses to send an Upgrade header. So do
   the handshake with the raw http client, which surfaces both. */
import https from 'node:https';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8787');
const client = base.protocol === 'https:' ? https : http;

function upgrade(path) {
  return new Promise((resolve) => {
    const req = client.request({
      hostname: base.hostname,
      port: base.port || (base.protocol === 'https:' ? 443 : 80),
      path,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res) => {
      console.log(`${path.padEnd(36)} 101 upgraded`);
      res.socket.destroy();
      resolve();
    });
    req.on('response', (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        console.log(`${path.padEnd(36)} ${res.statusCode}  ${body.slice(0, 150).replace(/\s+/g, ' ')}`);
        resolve();
      });
    });
    req.on('error', (e) => { console.log(`${path.padEnd(36)} ERR ${e.message}`); resolve(); });
    req.end();
  });
}

/* Ask about a room that genuinely exists. */
const ws = new WebSocket(base.origin.replace(/^http/, 'ws') + '/socket');
const room = await new Promise((resolve, reject) => {
  ws.on('message', (d) => {
    const f = JSON.parse(d.toString());
    if (f.t === 'room.created') resolve(f.room);
  });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'host.create' })));
  ws.on('error', reject);
  setTimeout(() => reject(new Error('no room.created')), 15000);
});
console.log('opened room', room, '(socket held open)\n');

await upgrade('/socket');
await upgrade(`/socket?room=${room}`);
await upgrade(`/socket?room=${room}&role=display`);
await upgrade(`/socket?room=${room}&role=player`);
await upgrade('/socket?room=ZZZZ&role=player');
ws.close();
