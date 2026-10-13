import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { type BattleReport, fight } from '../shared/battle.ts';
import { type ErrorCode, ERROR_TEXT } from '../shared/errors.ts';
import { type Dna, type Kind, colorOf, eveDna, express, kindOf, mix, mutate } from '../shared/dna.ts';
import { DEFAULT_COOLDOWN_MIN, HALL_MIN_DEFENSES, RANK_SIZE, SEED_GAGE, cutLength, mustFight, scalePoints } from '../shared/ladder.ts';
import { type Blood, type Lin, STAT_KEYS, affinityPrint, branchNx, inherit, nixOf, poorMatch, tidyPrint, zeroBlood } from '../shared/lineage.ts';
import { type Rng } from '../shared/rng.ts';
import type { Db, Stmt, Store } from './store.ts';
import { type Stats, deriveStats, dispCut, shownStats, spriteSize } from '../shared/stats.ts';
import type {
  CommentView,
  DefenseMatch,
  EnterResponse,
  FightResponse,
  FightStep,
  HallEntry,
  LineageDetail,
  LineageRow,
  MateCandidate,
  NixTable,
  TitleMatchLog,
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
/** A remembered login lasts this long after its last use. */
export const REMEMBER_DAYS = 90;
const MAX_REMEMBERED_DEVICES = 5;
const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** Eve, the founder every account starts with (values from the original). */
const EVE_STATS: Stats = { weight: 50, hp: 500, stm: 500, str: 50, dex: 50, agl: 50, cst: 50, sex: 50, spd: 50 };

export class GameError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly params: Record<string, string | number> = {},
  ) {
    super(ERROR_TEXT[code].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? '')));
  }
}

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
  blood: string;
  nix: string;
  hall: number;
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
  /** minutes between plays per user (default DEFAULT_COOLDOWN_MIN); 0 disables */
  cooldownMin?: number;
  inactivityDays?: number;
  /** populate an empty database with founder slimes so the first player has mates (default true) */
  seedLadder?: boolean;
}

const statsOf = (r: SlimeRow) => JSON.parse(r.stats) as Stats;
const bloodOf = (r: SlimeRow) => JSON.parse(r.blood) as Blood;
const father = (r: SlimeRow) => bloodOf(r)[3];

const scryptAsync = (pass: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => scrypt(pass, salt, 32, (err, key) => (err ? reject(err) : resolve(key))));

export class Game {
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly inactivityMs: number;
  private readonly seed: boolean;

  /** minutes between plays, for clients that explain the wait */
  get cooldownMin(): number {
    return this.cooldownMs / 60_000;
  }

  private constructor(
    private readonly db: Db,
    opts: ServiceOptions = {},
  ) {
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.cooldownMs = (opts.cooldownMin ?? DEFAULT_COOLDOWN_MIN) * 60_000;
    this.inactivityMs = (opts.inactivityDays ?? 7) * DAY;
    this.seed = opts.seedLadder ?? true;
  }

  /** The schema must already exist (see `initSchema`). Seeds an empty world unless disabled. */
  static async create(db: Db, opts: ServiceOptions = {}): Promise<Game> {
    const g = new Game(db, opts);
    if (g.seed) await g.seedLadder();
    return g;
  }

  /** Creation story: Lord Creator's first generation (Eve x unknown seeds), each founding a lineage, so the ladder is never empty. */
  private async seedLadder() {
    await this.db.tx(async (s) => {
      const n = (await s.get<{ n: number }>('SELECT COUNT(*) AS n FROM slimes'))!.n;
      if (n > 0) return;
      const names = ['Adam Jr', 'Clay', 'Gummy', 'Bubble', 'Jelly', 'Goo', 'Blobby', 'Squish', 'Pudding', 'Mochi'];
      const stmts: Stmt[] = [];
      let id = await this.nextSlimeId(s);
      names.forEach((name, i) => {
        const c = this.makeChild(eveDna(), null, 50, zeroBlood(), null, id);
        c.blood[3].name = name;
        stmts.push(this.lineageStmt(c.blood[3]));
        stmts.push({
          sql: 'INSERT INTO slimes (owner, name, gen, dna, stats, color, kind, blood, nix, born, seeds, points, champ, ranked, best_rank) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)',
          args: ['LordCreator', name, 1, JSON.stringify(c.dna), JSON.stringify(c.stats), c.color, c.kind, JSON.stringify(c.blood), c.nix, this.now(), Math.trunc(c.stats.sex / 10), (names.length - i) * 3, i === 0 ? 1 : 0, i + 1],
        });
        id++;
      });
      await s.batch(stmts);
    });
  }

  private async nextSlimeId(s: Store): Promise<number> {
    const r = await s.get<{ seq: number }>("SELECT seq FROM sqlite_sequence WHERE name = 'slimes'");
    return (r?.seq ?? 0) + 1;
  }

  private lineageStmt(l: Lin, old: Lin[] = []): Stmt {
    return { sql: 'INSERT OR REPLACE INTO lineages (no, name, nx, old) VALUES (?,?,?,?)', args: [l.no, l.name, l.nx, JSON.stringify(old)] };
  }

  private async lineageOld(s: Store, no: number): Promise<Lin[]> {
    const r = await s.get<{ old: string }>('SELECT old FROM lineages WHERE no = ?', [no]);
    return r ? (JSON.parse(r.old) as Lin[]) : [];
  }

  // ---------- helpers ----------

  private slime(s: Store, id: number): Promise<SlimeRow | undefined> {
    return s.get<SlimeRow>('SELECT * FROM slimes WHERE id = ?', [id]);
  }

  /** Ladder order: champion first, then points, then seniority. */
  private ladder(s: Store): Promise<SlimeRow[]> {
    return s.all<SlimeRow>('SELECT * FROM slimes WHERE ranked = 1 ORDER BY champ DESC, points DESC, id ASC');
  }

  /** Average weight of the ranked slimes: drives gene stability, display digits and sprite scale. */
  private avgWeight(ladder: SlimeRow[]): number {
    if (!ladder.length) return 50;
    return Math.trunc(ladder.reduce((sum, r) => sum + statsOf(r).weight, 0) / ladder.length) || 50;
  }

  /** Breed a child: stats come from the pre-mutation genes (and the lineage "nicks"), colour and form from the mutated ones. */
  private makeChild(owner: Dna, mate: { dna: Dna; weight: number } | null, avg: number, motherBlood: Blood, fatherBlood: Blood | null, newNo: number) {
    const birth = mix(owner, mate, avg, this.rng);
    const { blood, variety } = inherit(motherBlood, fatherBlood, newNo, this.rng);
    const nix = nixOf(blood, variety);
    const stats = deriveStats(express(birth.dna, birth.range), nix.mult);
    const dna = mutate(birth.dna, this.rng);
    const p = express(dna, birth.range);
    return { dna, stats, color: colorOf(p), kind: kindOf(p) as Kind, blood, nix: nix.print };
  }

  private view(row: SlimeRow, ladder: SlimeRow[], avg: number): SlimeView {
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
      lineage: bloodOf(row),
      nix: tidyPrint(row.nix),
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

  private static async hash(pass: string, salt: string): Promise<string> {
    return (await scryptAsync(pass, salt)).toString('hex');
  }

  private static async verify(pass: string, u: UserRow): Promise<boolean> {
    const a = await scryptAsync(pass, u.salt);
    const b = Buffer.from(u.hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
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

  private async userByToken(s: Store, token: string): Promise<UserRow> {
    const now = this.now();
    const sess = await s.get<{ user: string; created: number }>('SELECT user, created FROM sessions WHERE token = ?', [token]);
    if (!sess || now - sess.created > SESSION_TTL) throw new GameError('session');
    const u = await s.get<UserRow>('SELECT * FROM users WHERE name = ?', [sess.user]);
    if (!u) throw new GameError('no-account');
    return u;
  }

  // ---------- account / flow ----------

  async enter(userRaw: string, pass: string): Promise<EnterResponse> {
    return (await this.enterRemember(userRaw, pass, false)).res;
  }

  /**
   * Log in (registering a new account on first use). With `remember`, also returns a long-lived
   * device token to be stored in an HttpOnly cookie, so the password need not be typed again.
   */
  async enterRemember(userRaw: string, pass: string, remember: boolean): Promise<{ res: EnterResponse; remember: string | null }> {
    const user = userRaw.trim();
    if (!user || user.length > MAX_USER) throw new GameError('bad-user');
    if (!pass || pass.length > MAX_PASS) throw new GameError('bad-pass');

    // password hashing is slow: do it before taking the write lock
    const existing = await this.db.get<UserRow>('SELECT * FROM users WHERE name = ?', [user]);
    let fresh: { salt: string; hash: string } | null = null;
    if (existing) {
      if (!(await Game.verify(pass, existing))) throw new GameError('wrong-pass');
    } else {
      const salt = randomBytes(16).toString('hex');
      fresh = { salt, hash: await Game.hash(pass, salt) };
    }

    let token: string | null = null;
    const res = await this.db.tx(async (s) => {
      const now = this.now();
      let u = await s.get<UserRow>('SELECT * FROM users WHERE name = ?', [user]);
      let registered = false;

      if (!u) {
        if (!fresh) throw new GameError('no-account'); // the account was removed meanwhile
        const first = await this.createFounder(s, user);
        await s.run('INSERT INTO users (name, salt, hash, created, last_play, last_seen, mother_id) VALUES (?,?,?,?,0,?,?)', [user, fresh.salt, fresh.hash, now, now, first]);
        u = (await s.get<UserRow>('SELECT * FROM users WHERE name = ?', [user]))!;
        registered = true;
      } else if (fresh) {
        // someone registered this name while we were hashing: it is not ours, treat as a wrong password
        throw new GameError('wrong-pass');
      }

      const out = await this.openSession(s, u, registered);
      if (remember) token = await this.issueRemember(s, u.name);
      return out;
    });
    return { res, remember: token };
  }

  /** Continue with a remembered device token (no password). Throws 'no-login' when it is unknown or expired. */
  async resume(rawToken: string): Promise<EnterResponse> {
    return this.db.tx(async (s) => {
      const u = await this.userByRemember(s, rawToken);
      if (!u) throw new GameError('no-login');
      return this.openSession(s, u, false);
    });
  }

  /** Who a remembered token belongs to, without starting a session (so it works during the cooldown). */
  async whoami(rawToken: string): Promise<string | null> {
    if (!rawToken) return null;
    const u = await this.userByRemember(this.db, rawToken, false);
    return u?.name ?? null;
  }

  /** Forget this device. */
  async forget(rawToken: string): Promise<void> {
    if (rawToken) await this.db.run('DELETE FROM remember WHERE token_hash = ?', [hashToken(rawToken)]);
  }

  private async issueRemember(s: Store, user: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    const now = this.now();
    await s.batch([
      { sql: 'INSERT INTO remember (token_hash, user, created, last_used) VALUES (?,?,?,?)', args: [hashToken(raw), user, now, now] },
      { sql: 'DELETE FROM remember WHERE last_used < ?', args: [now - REMEMBER_DAYS * DAY] },
      // only the newest few devices stay logged in
      {
        sql: 'DELETE FROM remember WHERE user = ? AND token_hash NOT IN (SELECT token_hash FROM remember WHERE user = ? ORDER BY last_used DESC LIMIT ?)',
        args: [user, user, MAX_REMEMBERED_DEVICES],
      },
    ]);
    return raw;
  }

  private async userByRemember(s: Store, rawToken: string, touch = true): Promise<UserRow | undefined> {
    if (!rawToken || rawToken.length > 200) return undefined;
    const now = this.now();
    const row = await s.get<{ user: string; last_used: number }>('SELECT user, last_used FROM remember WHERE token_hash = ?', [hashToken(rawToken)]);
    if (!row || now - row.last_used > REMEMBER_DAYS * DAY) return undefined;
    const u = await s.get<UserRow>('SELECT * FROM users WHERE name = ?', [row.user]);
    if (u && touch) await s.run('UPDATE remember SET last_used = ? WHERE token_hash = ?', [now, hashToken(rawToken)]);
    return u;
  }

  /** After authentication: enforce the wait between plays, start a session and assemble the play screen. */
  private async openSession(s: Store, u: UserRow, registered: boolean): Promise<EnterResponse> {
    const now = this.now();
    if (!u.pending_id && u.last_play && now - u.last_play < this.cooldownMs) {
      const leftMs = this.cooldownMs - (now - u.last_play);
      throw new GameError('cooldown', { every: this.cooldownMs / 60_000, left: Math.ceil(leftMs / 60_000), leftSec: Math.ceil(leftMs / 1000) });
    }
    const token = randomBytes(24).toString('hex');
    await s.batch([
      { sql: 'UPDATE users SET last_seen = ? WHERE name = ?', args: [now, u.name] },
      { sql: 'INSERT INTO sessions (token, user, created) VALUES (?,?,?)', args: [token, u.name, now] },
      { sql: 'DELETE FROM sessions WHERE created < ?', args: [now - SESSION_TTL] },
    ]);

    const ladder = await this.ladder(s);
    const avg = this.avgWeight(ladder);
    const mother = (await this.slime(s, u.mother_id!))!;
    const pending = u.pending_id ? (await this.slime(s, u.pending_id))! : null;
    return {
      ok: true as const,
      token,
      registered,
      phase: pending ? ('fight' as const) : ('mate' as const),
      mother: this.view(mother, ladder, avg),
      mates: await this.mates(s, ladder),
      pending: pending ? this.view(pending, ladder, avg) : null,
    };
  }

  /** Slimes on the ladder with seeds left, plus Hall of Fame legends whose lineage has died out of the ranking. */
  private async mates(s: Store, ladder: SlimeRow[]): Promise<MateCandidate[]> {
    const list: MateCandidate[] = ladder
      .map((r, i) => ({ r, rank: i + 1 }))
      .filter(({ r }) => r.seeds > 0)
      .map(({ r, rank }) => ({ id: r.id, rank, name: r.name, gen: r.gen, from: 'rank' as const }));
    const alive = new Set(ladder.map((r) => father(r).no));
    const legends = await s.all<SlimeRow>('SELECT * FROM slimes WHERE hall = 1 ORDER BY id DESC');
    for (const r of legends) if (!r.ranked && !alive.has(father(r).no)) list.push({ id: r.id, rank: 0, name: r.name, gen: r.gen, from: 'hall' });
    return list;
  }

  private async createFounder(s: Store, owner: string): Promise<number> {
    const res = await s.run(
      'INSERT INTO slimes (owner, name, gen, dna, stats, color, kind, blood, born, seeds, points) VALUES (?,?,?,?,?,?,?,?,?,?,1)',
      [owner, 'FirstChild', 0, JSON.stringify(eveDna()), JSON.stringify(EVE_STATS), '#7f7f7f', 'normal', JSON.stringify(zeroBlood()), this.now(), 5],
    );
    return res.lastInsertRowid;
  }

  /** `sel` is a slime id, or 'no' for an unknown seed (which founds a new lineage). */
  async mate(token: string, sel: number | 'no'): Promise<MateResponse> {
    return this.db.tx(async (s) => {
      const u = await this.userByToken(s, token);
      if (u.pending_id) throw new GameError('pending');
      const mother = (await this.slime(s, u.mother_id!))!;
      const ladder = await this.ladder(s);
      const avg = this.avgWeight(ladder);
      let mate: SlimeRow | undefined;
      let spendsSeed = false;
      if (sel !== 'no') {
        mate = await this.slime(s, Number(sel));
        if (!mate) throw new GameError('not-ranked');
        if (mate.ranked) {
          if (mate.seeds <= 0) throw new GameError('no-seeds');
          spendsSeed = true;
        } else if (!(mate.hall && !ladder.some((r) => father(r).no === father(mate!).no))) {
          throw new GameError('not-ranked'); // only lineage-less legends may be used from the Hall of Fame
        }
      }

      const newNo = await this.nextSlimeId(s);
      const c = this.makeChild(
        JSON.parse(mother.dna) as Dna,
        mate ? { dna: JSON.parse(mate.dna) as Dna, weight: statsOf(mate).weight } : null,
        avg,
        bloodOf(mother),
        mate ? bloodOf(mate) : null,
        newNo,
      );

      const ped: Pedigree = { id: newNo, name: 'NoNameYet', gen: mother.gen + 1 };
      const a = Game.trim(Game.pedOf(mother), 2);
      const b = mate ? Game.trim(Game.pedOf(mate), 2) : ({ id: 0, name: '', gen: 0, unknown: true } as Pedigree);
      if (a) ped.a = a;
      if (b) ped.b = b;

      const res = await s.run(
        'INSERT INTO slimes (owner, name, gen, dna, stats, color, kind, blood, nix, born, seeds, points, ped) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)',
        [u.name, 'NoNameYet', mother.gen + 1, JSON.stringify(c.dna), JSON.stringify(c.stats), c.color, c.kind, JSON.stringify(c.blood), c.nix, this.now(), Math.trunc(c.stats.sex / 10), JSON.stringify(ped)],
      );
      const id = res.lastInsertRowid;

      // the chosen seed is spent; then every ranked slime's seed gauge advances by its SEX
      if (mate && spendsSeed) {
        mate.seeds -= 1;
        mate.children += 1;
      }
      const stmts: Stmt[] = [];
      for (const r of ladder) {
        const row = mate && r.id === mate.id ? mate : r;
        row.sperm += statsOf(row).sex;
        if (row.sperm > SEED_GAGE) {
          row.sperm -= SEED_GAGE;
          row.seeds += 1;
        }
        stmts.push({ sql: 'UPDATE slimes SET seeds = ?, children = ?, sperm = ? WHERE id = ?', args: [row.seeds, row.children, row.sperm, row.id] });
      }
      stmts.push({ sql: 'UPDATE users SET pending_id = ? WHERE name = ?', args: [id, u.name] });
      await s.batch(stmts);
      return { ok: true as const, child: this.view((await this.slime(s, id))!, ladder, avg) };
    });
  }

  async fight(token: string, nameRaw: string): Promise<FightResponse> {
    return this.db.tx(async (s) => {
      const u = await this.userByToken(s, token);
      if (!u.pending_id) throw new GameError('no-newborn');
      const name = [...nameRaw.trim()].slice(0, MAX_SLIME_NAME).join('') || 'NoNameYet';
      const child = (await this.slime(s, u.pending_id))!;
      const ped = JSON.parse(child.ped!) as Pedigree;
      ped.name = name;
      const pre: Stmt[] = [{ sql: 'UPDATE slimes SET name = ?, ped = ? WHERE id = ?', args: [name, JSON.stringify(ped), child.id] }];
      child.name = name;
      // a newborn from an unknown seed names its new lineage after itself
      const blood = bloodOf(child);
      if (blood[3].no !== 0 && !blood[3].name) {
        blood[3].name = name;
        pre.push(this.lineageStmt(blood[3]));
      }

      const ladder = await this.ladder(s);
      const avg = this.avgWeight(ladder);
      // totals are divided down when the lowest ranked slime's points reach three digits
      const cut = cutLength(ladder.at(-1)?.points ?? 1);
      for (const r of ladder) r.points = scalePoints(r.points, cut);

      const champ = ladder[0] ?? null;
      const myStats = statsOf(child);
      const steps: FightStep[] = [];
      const logs: TitleMatchLog[] = [];
      const log = (challenger: SlimeView, champion: SlimeView, report: BattleReport, held: boolean) =>
        logs.push({ at: new Date(this.now()).toISOString(), challenger, champion, report, championHeld: held });
      let points = 1;
      let lost = false;

      const duel = (opp: SlimeRow, title: boolean): boolean => {
        const rep = fight(child.name, myStats, opp.name, statsOf(opp), this.rng);
        const won = rep.winner === 'a';
        const given = won ? 0 : points;
        const gained = won ? opp.points : 0; // a victor takes over the beaten slime's points
        steps.push({ opponent: this.view(opp, ladder, avg), report: rep, won, title, gained, given, total: points + gained });
        if (title) log(this.view(child, ladder, avg), this.view(opp, ladder, avg), rep, !won);
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
        const won = duel(opp, r === 1);
        if (!won) lost = true;
        else if (r === 1 && blood[3].name) {
          // beaten the whole ladder: a new branch lineage is born, named after the new champion
          const old = blood[3];
          const next: Lin = { no: child.id, name, nx: branchNx(old.nx, this.rng) };
          pre.push(this.lineageStmt(next, [...(await this.lineageOld(s, old.no)), old]));
          blood[3] = next;
        }
      }
      pre.push({ sql: 'UPDATE slimes SET blood = ? WHERE id = ?', args: [JSON.stringify(blood), child.id] });
      child.blood = JSON.stringify(blood);

      // everyone but the champion, sorted by points; ties keep the original's odd order (newcomer first, lowest rank next)
      const rest = [child, ...ladder.slice(1).reverse()];
      child.points = points;
      rest.sort((a, b) => b.points - a.points);
      const ranger = rest[0]!;

      let order: SlimeRow[];
      let defense: DefenseMatch | null = null;
      const post: Stmt[] = [];
      if (!champ) {
        order = rest; // empty ladder: the newcomer simply is the champion
      } else if (champ.points < ranger.points) {
        // someone out-scored the champion: either the challenger toppled them, or a title defense is played
        let dethroned = !lost;
        if (lost) {
          const rep = fight(ranger.name, statsOf(ranger), champ.name, statsOf(champ), this.rng);
          const rangerWon = rep.winner === 'a';
          defense = { challenger: this.view(ranger, ladder, avg), champion: this.view(champ, ladder, avg), report: rep, championHeld: !rangerWon };
          log(defense.challenger, defense.champion, rep, !rangerWon);
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
          if (champ.defenses >= HALL_MIN_DEFENSES) post.push(...(await this.hallStmts(s, champ, this.view(champ, ladder, avg))));
          champ.defenses = 0;
          order = [ranger, champ, ...others];
        } else {
          order = [champ, ranger, ...others];
        }
      } else {
        order = [champ, ...rest];
      }

      child.seeds = Math.trunc(myStats.sex / 10);
      const saves: Stmt[] = order.map((r, i) => {
        const rank = i + 1;
        r.ranked = rank <= RANK_SIZE ? 1 : 0;
        r.champ = i === 0 ? 1 : 0;
        if (r.ranked) r.best_rank = r.best_rank ? Math.min(r.best_rank, rank) : rank;
        return {
          sql: 'UPDATE slimes SET wins=?, losses=?, streak=?, points=?, defenses=?, champ=?, ranked=?, best_rank=?, seeds=? WHERE id=?',
          args: [r.wins, r.losses, r.streak, r.points, r.defenses, r.champ, r.ranked, r.best_rank, r.seeds, r.id],
        };
      });
      const tm: Stmt[] = logs.map((l) => ({ sql: 'INSERT INTO title_matches (at, data) VALUES (?,?)', args: [this.now(), JSON.stringify(l)] }));
      if (tm.length) tm.push({ sql: 'DELETE FROM title_matches WHERE id <= (SELECT MAX(id) FROM title_matches) - 30' });
      await s.batch([
        ...pre,
        ...saves,
        ...post,
        ...tm,
        { sql: 'UPDATE users SET mother_id = ?, pending_id = NULL, last_play = ?, last_seen = ? WHERE name = ?', args: [child.id, this.now(), this.now(), u.name] },
      ]);

      const after = await this.ladder(s);
      const final = (await this.slime(s, child.id))!;
      const fv = this.view(final, after, this.avgWeight(after));
      return { ok: true as const, slime: fv, steps, defense, finalPoints: points, finalRank: fv.rank };
    });
  }

  /** Legends stay in the database (and can be mated with once their lineage has left the ranking). */
  private async hallStmts(s: Store, champ: SlimeRow, snapshot: SlimeView): Promise<Stmt[]> {
    const snap = JSON.stringify(snapshot);
    const have = await s.get<{ id: number }>('SELECT id FROM hall WHERE slime_id = ?', [champ.id]);
    return [
      have
        ? { sql: 'UPDATE hall SET at = ?, defenses = ?, snapshot = ? WHERE id = ?', args: [this.now(), champ.defenses, snap, have.id] }
        : { sql: 'INSERT INTO hall (at, defenses, slime_id, snapshot) VALUES (?,?,?,?)', args: [this.now(), champ.defenses, champ.id, snap] },
      { sql: 'UPDATE slimes SET hall = 1 WHERE id = ?', args: [champ.id] },
      // a congratulation on the title screen; the client renders '@hall' notes in the viewer's language
      { sql: 'INSERT INTO comments (at, user, text) VALUES (?,?,?)', args: [this.now(), '@hall', `${champ.name}|${champ.gen}|${champ.owner}`] },
    ];
  }

  // ---------- read models ----------

  async ranking(): Promise<SlimeView[]> {
    const ladder = await this.ladder(this.db);
    const avg = this.avgWeight(ladder);
    return ladder.map((r) => this.view(r, ladder, avg));
  }

  async hall(): Promise<HallEntry[]> {
    const rows = await this.db.all<{ at: number; defenses: number; snapshot: string }>('SELECT at, defenses, snapshot FROM hall ORDER BY id DESC LIMIT 100');
    return rows.map((r) => ({ at: new Date(r.at).toISOString(), defenses: r.defenses, slime: JSON.parse(r.snapshot) as SlimeView }));
  }

  async titleMatches(): Promise<TitleMatchLog[]> {
    const rows = await this.db.all<{ data: string }>('SELECT data FROM title_matches ORDER BY id DESC LIMIT 30');
    return rows.map((r) => JSON.parse(r.data) as TitleMatchLog);
  }

  /** Lineage census: ranked slimes per lineage (own line = slot 3), with their branch ancestry. */
  async lineages(): Promise<LineageRow[]> {
    const ladder = await this.ladder(this.db);
    const count = new Map<number, number>();
    for (const r of ladder) {
      const l = father(r);
      if (l.no !== 0) count.set(l.no, (count.get(l.no) ?? 0) + 1);
    }
    const regs = await this.db.all<{ no: number; name: string; nx: string; old: string }>('SELECT no, name, nx, old FROM lineages');
    const byNo = new Map(regs.map((r) => [r.no, r]));
    const rows: LineageRow[] = [];
    for (const [no, cnt] of [...count.entries()].sort((a, b) => b[1] - a[1])) {
      const reg = byNo.get(no);
      if (!reg) continue;
      rows.push({
        rank: 0,
        no,
        name: reg.name,
        type: Number(reg.nx[6] ?? 0),
        count: cnt,
        percent: Math.trunc((cnt / (ladder.length || 1)) * 100),
        chain: [...(JSON.parse(reg.old) as Lin[]).map((o) => ({ no: o.no, name: o.name })), { no, name: reg.name }],
      });
    }
    rows.forEach((r, i) => (r.rank = i + 1));
    return rows;
  }

  /** Slimes of one lineage; with a session token, also flags poor matches for that player's slime. */
  async lineage(no: number, token?: string): Promise<LineageDetail> {
    const ladder = await this.ladder(this.db);
    const avg = this.avgWeight(ladder);
    let viewer: Blood | null = null;
    if (token) {
      const u = await this.userByToken(this.db, token);
      viewer = bloodOf((await this.slime(this.db, u.mother_id!))!);
    }
    let rows = ladder.filter((r) => father(r).no === no);
    let fromHall = false;
    if (!rows.length) {
      rows = (await this.db.all<SlimeRow>('SELECT * FROM slimes WHERE hall = 1 ORDER BY id DESC')).filter((r) => father(r).no === no);
      fromHall = rows.length > 0;
    }
    const reg = await this.db.get<{ name: string; nx: string }>('SELECT name, nx FROM lineages WHERE no = ?', [no]);
    const slimes = rows.map((r) => {
      const b = bloodOf(r);
      let variety: number | null = null;
      if (viewer) {
        const seen = new Set<number>([viewer[0].no, viewer[1].no, viewer[2].no, viewer[3].no]);
        variety = seen.size;
        for (const l of b) if (!seen.has(l.no)) (seen.add(l.no), variety++);
      }
      return { slime: this.view(r, ladder, avg), orange: viewer ? poorMatch(b, viewer) : false, variety };
    });
    return { lineage: reg ? { no, name: reg.name, type: Number(reg.nx[6] ?? 0) } : null, slimes, fromHall };
  }

  /** "Lineage compatibility list" for the player's slime against every lineage still alive. */
  async nixTable(token: string): Promise<NixTable> {
    const u = await this.userByToken(this.db, token);
    const mine = bloodOf((await this.slime(this.db, u.mother_id!))!);
    const ladder = await this.ladder(this.db);
    const count = new Map<number, number>();
    for (const r of ladder) count.set(father(r).no, (count.get(father(r).no) ?? 0) + 1);
    for (const r of await this.db.all<SlimeRow>('SELECT * FROM slimes WHERE hall = 1')) if (!count.has(father(r).no)) count.set(father(r).no, 0);
    const regs = await this.db.all<{ no: number; name: string; nx: string }>('SELECT no, name, nx FROM lineages');
    const byNo = new Map(regs.map((r) => [r.no, r]));
    const rows: NixTable['rows'] = [];
    for (const [no, cnt] of [...count.entries()].sort((a, b) => b[1] - a[1])) {
      const reg = byNo.get(no);
      if (!reg || no === 0) continue;
      rows.push({ no, name: reg.name, type: Number(reg.nx[6] ?? 0), count: cnt, print: affinityPrint(mine, { no, name: reg.name, nx: reg.nx }) });
    }
    return { mine, rows };
  }

  async comments(): Promise<CommentView[]> {
    const rows = await this.db.all<{ at: number; user: string; text: string }>('SELECT at, user, text FROM comments ORDER BY id DESC LIMIT 50');
    return rows.map((r) => ({ at: new Date(r.at).toISOString(), user: r.user, text: r.text }));
  }

  async addComment(userRaw: string, textRaw: string): Promise<void> {
    const text = [...textRaw.trim()].slice(0, MAX_COMMENT).join('');
    if (!text) throw new GameError('empty-comment');
    // '@' names are reserved for system notes such as the Hall of Fame congratulation
    const user = [...(userRaw.trim().replace(/^@+/, '') || 'Name')].slice(0, MAX_USER).join('');
    await this.db.run('INSERT INTO comments (at, user, text) VALUES (?,?,?)', [this.now(), user, text]);
  }

  /** Delete accounts idle for over a week; their slimes stay while ranked or enshrined, the rest go. */
  async purgeInactive(): Promise<number> {
    const cutoff = this.now() - this.inactivityMs;
    return this.db.tx(async (s) => {
      const gone = await s.all<{ name: string }>('SELECT name FROM users WHERE last_seen < ?', [cutoff]);
      const stmts: Stmt[] = [];
      for (const { name } of gone) {
        stmts.push({ sql: 'DELETE FROM slimes WHERE owner = ? AND ranked = 0 AND hall = 0', args: [name] });
        stmts.push({ sql: 'DELETE FROM sessions WHERE user = ?', args: [name] });
        stmts.push({ sql: 'DELETE FROM remember WHERE user = ?', args: [name] });
        stmts.push({ sql: 'DELETE FROM users WHERE name = ?', args: [name] });
      }
      await s.batch(stmts);
      return gone.length;
    });
  }
}

export type { BattleReport };
