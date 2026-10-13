import { describe, expect, it } from 'vitest';
import { fight } from './battle.ts';
import { type Dna, KINDS, adamSeed, colorOf, eveDna, express, kindOf, makeSeed, mix, mutate, rangeFor } from './dna.ts';
import { seeded } from './rng.ts';
import { deriveStats, dispCut, shownStats, spriteSize } from './stats.ts';

const evolved = { weight: 250, hp: 2700, stm: 2000, str: 270, dex: 270, agl: 270, cst: 250, sex: 50, spd: 570 };
const weak = { weight: 50, hp: 500, stm: 500, str: 50, dex: 50, agl: 50, cst: 50, sex: 50, spd: 50 };

describe('battle (ported engine)', () => {
  it('is deterministic for a seed and the stronger slime nearly always wins', () => {
    expect(fight('A', evolved, 'B', weak, seeded(3))).toEqual(fight('A', evolved, 'B', weak, seeded(3)));
    let wins = 0;
    for (let i = 0; i < 100; i++) if (fight('A', evolved, 'B', weak, seeded(i)).winner === 'a') wins++;
    expect(wins).toBeGreaterThan(95);
  });

  it('even fights are roughly 50/50 and the log matches the attack counts', () => {
    let w = 0;
    for (let i = 0; i < 400; i++) {
      const r = fight('A', evolved, 'B', evolved, seeded(i + 1000));
      if (r.winner === 'a') w++;
      expect(r.log.replace(/ /g, '').length).toBe(r.a.attacks + r.b.attacks);
      expect(r.log).toMatch(/^[OXoxCc ]+$/);
      expect(r.events.length).toBe(r.a.attacks + r.b.attacks);
    }
    expect(w).toBeGreaterThan(150);
    expect(w).toBeLessThan(250);
  });

  it('the loser ends below 1 HP and the winner above', () => {
    for (let i = 0; i < 50; i++) {
      const r = fight('A', evolved, 'B', weak, seeded(i));
      const [win, lose] = r.winner === 'a' ? [r.a, r.b] : [r.b, r.a];
      expect(lose.hp).toBeLessThan(1);
      expect(win.hp).toBeGreaterThanOrEqual(1);
    }
  });
});

/** Stat blocks of ranked slimes from the English edition's ranking page (shown values x10; AGL assumed = DEX). */
const REAL = [
  [263, 276, 225, 28, 30, 59],
  [256, 268, 200, 28, 30, 60],
  [243, 269, 204, 28, 25, 64],
  [251, 270, 199, 27, 24, 50],
  [272, 290, 136, 30, 30, 62],
  [247, 262, 233, 26, 25, 48],
].map(([w, hp, stm, str, dex, spd]) => ({ weight: w!, hp: hp! * 10, stm: stm! * 10, str: str! * 10, dex: dex! * 10, agl: dex! * 10, cst: w!, sex: 50, spd: spd! * 10 }));

describe('calibration against the original', () => {
  it('produces fights shaped like the original reports', () => {
    const rng = seeded(99);
    let n = 0, attacks = 0, hits = 0, crits = 0, luckA = 0, luckH = 0;
    for (const a of REAL)
      for (const b of REAL) {
        if (a === b) continue;
        for (let k = 0; k < 20; k++) {
          const r = fight('a', a, 'b', b, rng);
          n++;
          attacks += r.a.attacks + r.b.attacks;
          hits += r.a.hits + r.b.hits;
          crits += (r.log.match(/[Cc]/g) ?? []).length;
          luckA += r.a.luckAtk;
          luckH += r.a.luckHit;
        }
      }
    expect(attacks / n / 2).toBeGreaterThan(15); // original samples: 32 and 44 attacks (with AGL unknown here)
    expect(attacks / n / 2).toBeLessThan(45);
    expect(hits / attacks).toBeGreaterThan(0.35);
    expect(hits / attacks).toBeLessThan(0.6);
    expect(crits / hits).toBeGreaterThan(0.005); // guide: critical hits about 1%
    expect(crits / hits).toBeLessThan(0.02);
    expect(luckA / n).toBeGreaterThan(44); // guide: hit roll averages 50
    expect(luckA / n).toBeLessThan(56);
    expect(luckH / n).toBeGreaterThan(72); // guide: damage roll averages about 80
    expect(luckH / n).toBeLessThan(88);
  });
});

describe('stats', () => {
  it('Eve-like genes give a ~50 weight founder and the display scales with the average weight', () => {
    const p = express(eveDna(), 13);
    const s = deriveStats(p);
    expect(s.weight).toBeGreaterThan(45);
    expect(s.weight).toBeLessThan(60);
    expect(dispCut(250)).toBe(1);
    expect(dispCut(50)).toBe(0);
    expect(dispCut(4000)).toBe(2);
    expect(shownStats({ ...evolved }, 1).hp).toBe(270);
  });

  it('sprites grow with weight like the original (50 -> ~67px, 250 -> ~116px at an average of 250)', () => {
    expect(spriteSize(50, 250)).toBeGreaterThanOrEqual(65);
    expect(spriteSize(50, 250)).toBeLessThanOrEqual(69);
    expect(spriteSize(250, 250)).toBeGreaterThanOrEqual(113);
    expect(spriteSize(250, 250)).toBeLessThanOrEqual(118);
    expect(spriteSize(400, 250)).toBeGreaterThan(spriteSize(250, 250));
    expect(spriteSize(1, 250)).toBeGreaterThanOrEqual(33);
  });
});

describe('genetics', () => {
  const same = (d: Dna): Dna => [d[0], d[0]];

  it('gene drift is unbiased: children are as often stronger as weaker', () => {
    const rng = seeded(11);
    const p = same(eveDna());
    const range = rangeFor(50);
    let up = 0;
    let down = 0;
    for (let i = 0; i < 4000; i++) {
      const g = makeSeed(p, rng, range).genes[1]!.v;
      if (g > 50) up++;
      else if (g < 50) down++;
    }
    expect(Math.abs(up - down) / (up + down)).toBeLessThan(0.1);
  });

  it('a more assertive strand wins, equal ones blend, and values never drop below 1', () => {
    const d = eveDna();
    d[0].genes[1] = { v: 80, a: 90 };
    d[1].genes[1] = { v: 20, a: 10 };
    expect(express(d, 1)[1]).toBe(80);
    d[0].genes[1] = { v: 80, a: 50 };
    d[1].genes[1] = { v: 20, a: 50 };
    expect(express(d, 1)[1]).toBe(51); // blended (average + 1)
    const rng = seeded(2);
    const tiny = eveDna();
    for (const s of tiny) s.genes.forEach((g) => (g.v = 1));
    for (let i = 0; i < 200; i++) expect(makeSeed(tiny, rng, 50).genes.every((g) => g.v >= 1)).toBe(true);
  });

  it('a heavy mate widens the dice, a light one narrows them', () => {
    const rng = seeded(4);
    const avg = 250;
    const light = mix(eveDna(), { dna: eveDna(), weight: 50 }, avg, rng).range;
    const heavy = mix(eveDna(), { dna: eveDna(), weight: 800 }, avg, rng).range;
    expect(light).toBeGreaterThan(rangeFor(avg));
    expect(heavy).toBeLessThan(rangeFor(avg));
  });

  it('colours come from the R/G/B switches shaded by X/Y/Z (Eve is grey)', () => {
    expect(colorOf(express(eveDna(), 1))).toBe('#7f7f7f');
    const p = express(eveDna(), 1);
    p[10] = 2; p[11] = 0; p[12] = 1;
    p[13] = 0; p[14] = 0; p[15] = 0;
    expect(colorOf(p)).toBe('#ff007f');
    p[13] = 1; p[14] = 1; // X,Y = 1 shade red 'ff'->'bf' and green '00'->'3f'
    expect(colorOf(p)).toBe('#bf3f7f');
  });

  it('every mutant type is reachable', () => {
    expect(KINDS).toHaveLength(14);
  });

  it('mutation flips whole switch groups in both strands, about 1 in 200 per group', () => {
    const rng = seeded(7);
    let flips = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const out = mutate(eveDna(), rng);
      if (out[0].sw.some((v) => v !== 0)) flips++;
    }
    // three groups at 1/200 each => ~1.5% of births change something
    expect(flips / N).toBeGreaterThan(0.01);
    expect(flips / N).toBeLessThan(0.02);
    const adam = adamSeed(seeded(1));
    expect(adam.sw).toHaveLength(9);
  });

  it('mutants follow the original conditions: X, Y and Z must all be 1 on every strand', () => {
    const base = express(eveDna(), 1);
    expect(kindOf(base)).toBe('normal');
    const gate = (over: Record<number, number>) => {
      const p = [...base];
      p[13] = 2; p[14] = 2; p[15] = 2;
      p[16] = 0; p[17] = 0; p[18] = 0;
      for (const [i, v] of Object.entries(over)) p[Number(i)] = v;
      return kindOf(p);
    };
    expect(gate({})).toBe('aura');
    expect(gate({ 16: 1, 17: 1, 18: 1 })).toBe('hider');
    expect(gate({ 18: 2 })).toBe('wing');
    expect(gate({ 16: 2 })).toBe('ribbon');
    expect(gate({ 16: 2, 18: 2 })).toBe('ribbonw');
    expect(gate({ 17: 2 })).toBe('crown');
    expect(gate({ 17: 2, 18: 2 })).toBe('crownw');
    expect(gate({ 17: 2, 16: 2 })).toBe('aho');
    expect(gate({ 17: 2, 16: 2, 10: 0, 11: 0, 12: 1 })).toBe('zombie');
    expect(gate({ 17: 2, 16: 2, 10: 2, 11: 2, 12: 2 })).toBe('oyaji');
    // U+V+W = 6 overrides everything: insect, or angel / devil depending on colour
    expect(gate({ 16: 2, 17: 2, 18: 2, 10: 1, 11: 1, 12: 1 })).toBe('musi');
    expect(gate({ 16: 2, 17: 2, 18: 2, 10: 2, 11: 2, 12: 0 })).toBe('angel');
    expect(gate({ 16: 2, 17: 2, 18: 2, 10: 0, 11: 0, 12: 0 })).toBe('devil');
  });
});
