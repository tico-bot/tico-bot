'use strict';

const path = require('path');
const CarteiraGrupo = require(path.join(__dirname, '..', '..', '..', 'models', 'CarteiraGrupo'));
const { formatWalletAmount } = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira', 'wallet'));

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function barraProgresso(valor, maximo, tamanho = 10) {
  if (!maximo || maximo <= 0) return '░'.repeat(tamanho);
  const preenchido = Math.min(Math.round((valor / maximo) * tamanho), tamanho);
  return '█'.repeat(preenchido) + '░'.repeat(tamanho - preenchido);
}

// !rankgold
async function handleRankGold(sock, msg, jid, contactNames = {}) {
  if (!jid?.endsWith('@g.us')) {
    await sock.sendMessage(jid, {
      text: '⚠️ Este comando só pode ser usado em grupos.',
    }, { quoted: msg });
    return;
  }

  try {
    const metadata = await sock.groupMetadata(jid);
    const membrosAtuais = new Set(metadata.participants.map(p => p.id));

    const candidatos = await CarteiraGrupo.find({ idGrupo: jid })
      .lean();

    const top = candidatos
      .filter(u => membrosAtuais.has(u.idWhatsApp) && (Number(u.gold) || 0) > 0)
      .sort((left, right) => right.gold - left.gold)
      .slice(0, 10);

    if (!top?.length) {
      await sock.sendMessage(jid, {
        text: '💰 *RANKING DE REAIS*\n\nNenhum membro ativo com saldo registrado neste grupo ainda!\n\n⛏️ Use *!garimpar* para começar a ganhar saldo.',
      }, { quoted: msg });
      return;
    }

    const maxGold   = top[0].gold || 1;

    const linhas = top.map((u, i) => {
      const count = u.gold || 0;
      const bar    = barraProgresso(count, maxGold);
      const numero = u.idWhatsApp.split('@')[0].split(':')[0];
      const medal  = MEDALS[i];

      return `${medal} @${numero}\n   ${bar} ${formatWalletAmount(count, u.wallet || {})}`;
    }).join('\n\n');

    const mentions = top.map(u => u.idWhatsApp);

    await sock.sendMessage(jid, {
      text:
        `💰 *RANKING DE SALDOS — MEMBROS ATIVOS* 💰\n\n` +
        `${linhas}\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `⛏️ Use *!garimpar* para subir no ranking!`,
      mentions,
    }, { quoted: msg });

  } catch (err) {
    console.error('[handleRankGold] Erro:', err.message);
    await sock.sendMessage(jid, {
      text: '⚠️ Erro ao carregar o ranking. Tente novamente.',
    }, { quoted: msg });
  }
}

module.exports = { handleRankGold };
