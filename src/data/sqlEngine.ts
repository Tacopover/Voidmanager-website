/**
 * sqlEngine.ts — browser-side sql.js initialisation.
 *
 * Uses the Vite wasm-url import pattern so the WASM binary is served as a
 * static asset from the correct URL at runtime (works for GitHub Pages sub-paths).
 *
 * DO NOT import this file from tests — tests init sql.js the Node way using
 * the WASM path resolved via `require.resolve('sql.js/dist/sql-wasm.wasm')`.
 */

import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
// Vite resolves this import to the correct public asset URL at bundle time.
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

import { LocalDbRepository } from './LocalDbRepository';
import type { VoidRepository } from './VoidRepository';

let cachedSql: Awaited<ReturnType<typeof initSqlJs>> | null = null;

/** Lazily initialise (and cache) the sql.js engine with the bundled WASM. */
async function getSqlJs() {
  if (!cachedSql) {
    cachedSql = await initSqlJs({
      locateFile: () => wasmUrl as string,
    });
  }
  return cachedSql;
}

/**
 * Open a sql.js Database from raw SQLite bytes.
 *
 * @param bytes - The full contents of a `.db` file, e.g. from File.arrayBuffer().
 */
export async function openDatabase(bytes: Uint8Array): Promise<Database> {
  const SQL = await getSqlJs();
  return new SQL.Database(bytes);
}

/**
 * Convenience: open a Database from bytes and wrap it in a LocalDbRepository.
 *
 * @param bytes - The full contents of a `.db` file.
 */
export async function createLocalRepository(bytes: Uint8Array): Promise<VoidRepository> {
  const db = await openDatabase(bytes);
  return new LocalDbRepository(db);
}
