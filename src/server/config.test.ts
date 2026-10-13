import { describe, expect, it } from 'vitest';
import { createApp, dbConfig, describeError } from './app.ts';
import { cleanupGames, makeGame } from './testkit.ts';
import { afterAll } from 'vitest';
import { seeded } from '../shared/rng.ts';

afterAll(cleanupGames);

describe('database configuration', () => {
  it('uses a local file by default and Turso when configured', () => {
    expect(dbConfig({}).url).toBe('file:slime.db');
    expect(dbConfig({ SLIME_DB: 'x.db' }).url).toBe('file:x.db');
    expect(dbConfig({ TURSO_DATABASE_URL: 'libsql://db-org.turso.io', TURSO_AUTH_TOKEN: 'tok' })).toEqual({ url: 'https://db-org.turso.io', authToken: 'tok' });
  });

  it('trims stray whitespace from pasted values', () => {
    expect(dbConfig({ TURSO_DATABASE_URL: '  libsql://a.turso.io\n', TURSO_AUTH_TOKEN: 'tok\n' })).toEqual({ url: 'https://a.turso.io', authToken: 'tok' });
  });

  it('on Vercel a missing database URL is a clear error, not a silent local file', () => {
    expect(() => dbConfig({ VERCEL: '1' })).toThrow(/TURSO_DATABASE_URL is not set/);
  });

  it('error text never contains secrets and is capped', () => {
    const msg = describeError(new Error('auth failed for token SECRET-TOKEN-123 ' + 'x'.repeat(500)), { TURSO_AUTH_TOKEN: 'SECRET-TOKEN-123' });
    expect(msg).not.toContain('SECRET-TOKEN-123');
    expect(msg.length).toBeLessThanOrEqual(300);
  });
});

describe('health endpoint', () => {
  it('reports a working database', async () => {
    const { g } = await makeGame();
    const app = createApp(async () => g);
    const res = await app.request('/api/health');
    const body = (await res.json()) as { ok: boolean; rankedSlimes: number };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rankedSlimes).toBeGreaterThan(0);
  });

  it('reports a failing database with the reason instead of a bare server error', async () => {
    const app = createApp(async () => {
      throw new Error('HTTP status 401: authentication failed');
    });
    const res = await app.request('/api/health');
    const body = (await res.json()) as { ok: boolean; stage: string; message: string };
    expect(res.status).toBe(500);
    expect(body.stage).toBe('database');
    expect(body.message).toContain('401');
    const api = await app.request('/api/rank');
    expect(((await api.json()) as { detail: string }).detail).toContain('401');
  });
});

describe('play interval setting', () => {
  it('defaults to 5 minutes and accepts 0 or other values', async () => {
    const { cooldownFromEnv } = await import('./app.ts');
    expect(cooldownFromEnv({})).toBe(5);
    expect(cooldownFromEnv({ SLIME_COOLDOWN_MIN: '0' })).toBe(0);
    expect(cooldownFromEnv({ SLIME_COOLDOWN_MIN: ' 2 ' })).toBe(2);
    expect(cooldownFromEnv({ SLIME_COOLDOWN_MIN: 'abc' })).toBe(5);
    expect(cooldownFromEnv({ SLIME_COOLDOWN_MIN: '-3' })).toBe(5);
  });

  it('is reported to clients by /api/config', async () => {
    const { g } = await makeGame({ cooldownMin: 7 });
    const res = await createApp(async () => g).request('/api/config');
    expect(((await res.json()) as { cooldownMin: number }).cooldownMin).toBe(7);
  });

  it('a game without an explicit value waits 5 minutes between plays', async () => {
    let t = 1_000_000;
    const { g } = await makeGame({ cooldownMin: undefined, now: () => t, rng: seeded(3) });
    expect(g.cooldownMin).toBe(5);
    const e = await g.enter('quick', 'pw');
    if (!e.ok) throw new Error('enter');
    await g.mate(e.token, e.mates[0]!.id);
    await g.fight(e.token, 'Q');
    t += 4 * 60_000;
    await expect(g.enter('quick', 'pw')).rejects.toThrow(/once per 5 minutes/);
    t += 2 * 60_000;
    await expect(g.enter('quick', 'pw')).resolves.toBeTruthy();
  });
});
