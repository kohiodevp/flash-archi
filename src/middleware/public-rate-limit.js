// src/middleware/public-rate-limit.js
// Rate limiting de l'API publique (P2-03) par plan d'intégration.
// Limites : free=100/min, pro=500/min, enterprise=1000/min.
// Fenêtre glissante en mémoire (process). Headers X-RateLimit-Limit/-Remaining/-Reset.
// Retourne 429 quand le quota est dépassé.

import { PLAN_LIMITS, DEFAULT_PLAN_LIMIT } from '../publicStore.js';

// Fenêtres glissantes par clé d'API : Map<prefix, Array<timestamp>>
const windows = new Map();

const WINDOW_MS = 60 * 1000; // 1 minute

function getWindow(key) {
  if (!windows.has(key)) windows.set(key, []);
  return windows.get(key);
}

function prune(window, now) {
  while (window.length > 0 && now - window[0] >= WINDOW_MS) {
    window.shift();
  }
}

/**
 * Middleware de rate limiting par plan.
 * Prérequis : publicAuth doit avoir renseigné req.tenantPlan et req.apiKey.prefix.
 */
export function publicRateLimit(_options = {}) {
  return function publicRateLimitMiddleware(req, res, next) {
    if (!req.apiKey?.prefix) {
      // Pas de clé identifiée (ex. pré-auth) : ne pas limiter ici.
      return next();
    }

    const limit = PLAN_LIMITS[req.tenantPlan] ?? DEFAULT_PLAN_LIMIT;
    const now = Date.now();
    const key = req.apiKey.prefix;
    const window = getWindow(key);

    prune(window, now);

    const remaining = Math.max(0, limit - window.length);

    // Headers standard (Design Document).
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(now + WINDOW_MS));

    if (window.length >= limit) {
      res.setHeader('Retry-After', String(Math.ceil((window[0] + WINDOW_MS - now) / 1000)));
      return res.status(429).json({
        error: 'public.rate_limited',
        message: 'Rate limit exceeded. See X-RateLimit-Reset.',
      });
    }

    // Enregistre la requête en fin de traitement pour ne pas compter dès l'entrée.
    const onFinish = () => {
      const w = getWindow(key);
      w.push(Date.now());
    };
    res.on('finish', onFinish);
    res.on('close', () => res.removeListener('finish', onFinish));

    return next();
  };
}