// src/middleware/auth.js
import { publicAuth } from './public-auth.js';

export async function authenticate(req, res, next) {
  if (process.env.USE_MEMORY_DB === 'true') {
    return publicAuth()(req, res, next);
  }
  return publicAuth()(req, res, next); // placeholder for real HMAC later
}

export function requireScope(scope) {
  return (req, res, next) => next(); // placeholder
}