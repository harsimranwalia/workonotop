// database/fixtures/load.js
// Puts the dev database into one known synthetic state (ADR-002). Run it where the app's DB settings are:
//   npm run db:fixtures
//   docker exec workontap-app npm run db:fixtures      (the dev stack)
// In ONE transaction with no DDL it empties every table, inserts the sets listed in ./index.js, checks every
// table's row count and commits. Any error rolls everything back and exits 1. Before it writes anything it
// refuses every target but the local dev database (./guard.js), and nothing turns that off.
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { assertDevTarget, assertNoRealPeople } from './guard.js';
import { fixtureSets } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });

// One object feeds both the guard and the connection, so the guard certifies the values that get used.
// The defaults are the repo's own (src/lib/db.js). Number(), not parseInt: '3306x' must not pass as 3306.
const settings = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root123',
  database: process.env.DB_NAME || 'workontap_db',
};

const describeRow = (row) => (row.id !== undefined ? `id ${row.id}` : `key '${row.key}'`);

// Reads the tables from information_schema, so a table a later migration adds is emptied with no change here.
async function listBaseTables(connection) {
  const [rows] = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  return rows.map((row) => row.name);
}

// Foreign keys are off only while deleting, so the order does not matter. They are back on before the
// first insert, which is what makes a fixture with a dangling reference fail the load.
async function emptyTables(connection, tables) {
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of tables) {
    try {
      await connection.query('DELETE FROM ??', [table]);
    } catch (error) {
      throw new Error(`${table}: could not empty it: ${error.code}: ${error.sqlMessage || error.message}`, { cause: error });
    }
  }
  await connection.query('SET FOREIGN_KEY_CHECKS = 1');
}

// A multi-row INSERT is atomic and MySQL does not say which row it refused, so insert one at a time to
// find it. The transaction is rolled back straight after, so what goes in here changes nothing.
async function explainInsertFailure(connection, table, columns, rows, bulkError) {
  for (const row of rows) {
    try {
      await connection.query('INSERT INTO ?? (??) VALUES (?)', [table, columns, columns.map((column) => row[column])]);
    } catch (error) {
      return new Error(`${table}, fixture ${describeRow(row)}: ${error.code}: ${error.sqlMessage || error.message}`, { cause: error });
    }
  }
  return new Error(`${table}: ${bulkError.code}: ${bulkError.sqlMessage || bulkError.message}`, { cause: bulkError });
}

async function insertRows(connection, table, rows) {
  const columns = Object.keys(rows[0]);
  const shape = [...columns].sort().join();
  for (const row of rows) {
    if (Object.keys(row).sort().join() !== shape) {
      throw new Error(`${table}: fixture ${describeRow(row)} has different keys from fixture ${describeRow(rows[0])}`);
    }
  }
  try {
    await connection.query('INSERT INTO ?? (??) VALUES ?', [table, columns, rows.map((row) => columns.map((column) => row[column]))]);
  } catch (error) {
    throw await explainInsertFailure(connection, table, columns, rows, error);
  }
}

// Returns how many rows each table was given, in the order the sets wrote them.
async function insertSets(connection, tables) {
  const known = new Set(tables);
  const loaded = new Map();
  for (const set of fixtureSets) {
    for (const [table, rows] of Object.entries(set.tables)) {
      if (!known.has(table)) {
        throw new Error(`fixture set '${set.name}' names table '${table}', which does not exist in ${settings.database}`);
      }
      if (rows.length === 0) continue;
      await insertRows(connection, table, rows);
      loaded.set(table, (loaded.get(table) ?? 0) + rows.length);
    }
  }
  return loaded;
}

// Every table, including the ones no set mentions: the count must be exactly what the sets define.
async function verifyCounts(connection, tables, loaded) {
  for (const table of tables) {
    const [[{ n }]] = await connection.query('SELECT COUNT(*) AS n FROM ??', [table]);
    const expected = loaded.get(table) ?? 0;
    if (Number(n) !== expected) {
      throw new Error(`${table}: ${n} rows after the load, the fixtures define ${expected}`);
    }
  }
}

async function rollback(connection) {
  try {
    await connection.rollback();
  } catch (error) {
    // The server rolls an open transaction back when the connection closes, so this is reported, not fatal.
    console.error(`rollback failed (${error.code || 'unknown'}); the server rolls back when the connection closes`);
  }
}

async function main() {
  assertDevTarget(settings);
  console.log(`${settings.database} @ ${settings.host}:${settings.port}`);

  let connection;
  try {
    connection = await mysql.createConnection({ ...settings, connectTimeout: 10000 });
  } catch (error) {
    throw new Error(`cannot reach the dev database at ${settings.host}:${settings.port} (${error.code || 'connect failed'}); is the stack up, and are DB_USER and DB_PASSWORD right?`, { cause: error });
  }

  try {
    await assertNoRealPeople(connection);
    await connection.beginTransaction();
    const tables = await listBaseTables(connection);
    await emptyTables(connection, tables);
    const loaded = await insertSets(connection, tables);
    await verifyCounts(connection, tables, loaded);
    await connection.commit();

    for (const [table, count] of loaded) {
      console.log(`  ${table}: ${count} ${count === 1 ? 'row' : 'rows'}`);
    }
    console.log('  all other tables: 0 rows');
  } catch (error) {
    await rollback(connection);
    throw error;
  } finally {
    await connection.end();
  }
}

// Only the message is printed: it names the table and fixture id, and never carries a password.
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
