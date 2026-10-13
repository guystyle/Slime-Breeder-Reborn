import { describe, expect, it } from 'vitest';
import { fight } from './battle.ts';
import { breed, founderDna } from './dna.ts';
import { seeded } from './rng.ts';
import { deriveColor, deriveStats } from './stats.ts';

const strong = { weight: 250, hp: 270, stm: 210, str: 28, dex: 28, spd: 60 };
const weak = deriveStats(founderDna(seeded(1)));

describe('battle', () => {
  it('is deterministic for a seed and the stronger slime usually wins', () => {
    const a = fight('A', strong, 'B', weak, seeded(3));
    const b = fight('A', strong, 'B', weak, seeded(3));
    expect(a).toEqual(b);
    let wins = 0;
    for (let i = 0; i < 100; i++) if (fight('A', strong, 'B', weak, seeded(i)).winner === 'a') wins++;
    expect(wins).toBeGreaterThan(90);
  });

  it('log length equals the attacks attempted by both sides', () => {
    const r = fight('A', strong, 'B', strong, seeded(5));
    expect(r.log.replace(/ /g, '').length).toBe(r.a.attacks + r.b.attacks);
    expect(r.log).toMatch(/^[OXox ]+$/);
  });

  it('even fights are roughly 50/50', () => {
    let w = 0;
    for (let i = 0; i < 400; i++) if (fight('A', strong, 'B', strong, seeded(i + 1000)).winner === 'a') w++;
    expect(w).toBeGreaterThan(140);
    expect(w).toBeLessThan(260);
  });
});

describe('dna', () => {
  it('founders look like the original Eve: gray, ~50 weight', () => {
    const s = deriveStats(founderDna(seeded(2)));
    expect(s.weight).toBeGreaterThan(30);
    expect(s.weight).toBeLessThan(70);
    expect(deriveColor(founderDna(seeded(2)))).toBe('#7f7f7f');
  });

  it('mutation is unbiased: offspring get stronger as often as weaker', () => {
    const rng = seeded(11);
    const p = founderDna(rng);
    for (const t of Object.keys(p) as (keyof typeof p)[]) p[t] = [p[t][0], p[t][0]]; // homozygous parent
    let up = 0;
    let down = 0;
    const base = deriveStats(p).str;
    for (let i = 0; i < 3000; i++) {
      const c = deriveStats(breed(p, p, rng, 0.5)).str;
      if (c > base) up++;
      else if (c < base) down++;
    }
    expect(Math.abs(up - down) / (up + down)).toBeLessThan(0.15);
  });
});
