import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { fight } from '../shared/battle.ts';
import { type Dna, breed, founderDna } from '../shared/dna.ts';
import { HALL_MIN_DEFENSES, MATES_SEEDS, RANK_SIZE, nextOpponent, normalizePoints, pointsForWin } from '../shared/ladder.ts';
import { type Rng } from '../shared/rng.ts';
import { deriveColor, deriveForms, deriveStats } from '../shared/stats.ts';
import type {
  CommentView,
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

export class GameError extends Error {}

interface SlimeRow {
  id: number;
  owner: string;
  name: string;
  gen: number;
  dna: string;
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

  /** Creation story: Lord Creator's first generation, so the ladder is never empty. */
  private seedLadder() {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM slimes').get() as { n: number }).n;
    if (n > 0) return;
    const names = ['Adam Jr', 'Clay', 'Gummy', 'Bubble', 'Jelly', 'Goo', 'Blobby', 'Squish', 'Pudding', 'Mochi'];
    const ins = this.db.prepare(
      'INSERT INTO slimes (owner, name, gen, dna, born, seeds, points, champ, ranked, best_rank) VALUES (?,?,?,?,?,?,?,?,1,?)',
    );
    names.forEach((name, i) =>
      ins.run('LordCreator', name, 1, JSON.stringify(founderDna(this.rng)), this.now(), MATES_SEEDS, (names.length - i) * 3, i === 0 ? 1 : 0, i + 1),
    );
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

  private view(row: SlimeRow, ladder = this.ladder()): SlimeView {
    const dna = JSON.parse(row.dna) as Dna;
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
    return {
      id: row.id,
      name: row.name,
      gen: row.gen,
      owner: row.owner,
      born: new Date(row.born).toISOString(),
      stats: deriveStats(dna),
      color: deriveColor(dna),
      forms: deriveForms(dna),
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
    const dna = founderDna(this.rng);
    const res = this.db
      .prepare('INSERT INTO slimes (owner, name, gen, dna, born, seeds, points) VALUES (?,?,?,?,?,?,1)')
      .run(owner, 'FirstChild', 0, JSON.stringify(dna), this.now(), MATES_SEEDS);
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

      const dna = breed(JSON.parse(mother.dna) as Dna, JSON.parse(mate.dna) as Dna, this.rng);
      const ped: Pedigree = {
        id: 0,
        name: 'NoNameYet',
        gen: mother.gen + 1,
      };
      const a = Game.trim(Game.pedOf(mother), 2);
      const b = Game.trim(Game.pedOf(mate), 2);
      if (a) ped.a = a;
      if (b) ped.b = b;

      const res = this.db
        .prepare(
          'INSERT INTO slimes (owner, name, gen, dna, born, seeds, points, ped) VALUES (?,?,?,?,?,?,1,?)',
        )
        .run(u.name, 'NoNameYet', mother.gen + 1, JSON.stringify(dna), this.now(), MATES_SEEDS, null);
      const id = Number(res.lastInsertRowid);
      ped.id = id;
      this.db.prepare('UPDATE slimes SET ped = ? WHERE id = ?').run(JSON.stringify(ped), id);
      this.db.prepare('UPDATE slimes SET seeds = seeds - 1, children = children + 1 WHERE id = ?').run(mate.id);
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

      const myStats = deriveStats(JSON.parse(child.dna) as Dna);
      const ladder = this.ladder();
      const champ = ladder.find((r) => r.champ) ?? null;
      const beaten = new Set<number>();
      const steps: FightStep[] = [];
      let points = 1;
      let lost = false;

      const duel = (opp: SlimeRow, title: boolean): boolean => {
        const rep = fight(child.name, myStats, opp.name, deriveStats(JSON.parse(opp.dna) as Dna), this.rng);
        const won = rep.winner === 'a';
        const gained = won ? pointsForWin(opp) : 0;
        const given = won ? 0 : points;
        points += gained;
        steps.push({ opponent: this.view(opp, ladder), report: rep, won, title, gained, given, total: points });
        if (won) {
          child.wins++;
          child.streak++;
          opp.losses++;
          opp.streak = 0;
        } else {
          child.losses++;
          child.streak = 0;
          opp.wins++;
          opp.streak++;
          opp.points += given; // the defender collects the challenger's whole run
        }
        return won;
      };

      for (let guard = 0; guard < RANK_SIZE + 5; guard++) {
        const pick = nextOpponent(ladder, points, beaten);
        if (!pick) break;
        const opp = ladder.find((r) => r.id === pick.id)!;
        beaten.add(opp.id);
        const won = duel(opp, opp.id === champ?.id);
        if (!won) {
          lost = true;
          if (opp.id === champ?.id) champ.defenses++;
          break;
        }
      }

      // Beating the reigning champion while holding more points ends the reign.
      let newChamp = false;
      if (!champ) {
        newChamp = !lost; // empty ladder: the first winner takes the crown
      } else if (!lost && points > champ.points) {
        newChamp = true;
        if (champ.defenses >= HALL_MIN_DEFENSES) this.enterHall(champ, ladder);
        champ.champ = 0;
        champ.defenses = 0;
      }

      child.points = points;
      child.champ = newChamp ? 1 : 0;
      child.ranked = 1; // provisional; trimmed below

      const save = this.db.prepare(
        'UPDATE slimes SET wins=?, losses=?, streak=?, points=?, defenses=?, champ=?, ranked=?, best_rank=? WHERE id=?',
      );
      const all = [...ladder, child];
      const scaled = normalizePoints(all.map((r) => r.points));
      all.forEach((r, i) => (r.points = scaled[i]!));
      all.sort((a, b) => b.champ - a.champ || b.points - a.points || a.id - b.id);
      all.forEach((r, i) => {
        const rank = i + 1;
        r.ranked = rank <= RANK_SIZE ? 1 : 0;
        r.best_rank = r.ranked ? (r.best_rank ? Math.min(r.best_rank, rank) : rank) : r.best_rank;
        save.run(r.wins, r.losses, r.streak, r.points, r.defenses, r.champ, r.ranked, r.best_rank, r.id);
      });

      this.db.prepare('UPDATE users SET mother_id = ?, pending_id = NULL, last_play = ?, last_seen = ? WHERE name = ?').run(
        child.id,
        this.now(),
        this.now(),
        u.name,
      );

      const after = this.ladder();
      const final = this.slime(child.id)!;
      return {
        ok: true as const,
        slime: this.view(final, after),
        steps,
        finalPoints: points,
        finalRank: this.view(final, after).rank,
      };
    });
  }

  private enterHall(champ: SlimeRow, ladder: SlimeRow[]) {
    const snap = this.view(champ, ladder);
    this.db
      .prepare('INSERT INTO hall (at, defenses, snapshot) VALUES (?,?,?)')
      .run(this.now(), champ.defenses, JSON.stringify(snap));
  }

  // ---------- read models ----------

  ranking(): SlimeView[] {
    const ladder = this.ladder();
    return ladder.map((r) => this.view(r, ladder));
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
