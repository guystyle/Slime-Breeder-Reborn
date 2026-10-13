import type { BattleReport } from './battle.ts';
import type { Kind } from './dna.ts';
import type { Blood } from './lineage.ts';
import type { ShownStats, Stats } from './stats.ts';

/** Compact ancestry tree: `a` is the owner's side, `b` the mate's side. */
export interface Pedigree {
  id: number;
  name: string;
  gen: number;
  a?: Pedigree;
  b?: Pedigree;
  /** the mate was an unknown seed */
  unknown?: boolean;
}

export interface SlimeView {
  id: number;
  name: string;
  gen: number;
  owner: string;
  born: string;
  /** full-size stats used in battle */
  stats: Stats;
  /** the same numbers scaled for display (see `dispCut`) */
  shown: ShownStats;
  color: string;
  /** visible mutant type (cosmetic) */
  kind: Kind;
  /** four bloodline slots: mother's mother's father, mother's father, father's mother's father, father (own line) */
  lineage: Blood;
  /** lineage compatibility symbols of this birth, one per stat */
  nix: string;
  /** sprite edge in px */
  px: number;
  seeds: number;
  children: number;
  wins: number;
  losses: number;
  bestRank: number;
  points: number;
  rank: number | null; // null when not on the ladder
  defenses: number;
  pedigree: Pedigree | null;
  /** ids of ancestors that are still ranked (for linking) */
  rankedIds: number[];
}

export interface MateCandidate {
  id: number;
  rank: number;
  name: string;
  gen: number;
  /** 'hall': a legend whose lineage has left the ranking (no seed needed) */
  from: 'rank' | 'hall';
}

export type EnterResponse =
  | {
      ok: true;
      token: string;
      registered: boolean;
      /** 'mate': choose a partner for `mother`; 'fight': a newborn `pending` waits to be named */
      phase: 'mate' | 'fight';
      mother: SlimeView;
      mates: MateCandidate[];
      pending: SlimeView | null;
    }
  | { ok: false; error: string };

export interface MateResponse {
  ok: true;
  child: SlimeView;
}

export interface FightStep {
  opponent: SlimeView;
  report: BattleReport;
  won: boolean;
  /** the fight against the reigning champion */
  title: boolean;
  gained: number;
  /** on a loss: the challenger's collected points that went to the defender */
  given: number;
  total: number;
}

/** A defense match between the ladder's top challenger and the champion (not involving the player's slime). */
export interface DefenseMatch {
  challenger: SlimeView;
  champion: SlimeView;
  report: BattleReport;
  championHeld: boolean;
}

export interface FightResponse {
  ok: true;
  slime: SlimeView;
  steps: FightStep[];
  defense: DefenseMatch | null;
  finalPoints: number;
  finalRank: number | null;
}

export interface RankingResponse {
  slimes: SlimeView[];
}

export interface HallEntry {
  at: string;
  defenses: number;
  slime: SlimeView;
}

export interface CommentView {
  at: string;
  user: string;
  text: string;
}

export interface LineageRow {
  rank: number;
  no: number;
  name: string;
  /** stat the lineage favours: 0..5 = HP STM STR DEX AGL SPD */
  type: number;
  count: number;
  percent: number;
  /** founder first, then each branch, ending with this lineage */
  chain: { no: number; name: string }[];
}

export interface LineageSlime {
  slime: SlimeView;
  /** a poor match for the viewer's slime (drawn orange) */
  orange: boolean;
  /** number of different lineages a child with the viewer's slime would stand on */
  variety: number | null;
}

export interface LineageDetail {
  lineage: { no: number; name: string; type: number } | null;
  slimes: LineageSlime[];
  fromHall: boolean;
}

export interface NixTable {
  mine: Blood;
  rows: { no: number; name: string; type: number; count: number; print: string }[];
}

export interface TitleMatchLog {
  at: string;
  challenger: SlimeView;
  champion: SlimeView;
  report: BattleReport;
  championHeld: boolean;
}
