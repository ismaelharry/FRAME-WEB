// npm run seed  → crea la base de datos con datos iniciales si no existe.
// npm run reset → borra la base de datos local y la vuelve a crear (¡pierde los datos!).
import fs from 'node:fs';
import { loadConfig } from '../config.js';
import { openDb } from './index.js';
import { seed } from './seed.js';

const cfg = loadConfig();
if (process.argv.includes('--reset')) {
  if (cfg.isProd) { console.error('No se permite reiniciar la base de datos en producción.'); process.exit(1); }
  for (const f of [cfg.dbFile, `${cfg.dbFile}-wal`, `${cfg.dbFile}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
  console.log('Base de datos eliminada.');
}
const db = openDb(cfg.dbFile);
const r = seed(db, { adminEmail: cfg.adminEmail, adminPassword: cfg.adminPassword, isProd: cfg.isProd });
console.log(r.seeded ? 'Datos iniciales creados.' : 'La base de datos ya tenía datos; no se ha modificado.');
for (const c of r.credentials || []) console.log(` · ${c.role} ${c.email} / ${c.password}`);
db.close();
