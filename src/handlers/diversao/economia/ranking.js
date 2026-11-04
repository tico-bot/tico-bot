'use strict';

const path = require('path');
const CarteiraGrupo = require(path.join(__dirname, '..', '..', '..', 'models', 'CarteiraGrupo'));
const { formatWalletAmount } = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira', 'wallet'));
const { resolveDisplayName, getParticipantJids } = require(path.join(__dirname, '..', '..', '..', 'utils', 'identity'));
const LidMapping = require(path.join(__dirname, '..', '..', '..', 'models', 'LidMapping'));
const { normalizarJid, normalizarJidUsuario, normalizarJidComDominio } = require(path.join(__dirname, '..', '..', '..', 'utils', 'jid'));

const TOP_LIMIT = 10;
const BAR_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

function adicionarIdentificadores(set, jid) {
  if (typeof jid !== 'string' || !jid.includes('@')) return;
  const normalizado = normalizarJidUsuario(jid);
  if (normalizado) set.add(normalizado);
}

function saldoSeguro(value) {
  const saldo = Number(value);
  return Number.isFinite(saldo) && saldo > 0 ? saldo : 0;
}

function barraProgresso(valor, maximo, tamanho = BAR_SIZE) {
  const total = Math.max(1, Math.floor(Number(tamanho) || BAR_SIZE));
  const atual = saldoSeguro(valor);
  const max = saldoSeguro(maximo);
  if (!max) return '░'.repeat(total);
  const preenchido = Math.max(0, Math.min(total, Math.round((atual / max) * total)));
  return '█'.repeat(preenchido) + '░'.repeat(total - preenchido);
}

function numeroExibicao(jid) {
  const user = String(jid || '').split('@')[0].split(':')[0];
  const digits = user.replace(/\D/g, '');
  return digits || user || 'membro';
}

// !rankprata — ranking de saldos dos membros que ainda estão no grupo.
async function handleRankGold(sock, msg, jid, contactNames = {}) {
  if (typeof jid !== 'string' || !jid.endsWith('@g.us')) {
    if (jid) {
      await sock.sendMessage(jid, {
        text: '⚠️ Este comando só pode ser usado em grupos.',
      }, { quoted: msg });
    }
    return;
  }

  try {
    const metadata = await sock.groupMetadata(jid);
    const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];
    const membrosAtuais = new Set();

    for (const participante of participantes) {
      for (const identidade of getParticipantJids(participante)) {
        adicionarIdentificadores(membrosAtuais, identidade);
      }
    }

    const pnsMembros = [...membrosAtuais].filter(value => value.endsWith('@s.whatsapp.net'));
    const lidsMembros = [...membrosAtuais].filter(value => value.endsWith('@lid'));
    const condicoesMapa = [
      ...(pnsMembros.length ? [{ pn: { $in: pnsMembros } }] : []),
      ...(lidsMembros.length ? [{ lid: { $in: lidsMembros } }] : []),
    ];
    if (condicoesMapa.length) {
      const mapas = await LidMapping.find({ $or: condicoesMapa }).select('pn lid').lean();
      for (const mapa of mapas) {
        adicionarIdentificadores(membrosAtuais, normalizarJidComDominio(mapa.pn, 's.whatsapp.net'));
        adicionarIdentificadores(membrosAtuais, normalizarJidComDominio(mapa.lid, 'lid'));
      }
    }

    if (!participantes.length) {
      await sock.sendMessage(jid, {
        text: '⚠️ Não consegui confirmar os membros deste grupo agora. Tente novamente em alguns instantes.',
      }, { quoted: msg });
      return;
    }

    // Ordena no MongoDB para evitar carregar todas as carteiras do grupo.
    const candidatos = await CarteiraGrupo.find({ idGrupo: jid, gold: { $gt: 0 } })
      .select('idWhatsApp gold wallet')
      .sort({ gold: -1, _id: 1 })
      .lean();

    const top = candidatos
      .filter(usuario => {
        if (!usuario?.idWhatsApp) return false;
        const identificadores = new Set();
        adicionarIdentificadores(identificadores, usuario.idWhatsApp);
        return [...identificadores].some(id => membrosAtuais.has(id));
      })
      .slice(0, TOP_LIMIT);

    if (!top.length) {
      await sock.sendMessage(jid, {
        text: '💰 *RANKING DE PRATA*\n\nNenhum membro ativo com saldo positivo registrado neste grupo ainda.\n\n⛏️ Use *!garimpar* para começar a ganhar Prata!',
      }, { quoted: msg });
      return;
    }

    const maiorSaldo = Math.max(...top.map(usuario => saldoSeguro(usuario.gold)), 1);
    const linhas = await Promise.all(top.map(async (usuario, indice) => {
      const jidUsuario = String(usuario.idWhatsApp).trim().toLowerCase();
      const nome = await resolveDisplayName(jidUsuario, sock, contactNames, { fallback: 'Participante' });
      const saldo = saldoSeguro(usuario.gold);
      const medalha = MEDALS[indice] || '🔹 *' + (indice + 1) + '.*';
      const barra = barraProgresso(saldo, maiorSaldo);
      return medalha + ' *' + nome + '*\n   ' + barra + ' ' + formatWalletAmount(saldo);
    }));

    await sock.sendMessage(jid, {
      text: `💰 *RANKING DE PRATA — TOP ${top.length}* 💰\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${linhas.join('\n\n')}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⛏️ Use *!garimpar* para ganhar Prata e subir no ranking!`,
    }, { quoted: msg });
  } catch (err) {
    console.error('[RankingPrata] Falha ao carregar ranking:', err);
    try {
      await sock.sendMessage(jid, {
        text: '⚠️ Não foi possível carregar o ranking de Prata agora. Tente novamente em alguns instantes.',
      }, { quoted: msg });
    } catch (sendError) {
      console.error('[RankingPrata] Também falhou ao enviar a mensagem de erro:', sendError.message);
    }
  }
}

module.exports = { handleRankGold, normalizarJid, barraProgresso };
