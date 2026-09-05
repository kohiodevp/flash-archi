// src/requestId.js
import { randomUUID } from 'crypto';

function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
}

export default requestId;