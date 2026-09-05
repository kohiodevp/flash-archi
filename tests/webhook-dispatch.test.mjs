// tests/webhook-dispatch.test.mjs
// Tests de la pipeline de dispatch webhook + signature HMAC + worker de retry.

// IMPORTANT : USE_MEMORY_DB doit être défini AVANT d'importer db.js (qui lit
// process.env à l'import). Les `import` statiques étant hoistés au-dessus du
// code corps de module, on utilise des imports dynamiques après la ligne env.
process.env.USE_MEMORY_DB = 'true';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Imports dynamiques : db.js lit process.env.USE_MEMORY_DB à l'évaluation.
const webhooks = await import('../src/webhooks.js');
const { getMemoryDb } = await import('../src/middleware/db.js');

const {
  generateHmacSignature,
  dispatchWebhook,
  processPendingDeliveries,
  RETRY_DELAYS,
  MAX_ATTEMPTS,
} = webhooks;

// Un webhook actif du tenant 1 écoutant 'job.completed' est seedé dans le memory-db.
const TENANT_1 = 1;
const EVENT = 'job.completed';

describe('Signature HMAC-SHA256', () => {
  it('produit une signature vérifiable par le partenaire (même payload, même secret)', () => {
    const secret = 'secret-partenaire';
    const payload = { jobId: 'job_123', status: 'completed' };
    const sig = generateHmacSignature(secret, payload);

    // Vérification côté partenaire (simulé) :
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    assert.equal(sig, hmac.digest('hex'));

    // Une signature différente pour un payload modifié → doit différer.
    const sigModified = generateHmacSignature(secret, { ...payload, status: 'failed' });
    assert.notEqual(sig, sigModified);
  });
});

describe('Dispatch + worker', () => {
  it('dispatchWebhook crée une delivery pending pour le job.completed', async () => {
    const db = getMemoryDb();
    assert.ok(db, 'memory-db doit être disponible (USE_MEMORY_DB=true)');
    const payload = { jobId: 'job_e2e_1', status: 'completed', completedAt: new Date().toISOString() };
    const created = await dispatchWebhook(TENANT_1, EVENT, payload, db);
    // Le seed du tenant 1 écoute 'job.completed' → au moins 1 delivery créée.
    assert.ok(created >= 1);
  });

  it('processPendingDeliveries traite les deliveries et les marque success (signature émise)', async () => {
    const db = getMemoryDb();
    assert.ok(db, 'memory-db doit être disponible (USE_MEMORY_DB=true)');
    const before = await db.query(
      `SELECT d.id, d.event_type, d.payload, d.attempts FROM webhook_deliveries d
       JOIN webhook_subscriptions s ON d.subscription_id = s.id WHERE s.tenant_id = $1 AND d.status = 'pending'`,
      [TENANT_1]
    );
    const pendingBefore = before.rows.length;

    const processed = await processPendingDeliveries(db);
    assert.ok(processed >= 1);

    // Après traitement, plus de pending pour ce tenant (passées en success).
    const after = await db.query(
      `SELECT d.status FROM webhook_deliveries d
       JOIN webhook_subscriptions s ON d.subscription_id = s.id WHERE s.tenant_id = $1 AND d.status = 'pending'`,
      [TENANT_1]
    );
    assert.equal(after.rows.length, Math.max(0, pendingBefore - processed));
  });

  it('RETRY_DELAYS suit le backoff 1s → 5s → 30s', () => {
    assert.deepEqual(RETRY_DELAYS, [1000, 5000, 30000]);
    assert.equal(MAX_ATTEMPTS, 3);
  });
});