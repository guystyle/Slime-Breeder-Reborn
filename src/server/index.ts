import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { openDb } from './db.ts';
import { Game, GameError } from './service.ts';

const PORT = Number(process.env.PORT ?? 3000);
const db = openDb(process.env.SLIME_DB ?? 'slime.db');
const game = new Game(db, { cooldownMin: Number(process.env.SLIME_COOLDOWN_MIN ?? 15) });
game.purgeInactive();
setInterval(() => game.purgeInactive(), 3_600_000).unref();

const app = new Hono();

const body = async (c: { req: { json: () => Promise<unknown> } }) => {
  try {
    return ((await c.req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    throw new GameError('bad-request');
  }
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');

app.onError((e, c) => {
  if (e instanceof GameError) return c.json({ ok: false, error: e.message, code: e.code, params: e.params }, 400);
  console.error(e);
  return c.json({ ok: false, error: 'Server error.', code: 'server', params: {} }, 500);
});

app.post('/api/enter', async (c) => {
  const b = await body(c);
  return c.json(game.enter(str(b.user), str(b.pass)));
});
app.post('/api/mate', async (c) => {
  const b = await body(c);
  return c.json(game.mate(str(b.token), b.sel === 'no' ? 'no' : Number(b.sel)));
});
app.post('/api/fight', async (c) => {
  const b = await body(c);
  return c.json(game.fight(str(b.token), str(b.name)));
});
app.get('/api/rank', (c) => c.json({ slimes: game.ranking() }));
app.get('/api/lineages', (c) => c.json({ lineages: game.lineages() }));
app.get('/api/lineage/:no', (c) => c.json(game.lineage(Number(c.req.param('no')), c.req.query('token') || undefined)));
app.get('/api/nix', (c) => c.json(game.nixTable(c.req.query('token') ?? '')));
app.get('/api/title-matches', (c) => c.json({ matches: game.titleMatches() }));
app.get('/api/hall', (c) => c.json({ entries: game.hall() }));
app.get('/api/comments', (c) => c.json({ comments: game.comments() }));
app.post('/api/comments', async (c) => {
  const b = await body(c);
  game.addComment(str(b.user), str(b.text));
  return c.json({ ok: true });
});

// Serve the built client (npm run build) when present.
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
};
app.get('*', async (c) => {
  const rel = normalize(c.req.path).replace(/^(\.\.[/\\])+/, '');
  const file = rel === '/' || !extname(rel) ? 'index.html' : rel;
  try {
    const data = await readFile(join('dist', file));
    return c.body(data, 200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  } catch {
    return c.text('Not found. Run `npm run build` first.', 404);
  }
});

serve({ fetch: app.fetch, port: PORT }, (i) => console.log(`Slime Breeder on http://localhost:${i.port}`));
