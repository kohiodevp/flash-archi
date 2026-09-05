import express from 'express';
import cors from 'cors';
import { RailwayStatus } from './schemas.js';
import { generateArchitecture, ENGINE } from './engine.js';
import { jobStore, runJobAsync, subscribe, JOB_STATUS } from './jobs.js';
import { validateGenerateRequest } from './validators.js';
import { authenticate } from './auth.js';
import rateLimit from 'express-rate-limit';
import { createLogger } from './logger.js';
import requestId from './requestId.js';
import { getHealthStatus, getReadyStatus, getVersionInfo } from './health.js';
import { config } from './config.js';
import { createManualVersion, listVersions, getVersion, rollbackToVersion, compareVersions } from './versioning.js';
import { dbMiddleware, dbRelease } from './middleware/db.js';
import publicRouter from './routes/public.js';
import webhooksRouter from './routes/webhooks.js';
import analyticsRouter from './routes/analytics.js';
import adminAnalyticsRouter from './routes/admin-analytics.js';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openApiSpec = YAML.load(path.join(__dirname, '..', 'openapi', 'spec.yaml'));

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const { logger, httpLogger } = createLogger();
app.use(requestId);
app.use(httpLogger);

// ---- Authentification API key (interne) ----
// Requiert AUTH_ENABLED=true et API_KEY définie.
// Si AUTH_ENABLED=false, le middleware est by-passé (utile en dev uniquement avec mock).
// L'API publique (P2-03) a sa propre authentification par clé API + scopes : on
// l'exclut explicitement de l'authentification interne.
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/public/v1')) return next(); // auth publique (routée ailleurs)
  return authenticate(req, res, next);
});

// ---- Rate limiting (express-rate-limit) -------------------------
// Default limit: 60 requests per windowMs per IP
// For stricter control per API key, a custom keyGenerator could be used later.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    res.status(429).json({
      error: 'too_many_requests',
      message: 'Rate limit exceeded'
    });
  }
});
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/public/v1')) return next(); // rate limiting par plan (P2-03), routé ailleurs
  return apiLimiter(req, res, next);
});

const startedAt = Date.now();
const VERSION = '3.3.0';

// ---- Health -------------------------------------------------
app.get('/health', (_req, res) => {
  const body = getHealthStatus(startedAt, VERSION);
  res.json(body);
});

// Healthz alias (same as health)
app.get('/healthz', (_req, res) => {
  const body = getHealthStatus(startedAt, VERSION);
  res.json(body);
});

// Readyz - check dependencies (currently just database)
app.get('/readyz', (_req, res) => {
  const body = getReadyStatus(config.db.path);
  res.json(body);
});

// Version endpoint
app.get('/version', (_req, res) => {
  const body = getVersionInfo(VERSION);
  res.json(body);
});

// ---- GET / -> liste des jobs récents --------------------------
app.get('/', (_req, res) => {
  res.json({ service: 'flash-archi-saas', version: VERSION, endpoints: ['/health', '/healthz', '/readyz', '/version', '/api/flash-archi/generate', '/api/flash-archi/jobs', '/api/flash-archi/jobs/:id', '/api/flash-archi/events/:id', '/api/flash-archi/projects/:projectId/versions', '/api/public/v1/projects', '/api/public/v1/jobs', '/api/public/v1/webhooks', '/api/docs'] });
});

// ---- GET /api/docs -> Swagger UI (OpenAPI P2-03 Phase 3) -----
// Documentation interactive. La spec openapi/spec.yaml couvre l'API publique
// (api/public/v1/**) et l'API interne versions (/api/flash-archi/**).
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  customSiteTitle: 'Flash-Archi API Documentation',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true,
    docExpansion: 'list',
    filter: true,
  },
}));

// ---- GET /jobs -> liste paginée des jobs récents -----------------
const MAX_LIST_LIMIT = 50;
app.get('/api/flash-archi/jobs', (req, res) => {
  const rawLimit = Number.parseInt(req.query.limit ?? '20', 10);
  const rawOffset = Number.parseInt(req.query.offset ?? '0', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_LIST_LIMIT) : 20;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
  // Vue publique : pas de prompt brut exposé sur l'index (parallèle à publicView).
  const items = jobStore
    .list(limit, offset)
    .map((j) => ({ id: j.id, status: j.status, error: j.error, createdAt: j.createdAt, updatedAt: j.updatedAt }));
  res.json({ items, limit, offset, count: items.length });
});

// ---- POST /generate ------------------------------------------
app.post('/api/flash-archi/generate', (req, res) => {
  const check = validateGenerateRequest(req.body);
  if (!check.ok) {
    res.status(400).json(check.details ? { error: check.error, details: check.details } : { error: check.error });
    return;
  }
  const { prompt } = check.data;
  const job = jobStore.create(prompt);
  runJobAsync(generateArchitecture, job.id, job.prompt) // asynchrone, ne bloque pas la réponse
  res.status(202).json({ jobId: job.id, status: job.status });
});

// ---- GET /jobs/:id -------------------------------------------
app.get('/api/flash-archi/jobs/:id', (req, res) => {
  const job = jobStore.publicView(jobStore.get(req.params.id));
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

// ---- GET /events/:id (Server-Sent Events) ---------------------
app.get('/api/flash-archi/events/:id', (req, res) => {
  const jobId = req.params.id;
  const job = jobStore.get(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const unsub = subscribe(jobId, push);
  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 20000);

  const finalize = () => {
    clearInterval(keepAlive);
    unsub();
    res.end();
  };

  function push(event) {
    send({ jobId, type: event?.type ?? 'status', ...event });
    if (event?.status === JOB_STATUS.COMPLETED || event?.status === JOB_STATUS.FAILED) {
      finalize();
    }
  }

  // Envoie l'état courant immédiatement.
  const current = jobStore.publicView(job);
  send({ jobId, type: 'status', status: current.status, result: current.result, error: current.error });

  // Si le job est déjà terminé, on clôt tout de suite.
  if (current.status === JOB_STATUS.COMPLETED || current.status === JOB_STATUS.FAILED) {
    finalize();
    return;
  }

  req.on('close', () => {
    clearInterval(keepAlive);
    unsub();
  });
});

app.use('/api/flash-archi/projects/:projectId/versions', dbMiddleware);
// ---- API publique v1 (P2-03) ---------------------------------
// dbMiddleware à ce niveau : fournit req.db + transactions + RLS.
// Auth + rate limiting par route (voir src/routes/public.js).
app.use('/api/public/v1', dbMiddleware, publicRouter);
// ---- Webhooks v1 (P2-03) -------------------------------------
// dbMiddleware à ce niveau : fournit req.db + transactions + RLS.
// Auth + rate limiting par route (voir src/routes/webhooks.js).
app.use('/api/public/v1/webhooks', dbMiddleware, webhooksRouter);
app.use('/api/public/v1/analytics', dbMiddleware, analyticsRouter);
app.use('/api/public/v1/admin/analytics', dbMiddleware, adminAnalyticsRouter);
// ---- Versioning endpoints --------------------------------------
app.get('/api/flash-archi/projects/:projectId/versions', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const offset = parseInt(req.query.offset) || 0;
    
    const result = await listVersions(req.params.projectId, req.tenantId, limit, offset, req.db);
    res.json(result);
  } catch (err) {
    if (err.message === 'Project not found') {
      return res.status(404).json({ error: 'Project not found' });
    }
    console.error('Error listing versions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/flash-archi/projects/:projectId/versions', authenticate, async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const version = await createManualVersion(
      req.params.projectId,
      req.tenantId,
      message.trim(),
      req.apiKey.prefix,
      req.db
    );
    
    res.status(201).json(version);
  } catch (err) {
    if (err.message === 'Project not found') {
      return res.status(404).json({ error: 'Project not found' });
    }
    console.error('Error creating manual version:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/flash-archi/projects/:projectId/versions/:versionId', authenticate, async (req, res) => {
  try {
    const version = await getVersion(req.params.projectId, req.params.versionId, req.tenantId, req.db);
    
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }
    
    res.json(version);
  } catch (err) {
    console.error('Error getting version:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/flash-archi/projects/:projectId/versions/:versionId/restore', authenticate, async (req, res) => {
  try {
    const result = await rollbackToVersion(
      req.params.projectId,
      req.params.versionId,
      req.tenantId,
      req.apiKey.prefix,
      req.db
    );
    
    res.json(result);
  } catch (err) {
    if (err.message === 'Version not found') {
      return res.status(404).json({ error: 'Version not found' });
    }
    if (err.message === 'Cannot rollback while users are editing the project') {
      return res.status(409).json({ error: err.message });
    }
    console.error('Error rolling back version:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/flash-archi/projects/:projectId/versions/:v1/compare/:v2', authenticate, async (req, res) => {
  try {
    const version1 = await getVersion(req.params.projectId, req.params.v1, req.tenantId, req.db);
    const version2 = await getVersion(req.params.projectId, req.params.v2, req.tenantId, req.db);
    
    if (!version1) {
      return res.status(404).json({ error: 'Version not found: ' + req.params.v1 });
    }
    if (!version2) {
      return res.status(404).json({ error: 'Version not found: ' + req.params.v2 });
    }
    
    const comparison = compareVersions(version1, version2);
    res.json(comparison);
  } catch (err) {
    console.error('Error comparing versions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Middleware d'erreur unifié (dernier recours) ---------------
// Consomme l'erreur et retourne un JSON sans fuite de pile en production.
app.use(dbRelease);
app.use((err, _req, res, _next) => {
  const status = err?.status ?? err?.statusCode ?? 500;
  const message = (process.env.NODE_ENV === 'production' && status === 500)
    ? 'Internal server error'
    : (err?.message ?? 'Unexpected error');
  if (status >= 500) console.error('[flash-archi-saas] Erreur:', err);
  res.status(status).json({ error: message });
});

export { app };
export default app;