import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Guards against style blocks being lost in edits (the battle arena once vanished that way). */
describe('stylesheet', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  it.each(['.arena', '.fighter', '.bar-fill', '.confetti', '.stamp', '.hatch', '.badge', '.sprite-body', '.sprite-art', '.k-aura', '.logo .ch', '.shimmer'.replace('.', '@keyframes '), '.fade-up', '.float', '#frame-top', '#frame-bottom', '#divider', '.marquee', '.pink', '.cyan', '.yellow', '.rainbow', 'prefers-reduced-motion'])(
    'defines %s',
    (sel) => expect(css).toContain(sel),
  );
});
