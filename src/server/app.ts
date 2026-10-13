import { Hono } from 'hono';
import { initSchema } from './db.ts';
import { Game, GameError } from './service.ts';
import { openDb } from './store.ts';

/**
 * Where the data lives. Remote Turso when TURSO_DATABASE_URL is set (Vercel),
 * otherwise a local SQLite file (SLIME_DB, default ./slime.db).
 */
export function dbConfig(env: Record<string, string | undefined> = process.env) {
  const url = env.TURSO_DATABASE_URL || `file:${env.SLIME_DB ?? 'slime.db'}`;
  return { url, authToken: env.TURSO_AUTH_TOKEN };
}

let shared: Promise<Game> | null = null;

/** One Game per process; created lazily so cold starts only pay once. A failed start is retried on the next request. */
export function sharedGame(): Promise<Game> {
  shared ??= (async () => {
    const { url, authToken } = dbConfig();
    const db = await openDb(url, authToken);
    await initSchema(db);
    return Game.create(db, { cooldownMin: Number(process.env.SLIME_COOLDOWN_MIN ?? 15) });
  })().catch((e) => {
    shared = null;
    throw e;
  });
  return shared;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function createApp(getGame: () => Promise<Game> = sharedGame): Hono {
  const app = new Hono();

  const body = async (c: { req: { json: () => Promise<unknown> } }) => {
    try {
      return ((await c.req.json()) ?? {}) as Record<string, unknown>;
    } catch {
      throw new GameError('bad-request');
    }
  };

  app.onError((e, c) => {
    if (e instanceof GameError) return c.json({ ok: false, error: e.message, code: e.code, params: e.params }, 400);
    console.error(e);
    return c.json({ ok: false, error: 'Server error.', code: 'server', params: {} }, 500);
  });

  app.post('/api/enter', async (c) => {
    const b = await body(c);
    return c.json(await (await getGame()).enter(str(b.user), str(b.pass)));
  });
  app.post('/api/mate', async (c) => {
    const b = await body(c);
    return c.json(await (await getGame()).mate(str(b.token), b.sel === 'no' ? 'no' : Number(b.sel)));
  });
  app.post('/api/fight', async (c) => {
    const b = await body(c);
    return c.json(await (await getGame()).fight(str(b.token), str(b.name)));
  });
  app.get('/api/rank', async (c) => c.json({ slimes: await (await getGame()).ranking() }));
  app.get('/api/lineages', async (c) => c.json({ lineages: await (await getGame()).lineages() }));
  app.get('/api/lineage/:no', async (c) => c.json(await (await getGame()).lineage(Number(c.req.param('no')), c.req.query('token') || undefined)));
  app.get('/api/nix', async (c) => c.json(await (await getGame()).nixTable(c.req.query('token') ?? '')));
  app.get('/api/title-matches', async (c) => c.json({ matches: await (await getGame()).titleMatches() }));
  app.get('/api/hall', async (c) => c.json({ entries: await (await getGame()).hall() }));
  app.get('/api/comments', async (c) => c.json({ comments: await (await getGame()).comments() }));
  app.post('/api/comments', async (c) => {
    const b = await body(c);
    await (await getGame()).addComment(str(b.user), str(b.text));
    return c.json({ ok: true });
  });

  // Daily housekeeping for serverless hosting (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`).
  app.get('/api/cron/purge', async (c) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) return c.json({ ok: false, code: 'not-found' }, 404);
    return c.json({ ok: true, purged: await (await getGame()).purgeInactive() });
  });

  return app;
}

export const app = createApp();
