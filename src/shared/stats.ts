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
 * expressed strongly enough AND the slime's body suits it. Combinations such
 * as angel (wings + halo) or crowned wings fall out of the parts naturally.
 * (Conditions and effects are this restoration's own design; the original's
 * are not public.)
 */
export function deriveForms(dna: Dna): MutationName[] {
  const on = (m: MutationName) => e(dna, m) >= MUTATION_SHOWS_AT;
  const g = (t: TraitName) => e(dna, t);
  const forms: MutationName[] = [];
  const devil = on('devil') && g('muscle') >= 40 && g('size') <= 70;
  const musi = !devil && on('musi') && g('reflex') >= 35 && g('size') <= 50;
  const wings = !devil && !musi && on('wings') && g('reflex') >= 35 && g('size') <= 60;
  if (wings) forms.push('wings');
  if (devil) forms.push('devil');
  if (musi) forms.push('musi');
  if (wings && on('halo') && g('stamina') >= 40) forms.push('halo');
  if (on('crown') && g('stamina') >= 40 && g('vitality') >= 40) forms.push('crown');
  if (on('ribbon') && g('brain') >= 35) forms.push('ribbon');
  if (on('aura') && g('muscle') >= 35 && g('brain') >= 35) forms.push('aura');
  if (on('aho') && g('brain') <= 30) forms.push('aho');
  if (on('zombie') && g('stamina') >= 45) forms.push('zombie');
  if (on('dark') && g('vitality') >= 40 && g('muscle') >= 40) forms.push('dark');
  if (on('metal') && g('vitality') >= 35 && g('size') >= 30) forms.push('metal');
  return forms;
}

type Mult = Partial<Record<'weight' | 'hp' | 'stm' | 'str' | 'dex' | 'spd', number>>;
export const FORM_EFFECTS: Record<MutationName, Mult> = {
  wings: { spd: 1.2, weight: 0.9 },
  crown: { hp: 1.05, stm: 1.05, str: 1.05, dex: 1.05, spd: 1.05 },
  ribbon: { dex: 1.2 },
  halo: { stm: 1.2 },
  devil: { str: 1.2, stm: 0.9 },
  musi: { spd: 1.15, str: 0.9 },
  aura: { str: 1.1, dex: 1.1 },
  aho: { dex: 0.85, hp: 1.15 },
  zombie: { stm: 1.3, spd: 0.9 },
  dark: { str: 1.25, hp: 0.9 },
  metal: { hp: 1.25, weight: 1.2, spd: 0.9 },
};

/**
 * Heavy slimes hit harder and have more HP but are less accurate and slower;
 * light ones are quicker. Calibrated against the stat blocks of the original's
 * ranked slimes (weight ~250 -> HP ~260, STR ~27, DEX ~27, SPD ~57).
 */
export function deriveStats(dna: Dna): Stats {
  const forms = deriveForms(dna);
  const m = (k: keyof Mult) => forms.reduce((acc, f) => acc * (FORM_EFFECTS[f][k] ?? 1), 1);
  const weight = Math.round(e(dna, 'size') * 4.5 * m('weight'));
  return {
    weight,
    hp: Math.round((weight * 0.75 + e(dna, 'vitality')) * m('hp')),
    stm: Math.round((e(dna, 'stamina') * 2.5 + weight * 0.2) * m('stm')),
    str: Math.max(1, Math.round((e(dna, 'muscle') * 0.18 + weight * 0.07) * m('str'))),
    dex: Math.max(1, Math.round((e(dna, 'brain') * 0.5 + 1.5 - weight * 0.02) * m('dex'))),
    spd: Math.max(1, Math.round((e(dna, 'reflex') * 0.7 - weight * 0.03) * m('spd'))),
  };
}

export function deriveColor(dna: Dna): string {
  const ch = (t: 'cr' | 'cg' | 'cb') =>
    COLOR_STEPS[Math.min(COLOR_STEPS.length - 1, Math.floor(e(dna, t) / 20))]!;
  return '#' + [ch('cr'), ch('cg'), ch('cb')].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Sprite edge in px; the original's gif grew linearly with weight (50 -> 67px, 250 -> 116px). */
export const spriteSize = (weight: number) => Math.round(Math.min(170, Math.max(48, 54.9 + 0.243 * weight)));
