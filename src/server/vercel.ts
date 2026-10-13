/**
 * Vercel entry. Bundled by scripts/build-api.mjs into api/[...path].js, a single
 * self-contained ESM file with a classic (req, res) Node handler.
 */
import { getRequestListener } from '@hono/node-server';
import { app } from './app.ts';

export default getRequestListener(app.fetch);
