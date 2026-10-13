/**
 * Bloodlines ("keito"), ported from SLIME BREEDER plus v1.08 (tatuta).
 *
 * Every slime carries four lineage slots: [mother's mother's father, mother's
 * father, father's mother's father, father]. A child inherits
 * [mother.slot1, mother.slot3, father.slot1, father.slot3], so it always
 * belongs to its father's lineage (slot 3). A lineage has a 7-digit code:
 * six affinity digits (0..5, one per stat HP STM STR DEX AGL SPD) and a type
 * digit (which stat the lineage favours). Two lineages "nick" when their
 * affinity digits add up to 5, which lifts the child's stats.
 */
import { type Rng } from './rng.ts';

export interface Lin {
  no: number;
  name: string;
  /** 7 digits: six affinities then the type digit */
  nx: string;
}
export type Blood = [Lin, Lin, Lin, Lin];

export const STAT_KEYS = ['hp', 'stm', 'str', 'dex', 'agl', 'spd'] as const;
export const ZERO_LIN: Lin = { no: 0, name: '', nx: '0000000' };
export const zeroBlood = (): Blood => [{ ...ZERO_LIN }, { ...ZERO_LIN }, { ...ZERO_LIN }, { ...ZERO_LIN }];

const digit = (nx: string, i: number) => (nx[i] ? Number(nx[i]) : 0);

/** Append the type digit (sum of the six digits mod 6). */
export function seven(six: string): string {
  let s = 0;
  for (let i = 0; i < 6; i++) s += digit(six, i);
  return `${six.slice(0, 6)}${s % 6}`;
}

/** A fresh random lineage code. */
export function newNx(rng: Rng): string {
  let k = '';
  for (let i = 0; i < 6; i++) k += Math.floor(rng() * 6);
  return seven(k);
}

/** Code of a new lineage split off an existing one: each affinity digit comes from the old or a fresh code. */
export function branchNx(oldNx: string, rng: Rng): string {
  const olds = [oldNx, newNx(rng)];
  let k = '';
  for (let i = 0; i < 6; i++) k += olds[Math.floor(rng() * 2)]![i];
  return seven(k);
}

const key = (l: Lin | undefined) => (l ? `${l.no}<>${l.name}<>${l.nx}` : '');

/**
 * The four slots of a newborn. `father` is null for an unknown seed, which
 * founds a brand-new lineage numbered after the newborn (named at its fight).
 */
export function inherit(mother: Blood, father: Blood | null, newNo: number, rng: Rng): { blood: Blood; variety: number } {
  const fatherSlots: Blood = father ?? [{ ...ZERO_LIN }, { ...ZERO_LIN }, { ...ZERO_LIN }, { no: newNo, name: '', nx: newNx(rng) }];
  const blood: Blood = [{ ...mother[1] }, { ...mother[3] }, father ? { ...father[1] } : { ...ZERO_LIN }, { ...fatherSlots[3] }];
  // how many different lineages stand among the eight in both parents' slots
  const seen = new Set<string>();
  for (const l of [...mother, ...(father ?? [])]) seen.add(key(l));
  if (!father) seen.add('');
  return { blood, variety: seen.size };
}

export interface Nix {
  /** per-stat multiplier: hp, stm, str, dex, agl, spd */
  mult: number[];
  /** display symbols, one per stat */
  print: string;
}

/** Perl prints numbers with 15 significant digits, so 1.5 * 100 - 100 shows as "50"; JS would show 50.00000000000006. */
export const percent = (v: number) => String(Number((v * 100 - 100).toPrecision(15)));

/** Tidy a stored print: slimes born before the fix have strings like "××50.0000000000000060○×△". */
export const tidyPrint = (print: string) => print.replace(/\d+\.\d{6,}|\d{3,}/g, (m) => String(Number(Number(m).toPrecision(15)))).replace(/(\d+)\.0+(?!\d)/g, '$1');

const symbol = (v: number) =>
  v >= 1.4 ? percent(v) : v >= 1.35 ? '∞' : v >= 1.3 ? '♪' : v >= 1.25 ? '★' : v >= 1.2 ? '☆' : v >= 1.15 ? '◎' : v >= 1.1 ? '○' : v >= 1.05 ? '△' : '×';

/** The "nicks" effect on a newborn's stats (operation order kept as in the original). */
export function nixOf(blood: Blood, variety: number): Nix {
  const [b10, b11, b12, b13] = blood;
  const list: number[] = [];
  for (const l of blood) if (!list.includes(l.no)) list.push(l.no);
  const n = list.length;
  const nx = [1, 1, 1, 1, 1, 1];
  let hit = 0;
  for (let i = 0; i < 6; i++) {
    const a = digit(b11.nx, i) + digit(b13.nx, i);
    const b = digit(b10.nx, i) + digit(b11.nx, i) + digit(b12.nx, i) + digit(b13.nx, i);
    if (a === 5) {
      nx[i]! += 0.1;
      hit++;
    }
    if (b % 3 === 0) nx[i]! += 0.05;
    if (n < 3) nx[i]! -= 0.05;
    if (n < 4 && nx[i]! > 1) nx[i]! -= 0.05;
  }
  const mup = digit(b11.nx, 6);
  const fup = digit(b13.nx, 6);
  if (hit < 6 && n > 2) {
    const t: Record<number, [number, number]> = { 0: [0.15, 0.1], 1: [0.15, 0.1], 2: [0.1, 0.1], 3: [0.1, 0.05], 4: [0.05, 0.05], 5: [0.05, 0] };
    const [m, f] = t[hit]!;
    nx[mup]! += m;
    nx[fup]! += f;
  }
  const extra: Record<number, [number, number]> = { 5: [0, 0.05], 6: [0.05, 0.05], 7: [0.05, 0.1], 8: [0.1, 0.15] };
  const e = extra[variety];
  if (e) {
    nx[mup]! += e[0];
    nx[fup]! += e[1];
  }
  return { mult: nx, print: nx.map(symbol).join('') };
}

/** Compatibility of the viewer's lineage with another one ("血統の相性一覧"): six symbols. */
export function affinityPrint(mine: Blood, other: Lin): string {
  const kno = mine[3].no;
  const kno2 = mine[1].no;
  if (kno === kno2 && kno === other.no) return '××××××';
  const kup = digit(mine[3].nx, 6);
  const sup = digit(other.nx, 6);
  const pts = [0, 0, 0, 0, 0, 0];
  let hit = 0;
  for (let i = 0; i < 6; i++) {
    if (digit(mine[3].nx, i) + digit(other.nx, i) === 5) {
      hit++;
      pts[i] = kno === other.no || kno2 === other.no || kno === kno2 ? 1 : 2;
    }
  }
  if (hit < 6) {
    const t: Record<number, [number, number]> = { 0: [3, 2], 1: [3, 2], 2: [2, 2], 3: [2, 1], 4: [1, 1], 5: [1, 0] };
    const [k, s] = t[hit]!;
    pts[kup]! += k;
    pts[sup]! += s;
  }
  return pts.map((p) => ['×', '△', '○', '◎', '☆', '★', '♪', '∞'][p] ?? '×').join('');
}

/** The slot-3 lineage number of a mate and whether it is a poor match for the viewer (shown orange). */
export const poorMatch = (slime: Blood, viewer: Blood) =>
  slime[1].no === viewer[1].no || slime[1].no === viewer[3].no || slime[1].no === slime[3].no;
