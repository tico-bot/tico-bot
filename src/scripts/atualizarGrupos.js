'use strict';

const path = require('path');
require('dotenv').config();

// ─── MongoDB Models ───────────────────────────────────────────────────────────
const CarteiraGrupoModel = require(path.join(__dirname, '..', 'models', 'CarteiraGrupo'));
const GrupoConfigModel   = require(path.join(__dirname, '..', 'models', 'GrupoConfig'));
const LidMappingModel    = require(path.join(__dirname, '..', 'models', 'LidMapping'));
const { normalizarJid, normalizarJidComDominio } = require(path.join(__dirname, '..', 'utils', 'jid'));
const { getParticipantJids } = require(path.join(__dirname, '..', 'utils', 'identity'));

// ─── Utilitário ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function gerarVariantesNumero(termo) {
  const digitos = String(termo || '').replace(/\D/g, '');
  const variantes = new Set([digitos]);
  if (digitos.startsWith('55') && digitos.length >= 12) {
    const ddd = digitos.slice(2, 4);
    const resto = digitos.slice(4);
    if (resto.length === 8) variantes.add(`55${ddd}9${resto}`);
    else if (resto.length === 9 && resto.startsWith('9')) variantes.add(`55${ddd}${resto.slice(1)}`);
  }
  return [...variantes];
}

/**
 * Descobre os grupos ativos do bot, remove do banco grupos dos quais o bot saiu,
 * e atualiza o nome real dos grupos restantes no MongoDB.
 *
 * @param {Object} sock - Instância ativa do Baileys
 */
async function rodarAtualizacao(sock) {
  if (!sock) {
    console.error('❌ [rodarAtualizacao] Instância do sock não fornecida.');
    return;
  }

  console.log('━'.repeat(60));
  console.log('🔄 Iniciando sincronização e limpeza de grupos...');
  console.log('━'.repeat(60));

  // ── 1. Remove JIDs inválidos (que não terminam com @g.us) ─────────────────
  try {
    const resInvalidos = await CarteiraGrupoModel.deleteMany({ idGrupo: { $not: /@g\.us$/ } });
    if (resInvalidos.deletedCount > 0) {
      console.log(`🧹 Removidos ${resInvalidos.deletedCount} registro(s) com idGrupo inválido (não @g.us).`);
    }
  } catch (err) {
    console.error('⚠️ Erro ao remover JIDs inválidos:', err.message);
  }

  // ── 2. Busca a lista REAL de grupos em que o bot participa ativamente ──────
  let activeGroupJids = [];
  try {
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        const participatingMap = await sock.groupFetchAllParticipating();
        const jids = Object.keys(participatingMap || {}).filter(j => j && typeof j === 'string' && j.endsWith('@g.us'));
        if (jids.length > 0 || tentativa === 3) {
          activeGroupJids = jids;
          break;
        }
      } catch (e) {
        if (tentativa === 3) throw e;
        await sleep(2500);
      }
    }
    console.log(`📋 O bot está participando ativamente de ${activeGroupJids.length} grupo(s).`);

    if (activeGroupJids.length === 0) {
      // Lista vazia quase sempre é falha momentânea do WhatsApp, não "bot sem grupos".
      // Com $nin: [] o deleteMany apagaria TUDO, então não limpa nada nesta rodada.
      console.warn('⚠️ Lista de grupos vazia; limpeza do banco ignorada por segurança.');
    } else {
      // Remove do banco todos os grupos que o bot NÃO faz mais parte
      const delCarteira = await CarteiraGrupoModel.deleteMany({ idGrupo: { $nin: activeGroupJids } });
      const delConfig   = await GrupoConfigModel.deleteMany({ idGrupo: { $nin: activeGroupJids } });

      if (delCarteira.deletedCount > 0) {
        console.log(`🧹 Removidos ${delCarteira.deletedCount} registro(s) de CarteiraGrupo de grupos em que o bot não está mais.`);
      }
      if (delConfig.deletedCount > 0) {
        console.log(`🧹 Removidos ${delConfig.deletedCount} registro(s) de GrupoConfig de grupos em que o bot não está mais.`);
      }
    }
  } catch (err) {
    console.error('⚠️ Erro ao obter lista de grupos ativos do WhatsApp:', err.message);
  }

  // ── 3. Itera sobre a lista de grupos ativos do bot para atualizar nomes e remover fantasmas ──
  const total = activeGroupJids.length;

  if (total === 0) {
    console.log('ℹ️ O bot não participou de nenhum grupo ativo.');
    console.log('━'.repeat(60));
    return;
  }

  console.log(`📦 Processando ${total} grupo(s) ativo(s)...\n`);

  let atualizados = 0;
  let falhas      = 0;

  for (let i = 0; i < activeGroupJids.length; i++) {
    const jid     = activeGroupJids[i];
    const prefixo = `[${i + 1}/${total}]`;

    if (!jid || !jid.endsWith('@g.us')) {
      await CarteiraGrupoModel.deleteMany({ idGrupo: jid });
      await GrupoConfigModel.deleteOne({ idGrupo: jid });
      falhas++;
      continue;
    }

    try {
      const metadata = await sock.groupMetadata(jid);
      const nomeReal = metadata?.subject?.trim();

      if (!nomeReal) {
        throw new Error('Campo "subject" vazio ou ausente nos metadados.');
      }

      // ── 3a. Limpa membros fantasmas (que não estão mais no grupo) ─────────
      const participantesAtuais = metadata?.participants || [];
      if (participantesAtuais.length > 0) {
        const rawJids = [];
        for (const participante of participantesAtuais) {
          // Campos tipados: PN continua PN e LID continua LID, mesmo sem domínio.
          rawJids.push(...getParticipantJids(participante));
        }

        const lidMaps = await LidMappingModel.find({
          $or: [
            { pn: { $in: rawJids } },
            { lid: { $in: rawJids } }
          ]
        }).lean();

        const jidsAtivosGrupo = new Set(rawJids);
        for (const m of lidMaps) {
          const pnMapeado = normalizarJidComDominio(m.pn, 's.whatsapp.net');
          const lidMapeado = normalizarJidComDominio(m.lid, 'lid');
          if (pnMapeado) jidsAtivosGrupo.add(pnMapeado);
          if (lidMapeado) jidsAtivosGrupo.add(lidMapeado);
          const pn = normalizarJidComDominio(m.pn, 's.whatsapp.net');
          const digitos = pn?.endsWith('@s.whatsapp.net') ? pn.split('@')[0].replace(/\D/g, '') : '';
          if (digitos && digitos.length >= 8 && digitos.length <= 15) {
            gerarVariantesNumero(digitos).forEach(v => jidsAtivosGrupo.add(`${v}@s.whatsapp.net`));
          }
        }

        for (const jidRaw of rawJids) {
          if (!jidRaw.endsWith('@s.whatsapp.net')) continue;
          const num = jidRaw.split('@')[0].replace(/\D/g, '');
          if (num && num.length >= 10 && num.length <= 15) {
            gerarVariantesNumero(num).forEach(v => jidsAtivosGrupo.add(`${v}@s.whatsapp.net`));
          }
        }

        const delFantasmas = await CarteiraGrupoModel.deleteMany({
          idGrupo: jid,
          idWhatsApp: { $nin: Array.from(jidsAtivosGrupo) }
        });
        if (delFantasmas.deletedCount > 0) {
          console.log(`         🧹 Removidos ${delFantasmas.deletedCount} membro(s) fantasma(s) do grupo "${nomeReal}".`);
        }
      }

      // ── 3b. Atualiza o nome real do grupo no GrupoConfig e CarteiraGrupo ──
      const resultadoMongo = await CarteiraGrupoModel.updateMany(
        { idGrupo: jid },
        { $set: { nomeGrupo: nomeReal } }
      );

      await GrupoConfigModel.findOneAndUpdate(
        { idGrupo: jid },
        { $set: { nomeGrupo: nomeReal } },
        { upsert: true }
      );

      atualizados++;
      console.log(
        `${prefixo} ✅ "${nomeReal}" (${jid})\n` +
        `         MongoDB → ${resultadoMongo.modifiedCount} registro(s) atualizado(s)`
      );

    } catch (err) {
      falhas++;
      console.error(`${prefixo} ❌ Ignorado (${jid}): ${err.message}`);
      if (
        err.message.includes('not-authorized') ||
        err.message.includes('403') ||
        err.message.includes('404') ||
        err.message.includes('PERMISSION_DENIED')
      ) {
        await CarteiraGrupoModel.deleteMany({ idGrupo: jid });
        await GrupoConfigModel.deleteOne({ idGrupo: jid });
        console.log(`         🧹 Grupo ${jid} removido do banco pois o bot não tem mais acesso.`);
      }
    }

    await sleep(800);
  }

  console.log('\n' + '━'.repeat(60));
  console.log('📊 SINCRONIZAÇÃO E LIMPEZA CONCLUÍDAS');
  console.log('━'.repeat(60));
  console.log(`   ✅ Sincronizados com sucesso : ${atualizados}`);
  console.log(`   ❌ Removidos / com erro       : ${falhas}`);
  console.log('━'.repeat(60) + '\n');
}

module.exports = { rodarAtualizacao };