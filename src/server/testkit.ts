import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSchema } from './db.ts';
import { Game, type ServiceOptions } from './service.ts';
import { type Db, openDb } from './store.ts';

const dirs: string[] = [];

/** A fresh game on a temporary SQLite file (the same libSQL client as production). */
export async function makeGame(opts: ServiceOptions = {}): Promise<{ g: Game; db: Db }> {
  const dir = mkdtempSync(join(tmpdir(), 'slime-test-'));
  dirs.push(dir);
  const db = await openDb(`file:${join(dir, 'test.db')}`);
  await initSchema(db);
  const g = await Game.create(db, { cooldownMin: 0, ...opts });
  return { g, db };
}

export function cleanupGames() {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}
