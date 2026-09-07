// tests/webhook-security.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { verifyHmac } from '../src/webhookSecurity.js'

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

test('verifyHmac : signature valide → true', () => {
  const body = JSON.stringify({ token: 'abc', order_id: 'o1' })
  const sig = sign(body, 'sekret')
  assert.equal(verifyHmac(body, sig, 'sekret'), true)
})

test('verifyHmac : accepte le préfixe "sha256="', () => {
  const body = '{"a":1}'
  const sig = sign(body, 'secret')
  assert.equal(verifyHmac(body, `sha256=${sig}`, 'secret'), true)
})

test('verifyHmac : signature invalide → false', () => {
  const body = '{"a":1}'
  assert.equal(verifyHmac(body, 'deadbeef', 'secret'), false)
})

test('verifyHmac : corps différent → false', () => {
  const body = '{"a":1}'
  const sig = sign(body, 'secret')
  assert.equal(verifyHmac('{"a":2}', sig, 'secret'), false)
})

test('verifyHmac : secret manquant → false', () => {
  const body = '{"a":1}'
  const sig = sign(body, 'secret')
  assert.equal(verifyHmac(body, sig, undefined), false)
})

test('verifyHmac : signature vide → false', () => {
  const body = '{"a":1}'
  assert.equal(verifyHmac(body, '', 'secret'), false)
})

test('verifyHmac : secret différent → false (preuve anti-falsification)', () => {
  const body = '{"a":1}'
  const sig = sign(body, 'wrong-secret')
  assert.equal(verifyHmac(body, sig, 'right-secret'), false)
})