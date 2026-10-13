/** Ladder constants (values from SLIME BREEDER plus, adjusted to the English edition's rules). */
export const RANK_SIZE = 50;
/** The top N slimes are always fought, whatever their points. */
export const ALWAYS_FOUGHT = 3;
/** A champion enters the Hall of Fame when dethroned after this many defenses or more ("more than 3"). */
export const HALL_MIN_DEFENSES = 4;
/** Mating-seed regrowth: every mating adds each ranked slime's SEX to its gauge; a full gauge grows one seed. */
export const SEED_GAGE = RANK_SIZE * 10;

/**
 * When the lowest ranked slime's points reach three digits, the whole ladder
 * is divided by 10^(digits-2), keeping totals manageable (original behaviour).
 */
export function cutLength(lowestPoints: number): number {
  return Math.max(0, String(Math.trunc(lowestPoints)).length - 2);
}
export const scalePoints = (points: number, cut: number) => Math.trunc(points / 10 ** cut);

/**
 * Whether a challenger holding `challengerPoints` must fight the slime at
 * `rank` (1-based): anyone with at least as many points, plus the top few.
 */
export const mustFight = (rank: number, opponentPoints: number, challengerPoints: number) =>
  opponentPoints >= challengerPoints || rank <= ALWAYS_FOUGHT;
