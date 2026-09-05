// scripts/purge-old-versions.js
// Cron job to purge old versions, keeping only the 100 most recent per project.

const { Pool } = require('pg');

async function purgeOldVersions() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    const { rowCount } = await pool.query(`
      DELETE FROM project_versions
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC) as rn
          FROM project_versions
        ) ranked
        WHERE rn > 100
      )
    `);
    
    console.log(`Purged ${rowCount} old versions`);
  } finally {
    await pool.end();
  }
}

purgeOldVersions().catch(console.error);