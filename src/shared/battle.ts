/**
 * Battle engine, ported from SLIME BREEDER plus v1.08 (tatuta). Full-size
 * stats are used (the UI divides them for display). Speed fills a "gage";
 * a slime attacks when its gage passes the faster slime's speed. Hit = a roll
 * under DEX beating a roll under the target's AGL. Stamina drains per action
 * and below 50% both power and accuracy fall off.
 */
import { type Rng } from './rng.ts';
import { type Stats } from './stats.ts';

/** One attack, with both sides' state right after it (drives the replay animation). */
export interface BattleEvent {
  who: 'a' | 'b';
  hit: boolean;
  /** hit roll above 1.5x: a critical hit (about 1% of hits) */
  crit: boolean;
  dmg: number;
  hpA: number;
  hpB: number;
  stmA: number;
  stmB: number;
}

export interface SideReport {
  name: string;
  hp: number;
  maxHp: number;
  stmPct: number;
  hits: number;
  attacks: number;
  dmgAve: number;
  /** average hit roll 0..100 (expected 50) */
  luckAtk: number;
  /** average damage roll 0..200 (expected ~80), 0 when nothing landed */
  luckHit: number;
}

export interface BattleReport {
  winner: 'a' | 'b';
  events: BattleEvent[];
  a: SideReport;
  b: SideReport;
  /** "O/X" = a hit/miss, "o/x" = b hit/miss, "C"/"c" = critical, groups of 10 separated by a space */
  log: string;
}

const MAX_STEPS = 200_000;

/** `a` is the challenger. */
export function fight(an: string, as: Stats, bn: string, bs: Stats, rng: Rng): BattleReport {
  const S = [as, bs] as const;
  const maxHp = [as.hp, bs.hp];
  const hp = [...maxHp];
  const maxSt = [as.stm * 8, bs.stm * 8];
  const st = [...maxSt];
  const prs = [Math.sqrt(as.str * as.cst), Math.sqrt(bs.str * bs.cst)];
  const pow = [1, 1];
  const powx = [1, 1];
  const powy = [1, 1];
  const gage = [0, 0];
  const hit = [0, 0];
  const attack = [0, 0];
  const sumRndHit = [0, 0];
  const sumHitPer = [0, 0];
  const spdGage = Math.max(as.spd, bs.spd) - 1;
  const marks: string[] = [];
  const events: BattleEvent[] = [];
  let comboAgl = 1;
  let comboTurn = 0;
  let turn = 0;
  let round = 1;

  for (let step = 0; step < MAX_STEPS && hp[0]! >= 1 && hp[1]! >= 1; step++) {
    const a = turn !== 0 ? 1 : 0; // attacker index (0 = challenger)
    const d = 1 - a;
    if (gage[a]! > spdGage) {
      gage[a]! -= spdGage;
      attack[a]!++;
      const myDex = Math.max(1, S[a]!.dex * powx[a]!);
      const urAgl = Math.max(1, S[d]!.agl * powx[d]! * (turn === comboTurn && comboAgl !== 1 ? comboAgl : 1));
      const rndHit = rng() * myDex;
      const rndPry = rng() * urAgl;
      const judge = rndHit - rndPry;
      sumRndHit[a]! += rndHit / myDex;
      sumRndHit[d]! += rndPry / urAgl;
      comboTurn = turn;
      let crit = false;
      let dmgDone = 0;
      let landed = false;
      if (judge > 0) {
        landed = true;
        const x = judge / myDex;
        const hitPer = (2 * x - 1) ** 3 + 1;
        hit[a]!++;
        sumHitPer[a]! += hitPer;
        dmgDone = Math.trunc(S[a]!.str * hitPer * powx[a]!);
        hp[d]! -= dmgDone;
        st[d]! -= Math.trunc(prs[a]! * powy[a]! * (0.5 + hitPer * 0.5) + S[a]!.str * powx[a]! * (hitPer * 0.75));
        const dmgHp = dmgDone / maxHp[d]!;
        gage[d] = Math.trunc(gage[d]! * Math.max(0, 1 - dmgHp));
        comboAgl = Math.max(0, 1 - 10 * dmgHp ** 2);
        crit = hitPer > 1.5;
        marks.push(a === 0 ? (crit ? 'C' : 'O') : crit ? 'c' : 'o');
      } else {
        comboAgl = 1;
        const y = -judge / urAgl;
        st[d]! -= Math.trunc(prs[a]! * powy[a]! * (0.5 * (y - 1) ** 2));
        marks.push(a === 0 ? 'X' : 'x');
      }
      st[a]! -= S[a]!.cst * powy[a]!;
      st[a] = Math.max(0, st[a]!);
      st[d] = Math.max(0, st[d]!);
      for (const i of [0, 1]) {
        pow[i] = st[i]! / maxSt[i]!;
        const q = 1 - (1 - pow[i]!) ** 2;
        powx[i] = 0.4 + 0.6 * q;
        powy[i] = 0.6 + 0.4 * q;
      }
      if (round % 10 === 0) marks.push(' ');
      round++;
      events.push({
        who: a === 0 ? 'a' : 'b',
        hit: landed,
        crit,
        dmg: dmgDone,
        hpA: Math.max(0, Math.trunc(hp[0]!)),
        hpB: Math.max(0, Math.trunc(hp[1]!)),
        stmA: Math.trunc(pow[0]! * 100),
        stmB: Math.trunc(pow[1]! * 100),
      });
    }
    gage[a]! += Math.trunc(S[a]!.spd * powx[a]!);
    turn = turn === 0 ? 1 : 0;
  }

  // the last mover was the winner; `turn` has already flipped (as in the original)
  const aWins = hp[1]! < 1 ? true : hp[0]! < 1 ? false : hp[0]! / maxHp[0]! >= hp[1]! / maxHp[1]!;
  const rep = (i: 0 | 1, name: string): SideReport => {
    const o = 1 - i;
    return {
      name,
      hp: Math.trunc(hp[i]!),
      maxHp: maxHp[i]!,
      stmPct: Math.trunc(pow[i]! * 100),
      hits: hit[i]!,
      attacks: attack[i]!,
      dmgAve: hit[i] ? Math.trunc((maxHp[o]! - hp[o]!) / hit[i]!) : 0,
      luckAtk: Math.trunc((100 * sumRndHit[i]!) / round),
      luckHit: hit[i] ? Math.trunc((100 * sumHitPer[i]!) / hit[i]!) : 0,
    };
  };
  return { winner: aWins ? 'a' : 'b', events, a: rep(0, an), b: rep(1, bn), log: marks.join('').trimEnd() };
}
