// tests/hermesPolicy.test.mjs
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import policy from '../src/betsaPolicy.js'

beforeEach(() => {
  delete process.env.HERMES_DENY_ALL_BY_DEFAULT
  delete process.env.HERMES_ALLOWED_TOOLS
  delete process.env.HERMES_DENIED_TOOLS
})

test('default deny-all -> outil non listé refusé', () => {
  assert.equal(policy.isToolAllowed('terminal'), false)
  assert.equal(policy.isToolAllowed('browser_use'), false)
  assert.equal(policy.isToolAllowed('write_file'), false)
  assert.equal(policy.isToolAllowed('patch'), false)
  assert.equal(policy.isToolAllowed('cronjob'), false)
  assert.equal(policy.isToolAllowed('skill_manage'), false)
})

test('outil inconnu -> refusé (fail-closed)', () => {
  assert.equal(policy.isToolAllowed('unknown_tool'), false)
  assert.equal(policy.isToolAllowed(''), false)
  assert.equal(policy.isToolAllowed(undefined), false)
})

test('deny-all -> outil autorisé si listé explicitement', () => {
  process.env.HERMES_ALLOWED_TOOLS = 'read_file,vision_analyze'
  assert.equal(policy.isToolAllowed('read_file'), true)
  assert.equal(policy.isToolAllowed('vision_analyze'), true)
  // Non listé -> refusé
  assert.equal(policy.isToolAllowed('terminal'), false)
})

test('mode allowlist insensible à la casse', () => {
  process.env.HERMES_ALLOWED_TOOLS = 'Read_file, VISION_ANALYZE'
  assert.equal(policy.isToolAllowed('read_file'), true)
  assert.equal(policy.isToolAllowed('vision_analyze'), true)
})

test('non deny-by-default -> refus via deny list', () => {
  process.env.HERMES_DENY_ALL_BY_DEFAULT = 'false'
  process.env.HERMES_DENIED_TOOLS = 'terminal,browser_use'
  assert.equal(policy.isToolAllowed('read_file'), true)
  assert.equal(policy.isToolAllowed('terminal'), false)
  assert.equal(policy.isToolAllowed('browser_use'), false)
})