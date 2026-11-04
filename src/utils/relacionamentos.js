'use strict';

const TIPOS_VALIDOS = new Set(['namoro', 'casamento']);

function chaveRelacionamento(idGrupo, jidA, jidB) {
  return [idGrupo, ...[jidA, jidB].sort()].join('|');
}

function timestampValido(value) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function nomeParticipanteSeguro(value) {
  if (typeof value !== 'string') return 'Participante';
  const nome = value.trim().replace(/[\r\n]+/g, ' ').slice(0, 80);
  if (!nome || /^@?\+?[\d\s().-]+$/.test(nome)) return 'Participante';
  if (/^\d+@(s\.whatsapp\.net|lid)$/i.test(nome)) return 'Participante';
  if (/@(s\.whatsapp\.net|lid)$/i.test(nome)) return 'Participante';
  return nome;
}

function normalizarRegistro(registro) {
  if (!registro || typeof registro !== 'object') return null;

  const idGrupo = String(registro.idGrupo || '').trim();
  const originalA = String(registro.jidA || '').trim();
  const originalB = String(registro.jidB || '').trim();
  const tipo = String(registro.tipo || '').trim();
  const desde = timestampValido(registro.desde);

  if (!idGrupo.endsWith('@g.us') || !originalA || !originalB ||
      originalA === originalB || !TIPOS_VALIDOS.has(tipo) || desde === null) {
    return null;
  }

  const [jidA, jidB] = [originalA, originalB].sort();
  const nomePorJid = new Map([
    [originalA, nomeParticipanteSeguro(registro.nomeA)],
    [originalB, nomeParticipanteSeguro(registro.nomeB)],
  ]);

  return {
    chave: chaveRelacionamento(idGrupo, jidA, jidB),
    idGrupo,
    jidA,
    jidB,
    participantes: [jidA, jidB],
    tipo,
    desde: new Date(desde),
    xpCasal: Math.max(0, Number(registro.xpCasal) || 0),
    nomeA: nomePorJid.get(jidA),
    nomeB: nomePorJid.get(jidB),
  };
}

function paraEstadoEmMemoria(registro) {
  const normalizado = normalizarRegistro(registro);
  if (!normalizado) return null;

  return {
    tipo: normalizado.tipo,
    nomeA: normalizado.nomeA,
    nomeB: normalizado.nomeB,
    jidA: normalizado.jidA,
    jidB: normalizado.jidB,
    desde: normalizado.desde.getTime(),
    xpCasal: normalizado.xpCasal,
    idGrupo: normalizado.idGrupo,
  };
}

async function migrarRelacionamentosLegados({ Usuario, Relacionamento, log = console.log }) {
  const usuarios = await Usuario.find(
    {
      casadoCom: { $type: 'string', $ne: '' },
      casadoGrupo: { $type: 'string', $ne: '' },
      casadoTipo: { $in: ['namoro', 'casamento'] },
      casadoDesde: { $type: 'date' },
    },
    {
      idWhatsApp: 1,
      casadoCom: 1,
      casadoTipo: 1,
      casadoDesde: 1,
      casadoGrupo: 1,
      xpCasal: 1,
      nome: 1,
      displayName: 1,
    }
  ).lean();

  const porId = new Map(usuarios.map(usuario => [usuario.idWhatsApp, usuario]));
  let importados = 0;
  let ignorados = 0;

  for (const usuario of usuarios) {
    const parceiro = porId.get(usuario.casadoCom);
    if (!parceiro || usuario.idWhatsApp >= parceiro.idWhatsApp) continue;

    const dataA = timestampValido(usuario.casadoDesde);
    const dataB = timestampValido(parceiro.casadoDesde);
    const reciproco = parceiro.casadoCom === usuario.idWhatsApp;
    const consistente =
      reciproco &&
      usuario.casadoGrupo === parceiro.casadoGrupo &&
      usuario.casadoTipo === parceiro.casadoTipo &&
      dataA !== null &&
      dataB !== null &&
      dataA === dataB;

    if (!consistente) {
      ignorados++;
      continue;
    }

    const registro = normalizarRegistro({
      idGrupo: usuario.casadoGrupo,
      jidA: usuario.idWhatsApp,
      jidB: parceiro.idWhatsApp,
      tipo: usuario.casadoTipo,
      desde: usuario.casadoDesde,
      xpCasal: Math.max(Number(usuario.xpCasal) || 0, Number(parceiro.xpCasal) || 0),
      nomeA: usuario.displayName || usuario.nome,
      nomeB: parceiro.displayName || parceiro.nome,
    });
    if (!registro) {
      ignorados++;
      continue;
    }

    try {
      const resultado = await Relacionamento.updateOne(
        { chave: registro.chave },
        { $setOnInsert: registro },
        { upsert: true }
      );
      if (resultado.upsertedCount > 0) importados++;
    } catch (error) {
      // Um índice único por participante/grupo pode revelar um registro legado
      // conflitante. Não substituir automaticamente um relacionamento ativo.
      if (error?.code === 11000) {
        ignorados++;
        continue;
      }
      throw error;
    }
  }

  if (importados || ignorados) {
    log(`[relacionamento] Migração legada: ${importados} relacionamento(s) importado(s), ${ignorados} registro(s) inconsistente(s) ignorado(s).`);
  }
  return { importados, ignorados };
}

async function hidratarRelacionamentos({
  Usuario,
  Relacionamento,
  relacionamentos,
  xpCasais,
  log = console.log,
}) {
  if (!relacionamentos || typeof relacionamentos.clear !== 'function' ||
      typeof relacionamentos.set !== 'function') {
    throw new TypeError('O mapa de relacionamentos precisa ser um Map.');
  }

  // Garante que as restrições de unicidade estejam ativas antes da migração.
  if (typeof Relacionamento.createIndexes === 'function') {
    await Relacionamento.createIndexes();
  }

  const migracao = await migrarRelacionamentosLegados({ Usuario, Relacionamento, log });
  const documentos = await Relacionamento.find({}).lean();

  const reconstruido = new Map();
  const participantesOcupados = new Set();
  let invalidos = 0;

  for (const documento of documentos) {
    const estado = paraEstadoEmMemoria(documento);
    if (!estado) {
      invalidos++;
      continue;
    }

    const chave = chaveRelacionamento(estado.idGrupo, estado.jidA, estado.jidB);
    const participanteA = `${estado.idGrupo}|${estado.jidA}`;
    const participanteB = `${estado.idGrupo}|${estado.jidB}`;

    if (participantesOcupados.has(participanteA) || participantesOcupados.has(participanteB)) {
      invalidos++;
      continue;
    }

    reconstruido.set(chave, estado);
    participantesOcupados.add(participanteA);
    participantesOcupados.add(participanteB);
  }

  // Só troca o estado em memória depois que a leitura inteira do MongoDB deu certo.
  relacionamentos.clear();
  for (const [chave, estado] of reconstruido) relacionamentos.set(chave, estado);

  if (xpCasais && typeof xpCasais.clear === 'function' && typeof xpCasais.set === 'function') {
    xpCasais.clear();
    for (const [chave, estado] of reconstruido) xpCasais.set(chave, estado.xpCasal || 0);
  }

  if (invalidos) {
    log(`[relacionamento] ${invalidos} registro(s) inválido(s) ignorado(s) durante a restauração.`);
  }
  log(`♻️ [relacionamento] ${reconstruido.size} relacionamento(s) ativo(s) restaurado(s) do MongoDB.`);

  return { total: reconstruido.size, invalidos, migracao };
}

function podeConverterNamoroEmCasamento({
  tipoPedido,
  chave,
  relacionamento,
  relA,
  relB,
  agora = Date.now(),
}) {
  if (tipoPedido !== 'casamento' || relacionamento?.tipo !== 'namoro') return false;
  if (!chave || relA?.key !== chave || relB?.key !== chave) return false;

  const desde = Number(relacionamento.desde) || new Date(relacionamento.desde).getTime();
  const tresDiasMs = 3 * 24 * 60 * 60 * 1000;
  return Number.isFinite(desde) && agora - desde >= tresDiasMs;
}

module.exports = {
  TIPOS_VALIDOS,
  chaveRelacionamento,
  normalizarRegistro,
  paraEstadoEmMemoria,
  migrarRelacionamentosLegados,
  hidratarRelacionamentos,
  podeConverterNamoroEmCasamento,
};
