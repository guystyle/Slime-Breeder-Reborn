import { afterAll, describe, expect, it } from 'vitest';
import { seeded } from '../shared/rng.ts';
import { createApp } from './app.ts';
import { GameError, REMEMBER_DAYS } from './service.ts';
import { cleanupGames, makeGame } from './testkit.ts';

afterAll(cleanupGames);

describe('remembered logins (service)', () => {
  it('lets a remembered device continue without the password', async () => {
    const { g } = await makeGame({ rng: seeded(1) });
    const { remember } = await g.enterRemember('alice', 'pw', true);
    expect(remember).toBeTruthy();
    expect(remember!.length).toBeGreaterThan(30);
    const again = await g.resume(remember!);
    expect(again.ok && again.mother.owner).toBe('alice');
    expect(await g.whoami(remember!)).toBe('alice');
  });

  it('issues no token unless asked, and rejects unknown ones', async () => {
    const { g } = await makeGame({ rng: seeded(2) });
    expect((await g.enterRemember('bob', 'pw', false)).remember).toBeNull();
    await expect(g.resume('nonsense')).rejects.toMatchObject({ code: 'no-login' });
    await expect(g.resume('')).rejects.toBeInstanceOf(GameError);
    expect(await g.whoami('nonsense')).toBeNull();
  });

  it('the database keeps only a hash of the token', async () => {
    const { g, db } = await makeGame({ rng: seeded(3) });
    const { remember } = await g.enterRemember('carol', 'pw', true);
    const rows = await db.all<{ token_hash: string }>('SELECT token_hash FROM remember');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toContain(remember!);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('still enforces the wait between plays, and says how long is left', async () => {
    let t = 5_000_000;
    const { g } = await makeGame({ rng: seeded(4), cooldownMin: 3, now: () => t });
    const { remember, res } = await g.enterRemember('dave', 'pw', true);
    if (!res.ok) throw new Error('enter');
    await g.mate(res.token, res.mates[0]!.id);
    await g.fight(res.token, 'D');
    t += 60_000;
    const err = (await g.resume(remember!).catch((e: unknown) => e)) as GameError;
    expect(err.code).toBe('cooldown');
    expect(err.params.leftSec).toBe(120);
    expect(await g.whoami(remember!)).toBe('dave'); // known even while waiting
    t += 121_000;
    await expect(g.resume(remember!)).resolves.toBeTruthy();
  });

  it('forgetting a device and expiry both end the login', async () => {
    let t = 1_000;
    const { g } = await makeGame({ rng: seeded(5), now: () => t });
    const a = (await g.enterRemember('erin', 'pw', true)).remember!;
    await g.forget(a);
    await expect(g.resume(a)).rejects.toMatchObject({ code: 'no-login' });
    const b = (await g.enterRemember('erin', 'pw', true)).remember!;
    t += (REMEMBER_DAYS + 1) * 86_400_000;
    await expect(g.resume(b)).rejects.toMatchObject({ code: 'no-login' });
  });

  it('use renews the 90 days (sliding expiry)', async () => {
    let t = 1_000;
    const { g } = await makeGame({ rng: seeded(6), now: () => t });
    const tok = (await g.enterRemember('fay', 'pw', true)).remember!;
    for (let i = 0; i < 3; i++) {
      t += 60 * 86_400_000;
      await expect(g.resume(tok)).resolves.toBeTruthy(); // 180 days in total, but never idle for 90
    }
  });

  it('only the newest five devices of an account stay logged in', async () => {
    let t = 1_000;
    const { g } = await makeGame({ rng: seeded(7), now: () => t });
    const tokens: string[] = [];
    for (let i = 0; i < 7; i++) {
      t += 1000;
      tokens.push((await g.enterRemember('gus', 'pw', true)).remember!);
    }
    expect(await g.whoami(tokens[0]!)).toBeNull();
    expect(await g.whoami(tokens[1]!)).toBeNull();
    expect(await g.whoami(tokens[6]!)).toBe('gus');
    expect(await g.whoami(tokens[2]!)).toBe('gus');
  });

  it('a wrong password never yields a token, and purged accounts lose theirs', async () => {
    let t = 0;
    const { g } = await makeGame({ rng: seeded(8), now: () => t });
    const tok = (await g.enterRemember('hal', 'pw', true)).remember!;
    await expect(g.enterRemember('hal', 'bad', true)).rejects.toMatchObject({ code: 'wrong-pass' });
    t = 30 * 86_400_000;
    await g.purgeInactive();
    expect(await g.whoami(tok)).toBeNull();
  });
});

describe('remembered logins (HTTP cookie)', () => {
  const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, cookie?: string, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) });
  const cookieOf = (res: Response) => res.headers.get('set-cookie') ?? '';

  it('sets an HttpOnly, SameSite=Lax cookie only when remembering, and Secure behind HTTPS', async () => {
    const { g } = await makeGame({ rng: seeded(9) });
    const app = createApp(async () => g);
    const plain = await post(app, '/api/enter', { user: 'ivy', pass: 'pw' });
    expect(cookieOf(plain)).toBe('');

    const local = await post(app, '/api/enter', { user: 'ivy', pass: 'pw', remember: true });
    const c1 = cookieOf(local);
    expect(c1).toMatch(/slime_remember=/);
    expect(c1).toMatch(/HttpOnly/i);
    expect(c1).toMatch(/SameSite=Lax/i);
    expect(c1).toMatch(/Max-Age=7776000/);
    expect(c1).not.toMatch(/Secure/i);

    const https = await post(app, '/api/enter', { user: 'ivy', pass: 'pw', remember: true }, undefined, { 'x-forwarded-proto': 'https' });
    expect(cookieOf(https)).toMatch(/Secure/i);
  });

  it('whoami, resume and logout work with the cookie', async () => {
    const { g } = await makeGame({ rng: seeded(10) });
    const app = createApp(async () => g);
    const login = await post(app, '/api/enter', { user: 'jay', pass: 'pw', remember: true });
    const cookie = cookieOf(login).split(';')[0]!;

    const me = (await (await app.request('/api/me', { headers: { cookie } })).json()) as { user: string | null };
    expect(me.user).toBe('jay');
    expect(((await (await app.request('/api/me')).json()) as { user: null }).user).toBeNull();

    const resumed = await post(app, '/api/resume', {}, cookie);
    expect(resumed.status).toBe(200);
    expect(((await resumed.json()) as { mother: { owner: string } }).mother.owner).toBe('jay');
    expect(cookieOf(resumed)).toMatch(/slime_remember=/); // refreshed

    await post(app, '/api/logout', {}, cookie);
    const after = await post(app, '/api/resume', {}, cookie);
    expect(after.status).toBe(400);
    expect(((await after.json()) as { code: string }).code).toBe('no-login');
    expect(cookieOf(after)).toMatch(/slime_remember=;|Max-Age=0|Expires=/i); // cleared
  });

  it('resume without a cookie is a clean error, and needs a JSON body', async () => {
    const { g } = await makeGame({ rng: seeded(11) });
    const app = createApp(async () => g);
    const res = await post(app, '/api/resume', {});
    expect(((await res.json()) as { code: string }).code).toBe('no-login');
    const bad = await app.request('/api/resume', { method: 'POST' });
    expect(((await bad.json()) as { code: string }).code).toBe('bad-request');
  });
});
