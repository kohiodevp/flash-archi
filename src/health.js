// src/health.js
import { RailwayStatus } from './schemas.js';
import { config } from './config.js';
import Database from 'better-sqlite3'; // ESM (le CJS require() échouait en module)

export function getHealthStatus(startedAt, VERSION) {
  return RailwayStatus.parse({
    api: 'ok',
    provider: config.llm.provider,
    model: config.llm.model,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    version: VERSION,
  });
}

export function getReadyStatus(dbPath) {
  // For SQLite, we can try a simple query.
  // If dbPath is :memory: or empty, we consider it ready.
  if (!dbPath || dbPath === '' || dbPath === ':memory:') {
    return { status: 'ready', checks: { database: 'ok' } };
  }
  try {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    const result = db.prepare('SELECT 1').get();
    db.close();
    if (result && result['1'] === 1) {
      return { status: 'ready', checks: { database: 'ok' } };
    } else {
      return { status: 'unavailable', checks: { database: 'error' } };
    }
  } catch (err) {
    return { status: 'unavailable', checks: { database: 'error' } };
  }
}

export function getVersionInfo(VERSION) {
  return {
    service: 'flash-archi',
    version: VERSION,
    environment: process.env.NODE_ENV || 'development'
  };
}