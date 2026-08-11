/* Shared WebSocket transport for both surfaces.
   Reconnects with backoff, keeps a heartbeat, and replays an identity frame
   so a phone that locks its screen mid-round rejoins its own flock. */

export function connect({ onFrame, onStatus, identify } = {}) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/socket`;

  let socket = null;
  let heartbeat = null;
  let retryAt = 400;
  let closed = false;

  const status = (s) => onStatus && onStatus(s);

  function open() {
    if (closed) return;
    status('connecting');
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      retryAt = 400;
      status('open');
      heartbeat = setInterval(() => send({ t: 'ping' }), 25000);
      const frame = identify && identify();
      if (frame) send(frame);
    });

    socket.addEventListener('message', (ev) => {
      let frame;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        return; // a frame we cannot parse is a frame we ignore
      }
      if (frame && frame.t === 'pong') return;
      onFrame && onFrame(frame);
    });

    socket.addEventListener('close', () => {
      clearInterval(heartbeat);
      if (closed) return;
      status('reconnecting');
      setTimeout(open, retryAt);
      retryAt = Math.min(retryAt * 1.8, 6000);
    });

    socket.addEventListener('error', () => socket && socket.close());
  }

  function send(frame) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
      return true;
    }
    return false;
  }

  open();
  return { send, close: () => { closed = true; clearInterval(heartbeat); socket && socket.close(); } };
}

/* Load the authored sprite sheet once so <use href="#sp-…"> resolves. */
export async function loadSprites(src = '/shared/sprites.svg') {
  try {
    const res = await fetch(src);
    if (!res.ok) return;
    const host = document.createElement('div');
    host.style.display = 'none';
    host.innerHTML = await res.text();
    document.body.prepend(host);
  } catch {
    /* Sprites are decoration for state that is also carried by text. */
  }
}

/* A countdown the client owns, driven off the server's absolute endsAt so a
   slow frame never desynchronises the room. */
export function countdown(endsAt, onTick) {
  let raf = null;
  let lastWhole = null;
  const tick = () => {
    const msLeft = Math.max(0, endsAt - Date.now());
    const whole = Math.ceil(msLeft / 1000);
    if (whole !== lastWhole) {
      lastWhole = whole;
      onTick(whole, msLeft);
    }
    if (msLeft > 0) raf = requestAnimationFrame(tick);
  };
  tick();
  return () => raf && cancelAnimationFrame(raf);
}
