'use strict';

/**
 * CORS único para o servidor (bot.js e routes/api.js usavam cada um o seu,
 * refletindo QUALQUER origem junto com Allow-Credentials: true).
 *
 * Configuração:
 *   CORS_ORIGINS=https://meusite.com,https://outro.com   (lista separada por vírgula)
 *
 * - Com CORS_ORIGINS definido: só essas origens (e localhost em dev) recebem
 *   os headers CORS. Origens fora da lista são recusadas.
 * - Sem CORS_ORIGINS: mantém o comportamento antigo (reflete a origem) para não
 *   quebrar o site/app em produção, mas avisa no log uma vez.
 * - Requisições sem Origin (app Android, curl, server-to-server) não são afetadas.
 */

const ALLOWED_HEADERS = [
  'Content-Type', 'Authorization', 'x-admin-key',
].join(', ');

const METHODS = 'GET, POST, PATCH, PUT, DELETE, OPTIONS';

const lista = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const restrito = lista.length > 0;
const bloqueadasLogadas = new Set();
let avisouAberto = false;

function isLocalhost(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function origemPermitida(origin) {
  if (!restrito) return true;
  const o = origin.replace(/\/+$/, '');
  return lista.includes(o) || (process.env.NODE_ENV !== 'production' && isLocalhost(o));
}

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  if (!restrito && !avisouAberto) {
    avisouAberto = true;
    console.warn('⚠️  CORS_ORIGINS não definido — aceitando qualquer origem. Defina CORS_ORIGINS no Render para restringir.');
  }

  if (origin) {
    if (origemPermitida(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    } else {
      if (!bloqueadasLogadas.has(origin)) {
        bloqueadasLogadas.add(origin);
        console.warn(`🚫 CORS: origem não permitida bloqueada: ${origin}`);
      }
      if (req.method === 'OPTIONS') return res.sendStatus(403);
      // Sem os headers CORS o navegador bloqueia a resposta; a rota segue normal para clientes não-browser.
      return next();
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

module.exports = { corsMiddleware };
