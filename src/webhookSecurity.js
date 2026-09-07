// ===========================================================
// Flash-Archi SaaS — Sécurité des webhooks
// Vérification HMAC-SHA256 + rate-limiting + audit.
// Protecteur des endpoints publics (paiement, etc.).
// ===========================================================
import crypto from 'node:crypto'
import { createLogger } from './logger.js'

const { logger } = createLogger()

/**
 * Vérifie une signature HMAC-SHA256 du corps brut de la requête.
 * @param {Buffer|string} rawBody Corps brut (exactement ce qui a été transmis).
 * @param {string} signature  Signature reçue (hex). Peut être préfixée `sha256=`.
 * @param {string} secret     Secret partagé (ORANGE_WEBHOOK_SECRET).
 * @returns {boolean} true si la signature est valide.
 */
export function verifyHmac(rawBody, signature, secret) {
  if (!secret) return false
  if (!signature || !rawBody) return false

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  // Le header peut arriver brut ('abc…') ou préfixé ('sha256=abc…').
  const provided = String(signature).replace(/^sha256=/i, '').toLowerCase()
  if (!provided) return false

  // Comparaison à temps constant (anti timing-attack).
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Middleware de validation d'un webhook signé (HMAC).
 * - Valide la signature `X-<headerName>` du corps brut.
 * - Historise l'IP + l'événement pour audit / fraude.
 * En environnement 'test/sim' (ORANGE_WEBHOOK_SECRET vide), la validation
 * est contournée (démo déterministe) — jamais en production.
 */
export function hmacWebhookMiddleware({ headerName = 'X-Orange-Signature', allowUnsignedInEnv = ['test', 'development'] } = {}) {
  return (req, res, next) => {
    const secret = process.env.ORANGE_WEBHOOK_SECRET
    const env = process.env.NODE_ENV || 'development'
    const signature = req.headers[headerName.toLowerCase()]

    // Journal systématique (audit) même si signé.
    const meta = {
      ip: (req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').toString().split(',')[0].trim(),
      ts: new Date().toISOString(),
      path: req.originalUrl,
      orderId: req.body?.order_id ?? req.body?.orderId ?? req.body?.orderId ?? null,
    }

    // Signature manquante
    if (!signature) {
      // Auto-autorisation en environnement de démo uniquement (jamais en prod).
      if (allowUnsignedInEnv.includes(env) && !secret) {
        logger.warn({ ...meta, warn: 'unsigned accepted (demo env)' }, 'webhook: unsigned allowed (demo)')
        req.webhookAudit = meta
        return next()
      }
      logger.error({ ...meta, fraud: true }, 'webhook: missing signature')
      req.webhookAudit = meta
      return res.status(401).json({ error: 'Missing signature.' })
    }

    // Signature présente mais pas de secret configuré
    if (!secret) {
      logger.error({ ...meta, fraud: true }, 'webhook: signature present but secret unconfigured')
      req.webhookAudit = meta
      return res.status(401).json({ error: 'Webhook signature unavailable.' })
    }

    // Valide la signature sur le corps brut.
    if (!verifyHmac(req.rawBody ?? '', signature, secret)) {
      logger.error({ ...meta, fraud: true }, 'webhook: invalid signature (HMAC mismatch)')
      req.webhookAudit = meta
      return res.status(401).json({ error: 'Invalid signature.' })
    }

    req.webhookAudit = meta
    logger.info(meta, 'webhook: signature valid')
    return next()
  }
}

/**
 * Rate limiter webhook renforcé : max N req/min/IP + log des IPs.
 * Réutilise express-rate-limit sous le capot.
 */
export function webhookRateLimiter({ windowMs = 60_000, max = 10 } = {}) {
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').toString().split(',')[0].trim()
    // Clé = IP. (Pas de store persistant : ça suffit pour la mémoire court terme.)
    const key = `webhook-${ip}`

    if (!webhookRateLimiter.buckets) webhookRateLimiter.buckets = new Map()
    const now = Date.now()
    const entry = webhookRateLimiter.buckets.get(key)
    if (!entry || now - entry.resetAt > windowMs) {
      webhookRateLimiter.buckets.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }
    if (entry.count >= max) {
      logger.error({ ip, limit: max, windowMs }, 'webhook: rate limit triggered (suspicious IP)')
      return res.status(429).json({ error: 'too_many_requests', message: 'Too many webhook requests.' })
    }
    entry.count += 1
    return next()
  }
}

/**
 * Dernière étape : log le résultat d'un webhook (success/fraud/error).
 * À brancher comme middleware terminal après le traitement.
 */
export function webhookResultLogger(label) {
  return (req, res, next) => {
    res.on('finish', () => {
      const meta = req.webhookAudit ?? {}
      const code = res.statusCode
      const result = code === 200
        ? 'success'
        : code === 401 || code === 400
          ? 'fraud'
          : 'error'
      logger.info({ ...meta, status: code, result }, `webhook:${label} result`)
    })
    next()
  }
}