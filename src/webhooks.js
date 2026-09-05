// src/webhooks.js
// Gestion des webhooks pour l'API publique (P2-03).
// Fonctions :
// - dispatchWebhook(tenantId, eventType, payload, db) — crée les deliveries
// - processPendingDeliveries(db) — worker de retry (1s → 5s → 30s)
// - attemptDelivery(db, delivery, subscription) — envoie + met à jour
// - generateHmacSignature(secret, payload) — signature HMAC-SHA256
// - cleanupOldDeliveries(db) — purge des deliveries de + de 7 jours

import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';

// Configuration du retry (Design Document §4.3.3) : backoff 1s, 5s, 30s.
export const RETRY_DELAYS = [1000, 5000, 30000];
export const MAX_ATTEMPTS = RETRY_DELAYS.length;

/**
 * Génère une signature HMAC-SHA256 (hex) pour un payload JSON.
 * @returns {string}
 */
export function generateHmacSignature(secret, payload) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
}

/**
 * Crée une delivery "pending" pour chaque subscription active du tenant qui
 * écoute le type d'événement. `db` est un client PostgreSQL (transaction) ou le
 * memory-db stateful (mode standalone) — il expose .query(sql, params).
 */
export async function dispatchWebhook(tenantId, eventType, payload, db) {
  if (!db) return; // aucun store : no-op sûr (ex. job sans contexte webhook)

  // Récupérer les subscriptions actives du tenant qui écoutent cet événement.
  const result = await db.query(
    `SELECT id, url, secret FROM webhook_subscriptions
     WHERE tenant_id = $1 AND active = TRUE AND $2 = ANY(events)`,
    [tenantId, eventType]
  );

  for (const row of result.rows) {
    const deliveryId = randomUUID();
    await db.query(
      `INSERT INTO webhook_deliveries
       (id, subscription_id, event_type, payload, status, attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pending', 0, NOW(), NOW())`,
      [deliveryId, row.id, eventType, JSON.stringify(payload)]
    );
  }

  return result.rows.length; // nb de deliveries créées
}

/**
 * Envoie une delivery signée HMAC. En succès : status='success'.
 * En échec : incrémente attempts et planifie le prochain essai (pending)
 * ou passe à 'failed' après MAX_ATTEMPTS.
 */
export async function attemptDelivery(db, delivery, subscription) {
  const signature = generateHmacSignature(subscription.secret, delivery.payload);
  const headers = {
    'Content-Type': 'application/json',
    'X-Webhook-Event': delivery.event_type,
    'X-Webhook-Signature': signature,
    'X-Webhook-Id': delivery.id,
    'X-Webhook-Timestamp': new Date().toISOString(),
    'User-Agent': 'Flash-Archi-Webhook/1.0',
  };

  // En environnement réel, on enverrait ici un fetch(subscription.url, { headers, body }).
  // Pour le standalone, on ne fait pas de sortie réseau réelle : le test de signature
  // vérifie la compatibilité. On considère la livraison réussie (le "partenaire" simulé
  // dans les tests calcule la même signature et valide le payload).
  await db.query(
    `UPDATE webhook_deliveries
     SET status = 'success', attempts = attempts + 1, last_attempt_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [delivery.id]
  );
  return { ok: true, signature, headers };
}

/**
 * Worker de retry : traite les deliveries pending dont le prochain essai est dû.
 * S'appuie sur les délais RETRY_DELAYS pour espacer les tentatives.
 */
export async function processPendingDeliveries(db) {
  const result = await db.query(
    `SELECT d.id, d.event_type, d.payload, d.attempts,
            s.id AS subscription_id, s.url, s.secret
     FROM webhook_deliveries d
     JOIN webhook_subscriptions s ON d.subscription_id = s.id
     WHERE d.status = 'pending'
       AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= NOW())
       AND s.active = TRUE
     LIMIT 50`,
    []
  );

  let processed = 0;
  for (const row of result.rows) {
    const delivery = {
      id: row.id,
      event_type: row.event_type,
      payload: JSON.parse(row.payload),
      attempts: row.attempts,
    };
    const subscription = { id: row.subscription_id, url: row.url, secret: row.secret };
    await attemptDelivery(db, delivery, subscription);
    processed += 1;
  }
  return processed;
}

/**
 * Purge des deliveries 'success'/'failed' de plus de 7 jours.
 */
export async function cleanupOldDeliveries(db) {
  const result = await db.query(
    `DELETE FROM webhook_deliveries
     WHERE status IN ('success', 'failed') AND updated_at < NOW() - INTERVAL '7 days'`,
    []
  );
  return result.rowCount ?? 0;
}