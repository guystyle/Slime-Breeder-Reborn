import type { Db } from './store.ts';

/** Bump when the stored slime format changes; older databases are refused rather than misread. */
export const SCHEMA_VERSION = 3;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
    name TEXT PRIMARY KEY,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    created INTEGER NOT NULL,
    last_play INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL,
    mother_id INTEGER,
    pending_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS remember (
    token_hash TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    created INTEGER NOT NULL,
    last_used INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    created INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS slimes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    gen INTEGER NOT NULL,
    dna TEXT NOT NULL,
    stats TEXT NOT NULL,
    color TEXT NOT NULL,
    kind TEXT NOT NULL,
    sperm INTEGER NOT NULL DEFAULT 0,
    blood TEXT NOT NULL,
    nix TEXT NOT NULL DEFAULT '××××××',
    hall INTEGER NOT NULL DEFAULT 0,
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
  )`,
  `CREATE INDEX IF NOT EXISTS slimes_ranked ON slimes (ranked, champ DESC, points DESC, id)`,
  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    user TEXT NOT NULL,
    text TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hall (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    defenses INTEGER NOT NULL,
    slime_id INTEGER NOT NULL,
    snapshot TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lineages (
    no INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    nx TEXT NOT NULL,
    old TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE TABLE IF NOT EXISTS title_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    data TEXT NOT NULL
  )`,
];

/** Create missing tables and verify the schema version (an unversioned v3 database is adopted). */
export async function initSchema(db: Db): Promise<void> {
  const hasSlimes = await db.get(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'slimes'`);
  const hasMeta = await db.get(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'meta'`);
  const stored = hasMeta ? await db.get<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema'`) : undefined;
  if (hasSlimes && !stored) {
    // databases made before the meta table: version 3 is the first with the `blood` column
    const v3 = await db.get(`SELECT 1 AS x FROM pragma_table_info('slimes') WHERE name = 'blood'`);
    if (!v3) throw new Error('Database was made by an older version. Point SLIME_DB / TURSO_DATABASE_URL at a new database.');
  } else if (stored && Number(stored.value) !== SCHEMA_VERSION) {
    throw new Error(`Database schema ${stored.value} does not match ${SCHEMA_VERSION}. Use a new database.`);
  }
  await db.batch(TABLES.map((sql) => ({ sql })));
  await db.run(`INSERT OR IGNORE INTO meta (key, value) VALUES ('schema', ?)`, [String(SCHEMA_VERSION)]);
}
