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
