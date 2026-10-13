import { describe, expect, it } from 'vitest';
import { seeded } from '../shared/rng.ts';
import { openDb } from './db.ts';
import { Game, GameError } from './service.ts';

function setup(opts: { cooldownMin?: number; now?: () => number } = {}) {
  const game = new Game(openDb(':memory:'), { rng: seeded(7), cooldownMin: 0, seedLadder: false, ...opts });
  return game;
}

/** one full play: enter, mate with the best mate, fight */
function play(game: Game, user: string, name: string) {
  const e = game.enter(user, 'pw');
  if (!e.ok) throw new Error(e.error);
  if (e.phase === 'mate') {
    const sel = e.mates[0]?.id ?? 0;
    // empty ladder: nothing to pick yet, so a first player cannot mate
    if (!sel) return { e, f: null };
    game.mate(e.token, sel);
  }
  return { e, f: game.fight(e.token, name) };
}

describe('Game', () => {
  it('seeds an empty ladder with founders so the first player can mate', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(1), cooldownMin: 0 });
    expect(g.ranking()).toHaveLength(10);
    const e = g.enter('first', 'pw');
    if (!e.ok) throw new Error('enter');
    expect(e.mates.length).toBe(10);
    g.mate(e.token, e.mates[5]!.id);
    expect(g.fight(e.token, 'Hero').steps.length).toBeGreaterThan(0);
  });

  it('registers a founder slime on first enter', () => {
    const g = setup();
    const e = g.enter('alice', 'pw');
    expect(e.ok && e.registered).toBe(true);
    if (e.ok) {
      expect(e.mother.name).toBe('FirstChild');
      expect(e.mother.gen).toBe(0);
      expect(e.mates).toEqual([]);
    }
  });

  it('rejects a wrong password and over-long input', () => {
    const g = setup();
    g.enter('alice', 'pw');
    expect(() => g.enter('alice', 'nope')).toThrow(GameError);
    expect(() => g.enter('x'.repeat(33), 'pw')).toThrow(GameError);
    expect(() => g.enter('bob', '123456789')).toThrow(GameError);
  });

  it('enforces the play cooldown but allows resuming a pending newborn', () => {
    let t = 1_000_000;
    const g = setup({ cooldownMin: 15, now: () => t });
    // seed the ladder: a founder cannot mate on an empty ladder, so insert one ranked slime directly
    const db = (g as unknown as { db: import('node:sqlite').DatabaseSync }).db;
    const e0 = g.enter('seed', 'pw');
    if (!e0.ok) throw new Error('setup');
    db.prepare('UPDATE slimes SET ranked = 1, champ = 1 WHERE id = ?').run(e0.mother.id);

    const e1 = g.enter('alice', 'pw');
    if (!e1.ok) throw new Error('enter');
    g.mate(e1.token, e1.mates[0]!.id);
    // leaving before fighting: re-enter resumes the fight phase without cooldown
    const resumed = g.enter('alice', 'pw');
    expect(resumed.ok && resumed.phase).toBe('fight');
    if (!resumed.ok) throw new Error('resume');
    g.fight(resumed.token, 'Blob');

    t += 5 * 60_000;
    expect(() => g.enter('alice', 'pw')).toThrow(/once per 15 minutes/);
    t += 11 * 60_000;
    expect(g.enter('alice', 'pw').ok).toBe(true);
  });

  it('runs mate -> fight, keeps the ladder <= 50 and uses a seed', () => {
    const g = setup();
    const db = (g as unknown as { db: import('node:sqlite').DatabaseSync }).db;
    const seed = g.enter('seed', 'pw');
    if (!seed.ok) throw new Error('setup');
    db.prepare('UPDATE slimes SET ranked = 1, champ = 1 WHERE id = ?').run(seed.mother.id);

    for (let i = 0; i < 70; i++) {
      const r = play(g, `p${i}`, `S${i}`);
      expect(r.f).not.toBeNull();
      expect(r.f!.steps.length).toBeGreaterThan(0);
    }
    const rank = g.ranking();
    expect(rank.length).toBeLessThanOrEqual(50);
    expect(rank[0]!.rank).toBe(1);
    // seeds were consumed from mates
    const mateRow = db.prepare('SELECT MIN(seeds) AS m FROM slimes').get() as { m: number };
    expect(mateRow.m).toBeLessThan(10);
    // ranks are contiguous and sorted by (champion, points)
    rank.forEach((s, i) => expect(s.rank).toBe(i + 1));
    for (let i = 2; i < rank.length; i++) expect(rank[i - 1]!.points).toBeGreaterThanOrEqual(rank[i]!.points);
  });

  it('cannot mate with a slime that has no seeds', () => {
    const g = setup();
    const db = (g as unknown as { db: import('node:sqlite').DatabaseSync }).db;
    const seed = g.enter('seed', 'pw');
    if (!seed.ok) throw new Error('setup');
    db.prepare('UPDATE slimes SET ranked = 1, champ = 1, seeds = 0 WHERE id = ?').run(seed.mother.id);
    const e = g.enter('alice', 'pw');
    if (!e.ok) throw new Error('enter');
    expect(e.mates).toEqual([]);
    expect(() => g.mate(e.token, seed.mother.id)).toThrow(/no seeds/);
  });

  it('purges accounts idle for over a week together with their slimes', () => {
    let t = 0;
    const g = setup({ now: () => t });
    g.enter('old', 'pw');
    t = 8 * 86_400_000;
    g.enter('fresh', 'pw');
    expect(g.purgeInactive()).toBe(1);
    expect(() => g.enter('old2', 'pw')).not.toThrow();
  });

  it('stores comments capped at 300 chars', () => {
    const g = setup();
    g.addComment('me', 'x'.repeat(500));
    expect(g.comments()[0]!.text.length).toBe(300);
    expect(() => g.addComment('me', '  ')).toThrow(GameError);
  });
});

describe('point transfer (original rule)', () => {
  it('a winner takes over the defender\'s points; a loser hands its run to the defender', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(5), cooldownMin: 0 });
    const before = new Map(g.ranking().map((s) => [s.id, s.points]));
    const e = g.enter('hero', 'pw');
    if (!e.ok) throw new Error('enter');
    g.mate(e.token, e.mates[0]!.id);
    const f = g.fight(e.token, 'Hero');
    let running = 1;
    for (const st of f.steps) {
      if (st.won) {
        expect(st.gained).toBe(before.get(st.opponent.id));
        running += st.gained;
      } else {
        expect(st.given).toBe(running);
        const after = g.ranking().find((s) => s.id === st.opponent.id);
        if (after) expect(after.points).toBeGreaterThanOrEqual(before.get(st.opponent.id)! + running);
      }
      expect(st.total).toBe(running);
    }
  });
});

describe('original ladder mechanics', () => {
  const rawDb = (g: Game) => (g as unknown as { db: import('node:sqlite').DatabaseSync }).db;
  const STRONG = { weight: 250, hp: 2700, stm: 2000, str: 270, dex: 270, agl: 270, cst: 250, sex: 50, spd: 570 };
  const WEAK = { weight: 50, hp: 500, stm: 500, str: 50, dex: 50, agl: 50, cst: 50, sex: 50, spd: 50 };

  it('a mating advances every ranked slime\'s seed gauge and a full gauge grows a seed', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(3), cooldownMin: 0 });
    const db = rawDb(g);
    const ids = g.ranking().map((s) => s.id);
    const target = ids[5]!;
    db.prepare('UPDATE slimes SET sperm = 499 WHERE id = ?').run(target); // SEED_GAGE is 500
    const before = (db.prepare('SELECT seeds FROM slimes WHERE id = ?').get(target) as { seeds: number }).seeds;
    const e = g.enter('breeder', 'pw');
    if (!e.ok) throw new Error('enter');
    g.mate(e.token, ids[0]!);
    const after = db.prepare('SELECT seeds, sperm FROM slimes WHERE id = ?').get(target) as { seeds: number; sperm: number };
    expect(after.seeds).toBe(before + 1);
    expect(after.sperm).toBeLessThan(100);
    const chosen = db.prepare('SELECT seeds FROM slimes WHERE id = ?').get(ids[0]!) as { seeds: number };
    expect(chosen.seeds).toBeLessThanOrEqual(5); // spent one, at most regrown one
  });

  it('divides the whole ladder when the lowest slime reaches three digits of points', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(4), cooldownMin: 0 });
    const db = rawDb(g);
    db.prepare('UPDATE slimes SET points = points * 1000 + 500').run(); // lowest becomes 3500+ -> cut by 10^2
    const lowestBefore = (db.prepare('SELECT MIN(points) AS m FROM slimes').get() as { m: number }).m;
    const e = g.enter('cut', 'pw');
    if (!e.ok) throw new Error('enter');
    g.mate(e.token, e.mates[0]!.id);
    g.fight(e.token, 'Cutter');
    const lowestAfter = (db.prepare('SELECT MIN(points) AS m FROM slimes WHERE ranked = 1').get() as { m: number }).m;
    expect(lowestBefore).toBeGreaterThanOrEqual(3500);
    expect(lowestAfter).toBeLessThan(lowestBefore / 50);
  });

  it('plays a title defense match when a slime other than the champion ends up with more points', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(6), cooldownMin: 0 });
    const db = rawDb(g);
    const [champ, ranger] = g.ranking().slice(0, 2);
    db.prepare('UPDATE slimes SET stats = ?, points = 5 WHERE id = ?').run(JSON.stringify(WEAK), champ!.id);
    db.prepare('UPDATE slimes SET stats = ?, points = 900 WHERE id = ?').run(JSON.stringify(STRONG), ranger!.id);
    // everyone else is weak and low so the newcomer's route is short
    db.prepare('UPDATE slimes SET points = 1 WHERE id NOT IN (?, ?)').run(champ!.id, ranger!.id);
    const e = g.enter('challenger', 'pw');
    if (!e.ok) throw new Error('enter');
    g.mate(e.token, e.mates.find((m) => m.id !== ranger!.id && m.id !== champ!.id)!.id);
    db.prepare('UPDATE slimes SET stats = ? WHERE id = (SELECT pending_id FROM users WHERE name = ?)').run(JSON.stringify(WEAK), 'challenger');
    const f = g.fight(e.token, 'Newbie');
    // the strong ranger out-scored the weak champion: a defense match is played and the ranger takes the crown
    expect(f.defense).not.toBeNull();
    expect(f.defense!.challenger.id).toBe(ranger!.id);
    expect(f.defense!.championHeld).toBe(false);
    expect(g.ranking()[0]!.id).toBe(ranger!.id);
  });

  it('stores stats, colour and mutant type at birth and keeps them stable', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(9), cooldownMin: 0 });
    const e = g.enter('stable', 'pw');
    if (!e.ok) throw new Error('enter');
    const m = g.mate(e.token, e.mates[0]!.id);
    const f = g.fight(e.token, 'Fixed');
    expect(f.slime.stats).toEqual(m.child.stats);
    expect(f.slime.color).toBe(m.child.color);
    expect(f.slime.kind).toBe(m.child.kind);
    expect(f.slime.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('bloodlines', () => {
  const rawDb = (g: Game) => (g as unknown as { db: import('node:sqlite').DatabaseSync }).db;
  const STRONG = { weight: 250, hp: 90000, stm: 90000, str: 9000, dex: 9000, agl: 9000, cst: 250, sex: 50, spd: 9000 };
  const WEAK = { weight: 50, hp: 50, stm: 500, str: 5, dex: 50, agl: 5, cst: 50, sex: 50, spd: 5 };

  it('founders each start their own lineage', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(1), cooldownMin: 0 });
    const r = g.ranking();
    const nos = new Set(r.map((s) => s.lineage[3].no));
    expect(nos.size).toBe(r.length);
    expect(r.every((s) => s.lineage[3].name === s.name)).toBe(true);
    expect(g.lineages()).toHaveLength(r.length);
  });

  it('a child joins the mate\'s lineage and passes on the mother\'s father lineage', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(2), cooldownMin: 0 });
    const e = g.enter('bloodline', 'pw');
    if (!e.ok) throw new Error('enter');
    const mate = g.ranking().find((s) => s.id === e.mates[2]!.id)!;
    const child = g.mate(e.token, mate.id).child;
    expect(child.lineage[3]).toEqual(mate.lineage[3]);
    expect(child.lineage[1]).toEqual(e.mother.lineage[3]);
    expect(child.nix).toMatch(/^.{6,}$/);
  });

  it('an unknown seed founds a new lineage named after the newborn once it is named', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(3), cooldownMin: 0 });
    const e = g.enter('founder', 'pw');
    if (!e.ok) throw new Error('enter');
    const m = g.mate(e.token, 'no');
    expect(m.child.pedigree!.b!.unknown).toBe(true);
    expect(m.child.lineage[3].no).toBe(m.child.id);
    const f = g.fight(e.token, 'Pioneer');
    expect(f.slime.lineage[3].name).toBe('Pioneer');
    const reg = rawDb(g).prepare('SELECT name FROM lineages WHERE no = ?').get(m.child.id) as { name: string } | undefined;
    expect(reg?.name).toBe('Pioneer');
  });

  it('beating the whole ladder branches a new lineage that remembers its origin', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(4), cooldownMin: 0 });
    const db = rawDb(g);
    db.prepare('UPDATE slimes SET stats = ?').run(JSON.stringify(WEAK));
    const e = g.enter('champion', 'pw');
    if (!e.ok) throw new Error('enter');
    const before = g.ranking().find((s) => s.id === e.mates[0]!.id)!;
    const c = g.mate(e.token, before.id).child;
    db.prepare('UPDATE slimes SET stats = ? WHERE id = ?').run(JSON.stringify(STRONG), c.id);
    const f = g.fight(e.token, 'Newline');
    expect(f.steps.every((s) => s.won)).toBe(true);
    expect(f.slime.rank).toBe(1);
    expect(f.slime.lineage[3].no).toBe(c.id);
    expect(f.slime.lineage[3].name).toBe('Newline');
    const row = g.lineages().find((l) => l.no === c.id)!;
    expect(row.chain.at(-2)!.no).toBe(before.lineage[3].no);
    expect(row.chain.at(-1)!.name).toBe('Newline');
  });

  it('a champion dethroned after 4+ defenses enters the Hall of Fame with a congratulation note', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(8), cooldownMin: 0 });
    const db = rawDb(g);
    db.prepare('UPDATE slimes SET stats = ?').run(JSON.stringify(WEAK));
    const champ = g.ranking()[0]!;
    db.prepare('UPDATE slimes SET defenses = 4 WHERE id = ?').run(champ.id);
    const e = g.enter('usurper', 'pw');
    if (!e.ok) throw new Error('enter');
    const c = g.mate(e.token, e.mates[3]!.id).child;
    db.prepare('UPDATE slimes SET stats = ? WHERE id = ?').run(JSON.stringify(STRONG), c.id);
    g.fight(e.token, 'Usurper');
    expect(g.hall()).toHaveLength(1);
    expect(g.hall()[0]!.slime.id).toBe(champ.id);
    expect(g.hall()[0]!.defenses).toBe(4);
    expect(g.comments().some((x) => x.user === '@hall' && x.text.startsWith(`${champ.name}|`))).toBe(true);
    expect((db.prepare('SELECT hall FROM slimes WHERE id = ?').get(champ.id) as { hall: number }).hall).toBe(1);
  });

  it('players cannot post as a system note', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(9), cooldownMin: 0 });
    g.addComment('@hall', 'fake');
    expect(g.comments()[0]!.user).toBe('hall');
  });

  it('legends whose lineage died out can be mated with from the Hall of Fame without spending seeds', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(5), cooldownMin: 0 });
    const db = rawDb(g);
    const legend = g.ranking()[3]!;
    db.prepare('UPDATE slimes SET ranked = 0, champ = 0, hall = 1, seeds = 4 WHERE id = ?').run(legend.id);
    const e = g.enter('reviver', 'pw');
    if (!e.ok) throw new Error('enter');
    expect(e.mates.find((m) => m.id === legend.id)?.from).toBe('hall');
    g.mate(e.token, legend.id);
    expect((db.prepare('SELECT seeds FROM slimes WHERE id = ?').get(legend.id) as { seeds: number }).seeds).toBe(4);
  });

  it('lists a lineage\'s slimes and the compatibility table', () => {
    const g = new Game(openDb(':memory:'), { rng: seeded(6), cooldownMin: 0 });
    const e = g.enter('viewer', 'pw');
    if (!e.ok) throw new Error('enter');
    const target = g.ranking()[1]!;
    const d = g.lineage(target.lineage[3].no, e.token);
    expect(d.slimes.map((s) => s.slime.id)).toContain(target.id);
    expect(d.slimes[0]!.variety).toBeGreaterThan(0);
    const t = g.nixTable(e.token);
    expect(t.rows.length).toBeGreaterThanOrEqual(10);
    expect(t.rows[0]!.print).toHaveLength(6);
  });

  it('purging idle accounts keeps their ranked slimes', () => {
    let now = 0;
    const g = new Game(openDb(':memory:'), { rng: seeded(7), cooldownMin: 0, now: () => now });
    const e = g.enter('idler', 'pw');
    if (!e.ok) throw new Error('enter');
    g.mate(e.token, e.mates[0]!.id);
    g.fight(e.token, 'Stay');
    const ranked = g.ranking().length;
    now = 30 * 86_400_000;
    expect(g.purgeInactive()).toBe(1);
    expect(g.ranking().length).toBe(ranked);
  });
});
