import { afterAll, describe, expect, it } from 'vitest';
import { seeded } from '../shared/rng.ts';
import { GameError } from './service.ts';
import { cleanupGames, makeGame } from './testkit.ts';

afterAll(cleanupGames);

const STRONG = { weight: 250, hp: 90000, stm: 90000, str: 9000, dex: 9000, agl: 9000, cst: 250, sex: 50, spd: 9000 };
const WEAK = { weight: 50, hp: 50, stm: 500, str: 5, dex: 50, agl: 5, cst: 50, sex: 50, spd: 5 };
const MID_STRONG = { weight: 250, hp: 2700, stm: 2000, str: 270, dex: 270, agl: 270, cst: 250, sex: 50, spd: 570 };
const MID_WEAK = { weight: 50, hp: 500, stm: 500, str: 50, dex: 50, agl: 50, cst: 50, sex: 50, spd: 50 };

describe('Game', () => {
  it('seeds an empty ladder with founders so the first player can mate', async () => {
    const { g } = await makeGame({ rng: seeded(1) });
    expect(await g.ranking()).toHaveLength(10);
    const e = await g.enter('first', 'pw');
    if (!e.ok) throw new Error('enter');
    expect(e.mates.length).toBe(10);
    await g.mate(e.token, e.mates[5]!.id);
    expect((await g.fight(e.token, 'Hero')).steps.length).toBeGreaterThan(0);
  });

  it('registers a founder slime on first enter', async () => {
    const { g } = await makeGame({ rng: seeded(7), seedLadder: false });
    const e = await g.enter('alice', 'pw');
    expect(e.ok && e.registered).toBe(true);
    if (e.ok) {
      expect(e.mother.name).toBe('FirstChild');
      expect(e.mother.gen).toBe(0);
      expect(e.mates).toEqual([]);
    }
  });

  it('rejects a wrong password and over-long input', async () => {
    const { g } = await makeGame({ rng: seeded(7) });
    await g.enter('alice', 'pw');
    await expect(g.enter('alice', 'nope')).rejects.toBeInstanceOf(GameError);
    await expect(g.enter('x'.repeat(33), 'pw')).rejects.toBeInstanceOf(GameError);
    await expect(g.enter('bob', '123456789')).rejects.toBeInstanceOf(GameError);
  });

  it('enforces the play cooldown but allows resuming a pending newborn', async () => {
    let t = 1_000_000;
    const { g } = await makeGame({ rng: seeded(7), cooldownMin: 15, now: () => t });
    const e1 = await g.enter('alice', 'pw');
    if (!e1.ok) throw new Error('enter');
    await g.mate(e1.token, e1.mates[0]!.id);
    // leaving before fighting: re-enter resumes the fight phase without cooldown
    const resumed = await g.enter('alice', 'pw');
    expect(resumed.ok && resumed.phase).toBe('fight');
    if (!resumed.ok) throw new Error('resume');
    await g.fight(resumed.token, 'Blob');

    t += 5 * 60_000;
    await expect(g.enter('alice', 'pw')).rejects.toThrow(/once per 15 minutes/);
    t += 11 * 60_000;
    expect((await g.enter('alice', 'pw')).ok).toBe(true);
  });

  it('runs many plays, keeps the ladder <= 50 and uses seeds', async () => {
    const { g, db } = await makeGame({ rng: seeded(7) });
    for (let i = 0; i < 60; i++) {
      const e = await g.enter(`p${i}`, 'pw');
      if (!e.ok) throw new Error('enter');
      await g.mate(e.token, e.mates[0]!.id);
      expect((await g.fight(e.token, `S${i}`)).steps.length).toBeGreaterThan(0);
    }
    const rank = await g.ranking();
    expect(rank.length).toBeLessThanOrEqual(50);
    expect(rank[0]!.rank).toBe(1);
    const spent = await db.get<{ m: number }>('SELECT MIN(seeds) AS m FROM slimes');
    expect(spent!.m).toBeLessThan(10);
    // ranks are contiguous and sorted by (champion, points)
    rank.forEach((s, i) => expect(s.rank).toBe(i + 1));
    for (let i = 2; i < rank.length; i++) expect(rank[i - 1]!.points).toBeGreaterThanOrEqual(rank[i]!.points);
  }, 120_000);

  it('cannot mate with a slime that has no seeds', async () => {
    const { g, db } = await makeGame({ rng: seeded(7) });
    const first = (await g.ranking())[0]!;
    await db.run('UPDATE slimes SET seeds = 0 WHERE id = ?', [first.id]);
    const e = await g.enter('alice', 'pw');
    if (!e.ok) throw new Error('enter');
    expect(e.mates.find((m) => m.id === first.id)).toBeUndefined();
    await expect(g.mate(e.token, first.id)).rejects.toThrow(/no seeds/);
  });

  it('purges accounts idle for over a week', async () => {
    let t = 0;
    const { g } = await makeGame({ rng: seeded(7), now: () => t });
    await g.enter('old', 'pw');
    t = 8 * 86_400_000;
    await g.enter('fresh', 'pw');
    expect(await g.purgeInactive()).toBe(1);
    await expect(g.enter('old2', 'pw')).resolves.toBeTruthy();
  });

  it('stores comments capped at 300 chars', async () => {
    const { g } = await makeGame({ rng: seeded(7) });
    await g.addComment('me', 'x'.repeat(500));
    expect((await g.comments())[0]!.text.length).toBe(300);
    await expect(g.addComment('me', '  ')).rejects.toBeInstanceOf(GameError);
  });

  it('players cannot post as a system note', async () => {
    const { g } = await makeGame({ rng: seeded(9) });
    await g.addComment('@hall', 'fake');
    expect((await g.comments())[0]!.user).toBe('hall');
  });

  it('a failed action rolls back completely', async () => {
    const { g, db } = await makeGame({ rng: seeded(10) });
    const e = await g.enter('rollback', 'pw');
    if (!e.ok) throw new Error('enter');
    const before = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM slimes'))!.n;
    await expect(g.mate(e.token, 99999)).rejects.toBeInstanceOf(GameError);
    expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM slimes'))!.n).toBe(before);
    const u = await db.get<{ pending_id: number | null }>('SELECT pending_id FROM users WHERE name = ?', ['rollback']);
    expect(u!.pending_id).toBeNull();
  });
});

describe('point transfer (original rule)', () => {
  it("a winner takes over the defender's points; a loser hands its run to the defender", async () => {
    const { g } = await makeGame({ rng: seeded(5) });
    const before = new Map((await g.ranking()).map((s) => [s.id, s.points]));
    const e = await g.enter('hero', 'pw');
    if (!e.ok) throw new Error('enter');
    await g.mate(e.token, e.mates[0]!.id);
    const f = await g.fight(e.token, 'Hero');
    let running = 1;
    for (const st of f.steps) {
      if (st.won) {
        expect(st.gained).toBe(before.get(st.opponent.id));
        running += st.gained;
      } else {
        expect(st.given).toBe(running);
        const after = (await g.ranking()).find((s) => s.id === st.opponent.id);
        if (after) expect(after.points).toBeGreaterThanOrEqual(before.get(st.opponent.id)! + running);
      }
      expect(st.total).toBe(running);
    }
  });
});

describe('original ladder mechanics', () => {
  it("a mating advances every ranked slime's seed gauge and a full gauge grows a seed", async () => {
    const { g, db } = await makeGame({ rng: seeded(3) });
    const ids = (await g.ranking()).map((s) => s.id);
    const target = ids[5]!;
    await db.run('UPDATE slimes SET sperm = 499 WHERE id = ?', [target]); // SEED_GAGE is 500
    const before = (await db.get<{ seeds: number }>('SELECT seeds FROM slimes WHERE id = ?', [target]))!.seeds;
    const e = await g.enter('breeder', 'pw');
    if (!e.ok) throw new Error('enter');
    await g.mate(e.token, ids[0]!);
    const after = (await db.get<{ seeds: number; sperm: number }>('SELECT seeds, sperm FROM slimes WHERE id = ?', [target]))!;
    expect(after.seeds).toBe(before + 1);
    expect(after.sperm).toBeLessThan(100);
    const chosen = (await db.get<{ seeds: number }>('SELECT seeds FROM slimes WHERE id = ?', [ids[0]!]))!;
    expect(chosen.seeds).toBeLessThanOrEqual(5); // spent one, at most regrown one
  });

  it('divides the whole ladder when the lowest slime reaches three digits of points', async () => {
    const { g, db } = await makeGame({ rng: seeded(4) });
    await db.run('UPDATE slimes SET points = points * 1000 + 500'); // lowest becomes 3500+ -> cut by 10^2
    const lowestBefore = (await db.get<{ m: number }>('SELECT MIN(points) AS m FROM slimes'))!.m;
    const e = await g.enter('cut', 'pw');
    if (!e.ok) throw new Error('enter');
    await g.mate(e.token, e.mates[0]!.id);
    await g.fight(e.token, 'Cutter');
    const lowestAfter = (await db.get<{ m: number }>('SELECT MIN(points) AS m FROM slimes WHERE ranked = 1'))!.m;
    expect(lowestBefore).toBeGreaterThanOrEqual(3500);
    expect(lowestAfter).toBeLessThan(lowestBefore / 50);
  });

  it('plays a title defense match when a slime other than the champion ends up with more points', async () => {
    const { g, db } = await makeGame({ rng: seeded(6) });
    const [champ, ranger] = (await g.ranking()).slice(0, 2);
    await db.run('UPDATE slimes SET stats = ?, points = 5 WHERE id = ?', [JSON.stringify(MID_WEAK), champ!.id]);
    await db.run('UPDATE slimes SET stats = ?, points = 900 WHERE id = ?', [JSON.stringify(MID_STRONG), ranger!.id]);
    await db.run('UPDATE slimes SET points = 1 WHERE id NOT IN (?, ?)', [champ!.id, ranger!.id]);
    const e = await g.enter('challenger', 'pw');
    if (!e.ok) throw new Error('enter');
    await g.mate(e.token, e.mates.find((m) => m.id !== ranger!.id && m.id !== champ!.id)!.id);
    await db.run('UPDATE slimes SET stats = ? WHERE id = (SELECT pending_id FROM users WHERE name = ?)', [JSON.stringify(MID_WEAK), 'challenger']);
    const f = await g.fight(e.token, 'Newbie');
    // the strong ranger out-scored the weak champion: a defense match is played and the ranger takes the crown
    expect(f.defense).not.toBeNull();
    expect(f.defense!.challenger.id).toBe(ranger!.id);
    expect(f.defense!.championHeld).toBe(false);
    expect((await g.ranking())[0]!.id).toBe(ranger!.id);
    expect((await g.titleMatches()).length).toBeGreaterThan(0);
  });

  it('stores stats, colour and mutant type at birth and keeps them stable', async () => {
    const { g } = await makeGame({ rng: seeded(9) });
    const e = await g.enter('stable', 'pw');
    if (!e.ok) throw new Error('enter');
    const m = await g.mate(e.token, e.mates[0]!.id);
    const f = await g.fight(e.token, 'Fixed');
    expect(f.slime.stats).toEqual(m.child.stats);
    expect(f.slime.color).toBe(m.child.color);
    expect(f.slime.kind).toBe(m.child.kind);
    expect(f.slime.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('bloodlines', () => {
  it('founders each start their own lineage', async () => {
    const { g } = await makeGame({ rng: seeded(1) });
    const r = await g.ranking();
    const nos = new Set(r.map((s) => s.lineage[3].no));
    expect(nos.size).toBe(r.length);
    expect(r.every((s) => s.lineage[3].name === s.name)).toBe(true);
    expect(await g.lineages()).toHaveLength(r.length);
  });

  it("a child joins the mate's lineage and passes on the mother's father lineage", async () => {
    const { g } = await makeGame({ rng: seeded(2) });
    const e = await g.enter('bloodline', 'pw');
    if (!e.ok) throw new Error('enter');
    const mate = (await g.ranking()).find((s) => s.id === e.mates[2]!.id)!;
    const child = (await g.mate(e.token, mate.id)).child;
    expect(child.lineage[3]).toEqual(mate.lineage[3]);
    expect(child.lineage[1]).toEqual(e.mother.lineage[3]);
    expect(child.nix).toMatch(/^.{6,}$/);
  });

  it('an unknown seed founds a new lineage named after the newborn once it is named', async () => {
    const { g, db } = await makeGame({ rng: seeded(3) });
    const e = await g.enter('founder', 'pw');
    if (!e.ok) throw new Error('enter');
    const m = await g.mate(e.token, 'no');
    expect(m.child.pedigree!.b!.unknown).toBe(true);
    expect(m.child.lineage[3].no).toBe(m.child.id);
    const f = await g.fight(e.token, 'Pioneer');
    expect(f.slime.lineage[3].name).toBe('Pioneer');
    const reg = await db.get<{ name: string }>('SELECT name FROM lineages WHERE no = ?', [m.child.id]);
    expect(reg?.name).toBe('Pioneer');
  });

  it('beating the whole ladder branches a new lineage that remembers its origin', async () => {
    const { g, db } = await makeGame({ rng: seeded(4) });
    await db.run('UPDATE slimes SET stats = ?', [JSON.stringify(WEAK)]);
    const e = await g.enter('champion', 'pw');
    if (!e.ok) throw new Error('enter');
    const before = (await g.ranking()).find((s) => s.id === e.mates[0]!.id)!;
    const c = (await g.mate(e.token, before.id)).child;
    await db.run('UPDATE slimes SET stats = ? WHERE id = ?', [JSON.stringify(STRONG), c.id]);
    const f = await g.fight(e.token, 'Newline');
    expect(f.steps.every((s) => s.won)).toBe(true);
    expect(f.slime.rank).toBe(1);
    expect(f.slime.lineage[3].no).toBe(c.id);
    expect(f.slime.lineage[3].name).toBe('Newline');
    const row = (await g.lineages()).find((l) => l.no === c.id)!;
    expect(row.chain.at(-2)!.no).toBe(before.lineage[3].no);
    expect(row.chain.at(-1)!.name).toBe('Newline');
  });

  it('a champion dethroned after 4+ defenses enters the Hall of Fame with a congratulation note', async () => {
    const { g, db } = await makeGame({ rng: seeded(8) });
    await db.run('UPDATE slimes SET stats = ?', [JSON.stringify(WEAK)]);
    const champ = (await g.ranking())[0]!;
    await db.run('UPDATE slimes SET defenses = 4 WHERE id = ?', [champ.id]);
    const e = await g.enter('usurper', 'pw');
    if (!e.ok) throw new Error('enter');
    const c = (await g.mate(e.token, e.mates[3]!.id)).child;
    await db.run('UPDATE slimes SET stats = ? WHERE id = ?', [JSON.stringify(STRONG), c.id]);
    await g.fight(e.token, 'Usurper');
    const hall = await g.hall();
    expect(hall).toHaveLength(1);
    expect(hall[0]!.slime.id).toBe(champ.id);
    expect(hall[0]!.defenses).toBe(4);
    expect((await g.comments()).some((x) => x.user === '@hall' && x.text.startsWith(`${champ.name}|`))).toBe(true);
    expect((await db.get<{ hall: number }>('SELECT hall FROM slimes WHERE id = ?', [champ.id]))!.hall).toBe(1);
  });

  it('legends whose lineage died out can be mated with from the Hall of Fame without spending seeds', async () => {
    const { g, db } = await makeGame({ rng: seeded(5) });
    const legend = (await g.ranking())[3]!;
    await db.run('UPDATE slimes SET ranked = 0, champ = 0, hall = 1, seeds = 4 WHERE id = ?', [legend.id]);
    const e = await g.enter('reviver', 'pw');
    if (!e.ok) throw new Error('enter');
    expect(e.mates.find((m) => m.id === legend.id)?.from).toBe('hall');
    await g.mate(e.token, legend.id);
    expect((await db.get<{ seeds: number }>('SELECT seeds FROM slimes WHERE id = ?', [legend.id]))!.seeds).toBe(4);
  });

  it("lists a lineage's slimes and the compatibility table", async () => {
    const { g } = await makeGame({ rng: seeded(6) });
    const e = await g.enter('viewer', 'pw');
    if (!e.ok) throw new Error('enter');
    const target = (await g.ranking())[1]!;
    const d = await g.lineage(target.lineage[3].no, e.token);
    expect(d.slimes.map((s) => s.slime.id)).toContain(target.id);
    expect(d.slimes[0]!.variety).toBeGreaterThan(0);
    const t = await g.nixTable(e.token);
    expect(t.rows.length).toBeGreaterThanOrEqual(10);
    expect(t.rows[0]!.print).toHaveLength(6);
  });

  it('purging idle accounts keeps their ranked slimes', async () => {
    let now = 0;
    const { g } = await makeGame({ rng: seeded(7), now: () => now });
    const e = await g.enter('idler', 'pw');
    if (!e.ok) throw new Error('enter');
    await g.mate(e.token, e.mates[0]!.id);
    await g.fight(e.token, 'Stay');
    const ranked = (await g.ranking()).length;
    now = 30 * 86_400_000;
    expect(await g.purgeInactive()).toBe(1);
    expect((await g.ranking()).length).toBe(ranked);
  });
});
