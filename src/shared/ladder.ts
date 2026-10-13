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

/**
 * Beating a slime takes over all of its points. Losing never costs points,
 * but the slime that stops a challenger's winning streak receives every point
 * the challenger had collected so far.
 */
export const pointsForWin = (opp: Ranked): number => opp.points;

/** When totals grow too large the whole ladder is divided by 10 (original behaviour). */
export const POINT_CEILING = 1_000_000_000_000;
export const normalizePoints = (pts: number[]): number[] =>
  Math.max(...pts, 0) > POINT_CEILING ? pts.map((p) => Math.max(1, Math.floor(p / 10))) : pts;

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
