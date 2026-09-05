// src/versioning.js
// Logic for project versioning: create manual/list/view/restore/compare versions.
// Fonctions pures prenant un client de base de données (pg Client/Pool) en paramètre.

export async function createManualVersion(projectId, tenantId, message, createdBy, db) {
  // Validate inputs
  if (!projectId || !tenantId || !message || !createdBy) {
    throw new Error('Missing required parameters');
  }

  // Fetch current project state
  const projectResult = await db.query(
    'SELECT prompt, parameters FROM projects WHERE id = $1',
    [projectId]
  );

  if (projectResult.rowCount === 0) {
    throw new Error('Project not found');
  }

  const state = {
    prompt: projectResult.rows[0].prompt,
    parameters: projectResult.rows[0].parameters || {}
  };

  // Get next version number
  const versionResult = await db.query(
    'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM project_versions WHERE project_id = $1',
    [projectId]
  );
  const nextVersion = versionResult.rows[0].next_version;

  // Insert new version
  const versionResultInsert = await db.query(
    `INSERT INTO project_versions (project_id, tenant_id, version_number, state, message, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, version_number, state, message, created_by, created_at`,
    [projectId, tenantId, nextVersion, JSON.stringify(state), message, createdBy]
  );

  return versionResultInsert.rows[0];
}

export async function listVersions(projectId, tenantId, limit, offset, db) {
  const result = await db.query(
    `SELECT id, version_number, message, created_by, created_at
     FROM project_versions
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [projectId, limit, offset]
  );

  const countResult = await db.query(
    'SELECT COUNT(*) AS total FROM project_versions WHERE project_id = $1',
    [projectId]
  );

  return {
    versions: result.rows.map((row) => ({
      id: row.id,
      versionNumber: row.version_number,
      message: row.message,
      createdBy: row.created_by,
      createdAt: row.created_at
    })),
    total: parseInt(countResult.rows[0].total, 10),
    limit,
    offset
  };
}

export async function getVersion(projectId, versionId, tenantId, db) {
  const result = await db.query(
    `SELECT id, version_number, state, message, created_by, created_at
     FROM project_versions
     WHERE id = $1 AND project_id = $2`,
    [versionId, projectId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    versionNumber: row.version_number,
    state: JSON.parse(row.state),
    message: row.message,
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}

export async function rollbackToVersion(projectId, versionId, tenantId, createdBy, db) {
  // Check for active collaboration session
  const sessionResult = await db.query(
    'SELECT COUNT(*) AS count FROM collaborative_sessions WHERE project_id = $1',
    [projectId]
  );

  if (parseInt(sessionResult.rows[0].count, 10) > 0) {
    throw new Error('Cannot rollback while users are editing the project');
  }

  // Fetch target version
  const versionResult = await db.query(
    `SELECT state, version_number
     FROM project_versions
     WHERE id = $1 AND project_id = $2`,
    [versionId, projectId]
  );

  if (versionResult.rowCount === 0) {
    throw new Error('Version not found');
  }

  const targetState = versionResult.rows[0].state;
  const targetVersionNumber = versionResult.rows[0].version_number;

  // Update project state
  await db.query(
    `UPDATE projects
     SET prompt = $1, parameters = $2, updated_at = now()
     WHERE id = $3`,
    [
      targetState.prompt,
      JSON.stringify(targetState.parameters),
      projectId
    ]
  );

  // Create rollback version
  const rollbackMessage = `Rollback to version ${targetVersionNumber}`;
  const newVersion = await createManualVersion(
    projectId,
    tenantId,
    rollbackMessage,
    createdBy,
    db
  );

  return {
    message: `Project restored to version ${targetVersionNumber}`,
    newVersion
  };
}

export function compareVersions(version1, version2) {
  const state1 = version1.state;
  const state2 = version2.state;

  const diff = {};

  // Compare prompt
  if (state1.prompt !== state2.prompt) {
    diff.prompt = {
      old: state1.prompt,
      new: state2.prompt
    };
  }

  // Compare parameters (deep)
  const params1 = state1.parameters || {};
  const params2 = state2.parameters || {};

  const allKeys = new Set([...Object.keys(params1), ...Object.keys(params2)]);

  for (const key of allKeys) {
    if (JSON.stringify(params1[key]) !== JSON.stringify(params2[key])) {
      diff.parameters = diff.parameters || {};
      diff.parameters[key] = {
        old: params1[key],
        new: params2[key]
      };
    }
  }

  return {
    version1: {
      versionNumber: version1.version_number ?? version1.versionNumber,
      state: state1
    },
    version2: {
      versionNumber: version2.version_number ?? version2.versionNumber,
      state: state2
    },
    diff
  };
}

export async function createAutoVersion(projectId, tenantId, db) {
  // Fetch current project state
  const projectResult = await db.query(
    'SELECT prompt, parameters FROM projects WHERE id = $1',
    [projectId]
  );

  if (projectResult.rowCount === 0) {
    throw new Error('Project not found');
  }

  const state = {
    prompt: projectResult.rows[0].prompt,
    parameters: projectResult.rows[0].parameters || {}
  };

  // Get next version number
  const versionResult = await db.query(
    'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM project_versions WHERE project_id = $1',
    [projectId]
  );
  const nextVersion = versionResult.rows[0].next_version;

  // Insert auto-snapshot version
  const versionResultInsert = await db.query(
    `INSERT INTO project_versions (project_id, tenant_id, version_number, state, message, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, version_number, state, message, created_by, created_at`,
    [projectId, tenantId, nextVersion, JSON.stringify(state), 'Auto-snapshot', 'system']
  );

  return versionResultInsert.rows[0];
}

export async function purgeOldVersions(db) {
  // Delete versions beyond the 100 most recent per project
  const result = await db.query(`
    DELETE FROM project_versions
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC) as rn
        FROM project_versions
      ) ranked
      WHERE rn > 100
    )
  `);

  return result.rowCount;
}