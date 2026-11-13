'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CarteiraGrupo = require('../../models/CarteiraGrupo');
const LidMapping = require('../../models/LidMapping');
const { getCarteira } = require('./prata');

test('fusão de carteiras PN/LID preserva o estado do sistema de roubo e polícia', async t => {
  const pn = '5511999999999@s.whatsapp.net';
  const lid = '987654321@lid';
  const grupo = '120363000000000000@g.us';
  const dataAntiga = new Date('2026-11-01T10:00:00.000Z');
  const dataNova = new Date('2026-11-06T10:00:00.000Z');
  const principal = {
    _id: 'carteira-pn',
    idWhatsApp: pn,
    gold: 900,
    xp: 200,
    ultimoRoubo: dataAntiga,
    ultimoRouboBanco: dataAntiga,
    prestoAte: dataAntiga,
    imunidadeRouboAte: dataAntiga,
    ultimaPolicia: dataAntiga,
    lastRobbedBy: '111111111@s.whatsapp.net',
    lastRobbedAmount: 10,
    lastRobbedAt: dataAntiga,
    pet: { petId: 'active-pet', type: 'lula', name: 'Pet ativo', level: 8 },
    pets: [
      { petId: 'pet-pn', type: 'arrogante', name: 'Coleção PN', level: 4 },
      { petId: 'active-pet', type: 'lula', name: 'Pet ativo', level: 8 },
    ],
    petShelter: {
      isSheltered: true,
      shelteredPet: { name: 'Pet antigo' },
      leftAt: dataAntiga,
    },
  };
  const secundaria = {
    _id: 'carteira-lid',
    idWhatsApp: lid,
    gold: 100,
    xp: 50,
    ultimoRoubo: dataNova,
    ultimoRouboBanco: dataNova,
    prestoAte: dataNova,
    imunidadeRouboAte: dataNova,
    ultimaPolicia: dataNova,
    lastRobbedBy: '222222222@lid',
    lastRobbedAmount: 75,
    lastRobbedAt: dataNova,
    pets: [{ petId: 'pet-lid', type: 'lula', name: 'Pet ativo LID', level: 8 }],
    petShelter: {
      isSheltered: true,
      shelteredPet: { petId: 'sheltered-pet', name: 'Pet mais recente', type: 'rodney' },
      leftAt: dataNova,
    },
  };

  const mappingQuery = {
    select() { return this; },
    async lean() { return [{ pn, lid }]; },
  };
  const walletQuery = {
    sort() { return this; },
    async lean() { return [principal, secundaria]; },
  };
  let updateRecebido;
  let exclusaoRecebida;

  t.mock.method(LidMapping, 'find', () => mappingQuery);
  t.mock.method(CarteiraGrupo, 'find', filtro => {
    assert.ok(filtro.idWhatsApp.$in.includes(pn));
    assert.ok(filtro.idWhatsApp.$in.includes(lid));
    assert.equal(filtro.idGrupo, grupo);
    return walletQuery;
  });
  t.mock.method(CarteiraGrupo, 'deleteMany', async filtro => {
    exclusaoRecebida = filtro;
    return { deletedCount: 1 };
  });
  t.mock.method(CarteiraGrupo, 'findByIdAndUpdate', async (id, update) => {
    updateRecebido = { id, update };
    return { ...principal, ...update.$set };
  });

  const resultado = await getCarteira(pn, grupo);

  assert.equal(updateRecebido.id, principal._id);
  assert.deepEqual(exclusaoRecebida, { _id: { $in: [secundaria._id] } });
  assert.equal(resultado.lastRobbedBy, secundaria.lastRobbedBy);
  assert.equal(resultado.lastRobbedAmount, secundaria.lastRobbedAmount);
  assert.equal(resultado.lastRobbedAt.getTime(), dataNova.getTime());
  assert.equal(resultado.petShelter.shelteredPet.name, 'Pet mais recente');
  assert.equal(resultado.pet.name, 'Pet ativo', 'o personagem ativo deve continuar ativo');
  assert.equal(resultado.pets.length, 3, 'coleção PN/LID deve ser unificada sem perder personagens');
  assert.deepEqual(new Set(resultado.pets.map(p => p.petId)), new Set(['pet-pn', 'active-pet', 'pet-lid']));
  assert.equal(resultado.petShelter.leftAt.getTime(), dataNova.getTime());
  for (const campo of ['ultimoRoubo', 'ultimoRouboBanco', 'prestoAte', 'imunidadeRouboAte', 'ultimaPolicia']) {
    assert.equal(resultado[campo].getTime(), dataNova.getTime(), campo);
  }
});
