'use strict';

const crypto = require('node:crypto');
const RepublicaEstado = require('../../models/RepublicaEstado');
const RepublicaEleicao = require('../../models/RepublicaEleicao');
const RepublicaVoto = require('../../models/RepublicaVoto');
const {
  resolveJidComLid,
  resolvePhoneAndJid,
  getParticipantJids,
} = require('../../utils/identity');

const DURACAO_CANDIDATURA_MS = 5 * 60 * 1000;
const DURACAO_CAMPANHA_MS = 5 * 60 * 1000;
const DURACAO_VOTACAO_MS = 5 * 60 * 1000;
const DURACAO_SEGUNDO_TURNO_MS = 5 * 60 * 1000;
const DURACAO_ELEICAO_MS = DURACAO_CANDIDATURA_MS + DURACAO_CAMPANHA_MS + DURACAO_VOTACAO_MS;
const DURACAO_MANDATO_MS = 24 * 60 * 60 * 1000;
const EMPATE_PRORROGACAO_MS = DURACAO_SEGUNDO_TURNO_MS;
const NOVA_ELEICAO_SEM_CANDIDATOS_MS = 30 * 60 * 1000;
const QUORUM_MINIMO = 0.25;

let migracaoVotosPromise = null;

function obterSegredoVotacao() {
  const segredo = process.env.REPUBLICA_VOTO_SECRET || process.env.JWT_SECRET;
  if (!segredo || String(segredo).length < 32) {
    throw new Error('[Republica] Configure REPUBLICA_VOTO_SECRET ou JWT_SECRET com pelo menos 32 caracteres.');
  }
  return String(segredo);
}

function hashIdentidade(idGrupo, idEleicao, identidade, finalidade) {
  return crypto.createHmac('sha256', obterSegredoVotacao())
    .update([finalidade, idGrupo, String(idEleicao), String(identidade)].join('|'))
    .digest('hex');
}

function hashPublicoEleitor(idGrupo, idEleicao, identidade) {
  return hashIdentidade(idGrupo, idEleicao, identidade, 'elegibilidade');
}

function hashCedulaEleitor(idGrupo, idEleicao, identidade) {
  return hashIdentidade(idGrupo, idEleicao, identidade, 'cedula-anonima');
}

function selecionarFinalistasSegundoTurno(contagem, totalVotos) {
  const ranking = [...(contagem instanceof Map ? contagem.entries() : contagem)]
    .sort((a, b) => b[1] - a[1]);
  if (ranking.length < 2 || !totalVotos) return [];
  if (ranking[0][1] > totalVotos / 2) return [];
  if (ranking[0][1] === ranking[1][1]) {
    const maior = ranking[0][1];
    return ranking.filter(item => item[1] === maior).map(item => item[0]);
  }
  const segundoLugar = ranking[1][1];
  return ranking.filter((item, index) => index === 0 || item[1] === segundoLugar).map(item => item[0]);
}

function calcularQuorumMinimo(totalEleitores, proporcao = QUORUM_MINIMO) {
  const total = Math.max(0, Number(totalEleitores) || 0);
  if (!total) return 0;
  return Math.max(1, Math.ceil(total * Math.min(1, Math.max(0, Number(proporcao) || 0))));
}

function nomeSeguro(nome, fallback = 'Candidato') {
  const limpo = String(nome || '').replace(/[*_~]/g, '').trim().slice(0, 35);
  return limpo || fallback;
}

function idsValidos(ids) {
  const valores = Array.isArray(ids) ? ids : [ids];
  return [...new Set(valores.filter(v => typeof v === 'string' && v.includes('@')).map(v => v.trim().toLowerCase()))];
}

async function identidadeCanonica(ids, idGrupo) {
  const validos = idsValidos(ids);
  if (!validos.length) return null;

  // Usa a mesma resolução PN/LID da carteira do grupo. Isto evita que
  // o presidente eleito perca os poderes por ter sido guardado com outro JID.
  const preferido = validos.find(v => v.endsWith('@s.whatsapp.net'))
    || validos.find(v => v.endsWith('@lid'));
  if (!preferido) return null;

  const info = await resolvePhoneAndJid(preferido);
  if (idGrupo) {
    const candidatos = [
      info?.resolvedJid,
      info?.pnJid,
      info?.lidJid,
      preferido,
    ].filter(Boolean);
    for (const candidato of [...new Set(candidatos)]) {
      const resolvido = await resolveJidComLid(candidato, idGrupo);
      if (resolvido) return resolvido;
    }
  }
  return info?.resolvedJid || preferido;
}

async function obterMetadadosGrupo(sock, idGrupo) {
  if (!sock || typeof sock.groupMetadata !== 'function') {
    throw new Error('Não foi possível consultar os membros do grupo.');
  }
  return sock.groupMetadata(idGrupo);
}

async function obterIdentidadeBot(sock, idGrupo) {
  const idsBot = idsValidos([
    sock?.user?.id,
    sock?.user?.lid,
    sock?.user?.jid,
  ]);
  const canonicas = await Promise.all(idsBot.map(id => identidadeCanonica([id], idGrupo)));
  return new Set([...idsBot, ...canonicas].filter(Boolean));
}

async function participanteEhBot(sock, idGrupo, participante, idsBotCache = null) {
  const idsBot = idsBotCache || await obterIdentidadeBot(sock, idGrupo);
  const ids = idsValidos(getParticipantJids(participante));
  if (ids.some(id => idsBot.has(id))) return true;
  const canonico = await identidadeCanonica(ids, idGrupo);
  return Boolean(canonico && idsBot.has(canonico));
}

async function criarSnapshotEleitores(sock, idGrupo, idEleicao) {
  const meta = await obterMetadadosGrupo(sock, idGrupo);
  const hashes = new Set();
  const idsBot = await obterIdentidadeBot(sock, idGrupo);
  for (const participante of (meta?.participants || [])) {
    if (await participanteEhBot(sock, idGrupo, participante, idsBot)) continue;
    const identidade = await identidadeCanonica(getParticipantJids(participante), idGrupo);
    if (identidade) hashes.add(hashPublicoEleitor(idGrupo, idEleicao, identidade));
  }
  return { hashes: [...hashes], total: hashes.size };
}

async function usuarioPertenceAoGrupo(sock, idGrupo, idsUsuario, metadados = null) {
  const candidatos = idsValidos(idsUsuario);
  if (!candidatos.length) return false;
  const meta = metadados || await obterMetadadosGrupo(sock, idGrupo);
  const canonicoUsuario = await identidadeCanonica(candidatos, idGrupo);
  const setUsuario = new Set(candidatos);
  if (canonicoUsuario) setUsuario.add(canonicoUsuario);

  for (const participante of (meta?.participants || [])) {
    const idsParticipante = idsValidos(getParticipantJids(participante));
    if (idsParticipante.some(id => setUsuario.has(id))) return true;
    const canonicoParticipante = await identidadeCanonica(idsParticipante, idGrupo);
    if (canonicoParticipante && setUsuario.has(canonicoParticipante)) return true;
    if (canonicoUsuario && canonicoParticipante === canonicoUsuario) return true;
  }
  return false;
}

async function chaveUsuario(idsUsuario, idGrupo) {
  return identidadeCanonica(idsUsuario, idGrupo);
}

async function garantirVotosAnonimos() {
  if (!migracaoVotosPromise) {
    migracaoVotosPromise = (async () => {
      const collection = RepublicaVoto.collection;
      await RepublicaVoto.createCollection().catch(() => {});
      const indices = await collection.indexes().catch(() => []);
      const indiceLegado = indices.find(index =>
        index.unique && index.key?.idEleicao === 1 && index.key?.eleitorId === 1
      );
      if (indiceLegado) await collection.dropIndex(indiceLegado.name).catch(() => {});

      const legados = await collection.find({
        eleitorId: { $exists: true, $ne: null },
      }).sort({ votadoEm: -1, updatedAt: -1 }).toArray();

      const vistos = new Set();
      for (const voto of legados) {
        const canonico = await identidadeCanonica([voto.eleitorId], voto.idGrupo) || String(voto.eleitorId);
        const eleitorHash = hashCedulaEleitor(voto.idGrupo, voto.idEleicao, canonico);
        const chave = String(voto.idEleicao) + ':' + eleitorHash;

        // Se PN e LID produziram votos duplicados na versão antiga, fica
        // apenas o registo mais recente. Nenhum identificador bruto é mantido.
        if (vistos.has(chave)) {
          await collection.deleteOne({ _id: voto._id });
          continue;
        }
        vistos.add(chave);
        await collection.updateOne(
          { _id: voto._id },
          { $set: { eleitorHash }, $unset: { eleitorId: '' } }
        );
      }

      await collection.updateMany(
        { eleitorId: { $exists: true } },
        { $unset: { eleitorId: '' } }
      );

      const indiceAnonimo = await collection.indexes().catch(() => []);
      if (!indiceAnonimo.some(index =>
        index.unique && index.key?.idEleicao === 1 && index.key?.eleitorHash === 1
      )) {
        await collection.createIndex(
          { idEleicao: 1, eleitorHash: 1 },
          { unique: true, name: 'republica_votos_anonimos_unicos' }
        );
      }
    })().catch(error => {
      migracaoVotosPromise = null;
      throw error;
    });
  }
  return migracaoVotosPromise;
}

function faseAtual(eleicao) {
  return eleicao?.fase || 'votacao';
}

function fimDaFase(eleicao) {
  return new Date(eleicao?.faseEncerraEm || eleicao?.encerraEm || 0);
}

async function obterEleicaoAberta(idGrupo, sock = null) {
  await garantirVotosAnonimos();
  const eleicao = await RepublicaEleicao.findOne({ idGrupo, status: 'aberta' }).sort({ createdAt: -1 });
  if (!eleicao) return null;

  let alterada = false;
  if (!eleicao.fase) {
    // Compatibilidade com eleições iniciadas pela versão anterior:
    // elas entram directamente na fase de votação já em curso.
    eleicao.fase = 'votacao';
    eleicao.faseIniciaEm = eleicao.iniciaEm || eleicao.createdAt || new Date();
    eleicao.faseEncerraEm = eleicao.encerraEm;
    eleicao.rodadaAtual = 1;
    eleicao.quorumMinimo = QUORUM_MINIMO;
    eleicao.tipoVotacao = eleicao.candidaturas.filter(c => c.viceAceitou).length === 1
      ? 'aprovacao'
      : 'chapas';
    alterada = true;
  }
  if (!eleicao.codigo) {
    eleicao.codigo = crypto.randomBytes(4).toString('hex').toUpperCase();
    alterada = true;
  }
  if (!Array.isArray(eleicao.eleitoresHashes) || !eleicao.eleitoresHashes.length) {
    if (sock) {
      const snapshot = await criarSnapshotEleitores(sock, idGrupo, eleicao._id);
      eleicao.eleitoresHashes = snapshot.hashes;
      eleicao.totalEleitores = snapshot.total;
      alterada = true;
    }
  }
  if (!eleicao.faseEncerraEm && eleicao.encerraEm) {
    eleicao.faseEncerraEm = eleicao.encerraEm;
    alterada = true;
  }
  if (alterada) await eleicao.save();
  return eleicao;
}

async function abrirEleicao(idGrupo, agora = new Date(), sock = null) {
  const existente = await obterEleicaoAberta(idGrupo, sock);
  if (existente) return existente;
  if (!sock) throw new Error('A eleição precisa de acesso aos membros do grupo para definir o eleitorado.');

  await garantirVotosAnonimos();
  const meta = await obterMetadadosGrupo(sock, idGrupo);
  const eleicao = new RepublicaEleicao({
    idGrupo,
    status: 'aberta',
    codigo: crypto.randomBytes(4).toString('hex').toUpperCase(),
    iniciaEm: agora,
    fase: 'candidaturas',
    faseIniciaEm: agora,
    faseEncerraEm: new Date(agora.getTime() + DURACAO_CANDIDATURA_MS),
    encerraEm: new Date(agora.getTime() + DURACAO_CANDIDATURA_MS),
    quorumMinimo: QUORUM_MINIMO,
    rodadaAtual: 1,
  });
  const hashes = new Set();
  const idsBot = await obterIdentidadeBot(sock, idGrupo);
  for (const participante of (meta?.participants || [])) {
    if (await participanteEhBot(sock, idGrupo, participante, idsBot)) continue;
    const identidade = await identidadeCanonica(getParticipantJids(participante), idGrupo);
    if (identidade) hashes.add(hashPublicoEleitor(idGrupo, eleicao._id, identidade));
  }
  eleicao.eleitoresHashes = [...hashes];
  eleicao.totalEleitores = hashes.size;
  await eleicao.save();

  await RepublicaEstado.findOneAndUpdate(
    { idGrupo },
    { $set: { eleicaoAtualId: eleicao._id } },
    { upsert: true }
  );
  return eleicao;
}

async function abrirEleicaoVice(idGrupo, agora = new Date(), sock = null) {
  const existente = await obterEleicaoAberta(idGrupo, sock);
  if (existente) return existente;
  if (!sock) throw new Error('A eleição complementar precisa de acesso aos membros do grupo.');

  const estado = await RepublicaEstado.findOne({ idGrupo });
  const governo = estado?.governo || {};
  if (!governo.presidenteId || governo.viceId) return null;

  const meta = await obterMetadadosGrupo(sock, idGrupo);
  const presidenteAtivo = await usuarioPertenceAoGrupo(sock, idGrupo, [governo.presidenteId], meta);
  if (!presidenteAtivo) return null;

  const eleicao = new RepublicaEleicao({
    idGrupo,
    tipoEleicao: 'vice',
    status: 'aberta',
    codigo: crypto.randomBytes(4).toString('hex').toUpperCase(),
    iniciaEm: agora,
    fase: 'candidaturas',
    faseIniciaEm: agora,
    faseEncerraEm: new Date(agora.getTime() + DURACAO_CANDIDATURA_MS),
    encerraEm: new Date(agora.getTime() + DURACAO_CANDIDATURA_MS),
    quorumMinimo: QUORUM_MINIMO,
    rodadaAtual: 1,
  });

  const hashes = new Set();
  const idsBot = await obterIdentidadeBot(sock, idGrupo);
  for (const participante of (meta?.participants || [])) {
    if (await participanteEhBot(sock, idGrupo, participante, idsBot)) continue;
    const identidade = await identidadeCanonica(getParticipantJids(participante), idGrupo);
    if (identidade) hashes.add(hashPublicoEleitor(idGrupo, eleicao._id, identidade));
  }
  eleicao.eleitoresHashes = [...hashes];
  eleicao.totalEleitores = hashes.size;
  await eleicao.save();
  await RepublicaEstado.updateOne({ idGrupo }, { $set: { eleicaoAtualId: eleicao._id } });
  await avisar(sock, idGrupo,
    '🗳️ *ELEIÇÃO COMPLEMENTAR PARA VICE-PRESIDENTE*\n\n' +
    'O presidente *' + (governo.presidenteNome || 'em exercício') +
    '* permanece no cargo. Esta eleição escolherá apenas um novo vice-presidente.\n' +
    'Código: *' + eleicao.codigo + '*\n' +
    'Use /republica candidatura-vice para registar a sua candidatura.');
  return eleicao;
}

async function candidatarVice(idGrupo, candidatoRaw, nomeCandidato, plano = '', sock = null, alternates = []) {
  const candidatoId = await chaveUsuario([candidatoRaw, ...alternates], idGrupo);
  if (!candidatoId || !sock) return { ok: false, motivo: 'CANDIDATO_INVALIDO' };

  const eleicao = await obterEleicaoAberta(idGrupo, sock);
  if (!eleicao || eleicao.tipoEleicao !== 'vice') return { ok: false, motivo: 'SEM_ELEICAO_VICE' };
  if (faseAtual(eleicao) !== 'candidaturas' || fimDaFase(eleicao).getTime() <= Date.now()) {
    return { ok: false, motivo: 'PRAZO_ENCERRADO' };
  }

  const estado = await RepublicaEstado.findOne({ idGrupo }).lean();
  const governo = estado?.governo || {};
  if (!governo.presidenteId || governo.viceId) return { ok: false, motivo: 'CARGO_NAO_DISPONIVEL' };

  const meta = await obterMetadadosGrupo(sock, idGrupo);
  if (!(await usuarioPertenceAoGrupo(sock, idGrupo, [governo.presidenteId], meta)) ||
      !(await usuarioPertenceAoGrupo(sock, idGrupo, [candidatoId], meta))) {
    return { ok: false, motivo: 'CANDIDATO_FORA_DO_GRUPO' };
  }
  const idsBot = await obterIdentidadeBot(sock, idGrupo);
  if (idsBot.has(candidatoId)) return { ok: false, motivo: 'CANDIDATO_E_BOT' };
  if (candidatoId === governo.presidenteId) return { ok: false, motivo: 'PRESIDENTE_NAO_PODE_SER_VICE' };
  if (eleicao.candidaturas.some(c => c.viceId === candidatoId)) {
    return { ok: false, motivo: 'JA_CANDIDATADO' };
  }

  eleicao.candidaturas.push({
    presidenteId: governo.presidenteId,
    viceId: candidatoId,
    presidenteNome: governo.presidenteNome || 'Presidente em exercício',
    viceNome: nomeSeguro(nomeCandidato),
    plano: String(plano || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500),
    viceAceitou: true,
    confirmadaEm: new Date(),
  });
  await eleicao.save();
  return { ok: true, eleicao };
}

async function candidatar(idGrupo, presidenteRaw, viceRaw, nomePresidente, nomeVice, plano = '', sock = null, alternatesPresidente = []) {
  const presidenteId = await chaveUsuario([presidenteRaw, ...alternatesPresidente], idGrupo);
  const viceId = await chaveUsuario(viceRaw, idGrupo);
  if (!presidenteId || !viceId || presidenteId === viceId) {
    return { ok: false, motivo: 'CANDIDATOS_INVALIDOS' };
  }

  const eleicao = await obterEleicaoAberta(idGrupo, sock);
  if (!eleicao) return { ok: false, motivo: 'SEM_ELEICAO' };
  if (faseAtual(eleicao) !== 'candidaturas' || fimDaFase(eleicao).getTime() <= Date.now()) {
    return { ok: false, motivo: 'PRAZO_ENCERRADO' };
  }
  if (!sock) return { ok: false, motivo: 'NAO_FOI_POSSIVEL_VALIDAR_MEMBROS' };

  const metadados = await obterMetadadosGrupo(sock, idGrupo);
  if (!(await usuarioPertenceAoGrupo(sock, idGrupo, [presidenteId], metadados)) ||
      !(await usuarioPertenceAoGrupo(sock, idGrupo, [viceId], metadados))) {
    return { ok: false, motivo: 'CANDIDATO_FORA_DO_GRUPO' };
  }
  const idsBot = await obterIdentidadeBot(sock, idGrupo);
  if (idsBot.has(presidenteId) || idsBot.has(viceId)) {
    return { ok: false, motivo: 'CANDIDATO_E_BOT' };
  }

  if (eleicao.candidaturas.some(c => c.presidenteId === presidenteId || c.viceId === presidenteId)) {
    return { ok: false, motivo: 'JA_CANDIDATADO' };
  }
  if (eleicao.candidaturas.some(c => c.viceId === viceId || c.presidenteId === viceId)) {
    return { ok: false, motivo: 'VICE_JA_EM_CHAPA' };
  }

  eleicao.candidaturas.push({
    presidenteId,
    viceId,
    presidenteNome: nomeSeguro(nomePresidente),
    viceNome: nomeSeguro(nomeVice),
    plano: String(plano || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500),
    viceAceitou: false,
  });
  await eleicao.save();
  return { ok: true, eleicao };
}

async function aceitarVice(idGrupo, viceRaw, nomeVice, sock = null, alternates = []) {
  const viceId = await chaveUsuario([viceRaw, ...alternates], idGrupo);
  const eleicao = await obterEleicaoAberta(idGrupo, sock);
  if (!eleicao) return { ok: false, motivo: 'SEM_ELEICAO' };
  if (faseAtual(eleicao) !== 'candidaturas' || fimDaFase(eleicao).getTime() <= Date.now()) {
    return { ok: false, motivo: 'PRAZO_ENCERRADO' };
  }
  if (!viceId) return { ok: false, motivo: 'CONVITE_NAO_ENCONTRADO' };
  const candidatura = eleicao.candidaturas.find(c => c.viceId === viceId);
  if (!candidatura) return { ok: false, motivo: 'CONVITE_NAO_ENCONTRADO' };
  if (sock && !(await usuarioPertenceAoGrupo(sock, idGrupo, [viceId]))) {
    return { ok: false, motivo: 'CANDIDATO_FORA_DO_GRUPO' };
  }
  candidatura.viceAceitou = true;
  candidatura.viceNome = nomeSeguro(nomeVice, 'Vice-presidente');
  candidatura.confirmadaEm = new Date();
  await eleicao.save();
  return { ok: true, candidatura, tipoEleicao: eleicao.tipoEleicao || 'geral' };
}

async function publicarCampanha(idGrupo, autorRaw, texto, sock = null, alternates = []) {
  const autorId = await chaveUsuario([autorRaw, ...alternates], idGrupo);
  const eleicao = await obterEleicaoAberta(idGrupo, sock);
  if (!eleicao) return { ok: false, motivo: 'SEM_ELEICAO' };
  if (faseAtual(eleicao) !== 'campanha' || fimDaFase(eleicao).getTime() <= Date.now()) {
    return { ok: false, motivo: 'FORA_DA_CAMPANHA' };
  }
  if (!autorId || String(texto || '').trim().length < 5) {
    return { ok: false, motivo: 'TEXTO_INVALIDO' };
  }
  const candidatura = eleicao.candidaturas.find(c =>
    c.viceAceitou && (eleicao.tipoEleicao === 'vice'
      ? c.viceId === autorId
      : (c.presidenteId === autorId || c.viceId === autorId))
  );
  if (!candidatura) return { ok: false, motivo: 'NAO_E_CANDIDATO' };
  candidatura.campanha = String(texto).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500);
  candidatura.campanhaEm = new Date();
  await eleicao.save();
  return { ok: true, candidatura, tipoEleicao: eleicao.tipoEleicao || 'geral' };
}

function idCandidatoEleicao(eleicao, candidatura) {
  return eleicao?.tipoEleicao === 'vice'
    ? candidatura?.viceId
    : candidatura?.presidenteId;
}

function nomeCandidatoEleicao(eleicao, candidatura) {
  return eleicao?.tipoEleicao === 'vice'
    ? candidatura?.viceNome
    : candidatura?.presidenteNome + ' / ' + candidatura?.viceNome;
}

function chapasElegiveis(eleicao) {
  let chapas = (eleicao.candidaturas || []).filter(c => c.viceAceitou);
  if (Number(eleicao.rodadaAtual || 1) >= 2 && Array.isArray(eleicao.candidaturasSegundoTurnoIds)) {
    const finalistas = new Set(eleicao.candidaturasSegundoTurnoIds);
    chapas = chapas.filter(c => finalistas.has(idCandidatoEleicao(eleicao, c)));
  }
  return chapas;
}

async function solicitarVoto(sock, idGrupo, eleitorRaw, alternates = []) {
  const eleicao = await obterEleicaoAberta(idGrupo, sock);
  if (!eleicao) return { ok: false, motivo: 'SEM_ELEICAO' };
  if (!['votacao', 'segundo_turno'].includes(faseAtual(eleicao)) ||
      fimDaFase(eleicao).getTime() <= Date.now()) {
    return { ok: false, motivo: 'FORA_DA_VOTACAO' };
  }
  const eleitor = await chaveUsuario([eleitorRaw, ...alternates], idGrupo);
  if (!eleitor) return { ok: false, motivo: 'ELEITOR_INVALIDO' };
  const hashElegibilidade = hashPublicoEleitor(idGrupo, eleicao._id, eleitor);
  if (!(eleicao.eleitoresHashes || []).includes(hashElegibilidade)) {
    return { ok: false, motivo: 'NAO_ELEITOR' };
  }
  const metadados = await obterMetadadosGrupo(sock, idGrupo);
  if (!(await usuarioPertenceAoGrupo(sock, idGrupo, [eleitor], metadados))) {
    return { ok: false, motivo: 'NAO_ELEITOR' };
  }
  const chapas = await filtrarChapasComMembrosAtivos(sock, eleicao, metadados);
  if (!chapas.length) return { ok: false, motivo: 'SEM_CHAPAS' };
  return { ok: true, eleicao, chapas };
}

async function votarPorCodigo(sock, codigo, eleitorRaw, alternates = [], opcaoRaw) {
  const codigoSeguro = String(codigo || '').trim().toUpperCase();
  const eleicao = await RepublicaEleicao.findOne({ codigo: codigoSeguro, status: 'aberta' });
  if (!eleicao) return { ok: false, motivo: 'ELEICAO_NAO_ENCONTRADA' };
  await garantirVotosAnonimos();

  if (!['votacao', 'segundo_turno'].includes(faseAtual(eleicao)) ||
      fimDaFase(eleicao).getTime() <= Date.now()) {
    return { ok: false, motivo: 'FORA_DA_VOTACAO' };
  }

  const eleitor = await chaveUsuario([eleitorRaw, ...alternates], eleicao.idGrupo);
  if (!eleitor) return { ok: false, motivo: 'ELEITOR_INVALIDO' };
  const hashElegibilidade = hashPublicoEleitor(eleicao.idGrupo, eleicao._id, eleitor);
  if (!(eleicao.eleitoresHashes || []).includes(hashElegibilidade)) {
    return { ok: false, motivo: 'NAO_ELEITOR' };
  }
  const metadados = await obterMetadadosGrupo(sock, eleicao.idGrupo);
  if (!(await usuarioPertenceAoGrupo(sock, eleicao.idGrupo, [eleitor], metadados))) {
    return { ok: false, motivo: 'NAO_ELEITOR' };
  }

  const chapas = await filtrarChapasComMembrosAtivos(sock, eleicao, metadados);
  if (!chapas.length) return { ok: false, motivo: 'SEM_CHAPAS' };

  let candidatoId = null;
  let votoAprovacao = null;
  const opcao = Number(opcaoRaw);
  if (!Number.isInteger(opcao)) return { ok: false, motivo: 'OPCAO_INVALIDA' };

  if (eleicao.tipoVotacao === 'aprovacao') {
    if (![1, 2].includes(opcao)) return { ok: false, motivo: 'OPCAO_INVALIDA' };
    votoAprovacao = opcao === 1 ? 'aprovar' : 'rejeitar';
  } else {
    if (opcao < 1 || opcao > chapas.length) return { ok: false, motivo: 'OPCAO_INVALIDA' };
    candidatoId = idCandidatoEleicao(eleicao, chapas[opcao - 1]);
  }

  const eleitorHash = hashCedulaEleitor(eleicao.idGrupo, eleicao._id, eleitor);
  const filtroCedula = { idEleicao: eleicao._id, eleitorHash };
  const actualizacaoCedula = {
    $set: { idGrupo: eleicao.idGrupo, candidatoId, votoAprovacao, votadoEm: new Date() },
    $setOnInsert: { idEleicao: eleicao._id, eleitorHash },
  };
  try {
    await RepublicaVoto.findOneAndUpdate(
      filtroCedula,
      actualizacaoCedula,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // Duas mensagens simultâneas do mesmo eleitor podem competir pelo upsert.
    // O índice único assegura uma única cédula; neste caso repetimos como update.
    if (error?.code !== 11000) throw error;
    const actualizado = await RepublicaVoto.findOneAndUpdate(
      filtroCedula,
      { $set: actualizacaoCedula.$set },
      { upsert: false, new: true }
    );
    if (!actualizado) throw error;
  }
  return {
    ok: true,
    fase: faseAtual(eleicao),
    alteravelAte: fimDaFase(eleicao),
    chapaUnica: eleicao.tipoVotacao === 'aprovacao',
  };
}

async function consultarEleicao(idGrupo, sock = null) {
  const eleicao = await obterEleicaoAberta(idGrupo, sock);
  if (!eleicao) return null;
  const votos = await RepublicaVoto.countDocuments({ idEleicao: eleicao._id });
  return { eleicao, votos, quorum: calcularQuorumMinimo(eleicao.totalEleitores, eleicao.quorumMinimo) };
}

async function avisar(sock, idGrupo, texto, extra = {}) {
  if (sock && sock.sendMessage) {
    await sock.sendMessage(idGrupo, { text: texto, ...extra }).catch(() => {});
  }
}

async function encerrarSemResultado(sock, eleicao, status, titulo, detalhe, agora = new Date()) {
  eleicao.status = status;
  eleicao.motivoEncerramento = detalhe;
  eleicao.encerradaEm = agora;
  await eleicao.save();
  await RepublicaEstado.updateOne({ idGrupo: eleicao.idGrupo }, { $set: { eleicaoAtualId: null } });
  await avisar(sock, eleicao.idGrupo,
    '🗳️ *' + titulo + '*\n\n' + detalhe +
    '\n\nUma nova eleição poderá ser iniciada automaticamente em 30 minutos.');
  return { status };
}

async function filtrarChapasComMembrosAtivos(sock, eleicao, metadadosExistentes = null) {
  if (!sock) return chapasElegiveis(eleicao);
  const metadados = metadadosExistentes || await obterMetadadosGrupo(sock, eleicao.idGrupo);
  const validas = [];
  for (const chapa of chapasElegiveis(eleicao)) {
    const presidenteAtivo = await usuarioPertenceAoGrupo(sock, eleicao.idGrupo, [chapa.presidenteId], metadados);
    const viceAtivo = await usuarioPertenceAoGrupo(sock, eleicao.idGrupo, [chapa.viceId], metadados);
    if (presidenteAtivo && viceAtivo) validas.push(chapa);
  }
  return validas;
}

async function avancarFase(sock, eleicao, fase, agora, duracao, texto) {
  eleicao.fase = fase;
  eleicao.faseIniciaEm = agora;
  eleicao.faseEncerraEm = new Date(agora.getTime() + duracao);
  eleicao.encerraEm = eleicao.faseEncerraEm;
  await eleicao.save();
  await avisar(sock, eleicao.idGrupo, texto +
    '\n\nEncerra em: *' + eleicao.faseEncerraEm.toLocaleString('pt-BR') + '*');
  return { status: fase, encerraEm: eleicao.faseEncerraEm };
}

async function processarEleicao(sock, idGrupo, agora = new Date()) {
  const eleicao = await obterEleicaoAberta(idGrupo, sock);
  if (!eleicao || fimDaFase(eleicao).getTime() > agora.getTime()) return null;

  const fase = faseAtual(eleicao);
  if (fase === 'candidaturas') {
    const chapas = await filtrarChapasComMembrosAtivos(sock, eleicao);
    if (!chapas.length) {
      return encerrarSemResultado(sock, eleicao, 'sem_candidatos', 'ELEIÇÃO SEM CHAPAS VÁLIDAS',
        'Nenhuma chapa completa e confirmada permaneceu elegível durante o prazo de candidatura.', agora);
    }
    return avancarFase(sock, eleicao, 'campanha', agora, DURACAO_CAMPANHA_MS,
      '📣 *PERÍODO DE CAMPANHA ABERTO*\n\nAs chapas confirmadas podem apresentar propostas e divulgar as suas campanhas. Use /republica campanha <texto> para publicar uma mensagem oficial.');
  }

  if (fase === 'campanha') {
    const chapas = await filtrarChapasComMembrosAtivos(sock, eleicao);
    if (!chapas.length) {
      return encerrarSemResultado(sock, eleicao, 'sem_candidatos', 'ELEIÇÃO SEM CHAPAS VÁLIDAS',
        'Não restou nenhuma chapa com presidente e vice ainda integrantes do grupo.', agora);
    }
    eleicao.tipoVotacao = chapas.length === 1 ? 'aprovacao' : 'chapas';
    await eleicao.save();
    return avancarFase(sock, eleicao, 'votacao', agora, DURACAO_VOTACAO_MS,
      '🗳️ *VOTAÇÃO ABERTA*\n\nA votação é individual e privada. Envie /republica votar no grupo para receber por mensagem privada as opções e o código da eleição. Não marque candidatos no grupo.');
  }

  if (fase !== 'votacao' && fase !== 'segundo_turno') return null;

  await garantirVotosAnonimos();
  const chapas = await filtrarChapasComMembrosAtivos(sock, eleicao);
  const idsChapas = new Set(chapas.map(c => idCandidatoEleicao(eleicao, c)));
  const votos = await RepublicaVoto.find({ idEleicao: eleicao._id }).lean();
  const votosValidos = chapas.length ? votos.filter(v => eleicao.tipoVotacao === 'aprovacao'
    ? ['aprovar', 'rejeitar'].includes(v.votoAprovacao)
    : Boolean(v.candidatoId && idsChapas.has(v.candidatoId))
  ) : [];
  const totalVotos = votosValidos.length;
  const quorum = calcularQuorumMinimo(eleicao.totalEleitores, eleicao.quorumMinimo);
  if (!totalVotos) {
    return encerrarSemResultado(sock, eleicao, 'sem_votos', 'ELEIÇÃO SEM VOTOS',
      'Nenhuma cédula válida foi entregue antes do encerramento da votação.', agora);
  }
  if (totalVotos < quorum) {
    return encerrarSemResultado(sock, eleicao, 'sem_quorum', 'ELEIÇÃO SEM QUÓRUM',
      'Foram registados ' + totalVotos + ' votos, mas eram necessários pelo menos ' + quorum +
      ' votos de um eleitorado de ' + eleicao.totalEleitores + ' membros.', agora);
  }

  let chapaVencedora = null;
  let votosVencedora = 0;
  let segundoTurno = false;
  let aprovacao = null;

  if (eleicao.tipoVotacao === 'aprovacao') {
    const aprovar = votosValidos.filter(v => v.votoAprovacao === 'aprovar').length;
    const rejeitar = votosValidos.filter(v => v.votoAprovacao === 'rejeitar').length;
    aprovacao = { aprovar, rejeitar };
    if (aprovar <= rejeitar) {
      return encerrarSemResultado(sock, eleicao, 'rejeitada', 'CHAPA REJEITADA',
        'A chapa única recebeu ' + aprovar + ' votos favoráveis e ' + rejeitar +
        ' contrários. A eleição não conferiu mandato.', agora);
    }
    chapaVencedora = chapas[0];
    votosVencedora = aprovar;
  } else {
    const contagem = new Map();
    for (const voto of votosValidos) {
      if (!voto.candidatoId) continue;
      contagem.set(voto.candidatoId, (contagem.get(voto.candidatoId) || 0) + 1);
    }
    const ranking = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranking.length) {
      return encerrarSemResultado(sock, eleicao, 'sem_votos', 'ELEIÇÃO SEM VOTOS',
        'Não foram encontrados votos válidos para as chapas elegíveis.', agora);
    }
    const maior = ranking[0][1];
    const finalistas = selecionarFinalistasSegundoTurno(ranking, totalVotos);
    if (Number(eleicao.rodadaAtual || 1) < 2 && finalistas.length >= 2) {
      eleicao.resultadoPrimeiraRodada = ranking.map(([candidatoId, total]) => ({ candidatoId, votos: total }));
      eleicao.votosPrimeiraRodada = totalVotos;
      eleicao.rodadaAtual = 2;
      eleicao.tipoVotacao = 'chapas';
      eleicao.fase = 'segundo_turno';
      eleicao.candidaturasSegundoTurnoIds = finalistas;
      eleicao.faseIniciaEm = agora;
      eleicao.faseEncerraEm = new Date(agora.getTime() + DURACAO_SEGUNDO_TURNO_MS);
      eleicao.encerraEm = eleicao.faseEncerraEm;
      await RepublicaVoto.deleteMany({ idEleicao: eleicao._id });
      await eleicao.save();
      const nomes = chapas.filter(c => finalistas.includes(idCandidatoEleicao(eleicao, c)))
        .map(c => nomeCandidatoEleicao(eleicao, c)).join('\n');
      await avisar(sock, idGrupo,
        '⚖️ *SEGUNDO TURNO*\n\nNenhuma candidatura alcançou maioria absoluta na primeira votação. As candidaturas finalistas seguem para o segundo turno:\n' +
        nomes + '\n\nOs votos anteriores foram encerrados e uma nova cédula será emitida. Solicite-a com /republica votar no grupo.\n' +
        'Código da eleição: *' + eleicao.codigo + '*\n\nEncerra em: *' + eleicao.faseEncerraEm.toLocaleString('pt-BR') + '*');
      return { status: 'segundo_turno', finalistas };
    }
    if (Number(eleicao.rodadaAtual || 1) >= 2 && ranking.length > 1 && ranking[0][1] === ranking[1][1]) {
      return encerrarSemResultado(sock, eleicao, 'empate', 'EMPATE NO SEGUNDO TURNO',
        'O segundo turno terminou empatado. Nenhuma chapa foi declarada vencedora; uma nova eleição será convocada.', agora);
    }
    chapaVencedora = chapas.find(c => idCandidatoEleicao(eleicao, c) === ranking[0][0]);
    votosVencedora = maior;
    segundoTurno = Number(eleicao.rodadaAtual || 1) >= 2;
  }

  if (!chapaVencedora) {
    return encerrarSemResultado(sock, eleicao, 'sem_candidatos', 'CHAPA VENCEDORA INDISPONÍVEL',
      'A chapa mais votada deixou de cumprir os requisitos de participação. Uma nova eleição será convocada.', agora);
  }

  const estado = await RepublicaEstado.findOne({ idGrupo });
  const tipoEleicaoVice = eleicao.tipoEleicao === 'vice';
  if (tipoEleicaoVice) {
    const presidenteAindaAtivo = await usuarioPertenceAoGrupo(sock, idGrupo, [chapaVencedora.presidenteId]);
    if (!presidenteAindaAtivo) {
      return encerrarSemResultado(sock, eleicao, 'sem_candidatos', 'ELEIÇÃO COMPLEMENTAR CANCELADA',
        'O presidente deixou o grupo durante a eleição complementar. Uma eleição geral será convocada.', agora);
    }
    await RepublicaEstado.updateOne(
      { idGrupo, 'governo.presidenteId': chapaVencedora.presidenteId },
      { $set: {
        'governo.viceId': chapaVencedora.viceId,
        'governo.viceNome': chapaVencedora.viceNome,
        'governo.viceEleitoEm': agora,
        'governo.viceVagaDesde': null,
        eleicaoAtualId: null,
      } }
    );
  } else {
    const numeroMandato = (estado && estado.governo ? estado.governo.numeroMandato : 0) + 1;
    const mandatoId = idGrupo + ':' + numeroMandato + ':' + agora.getTime();
    await RepublicaEstado.findOneAndUpdate(
      { idGrupo },
      { $set: {
      'governo.presidenteId': chapaVencedora.presidenteId,
      'governo.viceId': chapaVencedora.viceId,
      'governo.presidenteNome': chapaVencedora.presidenteNome,
      'governo.viceNome': chapaVencedora.viceNome,
      'governo.viceEleitoEm': agora,
      'governo.viceVagaDesde': null,
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
  }

  eleicao.status = 'encerrada';
  eleicao.fase = 'apurada';
  eleicao.encerradaEm = agora;
  eleicao.resultado = {
    cargo: tipoEleicaoVice ? 'vice' : 'presidencia',
    presidenteId: chapaVencedora.presidenteId,
    viceId: chapaVencedora.viceId,
    votos: votosVencedora,
    votosTotais: totalVotos,
    quorum,
    apuracao: aprovacao,
    primeiroTurno: eleicao.resultadoPrimeiraRodada || [],
    votosPrimeiroTurno: eleicao.votosPrimeiraRodada || 0,
    segundoTurno,
    apuradoEm: agora,
  };
  await eleicao.save();

  const textoResultado = tipoEleicaoVice
    ? '🗳️ *RESULTADO OFICIAL — ELEIÇÃO COMPLEMENTAR*\n\n' +
      '🏛️ Presidente em exercício: *' + chapaVencedora.presidenteNome + '*\n' +
      '🤝 Novo vice-presidente: *' + chapaVencedora.viceNome + '*\n' +
      '🗳️ Votos recebidos: *' + totalVotos + '*\n' +
      '📊 Quórum mínimo: *' + quorum + ' de ' + eleicao.totalEleitores + '*\n' +
      (aprovacao ? '✅ Aprovação: *' + aprovacao.aprovar + '* · ❌ Rejeição: *' + aprovacao.rejeitar + '*\n' : '') +
      (segundoTurno ? '⚖️ Resultado definido no segundo turno.\n' : '') +
      'O presidente e o mandato actual foram mantidos.'
    : '🇧🇷 *RESULTADO OFICIAL — MODO REPÚBLICA*\n\n' +
      '🏛️ Presidente: *' + chapaVencedora.presidenteNome + '*\n' +
      '🤝 Vice-presidente: *' + chapaVencedora.viceNome + '*\n' +
      '🗳️ Votos recebidos: *' + totalVotos + '*\n' +
      '📊 Quórum mínimo: *' + quorum + ' de ' + eleicao.totalEleitores + '*\n' +
      (aprovacao ? '✅ Aprovação: *' + aprovacao.aprovar + '* · ❌ Rejeição: *' + aprovacao.rejeitar + '*\n' : '') +
      (segundoTurno ? '⚖️ Resultado definido no segundo turno.\n' : '') +
      '⏳ Mandato: *24 horas*\n\nO governo tomou posse. As leis e alíquotas anteriores continuam em vigor.';
  await avisar(sock, idGrupo, textoResultado, { mentions: [chapaVencedora.presidenteId, chapaVencedora.viceId] });
  return { status: 'eleito', chapa: chapaVencedora, votos: totalVotos, segundoTurno };
}

async function cancelarEleicao(idGrupo, autorId, motivo = 'Cancelada por um administrador') {
  const eleicao = await RepublicaEleicao.findOne({ idGrupo, status: 'aberta' });
  if (!eleicao) return { ok: false, motivo: 'SEM_ELEICAO' };
  eleicao.status = 'cancelada';
  eleicao.canceladaPor = String(autorId || '');
  eleicao.motivoEncerramento = String(motivo || 'Sem motivo informado').slice(0, 250);
  eleicao.canceladaEm = new Date();
  eleicao.encerradaEm = new Date();
  eleicao.fase = 'cancelada';
  await eleicao.save();
  await RepublicaEstado.updateOne({ idGrupo }, { $set: { eleicaoAtualId: null } });
  return { ok: true, eleicao };
}

async function verificarCargos(sock, idGrupo, estadoAtual = null) {
  const estado = estadoAtual || await RepublicaEstado.findOne({ idGrupo });
  const governo = estado?.governo || {};
  if (!governo.presidenteId && !governo.viceId) return { alterado: false, estado };

  let meta;
  try {
    meta = await obterMetadadosGrupo(sock, idGrupo);
  } catch {
    return { alterado: false, estado, erro: 'METADADOS_INDISPONIVEIS' };
  }
  const presidenteAtivo = governo.presidenteId
    ? await usuarioPertenceAoGrupo(sock, idGrupo, [governo.presidenteId], meta)
    : false;
  const viceAtivo = governo.viceId
    ? await usuarioPertenceAoGrupo(sock, idGrupo, [governo.viceId], meta)
    : false;

  if (presidenteAtivo && (!governo.viceId || viceAtivo)) return { alterado: false, estado };
  if (!presidenteAtivo && viceAtivo) {
    await RepublicaEleicao.updateMany(
      { idGrupo, status: 'aberta', tipoEleicao: 'vice' },
      { $set: {
        status: 'cancelada',
        fase: 'cancelada',
        motivoEncerramento: 'A Presidência mudou durante a eleição complementar.',
        encerradaEm: new Date(),
        canceladaEm: new Date(),
      } }
    );
    await RepublicaEstado.updateOne({ idGrupo }, { $set: {
      'governo.presidenteId': governo.viceId,
      'governo.presidenteNome': governo.viceNome || 'Presidente em exercício',
      'governo.viceId': null,
      'governo.viceNome': null,
      'governo.viceVagaDesde': new Date(),
    } });
    await avisar(sock, idGrupo,
      '🏛️ *SUCESSÃO CONSTITUCIONAL AUTOMÁTICA*\n\nO presidente deixou o grupo. O vice assumiu e uma eleição complementar escolherá um novo vice-presidente.');
    return { alterado: true, sucessao: true };
  }

  if (presidenteAtivo && !viceAtivo) {
    await RepublicaEstado.updateOne({ idGrupo }, { $set: {
      'governo.viceId': null,
      'governo.viceNome': null,
      'governo.viceVagaDesde': new Date(),
    } });
    await avisar(sock, idGrupo,
      '⚠️ *VICE-PRESIDÊNCIA VAGA*\n\nO vice-presidente deixou o grupo. O presidente permanece em exercício e será aberta uma eleição complementar apenas para a vice-presidência.');
    return { alterado: true, viceVago: true };
  }

  await RepublicaEleicao.updateMany(
    { idGrupo, status: 'aberta', tipoEleicao: 'vice' },
    { $set: {
      status: 'cancelada',
      fase: 'cancelada',
      motivoEncerramento: 'O governo deixou de ter um presidente em exercício.',
      encerradaEm: new Date(),
      canceladaEm: new Date(),
    } }
  );
  await RepublicaEstado.updateOne({ idGrupo }, { $set: {
    'governo.presidenteId': null,
    'governo.presidenteNome': null,
    'governo.viceId': null,
    'governo.viceNome': null,
    'governo.viceVagaDesde': null,
    'governo.mandatoAte': new Date(),
  } });
  await avisar(sock, idGrupo,
    '🏛️ *GOVERNO SEM REPRESENTANTES*\n\nPresidente e vice já não fazem parte do grupo. Os cargos foram declarados vagos e uma nova eleição será convocada.');
  return { alterado: true, governoVago: true };
}

module.exports = {
  DURACAO_ELEICAO_MS,
  DURACAO_CANDIDATURA_MS,
  DURACAO_CAMPANHA_MS,
  DURACAO_VOTACAO_MS,
  DURACAO_SEGUNDO_TURNO_MS,
  DURACAO_MANDATO_MS,
  EMPATE_PRORROGACAO_MS,
  NOVA_ELEICAO_SEM_CANDIDATOS_MS,
  QUORUM_MINIMO,
  calcularQuorumMinimo,
  selecionarFinalistasSegundoTurno,
  hashPublicoEleitor,
  hashCedulaEleitor,
  abrirEleicao,
  abrirEleicaoVice,
  obterEleicaoAberta,
  candidatar,
  candidatarVice,
  aceitarVice,
  idCandidatoEleicao,
  nomeCandidatoEleicao,
  chapasElegiveis,
  publicarCampanha,
  solicitarVoto,
  votarPorCodigo,
  consultarEleicao,
  processarEleicao,
  cancelarEleicao,
  verificarCargos,
};
