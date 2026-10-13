/**
 * Smoke test against a REAL remote libSQL server (Turso or a local `sqld`), exercising the
 * same code path Vercel uses (the pure-JS HTTP client with interactive transactions).
 *
 *   TURSO_DATABASE_URL=http://127.0.0.1:8080 [TURSO_AUTH_TOKEN=...] npx tsx scripts/remote-smoke.ts
 *
 * It creates the schema, plays a few rounds through the HTTP API app and prints what it checked.
 * WARNING: it writes slimes and a test account to that database; point it at a scratch database.
 */
import { createApp, dbConfig, sharedGame } from '../src/server/app.ts';

const { url } = dbConfig();
if (url.startsWith('file:')) throw new Error('Set TURSO_DATABASE_URL to a remote (http/libsql) URL to run this smoke test.');

const app = createApp(sharedGame);
const call = async (path: string, body?: unknown) => {
  const res = await app.request(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json()) as Record<string, any>;
  return { status: res.status, data };
};
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`);
  if (!ok) process.exitCode = 1;
};

const t0 = Date.now();
const rank0 = await call('/api/rank');
check('ranking is seeded on first use', rank0.status === 200 && rank0.data.slimes.length >= 10, `${rank0.data.slimes.length} slimes`);

const user = `smoke${Date.now() % 100000}`;
const enter = await call('/api/enter', { user, pass: 'pw' });
check('register + enter', enter.status === 200 && enter.data.ok === true);
const token = enter.data.token as string;

const wrong = await call('/api/enter', { user, pass: 'nope' });
check('wrong password is rejected with a code', wrong.status === 400 && wrong.data.code === 'wrong-pass');

const mate = await call('/api/mate', { token, sel: enter.data.mates[0].id });
check('mate creates a newborn (transaction + batch)', mate.status === 200 && !!mate.data.child?.id);
const bad = await call('/api/mate', { token, sel: 1 });
check('second mate while a newborn waits is refused and rolled back', bad.status === 400 && bad.data.code === 'pending');

const fight = await call('/api/fight', { token, name: 'RemoteHero' });
check('fight runs the ladder', fight.status === 200 && fight.data.steps.length > 0, `${fight.data.steps?.length} rounds, rank ${fight.data.finalRank}`);

const rank1 = await call('/api/rank');
check('ladder persisted', rank1.data.slimes.length >= rank0.data.slimes.length);
const lin = await call('/api/lineages');
check('lineage census', lin.status === 200 && lin.data.lineages.length > 0, `${lin.data.lineages.length} lineages`);
const nix = await call(`/api/nix?token=${token}`);
check('compatibility table', nix.status === 200 && nix.data.rows.length > 0);

// the unknown-seed path writes a lineage row inside the transaction
const e2 = await call('/api/enter', { user: `${user}b`, pass: 'pw' });
const unknown = await call('/api/mate', { token: e2.data.token, sel: 'no' });
const named = await call('/api/fight', { token: e2.data.token, name: 'RemotePioneer' });
check('unknown seed founds a lineage', unknown.status === 200 && named.data.slime.lineage[3].name === 'RemotePioneer');

const say = await call('/api/comments', { user: 'smoke', text: 'hello from the smoke test' });
const cm = await call('/api/comments');
check('comments', say.status === 200 && cm.data.comments[0].text.includes('smoke test'));
console.log(`done in ${Date.now() - t0} ms against ${url}`);
