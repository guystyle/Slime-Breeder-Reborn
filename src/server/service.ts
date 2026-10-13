import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { type BattleReport, fight } from '../shared/battle.ts';
import { type Dna, type Kind, colorOf, eveDna, express, kindOf, mix, mutate } from '../shared/dna.ts';
import { HALL_MIN_DEFENSES, RANK_SIZE, SEED_GAGE, cutLength, mustFight, scalePoints } from '../shared/ladder.ts';
import { type Rng } from '../shared/rng.ts';
import { type Stats, deriveStats, dispCut, shownStats, spriteSize } from '../shared/stats.ts';
import type {
  CommentView,
  DefenseMatch,
  EnterResponse,
  FightResponse,
  FightStep,
  HallEntry,
  MateCandidate,
  MateResponse,
  Pedigree,
  SlimeView,
} from '../shared/types.ts';

const DAY = 86_400_000;
export const MAX_USER = 32;
export const MAX_PASS = 8;
export const MAX_SLIME_NAME = 36;
export const MAX_COMMENT = 300;
const SESSION_TTL = 3_600_000;

/** Eve, the founder every account starts with (values from the original). */
const EVE_STATS: Stats = { weight: 50, hp: 500, stm: 500, str: 50, dex: 50, agl: 50, cst: 50, sex: 50, spd: 50 };

export class GameError extends Error {}

interface SlimeRow {
  id: number;
  owner: string;
  name: string;
  gen: number;
  dna: string;
  stats: string;
  color: string;
  kind: string;
  sperm: number;
  born: number;
  seeds: number;
  children: number;
  wins: number;
  losses: number;
  best_rank: number;
  points: number;
  streak: number;
  defenses: number;
  champ: number;
  ranked: number;
  ped: string | null;
}

interface UserRow {
  name: string;
  salt: string;
  hash: string;
  created: number;
  last_play: number;
  last_seen: number;
  mother_id: number | null;
  pending_id: number | null;
}

export interface ServiceOptions {
  rng?: Rng;
  now?: () => number;
  /** minutes between plays per user; 0 disables */
  cooldownMin?: number;
  inactivityDays?: number;
  /** populate an empty database with founder slimes so the first player has mates (default true) */
  seedLadder?: boolean;
}

const statsOf = (r: SlimeRow) => JSON.parse(r.stats) as Stats;

export class Game {
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly inactivityMs: number;

  constructor(
    private readonly db: DatabaseSync,
    opts: ServiceOptions = {},
  ) {
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.cooldownMs = (opts.cooldownMin ?? 15) * 60_000;
    this.inactivityMs = (opts.inactivityDays ?? 7) * DAY;
    if (opts.seedLadder ?? true) this.seedLadder();
  }

  /** Creation story: Lord Creator's first generation (Eve x unknown seeds), so the ladder is never empty. */
  private seedLadder() {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM slimes').get() as { n: number }).n;
    if (n > 0) return;
    const names = ['Adam Jr', 'Clay', 'Gummy', 'Bubble', 'Jelly', 'Goo', 'Blobby', 'Squish', 'Pudding', 'Mochi'];
    const ins = this.db.prepare(
      'INSERT INTO slimes (owner, name, gen, dna, stats, color, kind, born, seeds, points, champ, ranked, best_rank) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)',
    );
    names.forEach((name, i) => {
      const c = this.makeChild(eveDna(), null, 50);
      ins.run('LordCreator', name, 1, JSON.stringify(c.dna), JSON.stringify(c.stats), c.color, c.kind, this.now(), Math.trunc(c.stats.sex / 10), (names.length - i) * 3, i === 0 ? 1 : 0, i + 1);
    });
  }

  // ---------- helpers ----------

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  private slime(id: number): SlimeRow | undefined {
    return this.db.prepare('SELECT * FROM slimes WHERE id = ?').get(id) as SlimeRow | undefined;
  }

  /** Ladder order: champion first, then points, then seniority. */
  private ladder(): SlimeRow[] {
    return this.db
      .prepare('SELECT * FROM slimes WHERE ranked = 1 ORDER BY champ DESC, points DESC, id ASC')
      .all() as unknown as SlimeRow[];
  }

  /** Average weight of the ranked slimes: drives gene stability, display digits and sprite scale. */
  private avgWeight(ladder: SlimeRow[]): number {
    if (!ladder.length) return 50;
    return Math.trunc(ladder.reduce((s, r) => s + statsOf(r).weight, 0) / ladder.length) || 50;
  }

  /** Breed a child: stats come from the pre-mutation genes, colour and form from the mutated ones. */
  private makeChild(owner: Dna, mate: { dna: Dna; weight: number } | null, avg: number) {
    const birth = mix(owner, mate, avg, this.rng);
    const stats = deriveStats(express(birth.dna, birth.range));
    const dna = mutate(birth.dna, this.rng);
    const p = express(dna, birth.range);
    return { dna, stats, color: colorOf(p), kind: kindOf(p) as Kind };
  }

  private view(row: SlimeRow, ladder = this.ladder(), avg = this.avgWeight(ladder)): SlimeView {
    const idx = ladder.findIndex((r) => r.id === row.id);
    const ped = row.ped ? (JSON.parse(row.ped) as Pedigree) : null;
    const rankedSet = new Set(ladder.map((r) => r.id));
    const ids: number[] = [];
    const walk = (p?: Pedigree) => {
      if (!p) return;
      if (rankedSet.has(p.id)) ids.push(p.id);
      walk(p.a);
      walk(p.b);
    };
    walk(ped ?? undefined);
    const stats = statsOf(row);
    return {
      id: row.id,
      name: row.name,
      gen: row.gen,
      owner: row.owner,
      born: new Date(row.born).toISOString(),
      stats,
      shown: shownStats(stats, dispCut(avg)),
      color: row.color,
      kind: row.kind as Kind,
      px: spriteSize(stats.weight, avg),
      seeds: row.seeds,
      children: row.children,
      wins: row.wins,
      losses: row.losses,
      bestRank: row.best_rank,
      points: row.points,
      rank: idx >= 0 ? idx + 1 : null,
      defenses: row.defenses,
      pedigree: ped,
      rankedIds: ids,
    };
  }

  private static hash(pass: string, salt: string): string {
    return scryptSync(pass, salt, 32).toString('hex');
  }

  private static trim(p: Pedigree | undefined, depth: number): Pedigree | undefined {
    if (!p) return undefined;
    const out: Pedigree = { id: p.id, name: p.name, gen: p.gen };
    if (depth > 0) {
      const a = Game.trim(p.a, depth - 1);
      const b = Game.trim(p.b, depth - 1);
      if (a) out.a = a;
      if (b) out.b = b;
    }
    return out;
  }

  private static pedOf(r: SlimeRow): Pedigree {
    const base = r.ped ? (JSON.parse(r.ped) as Pedigree) : { id: r.id, name: r.name, gen: r.gen };
    return { ...base, id: r.id, name: r.name, gen: r.gen };
  }

  private userByToken(token: string): UserRow {
    const now = this.now();
    const s = this.db.prepare('SELECT user, created FROM sessions WHERE token = ?').get(token) as
      | { user: string; created: number }
      | undefined;
    if (!s || now - s.created > SESSION_TTL) throw new GameError('Session expired. Please log in again.');
    const u = this.db.prepare('SELECT * FROM users WHERE name = ?').get(s.user) as UserRow | undefined;
    if (!u) throw new GameError('Account not found.');
    return u;
  }

  // ---------- account / flow ----------

  enter(userRaw: string, pass: string): EnterResponse {
    const user = userRaw.trim();
    if (!user || user.length > MAX_USER) throw new GameError(`Username must be 1-${MAX_USER} characters.`);
    if (!pass || pass.length > MAX_PASS) throw new GameError(`Password must be 1-${MAX_PASS} characters.`);

    return this.tx(() => {
      const now = this.now();
      let u = this.db.prepare('SELECT * FROM users WHERE name = ?').get(user) as UserRow | undefined;
      let registered = false;

      if (!u) {
        const salt = randomBytes(16).toString('hex');
        const first = this.createFounder(user);
        this.db
          .prepare(
            'INSERT INTO users (name, salt, hash, created, last_play, last_seen, mother_id) VALUES (?,?,?,?,0,?,?)',
          )
          .run(user, salt, Game.hash(pass, salt), now, now, first);
        u = this.db.prepare('SELECT * FROM users WHERE name = ?').get(user) as unknown as UserRow;
        registered = true;
      } else {
        const a = Buffer.from(Game.hash(pass, u.salt), 'hex');
        const b = Buffer.from(u.hash, 'hex');
        if (a.length !== b.length || !timingSafeEqual(a, b)) throw new GameError('Wrong password.');
      }

      if (!u.pending_id && u.last_play && now - u.last_play < this.cooldownMs) {
        const left = Math.ceil((this.cooldownMs - (now - u.last_play)) / 60_000);
        throw new GameError(`You can play once per ${this.cooldownMs / 60_000} minutes. Try again in ${left} min.`);
      }

      this.db.prepare('UPDATE users SET last_seen = ? WHERE name = ?').run(now, user);
      const token = randomBytes(24).toString('hex');
      this.db.prepare('INSERT INTO sessions (token, user, created) VALUES (?,?,?)').run(token, user, now);
      this.db.prepare('DELETE FROM sessions WHERE created < ?').run(now - SESSION_TTL);

      const ladder = this.ladder();
      const mother = this.slime(u.mother_id!)!;
      const pending = u.pending_id ? this.slime(u.pending_id)! : null;
      return {
        ok: true as const,
        token,
        registered,
        phase: pending ? ('fight' as const) : ('mate' as const),
        mother: this.view(mother, ladder),
        mates: this.mates(ladder),
        pending: pending ? this.view(pending, ladder) : null,
      };
    });
  }

  private mates(ladder: SlimeRow[]): MateCandidate[] {
    return ladder
      .map((r, i) => ({ r, rank: i + 1 }))
      .filter(({ r }) => r.seeds > 0)
      .map(({ r, rank }) => ({ id: r.id, rank, name: r.name, gen: r.gen }));
  }

  private createFounder(owner: string): number {
    const res = this.db
      .prepare('INSERT INTO slimes (owner, name, gen, dna, stats, color, kind, born, seeds, points) VALUES (?,?,?,?,?,?,?,?,?,1)')
      .run(owner, 'FirstChild', 0, JSON.stringify(eveDna()), JSON.stringify(EVE_STATS), '#7f7f7f', 'normal', this.now(), 5);
    return Number(res.lastInsertRowid);
  }

  mate(token: string, sel: number): MateResponse {
    return this.tx(() => {
      const u = this.userByToken(token);
      if (u.pending_id) throw new GameError('You already have a newborn waiting to fight.');
      const mother = this.slime(u.mother_id!)!;
      const mate = this.slime(sel);
      if (!mate || !mate.ranked) throw new GameError('That slime is not on the ranking.');
      if (mate.seeds <= 0) throw new GameError('That slime has no seeds left.');

      const ladder = this.ladder();
      const avg = this.avgWeight(ladder);
      const c = this.makeChild(JSON.parse(mother.dna) as Dna, { dna: JSON.parse(mate.dna) as Dna, weight: statsOf(mate).weight }, avg);

      const ped: Pedigree = { id: 0, name: 'NoNameYet', gen: mother.gen + 1 };
      const a = Game.trim(Game.pedOf(mother), 2);
      const b = Game.trim(Game.pedOf(mate), 2);
      if (a) ped.a = a;
      if (b) ped.b = b;

      const res = this.db
        .prepare(
          'INSERT INTO slimes (owner, name, gen, dna, stats, color, kind, born, seeds, points, ped) VALUES (?,?,?,?,?,?,?,?,?,1,?)',
        )
        .run(u.name, 'NoNameYet', mother.gen + 1, JSON.stringify(c.dna), JSON.stringify(c.stats), c.color, c.kind, this.now(), Math.trunc(c.stats.sex / 10), null);
      const id = Number(res.lastInsertRowid);
      ped.id = id;
      this.db.prepare('UPDATE slimes SET ped = ? WHERE id = ?').run(JSON.stringify(ped), id);

      // the chosen seed is spent; then every ranked slime's seed gauge advances by its SEX
      mate.seeds -= 1;
      mate.children += 1;
      const save = this.db.prepare('UPDATE slimes SET seeds = ?, children = ?, sperm = ? WHERE id = ?');
      for (const r of ladder) {
        const row = r.id === mate.id ? mate : r;
        row.sperm += statsOf(row).sex;
        if (row.sperm > SEED_GAGE) {
          row.sperm -= SEED_GAGE;
          row.seeds += 1;
        }
        save.run(row.seeds, row.children, row.sperm, row.id);
      }
      this.db.prepare('UPDATE users SET pending_id = ? WHERE name = ?').run(id, u.name);
      return { ok: true as const, child: this.view(this.slime(id)!) };
    });
  }

  fight(token: string, nameRaw: string): FightResponse {
    return this.tx(() => {
      const u = this.userByToken(token);
      if (!u.pending_id) throw new GameError('There is no newborn to fight with.');
      const name = [...nameRaw.trim()].slice(0, MAX_SLIME_NAME).join('') || 'NoNameYet';
      const child = this.slime(u.pending_id)!;
      const ped = JSON.parse(child.ped!) as Pedigree;
      ped.name = name;
      this.db.prepare('UPDATE slimes SET name = ?, ped = ? WHERE id = ?').run(name, JSON.stringify(ped), child.id);
      child.name = name;

      const ladder = this.ladder();
      const avg = this.avgWeight(ladder);
      // totals are divided down when the lowest ranked slime's points reach three digits
      const cut = cutLength(ladder.at(-1)?.points ?? 1);
      for (const r of ladder) r.points = scalePoints(r.points, cut);

      const champ = ladder[0] ?? null;
      const myStats = statsOf(child);
      const steps: FightStep[] = [];
      let points = 1;
      let lost = false;

      const duel = (opp: SlimeRow, title: boolean): boolean => {
        const rep = fight(child.name, myStats, opp.name, statsOf(opp), this.rng);
        const won = rep.winner === 'a';
        const given = won ? 0 : points;
        const gained = won ? opp.points : 0; // a victor takes over the beaten slime's points
        steps.push({ opponent: this.view(opp, ladder, avg), report: rep, won, title, gained, given, total: points + gained });
        if (won) {
          points += gained;
          child.wins++;
          child.streak++;
          opp.losses++;
        } else {
          opp.points += given; // the slime that ends a run collects everything the challenger had
          child.losses++;
          child.streak = 0;
          opp.wins++;
          if (title) opp.defenses++;
        }
        return won;
      };

      // fight upward from the bottom of the ladder until the first defeat
      for (let r = ladder.length; r >= 1 && !lost; r--) {
        const opp = ladder[r - 1]!;
        if (!mustFight(r, opp.points, points)) continue;
        if (!duel(opp, r === 1)) lost = true;
      }

      // everyone but the champion, sorted by points; ties keep the original's odd order (newcomer first, lowest rank next)
      const rest = [child, ...ladder.slice(1).reverse()];
      child.points = points;
      rest.sort((a, b) => b.points - a.points);
      const ranger = rest[0]!;

      let order: SlimeRow[];
      let defense: DefenseMatch | null = null;
      if (!champ) {
        order = rest; // empty ladder: the newcomer simply is the champion
      } else if (champ.points < ranger.points) {
        // someone out-scored the champion: either the challenger toppled them, or a title defense is played
        let dethroned = !lost;
        if (lost) {
          const rep = fight(ranger.name, statsOf(ranger), champ.name, statsOf(champ), this.rng);
          const rangerWon = rep.winner === 'a';
          defense = { challenger: this.view(ranger, ladder, avg), champion: this.view(champ, ladder, avg), report: rep, championHeld: !rangerWon };
          if (rangerWon) {
            ranger.points += champ.points;
            ranger.wins++;
            champ.losses++;
            dethroned = true;
          } else {
            champ.points += ranger.points;
            champ.wins++;
            ranger.losses++;
            champ.defenses++;
          }
        }
        const others = rest.filter((r) => r !== ranger);
        if (dethroned) {
          if (champ.defenses >= HALL_MIN_DEFENSES) this.enterHall(champ, ladder, avg);
          champ.defenses = 0;
          order = [ranger, champ, ...others];
        } else {
          order = [champ, ranger, ...others];
        }
      } else {
        order = [champ, ...rest];
      }

      const save = this.db.prepare(
        'UPDATE slimes SET wins=?, losses=?, streak=?, points=?, defenses=?, champ=?, ranked=?, best_rank=?, seeds=? WHERE id=?',
      );
      child.seeds = Math.trunc(myStats.sex / 10);
      order.forEach((r, i) => {
        const rank = i + 1;
        r.ranked = rank <= RANK_SIZE ? 1 : 0;
        r.champ = i === 0 ? 1 : 0;
        if (r.ranked) r.best_rank = r.best_rank ? Math.min(r.best_rank, rank) : rank;
        save.run(r.wins, r.losses, r.streak, r.points, r.defenses, r.champ, r.ranked, r.best_rank, r.seeds, r.id);
      });

      this.db.prepare('UPDATE users SET mother_id = ?, pending_id = NULL, last_play = ?, last_seen = ? WHERE name = ?').run(
        child.id,
        this.now(),
        this.now(),
        u.name,
      );

      const after = this.ladder();
      const final = this.slime(child.id)!;
      const fv = this.view(final, after);
      return { ok: true as const, slime: fv, steps, defense, finalPoints: points, finalRank: fv.rank };
    });
  }

  private enterHall(champ: SlimeRow, ladder: SlimeRow[], avg: number) {
    const snap = this.view(champ, ladder, avg);
    this.db
      .prepare('INSERT INTO hall (at, defenses, snapshot) VALUES (?,?,?)')
      .run(this.now(), champ.defenses, JSON.stringify(snap));
  }

  // ---------- read models ----------

  ranking(): SlimeView[] {
    const ladder = this.ladder();
    const avg = this.avgWeight(ladder);
    return ladder.map((r) => this.view(r, ladder, avg));
  }

  hall(): HallEntry[] {
    const rows = this.db.prepare('SELECT at, defenses, snapshot FROM hall ORDER BY id DESC LIMIT 100').all() as unknown as {
      at: number;
      defenses: number;
      snapshot: string;
    }[];
    return rows.map((r) => ({
      at: new Date(r.at).toISOString(),
      defenses: r.defenses,
      slime: JSON.parse(r.snapshot) as SlimeView,
    }));
  }

  comments(): CommentView[] {
    const rows = this.db.prepare('SELECT at, user, text FROM comments ORDER BY id DESC LIMIT 50').all() as unknown as {
      at: number;
      user: string;
      text: string;
    }[];
    return rows.map((r) => ({ at: new Date(r.at).toISOString(), user: r.user, text: r.text }));
  }

  addComment(userRaw: string, textRaw: string) {
    const text = [...textRaw.trim()].slice(0, MAX_COMMENT).join('');
    if (!text) throw new GameError('Write something first.');
    const user = [...(userRaw.trim() || 'Name')].slice(0, MAX_USER).join('');
    this.db.prepare('INSERT INTO comments (at, user, text) VALUES (?,?,?)').run(this.now(), user, text);
  }

  /** Delete accounts idle for over a week, together with their slimes. */
  purgeInactive(): number {
    const cutoff = this.now() - this.inactivityMs;
    return this.tx(() => {
      const gone = this.db.prepare('SELECT name FROM users WHERE last_seen < ?').all(cutoff) as unknown as { name: string }[];
      for (const { name } of gone) {
        this.db.prepare('DELETE FROM slimes WHERE owner = ?').run(name);
        this.db.prepare('DELETE FROM sessions WHERE user = ?').run(name);
        this.db.prepare('DELETE FROM users WHERE name = ?').run(name);
      }
      return gone.length;
    });
  }
}

export type { BattleReport };
