// src/middleware/db.js
// Middleware DB — version simplifiée du middleware DB P1-01.
// En production, il sera remplacé par le middleware complet avec
// authentification HMAC-SHA256, quotas, et gestion des clés API.
// Voir Design Document P1-01 pour la version complète.
//
// Modes :
//   - PostgreSQL réel (défaut) : pool pg, BEGIN, activation RLS via
//     `SET LOCAL app.tenant_id` quand req.tenantId est présent.
//   - Mémoire (USE_MEMORY_DB=true) : mini-store stateful (projets + versions +
//     sessions) au niveau process, répondant aux requêtes du module versioning,
//     afin de rendre les endpoints réellement exécutables de bout en bout dans
//     un environnement standalone sans PostgreSQL.

import { config } from '../config.js';
import pg from 'pg';
import { executeMemoryQuery } from './memory-query.js';
import { randomUUID } from 'node:crypto';

const USE_MEMORY_DB = process.env.USE_MEMORY_DB === 'true';

let pool;
if (!USE_MEMORY_DB) {
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ||
      `postgres://${config.db.user || 'betsa'}:${config.db.password || 'betsa'}@${config.db.host || 'localhost'}:${config.db.port || 5432}/${config.db.name || 'flash_archi'}`
  });
}

// Normalise le SQL (espaces, retours à la ligne, tabulations) pour un matching
// robuste entre les requêtes multi-lignes émises par versioning.js et nos patterns.
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Mode mémoire — mini-store stateful (projets + versions + sessions).
// Singleton au niveau process : les données persistent entre les requêtes,
// comme le ferait un vrai PostgreSQL, pour tester des flux multi-appels.
// ---------------------------------------------------------------------------
let memoryDbSingleton = null;

function buildMemoryDb() {
  const projects = new Map([
    ['00000000-0000-0000-0000-000000000001', {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Villa contemporaine',
      prompt: 'Maison familiale de 120 m² avec garage',
      parameters: { levels: 1, style: 'contemporain' },
      tenant_id: 1,
      created_by: 'system',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    }],
    ['00000000-0000-0000-0000-000000000099', {
      id: '00000000-0000-0000-0000-000000000099',
      name: 'Projet tenant 2',
      prompt: 'Studio 30 m²',
      parameters: { levels: 0 },
      tenant_id: 2,
      created_by: 'system',
      created_at: new Date('2026-02-01T00:00:00Z'),
      updated_at: new Date('2026-02-01T00:00:00Z'),
    }],
  ]);
  const versions = [
    {
      id: 'v1', project_id: '00000000-0000-0000-0000-000000000001',
      version_number: 1, tenant_id: 1,
      state: { prompt: 'Maison familiale de 120 m² avec garage', parameters: { levels: 1, style: 'contemporain' } },
      message: 'Version initiale', created_by: 'system',
      created_at: new Date('2026-01-01T00:00:00Z'),
    },
  ];
  const sessions = [];
  // Webhooks P2-03 : subscriptions + deliveries vivent dans CE store (server via req.db).
  const webhookSubscriptions = new Map();
  const webhookDeliveries = new Map();
  // Seed d'un webhook actif pour le tenant 1 (tests + smoke).
  {
    const seedSub = {
      id: '00000000-0000-0000-0000-0000000000a1',
      tenant_id: 1,
      url: 'https://example.com/webhook',
      events: ['job.completed', 'job.failed'],
      secret: randomUUID(),
      active: true,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    };
    webhookSubscriptions.set(seedSub.id, seedSub);
  }

  // Analytics tables for P2-05
  const analytics_snapshots = [];
  const tenant_analytics_config = new Map(); // key: tenant_id
  const analytics_exports = [];

  // Seed default analytics config for existing tenants in memory (tenant 1 and 2)
  // We'll seed for tenant 1 (free) and tenant 2 (pro) as examples
  // In a real scenario, the trigger would fire on tenant creation, but in memory we simulate.
  function seedTenantAnalyticsConfig(tid, plan) {
    let costThreshold = 100;
    let errorRate = 0.05;
    let queueDepth = 100;
    if (plan === 'free') {
      costThreshold = 50;
      errorRate = 0.05;
      queueDepth = 50;
    } else if (plan === 'pro') {
      costThreshold = 200;
      errorRate = 0.05;
      queueDepth = 100;
    } else if (plan === 'enterprise') {
      costThreshold = 2000;
      errorRate = 0.03;
      queueDepth = 500;
    }
    tenant_analytics_config.set(tid, {
      tenant_id: tid,
      cost_threshold_usd: costThreshold,
      error_rate_threshold: errorRate,
      queue_depth_threshold: queueDepth,
      alert_email_enabled: true,
      alert_webhook_enabled: true,
      updated_at: new Date()
    });
  }
  // We don't have a list of tenants in memory; we'll seed on demand when a tenant is first seen.
  // For simplicity, we'll seed when we see a tenant in queries.
  // We'll handle it in the query logic for tenant_analytics_config.

  const state = {
    projects,
    versions,
    sessions,
    webhookSubscriptions,
    webhookDeliveries,
    analytics_snapshots,
    tenant_analytics_config,
    analytics_exports
  };

  const db = {
    async query(sql, params = []) {
      return executeMemoryQuery(state, sql, params);
    },
    release() {}
  };
  return db;
}

      export async function dbMiddleware(req, res, next) {
        let client;
        if (USE_MEMORY_DB) {
          memoryDbSingleton ||= buildMemoryDb();
          req.db = memoryDbSingleton;
          req.tenantId = req.tenantId || 1;
          req.apiKey = req.apiKey || { prefix: 'fa_test1234' };
          next();
          return;
        }

        client = await pool.connect();
        try {
          await client.query('BEGIN');
          if (req.tenantId) {
            await client.query('SET LOCAL app.tenant_id = $1', [req.tenantId]);
          }
          if (req.apiKey?.prefix) {
            await client.query('SET LOCAL app.api_key_prefix = $1', [req.apiKey.prefix]);
          }
          req.db = client;
          next();
        } catch (err) {
          client.release();
          next(err);
        }
      }

      export async function dbRelease(req, res, next) {
        if (req.db) {
          try {
            await req.db.query('COMMIT');
          } catch (err) {
            await req.db.query('ROLLBACK');
          } finally {
            await req.db.query('RELEASE SAVEPOINT pending_tx')?.catch(() => {});
            await req.db.release();
          }
        }
        next();
      }

      /** Accès au memory-db stateful (mode standalone) pour le worker webhook. */
      export function getMemoryDb() {
        return USE_MEMORY_DB ? (memoryDbSingleton ||= buildMemoryDb()) : undefined;
      }

      export { pool };