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

/**
 * Rare "mutation" genes. They start at 0 in every founder and appear
 * spontaneously, then travel through the family like any other gene
 * (hidden strands can resurface generations later). Whether a mutation shows
 * also depends on conditions in the slime's other traits, see stats.ts.
 *
 * The visual parts mirror the variants seen in the author's "plus" edition
 * (wings, crown, ribbon, halo, devil, insect, aura, ahoge, zombie, dark);
 * `metal` is an extra of this restoration.
 */
export const MUTATIONS = ['wings', 'crown', 'ribbon', 'halo', 'devil', 'musi', 'aura', 'aho', 'zombie', 'dark', 'metal'] as const;
export type MutationName = (typeof MUTATIONS)[number];
export const SPONTANEOUS_RATE = 0.004;
export const MUTATION_SHOWS_AT = 50;

export type Dna = Record<TraitName, Strand> & Partial<Record<MutationName, Strand>>;

export const TRAIT_MIN = 1;
export const TRAIT_MAX = 99;
export const COLOR_STEPS = [0x00, 0x3f, 0x7f, 0xbf, 0xff] as const;

const clamp = (n: number) => Math.min(TRAIT_MAX, Math.max(TRAIT_MIN, n));

export function expressed(s: Strand): number {
  return s[0].d >= s[1].d ? s[0].v : s[1].v;
}

const NONE: Strand = [
  { v: 0, d: 0 },
  { v: 0, d: 0 },
];
/** Gene lookup that tolerates DNA saved before mutation genes existed. */
export const strandOf = (dna: Dna, t: TraitName | MutationName): Strand => dna[t] ?? NONE;

/** The founding slimes ("Eve") carry modest, uniform genes. */
export function founderDna(rng: Rng): Dna {
  const a = (v: number): Allele => ({ v, d: randInt(rng, 0, 99) });
  const dna = {} as Dna;
  for (const t of TRAITS) {
    const [lo, hi] = t === 'cr' || t === 'cg' || t === 'cb' ? [44, 56] : [8, 14];
    dna[t] = [a(randInt(rng, lo, hi)), a(randInt(rng, lo, hi))];
  }
  for (const m of MUTATIONS) dna[m] = [{ v: 0, d: randInt(rng, 0, 99) }, { v: 0, d: randInt(rng, 0, 99) }];
  return dna;
}

/**
 * Meiosis: each parent donates one of its two strands per trait.
 * Mutation moves a value up or down by 1..3 with equal probability, so that
 * "getting stronger" and "getting weaker" are equally likely at birth.
 */
export function breed(mother: Dna, father: Dna, rng: Rng, mutationRate = 0.12): Dna {
  const child = {} as Dna;
  const driftDom = (d: number) => Math.min(99, Math.max(0, d + randInt(rng, -15, 15)));
  for (const t of TRAITS) {
    const pick = (s: Strand): Allele => {
      const src = s[rng() < 0.5 ? 0 : 1];
      let v = src.v;
      if (rng() < mutationRate) {
        const isColor = t === 'cr' || t === 'cg' || t === 'cb';
        const step = randInt(rng, 1, isColor ? 8 : 3);
        v = clamp(v + (rng() < 0.5 ? -step : step));
      }
      return { v, d: driftDom(src.d) };
    };
    child[t] = [pick(mother[t]), pick(father[t])];
  }
  for (const m of MUTATIONS) {
    const pick = (s: Strand): Allele => {
      const src = s[rng() < 0.5 ? 0 : 1];
      let v = src.v;
      if (v === 0) {
        if (rng() < SPONTANEOUS_RATE) v = randInt(rng, 60, 95);
      } else if (rng() < mutationRate) {
        const step = randInt(rng, 1, 3);
        v = Math.max(0, Math.min(TRAIT_MAX, v + (rng() < 0.5 ? -step : step)));
      }
      return { v, d: driftDom(src.d) };
    };
    child[m] = [pick(strandOf(mother, m)), pick(strandOf(father, m))];
  }
  return child;
}
