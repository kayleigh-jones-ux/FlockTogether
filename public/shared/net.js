/* Shared WebSocket transport for both surfaces.
   Reconnects with backoff, keeps a heartbeat, and replays an identity frame
   so a phone that locks its screen mid-round rejoins its own flock. */

/* `query` supplies the socket's URL parameters and is re-evaluated on every
   open, including reconnects.
 *
 * It exists because of where the two runtimes decide which room you are in. The
 * Node server took one socket for the whole process and routed each frame by
 * the room named inside it. A Durable Object is chosen from the URL BEFORE the
 * first frame arrives, so by the time `player.join` is sent it is far too late
 * to say which paddock it meant — the socket is already attached to one.
 *
 * Returning null from `query` means "there is nothing to connect to yet": the
 * socket stays shut rather than opening against the wrong room, and `reconnect`
 * opens it once the room is known. A phone that typed its code by hand has no
 * room at load and gets one at submit, which is exactly that case. */
export function connect({ onFrame, onStatus, identify, query } = {}) {
  const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/socket`;

  let socket = null;
  let heartbeat = null;
  let retryAt = 400;
  let closed = false;

  const status = (s) => onStatus && onStatus(s);

  function socketUrl() {
    if (!query) return base;
    const params = query();
    if (!params) return null;
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined && v !== '') search.set(k, String(v));
    }
    const qs = search.toString();
    return qs ? `${base}?${qs}` : base;
  }

  function open() {
    if (closed) return;
    const url = socketUrl();
    if (!url) {
      status('idle');
      return;
    }
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
  return {
    send,
    /* Re-evaluate `query` and attach to whatever room it now names. Closing the
       old socket first matters: the room it was attached to is a different
       object entirely, and leaving it open would keep a phantom player in a
       paddock nobody is looking at. */
    reconnect() {
      if (closed) return;
      retryAt = 400;
      if (socket) {
        const stale = socket;
        socket = null;
        clearInterval(heartbeat);
        stale.onclose = null;
        stale.close();
      }
      open();
    },
    close: () => { closed = true; clearInterval(heartbeat); socket && socket.close(); },
  };
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
