'use strict';

const { version } = require('../../../package.json');
const { getSock } = require('./_shared');

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}min`);
  if (!parts.length) parts.push(`${total}s`);
  return parts.join(' ');
}

function totalCommandsExecuted(cmdCount) {
  const values = cmdCount instanceof Map
    ? [...cmdCount.values()]
    : (cmdCount && typeof cmdCount === 'object' ? Object.values(cmdCount) : []);
  return values.reduce((sum, value) => {
    const count = Number(value);
    return sum + (Number.isFinite(count) && count > 0 ? count : 0);
  }, 0);
}

async function handleBotInfo(sock, msg, jid, cmdCount) {
  const online = Boolean(getSock()?.user);
  const totalCommands = totalCommandsExecuted(cmdCount);
  const texto = [
    '🤖 *INFORMAÇÕES DO TICO BOT* 🤖',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    `🕒 *Tempo ativo:* ${formatUptime(process.uptime())}`,
    `📊 *Comandos executados:* ${totalCommands.toLocaleString('pt-BR')}`,
    `🏷️ *Versão:* ${version}`,
    `🧩 *Node.js:* ${process.version}`,
    `📡 *WhatsApp:* ${online ? 'Conectado' : 'Desconectado'}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '_Use o menu para conhecer os comandos disponíveis._',
  ].join('\n');

  await sock.sendMessage(jid, { text: texto }, msg ? { quoted: msg } : {});
}

module.exports = { handleBotInfo, _helpers: { formatUptime, totalCommandsExecuted } };
