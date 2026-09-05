// scripts/compute-analytics.js
// Daily job to compute analytics snapshots for all tenants.
// This script is intended to be run by a cron job (e.g., daily at 02:00 UTC).

import { config } from '../config.js';
import { pool } from '../src/middleware/db.js';
import { computeDailySnapshot } from '../src/analytics.js';
import { getMemoryDb } from '../src/middleware/db.js';

const USE_MEMORY_DB = process.env.USE_MEMORY_DB === 'true';

async function getAllTenants(db) {
  if (USE_MEMORY_DB) {
    // In memory mode, we don't have a tenants table, but we can infer from the projects or webhook_subscriptions.
    // For simplicity, we'll return a fixed list of tenant IDs that we know exist in the memory store.
    // In a real scenario, we would query the tenants table.
    return [1, 2]; // tenant IDs from the memory store seed
  } else {
    const { rows } = await db.query('SELECT id FROM tenants');
    return rows.map(r => r.id);
  }
}

async function main() {
  let db;
  if (USE_MEMORY_DB) {
    db = getMemoryDb();
    if (!db) {
      console.error('Memory DB not initialized');
      process.exit(1);
    }
  } else {
    const client = await pool.connect();
    db = client;
    try {
      await db.query('BEGIN');
    } catch (err) {
      console.error('Failed to begin transaction:', err);
      await client.release();
      process.exit(1);
    }
  }

  try {
    const tenantIds = await getAllTenants(db);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    // We want to compute the snapshot for yesterday (full day)
    const startOfYesterday = new Date(yesterday);
    startOfYesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(startOfYesterday);
    endOfYesterday.setDate(endOfYesterday.getDate() + 1);

    console.log(`Computing analytics snapshot for ${tenantIds.length} tenants for date ${startOfYesterday.toISOString()}`);

    for (const tenantId of tenantIds) {
      try {
        await computeDailySnapshot(tenantId, startOfYesterday, db);
        console.log(`✓ Tenant ${tenantId} snapshot computed`);
      } catch (err) {
        console.error(`✗ Failed to compute snapshot for tenant ${tenantId}:`, err.message);
        // Continue with other tenants
      }
    }

    if (!USE_MEMORY_DB) {
      await db.query('COMMIT');
      console.log('Transaction committed');
    }
  } catch (err) {
    console.error('Unexpected error:', err);
    if (!USE_MEMORY_DB) {
      await db.query('ROLLBACK');
    }
    process.exit(1);
  } finally {
    if (!USE_MEMORY_DB && db.release) {
      db.release();
    }
  }
}

main().catch(err => {
  console.error('Unhandled promise rejection:', err);
  process.exit(1);
});