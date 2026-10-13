import { type Dna, COLOR_STEPS, MUTATION_SHOWS_AT, type MutationName, type TraitName, expressed, strandOf } from './dna.ts';

export interface Stats {
  weight: number;
  hp: number;
  stm: number;
  str: number;
  dex: number;
  spd: number;
}

const e = (dna: Dna, t: TraitName | MutationName) => expressed(strandOf(dna, t));

/**
 * Mutations that are visibly active. A mutation gene only shows when it is
 * expressed strongly enough AND the slime's body suits it.
 * (Rules are this restoration's own design; the original's are not public.)
 */
export function deriveForms(dna: Dna): MutationName[] {
  const on = (m: MutationName) => e(dna, m) >= MUTATION_SHOWS_AT;
  const forms: MutationName[] = [];
  if (on('wings') && e(dna, 'reflex') >= 35 && e(dna, 'size') <= 60) forms.push('wings');
  if (on('metal') && e(dna, 'vitality') >= 35 && e(dna, 'size') >= 30) forms.push('metal');
  if (on('horn') && e(dna, 'muscle') >= 35) forms.push('horn');
  return forms;
}

/**
 * Heavy slimes hit harder and have more HP but are less accurate and slower;
 * light ones are quicker. Calibrated against the stat blocks of the original's
 * ranked slimes (weight ~250 -> HP ~260, STR ~27, DEX ~27, SPD ~57).
 */
export function deriveStats(dna: Dna): Stats {
  const forms = deriveForms(dna);
  const has = (f: MutationName) => forms.includes(f);
  const baseW = e(dna, 'size') * 4.5;
  const weight = Math.round(baseW * (has('wings') ? 0.9 : 1) * (has('metal') ? 1.2 : 1));
  const hp = (weight * 0.75 + e(dna, 'vitality')) * (has('metal') ? 1.25 : 1);
  const str = (e(dna, 'muscle') * 0.18 + weight * 0.07) * (has('horn') ? 1.25 : 1);
  const spd = (e(dna, 'reflex') * 0.7 - weight * 0.03) * (has('wings') ? 1.2 : 1) * (has('metal') ? 0.9 : 1);
  return {
    weight,
    hp: Math.round(hp),
    stm: Math.round(e(dna, 'stamina') * 2.5 + weight * 0.2),
    str: Math.max(1, Math.round(str)),
    dex: Math.max(1, Math.round(e(dna, 'brain') * 0.5 + 1.5 - weight * 0.02)),
    spd: Math.max(1, Math.round(spd)),
  };
}

export function deriveColor(dna: Dna): string {
  const ch = (t: 'cr' | 'cg' | 'cb') =>
    COLOR_STEPS[Math.min(COLOR_STEPS.length - 1, Math.floor(e(dna, t) / 20))]!;
  return '#' + [ch('cr'), ch('cg'), ch('cb')].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Sprite edge in px; the original's gif grew linearly with weight (50 -> 67px, 250 -> 116px). */
export const spriteSize = (weight: number) => Math.round(Math.min(170, Math.max(48, 54.9 + 0.243 * weight)));
