// Acceso a SQLite mediante el módulo integrado node:sqlite (sin compilación nativa).
// Las operaciones que comprueban disponibilidad y escriben se ejecutan dentro de
// transacciones BEGIN IMMEDIATE: SQLite serializa a los escritores, de modo que dos
// peticiones simultáneas por el último hueco nunca pueden confirmarse ambas.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const SCHEMA = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec(`PRAGMA journal_mode = ${file === ':memory:' ? 'MEMORY' : 'WAL'};
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 8000;
            PRAGMA synchronous = NORMAL;`);
  raw.exec(SCHEMA);
  return wrap(raw);
}

function wrap(raw) {
  const cache = new Map();
  let depth = 0;
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const args = (p) => (p === undefined ? [] : Array.isArray(p) ? p : [p]);
  const db = {
    raw,
    get: (sql, p) => { const r = stmt(sql).get(...args(p)); return r ? { ...r } : undefined; },
    all: (sql, p) => stmt(sql).all(...args(p)).map((r) => ({ ...r })),
    run: (sql, p) => stmt(sql).run(...args(p)),
    exec: (sql) => raw.exec(sql),
    // Transacción (anidable con SAVEPOINT). fn debe ser síncrona.
    tx(fn, { immediate = true } = {}) {
      if (depth > 0) {
        const sp = `sp${depth}`;
        raw.exec(`SAVEPOINT ${sp}`);
        depth++;
        try { const r = fn(); raw.exec(`RELEASE ${sp}`); return r; }
        catch (e) { raw.exec(`ROLLBACK TO ${sp}`); raw.exec(`RELEASE ${sp}`); throw e; }
        finally { depth--; }
      }
      raw.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');
      depth++;
      try {
        const r = fn();
        if (r && typeof r.then === 'function') throw new Error('Las transacciones deben ser síncronas');
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch { /* ya revertida */ }
        throw e;
      } finally { depth--; }
    },
    get inTx() { return depth > 0; },
    close: () => raw.close(),
  };
  return db;
}

export const isUniqueError = (e) => /UNIQUE constraint failed|PRIMARY KEY/.test(String(e?.message || e));
