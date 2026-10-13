/**
 * Genetics, ported from the author's SLIME BREEDER plus v1.08 (tatuta, free to
 * modify and redistribute with credit, see NOTICE.md). Every slime carries two
 * strands of 19 genes:
 *
 *  - genes 0..9 are quantitative `{ v: value, a: assertiveness }` pairs; the
 *    strand with the clearly higher assertiveness is expressed, otherwise the
 *    two values blend (this is how recessive genes hide and resurface).
 *  - genes 10..18 are 0/1 switches whose two strands are summed (0..2):
 *    R G B (colour), X Y Z (colour shade / mutant gate), U V W (ribbon,
 *    crown, wing).
 */
import { type Rng } from './rng.ts';

export const N_PARAMS = 10;
export const N_SWITCHES = 9;
export const TUMBLE = 8;
/** 1 in MUTATION_ODDS for each of the three switch groups, per birth. */
export const MUTATION_ODDS = 200;

export interface Gene {
  v: number;
  a: number;
}
export interface Strand {
  genes: Gene[];
  sw: number[];
}
export type Dna = [Strand, Strand];

/** Gene names, index order as in the original: 0=HRD 1=MSL 2=BRN 3=NET 4=FAT 5=MEN 6=SEX 7=SFT 8=AIR 9=SNS */
export const GENE_NAMES = ['HRD', 'MSL', 'BRN', 'NET', 'FAT', 'MEN', 'SEX', 'SFT', 'AIR', 'SNS'] as const;

/** Mutation dice size depends on the world's average weight ("gene stability"). */
export const rangeFor = (avgWeight: number) => Math.floor(avgWeight / 20) + 1;

const dice = (rng: Rng, range: number) => {
  let d = 0;
  for (let j = 0; j < TUMBLE; j++) d += 1 + Math.floor(rng() * range);
  return d;
};

/** Eve: the founder every new player starts with (grey, weight 50). */
export function eveDna(): Dna {
  const genes = (): Gene[] => Array.from({ length: N_PARAMS }, (_, i) => ({ v: i === 6 ? 30 : 50, a: 50 }));
  return [
    { genes: genes(), sw: Array(N_SWITCHES).fill(0) },
    { genes: genes(), sw: Array(N_SWITCHES).fill(1) },
  ];
}

/** An "unknown seed": a freshly rolled strand, as used when the mate is Adam. */
export function adamSeed(rng: Rng): Strand {
  const ri = (lo: number, n: number) => lo + Math.floor(rng() * n);
  const genes: Gene[] = [];
  for (let i = 0; i < N_PARAMS; i++) {
    const v = i === 6 ? ri(20, 21) : i === 0 || i === 4 ? ri(10, 51) : ri(40, 21);
    genes.push({ v, a: ri(40, 21) });
  }
  return { genes, sw: Array.from({ length: N_SWITCHES }, () => ri(0, 2)) };
}

/** Make a germ cell: per gene pick one of the two strands, then jitter quantitative genes. */
export function makeSeed(dna: Dna, rng: Rng, range: number): Strand {
  const genes: Gene[] = [];
  const sw: number[] = [];
  const mean = (TUMBLE * (1 + range)) / 2;
  for (let i = 0; i < N_PARAMS; i++) {
    const g = dna[rng() < 0.5 ? 0 : 1].genes[i]!;
    let v = g.v + dice(rng, range) - mean;
    v = v > 0 ? v : 1;
    const a = g.a + dice(rng, range) - mean;
    genes.push({ v, a });
  }
  for (let i = 0; i < N_SWITCHES; i++) sw.push(dna[rng() < 0.5 ? 0 : 1].sw[i]!);
  return { genes, sw };
}

export interface Birth {
  dna: Dna;
  /** dice size in force when the child's strands were read (needed by `express`) */
  range: number;
}

/**
 * Child = one germ cell from the owner's slime + one from the mate (or Adam).
 * A light mate narrows the dice, a heavy one widens them (original rule).
 */
export function mix(owner: Dna, mate: { dna: Dna; weight: number } | null, avgWeight: number, rng: Rng): Birth {
  let range = rangeFor(avgWeight);
  const s1 = makeSeed(owner, rng, range);
  let s2: Strand;
  if (mate) {
    const hw = mate.weight;
    range = hw < avgWeight ? Math.floor(range * (2 - hw / avgWeight) + 0.5) : Math.floor(range * (0.5 + (0.5 * avgWeight) / hw) + 0.5);
    s2 = makeSeed(mate.dna, rng, range);
  } else s2 = adamSeed(rng);
  return { dna: [s1, s2], range };
}

/** Expressed value of each gene (0..9) plus summed switches (10..18). */
export function express(dna: Dna, range: number): number[] {
  const thr = (range - 1) * TUMBLE * 0.05;
  const out: number[] = [];
  for (let i = 0; i < N_PARAMS; i++) {
    const g1 = dna[0].genes[i]!;
    const g2 = dna[1].genes[i]!;
    if (g1.a > g2.a + thr) out.push(g1.v);
    else if (g1.a + thr < g2.a) out.push(g2.v);
    else out.push(Math.floor((g1.v + g2.v) / 2) + 1);
  }
  for (let i = 0; i < N_SWITCHES; i++) out.push(dna[0].sw[i]! + dna[1].sw[i]!);
  return out;
}

/** Rare spontaneous flips of a whole switch group (R/G/B, X/Y/Z or U/V/W) in both strands. */
export function mutate(dna: Dna, rng: Rng): Dna {
  const hits = [0, 1, 2].map(() => Math.floor(rng() * MUTATION_ODDS) === 0);
  if (!hits.some(Boolean)) return dna;
  const flip = (s: Strand): Strand => {
    const sw = [...s.sw];
    hits.forEach((h, g) => {
      if (h) for (let k = 0; k < 3; k++) sw[g * 3 + k] = 1 - sw[g * 3 + k]!;
    });
    return { genes: s.genes, sw };
  };
  return [flip(dna[0]), flip(dna[1])];
}

// ---------- appearance ----------

/** Visible mutant types. All are cosmetic in the original: stats never depend on them. */
export type Kind =
  | 'normal'
  | 'aura'
  | 'hider'
  | 'wing'
  | 'ribbon'
  | 'ribbonw'
  | 'crown'
  | 'crownw'
  | 'aho'
  | 'zombie'
  | 'oyaji'
  | 'musi'
  | 'angel'
  | 'devil';

export const KINDS: readonly Kind[] = [
  'normal', 'aura', 'hider', 'wing', 'ribbon', 'ribbonw', 'crown', 'crownw', 'aho', 'zombie', 'oyaji', 'musi', 'angel', 'devil',
];

/** Colour from the R/G/B switches (0,1,2) shaded by X/Y/Z, exactly as in the original. */
export function colorOf(p: number[]): string {
  const ch = (c: number, shade: number) => (c === 0 ? (shade === 1 ? 0x3f : 0x00) : c === 1 ? 0x7f : shade === 1 ? 0xbf : 0xff);
  return '#' + [ch(p[10]!, p[13]!), ch(p[11]!, p[14]!), ch(p[12]!, p[15]!)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/**
 * Mutants require X, Y and Z to be 1 on all six strands; the ribbon/crown/wing
 * and colour switches then pick the variant (rules from the original source).
 */
export function kindOf(p: number[]): Kind {
  const xyz = p[13]! + p[14]! + p[15]!;
  const uvw = p[16]! + p[17]! + p[18]!;
  const rgb = p[10]! + p[11]! + p[12]!;
  let kind: Kind = 'normal';
  if (xyz === 6) {
    kind = 'aura';
    if (uvw === 3) kind = 'hider';
    if (p[18] === 2) kind = 'wing';
    if (p[16] === 2) {
      kind = 'ribbon';
      if (p[18] === 2) kind = 'ribbonw';
    }
    if (p[17] === 2) {
      kind = 'crown';
      if (p[16] === 2) {
        kind = 'aho';
        if (rgb < 2) kind = 'zombie';
        if (rgb === 6) kind = 'oyaji';
      }
      if (p[18] === 2) kind = 'crownw';
    }
    if (uvw === 6) {
      kind = 'musi';
      if (rgb > 3) kind = 'angel';
      if (rgb < 1) kind = 'devil';
    }
  }
  return kind;
}
