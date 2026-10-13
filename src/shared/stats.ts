/** Status formulas ported from SLIME BREEDER plus v1.08. */
export interface Stats {
  weight: number;
  hp: number;
  stm: number;
  str: number;
  dex: number;
  agl: number;
  /** stamina cost per action (heavier, faster slimes tire sooner) */
  cst: number;
  /** fertility: how fast the slime regrows mating seeds */
  sex: number;
  spd: number;
}

/**
 * @param p expressed genes, see `express` (0=HRD 1=MSL 2=BRN 3=NET 4=FAT 5=MEN 6=SEX 7=SFT 8=AIR 9=SNS)
 * @param nx per-stat lineage multipliers [hp, stm, str, dex, agl, spd] (see `nixOf`)
 */
export function deriveStats(p: number[], nx: number[] = [1, 1, 1, 1, 1, 1]): Stats {
  const g = (i: number) => p[i]!;
  const wgt = Math.trunc((g(0) * 24 + g(1) * 12 + g(7) * 12 + g(4) * 24 + g(2) * 3 + g(8) * 3 + g(3) + g(9)) / 80) + 1;
  const hp = Math.trunc(nx[0]! * (((g(0) * 5 + g(1) + g(7) + g(4) * 3) * 10) / 9)) + 1;
  const stm = Math.trunc(nx[1]! * ((((g(4) * 6 + g(5) * 4) / 10) * Math.sqrt(g(8) / wgt)) * 10)) + 1;
  const str = Math.trunc(nx[2]! * Math.sqrt(((wgt + Math.sqrt(wgt * g(0))) / 2) * ((g(1) + g(7)) / 2))) + 1;
  const dex = Math.trunc(nx[3]! * ((g(2) ** 2 / wgt ** 2) * g(9) * g(1) * g(7) * g(3)) ** 0.25) + 1;
  const agl = Math.trunc(nx[4]! * (((g(1) ** 2 * g(7)) / wgt ** 2) * (g(3) ** 2 / wgt ** 2) * g(9) ** 3) ** 0.25) + 1;
  const spd = Math.trunc(nx[5]! * (((g(1) * g(7) ** 2) / wgt ** 2) * (g(2) ** 2 / wgt ** 2) * g(3) ** 3) ** 0.25) + 1;
  const cst = Math.trunc((wgt * 10 + g(2) * 2 + g(3) * 3 + g(6) * 2 + g(8) * 2 + g(9) * 3) / 22) + 1;
  const sex = Math.trunc((g(6) / cst) * 50) + 1;
  return { weight: wgt, hp, stm, str, dex, agl, cst, sex, spd };
}

/** Number of digits the displayed stats lose, from the world's average weight (original `disp_cut`). */
export const dispCut = (avgWeight: number) => Math.max(0, String(Math.trunc(avgWeight)).length - 2);

/** Numbers as shown to players: divided by 10^cut so they stay readable as the species grows. */
export function shownStats(s: Stats, cut: number) {
  const f = (n: number) => Math.trunc(n / 10 ** cut + 0.5);
  return { hp: f(s.hp), stm: f(s.stm), str: f(s.str), dex: f(s.dex), agl: f(s.agl), spd: f(s.spd) };
}
export type ShownStats = ReturnType<typeof shownStats>;

/**
 * Sprite edge in px, relative to the world's average weight. Matches the
 * English edition's measured sizes (weight 50 -> ~67px, 250 -> ~116px when the
 * average is ~250) while staying sensible as the species grows.
 */
export const spriteSize = (weight: number, avgWeight: number) =>
  Math.round(Math.min(170, Math.max(33, 115 * (0.48 + (0.52 * weight) / Math.max(1, avgWeight)))));
