import { DatabaseSync } from 'node:sqlite';

/** Bump when the stored slime format changes; older databases are refused rather than misread. */
export const SCHEMA_VERSION = 2;

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  const have = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const hasSlimes = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'slimes'").get();
  if (hasSlimes && have !== SCHEMA_VERSION) {
    throw new Error(`Database ${path} was made by an older version (schema ${have}, need ${SCHEMA_VERSION}). Move it away to start a new world.`);
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      name TEXT PRIMARY KEY,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      created INTEGER NOT NULL,
      last_play INTEGER NOT NULL DEFAULT 0,
      last_seen INTEGER NOT NULL,
      mother_id INTEGER,
      pending_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user TEXT NOT NULL,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS slimes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      gen INTEGER NOT NULL,
      dna TEXT NOT NULL,
      stats TEXT NOT NULL,
      color TEXT NOT NULL,
      kind TEXT NOT NULL,
      sperm INTEGER NOT NULL DEFAULT 0,
      born INTEGER NOT NULL,
      seeds INTEGER NOT NULL,
      children INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      best_rank INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 1,
      streak INTEGER NOT NULL DEFAULT 0,
      defenses INTEGER NOT NULL DEFAULT 0,
      champ INTEGER NOT NULL DEFAULT 0,
      ranked INTEGER NOT NULL DEFAULT 0,
      ped TEXT
    );
    CREATE INDEX IF NOT EXISTS slimes_ranked ON slimes (ranked, champ DESC, points DESC, id);
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      user TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hall (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      defenses INTEGER NOT NULL,
      snapshot TEXT NOT NULL
    );
  `);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}
