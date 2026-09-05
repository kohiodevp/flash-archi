// src/routes/public.js
// API publique v1 (P2-03) — projets, jobs, artefacts.
// Routes protégées par `dbMiddleware` (transactions + RLS) et `publicAuth(scopes)`.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { validateGenerateRequest } from '../validators.js';
import { jobStore, runJobAsync, JOB_STATUS } from '../jobs.js';
import { generateArchitecture } from '../engine.js';
import { publicAuth } from '../middleware/public-auth.js';
import { publicRateLimit } from '../middleware/public-rate-limit.js';

const router = Router();

// Helpers de protection par scope : auth + rate limiting par plan.
const protect = (...scopes) => [publicAuth(scopes), publicRateLimit()];

const publicProjectView = (row) => ({
  id: row.id,
  name: row.name,
  prompt: row.prompt,
  parameters: row.parameters,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

// -------------------------------------------------------------
// Projects
// -------------------------------------------------------------
// GET /api/public/v1/projects
router.get('/projects', ...protect('public:read:projects'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const result = await req.db.query(
      `SELECT id, name, prompt, parameters, tenant_id, created_by, created_at, updated_at
       FROM projects WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.tenantId, limit, offset]
    );
    res.json({
      items: result.rows.map(publicProjectView),
      limit,
      offset,
      count: result.rows.length,
    });
  } catch (err) {
    console.error('[public] GET /projects:', err);
    res.status(500).json({ error: 'public.internal', message: 'Internal server error' });
  }
});

// POST /api/public/v1/projects
router.post('/projects', ...protect('public:write:projects'), async (req, res) => {
  try {
    const { name, prompt, parameters } = req.body ?? {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'public.invalid', message: 'Field "name" is required' });
    }
    const id = randomUUID();
    const result = await req.db.query(
      `INSERT INTO projects (id, name, prompt, parameters, tenant_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, name.trim(), prompt ?? '', JSON.stringify(parameters ?? {}), req.tenantId, req.apiKey?.prefix ?? 'api']
    );
    const row = result.rows[0];
    res.status(201).json(row ? publicProjectView(row) : { id, name: name.trim() });
  } catch (err) {
    console.error('[public] POST /projects:', err);
    res.status(500).json({ error: 'public.internal', message: 'Internal server error' });
  }
});

// GET /api/public/v1/projects/:projectId
router.get('/projects/:projectId', ...protect('public:read:projects'), async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT id, name, prompt, parameters, tenant_id, created_by, created_at, updated_at
       FROM projects WHERE id = $1 AND tenant_id = $2`,
      [req.params.projectId, req.tenantId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'public.not_found', message: 'Project not found' });
    }
    res.json({ ...publicProjectView(result.rows[0]), prompt: result.rows[0].prompt });
  } catch (err) {
    console.error('[public] GET /projects/:id:', err);
    res.status(500).json({ error: 'public.internal', message: 'Internal server error' });
  }
});

// PATCH /api/public/v1/projects/:projectId
router.patch('/projects/:projectId', ...protect('public:write:projects'), async (req, res) => {
  try {
    const { name, prompt, parameters } = req.body ?? {};
    const result = await req.db.query(
      `UPDATE projects SET name = COALESCE($1, name), prompt = COALESCE($2, prompt), parameters = COALESCE($3, parameters), updated_at = NOW()
       WHERE id = $4 AND tenant_id = $5
       RETURNING id, name, prompt, parameters, tenant_id, created_by, created_at, updated_at`,
      [name ?? undefined, prompt ?? undefined, parameters ?? undefined, req.params.projectId, req.tenantId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'public.not_found', message: 'Project not found' });
    }
    res.json({ ...publicProjectView(result.rows[0]), prompt: result.rows[0].prompt });
  } catch (err) {
    console.error('[public] PATCH /projects/:id:', err);
    res.status(500).json({ error: 'public.internal', message: 'Internal server error' });
  }
});

// DELETE /api/public/v1/projects/:projectId
router.delete('/projects/:projectId', ...protect('public:write:projects'), async (req, res) => {
  try {
    const result = await req.db.query(
      `DELETE FROM projects WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.projectId, req.tenantId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'public.not_found', message: 'Project not found' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('[public] DELETE /projects/:id:', err);
    res.status(500).json({ error: 'public.internal', message: 'Internal server error' });
  }
});

// -------------------------------------------------------------
// Jobs
// -------------------------------------------------------------
// POST /api/public/v1/projects/:projectId/jobs
router.post('/projects/:projectId/jobs', ...protect('public:write:jobs'), async (req, res) => {
  try {
    // Vérifie que le projet appartient au tenant.
    const proj = await req.db.query(
      `SELECT id FROM projects WHERE id = $1 AND tenant_id = $2`,
      [req.params.projectId, req.tenantId]
    );
    if (proj.rowCount === 0) {
      return res.status(404).json({ error: 'public.not_found', message: 'Project not found' });
    }

    const check = validateGenerateRequest(req.body ?? {});
    if (!check.ok) {
      return res.status(400).json({ error: 'public.invalid', message: check.error });
    }
    const job = jobStore.create(check.data.prompt);
    runJobAsync(generateArchitecture, job.id, job.prompt);
    res.status(202).json({ jobId: job.id, status: job.status, projectId: req.params.projectId });
  } catch (err) {
    console.error('[public] POST /projects/:id/jobs:', err);
    res.status(500).json({ error: 'public.internal', message: 'Internal server error' });
  }
});

// GET /api/public/v1/jobs/:jobId
router.get('/jobs/:jobId', ...protect('public:read:jobs'), (req, res) => {
  const job = jobStore.publicView(jobStore.get(req.params.jobId));
  if (!job) {
    return res.status(404).json({ error: 'public.not_found', message: 'Job not found' });
  }
  res.json(job);
});

// GET /api/public/v1/jobs/:jobId/artifacts
router.get('/jobs/:jobId/artifacts', ...protect('public:read:artifacts'), (req, res) => {
  const job = jobStore.publicView(jobStore.get(req.params.jobId));
  if (!job) {
    return res.status(404).json({ error: 'public.not_found', message: 'Job not found' });
  }
  if (job.status !== JOB_STATUS.COMPLETED || !job.result) {
    return res.status(409).json({ error: 'public.job_not_ready', message: 'Artifacts not available until job completes' });
  }
  const r = job.result;
  const artifacts = [
    { type: 'spec', format: 'json', data: r.spec },
    { type: 'plan2d', format: 'svg', data: r.plan2d?.svg ?? null },
    { type: 'facades', format: 'png', data: { north: !!r.facades?.north, south: !!r.facades?.south, east: !!r.facades?.east, west: !!r.facades?.west } },
    { type: 'ifc', format: 'ifc4', data: r.ifcModel ?? null },
    { type: 'bim_metrics', format: 'json', data: r.bimMetrics ?? null },
  ];
  res.json({ jobId: req.params.jobId, items: artifacts });
});

export default router;