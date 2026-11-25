'use strict';

const { somenteGrupo, checkAdmin } = require('./helpers');

function obterTextoComando(content, msg) {
  return (
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    content?.imageMessage?.caption ||
    content?.videoMessage?.caption ||
    msg?.message?.conversation ||
    msg?.message?.extendedTextMessage?.text ||
    ''
  ).trim();
}

async function processarSolicitacoesEntrada(sock, msg, content, jid, acao) {
  const comando = acao === 'approve' ? 'aceitar' : 'recusar';

  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, {
      text: '⚠️ Este comando só funciona em grupos.',
    }, { quoted: msg });
    return;
  }

  if (!await checkAdmin(sock, msg, jid, comando)) return;

  const partes = obterTextoComando(content, msg).split(/\s+/).filter(Boolean);
  const argumentos = partes.slice(1);
  const exemploComando = partes[0] || `/${comando}`;

  if (argumentos.length > 1 || (argumentos.length === 1 && !/^\d+$/.test(argumentos[0]))) {
    await sock.sendMessage(jid, {
      text: `⚠️ Informe apenas uma quantidade inteira positiva.\nExemplo: *${exemploComando} 5*\nSem quantidade, o comando processa todos os pedidos pendentes.`,
    }, { quoted: msg });
    return;
  }

  const quantidade = argumentos.length === 1 ? Number(argumentos[0]) : null;
  if (quantidade !== null && (!Number.isSafeInteger(quantidade) || quantidade <= 0)) {
    await sock.sendMessage(jid, {
      text: '⚠️ A quantidade deve ser um número inteiro maior que zero.',
    }, { quoted: msg });
    return;
  }

  if (typeof sock.groupRequestParticipantsList !== 'function' ||
      typeof sock.groupRequestParticipantsUpdate !== 'function') {
    await sock.sendMessage(jid, {
      text: '❌ Esta versão do WhatsApp não disponibiliza o gerenciamento de pedidos de entrada.',
    }, { quoted: msg });
    return;
  }

  try {
    const pedidos = await sock.groupRequestParticipantsList(jid);
    const solicitantes = [...new Set(
      (Array.isArray(pedidos) ? pedidos : [])
        .map(pedido => pedido?.jid)
        .filter(participantJid => typeof participantJid === 'string' && participantJid.includes('@'))
    )];

    if (solicitantes.length === 0) {
      await sock.sendMessage(jid, {
        text: 'ℹ️ Não há solicitações pendentes para entrar neste grupo.',
      }, { quoted: msg });
      return;
    }

    if (quantidade !== null && quantidade > solicitantes.length) {
      await sock.sendMessage(jid, {
        text: `⚠️ Você solicitou ${quantidade}, mas há apenas *${solicitantes.length}* solicitação(ões) pendente(s).\n_Nenhuma ação foi realizada._`,
      }, { quoted: msg });
      return;
    }

    const totalSolicitacoes = quantidade ?? solicitantes.length;
    const selecionados = solicitantes.slice(0, totalSolicitacoes);
    const resultados = await sock.groupRequestParticipantsUpdate(jid, selecionados, acao);
    const processados = Array.isArray(resultados)
      ? resultados.filter(resultado => Number(resultado?.status) === 200).length
      : 0;
    const falhas = Math.max(0, selecionados.length - processados);

    const substantivo = processados === 1 ? 'solicitação' : 'solicitações';
    const resultadoVerbo = acao === 'approve'
      ? (processados === 1 ? 'aceita' : 'aceitas')
      : (processados === 1 ? 'recusada' : 'recusadas');
    const escopo = quantidade === null ? ' (todos os pedidos pendentes)' : '';
    const textoResultado =
      `${acao === 'approve' ? '✅' : '🚫'} *${processados} ${substantivo} ${resultadoVerbo} com sucesso!${escopo}*` +
      (falhas
        ? `\n⚠️ Não foi possível processar: *${falhas}*. Alguns pedidos podem ter sido cancelados ou alterados durante a operação.`
        : '');

    await sock.sendMessage(jid, { text: textoResultado }, { quoted: msg });
  } catch (err) {
    console.error(`[Solicitações de entrada/${comando}] Erro:`, err.message);
    await sock.sendMessage(jid, {
      text: `❌ Não consegui ${acao === 'approve' ? 'aceitar' : 'recusar'} as solicitações. Verifique se o *Tico Bot é administrador* do grupo e se os pedidos ainda estão pendentes.`,
    }, { quoted: msg });
  }
}

async function handleAceitar(sock, msg, content, jid) {
  return processarSolicitacoesEntrada(sock, msg, content, jid, 'approve');
}

async function handleRecusar(sock, msg, content, jid) {
  return processarSolicitacoesEntrada(sock, msg, content, jid, 'reject');
}

module.exports = {
  handleAceitar,
  handleRecusar,
};
