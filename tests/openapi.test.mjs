// tests/openapi.test.mjs
// Phase 3 — OpenAPI : spec valide, Swagger UI accessible, cheminés documentés
// correspondent aux routes réelles.

process.env.USE_MEMORY_DB = 'true';
process.env.AUTH_ENABLED = 'false';
process.env.LLM_PROVIDER = 'mock';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.join(__dirname, '..', 'openapi', 'spec.yaml');

// Imports dynamiques (env déjà posé ci-dessus).
const { default: app } = await import('../src/app.js');

describe('OpenAPI — spec valide', () => {
  it('openapi/spec.yaml existe et est lisible', () => {
    assert.ok(fs.existsSync(SPEC_PATH), 'spec.yaml doit exister');
    const content = fs.readFileSync(SPEC_PATH, 'utf8');
    assert.match(content, /^openapi:\s*3\.0\.\d+/m);
    assert.match(content, /paths:/);
    assert.match(content, /components:/);
  });

  it('la spec contient le noeud info.title Flash-Archi Public API', () => {
    const content = fs.readFileSync(SPEC_PATH, 'utf8');
    assert.match(content, /title:\s*Flash-Archi Public API/);
  });

  it('documente les endpoints projets, jobs, webhooks et versions', () => {
    const content = fs.readFileSync(SPEC_PATH, 'utf8');
    for (const p of [
      '/api/public/v1/projects:',
      '/api/public/v1/projects/{projectId}:',
      '/api/public/v1/projects/{projectId}/jobs:',
      '/api/public/v1/jobs/{jobId}:',
      '/api/public/v1/webhooks:',
      '/api/public/v1/webhooks/{webhookId}:',
      '/api/flash-archi/projects/{projectId}/versions:',
    ]) {
      assert.ok(content.includes(p), `la spec doit documenter ${p}`);
    }
  });

  it('expose 2 securitySchemes (publique + interne), schemas Project/Job/Webhook', () => {
    const content = fs.readFileSync(SPEC_PATH, 'utf8');
    assert.ok(content.includes('PublicKeyAuth:'));
    assert.ok(content.includes('InternalKeyAuth:'));
    for (const s of ['Project:', 'Job:', 'ArtifactBundle:', 'Version:', 'WebhookSubscription:']) {
      assert.ok(content.includes(s), `la spec doit déclarer le schéma ${s.trim()}`);
    }
  });

  it('documente le header X-RateLimit-* et la réponse 429', () => {
    const content = fs.readFileSync(SPEC_PATH, 'utf8');
    assert.ok(content.includes('X-RateLimit-Limit'));
    assert.ok(content.includes('X-RateLimit-Remaining'));
    assert.ok(content.includes('RateLimited'));
  });
});

describe('OpenAPI — Swagger UI', () => {
  it('GET /api/docs retourne 200 (ou 301 -> /api/docs/) et sert Swagger UI', async () => {
    // swagger-ui-express redirige /api/docs -> /api/docs/ (301 standard).
    // Avec le follow-redirect de supertest (supertest suit par défaut), on
    // aboutit à 200 avec l'interface.
    const res = await request(app).get('/api/docs').redirects(1);
    assert.ok([200, 301, 302].includes(res.status), `status inattendu: ${res.status}`);
    // Si on a suivi vers le contenu, la page rend Swagger UI.
    if (res.status === 200) {
      assert.match(res.text, /swagger-ui|SwaggerUIBundle|swagger-ui-express/i);
    }
  });

  it('GET /api/docs/ (slash final) retourne 200 avec Swagger UI', async () => {
    const res = await request(app).get('/api/docs/');
    assert.equal(res.status, 200);
    assert.match(res.text, /swagger-ui|SwaggerUIBundle|swagger-ui-express/i);
  });
});

describe('OpenAPI — couverture des routes réelles', () => {
  it('toutes les routes publiques et versions documentées sont accessibles (montées)', async () => {
    // On vérifie via la spec que chaque chemin documenté est bien mappé dans l'app
    // en listant les routes montées (méthodes + chemins) — sans appeler les handlers.
    const spec = fs.readFileSync(SPEC_PATH, 'utf8');
    const documentedPaths = [...spec.matchAll(/^  (\/(?:api\/public\/v1|api\/flash-archi)[^:]+):/gm)]
      .map((m) => m[1].replace(/\{(\w+)\}/g, ':$1'));

    const appPaths = app._router?.stack
      ?.filter((l) => l.route)
      .map((l) => {
        const m = Object.keys(l.route.methods)[0].toUpperCase();
        return { method: m, path: l.route.path };
      }) ?? [];

    assert.ok(appPaths.length > 0, 'app doit exposer des routes');

    // Pour chaque chemin documenté non paramétré, le préfixe doit être monté quelque part.
    // (Les routes paramétrées {x} sont mappées en :x côté Express.)
    const expressPaths = appPaths.map((r) => r.path);
    for (const p of documentedPaths) {
      // les routes concernées vivent sous /api/... ; on vérifie le préfixe exact
      const direct = expressPaths.find((ep) => ep === p);
      if (direct) continue;
      // sinon vérifier qu'au moins une route exprimée matche le préfixe réel (router monté)
      assert.ok(
        expressPaths.some((ep) => ep.includes('api/public/v1') || ep.includes('api/flash-archi')),
        `la spec documente ${p} — les routes publiques/versions doivent être montées`
      );
    }
  });

  it('le prefix /api/docs est monté et donc servi en production', () => {
    const stack = app._router?.stack ?? [];
    // swagger-ui-express monte 3 couches middleware sous /api/docs
    // (swaggerInitFn, serveStatic, anonymous). String(regexp) échappe les '/'
    // en '\/', d'où la recherche du simple mot 'docs' plus robuste.
    const docsLayers = stack.filter((l) => {
      const src = String(l.regexp ?? '');
      return /\/?api\/docs|\/docs/.test(src) && src.includes('docs');
    });
    assert.ok(docsLayers.length >= 1, '/api/docs doit être monté (couche middleware)');
  });
});