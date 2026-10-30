'use strict';

const os       = require('os');
const mongoose = require('mongoose');
const { isAdmin } = require('../grupo/helpers');
const { getOwners, isOwnerIdentity, getSock } = require('./_shared');
const { getAlternateSenderJids } = require('../../utils/identity');
const { getLockInfo, isOwner: souDonoDoLock } = require('../../utils/instanceLock');
const { getAuthStats } = require('../../mongoAuthState');

const ESTADOS_MONGO = ['desconectado', 'conectado', 'conectando', 'desconectando'];

function fmtUptime(seg) {
  const d = Math.floor(seg / 86400);
  const h = Math.floor((seg % 86400) / 3600);
  const m = Math.floor((seg % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}min`].filter(Boolean).join(' ');
}

const mb = n => `${(n / 1024 / 1024).toFixed(0)} MB`;

/**
 * !botstatus — diagnóstico do bot. Restrito aos donos (BOT_OWNERS).
 * Sem BOT_OWNERS configurado, admins de grupo também podem usar.
 */
async function handleBotStatus(sock, msg, jid, senderJid) {
  const donos = getOwners();
  const alternateJids = getAlternateSenderJids(msg);
  let permitido = await isOwnerIdentity(senderJid, alternateJids);
  if (!permitido && donos.length === 0 && jid.endsWith('@g.us')) {
    permitido = await isAdmin(sock, jid, senderJid, alternateJids).catch(() => false);
  }
  if (!permitido) {
    await sock.sendMessage(jid, { text: '❌ Este comando é restrito aos donos do bot.' }, { quoted: msg });
    return;
  }

  const socketOn = !!getSock()?.user;

  const mem   = process.memoryUsage();
  const lock  = await getLockInfo();
  const auth  = getAuthStats();
  const ping0 = Date.now();
  let pingMongo = '—';
  try { await mongoose.connection.db.admin().ping(); pingMongo = `${Date.now() - ping0} ms`; } catch { pingMongo = 'falhou'; }

  const lockTxt = !lock
    ? 'sem registro'
    : `${lock.souDono ? '✅ esta instância' : '⚠️ OUTRA instância'} (${lock.hostname || '?'}) — heartbeat há ${Math.round((Date.now() - new Date(lock.heartbeatAt).getTime()) / 1000)}s`;

  const texto =
    `🩺 *STATUS DO BOT*\n\n` +
    `🕒 Uptime: *${fmtUptime(process.uptime())}*\n` +
    `📡 WhatsApp: *${socketOn ? 'conectado' : 'desconectado'}*\n` +
    `🍃 MongoDB: *${ESTADOS_MONGO[mongoose.connection.readyState] || '?'}* (ping ${pingMongo})\n` +
    `🔒 Lock: ${lockTxt}${souDonoDoLock() ? '' : '\n   ⚠️ _esta instância NÃO é a dona do lock_'}\n\n` +
    `🧠 Memória: RSS *${mb(mem.rss)}* | Heap *${mb(mem.heapUsed)}* / ${mb(mem.heapTotal)}\n` +
    `💻 Host: ${os.hostname()} | Node ${process.version}\n\n` +
    `🔑 Chaves Signal em cache: *${auth.cacheSize}* (hits ${auth.cacheHits} / miss ${auth.cacheMiss})\n` +
    `🩹 Sessões Signal curadas: *${auth.sessoesCuradas}*`;

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

module.exports = { handleBotStatus };
