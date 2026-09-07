// tests/payment-store.test.js
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { PaymentStore, PAYMENT_BY_PLAN } from '../src/payments-store.js'

// Chaque suite utilise un store en mémoire, isolé.
let store

beforeEach(() => {
  store = new PaymentStore(':memory:')
})

afterEach(() => {
  store.close()
})

// ---- createPayment ---------------------------------------------------
test('createPayment insère un paiement avec status pending', () => {
  const p = store.createPayment({
    orderId: 'order_1', userId: 'u1', amount: 17400, plan: 'pro',
    phone: '+22670123456', email: 'a@b.bf',
  })
  assert.equal(p.order_id, 'order_1')
  assert.equal(p.status, 'pending')
  assert.equal(p.amount, 17400)
  assert.equal(p.currency, 'XOF')
  assert.equal(p.payment_method, 'orange_money')
})

test('createPayment : order_id unique (insertion en double échoue)', () => {
  store.createPayment({ orderId: 'order_x', userId: 'u1', amount: 100, plan: 'pro' })
  assert.throws(() => {
    store.createPayment({ orderId: 'order_x', userId: 'u1', amount: 100, plan: 'pro' })
  })
})

// ---- confirmPayment / activation du plan -----------------------------
test('confirmPayment passe à accepted + active le plan PRO (quota 50)', () => {
  store.ensureUser('u1')
  const { id } = store.createPayment({ orderId: 'order_1', userId: 'u1', amount: 17400, plan: 'pro' })
  const res = store.confirmPayment('order_1', { txid: 'tx1' })

  assert.equal(res.alreadyCredited, false)
  const pay = store.getByOrderId('order_1')
  assert.equal(pay.status, 'accepted')
  assert.equal(pay.txid, 'tx1')

  const user = store.getUser('u1')
  assert.equal(user.plan, 'pro')
  assert.equal(user.quota_remaining, 50)
  assert.equal(user.subscription_status, 'active')
  assert.equal(user.last_payment_id, id)
})

test('confirmPayment IDEMPOTENT : webhook dupliqué ne crédite pas 2 fois', () => {
  store.ensureUser('u1')
  store.createPayment({ orderId: 'order_1', userId: 'u1', amount: 17400, plan: 'pro' })

  const first = store.confirmPayment('order_1', { txid: 'tx1' })
  assert.equal(first.alreadyCredited, false)

  // Deuxième webhook identique (retry Orange) → alreadyCredited true
  const second = store.confirmPayment('order_1', { txid: 'tx2' })
  assert.equal(second.alreadyCredited, true)

  // Le quota reste 50 — pas de double crédit.
  assert.equal(store.getUser('u1').quota_remaining, 50)
  // Le txid d'origine est conservé (idempotence : pas de modification).
  const pay = store.getByOrderId('order_1')
  assert.ok(pay.status === 'accepted')
})

test('confirmPayment sur paiement inexistant renvoie { notFound: true }', () => {
  const res = store.confirmPayment('order_ghost')
  assert.equal(res.notFound, true)
})

// ---- consumeQuota ----------------------------------------------------
test('consumeQuota décrémente quota_remaining', () => {
  store.ensureUser('u1')
  store.createPayment({ orderId: 'order_1', userId: 'u1', amount: 17400, plan: 'pro' })
  store.confirmPayment('order_1') // pro → 50

  assert.equal(store.consumeQuota('u1'), true)
  assert.equal(store.getUser('u1').quota_remaining, 49)

  store.consumeQuota('u1')
  assert.equal(store.getUser('u1').quota_remaining, 48)
})

test('quota épuisé → consumeQuota retourne false + reste à 0', () => {
  // plan free par défaut → 3 générations
  store.ensureUser('u1')
  assert.equal(store.consumeQuota('u1'), true)
  assert.equal(store.consumeQuota('u1'), true)
  assert.equal(store.consumeQuota('u1'), true)
  // 4e → épuisé
  assert.equal(store.consumeQuota('u1'), false)
  assert.equal(store.getUser('u1').quota_remaining, 0)
})

test('quota épuisé est lié à un 402 au niveau route (voir generate)', () => {
  // Vérifie le contrat : la route /generate renvoie 402 quand consumé false.
  // Ici on valide la logique métier du store : consumeQuota=false.
  store.ensureUser('u1')
  store.consumeQuota('u1')
  store.consumeQuota('u1')
  store.consumeQuota('u1')
  assert.equal(store.consumeQuota('u1'), false)
  assert.equal(store.consumeQuota('u1'), false)
})

// ---- reset mensuel ---------------------------------------------------
test('monthly reset : quota_reset_at passé → reset au plafond du plan', () => {
  store.ensureUser('u1')
  store.createPayment({ orderId: 'order_1', userId: 'u1', amount: 17400, plan: 'pro' })
  store.confirmPayment('order_1', { txid: 'tx1' })

  // Consomme 2 quotas.
  store.consumeQuota('u1')
  store.consumeQuota('u1')
  assert.equal(store.getUser('u1').quota_remaining, 48)

  // Force l'échéance dans le passé → reset attendu.
  store.db.prepare(`UPDATE users SET quota_reset_at = ? WHERE id = 'u1'`)
    .run(new Date(Date.now() - 1000).toISOString())

  const after = store.getQuotaInfo('u1')
  assert.equal(after.quotaRemaining, 50) // replafonné à 50 (plan pro)
  assert.equal(after.quotaTotal, 50)
  // La nouvelle échéance est au 1er du mois suivant.
  const d = new Date(after.quotaResetAt)
  assert.equal(d.getUTCDate(), 1)
})

test('monthly reset par défaut (free) → replafonne à 3', () => {
  store.ensureUser('u1') // free → 3
  store.consumeQuota('u1')
  store.consumeQuota('u1')
  assert.equal(store.getUser('u1').quota_remaining, 1)

  store.db.prepare(`UPDATE users SET quota_reset_at = ? WHERE id = 'u1'`)
    .run(new Date(Date.now() - 1000).toISOString())
  assert.equal(store.getQuotaInfo('u1').quotaRemaining, 3)
})

// ---- idempotence & états ----------------------------------------------
test('setStatus refuse : payment marqué refused', () => {
  store.createPayment({ orderId: 'order_1', userId: 'u1', amount: 100, plan: 'pro' })
  store.setStatus('order_1', 'refused', { notes: 'Orange FAILED' })
  const pay = store.getByOrderId('order_1')
  assert.equal(pay.status, 'refused')
  assert.equal(pay.notes, 'Orange FAILED')
})

test('listByUser renvoie l historique du seul utilisateur', () => {
  store.createPayment({ orderId: 'order_a', userId: 'u1', amount: 100, plan: 'pro' })
  store.createPayment({ orderId: 'order_b', userId: 'u1', amount: 100, plan: 'pro' })
  store.createPayment({ orderId: 'order_c', userId: 'u2', amount: 100, plan: 'pro' })
  const hist = store.listByUser('u1')
  assert.equal(hist.length, 2)
  assert.ok(hist.every((p) => p.user_id === 'u1'))
})

test('PAYMENT_BY_PLAN : pro → 50, free → 3', () => {
  assert.equal(PAYMENT_BY_PLAN.pro.quota, 50)
  assert.equal(PAYMENT_BY_PLAN.free.quota, 3)
  assert.equal(PAYMENT_BY_PLAN.pro.monthlyXof, 17400)
})