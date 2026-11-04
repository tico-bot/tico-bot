'use strict';

const path = require('path');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { getCarteira, transferirGold, formatarSaldo } = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira'));
const { resolveUserFromMsg, resolveGlobalId, extrairNumero, getAlternateSenderJids, getParticipantJids, sameWhatsAppIdentity } = require(path.join(__dirname, '..', '..', '..', 'utils', 'identity'));
const Usuario = require(path.join(__dirname, '..', '..', '..', 'models', 'Usuario'));
const { LOOKUP_ITENS_LOJA, normalizarChaveItem } = require('./_shared');
const { ITENS_LOJA } = require(path.join(__dirname, '..', '..', '..', 'config', 'economia'));
const { logError } = require(path.join(__dirname, '..', '..', '..', 'utils', 'logging'));

function mensagemErroTransferencia(error) {
  if (error?.code === 'TRANSFER_REFUND_FAILED') {
    return '🚨 A transferência encontrou uma falha e não foi possível confirmar o estorno. Não tente repetir a operação; procure um administrador para conferir os saldos.';
  }
  if (error?.code === 'LINKED_UNLINKED_TRANSFER_NOT_ALLOWED') {
    return '❌ A transferência não foi realizada: contas não vinculadas ao app não podem enviar para contas vinculadas. Vincule a sua conta ao app para enviar.';
  }
  if (error?.code === 'LINKED_TRANSFER_RECIPIENT_NOT_LINKED') {
    return '❌ A transferência não foi realizada: o destinatário precisa vincular a conta ao app primeiro.';
  }
  if (error?.code === 'VALOR_MINIMO_CONVERSAO') {
    return '❌ O valor é pequeno demais para ser convertido na moeda da conta. Tente uma quantia maior.';
  }
  return null;
}

function getNumeroPuro(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0];
}

// Mantém a doação anónima: só o destinatário é mencionado na confirmação.
function obterStatusPixMulti(enviados, falhas) {
  if (falhas <= 0) return 'success';
  return enviados > 0 ? 'partial' : 'failed';
}

function criarMensagemConfirmacaoDoacao({ quantia, resultado, destinatarioJid }) {
  const numeroDestinatario = getNumeroPuro(destinatarioJid);
  const carteiraRemetente = resultado?.de;
  return {
    text:
      `🎉 *DOAÇÃO ANÔNIMA DE PRATA!* 🎉\n\n` +
      `🎁 Um membro do grupo doou *${formatarSaldo(quantia, carteiraRemetente)}* para *@${numeroDestinatario}*!\n\n` +
      `💰 Novo saldo do doador: *${formatarSaldo(carteiraRemetente?.gold ?? 0, carteiraRemetente)}*`,
    mentions: destinatarioJid ? [destinatarioJid] : [],
  };
}

/**
 * Extrai { targetJid, numeroPura, quantia } do contexto da mensagem.
 * Suporta menções (@pessoa quantia / quantia @pessoa), respostas (reply) e número direto.
 */
function parsearPix(msg, caption) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const mentionedJid = ctx?.mentionedJid?.[0];
  const quotedParticipant = ctx?.participant;

  // 1. Caso haja menção explícita (@fulano)
  if (mentionedJid) {
    const targetJid = jidNormalizedUser(mentionedJid);
    const parts     = caption.trim().split(/\s+/).map(p => p.replace(/[^\d]/g, ''));
    const numbers   = parts.filter(p => p.length > 0 && !isNaN(parseInt(p, 10)));

    let quantia = 0;
    for (const numStr of numbers) {
      const parsed = parseInt(numStr, 10);
      if (parsed > 0 && numStr !== targetJid.split('@')[0].replace(/\D/g, '')) {
        quantia = parsed;
        break;
      }
    }

    if (quantia > 0) {
      return {
        targetJid,
        numeroPura: getNumeroPuro(targetJid),
        quantia,
      };
    }
  }

  // 2. Caso seja resposta a uma mensagem (reply)
  if (quotedParticipant) {
    const targetJid = jidNormalizedUser(quotedParticipant);
    const parts     = caption.trim().split(/\s+/);
    let quantia     = 0;
    for (const p of parts) {
      const num = parseInt(p.replace(/\D/g, ''), 10);
      if (!isNaN(num) && num > 0) {
        quantia = num;
        break;
      }
    }

    if (quantia > 0) {
      return {
        targetJid,
        numeroPura: getNumeroPuro(targetJid),
        quantia,
      };
    }
  }

  // 3. Caso seja número por extenso (!pix 5511999999999 50 ou !pix @5511999999999 50)
  const numMatch = caption.match(/(?:pix|transferir)\s+@?(\d{8,15})\s+(\d+)/i) ||
                   caption.match(/(?:pix|transferir)\s+(\d+)\s+@?(\d{8,15})/i);
  if (numMatch) {
    let numeroPura, quantia;
    if (numMatch[1].length >= 8) {
      numeroPura = numMatch[1].replace(/\D/g, '');
      quantia    = parseInt(numMatch[2], 10);
    } else {
      quantia    = parseInt(numMatch[1], 10);
      numeroPura = numMatch[2].replace(/\D/g, '');
    }

    if (numeroPura && !isNaN(quantia) && quantia > 0) {
      return {
        targetJid:  `${numeroPura}@s.whatsapp.net`,
        numeroPura,
        quantia,
      };
    }
  }

  return null;
}

// !pix
async function handlePix(sock, msg, jid, caption) {
  const userId = jidNormalizedUser(resolveUserFromMsg(msg));
  const parsed = parsearPix(msg, caption);

  if (!parsed) {
    await sock.sendMessage(jid, {
      text:
        `⚠️ *COMO USAR O PIX:*\n\n` +
        `• Marcação: *!pix @pessoa quantia*\n` +
        `• Resposta: *!pix quantia* (respondendo à mensagem)\n` +
        `• Exemplo: *!pix @Felipe 30*`,
    }, { quoted: msg });
    return;
  }

  const { targetJid, numeroPura, quantia } = parsed;

  if (await sameWhatsAppIdentity(userId, targetJid, sock, getAlternateSenderJids(msg), [])) {
    await sock.sendMessage(jid, {
      text: '⚠️ Você não pode fazer PIX para si mesmo!',
    }, { quoted: msg });
    return;
  }

  let resultado;
  try {
    resultado = await transferirGold(
      userId,
      targetJid,
      jid,
      quantia,
      'PIX'
    );
  } catch (e) {
    if (e instanceof RangeError) {
      const carteiraRemetente = await getCarteira(userId, jid);
      const saldo = carteiraRemetente?.gold ?? 0;
      await sock.sendMessage(jid, {
        text:
          `⚠️ *SALDO INSUFICIENTE!*\n\n` +
          `💰 Você tem: *${formatarSaldo(saldo, carteiraRemetente)}*\n` +
          `💸 Precisa de: *${formatarSaldo(quantia, carteiraRemetente)}*`,
      }, { quoted: msg });
      return;
    }
    const mensagem = mensagemErroTransferencia(e);
    if (mensagem) {
      await sock.sendMessage(jid, { text: mensagem }, { quoted: msg });
      return;
    }
    logError('handlePix', e, `PIX recusado/falhou (code=${e?.code || '-'} name=${e?.name || 'Error'})`);
    await sock.sendMessage(jid, {
      text: '❌ Não consegui concluir o PIX agora. Tente novamente em instantes e confira seu saldo com *!prata*.',
    }, { quoted: msg });
    return;
  }

  const saldoFinalRemetente = resultado?.de?.gold ?? 0;

  await sock.sendMessage(jid, {
    text:
      `✅ *TRANSFERÊNCIA REALIZADA!* ✅\n\n` +
      `💸 *${formatarSaldo(quantia, resultado.de)}* enviado para *@${numeroPura}*\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `💰 Seu novo saldo: *${formatarSaldo(saldoFinalRemetente, resultado.de)}*`,
    mentions: [targetJid, userId],
  }, { quoted: msg });
}

// !pixmulti @alvo1 @alvo2 quantia
async function handlePixMulti(sock, msg, jid, caption) {
  const userId = jidNormalizedUser(resolveUserFromMsg(msg));
  const ctx    = msg.message?.extendedTextMessage?.contextInfo;
  const mentions = ctx?.mentionedJid || [];

  if (mentions.length === 0) {
    await sock.sendMessage(jid, {
      text: '⚠️ Marque pelo menos uma pessoa e informe a quantia!\nExemplo: *!pixmulti @membro1 @membro2 50*',
    }, { quoted: msg });
    return;
  }

  const parts = caption.trim().split(/\s+/);
  const quantiaPorPessoa = parseInt(parts[parts.length - 1], 10);
  if (isNaN(quantiaPorPessoa) || quantiaPorPessoa <= 0) {
    await sock.sendMessage(jid, {
      text: '⚠️ Informe uma quantia válida por pessoa no final do comando.\nExemplo: *!pixmulti @membro1 @membro2 50*',
    }, { quoted: msg });
    return;
  }

  const targets = [];
  const senderAliases = getAlternateSenderJids(msg);
  for (const mention of mentions) {
    const target = jidNormalizedUser(mention);
    if (!target) continue;
    if (await sameWhatsAppIdentity(target, userId, sock, [], senderAliases)) continue;
    let duplicado = false;
    for (const existente of targets) {
      if (await sameWhatsAppIdentity(target, existente, sock)) {
        duplicado = true;
        break;
      }
    }
    if (!duplicado) targets.push(target);
  }

  if (targets.length === 0) {
    await sock.sendMessage(jid, { text: '⚠️ Nenhum destinatário válido selecionado.' }, { quoted: msg });
    return;
  }

  const totalNecessario = quantiaPorPessoa * targets.length;
  const carteiraRemetente = await getCarteira(userId, jid);
  const saldoAtual = carteiraRemetente?.gold ?? 0;

  if (saldoAtual < totalNecessario) {
    await sock.sendMessage(jid, {
      text:
        `⚠️ *SALDO INSUFICIENTE PARA PIX MÚLTIPLO!*\n\n` +
        `👥 Alvos: *${targets.length}* pessoas (${formatarSaldo(quantiaPorPessoa, carteiraRemetente)}/cada)\n` +
        `💸 Total necessário: *${formatarSaldo(totalNecessario, carteiraRemetente)}*\n` +
        `💰 Seu saldo: *${formatarSaldo(saldoAtual, carteiraRemetente)}*`,
    }, { quoted: msg });
    return;
  }

  let enviados = 0;
  let falhas = 0;
  let transferenciasRestritas = false;
  const mentionsList = [userId];

  for (const target of targets) {
    try {
      await transferirGold(userId, target, jid, quantiaPorPessoa, 'PIX Múltiplo');
      enviados++;
      mentionsList.push(target);
    } catch (e) {
      logError('handlePixMulti', e, 'Falha ao transferir para um destinatário');
      falhas++;
      if (e?.code === 'LINKED_UNLINKED_TRANSFER_NOT_ALLOWED'
          || e?.code === 'LINKED_TRANSFER_RECIPIENT_NOT_LINKED') {
        transferenciasRestritas = true;
      }
    }
  }

  const carteiraFinal = await getCarteira(userId, jid);

  await sock.sendMessage(jid, {
    text:
      `${obterStatusPixMulti(enviados, falhas) === 'success' ? '✅ *PIX MÚLTIPLO CONCLUÍDO!*' : obterStatusPixMulti(enviados, falhas) === 'partial' ? '⚠️ *PIX MÚLTIPLO PARCIALMENTE CONCLUÍDO*' : '❌ *PIX MÚLTIPLO NÃO CONCLUÍDO*'}\n\n` +
      `🎁 *${enviados}* pessoa(s) receberam *${quantiaPorPessoa} Prata* cada!\n` +
      `💸 Total distribuído: *${enviados * quantiaPorPessoa} Prata*\n` +
      `💰 Seu novo saldo: *${carteiraFinal?.gold ?? 0}* Prata` +
      (falhas > 0 ? `\n\n⚠️ ${falhas} transferência(s) não foram concluídas.` : '') +
      (transferenciasRestritas ? '\nAlgumas transferências exigiam que ambas as contas estivessem vinculadas ao app.' : ''),
    mentions: mentionsList,
  }, { quoted: msg });
}

// !doarprata quantia (alias legado: !pixdoar)
async function handlePixDoar(sock, msg, jid, caption) {
  let etapa = 'preparar comando';
  let transferenciaConcluida = false;
  let quantia = null;

  try {
    const userId = jidNormalizedUser(resolveUserFromMsg(msg));
    const parts = String(caption || '').trim().split(/\s+/);
    const valorInformado = parts[1] || '';
    quantia = /^\d+$/.test(valorInformado) ? Number(valorInformado) : NaN;

    if (!Number.isSafeInteger(quantia) || quantia <= 0) {
      await sock.sendMessage(jid, {
        text: '⚠️ Informe uma quantia inteira e válida que deseja doar!\nExemplo: *!doarprata 100*',
      }, { quoted: msg });
      return;
    }

    if (!jid?.endsWith('@g.us')) {
      await sock.sendMessage(jid, { text: '⚠️ O comando !doarprata só funciona em grupos.' }, { quoted: msg });
      return;
    }

    etapa = 'consultar metadados do grupo';
    const groupMeta = await sock.groupMetadata(jid);

    const botIdentidades = getParticipantJids(sock.user);
    const senderAliases = getAlternateSenderJids(msg);
    const participantes = [];

    etapa = 'identificar membros elegíveis';
    for (const participante of groupMeta.participants || []) {
      const aliasesParticipante = getParticipantJids(participante);
      const participanteJid = aliasesParticipante[0];
      if (!participanteJid) continue;

      const ehRemetente = await sameWhatsAppIdentity(
        participanteJid, userId, sock, aliasesParticipante, senderAliases
      );
      const ehBot = botIdentidades.length
        ? await sameWhatsAppIdentity(
            participanteJid,
            botIdentidades[0],
            sock,
            aliasesParticipante,
            botIdentidades.slice(1)
          )
        : false;

      if (!ehRemetente && !ehBot) participantes.push(participanteJid);
    }

    if (participantes.length === 0) {
      await sock.sendMessage(jid, { text: '⚠️ Nenhum membro elegível para receber a doação.' }, { quoted: msg });
      return;
    }

    const sorteado = participantes[Math.floor(Math.random() * participantes.length)];

    etapa = 'transferir prata';
    let resultado;
    try {
      resultado = await transferirGold(userId, sorteado, jid, quantia, 'Doação de Prata');
      transferenciaConcluida = true;
    } catch (error) {
      if (error instanceof RangeError) {
        await sock.sendMessage(jid, {
          text: `⚠️ Você não possui *${formatarSaldo(quantia)}* suficientes para doar.`,
        }, { quoted: msg });
        return;
      }

      const mensagem = mensagemErroTransferencia(error);
      if (mensagem) {
        await sock.sendMessage(jid, { text: mensagem }, { quoted: msg });
        return;
      }

      throw error;
    }

    // Não revela o remetente e não informa falha financeira se a transferência
    // já foi confirmada, evitando induzir uma segunda doação.
    etapa = 'enviar confirmação da doação';
    try {
      await sock.sendMessage(jid, criarMensagemConfirmacaoDoacao({
        quantia,
        resultado,
        destinatarioJid: sorteado,
      }), { quoted: msg });
    } catch (error) {
      logError('handlePixDoar', error, 'Doação concluída, mas a confirmação não pôde ser enviada');
      try {
        await sock.sendMessage(jid, {
          text: '✅ A doação foi processada, mas não consegui enviar a confirmação. Confira seu saldo com *!prata* antes de tentar novamente.',
        }, { quoted: msg });
      } catch (notifyError) {
        logError('handlePixDoar', notifyError, 'Também falhou a notificação de confirmação');
      }
    }
  } catch (error) {
    if (transferenciaConcluida) {
      logError('handlePixDoar', error, `Doação já concluída; falha posterior na etapa "${etapa}"`);
      return;
    }

    logError('handlePixDoar', error, `Falha na etapa "${etapa}"`);

    const textoErro = etapa === 'consultar metadados do grupo'
      ? '❌ Não consegui buscar a lista de membros do grupo.'
      : '❌ Ocorreu um erro ao realizar a doação. Tente novamente em instantes.';

    try {
      await sock.sendMessage(jid, { text: textoErro }, { quoted: msg });
    } catch (notifyError) {
      logError('handlePixDoar', notifyError, 'Falha ao avisar o usuário sobre o erro');
    }
  }
}

// !give [@pessoa | reply] [quantidade] <item>
async function handleGive(sock, msg, jid, caption) {
  const userId = jidNormalizedUser(resolveUserFromMsg(msg));
  const ctx    = msg.message?.extendedTextMessage?.contextInfo;

  let targetNorm = ctx?.mentionedJid?.[0]
    ? jidNormalizedUser(ctx.mentionedJid[0])
    : (ctx?.participant ? jidNormalizedUser(ctx.participant) : null);

  if (!targetNorm) {
    await sock.sendMessage(jid, {
      text:
        `⚠️ *COMO DAR ITENS:*\n\n` +
        `• Com menção: *!give @fulano pizza*\n` +
        `• Com quantidade: *!give @fulano 3 pizza*\n` +
        `• Com resposta: *!give 2 pizza* (respondendo à mensagem)`,
    }, { quoted: msg });
    return;
  }

  if (await sameWhatsAppIdentity(targetNorm, userId, sock, [], getAlternateSenderJids(msg))) {
    await sock.sendMessage(jid, {
      text: '😂 Você não pode dar item pra si mesmo!',
    }, { quoted: msg });
    return;
  }

  // Remove menção e comando da caption pra isolar [quantidade] [item]
  const textoLimpo = caption
    .replace(/^[!.,\/#]give\s*/i, '')
    .replace(/@\d+\b/gi, '')
    .trim();

  const parts = textoLimpo.split(/\s+/);
  let quantidade = 1;
  let itemDigitado = textoLimpo;

  if (parts.length > 1 && !isNaN(parseInt(parts[0], 10))) {
    quantidade = parseInt(parts[0], 10);
    itemDigitado = parts.slice(1).join(' ').trim();
  }

  if (isNaN(quantidade) || quantidade <= 0) quantidade = 1;

  const itemKey  = LOOKUP_ITENS_LOJA[normalizarChaveItem(itemDigitado)] || null;
  const itemInfo = itemKey ? ITENS_LOJA[itemKey] : null;

  if (!itemInfo) {
    await sock.sendMessage(jid, {
      text:
        `⚠️ Item *${itemDigitado}* não existe!\n\n` +
        `Use *!loja* pra ver os itens disponíveis.`,
    }, { quoted: msg });
    return;
  }

  const remetente = await Usuario.findOne({ idWhatsApp: userId }).select('inventory').lean();
  const qtdPossuida = remetente?.inventory?.[itemKey] ?? 0;

  if (qtdPossuida < quantidade) {
    await sock.sendMessage(jid, {
      text:
        `⚠️ Você não possui *${quantidade}x ${itemInfo.nome}* no inventário!\n\n` +
        `🎒 Você possui: *${qtdPossuida}x*\n` +
        `Use *!inventario* pra ver seus itens ou *!buy ${itemKey}* pra comprar.`,
    }, { quoted: msg });
    return;
  }

  const remetenteAtualizado = await Usuario.findOneAndUpdate(
    { idWhatsApp: userId, [`inventory.${itemKey}`]: { $gte: quantidade } },
    { $inc: { [`inventory.${itemKey}`]: -quantidade } }
  );

  if (!remetenteAtualizado) {
    await sock.sendMessage(jid, {
      text: `⚠️ *${itemInfo.nome}* não estava mais disponível no seu inventário. Tente novamente.`,
    }, { quoted: msg });
    return;
  }

  await Usuario.findOneAndUpdate(
    { idWhatsApp: targetNorm },
    { $inc: { [`inventory.${itemKey}`]: quantidade } },
    { upsert: true }
  );

  const numeroAlvo = getNumeroPuro(targetNorm);

  await sock.sendMessage(jid, {
    text:
      `🎁 *PRESENTE ENVIADO!* 🎁\n\n` +
      `📦 Item: *${quantidade}x ${itemInfo.nome}*\n` +
      `➡️ Para: *@${numeroAlvo}*\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `_Use !inventario pra conferir seus itens._`,
    mentions: [targetNorm],
  }, { quoted: msg });
}

module.exports = {
  handlePix,
  handlePixMulti,
  handlePixDoar,
  criarMensagemConfirmacaoDoacao,
  obterStatusPixMulti,
  handleGive,
};
