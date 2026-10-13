import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api.ts';

afterEach(() => vi.unstubAllGlobals());

const reply = (body: string, status = 200) => vi.stubGlobal('fetch', async () => new Response(body, { status }));

describe('api client errors', () => {
  it('turns a non-JSON platform error page into a readable error with the HTTP status', async () => {
    reply('<html><body>An error occurred with your deployment FUNCTION_INVOCATION_TIMEOUT</body></html>', 504);
    const err = (await api.rank().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('server');
    expect(err.detail).toContain('HTTP 504');
    expect(err.detail).toContain('FUNCTION_INVOCATION_TIMEOUT');
  });

  it('reports a dropped connection', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Load failed');
    });
    const err = (await api.rank().catch((e: unknown) => e)) as ApiError;
    expect(err.detail).toContain('Load failed');
  });

  it('keeps game errors translatable', async () => {
    reply(JSON.stringify({ ok: false, error: 'Wrong password.', code: 'wrong-pass', params: {} }), 400);
    const err = (await api.enter('a', 'b').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('wrong-pass');
  });

  it('passes good JSON through', async () => {
    reply(JSON.stringify({ slimes: [] }));
    expect(await api.rank()).toEqual({ slimes: [] });
  });
});
