'use strict';

const path = require('path');
const crypto = require('crypto');
const CarteiraGrupo = require(path.join(__dirname, '..', '..', 'models', 'CarteiraGrupo'));
const { resolverJidCarteira, getCarteira, alterarGold, formatarSaldo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));
const { bloqueadoPorVinculo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira', 'vinculo'));
// Usuario removido — level agora vem do grupo

// ─── Configuração ─────────────────────────────────────────────────────────────

const EMPRESTIMO_CONFIG = {
  minValor:    100,
  maxValor:    15000,
  jurosTaxa:   0.20,
  jurosDiario: 0.05,
  prazosDias:  [3, 5, 7],
  cooldownMs:  24 * 60 * 60 * 1000,
  multaAtraso: 0.10,
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Limite máximo de gold emprestável por nível mínimo atingido. */
const LIMITE_POR_NIVEL = {
  1:   200,  2:   300,  3:   400,  4:   450,  5:   500,
  6:   600,  7:   700,  8:   800,  9:   900,  10:  1000,
  15:  1500, 20:  2000, 25:  2500, 30:  3000, 35:  3500,
  40:  4000, 45:  4500, 50:  5000, 55:  5500, 60:  6000,
  65:  6500, 70:  7000, 75:  7500, 80:  8000, 85:  8500,
  90:  9000, 95:  9500, 100: 10000, 110: 11000, 120: 12000,
  130: 13000, 140: 14000, 150: 15000,
};

// Níveis pré-ordenados (decrescente) para evitar reordenação a cada chamada
const NIVEIS_ORDENADOS = Object.keys(LIMITE_POR_NIVEL).map(Number).sort((a, b) => b - a);

// ─── Mensagens ────────────────────────────────────────────────────────────────

const MSGS = {
  ajuda: () =>
    `💸 *EMPRÉSTIMO* 💸\n\n` +
    `*USO:* !emprestimo <valor> [prazo]\n\n` +
    `*PRAZOS DISPONÍVEIS:* 3 · 5 · 7 dias\n` +
    `*JUROS:* 20% fixo + 5%/dia após vencimento\n` +
    `*MULTA:* 10% extra ao vencer\n\n` +
    `Exemplo: *!emprestimo 500 7*`,

  prazoInvalido: () =>
    `⚠️ Prazo inválido! Escolha: *${EMPRESTIMO_CONFIG.prazosDias.join('*, *')}* dias.`,

  valorMinimo: () =>
    `⚠️ Valor mínimo: *${formatarSaldo(EMPRESTIMO_CONFIG.minValor)}*`,

  valorMaximo: () =>
    `⚠️ Valor máximo: *${formatarSaldo(EMPRESTIMO_CONFIG.maxValor)}*`,

  inadimplente: () =>
    `🚫 *ACESSO BLOQUEADO*\n\n` +
    `Você possui um empréstimo *vencido e não pago!*\n\n` +
    `Use *!pay emprestimo* para quitar sua dívida primeiro.`,

  cooldown: (tempo) =>
    `⏳ *COOLDOWN ATIVO*\n\n` +
    `Você quitou um empréstimo recentemente.\n` +
    `Próximo disponível em: *${tempo}*`,

  emprestimoAtivo: (divida, carteira) =>
    `⚠️ *EMPRÉSTIMO ATIVO*\n\n` +
    `Você já possui um empréstimo em aberto!\n\n` +
    `💰 Dívida atual: *${formatarSaldo(divida, carteira)}*\n\n` +
    `Use *!pay emprestimo* para quitar.`,

  limiteExcedido: (level, limite, carteira) =>
    `⚠️ *LIMITE EXCEDIDO*\n\n` +
    `Seu nível (${level}) permite até *${formatarSaldo(limite, carteira)}*.\n\n` +
    `Suba de nível para aumentar seu limite!`,

  aprovado: (valor, juros, totalDever, prazoArg, vencimento, carteira) =>
    `✅ *EMPRÉSTIMO APROVADO!* ✅\n\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `💸 Valor recebido:  *${formatarSaldo(valor, carteira)}*\n` +
    `📈 Juros (20%):     *${formatarSaldo(juros, carteira)}*\n` +
    `💰 Total a pagar:   *${formatarSaldo(totalDever, carteira)}*\n` +
    `⏰ Prazo:           *${prazoArg} dias*\n` +
    `📅 Vencimento:      *${vencimento.toLocaleDateString('pt-BR')}*\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `⚠️ _Após vencer: +10% multa e +5%/dia!_\n\n` +
    `Use *!pay emprestimo* para quitar.`,

  semEmprestimo: () =>
    `✅ Você não possui empréstimos ativos!`,

  saldoInsuficiente: (saldoAtual, divida, carteira) =>
    `⚠️ *SALDO INSUFICIENTE*\n\n` +
    `💰 Seu saldo:    *${formatarSaldo(saldoAtual, carteira)}*\n` +
    `💸 Dívida total: *${formatarSaldo(divida, carteira)}*\n\n` +
    `Faltam: *${formatarSaldo(divida - saldoAtual, carteira)}*`,

  quitado: (divida, saldoRestante, carteira) =>
    `✅ *EMPRÉSTIMO QUITADO!* ✅\n\n` +
    `💸 Valor pago:       *${formatarSaldo(divida, carteira)}*\n` +
    `💰 Saldo restante:   *${formatarSaldo(saldoRestante, carteira)}*\n\n` +
    `⏳ Próximo empréstimo em: *24 horas*\n\n` +
    `_Obrigado por pagar em dia!_ 🏆`,

  quitadoAutomatico: (divida, carteira) =>
    `✅ Seu empréstimo de *${formatarSaldo(divida, carteira)}* foi quitado automaticamente!`,

  semDividas: () =>
    `✅ *Você não possui dívidas ativas!*\n\nUse *!emprestimo <valor> [prazo]* para solicitar.`,

  situacao: (emp, divida, atrasado, diasAtraso, tempoRestante, saldo, carteira) =>
    `📋 *SITUAÇÃO DO EMPRÉSTIMO* 📋\n\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `💸 Valor original:  *${formatarSaldo(emp.valor, carteira)}*\n` +
    `💰 Total a pagar:   *${formatarSaldo(divida, carteira)}*\n` +
    `📅 Vencimento:      *${new Date(emp.vencimento).toLocaleDateString('pt-BR')}*\n` +
    (atrasado
      ? `⚠️ Status: *ATRASADO (${diasAtraso} dia${diasAtraso > 1 ? 's' : ''})*\n`
      : `✅ Status: *Em dia*\n⏰ Vence em: *${tempoRestante}*\n`) +
    `━━━━━━━━━━━━━━━━\n` +
    `💎 Seu saldo: *${formatarSaldo(saldo, carteira)}*\n\n` +
    `Use *!pay emprestimo* para quitar.`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Retorna o limite de empréstimo para o nível informado.
 * Caso nenhum limiar seja atingido, retorna o valor mínimo configurado.
 */
function getLimitePorNivel(level) {
  for (const n of NIVEIS_ORDENADOS) {
    if (level >= n) return LIMITE_POR_NIVEL[n];
  }
  return EMPRESTIMO_CONFIG.minValor;
}

/**
 * Calcula o total da dívida considerando juros fixos e, se vencido,
 * multa por atraso + juros diários.
 */
function calcularDivida(emprestimo) {
  const valorBase    = emprestimo?.valor ?? 0;
  const vencimentoTs = new Date(emprestimo?.vencimento).getTime();

  if (isNaN(vencimentoTs)) {
    console.error('[emprestimo] calcularDivida: vencimento inválido', emprestimo?.vencimento);
    return valorBase;
  }

  const agora     = Date.now();
  const jurosBase = Math.floor(valorBase * EMPRESTIMO_CONFIG.jurosTaxa);

  if (agora <= vencimentoTs) {
    return valorBase + jurosBase;
  }

  const diasAtraso  = Math.ceil((agora - vencimentoTs) / MS_POR_DIA);
  const multa       = Math.floor(valorBase * EMPRESTIMO_CONFIG.multaAtraso);
  const jurosDiario = Math.floor(valorBase * EMPRESTIMO_CONFIG.jurosDiario * diasAtraso);

  return valorBase + jurosBase + multa + jurosDiario;
}

/** Formata milissegundos em string legível (ex: "1d 3h", "2h 5min"). */
function formatarTempo(ms) {
  if (ms <= 0) return '0min';

  const d = Math.floor(ms / MS_POR_DIA);
  const h = Math.floor((ms % MS_POR_DIA) / (60 * 60 * 1000));
  const m = Math.floor((ms % (60 * 60 * 1000)) / 60_000);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

/** Envia mensagem de erro padrão. */
async function enviarErro(sock, msg, jid, texto) {
  await sock.sendMessage(jid, { text: `❌ *Erro:* ${texto}` }, { quoted: msg });
}

/**
 * Extrai e resolve o ID do usuário para o MESMO jid que getCarteira/
 * alterarGold usam (via LidMapping) — sem isso, o empréstimo podia ficar
 * numa carteira diferente da usada por !gold, !banco etc.
 */
/**
 * Extrai e resolve o ID do usuário para o MESMO jid que getCarteira/
 * alterarGold usam (via LidMapping) — sem isso, o empréstimo podia ficar
 * numa carteira diferente da usada por !gold, !banco etc.
 */
async function getUserId(msg, idGrupo) {
  const raw = msg?.key?.participant || msg?.key?.remoteJid;
  if (!raw) return null;
  return resolverJidCarteira(raw, idGrupo);
}

// ─── Operações de banco reutilizáveis ────────────────────────────────────────

/**
 * Cria o empréstimo na carteira do usuário de forma atômica.
 * Retorna o documento atualizado.
 */
async function _criarEmprestimo(userId, idGrupo, valor, prazoArg) {
  const vencimento = new Date(Date.now() + prazoArg * MS_POR_DIA);
  const requestId = crypto.randomUUID();
  const emprestimo = {
    ativo: true,
    valor,
    vencimento,
    solicitadoEm: new Date(),
    prazo: prazoArg,
    requestId,
  };
  const carteira = await getCarteira(userId, idGrupo);

  if (carteira.currencyInfo) {
    const criada = await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp: userId, idGrupo, 'emprestimo.ativo': { $ne: true } },
      { $set: { emprestimo } },
      { upsert: true, new: true },
    );
    if (!criada?.emprestimo?.ativo || criada.emprestimo.requestId !== requestId) return null;

    try {
      return await alterarGold(
        userId,
        idGrupo,
        valor,
        `Empréstimo (${prazoArg} dias)`,
        requestId,
      );
    } catch (error) {
      if (error instanceof RangeError) {
        await CarteiraGrupo.updateOne(
          { idWhatsApp: userId, idGrupo, 'emprestimo.requestId': requestId },
          { $set: { 'emprestimo.ativo': false } },
        );
      }
      throw error;
    }
  }

  return CarteiraGrupo.findOneAndUpdate(
    { idWhatsApp: userId, idGrupo, 'emprestimo.ativo': { $ne: true } },
    {
      $inc: { gold: valor },
      $set: { emprestimo },
      $push: {
        goldHistory: {
          $each:  [{ type: 'recebido', item: `Empréstimo (${prazoArg} dias)`, amount: valor }],
          $slice: -50,
        },
      },
    },
    { upsert: true, new: true }
  );
}

/**
 * Quita o empréstimo de forma atômica — só age se `emprestimo.ativo === true`
 * (evita duplo pagamento em corridas de requisição).
 * Retorna o documento atualizado ou `null` se já estava inativo.
 */
async function _quitarEmprestimo(userId, idGrupo, divida, item = 'Quitação de empréstimo') {
  const carteira = await getCarteira(userId, idGrupo);
  const emprestimo = carteira?.emprestimo;
  if (!emprestimo?.ativo) return null;

  if (carteira.currencyInfo) {
    const identidade = emprestimo.requestId
      || `${emprestimo.solicitadoEm?.toISOString?.() || ''}:${emprestimo.valor}:${emprestimo.vencimento?.toISOString?.() || ''}`;
    const requestId = crypto.createHash('sha256')
      .update(`emprestimo-quitar:${userId}:${idGrupo}:${identidade}`)
      .digest('hex')
      .slice(0, 32);
    const saldoAtualizado = await alterarGold(userId, idGrupo, -divida, item, requestId);
    const filtroEmprestimo = {
      idWhatsApp: userId,
      idGrupo,
      'emprestimo.ativo': true,
      'emprestimo.valor': emprestimo.valor,
      'emprestimo.vencimento': emprestimo.vencimento,
    };
    if (emprestimo.requestId) filtroEmprestimo['emprestimo.requestId'] = emprestimo.requestId;
    const liquidado = await CarteiraGrupo.findOneAndUpdate(
      filtroEmprestimo,
      {
        $set: {
          'emprestimo.ativo': false,
          'emprestimo.quitadoEm': new Date(),
          'emprestimo.proximoEmprestimo': new Date(Date.now() + EMPRESTIMO_CONFIG.cooldownMs),
        },
      },
      { new: true },
    );
    return liquidado ? { ...saldoAtualizado, emprestimo: liquidado.emprestimo } : null;
  }

  return CarteiraGrupo.findOneAndUpdate(
    { idWhatsApp: userId, idGrupo, 'emprestimo.ativo': true, gold: { $gte: divida } },
    {
      $inc: { gold: -divida },
      $set: {
        'emprestimo.ativo':             false,
        'emprestimo.quitadoEm':         new Date(),
        'emprestimo.proximoEmprestimo': new Date(Date.now() + EMPRESTIMO_CONFIG.cooldownMs),
      },
      $push: {
        goldHistory: {
          $each:  [{ type: 'gasto', item, amount: divida }],
          $slice: -50,
        },
      },
    },
    { new: true }
  );
}

// ─── Verificações exportáveis ────────────────────────────────────────────────

/**
 * Retorna `true` se o usuário possuir empréstimo ativo e vencido.
 * @param {string} userId
 * @param {string} idGrupo
 */
async function verificarInadimplente(userId, idGrupo) {
  if (!userId || !idGrupo) return false;
  try {
    const carteira = await getCarteira(userId, idGrupo);
    if (!carteira?.emprestimo?.ativo) return false;

    const vencimentoTs = new Date(carteira.emprestimo.vencimento).getTime();
    return !isNaN(vencimentoTs) && Date.now() > vencimentoTs;
  } catch (err) {
    console.error('[emprestimo] verificarInadimplente:', err);
    return false;
  }
}

/**
 * Se o usuário possuir saldo suficiente para quitar a dívida ativa,
 * desconta automaticamente e retorna a mensagem de confirmação.
 * Retorna `null` caso não haja dívida ou saldo insuficiente.
 * @param {string} userId
 * @param {string} idGrupo
 */
async function verificarDescontoAutomatico(userId, idGrupo) {
  if (!userId || !idGrupo) return null;
  try {
    const carteira = await getCarteira(userId, idGrupo);
    if (!carteira?.emprestimo?.ativo) return null;

    const divida = calcularDivida(carteira.emprestimo);

    // _quitarEmprestimo já valida `gold >= divida` na query (atômico)
    const atualizada = await _quitarEmprestimo(userId, idGrupo, divida, 'Quitação automática de empréstimo');
    if (!atualizada) return null;

    return MSGS.quitadoAutomatico(divida, carteira);
  } catch (err) {
    console.error('[emprestimo] verificarDescontoAutomatico:', err);
    return null;
  }
}

// ─── !emprestimo ──────────────────────────────────────────────────────────────

/**
 * Processa o comando `!emprestimo <valor> [prazo]`.
 */
async function handleEmprestimo(sock, msg, jid, caption) {
  const userId = await getUserId(msg, jid);
  if (!userId) {
    await enviarErro(sock, msg, jid, 'Não foi possível identificar seu usuário.');
    return;
  }
  const args = (caption || '').trim().split(/\s+/);

  // Exibe ajuda se não houver argumentos
  if (args.length < 2 || !args[1]) {
    await sock.sendMessage(jid, { text: MSGS.ajuda() }, { quoted: msg });
    return;
  }

  const valor    = parseInt(args[1], 10);
  const prazoArg = args[2] ? parseInt(args[2], 10) : 7;

  // Validações de entrada
  if (isNaN(valor) || valor <= 0) {
    await enviarErro(sock, msg, jid, 'Informe um valor numérico válido.');
    return;
  }

  if (!EMPRESTIMO_CONFIG.prazosDias.includes(prazoArg)) {
    await sock.sendMessage(jid, { text: MSGS.prazoInvalido() }, { quoted: msg });
    return;
  }

  if (valor < EMPRESTIMO_CONFIG.minValor) {
    await sock.sendMessage(jid, { text: MSGS.valorMinimo() }, { quoted: msg });
    return;
  }

  if (valor > EMPRESTIMO_CONFIG.maxValor) {
    await sock.sendMessage(jid, { text: MSGS.valorMaximo() }, { quoted: msg });
    return;
  }

  try {
    // 1. Inadimplência — bloqueia qualquer novo empréstimo
    const inadimplente = await verificarInadimplente(userId, jid);
    if (inadimplente) {
      await sock.sendMessage(jid, { text: MSGS.inadimplente() }, { quoted: msg });
      return;
    }

    // 2. Buscar nível e carteira em paralelo
    const carteira = await getCarteira(userId, jid);

    const level  = CarteiraGrupo.levelFromXp(carteira?.xp ?? 0);
    const limite = getLimitePorNivel(level);

    // 3. Cooldown pós-quitação
    if (carteira?.emprestimo?.proximoEmprestimo) {
      const liberacao = new Date(carteira.emprestimo.proximoEmprestimo).getTime();
      if (!isNaN(liberacao) && Date.now() < liberacao) {
        await sock.sendMessage(jid, {
          text: MSGS.cooldown(formatarTempo(liberacao - Date.now())),
        }, { quoted: msg });
        return;
      }
    }

    // 4. Empréstimo já ativo
    if (carteira?.emprestimo?.ativo) {
      if (carteira.currencyInfo && carteira.emprestimo.requestId) {
        await alterarGold(
          userId,
          jid,
          carteira.emprestimo.valor,
          `Empréstimo (${carteira.emprestimo.prazo} dias)`,
          carteira.emprestimo.requestId,
        );
      }
      const divida = calcularDivida(carteira.emprestimo);
      await sock.sendMessage(jid, { text: MSGS.emprestimoAtivo(divida, carteira) }, { quoted: msg });
      return;
    }

    // 5. Limite por nível
    if (valor > limite) {
      await sock.sendMessage(jid, { text: MSGS.limiteExcedido(level, limite, carteira) }, { quoted: msg });
      return;
    }

    // 6. Criar empréstimo
    const docCriado = await _criarEmprestimo(userId, jid, valor, prazoArg);
    if (!docCriado) {
      await sock.sendMessage(jid, { text: MSGS.emprestimoAtivo(valor, carteira) }, { quoted: msg });
      return;
    }

    const vencimento = new Date(Date.now() + prazoArg * MS_POR_DIA);
    const juros      = Math.floor(valor * EMPRESTIMO_CONFIG.jurosTaxa);
    const totalDever = valor + juros;

    await sock.sendMessage(jid, {
      text: MSGS.aprovado(valor, juros, totalDever, prazoArg, vencimento, docCriado),
    }, { quoted: msg });

  } catch (err) {
    console.error('[emprestimo] handleEmprestimo:', err);
    await enviarErro(sock, msg, jid, 'Ocorreu um erro ao processar o empréstimo. Tente novamente.');
  }
}

// ─── !pay emprestimo ──────────────────────────────────────────────────────────

/**
 * Processa o comando `!pay emprestimo`.
 */
async function handlePayEmprestimo(sock, msg, jid) {
  const userId = await getUserId(msg, jid);
  if (!userId) {
    await enviarErro(sock, msg, jid, 'Não foi possível identificar seu usuário.');
    return;
  }

  try {
    const carteira = await getCarteira(userId, jid);

    if (!carteira?.emprestimo?.ativo) {
      await sock.sendMessage(jid, { text: MSGS.semEmprestimo() }, { quoted: msg });
      return;
    }

    const divida     = calcularDivida(carteira.emprestimo);
    const saldoAtual = carteira.gold ?? 0;

    if (saldoAtual < divida) {
      await sock.sendMessage(jid, { text: MSGS.saldoInsuficiente(saldoAtual, divida, carteira) }, { quoted: msg });
      return;
    }

    // Quitação atômica — condição `ativo: true` + `gold >= divida` na query
    const atualizada = await _quitarEmprestimo(userId, jid, divida);

    if (!atualizada) {
      // Só ocorre se houve corrida de requisições e outro processo quitou antes
      await sock.sendMessage(jid, { text: MSGS.semEmprestimo() }, { quoted: msg });
      return;
    }

    await sock.sendMessage(jid, {
      text: MSGS.quitado(divida, atualizada.gold, atualizada),
    }, { quoted: msg });

  } catch (err) {
    console.error('[emprestimo] handlePayEmprestimo:', err);
    await enviarErro(sock, msg, jid, 'Ocorreu um erro ao quitar o empréstimo. Tente novamente.');
  }
}

// ─── !divida ──────────────────────────────────────────────────────────────────

/**
 * Exibe a situação atual do empréstimo ativo do usuário.
 */
async function handleDivida(sock, msg, jid) {
  const userId = await getUserId(msg, jid);
  if (!userId) {
    await enviarErro(sock, msg, jid, 'Não foi possível identificar seu usuário.');
    return;
  }

  try {
    const carteira = await getCarteira(userId, jid);

    if (!carteira?.emprestimo?.ativo) {
      await sock.sendMessage(jid, { text: MSGS.semDividas() }, { quoted: msg });
      return;
    }

    const emp           = carteira.emprestimo;
    const agora         = Date.now();
    const vencimentoTs  = new Date(emp.vencimento).getTime();
    const divida        = calcularDivida(emp);
    const atrasado      = agora > vencimentoTs;
    const diasAtraso    = atrasado ? Math.ceil((agora - vencimentoTs) / MS_POR_DIA) : 0;
    const tempoRestante = atrasado ? null : formatarTempo(vencimentoTs - agora);

    await sock.sendMessage(jid, {
      text: MSGS.situacao(emp, divida, atrasado, diasAtraso, tempoRestante, carteira.gold ?? 0, carteira),
    }, { quoted: msg });

  } catch (err) {
    console.error('[emprestimo] handleDivida:', err);
    await enviarErro(sock, msg, jid, 'Não foi possível consultar sua dívida. Tente novamente.');
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  handleEmprestimo,
  handlePayEmprestimo,
  handleDivida,
  verificarInadimplente,
  verificarDescontoAutomatico,
};