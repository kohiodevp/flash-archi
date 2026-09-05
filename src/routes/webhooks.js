// src/routes/webhooks.js
// Routes CRUD pour les webhooks (P2-03).
// Protégées par `dbMiddleware` (transactions + RLS) et `publicAuth(['public:manage:webhooks'])`.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { generateHmacSignature } from '../webhooks.js';
import { publicAuth } from '../middleware/public-auth.js';
import { publicRateLimit } from '../middleware/public-rate-limit.js';

const router = Router();

// Toutes les routes webhooks exigent le scope public:manage:webhooks + rate limiting.
const protect = [publicAuth(['public:manage:webhooks']), publicRateLimit()];

// Helper pour formater la réponse d'un webhook (sans révéler le secret)
const formatSubscription = (row) => ({
  id: row.id,
  url: row.url,
  events: row.events,
  active: row.active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  // Le secret n'est jamais retourné dans les réponses GET/PATCH
});

// -------------------------------------------------------------
// Webhooks
// -------------------------------------------------------------
// GET /api/public/v1/webhooks
router.get('/', ...protect, async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT id, url, events, active, created_at, updated_at
       FROM webhook_subscriptions
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [req.tenantId]
    );
    res.json({ items: result.rows.map(formatSubscription) });
  } catch (err) {
    console.error('[webhooks] GET /:', err);
    res.status(500).json({ error: 'webhook.internal', message: 'Internal server error' });
  }
});

// POST /api/public/v1/webhooks
router.post('/', ...protect, async (req, res) => {
  try {
    const { url, events } = req.body ?? {};
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return res.status(400).json({ error: 'webhook.invalid', message: 'Field "url" is required' });
    }
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'webhook.invalid', message: 'Field "events" must be a non-empty array' });
    }
    // Valider que les events sont des strings non vides
    for (const e of events) {
      if (typeof e !== 'string' || e.trim().length === 0) {
        return res.status(400).json({ error: 'webhook.invalid', message: 'Each event must be a non-empty string' });
      }
    }

    const id = randomUUID();
    const secret = randomUUID(); // Secret généré une seule fois
    const result = await req.db.query(
      `INSERT INTO webhook_subscriptions 
       (id, tenant_id, url, events, secret, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, url, events, active, created_at, updated_at`,
      [id, req.tenantId, url.trim(), events, secret, req.apiKey?.prefix ?? 'api']
    );

    const row = result.rows[0];
    // Retourner le secret UNE SEULE FOIS lors de la création
    res.status(201).json({ 
      ...formatSubscription(row),
      secret // Le secret est retourné ici seulement
    });
  } catch (err) {
    console.error('[webhooks] POST /:', err);
    res.status(500).json({ error: 'webhook.internal', message: 'Internal server error' });
  }
});

// GET /api/public/v1/webhooks/:id
router.get('/:id', ...protect, async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT id, url, events, active, created_at, updated_at
       FROM webhook_subscriptions
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'webhook.not_found', message: 'Webhook not found' });
    }
    res.json(formatSubscription(result.rows[0]));
  } catch (err) {
    console.error('[webhooks] GET /:id:', err);
    res.status(500).json({ error: 'webhook.internal', message: 'Internal server error' });
  }
});

// PATCH /api/public/v1/webhooks/:id
router.patch('/:id', ...protect, async (req, res) => {
  try {
    const { url, events, active } = req.body ?? {};
    // Construire dynamiquement la requête UPDATE
    const sets = [];
    const values = [];
    let paramIndex = 1;

    if (url !== undefined) {
      if (typeof url !== 'string' || url.trim().length === 0) {
        return res.status(400).json({ error: 'webhook.invalid', message: 'Field "url" must be a non-empty string' });
      }
      sets.push(`url = $${paramIndex++}`);
      values.push(url.trim());
    }

    if (events !== undefined) {
      if (!Array.isArray(events)) {
        return res.status(400).json({ error: 'webhook.invalid', message: 'Field "events" must be an array' });
      }
      if (events.length === 0) {
        return res.status(400).json({ error: 'webhook.invalid', message: "Field 'events' cannot be empty" });
      }
      for (const e of events) {
        if (typeof e !== 'string' || e.trim().length === 0) {
          return res.status(400).json({ error: 'webhook.invalid', message: 'Each event must be a non-empty string' });
        }
      }
      sets.push(`events = $${paramIndex++}`);
      values.push(events);
    }

    if (active !== undefined) {
      if (typeof active !== 'boolean') {
        return res.status(400).json({ error: 'webhook.invalid', message: 'Field "active" must be a boolean' });
      }
      sets.push(`active = $${paramIndex++}`);
      values.push(active);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'webhook.invalid', message: 'No valid fields to update' });
    }

    // Ajouter les conditions WHERE et les valeurs pour tenant_id et id
    sets.push(`updated_at = NOW()`);
    values.push(req.tenantId);
    values.push(req.params.id);

    // Les derniers placeholders correspondent à tenant_id et id (ordre de poussée).
    const tenantIdx = values.length - 1;
    const idIdx = values.length;
    const query = `
      UPDATE webhook_subscriptions
      SET ${sets.join(', ')}
      WHERE tenant_id = $${tenantIdx} AND id = $${idIdx}
      RETURNING id, url, events, active, created_at, updated_at
    `;

    const result = await req.db.query(query, values);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'webhook.not_found', message: 'Webhook not found' });
    }
    res.json(formatSubscription(result.rows[0]));
  } catch (err) {
    console.error('[webhooks] PATCH /:id:', err);
    res.status(500).json({ error: 'webhook.internal', message: 'Internal server error' });
  }
});

// DELETE /api/public/v1/webhooks/:id
router.delete('/:id', ...protect, async (req, res) => {
  try {
    const result = await req.db.query(
      `DELETE FROM webhook_subscriptions
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [req.params.id, req.tenantId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'webhook.not_found', message: 'Webhook not found' });
    }
    res.status(204).send(); // No content
  } catch (err) {
    console.error('[webhooks] DELETE /:id:', err);
    res.status(500).json({ error: 'webhook.internal', message: 'Internal server error' });
  }
});

export default router;