#!/usr/bin/env node
// Vérification E2E de la sécurité HMAC du webhook.
//  - Sans signature → 401
//  - Avec signature invalide → 401
//  - Avec signature valide (et paiement inexistant token) → 404 (signature ok)
import crypto from 'node:crypto'

const BASE = 'http://127.0.0.1:8099'
const SECRET = 'mon-secret-test'

function sign(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex')
}

async function main() {
  const body = JSON.stringify({ token: 'sim_nonexistent', status: 'SUCCESSFUL' })

  // 1. Sans signature
  console.log('=== 1. sans signature (attendu 401) ===')
  let r = await fetch(`${BASE}/api/payment/orange/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  console.log('HTTP', r.status, '|', await r.text())
  console.log('PASS' + (r.status === 401 ? ' ✅' : ' ❌'))

  // 2. Signature invalide
  console.log('\n=== 2. signature invalide (attendu 401) ===')
  r = await fetch(`${BASE}/api/payment/orange/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orange-Signature': 'deadbeef' },
    body,
  })
  console.log('HTTP', r.status, '|', await r.text())
  console.log('PASS' + (r.status === 401 ? ' ✅' : ' ❌'))

  // 3. Signature valide (token inexistant → 404, prouve que la signature passe)
  console.log('\n=== 3. signature valide (attendu 404 payment not found) ===')
  const sig = sign(body)
  r = await fetch(`${BASE}/api/payment/orange/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orange-Signature': sig },
    body,
  })
  console.log('HTTP', r.status, '|', await r.text())
  console.log('PASS' + (r.status === 404 ? ' ✅' : ' ❌'))

  // 4. Signature valide mais corps modifié → 401
  console.log('\n=== 4. signature d.autre corps (attendu 401) ===')
  const otherBody = JSON.stringify({ token: 'sim_nonexistent', status: 'FAILED' })
  r = await fetch(`${BASE}/api/payment/orange/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orange-Signature': sig },
    body: otherBody,
  })
  console.log('HTTP', r.status, '|', await r.text())
  console.log('PASS' + (r.status === 401 ? ' ✅' : ' ❌'))
}

main().catch((e) => { console.error('ERREUR:', e.message); process.exit(1) })