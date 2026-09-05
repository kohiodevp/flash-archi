// tests/auth.test.mjs
import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { authenticate } from '../src/auth.js'

function mockReq(over = {}) {
  return { headers: {}, ...over }
}
function mockRes() {
  const res = { statusCode: 200, body: undefined, headers: {} }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (obj) => { res.body = obj; return res }
  return res
}

beforeEach(() => {
  // Reset env pour chaque test
  delete process.env.AUTH_ENABLED
  delete process.env.API_KEY
  delete process.env.NODE_ENV
})

function run(req) {
  let nextCalled = false
  const res = mockRes()
  const next = () => { nextCalled = true }
  authenticate(req, res, next)
  return { nextCalled, res }
}

test('auth désactivée -> passe directement', () => {
  process.env.AUTH_ENABLED = 'false'
  const { nextCalled } = run(mockReq())
  assert.equal(nextCalled, true)
})

test('auth inconnue -> passe (défaut dev/mock)', () => {
  // AUTH_ENABLED non défini : by-pass par sécurité en dev
  const { nextCalled } = run(mockReq())
  assert.equal(nextCalled, true)
})

test('NODE_ENV=test -> by-pass', () => {
  process.env.AUTH_ENABLED = 'true'
  process.env.API_KEY = 'secret-key'
  process.env.NODE_ENV = 'test'
  const { nextCalled } = run(mockReq())
  assert.equal(nextCalled, true)
})

test('header absent -> 401', () => {
  process.env.AUTH_ENABLED = 'true'
  process.env.API_KEY = 'secret-key'
  delete process.env.NODE_ENV
  const { res } = run(mockReq())
  assert.equal(res.statusCode, 401)
  assert.equal(res.body.error, 'Missing or malformed Authorization header')
})

test('header mal formé -> 401', () => {
  process.env.AUTH_ENABLED = 'true'
  process.env.API_KEY = 'secret-key'
  delete process.env.NODE_ENV
  const req = mockReq({ headers: { authorization: 'Basic abc' } })
  const { res } = run(req)
  assert.equal(res.statusCode, 401)
})

test('clé invalide -> 401', () => {
  process.env.AUTH_ENABLED = 'true'
  process.env.API_KEY = 'secret-key'
  delete process.env.NODE_ENV
  const req = mockReq({ headers: { authorization: 'Bearer wrong-key' } })
  const { res } = run(req)
  assert.equal(res.statusCode, 401)
})

test('clé valide -> passe + req.auth renseigné', () => {
  process.env.AUTH_ENABLED = 'true'
  process.env.API_KEY = 'secret-key'
  delete process.env.NODE_ENV
  const req = mockReq({ headers: { authorization: 'Bearer secret-key' } })
  const { nextCalled, res } = run(req)
  assert.equal(nextCalled, true)
  assert.equal(req.auth.apiKey, 'secret-key')
})