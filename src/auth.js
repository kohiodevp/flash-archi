// src/auth.js
export function authenticate(req, res, next) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  // Also bypass in test environment to allow tests to run without API key
  if (!authEnabled || process.env.NODE_ENV === 'test') {
    return next();
  }

  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = match[1];
  const expectedKey = process.env.API_KEY;
  if (!expectedKey || token !== expectedKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  req.auth = { apiKey: token };
  next();
}