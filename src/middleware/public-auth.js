// src/middleware/public-auth.js
// Authentification de l'API publique (P2-03) : clé API avec scopes `public:*`.
// Réutilise req.db (middleware DB). Résout la clé via publicStore.resolveApiKey,
// vérifie le scope requis, et renseigne req.tenantId / req.tenantPlan / req.apiKey.

import { resolveApiKey } from '../publicStore.js';

/**
 * Middleware d'authentification pour l'API publique.
 * @param {Array<string>} requiredScopes scopes `public:*` requis pour la route.
 * @returns express middleware
 */
export function publicAuth(requiredScopes = []) {
  return async function publicAuthMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: 'public.unauthorized', message: 'Missing or malformed Authorization header' });
    }

    const token = match[1];
    let resolved;
    try {
      resolved = await resolveApiKey(token, req.db);
    } catch (err) {
      return res.status(500).json({ error: 'public.internal', message: 'Authentication store error' });
    }

    if (!resolved) {
      return res.status(401).json({ error: 'public.invalid_key', message: 'Invalid API key' });
    }

    // Vérifier les scopes requis.
    const missing = requiredScopes.filter((s) => !resolved.scopes.includes(s));
    if (missing.length > 0) {
      return res.status(403).json({
        error: 'public.forbidden',
        message: 'Missing required scope(s): ' + missing.join(', '),
      });
    }

    req.apiKey = { prefix: resolved.prefix, scopes: resolved.scopes };
    req.tenantId = resolved.tenantId;
    req.tenantPlan = resolved.tenantPlan;

    return next();
  };
}