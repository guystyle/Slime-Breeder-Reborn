// Bundled into the Vercel function in place of the native libSQL client. Remote (Turso) URLs use
// '@libsql/client/web'; file: URLs are only for local development and never reach this on Vercel.
export function createClient() {
  throw new Error('Local file databases are not available on this host. Set TURSO_DATABASE_URL.');
}
