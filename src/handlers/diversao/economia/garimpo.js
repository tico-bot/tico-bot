'use strict';

const path = require('path');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const Usuario       = require(path.join(__dirname, '..', '..', '..', 'models', 'Usuario'));
const CarteiraGrupo = require(path.join(__dirname, '..', '..', '..', 'models', 'CarteiraGrupo'));
const { alterarGold, formatarSaldo } = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira'));
const { getSenderJid } = require(path.join(__dirname, '..', '..', '..', 'utils', 'identity'));
const crypto = require('crypto');
const { logError } = require(path.join(__dirname, '..', '..', '..', 'utils', 'logging'));
const republicaEconomia = require('../../republica/economia');
const {
  adjustWalletLocal,
  formatWalletAmount,
  getWalletBalance,
  localMinorUnitsToBrlCents,
} = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira', 'wallet'));

// Fallback seguro caso missoes não exporte prepareDailyMissionState/incrementMission
let prepareDailyMissionState = async () => {};
let incrementMission = async () => {};
try {
  const missoesMod = require(path.join(__dirname, '..', 'missoes'));
  if (missoesMod.prepareDailyMissionState) prepareDailyMissionState = missoesMod.prepareDailyMissionState;
  if (missoesMod.incrementMission) incrementMission = missoesMod.incrementMission;
} catch (error) {
  logError('handleGarimpar', error, 'Módulo de missões indisponível; progresso de missão ficará desativado');
}

const {
  sortearMinerio,
  sortearEvento,
  getRaridadeKey,
  getRaridadeLabel,
  narrativaAleatoria,
  falaAleatoria,
  mensagemEvento,
  calcularResultadoGarimpo,
  formatarCatalogoMinerios,
} = require(path.join(__dirname, '..', '..', '..', 'utils', 'garimpo'));

const GARIMPO_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutos

function formatarTempo(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}min ${s}s` : `${s}s`;
}

function msgCooldown(restante, prefix = '!') {
  return (
    `⏳ *GARIMPO EM COOLDOWN* ⏳\n\n` +
    `⛏️ Você já garimpou recentemente!\n\n` +
    `⏰ Próximo garimpo em: *${formatarTempo(restante)}*\n\n` +
    `_Quando o tempo acabar, use ${prefix}garimpar ou ${prefix}minerar._`
  );
}

const garimpoCache = new Map();

async function handleMinerios(sock, msg, jid, getPrefix) {
  const prefix = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const texto = formatarCatalogoMinerios(prefix);
  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

async function handleGarimpar(sock, msg, jid, getPrefix) {
  const prefix = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const userIdRaw = getSenderJid(msg);
  const userId    = jidNormalizedUser(userIdRaw);
  const agora     = Date.now();

  // Falha fechada: sem saber se a conta é vinculada, não garimpa (evita pagar no saldo errado).
  let walletGarimpo;
  try {
    walletGarimpo = await getWalletBalance(userId);
  } catch (e) {
    logError('handleGarimpar', e, 'Falha ao consultar carteira');
    await sock.sendMessage(jid, {
      text: '⚠️ Carteira temporariamente indisponível. Tente novamente em instantes.',
    }, { quoted: msg });
    return;
  }
  const contaVinculada = walletGarimpo.linked === true;

  if (!global._garimpoInFlight) global._garimpoInFlight = new Set();
  if (global._garimpoInFlight.has(userId)) {
    await sock.sendMessage(jid, { text: '⏳ Já estou processando seu garimpo, aguarde um instante...' }, { quoted: msg });
    return;
  }
  global._garimpoInFlight.add(userId);

  let docAtual;
  let creditoFeito = false;

  try {
    const tsCache = garimpoCache.get(userId) ?? 0;
    if (tsCache > 0) {
      const passado = agora - tsCache;
      if (passado < GARIMPO_COOLDOWN_MS) {
        await sock.sendMessage(jid, { text: msgCooldown(GARIMPO_COOLDOWN_MS - passado, prefix) }, { quoted: msg });
        return;
      }
    }

    docAtual = await Usuario.findOne(
      { idWhatsApp: userId },
      { ultimoGarimpo: 1 }
    ).lean();

    if (docAtual?.ultimoGarimpo) {
      const tsUltimo  = new Date(docAtual.ultimoGarimpo).getTime();
      const passadoDB = agora - tsUltimo;
      if (passadoDB < GARIMPO_COOLDOWN_MS) {
        garimpoCache.set(userId, tsUltimo);
        await sock.sendMessage(jid, { text: msgCooldown(GARIMPO_COOLDOWN_MS - passadoDB, prefix) }, { quoted: msg });
        return;
      }
    }

    garimpoCache.set(userId, agora);

    await Usuario.findOneAndUpdate(
      { idWhatsApp: userId },
      { $set: { ultimoGarimpo: new Date(agora) } },
      { upsert: true }
    );

    try {
      const minerio     = sortearMinerio();
      const evento      = sortearEvento();
      const raridadeKey = getRaridadeKey(minerio);
      const raridadeTxt = getRaridadeLabel(minerio);
      const narrativa   = narrativaAleatoria(raridadeKey);
      const fala        = falaAleatoria(raridadeKey);
      const eventoTxt   = mensagemEvento(evento);
      const { goldFinal, xpFinal } = calcularResultadoGarimpo(minerio, evento);

      let carteira;
      let goldPago = goldFinal;
      let impostoGarimpo = 0;
      if (contaVinculada) {
        // Conta vinculada: o ouro vai para o saldo do app (1 unidade de Prata equivale à unidade interna da carteira vinculada,
        // mesma regra do !pix). Missões ainda não suportam conta vinculada, então ficam de fora.
        const saldo = await adjustWalletLocal(
          userId,
          goldFinal,
          `Garimpo - ${minerio.nome}`,
          { requestId: crypto.randomUUID() },
        );
        if (saldo?.linked !== true) throw new Error('A conta não está mais vinculada.');
        creditoFeito = true;
        carteira = {
          gold: saldo.balanceCents,
          balanceCents: saldo.balanceCents,
          walletLinked: true,
          walletCurrencyCode: saldo.currencyCode,
          walletCountryCode: saldo.countryCode,
          walletRate: saldo.rate,
          walletRateDate: saldo.rateDate,
        };
        // O dinheiro já foi pago: erro no XP não pode devolver o cooldown.
        await Promise.all([
          Usuario.findOneAndUpdate(
            { idWhatsApp: userId },
            { $inc: { xp: xpFinal } },
            { upsert: true }
          ),
          CarteiraGrupo.findOneAndUpdate(
            { idWhatsApp: userId, idGrupo: jid },
            { $inc: { xp: xpFinal } },
            { upsert: true }
          ),
        ]).catch((xpErr) => console.error('⚠️ Erro ao gravar XP do garimpo:', xpErr.message));
      } else {
        await prepareDailyMissionState(userId);
        const goldAjustado = await republicaEconomia.aplicarMultiplicadorRecompensa(jid, goldFinal);
        const liquidacaoGarimpoPromise = republicaEconomia.liquidarRenda(
          userId, jid, goldAjustado, goldAjustado, `Garimpo - ${minerio.nome}`
        );

        [carteira] = await Promise.all([
          liquidacaoGarimpoPromise.then(resultado => {
            goldPago = resultado.liquido;
            impostoGarimpo = resultado.imposto;
            return resultado.carteira;
          }),
          Usuario.findOneAndUpdate(
            { idWhatsApp: userId },
            { $inc: { xp: xpFinal } },
            { upsert: true }
          ),
          incrementMission(userId, 'gold500', goldAjustado),
          CarteiraGrupo.findOneAndUpdate(
            { idWhatsApp: userId, idGrupo: jid },
            { $inc: { xp: xpFinal } },
            { upsert: true }
          ),
        ]);
      }

      const linhas = [
        `⛏️ *═══ GARIMPO ═══* ⛏️`,
        ``,
        `_${narrativa}_`,
        ``,
        ...(fala ? [`💬 *${fala.personagem}:* “${fala.texto}”`, ``] : []),
        `━━━━━━━━━━━━━━━━`,
        `⛏️ Minério: *${minerio.nome}*`,
        `⭐ Raridade: ${raridadeTxt}`,
      ];

      if (evento) linhas.push(``, `⚡ *EVENTO:* ${eventoTxt}`);

      linhas.push(``);
      const ganhoExibido = carteira?.walletLinked
        ? localMinorUnitsToBrlCents(goldFinal, carteira)
        : goldPago;
      if (goldFinal > 0) {
        linhas.push(`💰 Bruto encontrado: *${formatWalletAmount(ganhoExibido + impostoGarimpo, carteira)}*`);
        if (impostoGarimpo > 0) linhas.push(`🧾 IRPF-Tico: *-${formatWalletAmount(impostoGarimpo, carteira)}*`);
        linhas.push(`💵 Líquido recebido: *+${formatWalletAmount(ganhoExibido, carteira)}*`);
      } else {
        linhas.push(`💰 Encontrado: *nada — evento destruiu tudo!*`);
      }

      linhas.push(`⚡ XP ganho: *+${xpFinal} XP*`);
      linhas.push(`💳 Novo saldo: *${formatWalletAmount(carteira?.gold ?? 0, carteira)}*`);
      linhas.push(``);
      linhas.push(`⏰ Próximo garimpo em: *15 minutos*`);

      await sock.sendMessage(jid, { text: linhas.join('\n') }, { quoted: msg });

    } catch (e) {
      // Conta vinculada com timeout/rede: o servidor pode ter pago sem responder. Mantém o cooldown.
      const resultadoIncerto = contaVinculada && /timeout|network|ECONN|socket/i.test(String(e.message));
      if (!creditoFeito && !resultadoIncerto) {
        try {
          await Usuario.findOneAndUpdate(
            { idWhatsApp: userId },
            { $set: { ultimoGarimpo: docAtual?.ultimoGarimpo ?? null } }
          );
        } catch (rollbackError) {
          logError('handleGarimpar', rollbackError, 'Falha ao restaurar o cooldown após erro');
        }

        garimpoCache.delete(userId);
      }

      logError('handleGarimpar', e, resultadoIncerto ? 'Resultado do crédito incerto' : 'Falha ao processar garimpo');
      await sock.sendMessage(jid, {
        text: resultadoIncerto
          ? '⚠️ Não consegui confirmar o garimpo agora. Confira seu saldo com *!prata* antes de tentar de novo.'
          : '⚠️ Erro ao garimpar! Tente novamente.',
      }, { quoted: msg });
    }
  } finally {
    global._garimpoInFlight.delete(userId);
  }
}

module.exports = { handleGarimpar, handleMinerios };
