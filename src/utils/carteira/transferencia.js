'use strict';

const mongoose = require('mongoose');
const { alterarGold } = require('./prata');
const { sameWhatsAppIdentity } = require('../identity');
const { logError } = require('../logging');

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
    if (session) {
      // O fechamento da sessão não pode sobrescrever um resultado já confirmado
      // pelo MongoDB nem mascarar a exceção original da transação.
      try {
        await session.endSession();
      } catch (closeError) {
        console.warn('[transferirGold] Falha ao encerrar sessão do MongoDB:', closeError?.stack || closeError?.message || closeError);
      }
    }
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
      logError(
        'transferirGold',
        err,
        `Falha no crédito de ${val} prata para ${formatarReferenciaHistorico(paraIdWhatsApp)} (erro original)`
      );
      logError(
        'transferirGold',
        estornoErr,
        `FALHA CRÍTICA: débito de ${val} prata de ${formatarReferenciaHistorico(deIdWhatsApp)} não pôde ser estornado`
      );
      const erroCritico = new Error('A transferência falhou e o estorno do débito também falhou. É necessária conferência administrativa.', { cause: err });
      erroCritico.code = 'TRANSFER_REFUND_FAILED';
      erroCritico.refundError = estornoErr;
      throw erroCritico;
    }
    throw err;
  }
}

module.exports = { transferirGold, formatarReferenciaHistorico };