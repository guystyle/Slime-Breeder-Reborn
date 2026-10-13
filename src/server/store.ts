/**
 * Tiny async database layer over libSQL. The same code runs against a local
 * SQLite file (development, self-hosting, tests) and a remote Turso database
 * (Vercel): `file:` URLs use the native client, everything else the pure-JS
 * HTTP client that works in serverless functions.
 */
import type { Client, InValue, Transaction } from '@libsql/client';

export type Arg = InValue;
export interface Stmt {
  sql: string;
  args?: Arg[];
}

export interface Store {
  /** First row, or undefined */
  get<T = Record<string, unknown>>(sql: string, args?: Arg[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, args?: Arg[]): Promise<T[]>;
  run(sql: string, args?: Arg[]): Promise<{ lastInsertRowid: number; changes: number }>;
  /** Several statements in one round trip (atomic when run inside a transaction or on its own) */
  batch(stmts: Stmt[]): Promise<void>;
}

export interface Db extends Store {
  /** Interactive write transaction: committed when `fn` resolves, rolled back when it throws. */
  tx<T>(fn: (s: Store) => Promise<T>): Promise<T>;
  close(): void;
}

type Executor = Pick<Client, 'execute' | 'batch'> | Pick<Transaction, 'execute' | 'batch'>;

function toRow<T>(columns: string[], row: ArrayLike<unknown>): T {
  const o: Record<string, unknown> = {};
  columns.forEach((c, i) => (o[c] = row[i]));
  return o as T;
}

function wrap(ex: Executor): Store {
  return {
    async get<T>(sql: string, args: Arg[] = []) {
      const r = await ex.execute({ sql, args });
      return r.rows[0] ? toRow<T>(r.columns, r.rows[0]) : undefined;
    },
    async all<T>(sql: string, args: Arg[] = []) {
      const r = await ex.execute({ sql, args });
      return r.rows.map((row) => toRow<T>(r.columns, row));
    },
    async run(sql: string, args: Arg[] = []) {
      const r = await ex.execute({ sql, args });
      return { lastInsertRowid: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected };
    },
    async batch(stmts: Stmt[]) {
      if (!stmts.length) return;
      await ex.batch(stmts.map((s) => ({ sql: s.sql, args: s.args ?? [] })));
    },
  };
}

export async function openDb(url: string, authToken?: string): Promise<Db> {
  const local = url.startsWith('file:');
  const { createClient } = local ? await import('@libsql/client') : await import('@libsql/client/web');
  const client = createClient({ url, authToken });
  const base = wrap(client);
  return {
    ...base,
    async tx<T>(fn: (s: Store) => Promise<T>): Promise<T> {
      const t = await client.transaction('write');
      try {
        const out = await fn(wrap(t));
        await t.commit();
        return out;
      } catch (e) {
        try {
          await t.rollback();
        } catch {
          /* the connection may already be gone */
        }
        throw e;
      } finally {
        t.close();
      }
    },
    close: () => client.close(),
  };
}
