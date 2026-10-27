'use strict';

// ─── Sistema de Saque entre Jogadores Derrotados ─────────────────────────────

const mongoose           = require('mongoose');
const MedievalPersonagem = require('../../models/MedievalPersonagem');
const CarteiraGrupo      = require('../../models/CarteiraGrupo');
const {
  ARMADURAS, getArma,
  somenteGrupo, getModoAtivo, verificarRecuperacaoDerrota, JANELA_SAQUE_MS,
  getInventarioMap, itemKeyParaNome, bloqueadoPorVinculo,
} = require('../../utils/medievalUtils');
const { getCarteira, formatarSaldo, transferirGold } = require('../../utils/carteira');

const RESPOSTA_TIMEOUT_MS = 60 * 1000;

// Map<"idGrupo:vencedorJid", { idGrupo, perdedorJid, opcoes, criadoEm, emProcessamento }>
const saqueState = new Map();

function chaveSaque(idGrupo, vencedorJid) {
  return `${idGrupo}:${vencedorJid}`;
}

function limparEstado(idGrupo, vencedorJid) {
  saqueState.delete(chaveSaque(idGrupo, vencedorJid));
}

// ── Limpeza periódica de estados esquecidos ──────────────────────────────────
if (!global._saqueCleanupAtivo) {
  global._saqueCleanupAtivo = true;
  setInterval(() => {
    const agora = Date.now();
    for (const [chave, estado] of saqueState.entries()) {
      if (agora - estado.criadoEm > RESPOSTA_TIMEOUT_MS) saqueState.delete(chave);
    }
  }, 5 * 60 * 1000);
}

// ─── !saquear @perdedor ──────────────────────────────────────────────────────

async function handleSaquear(sock, msg, jid, senderJid, targetJid) {
  if (!somenteGrupo(jid)) return;

  try {
    if (!await getModoAtivo(jid)) {
      return sock.sendMessage(jid, { text: '⚔️ O modo medieval não está ativo!' }, { quoted: msg });
    }
    if (!targetJid) {
      return sock.sendMessage(jid, { text: '💰 Marque o jogador que você derrotou!\nExemplo: *!saquear @fulano*' }, { quoted: msg });
    }
    if (targetJid === senderJid) {
      return sock.sendMessage(jid, { text: '😂 Você não pode saquear a si mesmo!' }, { quoted: msg });
    }
    const perdedor = await MedievalPersonagem.findOne({ idWhatsApp: targetJid, idGrupo: jid });
    if (!perdedor) {
      return sock.sendMessage(jid, { text: '❌ Esse jogador não tem personagem medieval.' }, { quoted: msg });
    }

    await verificarRecuperacaoDerrota(perdedor);

    if (!perdedor.derrotadoEm) {
      return sock.sendMessage(jid, {
        text: `❌ *${perdedor.nome || targetJid.split('@')[0]}* não está derrotado no momento (ou a janela já passou).`,
        mentions: [targetJid],
      }, { quoted: msg });
    }

    const passouMs = Date.now() - new Date(perdedor.derrotadoEm).getTime();
    if (passouMs >= JANELA_SAQUE_MS) {
      return sock.sendMessage(jid, {
        text: `⏳ A janela de *3 minutos* pra saquear *${perdedor.nome || targetJid.split('@')[0]}* já expirou!`,
        mentions: [targetJid],
      }, { quoted: msg });
    }

    const carteiraPerdedor = await getCarteira(targetJid, jid);
    const gold = carteiraPerdedor?.gold || 0;

    const invMap = getInventarioMap(perdedor);

    const opcoes = [];
    if (gold > 0) {
      opcoes.push({ tipo: 'gold', valor: gold, label: `💰 ${formatarSaldo(gold, carteiraPerdedor)}` });
    }

    const nomesNoInventario = new Set();
    for (const [chave, qtd] of invMap.entries()) {
      if (qtd <= 0) continue;
      const nome = itemKeyParaNome(chave);
      nomesNoInventario.add(nome);
      const tagEquipado = (perdedor.armaEquipada === nome || perdedor.armaduraEquipada === nome)
        ? ' (equipada)' : '';
      opcoes.push({ tipo: 'item', chave, nome, qtd, label: `📦 ${nome} x${qtd}${tagEquipado}` });
    }

    if (perdedor.armaEquipada && !nomesNoInventario.has(perdedor.armaEquipada)) {
      opcoes.push({ tipo: 'arma', nome: perdedor.armaEquipada, label: `⚔️ ${perdedor.armaEquipada} (equipada)` });
    }
    if (perdedor.armaduraEquipada && !nomesNoInventario.has(perdedor.armaduraEquipada)) {
      opcoes.push({ tipo: 'armadura', nome: perdedor.armaduraEquipada, label: `🛡️ ${perdedor.armaduraEquipada} (equipada)` });
    }

    if (!opcoes.length) {
      return sock.sendMessage(jid, {
        text: `💨 *${perdedor.nome || targetJid.split('@')[0]}* não tem nada pra saquear agora!`,
        mentions: [targetJid],
      }, { quoted: msg });
    }

    saqueState.set(chaveSaque(jid, senderJid), {
      idGrupo: jid, perdedorJid: targetJid, opcoes, criadoEm: Date.now(), emProcessamento: false,
    });

    const listaTexto = opcoes.map((o, i) => `*${i}* — ${o.label}`).join('\n');

    await sock.sendMessage(jid, {
      text:
        `💰 *SAQUE — ${perdedor.nome || targetJid.split('@')[0]}* 💰\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `${listaTexto}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `_Responda com os números do que quer levar, separados por espaço._\n` +
        `_Exemplo: *0 2 3*_\n\n` +
        `⏳ Você tem *60 segundos* para responder.`,
      mentions: [targetJid],
    }, { quoted: msg });

  } catch (err) {
    console.error('⚠️ Erro em handleSaquear:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao iniciar o saque. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── Resposta ao !saquear (números) ───────────────────────────────────────────

async function handleRespostaSaque(sock, msg, jid, senderJid, textoResposta) {
  const estado = saqueState.get(chaveSaque(jid, senderJid));
  if (!estado) return false;

  const limpo = textoResposta.trim();
  if (!/^[\d\s,]+$/.test(limpo)) return false;

  if (estado.emProcessamento) return true;
  estado.emProcessamento = true;

  try {
    if (Date.now() - estado.criadoEm > RESPOSTA_TIMEOUT_MS) {
      limparEstado(jid, senderJid);
      await sock.sendMessage(jid, { text: '⏳ Tempo pra escolher o saque esgotado. Use *!saquear @alvo* novamente.' }, { quoted: msg });
      return true;
    }

    const indices = [...new Set(limpo.split(/[\s,]+/).map(n => parseInt(n, 10)).filter(n => !isNaN(n)))];
    const validos = indices.filter(i => i >= 0 && i < estado.opcoes.length);

    if (!validos.length) {
      estado.emProcessamento = false;
      await sock.sendMessage(jid, { text: '⚠️ Nenhum número válido. Tente de novo (ex: *0 2 3*).' }, { quoted: msg });
      return true;
    }

    if (!await getModoAtivo(jid)) {
      limparEstado(jid, senderJid);
      await sock.sendMessage(jid, { text: '⚔️ O modo medieval foi desativado neste grupo — saque cancelado.' }, { quoted: msg });
      return true;
    }

    const perdedorAtual = await MedievalPersonagem.findOne({ idWhatsApp: estado.perdedorJid, idGrupo: jid });
    const aindaValido = perdedorAtual?.derrotadoEm
      && (Date.now() - new Date(perdedorAtual.derrotadoEm).getTime()) < JANELA_SAQUE_MS;

    if (!aindaValido) {
      limparEstado(jid, senderJid);
      await sock.sendMessage(jid, { text: '⏳ A janela de saque expirou antes da sua confirmação. Nada foi levado.' }, { quoted: msg });
      return true;
    }

    const selecionados = validos.map(i => estado.opcoes[i]);
    const resumo = [];
    let manaMaxDelta    = 0;
    let removeuArma     = false;
    let removeuArmadura = false;

    for (const op of selecionados) {
      const session = await mongoose.startSession();
      try {
        if (op.tipo === 'gold') {
          try {
            const transferencia = await transferirGold(
              estado.perdedorJid,
              senderJid,
              jid,
              op.valor,
              'Saque medieval',
            );
            resumo.push(`💰 ${formatarSaldo(op.valor, transferencia.para)}`);
          } catch (errTx) {
            if (errTx instanceof RangeError) resumo.push('⚠️ Saldo — não estava mais disponível');
            else throw errTx;
          } finally {
            await session.endSession();
          }
          continue;
        }

        if (op.tipo === 'item') {
          const chaveMap = `inventarioMedieval.${op.chave}`;
          let preDoc = null;

          try {
            await session.withTransaction(async () => {
              preDoc = await MedievalPersonagem.findOneAndUpdate(
                { idWhatsApp: estado.perdedorJid, idGrupo: jid, [chaveMap]: { $gte: op.qtd } },
                { $inc: { [chaveMap]: -op.qtd } },
                { session }
              );
              if (!preDoc) throw new Error('INDISPONIVEL');
              await MedievalPersonagem.updateOne(
                { idWhatsApp: senderJid, idGrupo: jid },
                { $inc: { [chaveMap]: op.qtd } },
                { session }
              );
            });
            resumo.push(`📦 ${op.nome} x${op.qtd}`);
          } catch (errTx) {
            await session.endSession();
            if (errTx.message === 'INDISPONIVEL') {
              resumo.push(`⚠️ ${op.nome} — não estava mais disponível`);
            } else {
              console.error('⚠️ Erro na transação de item saqueado:', errTx.message);
              resumo.push(`⚠️ ${op.nome} — erro ao transferir, nada foi alterado`);
            }
            continue;
          }
          await session.endSession();

          const eraArma     = perdedorAtual.armaEquipada     === op.nome;
          const eraArmadura = perdedorAtual.armaduraEquipada === op.nome;
          if (eraArma || eraArmadura) {
            const invPreMap   = getInventarioMap(preDoc);
            const qtdAntes    = invPreMap.get(op.chave) || 0;
            const qtdRestante = qtdAntes - op.qtd;

            if (qtdRestante <= 0) {
              if (eraArma) {
                removeuArma = true;
                const armaData = getArma(op.nome);
                if (armaData?.bonusMana) manaMaxDelta -= armaData.bonusMana;
              }
              if (eraArmadura) {
                removeuArmadura = true;
                const armaduraData = ARMADURAS.find(a => a.nome === op.nome);
                if (armaduraData?.bonusMana) manaMaxDelta -= armaduraData.bonusMana;
              }
            }
          }
          continue;
        }

        await session.endSession();

        if (op.tipo === 'arma' && perdedorAtual.armaEquipada === op.nome) {
          const armaData = getArma(op.nome);
          if (armaData?.bonusMana) manaMaxDelta -= armaData.bonusMana;
          removeuArma = true;
          await MedievalPersonagem.updateOne(
            { idWhatsApp: senderJid, idGrupo: jid },
            { $inc: { [`inventarioMedieval.${op.nome.replace(/ /g, '_')}`]: 1 } }
          );
          resumo.push(`⚔️ ${op.nome} (equipada)`);
        }

        if (op.tipo === 'armadura' && perdedorAtual.armaduraEquipada === op.nome) {
          const armaduraData = ARMADURAS.find(a => a.nome === op.nome);
          if (armaduraData?.bonusMana) manaMaxDelta -= armaduraData.bonusMana;
          removeuArmadura = true;
          await MedievalPersonagem.updateOne(
            { idWhatsApp: senderJid, idGrupo: jid },
            { $inc: { [`inventarioMedieval.${op.nome.replace(/ /g, '_')}`]: 1 } }
          );
          resumo.push(`🛡️ ${op.nome} (equipada)`);
        }
      } catch (errItem) {
        await session.endSession().catch(() => {});
        console.error('⚠️ Erro ao processar item de saque:', errItem.message);
        resumo.push(`⚠️ Erro ao processar um dos itens selecionados.`);
      }
    }

    if (removeuArma || removeuArmadura || manaMaxDelta !== 0) {
      const setFields = {};
      if (removeuArma)     setFields.armaEquipada     = null;
      if (removeuArmadura) setFields.armaduraEquipada = null;
      if (manaMaxDelta !== 0) {
        const novoManaMax = Math.max(1, perdedorAtual.manaMax + manaMaxDelta);
        setFields.manaMax  = novoManaMax;
        setFields.mana     = Math.min(perdedorAtual.mana, novoManaMax);
      }
      await MedievalPersonagem.updateOne(
        { idWhatsApp: estado.perdedorJid, idGrupo: jid },
        { $set: setFields }
      ).catch(err => console.error('⚠️ Erro ao desequipar após saque:', err.message));
    }

    await MedievalPersonagem.updateOne(
      { idWhatsApp: estado.perdedorJid, idGrupo: jid },
      { $unset: { derrotadoEm: '', derrotadoPor: '' } }
    ).catch(err => console.error('⚠️ Erro ao limpar estado de derrota:', err.message));

    limparEstado(jid, senderJid);

    const houveSucesso = resumo.some(r => !r.startsWith('⚠️'));
    if (!houveSucesso) {
      await sock.sendMessage(jid, {
        text: `⚠️ Nada pôde ser saqueado — os itens selecionados não estavam mais disponíveis.`,
      }, { quoted: msg });
      return true;
    }

    await sock.sendMessage(jid, {
      text:
        `✅ *SAQUE REALIZADO!* ✅\n\n` +
        `Você levou de *@${estado.perdedorJid.split('@')[0]}*:\n` +
        resumo.map(r => `  ${r}`).join('\n'),
      mentions: [senderJid, estado.perdedorJid],
    }, { quoted: msg });

    return true;

  } catch (err) {
    console.error('⚠️ Erro em handleRespostaSaque:', err.message);
    limparEstado(jid, senderJid);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao processar o saque. Tente novamente.' }, { quoted: msg }).catch(() => {});
    return true;
  }
}

module.exports = { handleSaquear, handleRespostaSaque, saqueState };
