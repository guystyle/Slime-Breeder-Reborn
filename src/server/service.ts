import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { type BattleReport, fight } from '../shared/battle.ts';
import { type ErrorCode, ERROR_TEXT } from '../shared/errors.ts';
import { type Dna, type Kind, colorOf, eveDna, express, kindOf, mix, mutate } from '../shared/dna.ts';
import { HALL_MIN_DEFENSES, RANK_SIZE, SEED_GAGE, cutLength, mustFight, scalePoints } from '../shared/ladder.ts';
import { type Blood, type Lin, STAT_KEYS, affinityPrint, branchNx, inherit, nixOf, poorMatch, zeroBlood } from '../shared/lineage.ts';
import { type Rng } from '../shared/rng.ts';
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
  /** minutes between plays per user; 0 disables */
  cooldownMin?: number;
  inactivityDays?: number;
  /** populate an empty database with founder slimes so the first player has mates (default true) */
  seedLadder?: boolean;
}

const statsOf = (r: SlimeRow) => JSON.parse(r.stats) as Stats;
const bloodOf = (r: SlimeRow) => JSON.parse(r.blood) as Blood;
const father = (r: SlimeRow) => bloodOf(r)[3];

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

  /** Creation story: Lord Creator's first generation (Eve x unknown seeds), each founding a lineage, so the ladder is never empty. */
  private seedLadder() {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM slimes').get() as { n: number }).n;
    if (n > 0) return;
    const names = ['Adam Jr', 'Clay', 'Gummy', 'Bubble', 'Jelly', 'Goo', 'Blobby', 'Squish', 'Pudding', 'Mochi'];
    const ins = this.db.prepare(
      'INSERT INTO slimes (owner, name, gen, dna, stats, color, kind, blood, nix, born, seeds, points, champ, ranked, best_rank) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)',
    );
    names.forEach((name, i) => {
      const c = this.makeChild(eveDna(), null, 50, zeroBlood(), null, this.nextSlimeId());
      c.blood[3].name = name;
      this.registerLineage(c.blood[3]);
      ins.run('LordCreator', name, 1, JSON.stringify(c.dna), JSON.stringify(c.stats), c.color, c.kind, JSON.stringify(c.blood), c.nix, this.now(), Math.trunc(c.stats.sex / 10), (names.length - i) * 3, i === 0 ? 1 : 0, i + 1);
    });
  }

  private nextSlimeId(): number {
    const r = this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'slimes'").get() as { seq: number } | undefined;
    return (r?.seq ?? 0) + 1;
  }

  private registerLineage(l: Lin, old: Lin[] = []) {
    this.db.prepare('INSERT OR REPLACE INTO lineages (no, name, nx, old) VALUES (?,?,?,?)').run(l.no, l.name, l.nx, JSON.stringify(old));
  }

  private lineageOld(no: number): Lin[] {
    const r = this.db.prepare('SELECT old FROM lineages WHERE no = ?').get(no) as { old: string } | undefined;
    return r ? (JSON.parse(r.old) as Lin[]) : [];
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
      lineage: bloodOf(row),
      nix: row.nix,
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
    if (!s || now - s.created > SESSION_TTL) throw new GameError('session');
    const u = this.db.prepare('SELECT * FROM users WHERE name = ?').get(s.user) as UserRow | undefined;
    if (!u) throw new GameError('no-account');
    return u;
  }

  // ---------- account / flow ----------

  enter(userRaw: string, pass: string): EnterResponse {
    const user = userRaw.trim();
    if (!user || user.length > MAX_USER) throw new GameError('bad-user');
    if (!pass || pass.length > MAX_PASS) throw new GameError('bad-pass');

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
        if (a.length !== b.length || !timingSafeEqual(a, b)) throw new GameError('wrong-pass');
      }

      if (!u.pending_id && u.last_play && now - u.last_play < this.cooldownMs) {
        const left = Math.ceil((this.cooldownMs - (now - u.last_play)) / 60_000);
        throw new GameError('cooldown', { every: this.cooldownMs / 60_000, left });
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

  /** Slimes on the ladder with seeds left, plus Hall of Fame legends whose lineage has died out of the ranking. */
  private mates(ladder: SlimeRow[]): MateCandidate[] {
    const list: MateCandidate[] = ladder
      .map((r, i) => ({ r, rank: i + 1 }))
      .filter(({ r }) => r.seeds > 0)
      .map(({ r, rank }) => ({ id: r.id, rank, name: r.name, gen: r.gen, from: 'rank' as const }));
    const alive = new Set(ladder.map((r) => father(r).no));
    const legends = this.db.prepare('SELECT * FROM slimes WHERE hall = 1 ORDER BY id DESC').all() as unknown as SlimeRow[];
    for (const r of legends) if (!r.ranked && !alive.has(father(r).no)) list.push({ id: r.id, rank: 0, name: r.name, gen: r.gen, from: 'hall' });
    return list;
  }

  private createFounder(owner: string): number {
    const res = this.db
      .prepare('INSERT INTO slimes (owner, name, gen, dna, stats, color, kind, blood, born, seeds, points) VALUES (?,?,?,?,?,?,?,?,?,?,1)')
      .run(owner, 'FirstChild', 0, JSON.stringify(eveDna()), JSON.stringify(EVE_STATS), '#7f7f7f', 'normal', JSON.stringify(zeroBlood()), this.now(), 5);
    return Number(res.lastInsertRowid);
  }

  /** `sel` is a slime id, or 'no' for an unknown seed (which founds a new lineage). */
  mate(token: string, sel: number | 'no'): MateResponse {
    return this.tx(() => {
      const u = this.userByToken(token);
      if (u.pending_id) throw new GameError('pending');
      const mother = this.slime(u.mother_id!)!;
      const ladder = this.ladder();
      const avg = this.avgWeight(ladder);
      let mate: SlimeRow | undefined;
      let spendsSeed = false;
      if (sel !== 'no') {
        mate = this.slime(Number(sel));
        if (!mate) throw new GameError('not-ranked');
        if (mate.ranked) {
          if (mate.seeds <= 0) throw new GameError('no-seeds');
          spendsSeed = true;
        } else if (!(mate.hall && !ladder.some((r) => father(r).no === father(mate!).no))) {
          throw new GameError('not-ranked'); // only lineage-less legends may be used from the Hall of Fame
        }
      }

      const newNo = this.nextSlimeId();
      const c = this.makeChild(
        JSON.parse(mother.dna) as Dna,
        mate ? { dna: JSON.parse(mate.dna) as Dna, weight: statsOf(mate).weight } : null,
        avg,
        bloodOf(mother),
        mate ? bloodOf(mate) : null,
        newNo,
      );

      const ped: Pedigree = { id: 0, name: 'NoNameYet', gen: mother.gen + 1 };
      const a = Game.trim(Game.pedOf(mother), 2);
      const b = mate ? Game.trim(Game.pedOf(mate), 2) : ({ id: 0, name: '', gen: 0, unknown: true } as Pedigree);
      if (a) ped.a = a;
      if (b) ped.b = b;

      const res = this.db
        .prepare(
          'INSERT INTO slimes (owner, name, gen, dna, stats, color, kind, blood, nix, born, seeds, points, ped) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)',
        )
        .run(u.name, 'NoNameYet', mother.gen + 1, JSON.stringify(c.dna), JSON.stringify(c.stats), c.color, c.kind, JSON.stringify(c.blood), c.nix, this.now(), Math.trunc(c.stats.sex / 10), null);
      const id = Number(res.lastInsertRowid);
      ped.id = id;
      this.db.prepare('UPDATE slimes SET ped = ? WHERE id = ?').run(JSON.stringify(ped), id);

      // the chosen seed is spent; then every ranked slime's seed gauge advances by its SEX
      if (mate && spendsSeed) {
        mate.seeds -= 1;
        mate.children += 1;
      }
      const save = this.db.prepare('UPDATE slimes SET seeds = ?, children = ?, sperm = ? WHERE id = ?');
      for (const r of ladder) {
        const row = mate && r.id === mate.id ? mate : r;
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
      if (!u.pending_id) throw new GameError('no-newborn');
      const name = [...nameRaw.trim()].slice(0, MAX_SLIME_NAME).join('') || 'NoNameYet';
      const child = this.slime(u.pending_id)!;
      const ped = JSON.parse(child.ped!) as Pedigree;
      ped.name = name;
      this.db.prepare('UPDATE slimes SET name = ?, ped = ? WHERE id = ?').run(name, JSON.stringify(ped), child.id);
      child.name = name;
      // a newborn from an unknown seed names its new lineage after itself
      const blood = bloodOf(child);
      if (blood[3].no !== 0 && !blood[3].name) {
        blood[3].name = name;
        this.registerLineage(blood[3]);
      }

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
        if (title) this.logTitleMatch(this.view(child, ladder, avg), this.view(opp, ladder, avg), rep, !won);
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
          this.registerLineage(next, [...this.lineageOld(old.no), old]);
          blood[3] = next;
        }
      }
      this.db.prepare('UPDATE slimes SET blood = ? WHERE id = ?').run(JSON.stringify(blood), child.id);
      child.blood = JSON.stringify(blood);

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
          this.logTitleMatch(defense.challenger, defense.champion, rep, !rangerWon);
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

  /** Legends stay in the database (and can be mated with once their lineage has left the ranking). */
  private enterHall(champ: SlimeRow, ladder: SlimeRow[], avg: number) {
    const snap = JSON.stringify(this.view(champ, ladder, avg));
    const have = this.db.prepare('SELECT id FROM hall WHERE slime_id = ?').get(champ.id) as { id: number } | undefined;
    if (have) this.db.prepare('UPDATE hall SET at = ?, defenses = ?, snapshot = ? WHERE id = ?').run(this.now(), champ.defenses, snap, have.id);
    else this.db.prepare('INSERT INTO hall (at, defenses, slime_id, snapshot) VALUES (?,?,?,?)').run(this.now(), champ.defenses, champ.id, snap);
    this.db.prepare('UPDATE slimes SET hall = 1 WHERE id = ?').run(champ.id);
    // a congratulation on the title screen; the client renders '@hall' notes in the viewer's language
    this.db.prepare('INSERT INTO comments (at, user, text) VALUES (?,?,?)').run(this.now(), '@hall', `${champ.name}|${champ.gen}|${champ.owner}`);
  }

  private logTitleMatch(challenger: SlimeView, champion: SlimeView, report: BattleReport, championHeld: boolean) {
    const data: TitleMatchLog = { at: new Date(this.now()).toISOString(), challenger, champion, report, championHeld };
    this.db.prepare('INSERT INTO title_matches (at, data) VALUES (?,?)').run(this.now(), JSON.stringify(data));
    this.db.prepare('DELETE FROM title_matches WHERE id <= (SELECT MAX(id) FROM title_matches) - 30').run();
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

  titleMatches(): TitleMatchLog[] {
    const rows = this.db.prepare('SELECT data FROM title_matches ORDER BY id DESC LIMIT 30').all() as unknown as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as TitleMatchLog);
  }

  /** Lineage census: ranked slimes per lineage (own line = slot 3), with their branch ancestry. */
  lineages(): LineageRow[] {
    const ladder = this.ladder();
    const count = new Map<number, number>();
    for (const r of ladder) {
      const l = father(r);
      if (l.no !== 0) count.set(l.no, (count.get(l.no) ?? 0) + 1);
    }
    const rows: LineageRow[] = [];
    for (const [no, cnt] of [...count.entries()].sort((a, b) => b[1] - a[1])) {
      const reg = this.db.prepare('SELECT name, nx FROM lineages WHERE no = ?').get(no) as { name: string; nx: string } | undefined;
      if (!reg) continue;
      rows.push({
        rank: 0,
        no,
        name: reg.name,
        type: Number(reg.nx[6] ?? 0),
        count: cnt,
        percent: Math.trunc((cnt / (ladder.length || 1)) * 100),
        chain: [...this.lineageOld(no).map((o) => ({ no: o.no, name: o.name })), { no, name: reg.name }],
      });
    }
    rows.forEach((r, i) => (r.rank = i + 1));
    return rows;
  }

  /** Slimes of one lineage; with a session token, also flags poor matches for that player's slime. */
  lineage(no: number, token?: string): LineageDetail {
    const ladder = this.ladder();
    const avg = this.avgWeight(ladder);
    let viewer: Blood | null = null;
    if (token) {
      const u = this.userByToken(token);
      viewer = bloodOf(this.slime(u.mother_id!)!);
    }
    let rows = ladder.filter((r) => father(r).no === no);
    let fromHall = false;
    if (!rows.length) {
      rows = (this.db.prepare('SELECT * FROM slimes WHERE hall = 1 ORDER BY id DESC').all() as unknown as SlimeRow[]).filter((r) => father(r).no === no);
      fromHall = rows.length > 0;
    }
    const reg = this.db.prepare('SELECT name, nx FROM lineages WHERE no = ?').get(no) as { name: string; nx: string } | undefined;
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
  nixTable(token: string): NixTable {
    const u = this.userByToken(token);
    const mine = bloodOf(this.slime(u.mother_id!)!);
    const ladder = this.ladder();
    const count = new Map<number, number>();
    for (const r of ladder) count.set(father(r).no, (count.get(father(r).no) ?? 0) + 1);
    for (const r of this.db.prepare('SELECT * FROM slimes WHERE hall = 1').all() as unknown as SlimeRow[]) if (!count.has(father(r).no)) count.set(father(r).no, 0);
    const rows: NixTable['rows'] = [];
    for (const [no, cnt] of [...count.entries()].sort((a, b) => b[1] - a[1])) {
      const reg = this.db.prepare('SELECT name, nx FROM lineages WHERE no = ?').get(no) as { name: string; nx: string } | undefined;
      if (!reg || no === 0) continue;
      rows.push({ no, name: reg.name, type: Number(reg.nx[6] ?? 0), count: cnt, print: affinityPrint(mine, { no, name: reg.name, nx: reg.nx }) });
    }
    return { mine, rows };
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
    if (!text) throw new GameError('empty-comment');
    // '@' names are reserved for system notes such as the Hall of Fame congratulation
    const user = [...(userRaw.trim().replace(/^@+/, '') || 'Name')].slice(0, MAX_USER).join('');
    this.db.prepare('INSERT INTO comments (at, user, text) VALUES (?,?,?)').run(this.now(), user, text);
  }

  /** Delete accounts idle for over a week; their slimes stay while ranked or enshrined, the rest go. */
  purgeInactive(): number {
    const cutoff = this.now() - this.inactivityMs;
    return this.tx(() => {
      const gone = this.db.prepare('SELECT name FROM users WHERE last_seen < ?').all(cutoff) as unknown as { name: string }[];
      for (const { name } of gone) {
        this.db.prepare('DELETE FROM slimes WHERE owner = ? AND ranked = 0 AND hall = 0').run(name);
        this.db.prepare('DELETE FROM sessions WHERE user = ?').run(name);
        this.db.prepare('DELETE FROM users WHERE name = ?').run(name);
      }
      return gone.length;
    });
  }
}

export type { BattleReport };
