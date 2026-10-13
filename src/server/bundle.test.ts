import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Vercel function bundle', () => {
  it('api/[...path].js is up to date with src/server (run `npm run build:api` if this fails)', () => {
    const out = execFileSync('node', ['scripts/build-api.mjs', '--check'], { encoding: 'utf8' });
    expect(out).toContain('up to date');
  });
});
