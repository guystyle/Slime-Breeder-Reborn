import { type Rng, randInt } from './rng.ts';

/**
 * Each trait is stored as two strands. The strand with the higher `dom`
 * value is expressed; the other one is hidden but can resurface in later
 * generations ("generation jumps").
 */
export interface Allele {
  v: number; // trait magnitude
  d: number; // dominance rank
}
export type Strand = [Allele, Allele];

export const TRAITS = ['size', 'vitality', 'stamina', 'muscle', 'brain', 'reflex', 'cr', 'cg', 'cb'] as const;
export type TraitName = (typeof TRAITS)[number];
export type Dna = Record<TraitName, Strand>;

export const TRAIT_MIN = 1;
export const TRAIT_MAX = 99;
export const COLOR_STEPS = [0x00, 0x3f, 0x7f, 0xbf, 0xff] as const;

const clamp = (n: number) => Math.min(TRAIT_MAX, Math.max(TRAIT_MIN, n));

export function expressed(s: Strand): number {
  return s[0].d >= s[1].d ? s[0].v : s[1].v;
}

/** The founding slimes ("Eve") carry modest, uniform genes. */
export function founderDna(rng: Rng): Dna {
  const a = (v: number): Allele => ({ v, d: randInt(rng, 0, 99) });
  const dna = {} as Dna;
  for (const t of TRAITS) {
    const [lo, hi] = t === 'cr' || t === 'cg' || t === 'cb' ? [44, 56] : [8, 14];
    dna[t] = [a(randInt(rng, lo, hi)), a(randInt(rng, lo, hi))];
  }
  return dna;
}

/**
 * Meiosis: each parent donates one of its two strands per trait.
 * Mutation moves a value up or down by 1..3 with equal probability, so that
 * "getting stronger" and "getting weaker" are equally likely at birth.
 */
export function breed(mother: Dna, father: Dna, rng: Rng, mutationRate = 0.12): Dna {
  const child = {} as Dna;
  for (const t of TRAITS) {
    const pick = (s: Strand): Allele => {
      const src = s[rng() < 0.5 ? 0 : 1];
      let v = src.v;
      if (rng() < mutationRate) {
        const isColor = t === 'cr' || t === 'cg' || t === 'cb';
        const step = randInt(rng, 1, isColor ? 8 : 3);
        v = clamp(v + (rng() < 0.5 ? -step : step));
      }
      // dominance also drifts slightly so hidden strands can overtake
      const d = Math.min(99, Math.max(0, src.d + randInt(rng, -15, 15)));
      return { v, d };
    };
    child[t] = [pick(mother[t]), pick(father[t])];
  }
  return child;
}
