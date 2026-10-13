/** Self-hosted server: the API plus the built client from ./dist. (On Vercel the API runs from api/ instead.) */
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { serve } from '@hono/node-server';
import { app, sharedGame } from './app.ts';

const PORT = Number(process.env.PORT ?? 3000);

const game = await sharedGame();
await game.purgeInactive();
setInterval(() => void game.purgeInactive().catch((e) => console.error(e)), 3_600_000).unref();

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
