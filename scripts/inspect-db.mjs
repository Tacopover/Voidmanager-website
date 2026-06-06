// Dev-only utility: dump the schema + sample rows of a VoidManager SQLite .db
// so we can pin real table/column names into src/data/schema.ts.
//
//   node scripts/inspect-db.mjs "C:\\path\\to\\Void Manager ... .db"
//
// Not shipped in the build; lives here as a one-off developer aid.
import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('Usage: node scripts/inspect-db.mjs <path-to-.db>');
  process.exit(1);
}

const SQL = await initSqlJs({ locateFile: () => wasmPath });
const db = new SQL.Database(readFileSync(dbPath));

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// 1. All tables + their CREATE sql
const tables = all(
  "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
);
console.log('================ TABLES (' + tables.length + ') ================');
for (const t of tables) {
  const count = all(`SELECT COUNT(*) AS n FROM "${t.name}"`)[0].n;
  console.log(`\n### ${t.name}  (${count} rows)`);
  console.log(t.sql);
  // column list
  const cols = all(`PRAGMA table_info("${t.name}")`);
  console.log(
    'columns: ' + cols.map((c) => `${c.name}:${c.type}${c.pk ? ' PK' : ''}`).join(', '),
  );
  // up to 2 sample rows
  const sample = all(`SELECT * FROM "${t.name}" LIMIT 2`);
  if (sample.length) console.log('sample: ' + JSON.stringify(sample, null, 2));
}

// 2. Distinct status-like values, wherever a status column lives
console.log('\n================ STATUS-LIKE COLUMNS ================');
for (const t of tables) {
  const cols = all(`PRAGMA table_info("${t.name}")`);
  for (const c of cols) {
    if (/status|approval/i.test(c.name)) {
      const vals = all(
        `SELECT DISTINCT "${c.name}" AS v FROM "${t.name}" WHERE "${c.name}" IS NOT NULL LIMIT 20`,
      );
      console.log(`${t.name}.${c.name}: ${JSON.stringify(vals.map((r) => r.v))}`);
    }
  }
}

db.close();
