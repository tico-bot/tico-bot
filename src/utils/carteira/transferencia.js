'use strict';

const mongoose = require('mongoose');
const { alterarGold } = require('./prata');
const { sameWhatsAppIdentity } = require('../identity');

function getJidBase(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0];
}

// Preserva o domínio PN/LID no histórico para que o /extrato resolva a pessoa correta.
function formatarReferenciaHistorico(jid) {
  const base = getJidBase(jid);
  if (!base) return '@desconhecido';
  const dominio = String(jid || '').split('@').at(-1).toLowerCase();
  return ['s.whatsapp.net', 'lid'].includes(dominio)
    ? `@${base}@${dominio}`
    : `@${base}`;
}

function erroComCodigo(mensagem, code, Tipo = Error) {
  const erro = new Tipo(mensagem);
  erro.code = code;
  return erro;
}

async function transferirGold(deIdWhatsApp, paraIdWhatsApp, idGrupo, valor, descricao = 'transferência') {
  const val = Math.floor(Number(valor));
  if (!Number.isSafeInteger(val) || val <= 0) {
    throw new RangeError('transferirGold: valor deve ser um número inteiro positivo.');
  }

  if (await sameWhatsAppIdentity(deIdWhatsApp, paraIdWhatsApp)) {
    throw new Error('transferirGold: remetente e destinatário são o mesmo usuário.');
  }

  const label = (descricao || 'transferência').trim();
  const descricaoDebito = `${label} para ${formatarReferenciaHistorico(paraIdWhatsApp)}`;
  const descricaoCredito = `${label} de ${formatarReferenciaHistorico(deIdWhatsApp)}`;

  // Em replica set, débito e crédito são confirmados juntos no MongoDB.
  let session;
  try {
    session = await mongoose.startSession();
    let carteiraDE;
    let carteiraPARA;
    await session.withTransaction(async () => {
      carteiraDE = await alterarGold(deIdWhatsApp, idGrupo, -val, descricaoDebito, { session });
      carteiraPARA = await alterarGold(paraIdWhatsApp, idGrupo, val, descricaoCredito, { session });
    });
    return { de: carteiraDE, para: carteiraPARA };
  } catch (err) {
    if (!/replica set|standalone|Transaction numbers|does not support transactions/i.test(err.message || '')) {
      throw err;
    }
  } finally {
    if (session) await session.endSession();
  }

  // MongoDB standalone não suporta transações multi-documento; mantém o fluxo
  // local ao Mongo e compensa o débito se o crédito falhar.
  const carteiraDE = await alterarGold(deIdWhatsApp, idGrupo, -val, descricaoDebito);
  try {
    const carteiraPARA = await alterarGold(paraIdWhatsApp, idGrupo, val, descricaoCredito);
    return { de: carteiraDE, para: carteiraPARA };
  } catch (err) {
    try {
      await alterarGold(deIdWhatsApp, idGrupo, val, `estorno: falha ao transferir para ${formatarReferenciaHistorico(paraIdWhatsApp)}`);
    } catch (estornoErr) {
      console.error(`❌ FALHA CRÍTICA: débito de ${val} gold de ${deIdWhatsApp} não pôde ser estornado. Motivo original: ${err.message} | Motivo do estorno: ${estornoErr.message}`);
    }
    throw err;
  }
}

module.exports = { transferirGold, formatarReferenciaHistorico };