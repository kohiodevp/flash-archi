// tests/public-rate-limit.test.mjs
// Tests unitaires du rate limiting public par plan (P2-03).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { publicRateLimit } from '../src/middleware/public-rate-limit.js';
import { resolveApiKey } from '../src/publicStore.js';

// Simule un cycle requête/réponse express minimal.
function fakeCycle(setHeaders, plan) {
  const headers = {};
  return {
    req: { apiKey: { prefix: `ut_${plan}` }, tenantPlan: plan },
    res: {
      setHeader: (k, v) => { headers[k] = v; setHeaders(headers); },
      on: (evt, cb) => { if (evt === 'finish') cb(); },
      removeListener: () => {},
      status: (code) => ({ json: (body) => ({ code, body }) }),
    },
  };
}

describe('publicRateLimit', () => {
  it('applique une limite par plan (pro -> 500/min)', () => {
    let seen = {};
    const { req, res } = fakeCycle((h) => { seen = h; }, 'pro');
    let nextCalled = false;
    publicRateLimit()(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(seen['X-RateLimit-Limit'], '500');
  });

  it('applique la limite free (100/min)', () => {
    let seen = {};
    const { req, res } = fakeCycle((h) => { seen = h; }, 'free');
    publicRateLimit()(req, res, () => {});
    assert.equal(seen['X-RateLimit-Limit'], '100');
  });

  it('renvoie 429 au-delà du quota free (fenêtre glissante)', () => {
    // Petite limite pour un test court : on pointe sur un plan free, mais on
    // remplit la fenêtre via de nombreuses itérations équivalentes. Pour rester
    // rapide et déterministe, on réutilise la limite réelle (100) en enregistrant
    // 100 requêtes --> la 101e est limitée.
    const limit = 100;
    const key = 'ut_free';
    // Nettoyage : on force la planche à être vide pour un test déterministe.
    // (pas d'API publique d'éviction : on teste via le comportement déterministe
    //  en redémarrant la fenêtre avec un préfixe unique)
    const { req, res } = fakeCycle(() => {}, 'free');
    req.apiKey.prefix = `ut_fill_${Date.now()}`;

    let nextCalled = 0;
    const mw = publicRateLimit();
    let limited = null;
    const resOver = {
      setHeader: () => {},
      on: (evt, cb) => { if (evt === 'finish') cb(); },
      removeListener: () => {},
      status: (code) => ({ json: () => { limited = code; } }),
    };
    // Remplir la fenêtre.
    for (let i = 0; i < limit; i++) {
      mw(req, resOver, () => { nextCalled++; });
    }
    // La suivante rencontre le quota.
    mw(req, resOver, () => { nextCalled++; });
    assert.equal(limited, 429);
    assert.ok(nextCalled >= limit, 'les requêtes sous quota passent au suivant');
  });
});

describe('resolveApiKey (mode mémoire)', () => {
  it('résout une clé pro avec scopes complets', async () => {
    process.env.USE_MEMORY_DB = 'true';
    const k = await resolveApiKey('fa_test_public_pro', null);
    assert.equal(k.tenantPlan, 'pro');
    assert.ok(k.scopes.includes('public:write:projects'));
    assert.equal(k.tenantId, 1);
  });

  it('résout une clé en lecture seule', async () => {
    process.env.USE_MEMORY_DB = 'true';
    const k = await resolveApiKey('fa_test_public_readonly', null);
    assert.equal(k.tenantPlan, 'free');
    assert.ok(!k.scopes.includes('public:write:projects'));
  });

  it('retourne undefined pour une clé inconnue', async () => {
    process.env.USE_MEMORY_DB = 'true';
    const k = await resolveApiKey('nope', null);
    assert.equal(k, undefined);
  });
});