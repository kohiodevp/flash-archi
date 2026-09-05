// scripts/auto-versioning.js
// Cron job to create automatic versions every 5 minutes for projects that have been modified
// and have no active collaboration session.

const { Pool } = require('pg');

async function createAutoVersions() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Find projects modified since > 5 minutes ago and with no active collaboration session
    const { rows: projects } = await pool.query(`
      SELECT p.id, p.tenant_id, p.prompt, p.parameters, p.updated_at
      FROM projects p
      WHERE p.updated_at < now() - interval '5 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM collaborative_sessions cs
          WHERE cs.project_id = p.id
        )
        AND (
          -- Check if state has changed since last version
          NOT EXISTS (
            SELECT 1 FROM project_versions pv
            WHERE pv.project_id = p.id
              AND pv.state = jsonb_build_object('prompt', p.prompt, 'parameters', p.parameters)
          )
          OR NOT EXISTS (
            SELECT 1 FROM project_versions pv WHERE pv.project_id = p.id
          )
        )
    `);
    
    for (const project of projects) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL app.tenant_id = $1', [project.tenant_id]);
        
        // Import createManualVersion from versioning module
        const { createManualVersion } = require('../src/versioning');
        
        await createManualVersion(
          project.id,
          project.tenant_id,
          'Auto-snapshot',
          'system',
          client
        );
        
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Failed to create auto-version for project ${project.id}:`, err);
      } finally {
        client.release();
      }
    }
    
    console.log(`Created ${projects.length} auto-versions`);
  } finally {
    await pool.end();
  }
}

createAutoVersions().catch(console.error);