#!/usr/bin/env node
// scripts/migrate.js
// Prototype forward-only migration runner for Flash-Archi.
//
// This is a THIN WRAPPER intended to be replaced by an established runner
// (e.g. node-pg-migrate) during implementation. It:
//   - reads DATABASE_URL from the environment
//   - applies every *.sql file in /migrations in lexical order
//   - records applied files in a migration_history table
//   - supports: up, down, status commands
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/migrate.js up
//   DATABASE_URL=postgres://... node scripts/migrate.js down
//   DATABASE_URL=postgres://... node scripts/migrate.js status
//
// NOTE: per P1-07 §5, migrations are forward-only. `down` throws for
// migrations marked irreversible (see /migrations for examples).

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB_URL });

// Regex to detect irreversible migrations by marker in the file.
const IRREVERSIBLE_MARKER = /irreversible/i;

function listMigrations() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((name) => {
    const content = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const irreversible = IRREVERSIBLE_MARKER.test(content);
    return { name, content, irreversible };
  });
}

async function ensureTable() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migration_history (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedNames() {
  const { rows } = await client.query('SELECT name FROM migration_history');
  return new Set(rows.map((r) => r.name));
}

async function runUp() {
  await ensureTable();
  const applied = await appliedNames();
  for (const m of listMigrations()) {
    if (applied.has(m.name)) {
      console.log(`= (skipped) ${m.name}`);
      continue;
    }
    console.log(`+ applying ${m.name}`);
    await client.query('BEGIN');
    try {
      await client.query(m.content);
      await client.query('INSERT INTO migration_history (name) VALUES ($1)', [m.name]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✖ failed ${m.name}: ${err.message}`);
      process.exit(1);
    }
  }
  console.log('done (up)');
}

async function runDown() {
  await ensureTable();
  const applied = await appliedNames();
  const migrations = listMigrations().filter((m) => applied.has(m.name)).reverse();
  if (migrations.length === 0) {
    console.log('No applied migrations to revert.');
    await client.end();
    return;
  }
  const target = migrations[0];
  if (target.irreversible) {
    console.error(`✖ ${target.name} is IRREVERSIBLE. Manual rollback via DB backup required.`);
    process.exit(1);
  }
  // forward-only runner has no reversible SQL pairs; down is a no-op fallback
  await client.query('DELETE FROM migration_history WHERE name = $1', [target.name]);
  console.log(`- reverted (history only) ${target.name}`);
  console.log('done (down)');
}

async function runStatus() {
  await ensureTable();
  const applied = await appliedNames();
  for (const m of listMigrations()) {
    const state = applied.has(m.name) ? 'applied' : 'pending';
    const flag = m.irreversible ? ' [IRREVERSIBLE]' : '';
    console.log(`${state.padEnd(9)} ${m.name}${flag}`);
  }
  await client.end();
}

const cmd = process.argv[2] || 'status';
await client.connect();
try {
  if (cmd === 'up') await runUp();
  else if (cmd === 'down') await runDown();
  else await runStatus();
} finally {
  await client.end();
}