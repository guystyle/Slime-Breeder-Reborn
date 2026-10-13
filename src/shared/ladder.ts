export const RANK_SIZE = 50;
export const TOP_ALWAYS = 3;
/** a champion enters the Hall of Fame after defending the title more than 3 times */
export const HALL_MIN_DEFENSES = 4;
export const MATES_SEEDS = 10;

export interface Ranked {
  id: number;
  points: number;
  streak: number;
}

/** Points a challenger earns for beating `opp`: scales with the foe's standing, plus a bonus for ending its streak. */
export function pointsForWin(opp: Ranked): number {
  return 1 + Math.floor(opp.points / 2) + opp.streak;
}

/**
 * Opponents for a challenger, lowest rank first. Only slimes holding more
 * points than the challenger qualify, except the top three which are always
 * fought. `ranked` must be sorted best-first.
 */
export function nextOpponent(ranked: Ranked[], challengerPoints: number, beaten: Set<number>): Ranked | null {
  for (let i = ranked.length - 1; i >= 0; i--) {
    const r = ranked[i]!;
    if (beaten.has(r.id)) continue;
    if (i < TOP_ALWAYS || r.points > challengerPoints) return r;
  }
  return null;
}
