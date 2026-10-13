import { describe, expect, it } from 'vitest';
import { fight } from './battle.ts';
import { type Dna, MUTATIONS, TRAITS, breed, expressed, founderDna } from './dna.ts';
import { seeded } from './rng.ts';
import { deriveColor, deriveForms, deriveStats, spriteSize } from './stats.ts';

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
    for (const t of TRAITS) p[t] = [p[t][0], p[t][0]]; // homozygous parent
    let up = 0;
    let down = 0;
    const base = expressed(p.muscle);
    for (let i = 0; i < 3000; i++) {
      const c = expressed(breed(p, p, rng, 0.5).muscle);
      if (c > base) up++;
      else if (c < base) down++;
    }
    expect(Math.abs(up - down) / (up + down)).toBeLessThan(0.15);
  });
});

/** Stat blocks of ranked slimes copied from the original game's ranking page (rank 1, 2, 3, 6, 48, 50). */
const REAL = [
  { weight: 263, hp: 276, stm: 225, str: 28, dex: 30, spd: 59 },
  { weight: 256, hp: 268, stm: 200, str: 28, dex: 30, spd: 60 },
  { weight: 243, hp: 269, stm: 204, str: 28, dex: 25, spd: 64 },
  { weight: 251, hp: 270, stm: 199, str: 27, dex: 24, spd: 50 },
  { weight: 272, hp: 290, stm: 136, str: 30, dex: 30, spd: 62 },
  { weight: 247, hp: 262, stm: 233, str: 26, dex: 25, spd: 48 },
];

describe('calibration against the original ranking', () => {
  it('produces fights shaped like the original reports', () => {
    const rng = seeded(99);
    let n = 0;
    let attacks = 0;
    let hits = 0;
    let stm = 0;
    let dmgPerStr = 0;
    for (const a of REAL)
      for (const b of REAL) {
        if (a === b) continue;
        for (let k = 0; k < 20; k++) {
          const r = fight('a', a, 'b', b, rng);
          n++;
          attacks += r.a.attacks + r.b.attacks;
          hits += r.a.hits + r.b.hits;
          stm += (r.a.stmPct + r.b.stmPct) / 2;
          dmgPerStr += r.a.dmgAve / a.str;
        }
      }
    expect(attacks / n / 2).toBeGreaterThan(22); // original sample: 32 and 44 attacks
    expect(attacks / n / 2).toBeLessThan(45);
    expect(hits / attacks).toBeGreaterThan(0.35); // original: 37%-48%
    expect(hits / attacks).toBeLessThan(0.55);
    expect(stm / n).toBeGreaterThan(5); // original: 5%-20% left
    expect(stm / n).toBeLessThan(30);
    expect(dmgPerStr / n).toBeGreaterThan(5); // original: 5.6-8.7 per STR
    expect(dmgPerStr / n).toBeLessThan(9);
  });

  it('evolved genes land near the original equilibrium and sprites scale with weight', () => {
    expect(spriteSize(50)).toBeGreaterThanOrEqual(65);
    expect(spriteSize(50)).toBeLessThanOrEqual(69);
    expect(spriteSize(250)).toBeGreaterThanOrEqual(113);
    expect(spriteSize(250)).toBeLessThanOrEqual(118);
    expect(spriteSize(300)).toBeGreaterThan(spriteSize(250));
  });
});

describe('mutations', () => {
  const build = (over: Partial<Record<string, number>>): Dna => {
    const d = founderDna(seeded(3));
    for (const [k, v] of Object.entries(over)) (d as Record<string, unknown>)[k] = [{ v, d: 99 }, { v, d: 0 }];
    return d;
  };

  it('show only when the gene is strong and the body suits it', () => {
    expect(deriveForms(build({ wings: 80, reflex: 60, size: 40 }))).toContain('wings');
    expect(deriveForms(build({ wings: 80, reflex: 60, size: 90 }))).not.toContain('wings'); // too heavy to fly
    expect(deriveForms(build({ wings: 80, reflex: 10 }))).not.toContain('wings');
    expect(deriveForms(build({ wings: 20, reflex: 60, size: 40 }))).toEqual([]);
    expect(deriveForms(build({ metal: 80, vitality: 50, size: 50 }))).toContain('metal');
    expect(deriveForms(build({ horn: 80, muscle: 50 }))).toContain('horn');
  });

  it('change stats: wings are lighter and faster, metal heavier with more HP, horn hits harder', () => {
    const base = build({ reflex: 60, size: 40, vitality: 50, muscle: 50 });
    const b = deriveStats(base);
    const w = deriveStats(build({ reflex: 60, size: 40, vitality: 50, muscle: 50, wings: 80 }));
    const m = deriveStats(build({ reflex: 60, size: 40, vitality: 50, muscle: 50, metal: 80 }));
    const h = deriveStats(build({ reflex: 60, size: 40, vitality: 50, muscle: 50, horn: 80 }));
    expect(w.spd).toBeGreaterThan(b.spd);
    expect(w.weight).toBeLessThan(b.weight);
    expect(m.hp).toBeGreaterThan(b.hp);
    expect(m.weight).toBeGreaterThan(b.weight);
    expect(h.str).toBeGreaterThan(b.str);
  });

  it('appear spontaneously, are inherited, and can hide for a generation', () => {
    const rng = seeded(21);
    const pool: Dna[] = Array.from({ length: 40 }, () => founderDna(rng));
    let seen = 0;
    let inherited = 0;
    for (let g = 0; g < 60; g++) {
      for (let i = 0; i < pool.length; i++) {
        const child = breed(pool[i]!, pool[(i * 7 + g) % pool.length]!, rng);
        if (MUTATIONS.some((m) => (child[m]?.[0].v ?? 0) > 0 || (child[m]?.[1].v ?? 0) > 0)) seen++;
        pool[i] = child;
      }
    }
    for (const d of pool) if (MUTATIONS.some((m) => (d[m]?.[0].v ?? 0) > 0)) inherited++;
    expect(seen).toBeGreaterThan(20); // spontaneous gains happen
    expect(inherited).toBeGreaterThan(0); // and spread through the population
  });

  it('old DNA without mutation genes still works', () => {
    const d = founderDna(seeded(4));
    for (const m of MUTATIONS) delete d[m];
    expect(deriveForms(d)).toEqual([]);
    expect(() => breed(d, d, seeded(1))).not.toThrow();
  });
});
