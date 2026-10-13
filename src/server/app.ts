import { Hono } from 'hono';
import { DEFAULT_COOLDOWN_MIN } from '../shared/ladder.ts';
import { initSchema } from './db.ts';
import { Game, GameError } from './service.ts';
import { openDb } from './store.ts';

/**
 * Where the data lives. Remote Turso when TURSO_DATABASE_URL is set (Vercel),
 * otherwise a local SQLite file (SLIME_DB, default ./slime.db).
 */
export function dbConfig(env: Record<string, string | undefined> = process.env) {
  const raw = (env.TURSO_DATABASE_URL ?? '').trim();
  if (!raw && env.VERCEL) {
    throw new Error(
      'TURSO_DATABASE_URL is not set for this deployment. Add it (and TURSO_AUTH_TOKEN) under Vercel > Settings > Environment Variables for the Production environment, then redeploy.',
    );
  }
  // libsql:// is the dashboard's spelling; the serverless client speaks plain HTTPS
  const url = (raw || `file:${env.SLIME_DB ?? 'slime.db'}`).replace(/^libsql:\/\//, 'https://');
  return { url, authToken: env.TURSO_AUTH_TOKEN?.trim() || undefined };
}

/** SLIME_COOLDOWN_MIN, falling back to the default when unset or not a non-negative number. */
export function cooldownFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.SLIME_COOLDOWN_MIN?.trim();
  if (!raw) return DEFAULT_COOLDOWN_MIN;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_COOLDOWN_MIN;
}

/** Error text that is safe to show: secrets removed, length capped. */
export function describeError(e: unknown, env: Record<string, string | undefined> = process.env): string {
  let msg = e instanceof Error ? e.message : String(e);
  for (const secret of [env.TURSO_AUTH_TOKEN, env.CRON_SECRET]) if (secret && secret.length > 4) msg = msg.split(secret.trim()).join('***');
  return msg.slice(0, 300);
}

let shared: Promise<Game> | null = null;

/** One Game per process; created lazily so cold starts only pay once. A failed start is retried on the next request. */
export function sharedGame(): Promise<Game> {
  shared ??= (async () => {
    const { url, authToken } = dbConfig();
    const db = await openDb(url, authToken);
    await initSchema(db);
    return Game.create(db, { cooldownMin: cooldownFromEnv() });
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

  // API answers are never cached (phones and proxies would otherwise show stale rankings)
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.onError((e, c) => {
    if (e instanceof GameError) return c.json({ ok: false, error: e.message, code: e.code, params: e.params }, 400);
    console.error(e);
    return c.json({ ok: false, error: 'Server error.', code: 'server', params: {}, detail: describeError(e) }, 500);
  });

  // Quick diagnosis for deployments: open /api/health in the browser.
  app.get('/api/health', async (c) => {
    let cfg: ReturnType<typeof dbConfig>;
    try {
      cfg = dbConfig();
    } catch (e) {
      return c.json({ ok: false, stage: 'config', message: describeError(e) }, 500);
    }
    try {
      const g = await getGame();
      const slimes = (await g.ranking()).length;
      let host = 'local file';
      if (!cfg.url.startsWith('file:')) host = new URL(cfg.url).host;
      return c.json({ ok: true, database: cfg.url.startsWith('file:') ? 'file' : 'remote', host, hasToken: !!cfg.authToken, rankedSlimes: slimes });
    } catch (e) {
      return c.json({ ok: false, stage: 'database', host: cfg.url.startsWith('file:') ? 'local file' : new URL(cfg.url).host, hasToken: !!cfg.authToken, message: describeError(e) }, 500);
    }
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
  // public settings the client needs to explain the rules
  app.get('/api/config', async (c) => c.json({ cooldownMin: (await getGame()).cooldownMin }));
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
