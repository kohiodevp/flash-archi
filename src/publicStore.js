// src/publicStore.js
// Store stateful pour l'API publique (P2-03) : tenants, clés API, plans.
// Mode mémoire (USE_MEMORY_DB=true) : seed déterministe pour tests standalone.
// En production : ce store est adossé aux tables `tenants` / `api_keys` via
// req.db (PostgreSQL). Les fonctions prennent un client db en paramètre.

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Mode mémoire — tenants + clés API + plans (seed déterministe)
// ---------------------------------------------------------------------------
let memorySingleton = null;

function buildMemoryStore() {
  const apiKeys = new Map();
  const tenants = new Map();

  const addTenant = (key, { tenantId, tenantPlan, scopes }) => {
    const kid = randomUUID();
    apiKeys.set(key, { id: kid, tenantId, tenantPlan, scopes: new Set(scopes), prefix: 'fa_pub_' + tenantId });
    return apiKeys.get(key);
  };

  // Tenant seed par défaut (plan pro, scopes complets) pour le happy-path.
  addTenant('fa_test_public_pro', {
    tenantId: 1,
    tenantPlan: 'pro',
    scopes: [
      'public:read:projects', 'public:write:projects',
      'public:read:jobs', 'public:write:jobs',
      'public:read:artifacts', 'public:read:versions',
      'public:write:versions', 'public:manage:webhooks',
    ],
  });
  // Tenant en lecture seule (pour tester le 403 sur scope manquant).
  addTenant('fa_test_public_readonly', {
    tenantId: 2,
    tenantPlan: 'free',
    scopes: ['public:read:projects', 'public:read:jobs', 'public:read:artifacts'],
  });
  // Tenant 2 avec scope webhook (pour tester l'isolation RLS sans 403 de scope).
  addTenant('fa_test_public_webhooks_t2', {
    tenantId: 2,
    tenantPlan: 'free',
    scopes: ['public:read:projects', 'public:manage:webhooks'],
  });

  return { apiKeys, tenants };
}

/**
 * Résout une clé API publique -> { tenantId, tenantPlan, scopes (Array), prefix }.
 * Mode mémoire ou PostgreSQL selon USE_MEMORY_DB.
 */
export async function resolveApiKey(apiKey, db) {
  if (!apiKey) return undefined;

  // Mode mémoire stateful.
  if (process.env.USE_MEMORY_DB === 'true') {
    memorySingleton ||= buildMemoryStore();
    const k = memorySingleton.apiKeys.get(apiKey);
    if (!k) return undefined;
    return {
      id: k.id,
      tenantId: k.tenantId,
      tenantPlan: k.tenantPlan,
      scopes: [...k.scopes],
      prefix: k.prefix,
    };
  }

  // Mode PostgreSQL — tables api_keys / tenants.
  // NOTE: schéma P1-01 simplifié ; adapté à la BDD réelle lors de P1-04.
  const res = await db.query(
    `SELECT
       ak.id, ak.prefix, ak.scopes, ak.tenant_id,
       t.plan AS tenant_plan
     FROM api_keys ak
     JOIN tenants t ON t.id = ak.tenant_id
     WHERE ak.api_key = $1 AND ak.revoked_at IS NULL`,
    [apiKey]
  );
  const row = res.rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantPlan: row.tenant_plan,
    scopes: row.scopes?.split(',') ?? [],
    prefix: row.prefix,
  };
}

/** Limites (requêtes/min) par plan — cohérent avec le Design Document. */
export const PLAN_LIMITS = Object.freeze({
  free: 100,
  pro: 500,
  enterprise: 1000,
});

export const DEFAULT_PLAN_LIMIT = 100;