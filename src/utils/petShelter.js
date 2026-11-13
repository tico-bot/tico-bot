'use strict';

const ABRIGO_TEMPO_MAXIMO_MS = 20 * 60 * 1000;

/**
 * Filtro único para consultas do abrigo: o mesmo personagem só existe no grupo
 * em que a carteira foi criada. A data também impede resgates após a expiração.
 */
function filtroAbrigoDoGrupo(idGrupo, agora = new Date()) {
  if (typeof idGrupo !== 'string' || !idGrupo.trim()) {
    throw new TypeError('idGrupo é obrigatório para consultar o abrigo.');
  }

  const dataAtual = new Date(agora);
  if (!Number.isFinite(dataAtual.getTime())) {
    throw new TypeError('A data de referência do abrigo é inválida.');
  }

  return {
    idGrupo: idGrupo.trim().toLowerCase(),
    'petShelter.isSheltered': true,
    'petShelter.leftAt': {
      $gt: new Date(dataAtual.getTime() - ABRIGO_TEMPO_MAXIMO_MS),
    },
  };
}

/**
 * Remove do abrigo os personagens que completaram 20 minutos.
 * CarteiraGrupo armazena um abrigo por usuário e por grupo; a limpeza pode
 * percorrer todas as carteiras porque cada registro já carrega o próprio grupo.
 */
async function limparPetsExpiradosDoAbrigo(CarteiraGrupo, agora = new Date()) {
  if (!CarteiraGrupo || typeof CarteiraGrupo.updateMany !== 'function') {
    throw new TypeError('CarteiraGrupo precisa disponibilizar updateMany.');
  }

  const dataAtual = new Date(agora);
  if (!Number.isFinite(dataAtual.getTime())) {
    throw new TypeError('A data de referência do abrigo é inválida.');
  }

  // Abrigos novos sempre têm leftAt. Registros de transição sem data ganham
  // prazo a partir desta primeira limpeza, em vez de sumirem imediatamente.
  await CarteiraGrupo.updateMany(
    {
      'petShelter.isSheltered': true,
      $or: [
        { 'petShelter.leftAt': { $exists: false } },
        { 'petShelter.leftAt': null },
      ],
    },
    { $set: { 'petShelter.leftAt': dataAtual } }
  );

  const limite = new Date(dataAtual.getTime() - ABRIGO_TEMPO_MAXIMO_MS);
  const resultado = await CarteiraGrupo.updateMany(
    {
      'petShelter.isSheltered': true,
      'petShelter.leftAt': { $lte: limite },
    },
    {
      $set: {
        'petShelter.isSheltered': false,
        'petShelter.shelteredPet': null,
        'petShelter.leftAt': null,
      },
    }
  );

  return resultado?.modifiedCount ?? resultado?.nModified ?? 0;
}

module.exports = {
  ABRIGO_TEMPO_MAXIMO_MS,
  filtroAbrigoDoGrupo,
  limparPetsExpiradosDoAbrigo,
};
