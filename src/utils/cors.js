'use strict';

const DEFAULT_PRODUCTION_ORIGINS = ['https://tico-bot.github.io'];
const ALLOWED_HEADERS = 'Content-Type, Authorization, x-contas-key, x-contas-token';
const METHODS = 'GET, POST, PATCH, PUT, DELETE, OPTIONS';

function resolveOrigins(env = process.env) {
  const configured = [env.CORS_ORIGINS, env.SITE_ORIGINS]
    .filter(Boolean)
    .flatMap(value => String(value).split(','))
    .map(value => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  // Never fall back to reflecting every origin simply because a deployment omitted NODE_ENV.
  return [...new Set(configured.length ? configured : DEFAULT_PRODUCTION_ORIGINS)];
}

function createCorsMiddleware(env = process.env) {
  const allowedOrigins = resolveOrigins(env);
  const blockedOriginsLogged = new Set();

  function isLocalhost(origin) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  }

  function originAllowed(origin) {
    const normalised = origin.replace(/\/+$/, '');
    return allowedOrigins.includes(normalised)
      || (['development', 'test'].includes(env.NODE_ENV) && isLocalhost(normalised));
  }

  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;

    if (origin) {
      if (originAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin.replace(/\/+$/, ''));
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
      } else {
        if (!blockedOriginsLogged.has(origin)) {
          blockedOriginsLogged.add(origin);
          console.warn(`🚫 CORS: origem de navegador não permitida: ${origin}`);
        }
        // CORS is not authorization: the route may continue for server clients,
        // but browsers cannot read the response and preflighted requests are denied.
        if (req.method === 'OPTIONS') return res.sendStatus(403);
        return next();
      }
    } else {
      // Server-to-server clients without Origin are not governed by CORS.
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Vary', origin ? 'Origin' : 'Accept-Encoding');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  };
}

const corsMiddleware = createCorsMiddleware();
module.exports = { corsMiddleware, createCorsMiddleware, resolveOrigins };
