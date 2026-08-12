/* The Worker: transport only.
 *
 * It owns routing, static assets and handing a socket to the right room. It
 * holds no game state whatsoever — that lives in the Room Durable Object,
 * because a Worker is stateless per request and a party is the opposite of
 * stateless. This is the same split the Node server had between server.js and
 * src/game.js, which is why the port is a re-housing rather than a redesign.
 */

import { Room, allocateRoom, ROOM_CODE_LENGTH } from './room';
import { QuestionBank } from './questions';

export { Room, QuestionBank };

/* The question editor writes state every room then plays from, on a public
 * workers.dev URL. It used to fail closed behind an ADMIN_TOKEN; that gate has
 * been removed by request, so /api/questions is now open to anyone who reaches
 * it. Put the token check back (see git history) if this URL ever leaks.
 */

/* The code alphabet and the claim loop moved to room.ts, next to claim() —
   which is the other half of allocating a paddock, and which now has a second
   caller: a room retiring itself in favour of a successor allocates that
   successor the same way this Worker opens a fresh one. One copy of the rule
   about which glyphs are safe to read off a television, in one place. */

const normaliseCode = (raw: string | null): string =>
  String(raw ?? '').trim().toUpperCase().slice(0, ROOM_CODE_LENGTH);

async function asset(env: Env, request: Request, path: string): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = path;
  url.search = '';
  return env.ASSETS.fetch(new Request(url, { headers: request.headers }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    /* --- the socket ---------------------------------------------------- */
    if (url.pathname === '/socket') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected a WebSocket upgrade.', { status: 426 });
      }

      const role = url.searchParams.get('role') === 'player' ? 'player' : 'display';
      let code = normaliseCode(url.searchParams.get('room'));

      /* A display with no room is opening a new paddock. A player with no room
         has mistyped or followed a stale link, and must be told so rather than
         silently handed a fresh empty room. */
      if (!code) {
        if (role === 'player') {
          return new Response('That join link is missing its room code.', { status: 400 });
        }
        const allocated = await allocateRoom(env);
        if (!allocated) {
          return new Response('Could not open a paddock. Try again.', { status: 503 });
        }
        code = allocated;
      }

      /* The room needs the public origin to build the join URL and QR, and it
         cannot see the request itself once the socket is hibernating. */
      const target = new URL(request.url);
      target.searchParams.set('room', code);
      target.searchParams.set('role', role);
      target.searchParams.set('origin', url.origin);

      return env.ROOM.getByName(code).fetch(new Request(target, request));
    }

    /* --- liveness ------------------------------------------------------ */
    if (url.pathname === '/healthz') {
      return Response.json({ ok: true, service: 'flock-together' });
    }

    /* --- the two surfaces ----------------------------------------------
       Neither is named index.html, so neither is reachable as a plain asset
       path; the Worker maps the route people actually use onto the file. */
    if (url.pathname === '/' || url.pathname === '/tv') {
      return asset(env, request, '/tv.html');
    }
    if (url.pathname === '/play') {
      return asset(env, request, '/play.html');
    }
    /* The hat bench. Not linked from anywhere the room can see, and it changes
       nothing on the server — it produces source you paste into the repo — so
       it needs no auth beyond being an address nobody guesses. */
    if (url.pathname === '/admin') {
      return asset(env, request, '/admin.html');
    }
    if (url.pathname === '/admin/questions') {
      return asset(env, request, '/questions.html');
    }

    /* --- the question bank ---------------------------------------------
       All of these are open, matching the editor: the ADMIN_TOKEN gate was
       removed by request. `?set=<id>` scopes reads and writes to one custom
       set; absent, they act on the main bank. */
    if (url.pathname === '/api/questions') {
      const bank = env.QUESTIONS.getByName('bank');
      const setId = url.searchParams.get('set');

      if (request.method === 'GET') {
        return Response.json(await bank.list(setId));
      }
      if (request.method === 'PUT') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'That was not JSON.' }, { status: 400 });
        }
        const result = await bank.replaceAll((body as { questions?: unknown })?.questions ?? body, setId);
        return Response.json(result, { status: 'error' in result ? 400 : 200 });
      }
      if (request.method === 'POST' && url.searchParams.get('reset') === 'seed') {
        return Response.json(await bank.resetToSeed());
      }
      return new Response('Method not allowed.', { status: 405 });
    }

    /* --- the default answer time --------------------------------------- */
    if (url.pathname === '/api/settings') {
      const bank = env.QUESTIONS.getByName('bank');
      if (request.method === 'GET') {
        return Response.json(await bank.getSettings());
      }
      if (request.method === 'PUT') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'That was not JSON.' }, { status: 400 });
        }
        const result = await bank.setSetting(body);
        return Response.json(result, { status: 'error' in result ? 400 : 200 });
      }
      return new Response('Method not allowed.', { status: 405 });
    }

    /* --- custom sets ---------------------------------------------------- */
    if (url.pathname === '/api/sets') {
      const bank = env.QUESTIONS.getByName('bank');
      if (request.method === 'GET') {
        return Response.json({ sets: await bank.listSets() });
      }
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return Response.json(await bank.createSet(body));
      }
      return new Response('Method not allowed.', { status: 405 });
    }

    if (url.pathname.startsWith('/api/sets/')) {
      const bank = env.QUESTIONS.getByName('bank');
      const id = decodeURIComponent(url.pathname.slice('/api/sets/'.length));
      if (!id) return new Response('Not found.', { status: 404 });

      if (request.method === 'PUT') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'That was not JSON.' }, { status: 400 });
        }
        const result = await bank.updateSetMeta(id, body);
        return Response.json(result, { status: 'error' in result ? 400 : 200 });
      }
      if (request.method === 'DELETE') {
        const result = await bank.deleteSet(id);
        return Response.json(result, { status: 'error' in result ? 400 : 200 });
      }
      return new Response('Method not allowed.', { status: 405 });
    }

    /* Everything else that reaches here matched no asset. */
    return new Response('Not found.', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
