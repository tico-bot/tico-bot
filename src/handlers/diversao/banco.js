'use strict';

const path = require('path');
const { createHash } = require('crypto');
const CarteiraGrupo = require(path.join(__dirname, '..', '..', 'models', 'CarteiraGrupo'));
const Usuario       = require(path.join(__dirname, '..', '..', 'models', 'Usuario'));
const carteiraService = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));
const { incrementMission } = require('./missoes');
const { BANCO_CONFIG } = require(path.join(__dirname, '..', '..', 'config', 'banco'));
const { getWalletBalance } = require(path.join(__dirname, '..', '..', 'utils', 'carteira', 'wallet'));

// ─── Helpers puros ────────────────────────────────────────────────────────────

function sortearJuros() {
  return BANCO_CONFIG.JUROS_MIN +
    Math.floor(Math.random() * (BANCO_CONFIG.JUROS_MAX - BANCO_CONFIG.JUROS_MIN + 1));
}

function calcularResgate(amount, interest) {
  return Math.round(amount * (1 + interest / 100));
}

function getMsLeft(startDate) {
  if (!startDate) return 0;
  const inicio = new Date(startDate).getTime();
  if (isNaN(inicio)) return 0;
  const restante = inicio + BANCO_CONFIG.PRAZO_MS - Date.now();
  return restante > 0 ? restante : 0;
}

function formatTimeLeft(ms) {
  if (ms <= 0) return '0s';
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min ${s}s`;
  return `${s}s`;
}

// ─── Helpers de acesso ao BD ──────────────────────────────────────────────────

async function resolverUserId(sock, msg) {
  const raw = msg.key.participant || msg.key.remoteJid;
  if (!raw) return raw;
  // Mesma normalização de economia.js/roubo.js/utils/carteira.js — mantém
  // @lid como está (não tenta converter para telefone) e só normaliza
  // JIDs de telefone. Garante que !banco aponte para a MESMA carteira
  // usada por !plata, !comprar etc.
  // (a versão anterior tentava resolver @lid via sock.onWhatsApp, usando a
  // parte numérica do @lid como se fosse telefone — nunca é.)
  //
  // FIX: o ramo @lid devolvia o JID cru, sem remover o sufixo de dispositivo
  // (":12") nem forçar lowercase — diferente do que normalizarJid()/
  // resolveGlobalId() fazem no resto do bot. Em WhatsApp multi-dispositivo
  // isso criava uma CarteiraGrupo "fantasma" (idWhatsApp diferente) só para
  // o banco, separada da carteira real usada por !plata — o gold depositado
  // ficava preso lá, invisível em qualquer outro comando.
  if (raw.endsWith('@lid')) {
    const userPart = raw.split('@')[0].split(':')[0];
    return `${userPart}@lid`.toLowerCase();
  }
  return raw.split('@')[0].split(':')[0].replace(/\D/g, '') + '@s.whatsapp.net';
}

async function getCarteiraGrupo(userId, idGrupo) {
  return carteiraService.getCarteira(userId, idGrupo);
}

// ─── calcularLimiteBanco ─────────────────────────────────────────────────────
// Calcula o limite diário de depósito baseado no level do usuário
function calcularLimiteBanco(level) {
  if (level >= 100) return 5000000;
  if (level >= 50)  return 2500000;
  if (level >= 20)  return 1000000;
  if (level >= 10)  return 500000;
  if (level >= 5)   return 250000;
  return 100000;    // Level 1 a 4
}

// ─── handleBanco ─────────────────────────────────────────────────────────────

// !banco
async function handleBanco(sock, msg, jid, caption) {
  const userId  = await resolverUserId(sock, msg);
  const idGrupo = msg.key.remoteJid?.endsWith('@g.us') ? msg.key.remoteJid : null;
  const match   = caption.match(/banco\s+(\d+)/i);
  console.log('[banco] userId:', userId, '| idGrupo:', idGrupo);
  
  // ── Banco obrigatoriamente por grupo ────────────────────────────────────────
  if (!idGrupo) {
    await sock.sendMessage(jid, {
      text: '⚠️ O banco só funciona dentro de grupos!',
    }, { quoted: msg });
    return;
  }

  const linkedWallet = await getWalletBalance(userId);
  if (linkedWallet.linked) {
    await sock.sendMessage(jid, {
      text: '🏦 Seu dinheiro da conta vinculada é compartilhado entre os grupos e fica disponível em !plata. Novos investimentos do banco do bot não estão disponíveis para contas vinculadas.',
    }, { quoted: msg });
    return;
  }

  const carteira = await getCarteiraGrupo(userId, idGrupo);
  const banco    = carteira.banco ?? {};
  const today    = new Date().toISOString().split('T')[0];

  // ── Calcula o level DINAMICAMENTE a partir do xp — o campo carteira.level
  // só é atualizado via CarteiraGrupo.incrementXp() ou .save(), mas o ganho
  // de xp por mensagem no bot.js usa $inc direto (findOneAndUpdate), que NÃO
  // dispara nenhum dos dois. Ler carteira.level aqui sempre devolvia 1,
  // travando todo mundo no limite mínimo (100000, nível 1-4).
  const userLevel    = CarteiraGrupo.levelFromXp(carteira.xp ?? 0);
  const limiteDiario = calcularLimiteBanco(userLevel);

  // ── Resetar limite diário se necessário ─────────────────────────────────────
  if (banco.lastDepositDate !== today) {
    await CarteiraGrupo.updateOne(
      { idWhatsApp: userId, idGrupo },
      { $set: { 'banco.depositedToday': 0, 'banco.lastDepositDate': today } }
    );
    banco.depositedToday  = 0;
    banco.lastDepositDate = today;
  }

  const saldoDisponivel = carteira.gold ?? 0;
  const depositedToday  = banco.depositedToday ?? 0;

  // ✅ Substituído BANCO_CONFIG.DAILY_LIMIT por limiteDiario
  const remainingLimit  = Math.max(0, limiteDiario - depositedToday);

  // ✅ Bloco de limite diário reutilizado — mostra o level do usuário
  const linhaLimite =
    `*LIMITE DIÁRIO (Lvl ${userLevel}):*\n` +
    `  📊 Depositado hoje: *${carteiraService.formatarSaldo(depositedToday, carteira)}*\n` +
    `  🔓 Disponível: *${carteiraService.formatarSaldo(remainingLimit, carteira)}*`;

  // ── Exibir status (sem argumento) ────────────────────────────────────────────
  if (!match) {
    const hasInvestment = (banco.amount ?? 0) > 0;

    if (!hasInvestment) {
      await sock.sendMessage(jid, {
        text:
          `💼 ═══ BANCO Tico ═══ 💼\n\n` +
          `💰 *Nenhum investimento ativo no momento!*\n\n` +
          `O seu dinheiro está seguro, mas ocioso...\n\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `*COMO INVESTIR?*\n` +
          `  📊 Use: *!banco <quantia>*\n` +
          `  💵 Exemplo: *!banco 500*\n\n` +
          `*RENDIMENTOS:*\n` +
          `  📈 Juros: ${BANCO_CONFIG.JUROS_MIN}–${BANCO_CONFIG.JUROS_MAX}%\n` +
          `  ⏰ Prazo: *20 minutos*\n\n` +
          `*RESGATE:*\n` +
          `  💎 Use: *!resgatar* (neste grupo)\n\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `${linhaLimite}\n\n` +
          `*SEU SALDO (grupo):* 💰 *${carteiraService.formatarSaldo(saldoDisponivel, carteira)}*\n\n` +
          `_Deixe seu dinheiro trabalhar para você!_ 🚀`,
      }, { quoted: msg });
      return;
    }

    const msLeft       = getMsLeft(banco.startDate);
    const futureAmount = calcularResgate(banco.amount, banco.interest);
    const ganho        = futureAmount - banco.amount;
    const status       = msLeft > 0
      ? `⏳ Tempo restante: *${formatTimeLeft(msLeft)}*`
      : `✅ *PRONTO PARA RESGATAR!*`;

    await sock.sendMessage(jid, {
      text:
        `💼 ═══ SEU INVESTIMENTO ═══ 💼\n\n` +
        `${msLeft > 0 ? '⌛' : '🎯'} ${status}\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `*DETALHES:*\n` +
        `  💵 Investido: *${carteiraService.formatarSaldo(banco.amount, carteira)}*\n` +
        `  📈 Taxa de juros: *${banco.interest}%*\n` +
        `  💎 Retorno esperado: *${carteiraService.formatarSaldo(futureAmount, carteira)}*\n` +
        `  💹 Lucro previsto: *+${carteiraService.formatarSaldo(ganho, carteira)}*\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `${linhaLimite}\n\n` +
        `*SEU SALDO (grupo):* 💰 *${carteiraService.formatarSaldo(saldoDisponivel, carteira)}*\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        (msLeft > 0
          ? `⏳ Aguarde *${formatTimeLeft(msLeft)}* para resgatar!\n  💵 Ou deposite mais: *!banco <quantia>*`
          : `✅ Use *!resgatar* para sacar seu dinheiro!\n  💵 Ou deposite mais: *!banco <quantia>*`) +
        `\n\n_Seu investimento está crescendo..._ 📊`,
    }, { quoted: msg });
    return;
  }

  // ── Processar depósito ───────────────────────────────────────────────────────
  const amount = parseInt(match[1], 10);

  if (!amount || amount <= 0 || !Number.isSafeInteger(amount)) {
    await sock.sendMessage(jid, {
      text: `⚠️ *QUANTIDADE INVÁLIDA*\n\nA quantia deve ser um número positivo válido!\n\n*EXEMPLO:*\n  *!banco 500*`,
    }, { quoted: msg });
    return;
  }

  if (remainingLimit <= 0) {
    await sock.sendMessage(jid, {
      text:
        `⚠️ *LIMITE DIÁRIO ATINGIDO*\n\nVocê já depositou *${carteiraService.formatarSaldo(depositedToday, carteira)}* hoje!\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `  📊 Limite (Lvl ${userLevel}): *${carteiraService.formatarSaldo(limiteDiario, carteira)}*\n` +
        `  🔒 Limite restante: *${carteiraService.formatarSaldo(0, carteira)}*\n\n` +
        `_Volte amanhã para depositar mais!_ ⏰`,
    }, { quoted: msg });
    return;
  }

  if (amount > remainingLimit) {
    await sock.sendMessage(jid, {
      text:
        `⚠️ *LIMITE DIÁRIO EXCEDIDO*\n\n` +
        `  📊 Limite (Lvl ${userLevel}): *${carteiraService.formatarSaldo(limiteDiario, carteira)}*\n` +
        `  ✅ Depositado hoje: *${carteiraService.formatarSaldo(depositedToday, carteira)}*\n` +
        `  🔓 Disponível: *${carteiraService.formatarSaldo(remainingLimit, carteira)}*\n\n` +
        `*Você tentou depositar:* ${carteiraService.formatarSaldo(amount, carteira)}\n\n` +
        `_Tente depositar no máximo *${carteiraService.formatarSaldo(remainingLimit, carteira)}* agora!_ ⏰`,
    }, { quoted: msg });
    return;
  }

  // ── Debitar Prata do grupo ────────────────────────────────────────────────────
  let saldoAposDebito;
  try {
    const carteiraAtualizada = await carteiraService.alterarGold(
      userId, idGrupo, -amount, 'Depósito banco'
    );
    saldoAposDebito = carteiraAtualizada.gold;
  } catch (err) {
    if (err instanceof RangeError) {
      await sock.sendMessage(jid, {
        text:
          `⚠️ *SALDO INSUFICIENTE*\n\nVocê não tem *${carteiraService.formatarSaldo(amount, carteira)}* neste grupo!\n\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `*SEU SALDO (grupo):*\n  💰 Disponível: *${carteiraService.formatarSaldo(saldoDisponivel, carteira)}*`,
      }, { quoted: msg });
      return;
    }
    throw err;
  }

  // ── Atualizar dados do banco no CarteiraGrupo ────────────────────────────────
  const newDepositedToday  = depositedToday + amount;
  const limiteRestanteHoje = Math.max(0, limiteDiario - newDepositedToday);
  const hasActiveInvestment = (banco.amount ?? 0) > 0;

  if (hasActiveInvestment) {
    await CarteiraGrupo.updateOne(
      { idWhatsApp: userId, idGrupo },
      {
        $inc: { 'banco.amount': amount, 'banco.depositedToday': amount },
        $set: { 'banco.lastDepositDate': today },
      }
    );

    const newTotal     = (banco.amount ?? 0) + amount;
    const futureAmount = calcularResgate(newTotal, banco.interest);
    const ganho        = futureAmount - newTotal;
    const msLeft       = getMsLeft(banco.startDate);

    await sock.sendMessage(jid, {
      text:
        `✅ ═══ DEPÓSITO ADICIONADO! ═══ ✅\n\n` +
        `💼 *Investimento atualizado com sucesso!*\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `*RESUMO:*\n` +
        `  💵 Adicionado agora: *+${carteiraService.formatarSaldo(amount, carteira)}*\n` +
        `  🏦 Total investido: *${carteiraService.formatarSaldo(newTotal, carteira)}*\n` +
        `  📈 Taxa de juros: *${banco.interest}%*\n` +
        `  ⏰ Tempo restante: *${formatTimeLeft(msLeft)}*\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `*RETORNO ESPERADO:*\n` +
        `  💎 Resgate em: *${carteiraService.formatarSaldo(futureAmount, carteira)}*\n` +
        `  💹 Lucro esperado: *+${carteiraService.formatarSaldo(ganho, carteira)}*\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `*SALDO (grupo):*\n` +
        `  💰 Disponível: *${carteiraService.formatarSaldo(saldoAposDebito, carteira)}*\n` +
        `  🏦 Investido: *${carteiraService.formatarSaldo(newTotal, carteira)}*\n` +
        `  🔓 Limite restante hoje: *${carteiraService.formatarSaldo(limiteRestanteHoje, carteira)}*`,
    }, { quoted: msg });

  } else {
    const interest = sortearJuros();
    await CarteiraGrupo.updateOne(
      { idWhatsApp: userId, idGrupo },
      { $set: {
        'banco.amount':          amount,
        'banco.interest':        interest,
        'banco.startDate':       new Date(),
        'banco.lastDepositDate': today,
        'banco.depositedToday':  newDepositedToday,
      }}
    );

    const futureAmount = calcularResgate(amount, interest);
    const ganho        = futureAmount - amount;

    await sock.sendMessage(jid, {
      text:
        `✅ ═══ INVESTIMENTO REALIZADO! ═══ ✅\n\n` +
        `💼 *Seu dinheiro está trabalhando!*\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `*RESUMO DO INVESTIMENTO:*\n` +
        `  💵 Valor investido: *${carteiraService.formatarSaldo(amount, carteira)}*\n` +
        `  📈 Taxa de juros: *${interest}%*\n` +
        `  ⏰ Prazo: *20 minutos*\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `*RETORNO ESPERADO:*\n` +
        `  💎 Resgate em: *${carteiraService.formatarSaldo(futureAmount, carteira)}*\n` +
        `  💹 Lucro esperado: *+${carteiraService.formatarSaldo(ganho, carteira)}*\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `*SALDO (grupo):*\n` +
        `  💰 Disponível: *${carteiraService.formatarSaldo(saldoAposDebito, carteira)}*\n` +
        `  🏦 Investido: *${carteiraService.formatarSaldo(amount, carteira)}*\n` +
        `  🔓 Limite restante hoje: *${carteiraService.formatarSaldo(limiteRestanteHoje, carteira)}*`,
    }, { quoted: msg });
  }
}

// ─── handleResgatar ───────────────────────────────────────────────────────────

// !resgatar
async function handleResgatar(sock, msg, jid) {
  const userId  = await resolverUserId(sock, msg);
  const idGrupo = msg.key.remoteJid?.endsWith('@g.us') ? msg.key.remoteJid : null;
  console.log('[resgatar] userId:', userId, '| idGrupo:', idGrupo);
  
  if (!idGrupo) {
    await sock.sendMessage(jid, {
      text: '⚠️ O banco só funciona dentro de grupos!',
    }, { quoted: msg });
    return;
  }

  const linkedWallet = await getWalletBalance(userId);
  if (linkedWallet.linked) {
    await sock.sendMessage(jid, {
      text: '🏦 Seu dinheiro da conta vinculada é compartilhado entre os grupos e fica disponível em !plata. Investimentos do banco do bot não estão disponíveis para contas vinculadas.',
    }, { quoted: msg });
    return;
  }

  const carteira = await getCarteiraGrupo(userId, idGrupo);
  const banco    = carteira.banco ?? {};

  if (!banco.amount || banco.amount <= 0) {
    await sock.sendMessage(jid, {
      text: `⚠️ *SEM INVESTIMENTOS ATIVOS*\n\nVocê não possui nenhum investimento ativo neste grupo!\n\n_Use *!banco <quantia>* para investir!_`,
    }, { quoted: msg });
    return;
  }

  const msLeft = getMsLeft(banco.startDate);

  if (msLeft > 0) {
    const futureAmount = calcularResgate(banco.amount, banco.interest);
    const ganho        = futureAmount - banco.amount;
    await sock.sendMessage(jid, {
      text:
        `⏳ ═══ INVESTIMENTO EM ANDAMENTO ═══ ⏳\n\n` +
        `⌛ *Seu investimento vence em ${formatTimeLeft(msLeft)}!*\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `*DETALHES:*\n` +
        `  💵 Investido: *${carteiraService.formatarSaldo(banco.amount, carteira)}*\n` +
        `  📈 Taxa: *${banco.interest}%*\n` +
        `  💎 Retorno esperado: *${carteiraService.formatarSaldo(futureAmount, carteira)}*\n` +
        `  💹 Lucro esperado: *+${carteiraService.formatarSaldo(ganho, carteira)}*\n\n` +
        `_Aguarde o prazo para resgatar!_`,
    }, { quoted: msg });
    return;
  }

  const futureAmount = calcularResgate(banco.amount, banco.interest);
  const ganho        = futureAmount - banco.amount;

  const entradaHistorico = {
    data:      new Date(),
    investido: banco.amount,
    resgate:   futureAmount,
    juros:     banco.interest,
    lucro:     ganho,
  };

  let carteiraFinal;
  if (carteira.currencyInfo) {
    const requestId = createHash('sha256')
      .update(`banco:${userId}:${idGrupo}:${new Date(banco.startDate).toISOString()}:${futureAmount}`)
      .digest('hex');
    carteiraFinal = await carteiraService.alterarGold(
      userId,
      idGrupo,
      futureAmount,
      'Resgate banco',
      requestId,
    );
    const resgateBanco = await CarteiraGrupo.updateOne(
      {
        idWhatsApp: userId,
        idGrupo,
        'banco.amount': banco.amount,
        'banco.startDate': banco.startDate,
      },
      {
        $set: {
          'banco.amount': 0,
          'banco.interest': 0,
          'banco.startDate': null,
        },
        $push: {
          'banco.historico': {
            $each: [entradaHistorico],
            $slice: -BANCO_CONFIG.HISTORICO_LIMITE,
          },
          goldHistory: {
            $each: [{ type: 'recebido', item: 'Resgate banco', amount: futureAmount }],
            $slice: -50,
          },
        },
      },
    );
    if (resgateBanco.modifiedCount !== 1) {
      throw new Error('O investimento mudou durante o resgate; o saldo foi protegido para uma nova tentativa.');
    }
  } else {
    carteiraFinal = await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp: userId, idGrupo },
      {
        $inc: { gold: futureAmount },
        $set: {
          'banco.amount': 0,
          'banco.interest': 0,
          'banco.startDate': null,
        },
        $push: {
          'banco.historico': {
            $each: [entradaHistorico],
            $slice: -BANCO_CONFIG.HISTORICO_LIMITE,
          },
          goldHistory: {
            $each: [{ type: 'recebido', item: 'Resgate banco', amount: futureAmount }],
            $slice: -50,
          },
        },
      },
      { new: true },
    );
  }

  // ── Progresso de missão no Usuario ──────────────────────────────────────────
  if (ganho > 0) {
    // Era um $inc direto sem cap — "!missao" podia mostrar progresso acima
    // de 500 (a meta de Plata500) pra quem resgatava investimentos grandes.
    // incrementMission() trava no alvo com $min e marca completed uma vez.
    await incrementMission(userId, 'gold500', ganho).catch(() => {});
  }

  await sock.sendMessage(jid, {
    text:
      `🎉 ═══ RESGATE BEM-SUCEDIDO! ═══ 🎉\n\n` +
      `💎 *Parabéns! Seu investimento rendeu!*\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `*RESUMO:*\n` +
      `  💵 Investimento inicial: *${carteiraService.formatarSaldo(banco.amount, carteira)}*\n` +
      `  📈 Taxa de juros: *${banco.interest}%*\n` +
      `  💰 Resgate total: *${carteiraService.formatarSaldo(futureAmount, carteira)}*\n` +
      `  💹 Lucro obtido: *+${carteiraService.formatarSaldo(ganho, carteira)}*\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `*SALDO FINAL (grupo):*\n` +
      `  ✅ Total na conta: *${carteiraService.formatarSaldo(carteiraFinal.gold, carteiraFinal)}*`,
  }, { quoted: msg });
}

// ─── handleHistoricoBanco ─────────────────────────────────────────────────────

async function handleHistoricoBanco(sock, msg, jid) {
  const userId  = await resolverUserId(sock, msg);
  const idGrupo = msg.key.remoteJid?.endsWith('@g.us') ? msg.key.remoteJid : null;

  if (!idGrupo) {
    await sock.sendMessage(jid, {
      text: '⚠️ O banco só funciona dentro de grupos!',
    }, { quoted: msg });
    return;
  }

  const carteira  = await getCarteiraGrupo(userId, idGrupo);
  const historico = carteira.banco?.historico ?? [];

  if (historico.length === 0) {
    await sock.sendMessage(jid, {
      text: `📋 *HISTÓRICO DO BANCO*\n\nVocê ainda não realizou nenhum resgate neste grupo!\n\n_Use *!banco <quantia>* para começar a investir._`,
    }, { quoted: msg });
    return;
  }

  const linhas = historico
    .slice()
    .reverse()
    .map((h, i) => {
      const data = new Date(h.data).toLocaleString('pt-BR', { timeZone: 'America/Cuiaba' });
      return (
        `*${i + 1}.* ${data}\n` +
        `   💵 ${carteiraService.formatarSaldo(h.investido, carteira)} → 💎 ${carteiraService.formatarSaldo(h.resgate, carteira)} (+${carteiraService.formatarSaldo(h.lucro, carteira)}) | ${h.juros}%`
      );
    })
    .join('\n\n');

  await sock.sendMessage(jid, {
    text:
      `📋 ═══ HISTÓRICO DO BANCO ═══ 📋\n\n` +
      `_Últimos ${historico.length} resgates neste grupo:_\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      linhas +
      `\n\n━━━━━━━━━━━━━━━━\n` +
      `_Use *!banco* para verificar seu investimento atual._`,
  }, { quoted: msg });
}

// ─── Exportar ─────────────────────────────────────────────────────────────────

module.exports = {
  handleBanco,
  handleResgatar,
  handleHistoricoBanco,
};