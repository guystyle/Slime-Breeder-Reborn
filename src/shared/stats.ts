import { type Dna, COLOR_STEPS, expressed } from './dna.ts';

export interface Stats {
  weight: number;
  hp: number;
  stm: number;
  str: number;
  dex: number;
  spd: number;
}

/** Heavy slimes hit harder but are less accurate and slower; light ones are quicker. */
export function deriveStats(dna: Dna): Stats {
  const e = (t: keyof Dna) => expressed(dna[t]);
  const weight = Math.round(e('size') * 4.5);
  return {
    weight,
    hp: Math.round(e('vitality') * 3 + weight * 0.4),
    stm: Math.round(e('stamina') * 2.5 + weight * 0.2),
    str: Math.max(1, Math.round(e('muscle') * 0.3 + weight * 0.04)),
    dex: Math.max(1, Math.round(e('brain') * 0.5 + 1 - weight * 0.01)),
    spd: Math.max(1, Math.round(e('reflex') * 0.7 - weight * 0.03)),
  };
}

export function deriveColor(dna: Dna): string {
  const ch = (t: 'cr' | 'cg' | 'cb') =>
    COLOR_STEPS[Math.min(COLOR_STEPS.length - 1, Math.floor(expressed(dna[t]) / 20))]!;
  return '#' + [ch('cr'), ch('cg'), ch('cb')].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Sprite edge length in px; bigger slimes are drawn bigger. */
export const spriteSize = (weight: number) => Math.round(60 + Math.sqrt(weight) * 3.6);
