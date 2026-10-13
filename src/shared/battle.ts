import { type Rng } from './rng.ts';
import { type Stats } from './stats.ts';

export interface SideReport {
  name: string;
  hp: number;
  maxHp: number;
  stmPct: number;
  hits: number;
  attacks: number;
  dmgAve: number;
  /** average of hit rolls, 0..100 (50 is neutral) */
  luckHit: number;
  /** average of damage rolls, 0..100 (67 is neutral) or null when nothing landed */
  luckDmg: number | null;
}

export interface BattleReport {
  winner: 'a' | 'b';
  a: SideReport;
  b: SideReport;
  /** "O/X" = a hit/miss, "o/x" = b hit/miss, groups of 10 separated by a space */
  log: string;
}

const HP_SCALE = 10;
const ATTACK_COST = 4;
const EVADE_COST = 1;
const HIT_COST = 6;
const MAX_TICKS = 400;

class Fighter {
  hp: number;
  readonly maxHp: number;
  stm: number;
  readonly maxStm: number;
  energy = 0;
  hits = 0;
  attacks = 0;
  dmgTotal = 0;
  hitRolls: number[] = [];
  dmgRolls: number[] = [];
  /** high-status slimes burn stamina faster */
  readonly burn: number;

  constructor(
    readonly name: string,
    readonly s: Stats,
  ) {
    this.maxHp = s.hp * HP_SCALE;
    this.hp = this.maxHp;
    this.maxStm = s.stm;
    this.stm = s.stm;
    this.burn = 0.35 + (s.str + s.dex + s.spd) / 250;
  }

  /** below 50% stamina the slime weakens, down to half strength at zero */
  get eff() {
    const p = this.stm / this.maxStm;
    return p >= 0.5 ? 1 : 0.5 + p;
  }

  spend(cost: number) {
    // when nearly empty, stamina drains more slowly
    const slow = 0.4 + 0.6 * Math.min(1, (this.stm / this.maxStm) * 2);
    this.stm = Math.max(0, this.stm - cost * this.burn * slow);
  }

  report(): SideReport {
    const avg = (xs: number[]) => (xs.length ? Math.round((100 * xs.reduce((p, c) => p + c, 0)) / xs.length) : null);
    return {
      name: this.name,
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      stmPct: Math.round((100 * this.stm) / this.maxStm),
      hits: this.hits,
      attacks: this.attacks,
      dmgAve: this.hits ? Math.round(this.dmgTotal / this.hits) : 0,
      luckHit: avg(this.hitRolls) ?? 50,
      luckDmg: avg(this.dmgRolls),
    };
  }
}

/** Speed fills an energy bar; a full bar (100) is one attack. */
export function fight(an: string, as: Stats, bn: string, bs: Stats, rng: Rng): BattleReport {
  const f = [new Fighter(an, as), new Fighter(bn, bs)] as const;
  const marks: string[] = [];

  for (let tick = 0; tick < MAX_TICKS && f[0].hp > 0 && f[1].hp > 0; tick++) {
    for (const i of [0, 1] as const) f[i].energy += f[i].s.spd * f[i].eff * 3 + 6;
    // the slime with more stored energy strikes first this tick
    const order = f[0].energy >= f[1].energy ? [0, 1] : [1, 0];
    for (const i of order as (0 | 1)[]) {
      const me = f[i];
      const foe = f[1 - i as 0 | 1];
      while (me.energy >= 100 && me.hp > 0 && foe.hp > 0) {
        me.energy -= 100;
        me.attacks++;
        me.spend(ATTACK_COST);
        const dex = me.s.dex * me.eff;
        const dodge = foe.s.spd * foe.eff * 0.6;
        const pHit = Math.min(0.95, Math.max(0.1, dex / (dex + dodge)));
        const roll = rng();
        me.hitRolls.push(1 - roll); // low roll = lucky, so invert onto the 0..100 luck scale
        const hit = roll < pHit;
        const big = i === 0;
        if (hit) {
          const q = Math.max(rng(), rng());
          me.dmgRolls.push(q);
          const dmg = Math.max(1, Math.round(me.s.str * HP_SCALE * 1.5 * q * me.eff));
          foe.hp -= dmg;
          foe.spend(HIT_COST);
          me.hits++;
          me.dmgTotal += dmg;
          marks.push(big ? 'O' : 'o');
        } else {
          foe.spend(EVADE_COST);
          marks.push(big ? 'X' : 'x');
        }
      }
    }
  }

  const aWins = f[0].hp / f[0].maxHp >= f[1].hp / f[1].maxHp;
  const log = marks.join('').replace(/(.{10})(?=.)/g, '$1 ');
  return { winner: aWins ? 'a' : 'b', a: f[0].report(), b: f[1].report(), log };
}
