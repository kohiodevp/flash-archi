// tests/health.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getHealthStatus, getReadyStatus, getVersionInfo } from '../src/health.js'

test('getHealthStatus retourne api ok + version', () => {
  const body = getHealthStatus(Date.now(), '3.3.0')
  assert.equal(body.api, 'ok')
  assert.equal(body.version, '3.3.0')
  assert.ok(body.provider)
})

test('getReadyStatus : DB mémoire -> ready', () => {
  const body = getReadyStatus(':memory:')
  assert.equal(body.status, 'ready')
  assert.equal(body.checks.database, 'ok')
})

test('getVersionInfo : service + version + environnement', () => {
  delete process.env.NODE_ENV
  const info = getVersionInfo('3.3.0')
  assert.equal(info.service, 'flash-archi')
  assert.equal(info.version, '3.3.0')
  assert.ok(info.environment)
})