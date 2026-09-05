// tests/public-api.test.mjs
// Tests de l'API publique v1 (P2-03) — Phase 1 fondations.
// Traverse le middleware reel (dbMiddleware stateful mémoire) + publicAuth + rate limit.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.USE_MEMORY_DB = 'true';
process.env.AUTH_ENABLED = 'false';
process.env.LLM_PROVIDER = 'mock';

const { default: app } = await import('../src/app.js');

const PRO_KEY = 'fa_test_public_pro';
const READONLY_KEY = 'fa_test_public_readonly';
const PID_T1 = '00000000-0000-0000-0000-000000000001'; // projet tenant 1
const PID_T2 = '00000000-0000-0000-0000-000000000099'; // projet tenant 2

const authed = (token) => ({ Authorization: `Bearer ${token}` });

describe('P2-03 — API publique : authentification', () => {
  it('401 sans Authorization header', async () => {
    const res = await request(app).get('/api/public/v1/projects');
    assert.equal(res.status, 401);
  });

  it('401 avec clé inconnue', async () => {
    const res = await request(app).get('/api/public/v1/projects').set(authed('nope'));
    assert.equal(res.status, 401);
  });

  it('403 si scope requis manquant (clé read-only, scope write absent)', async () => {
    const res = await request(app)
      .post('/api/public/v1/projects')
      .set(authed(READONLY_KEY))
      .send({ name: 'Non autorisé' });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /forbidden/);
  });
});

describe('P2-03 — API publique : projets', () => {
  it('200 liste les projets du tenant (clé pro, scope read:projects)', async () => {
    const res = await request(app).get('/api/public/v1/projects').set(authed(PRO_KEY));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    // tenant 1 ne voit pas le projet du tenant 2 (isolation).
    const ids = res.body.items.map((p) => p.id);
    assert.ok(ids.includes(PID_T1));
    assert.ok(!ids.includes(PID_T2));
  });

  it('201 crée un projet (scope write:projects)', async () => {
    const res = await request(app)
      .post('/api/public/v1/projects')
      .set(authed(PRO_KEY))
      .send({ name: 'Nouveau projet', prompt: 'maison 80m2', parameters: { levels: 1 } });
    assert.equal(res.status, 201);
    assert.ok(res.body.id);
    assert.equal(res.body.name, 'Nouveau projet');
  });

  it('400 si name manquant', async () => {
    const res = await request(app)
      .post('/api/public/v1/projects')
      .set(authed(PRO_KEY))
      .send({ prompt: 'maison' });
    assert.equal(res.status, 400);
  });

  it('200 GET projet appartenant au tenant', async () => {
    const res = await request(app).get(`/api/public/v1/projects/${PID_T1}`).set(authed(PRO_KEY));
    assert.equal(res.status, 200);
    assert.equal(res.body.id, PID_T1);
  });

  it('404 GET projet d\'un autre tenant (RLS / isolation)', async () => {
    const res = await request(app).get(`/api/public/v1/projects/${PID_T2}`).set(authed(PRO_KEY));
    assert.equal(res.status, 404);
  });
});

describe('P2-03 — API publique : jobs', () => {
  it('404 POST job sur projet inexistant pour ce tenant', async () => {
    const res = await request(app)
      .post(`/api/public/v1/projects/${PID_T2}/jobs`)
      .set(authed(PRO_KEY))
      .send({ prompt: 'maison' });
    assert.equal(res.status, 404);
  });

  it('202 POST job sur projet du tenant (scope write:jobs)', async () => {
    const res = await request(app)
      .post(`/api/public/v1/projects/${PID_T1}/jobs`)
      .set(authed(PRO_KEY))
      .send({ prompt: 'maison familiale 100m2' });
    assert.equal(res.status, 202);
    assert.ok(res.body.jobId);
    assert.equal(res.body.status, 'pending');
  });

  it('404 GET job inconnu', async () => {
    const res = await request(app).get('/api/public/v1/jobs/does-not-exist').set(authed(PRO_KEY));
    assert.equal(res.status, 404);
  });
});