import { DatabaseSync } from 'node:sqlite';

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
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
  return db;
}
