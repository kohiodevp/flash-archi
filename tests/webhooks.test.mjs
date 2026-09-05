// tests/webhooks.test.mjs
// Tests des webhooks (P2-03) : signature HMAC, retry, dispatch, endpoints CRUD.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import crypto from 'node:crypto';

process.env.USE_MEMORY_DB = 'true';
process.env.AUTH_ENABLED = 'false';
process.env.LLM_PROVIDER = 'mock';

const { default: app } = await import('../src/app.js');
const { generateHmacSignature } = await import('../src/webhooks.js');

const PRO_KEY = 'fa_test_public_pro';
const authed = (token) => ({ Authorization: `Bearer ${token}` });

describe('Webhooks — HMAC signature', () => {
  it('génère une signature HMAC-SHA256 valide', () => {
    const secret = 'mysecret';
    const payload = { test: 'data', number: 42 };
    const signature = generateHmacSignature(secret, payload);
    
    // Vérifier que c'est bien une chaîne hexadécimale
    assert.match(signature, /^[0-9a-f]+$/);
    
    // Recalculer pour vérifier
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    const expected = hmac.digest('hex');
    assert.equal(signature, expected);
  });
});

describe('Webhooks — endpoints CRUD', () => {
  let webhookId = null;

  it('401 sans Authorization header', async () => {
    const res = await request(app).get('/api/public/v1/webhooks');
    assert.equal(res.status, 401);
  });

  it('201 créer un webhook (retourne secret une seule fois)', async () => {
    const res = await request(app)
      .post('/api/public/v1/webhooks')
      .set(authed(PRO_KEY))
      .send({
        url: 'https://example.com/webhook',
        events: ['job.completed', 'job.failed']
      });
    assert.equal(res.status, 201);
    assert.ok(res.body.id);
    assert.ok(res.body.secret); // Le secret est retourné à la création
    assert.equal(res.body.url, 'https://example.com/webhook');
    assert.deepEqual(res.body.events, ['job.completed', 'job.failed']);
    webhookId = res.body.id;
  });

  it('400 si URL manquante', async () => {
    const res = await request(app)
      .post('/api/public/v1/webhooks')
      .set(authed(PRO_KEY))
      .send({ events: ['job.completed'] });
    assert.equal(res.status, 400);
  });

  it('400 si events vide ou mal formé', async () => {
    const res = await request(app)
      .post('/api/public/v1/webhooks')
      .set(authed(PRO_KEY))
      .send({ url: 'https://example.com/webhook', events: [] });
    assert.equal(res.status, 400);
    
    const res2 = await request(app)
      .post('/api/public/v1/webhooks')
      .set(authed(PRO_KEY))
      .send({ url: 'https://example.com/webhook', events: [''] });
    assert.equal(res2.status, 400);
  });

  it('200 lister les webhooks (sans secrets)', async () => {
    const res = await request(app)
      .get('/api/public/v1/webhooks')
      .set(authed(PRO_KEY));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.ok(res.body.items.length >= 1);
    // Vérifier que les secrets ne sont pas retournés dans la liste
    for (const wh of res.body.items) {
      assert.equal(wh.secret, undefined);
      assert.ok(wh.id);
      assert.ok(wh.url);
    }
  });

  it('200 récupérer un webhook spécifique (sans secret)', async () => {
    const res = await request(app)
      .get(`/api/public/v1/webhooks/${webhookId}`)
      .set(authed(PRO_KEY));
    assert.equal(res.status, 200);
    assert.equal(res.body.id, webhookId);
    assert.equal(webhookId, res.body.id);
    assert.equal(res.body.url, 'https://example.com/webhook');
    assert.equal(res.body.secret, undefined); // Le secret ne doit jamais être retourné
  });

  it('200 mettre à jour un webhook', async () => {
    const res = await request(app)
      .patch(`/api/public/v1/webhooks/${webhookId}`)
      .set(authed(PRO_KEY))
      .send({ url: 'https://updated.com/webhook', events: ['job.failed'], active: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.url, 'https://updated.com/webhook');
    assert.deepEqual(res.body.events, ['job.failed']);
    assert.equal(res.body.active, false);
  });

  it('404 webhook inexistant', async () => {
    const res = await request(app)
      .get('/api/public/v1/webhooks/00000000-0000-0000-0000-000000000000')
      .set(authed(PRO_KEY));
    assert.equal(res.status, 404);
  });

  it('204 supprimer un webhook', async () => {
    const res = await request(app)
      .delete(`/api/public/v1/webhooks/${webhookId}`)
      .set(authed(PRO_KEY));
    assert.equal(res.status, 204);
    
    // Vérifier qu'il est bien supprimé
    const res2 = await request(app)
      .get(`/api/public/v1/webhooks/${webhookId}`)
      .set(authed(PRO_KEY));
    assert.equal(res2.status, 404);
  });
});

describe('Webhooks — isolation tenant (RLS)', () => {
  const T2_KEY = 'fa_test_public_webhooks_t2';

  it('404 si tenant 2 (scope webhook) accède au webhook du tenant 1', async () => {
    // Créer un webhook avec le tenant pro (tenant 1)
    const createRes = await request(app)
      .post('/api/public/v1/webhooks')
      .set(authed(PRO_KEY))
      .send({ url: 'https://tenant1.com/webhook', events: ['job.completed'] });
    assert.equal(createRes.status, 201);
    const webhookId = createRes.body.id;

    // Tenant 2 a le bon scope (public:manage:webhooks) mais appartient à un autre tenant
    // -> il ne doit PAS voir le webhook du tenant 1 (404, pas de fuite)
    const res = await request(app)
      .get(`/api/public/v1/webhooks/${webhookId}`)
      .set(authed(T2_KEY));
    assert.equal(res.status, 404);
  });

  it('200 le tenant 2 voit ses propres webhooks seulement', async () => {
    // Tenant 2 crée son propre webhook
    const createRes = await request(app)
      .post('/api/public/v1/webhooks')
      .set(authed('fa_test_public_webhooks_t2'))
      .send({ url: 'https://tenant2.com/webhook', events: ['job.completed'] });
    assert.equal(createRes.status, 201);

    // Il le voit
    const res = await request(app)
      .get('/api/public/v1/webhooks')
      .set(authed('fa_test_public_webhooks_t2'));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.ok(res.body.items.length >= 1);
    // Aucun webhook du tenant 1 ne doit apparaître
    for (const wh of res.body.items) {
      assert.notEqual(wh.url, 'https://tenant1.com/webhook');
    }
  });
});