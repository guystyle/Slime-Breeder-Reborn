import type { BattleReport } from './battle.ts';
import type { Stats } from './stats.ts';

/** Compact ancestry tree: `a` is the owner's side, `b` the mate's side. */
export interface Pedigree {
  id: number;
  name: string;
  gen: number;
  a?: Pedigree;
  b?: Pedigree;
}

export interface SlimeView {
  id: number;
  name: string;
  gen: number;
  owner: string;
  born: string;
  stats: Stats;
  color: string;
  /** visible mutations (absent on very old saved snapshots) */
  forms?: ('wings' | 'metal' | 'horn')[];
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
  /** the special match against the reigning champion */
  title: boolean;
  gained: number;
  total: number;
}

export interface FightResponse {
  ok: true;
  slime: SlimeView;
  steps: FightStep[];
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
