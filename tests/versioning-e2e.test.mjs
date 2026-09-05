// tests/versioning-e2e.test.mjs
// Tests d'intégration (HTTP) des endpoints de versioning P2-02, en traversant le
// middleware DB réel (mode mémoire USE_MEMORY_DB). Verrouille le prérequis
// P1-01 minimal : plus d'erreur 500, codes corrects de bout en bout.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

// Active le mode mémoire AVANT d'importer l'app (le middleware lit cette variable à l'import).
process.env.USE_MEMORY_DB = 'true';
process.env.AUTH_ENABLED = 'false';
process.env.LLM_PROVIDER = 'mock';

const { default: app } = await import('../src/app.js');

const PID = '00000000-0000-0000-0000-000000000001';
const V1 = 'v1';

describe('P2-02 — endpoints versioning via middleware DB (mode mémoire)', () => {
  it('POST /versions crée une version manuelle -> 201', async () => {
    const res = await request(app)
      .post(`/api/flash-archi/projects/${PID}/versions`)
      .send({ message: 'Ajout piscine' });
    assert.equal(res.status, 201);
    assert.ok(res.body.id);
    assert.equal(res.body.version_number, 2);
    assert.equal(res.body.created_by, 'fa_test1234');
  });

  it('GET /versions liste les versions -> 200 + pagination', async () => {
    const res = await request(app).get(`/api/flash-archi/projects/${PID}/versions`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.versions));
    assert.ok(res.body.versions.length >= 1);
    assert.equal(typeof res.body.total, 'number');
  });

  it('GET /versions/:id -> 200 avec état parsé', async () => {
    const res = await request(app).get(`/api/flash-archi/projects/${PID}/versions/${V1}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, V1);
    assert.equal(res.body.versionNumber, 1);
    assert.equal(res.body.state.prompt, 'Maison familiale de 120 m² avec garage');
  });

  it('GET /versions/:v1/compare/:v2 -> 200 avec numéros de version', async () => {
    const create = await request(app)
      .post(`/api/flash-archi/projects/${PID}/versions`)
      .send({ message: 'Ajout garage intérieur' });
    assert.equal(create.status, 201);
    const v2 = create.body.id;
    const res = await request(app).get(`/api/flash-archi/projects/${PID}/versions/${V1}/compare/${v2}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.version1.versionNumber, 1);
    assert.equal(typeof res.body.diff, 'object');
  });

  it('POST /versions/:id/restore -> 200 (aucune session active)', async () => {
    const res = await request(app).post(`/api/flash-archi/projects/${PID}/versions/${V1}/restore`);
    assert.equal(res.status, 200);
    assert.match(res.body.message, /^Project restored to version 1/);
    assert.ok(res.body.newVersion.id);
  });

  it('POST /versions message vide -> 400', async () => {
    const res = await request(app)
      .post(`/api/flash-archi/projects/${PID}/versions`)
      .send({ message: '   ' });
    assert.equal(res.status, 400);
  });

  it('GET /versions/:id inconnu -> 404', async () => {
    const res = await request(app).get(`/api/flash-archi/projects/${PID}/versions/does-not-exist`);
    assert.equal(res.status, 404);
  });

  it('projet inconnu -> 404 (pas de fuite 500)', async () => {
    const res = await request(app).post('/api/flash-archi/projects/unknown/versions').send({ message: 'x' });
    assert.equal(res.status, 404);
  });
});