'use strict';

const RepublicaEstado = require('../../models/RepublicaEstado');
const RepublicaEleicao = require('../../models/RepublicaEleicao');
const RepublicaVoto = require('../../models/RepublicaVoto');
const { resolveJidComLid } = require('../../utils/identity');

const DURACAO_ELEICAO_MS = 15 * 60 * 1000;
const DURACAO_MANDATO_MS = 24 * 60 * 60 * 1000;
const EMPATE_PRORROGACAO_MS = 5 * 60 * 1000;
const NOVA_ELEICAO_SEM_CANDIDATOS_MS = 30 * 60 * 1000;

function nomeSeguro(nome, fallback = 'Candidato') {
  const limpo = String(nome || '').replace(/[*_~]/g, '').trim().slice(0, 35);
  return limpo || fallback;
}

async function obterEleicaoAberta(idGrupo) {
  return RepublicaEleicao.findOne({ idGrupo, status: 'aberta' }).sort({ createdAt: -1 });
}

async function abrirEleicao(idGrupo, agora = new Date()) {
  const existente = await obterEleicaoAberta(idGrupo);
  if (existente) return existente;
  const eleicao = await RepublicaEleicao.create({
    idGrupo, status: 'aberta', iniciaEm: agora,
    encerraEm: new Date(agora.getTime() + DURACAO_ELEICAO_MS),
  });
  await RepublicaEstado.findOneAndUpdate(
    { idGrupo }, { $set: { eleicaoAtualId: eleicao._id } }, { upsert: true }
  );
  return eleicao;
}

async function candidatar(idGrupo, presidenteRaw, viceRaw, nomePresidente, nomeVice, plano = '') {
  const presidenteId = await resolveJidComLid(presidenteRaw, idGrupo);
  const viceId = await resolveJidComLid(viceRaw, idGrupo);
  if (!presidenteId || !viceId || presidenteId === viceId) return { ok: false, motivo: 'CANDIDATOS_INVALIDOS' };
  const eleicao = await obterEleicaoAberta(idGrupo);
  if (!eleicao) return { ok: false, motivo: 'SEM_ELEICAO' };
  if (new Date(eleicao.encerraEm).getTime() <= Date.now()) return { ok: false, motivo: 'PRAZO_ENCERRADO' };
  if (eleicao.candidaturas.some(c => c.presidenteId === presidenteId || c.viceId === presidenteId)) return { ok: false, motivo: 'JA_CANDIDATADO' };
  if (eleicao.candidaturas.some(c => c.viceId === viceId || c.presidenteId === viceId)) return { ok: false, motivo: 'VICE_JA_EM_CHAPA' };
  eleicao.candidaturas.push({
    presidenteId, viceId,
    presidenteNome: nomeSeguro(nomePresidente),
    viceNome: nomeSeguro(nomeVice),
    plano: String(plano || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500),
    viceAceitou: false,
  });
  await eleicao.save();
  return { ok: true, eleicao };
}

async function aceitarVice(idGrupo, viceRaw, nomeVice) {
  const viceId = await resolveJidComLid(viceRaw, idGrupo);
  const eleicao = await obterEleicaoAberta(idGrupo);
  if (!eleicao) return { ok: false, motivo: 'SEM_ELEICAO' };
  if (new Date(eleicao.encerraEm).getTime() <= Date.now()) return { ok: false, motivo: 'PRAZO_ENCERRADO' };
  const candidatura = eleicao.candidaturas.find(c => c.viceId === viceId);
  if (!candidatura) return { ok: false, motivo: 'CONVITE_NAO_ENCONTRADO' };
  candidatura.viceAceitou = true;
  candidatura.viceNome = nomeSeguro(nomeVice, 'Vice-presidente');
  candidatura.confirmadaEm = new Date();
  await eleicao.save();
  return { ok: true, candidatura };
}

async function votar(idGrupo, eleitorRaw, presidenteRaw) {
  const eleitorId = await resolveJidComLid(eleitorRaw, idGrupo);
  const candidatoId = await resolveJidComLid(presidenteRaw, idGrupo);
  const eleicao = await obterEleicaoAberta(idGrupo);
  if (!eleicao) return { ok: false, motivo: 'SEM_ELEICAO' };
  if (new Date(eleicao.encerraEm).getTime() <= Date.now()) return { ok: false, motivo: 'PRAZO_ENCERRADO' };
  const candidatura = eleicao.candidaturas.find(c => c.presidenteId === candidatoId && c.viceAceitou);
  if (!candidatura) return { ok: false, motivo: 'CHAPA_NAO_CONFIRMADA' };
  try {
    await RepublicaVoto.findOneAndUpdate(
      { idEleicao: eleicao._id, eleitorId },
      { $set: { idGrupo, candidatoId }, $setOnInsert: { idEleicao: eleicao._id, eleitorId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error && error.code === 11000) return { ok: false, motivo: 'VOTO_DUPLICADO' };
    throw error;
  }
  return { ok: true, candidatura };
}

async function consultarEleicao(idGrupo) {
  const eleicao = await obterEleicaoAberta(idGrupo);
  if (!eleicao) return null;
  return { eleicao, votos: await RepublicaVoto.countDocuments({ idEleicao: eleicao._id }) };
}

async function processarEleicao(sock, idGrupo, agora = new Date()) {
  const eleicao = await obterEleicaoAberta(idGrupo);
  if (!eleicao || new Date(eleicao.encerraEm).getTime() > agora.getTime()) return null;
  const chapas = eleicao.candidaturas.filter(c => c.viceAceitou);
  if (!chapas.length) {
    eleicao.status = 'sem_candidatos';
    await eleicao.save();
    await RepublicaEstado.updateOne({ idGrupo }, { $set: { eleicaoAtualId: null } });
    if (sock && sock.sendMessage) await sock.sendMessage(idGrupo, {
      text: '🗳️ *ELEIÇÃO SEM CHAPAS VÁLIDAS*\n\nNenhuma candidatura foi confirmada pelo vice. Uma nova eleição será aberta em 30 minutos.',
    }).catch(() => {});
    return { status: 'sem_candidatos', proxima: new Date(agora.getTime() + NOVA_ELEICAO_SEM_CANDIDATOS_MS) };
  }

  const votos = await RepublicaVoto.aggregate([
    { $match: { idEleicao: eleicao._id } },
    { $group: { _id: '$candidatoId', total: { $sum: 1 } } },
    { $sort: { total: -1, _id: 1 } },
  ]);
  if (!votos.length) {
    eleicao.status = 'sem_votos';
    await eleicao.save();
    await RepublicaEstado.updateOne({ idGrupo }, { $set: { eleicaoAtualId: null } });
    if (sock && sock.sendMessage) await sock.sendMessage(idGrupo, {
      text: '🗳️ *ELEIÇÃO SEM VOTOS*\n\nNenhum voto foi registado. Uma nova eleição será aberta em 30 minutos.',
    }).catch(() => {});
    return { status: 'sem_votos', proxima: new Date(agora.getTime() + NOVA_ELEICAO_SEM_CANDIDATOS_MS) };
  }
  const maior = votos[0].total;
  const vencedores = votos.filter(v => v.total === maior);
  if (vencedores.length > 1 && (eleicao.rodadasDesempate || 0) < 1) {
    eleicao.rodadasDesempate = 1;
    eleicao.encerraEm = new Date(agora.getTime() + EMPATE_PRORROGACAO_MS);
    await eleicao.save();
    if (sock && sock.sendMessage) await sock.sendMessage(idGrupo, {
      text: '⚖️ *EMPATE NA ELEIÇÃO!*\n\nA votação foi prorrogada uma única vez por mais 5 minutos. Os votos anteriores foram preservados e podem ser alterados. Se o empate persistir, vencerá a chapa cuja candidatura foi confirmada primeiro, conforme o critério de desempate do Modo República.',
    }).catch(() => {});
    return { status: 'empate', encerraEm: eleicao.encerraEm };
  }

  let chapa;
  let desempateAplicado = false;
  if (vencedores.length > 1) {
    const idsEmpatados = new Set(vencedores.map(v => v._id));
    chapa = chapas
      .filter(c => idsEmpatados.has(c.presidenteId))
      .sort((a, b) => new Date(a.confirmadaEm || a.criadaEm || 0).getTime() - new Date(b.confirmadaEm || b.criadaEm || 0).getTime() || a.presidenteId.localeCompare(b.presidenteId))[0];
    desempateAplicado = true;
  } else {
    chapa = chapas.find(c => c.presidenteId === vencedores[0]._id);
  }
  if (!chapa) return { status: 'erro', motivo: 'CHAPA_VENCEDORA_NAO_ENCONTRADA' };
  const presidenteId = chapa.presidenteId;
  const estado = await RepublicaEstado.findOne({ idGrupo });
  const numeroMandato = (estado && estado.governo ? estado.governo.numeroMandato : 0) + 1;
  const mandatoId = idGrupo + ':' + numeroMandato + ':' + agora.getTime();
  await RepublicaEstado.findOneAndUpdate(
    { idGrupo },
    { $set: {
      'governo.presidenteId': chapa.presidenteId,
      'governo.viceId': chapa.viceId,
      'governo.presidenteNome': chapa.presidenteNome,
      'governo.viceNome': chapa.viceNome,
      'governo.eleitoEm': agora,
      'governo.mandatoAte': new Date(agora.getTime() + DURACAO_MANDATO_MS),
      'governo.numeroMandato': numeroMandato,
      eleicaoAtualId: null,
      'impostos.ajustesMandato.irpf': 0,
      'impostos.ajustesMandato.cbs': 0,
      'impostos.ajustesMandato.ibs': 0,
      'impostos.ajustesMandato.iof': 0,
      'impostos.mandatoDoUltimoAjuste': mandatoId,
      'recompensaTemporaria.multiplicador': 1,
      'recompensaTemporaria.ate': null,
      'recompensaTemporaria.mandatoId': mandatoId,
      'recompensaTemporaria.alteracoesNoMandato': 0,
    } },
    { upsert: true, new: true }
  );
  eleicao.status = 'encerrada';
  eleicao.resultado = { presidenteId: chapa.presidenteId, viceId: chapa.viceId, votos: maior, apuradoEm: agora };
  await eleicao.save();

  if (sock && sock.sendMessage) await sock.sendMessage(idGrupo, {
    text:
      '🇧🇷 *RESULTADO OFICIAL — MODO REPÚBLICA*\n\n' +
      '🏛️ Presidente: *' + chapa.presidenteNome + '*\n' +
      '🤝 Vice-presidente: *' + chapa.viceNome + '*\n' +
      '🗳️ Votos recebidos: *' + maior + '*\n' +
      '⏳ Mandato: *24 horas*\n' +
      (desempateAplicado ? '⚖️ Critério de desempate aplicado: candidatura confirmada primeiro.\n' : '') +
      '\nO governo tomou posse. As leis e alíquotas anteriores continuam em vigor.',
    mentions: [chapa.presidenteId, chapa.viceId],
  }).catch(() => {});
  return { status: 'eleito', chapa, votos: maior };
}

module.exports = {
  DURACAO_ELEICAO_MS, DURACAO_MANDATO_MS, EMPATE_PRORROGACAO_MS,
  NOVA_ELEICAO_SEM_CANDIDATOS_MS, abrirEleicao, obterEleicaoAberta,
  candidatar, aceitarVice, votar, consultarEleicao, processarEleicao,
};
