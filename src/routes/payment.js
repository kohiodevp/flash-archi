// ===========================================================
// Flash-Archi SaaS — Routes de paiement
// Orange Money Burkina (OMBF) — intégration directe, sans agrégateur.
// ===========================================================
import { v4 as uuid } from 'uuid'
import express from 'express'
import orangeMoneyService from '../services/orange-money.js'
import { paymentStore, PAYMENT_BY_PLAN } from '../payments-store.js'
import { authenticate } from '../auth.js'
import rateLimit from 'express-rate-limit'
import { createLogger } from '../logger.js'
import { hmacWebhookMiddleware, webhookRateLimiter, webhookResultLogger } from '../webhookSecurity.js'

const { logger } = createLogger()
const paymentRouter = express.Router()

// Rate limiting strict sur la création de paiement (5 req/min/IP).
const createPaymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'too_many_requests', message: 'Too many payment requests. Please retry in a minute.' })
  },
})

function validatePlan(plan) {
  return Object.prototype.hasOwnProperty.call(PAYMENT_BY_PLAN, plan)
}

// ---- POST /api/payment/create ---------------------------------
// Corps : { amount, description?, userId, plan, phone, email }
paymentRouter.post('/create', createPaymentLimiter, authenticate, async (req, res) => {
  const { amount, description, userId, plan, phone, email } = req.body ?? {}
  if (!amount || !userId || !plan || !phone || !email) {
    return res.status(400).json({ error: 'Missing required fields: amount, userId, plan, phone, email.' })
  }
  if (!validatePlan(plan)) {
    return res.status(400).json({ error: `Invalid plan. Expected one of: ${Object.keys(PAYMENT_BY_PLAN).join(', ')}.` })
  }
  const orderId = `order_${uuid()}`

  try {
    paymentStore.createPayment({ orderId, userId, amount, plan, phone, email })
    paymentStore.ensureUser(userId)

    const orangeResponse = await orangeMoneyService.createPayment(orderId, amount, description, phone, email)
    const orangeToken = orangeResponse.token
    const webpayUrl = orangeResponse.webpay_url
    if (orangeToken) {
      paymentStore.setOrangeToken(orderId, orangeToken, `FlashArchi-${orderId}`)
    }
    logger.info({ orderId, userId, plan, amount }, 'payment created, redirecting to Orange')
    return res.json({ paymentUrl: webpayUrl, orderId })
  } catch (err) {
    logger.error({ err: err.message, orderId }, 'payment creation failed')
    paymentStore.setStatus(orderId, 'failed', { notes: err.message })
    const expose = process.env.NODE_ENV === 'production'
      ? 'Service temporairement indisponible.'
      : `Orange Money error: ${err.message}`
    return res.status(502).json({ error: expose })
  }
})

// ---- POST /api/payment/orange/webhook -------------------------
// Notification Orange Money. ROUTE PUBLIQUE (pas de Bearer) — appelée par
// Orange. SÉCURITÉ : signature HMAC (X-Orange-Signature) + rate-limit
// renforcé (10/min/IP) + relecture de l'état auprès d'Orange + contrôle du
// montant. Logging structuré du résultat (success/fraud/error).
paymentRouter.post(
  '/orange/webhook',
  webhookRateLimiter({ windowMs: 60_000, max: 10 }),
  express.json({ limit: '256kb' }),
  hmacWebhookMiddleware({ headerName: 'X-Orange-Signature' }),
  webhookResultLogger('payment'),
  async (req, res) => {
    logger.info({ audit: req.webhookAudit }, 'Orange webhook received')
    const { token } = req.body ?? {}
    if (!token) {
      return res.status(400).json({ error: 'Missing token.' })
    }
    try {
      const payment = paymentStore.getByToken(token)
      if (!payment) {
        logger.warn({ token, audit: req.webhookAudit }, 'webhook: payment not found for token')
        return res.status(404).json({ error: 'Payment not found.' })
      }
      const omStatus = await orangeMoneyService.checkPaymentStatus(token)
      const status = omStatus.status
      logger.info({ orderId: payment.order_id, orangeStatus: status }, 'webhook: orange status')

      // Anti-fraude : le montant renvoyé par Orange doit correspondre exactement.
      if (status === 'SUCCESSFUL' && Number(omStatus.amount) !== Number(payment.amount)) {
        logger.error({
          orderId: payment.order_id,
          expected: payment.amount,
          received: omStatus.amount,
          audit: req.webhookAudit,
          fraud: true,
        }, 'FRAUD: webhook amount mismatch')
        paymentStore.setStatus(payment.order_id, 'failed', { notes: 'Amount mismatch' })
        return res.status(400).json({ error: 'Amount mismatch.' })
      }

      if (status === 'SUCCESSFUL') {
        // Confirmation IDEMPOTENTE : un webhook dupliqué ne crédite pas 2×.
        const result = paymentStore.confirmPayment(payment.order_id, { txid: omStatus.txid })
        logger.info({ orderId: payment.order_id, userId: payment.user_id, plan: payment.plan, ...result }, 'payment accepted, plan activated')
        return res.json({ status: 'received', ...result })
      }
      if (status === 'FAILED') {
        paymentStore.setStatus(payment.order_id, 'refused', { notes: 'Orange returned FAILED' })
      } else if (status === 'CANCELLED') {
        paymentStore.setStatus(payment.order_id, 'cancelled', { notes: 'Orange returned CANCELLED' })
      } else {
        logger.info({ orderId: payment.order_id, status }, 'webhook: payment still pending')
      }
      return res.json({ status: 'received' })
    } catch (err) {
      logger.error({ err: err.message, audit: req.webhookAudit }, 'webhook processing failed')
      return res.status(500).json({ error: 'Internal server error.' })
    }
  }
)

// ---- GET /api/payment/status/:orderId -------------------------
paymentRouter.get('/status/:orderId', authenticate, async (req, res) => {
  const { orderId } = req.params
  try {
    const payment = paymentStore.getByOrderId(orderId)
    if (!payment) return res.status(404).json({ error: 'Payment not found.' })

    // Si toujours pending, on relit l'état auprès d'Orange (idempotent).
    if (payment.status === 'pending' && payment.orange_token) {
      try {
        const omStatus = await orangeMoneyService.checkPaymentStatus(payment.orange_token)
        const status = omStatus.status
        if (status === 'SUCCESSFUL') {
          paymentStore.setAccepted(orderId, omStatus.txid)
          paymentStore.activatePlan(payment.user_id, payment.plan, payment.id)
        } else if (status === 'FAILED') {
          paymentStore.setStatus(orderId, 'refused', { notes: 'Orange returned FAILED' })
        } else if (status === 'CANCELLED') {
          paymentStore.setStatus(orderId, 'cancelled', { notes: 'Orange returned CANCELLED' })
        }
      } catch (err) {
        logger.warn({ err: err.message, orderId }, 'status poll: orange check failed, keep DB state')
      }
    }

    // Recharge après éventuelle mise à jour.
    const updated = paymentStore.getByOrderId(orderId)
    return res.json({ status: updated.status, amount: updated.amount, plan: updated.plan })
  } catch (err) {
    logger.error({ err: err.message }, 'status check failed')
    return res.status(500).json({ error: 'Internal server error.' })
  }
})

// ---- GET /api/payment/account/:userId -------------------------
// Infos abonnement + quota + historique pour la page /account.
paymentRouter.get('/account/:userId', authenticate, (req, res) => {
  const { userId } = req.params
  try {
    const user = paymentStore.ensureUser(userId)
    const quota = paymentStore.getQuotaInfo(userId)
    const history = paymentStore.listByUser(userId)
    return res.json({ user: { id: user.id }, quota, payments: history })
  } catch (err) {
    logger.error({ err: err.message }, 'account fetch failed')
    return res.status(500).json({ error: 'Internal server error.' })
  }
})

export default paymentRouter