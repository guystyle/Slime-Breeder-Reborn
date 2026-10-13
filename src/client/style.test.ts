import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Guards against style blocks being lost in edits (the battle arena once vanished that way). */
describe('stylesheet', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  it.each(['.arena', '.fighter', '.bar-fill', '.confetti', '.stamp', '.hatch', '.badge', '.sprite-body', '.sprite-art', '.k-aura', '.logo .ch', '.statgrid', '#tabbar', '#more-sheet', 'max-width: 700px', '.shimmer'.replace('.', '@keyframes '), '.fade-up', '.float', '#frame-top', '#frame-bottom', '#divider', '.marquee', '.pink', '.cyan', '.yellow', '.rainbow', 'prefers-reduced-motion'])(
    'defines %s',
    (sel) => expect(css).toContain(sel),
  );
});

describe('stylesheet syntax', () => {
  it('has balanced braces (a stray brace once broke every rule)', () => {
    const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    for (const ch of css) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });
});
