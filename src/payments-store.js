// ===========================================================
// Flash-Archi SaaS — Store de paiements + abonnements (SQLite)
// ===========================================================
// Suit le modèle de jobs.js : better-sqlite3, WAL, minimaliste.
// Tables : payments (historique) + users (abonnements/quota).
// ===========================================================
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from './config.js'

export const PAYMENT_BY_PLAN = Object.freeze({
  free:      { quota: 3,  monthlyXof: 0 },
  pro:       { quota: 50, monthlyXof: 17400 },
  enterprise: { quota: 500, monthlyXof: 0 }, // devis
})

export class PaymentStore {
  constructor(dbPath) {
    this.memoryOnly = !dbPath || dbPath === '' || dbPath === ':memory:'
    this.db = this.memoryOnly
      ? new Database(':memory:')
      : (() => {
          fs.mkdirSync(path.dirname(dbPath), { recursive: true })
          const d = new Database(dbPath)
          d.pragma('journal_mode = WAL')
          return d
        })()

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id         TEXT UNIQUE NOT NULL,
        user_id          TEXT NOT NULL,
        amount           INTEGER NOT NULL,
        currency         TEXT DEFAULT 'XOF',
        plan             TEXT NOT NULL,
        status           TEXT DEFAULT 'pending',  -- pending | accepted | refused | cancelled | failed
        payment_method   TEXT DEFAULT 'orange_money',
        phone            TEXT,
        email            TEXT,
        orange_token     TEXT,
        orange_reference TEXT,
        txid             TEXT,
        notes            TEXT,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
      CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
      CREATE INDEX IF NOT EXISTS idx_payments_token ON payments(orange_token);

      CREATE TABLE IF NOT EXISTS users (
        id                  TEXT PRIMARY KEY,          -- userId (API key prefix / email)
        plan                TEXT DEFAULT 'free',
        quota_total         INTEGER DEFAULT 3,
        quota_remaining     INTEGER DEFAULT 3,
        quota_reset_at      DATETIME,
        subscription_status TEXT DEFAULT 'inactive',   -- inactive | active | cancelled
        last_payment_id     INTEGER,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)
  }

  // ---- payments -------------------------------------------------
  createPayment({ orderId, userId, amount, plan, phone, email }) {
    const info = this.db
      .prepare(`INSERT INTO payments (order_id, user_id, amount, plan, status, payment_method, phone, email)
                VALUES (@orderId, @userId, @amount, @plan, 'pending', 'orange_money', @phone, @email)`)
      .run({ orderId, userId, amount, plan, phone, email })
    return this.getByOrderId(orderId)
  }

  setOrangeToken(orderId, token, reference) {
    this.db.prepare(`UPDATE payments SET orange_token = @token, orange_reference = @reference, updated_at = CURRENT_TIMESTAMP WHERE order_id = @orderId`)
      .run({ orderId, token, reference })
  }

  setStatus(orderId, status, { notes } = {}) {
    this.db.prepare(`UPDATE payments SET status = @status, notes = COALESCE(@notes, notes), updated_at = CURRENT_TIMESTAMP WHERE order_id = @orderId`)
      .run({ orderId, status, notes: notes ?? null })
  }

  setAccepted(orderId, txid) {
    this.db.prepare(`UPDATE payments SET status = 'accepted', txid = @txid, updated_at = CURRENT_TIMESTAMP WHERE order_id = @orderId`)
      .run({ orderId, txid: txid ?? null })
  }

  getByOrderId(orderId) {
    return this.db.prepare(`SELECT * FROM payments WHERE order_id = ?`).get(orderId)
  }

  getByToken(token) {
    if (!token) return undefined
    return this.db.prepare(`SELECT * FROM payments WHERE orange_token = ?`).get(token)
  }

  listByUser(userId, limit = 50) {
    return this.db.prepare(`SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, limit)
  }

  // ---- users / abonnements --------------------------------------
  ensureUser(userId) {
    const existing = this.getUser(userId)
    if (existing) return existing
    this.db.prepare(`INSERT INTO users (id, plan, quota_total, quota_remaining, subscription_status) VALUES (@id, 'free', 3, 3, 'inactive')`)
      .run({ id: userId })
    return this.getUser(userId)
  }

  getUser(userId) {
    return this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId)
  }

  /** Applique la remise à zéro mensuelle du quota si échéance atteinte. */
  applyMonthlyReset(userId) {
    const user = this.getUser(userId)
    if (!user) return undefined
    const now = Date.now()
    if (user.quota_reset_at && new Date(user.quota_reset_at).getTime() <= now) {
      const total = PAYMENT_BY_PLAN[user.plan]?.quota ?? 3
      this.db.prepare(`UPDATE users SET quota_remaining = @total, quota_total = @total, quota_reset_at = @next, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
        .run({ total, next: this.nextMonthlyReset(), id: userId })
      return this.getUser(userId)
    }
    return user
  }

  /** Mise à niveau du compte après paiement accepté. */
  activatePlan(userId, plan, lastPaymentId) {
    const quota = PAYMENT_BY_PLAN[plan]?.quota ?? PAYMENT_BY_PLAN.free.quota
    this.db.prepare(`UPDATE users
                     SET plan = @plan, quota_total = @quota, quota_remaining = @quota,
                         quota_reset_at = @resetAt, subscription_status = 'active',
                         last_payment_id = @lastPaymentId, updated_at = CURRENT_TIMESTAMP
                     WHERE id = @userId`)
      .run({ plan, quota, resetAt: this.nextMonthlyReset(), lastPaymentId, userId })
    return this.getUser(userId)
  }

  /** Décrémente le quota. Retourne false si quota épuisé. */
  consumeQuota(userId) {
    const user = this.applyMonthlyReset(userId)
    if (!user) return false
    if (user.quota_remaining <= 0) return false
    this.db.prepare(`UPDATE users SET quota_remaining = quota_remaining - 1, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
      .run({ id: userId })
    return true
  }

  getQuotaInfo(userId) {
    const user = this.applyMonthlyReset(userId)
    if (!user) return undefined
    return {
      plan: user.plan,
      quotaTotal: user.quota_total,
      quotaRemaining: user.quota_remaining,
      quotaResetAt: user.quota_reset_at,
      subscriptionStatus: user.subscription_status,
      lastPaymentId: user.last_payment_id,
    }
  }

  nextMonthlyReset() {
    const d = new Date()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() + 1)
    d.setUTCHours(0, 0, 0, 0)
    return d.toISOString()
  }

  close() {
    this.db.close()
  }
}

// Store partagé par toute l'application (même DB que jobStore).
export const paymentStore = new PaymentStore(config.db.path)