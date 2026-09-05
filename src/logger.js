// src/logger.js
import pino from 'pino';
import pinoHttp from 'pino-http';

function createLogger() {
  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: {
      service: 'flash-archi',
      version: process.env.APP_VERSION || '3.3.0'
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]'
      ],
      censor: '[REDACTED]'
    }
  });

  const httpLogger = pinoHttp({
    logger,
    genReqId: (req) => req.id,
    customAttributeKeys: {
      reqId: 'requestId'
    }
  });

  return { logger, httpLogger };
}

export { createLogger };