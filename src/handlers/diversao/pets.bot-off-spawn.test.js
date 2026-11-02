'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const GrupoConfig = require('../../models/GrupoConfig');
const PetSpawn = require('../../models/PetSpawn');
const pets = require('./pets');

const groupJid = '120363000000000000@g.us';
const originals = {
  findOne: GrupoConfig.findOne,
  obterOuCriar: PetSpawn.obterOuCriar,
  findOneAndUpdate: PetSpawn.findOneAndUpdate,
};

test.after(() => {
  GrupoConfig.findOne = originals.findOne;
  PetSpawn.obterOuCriar = originals.obterOuCriar;
  PetSpawn.findOneAndUpdate = originals.findOneAndUpdate;
});

test('triggerSpawn não cria nem anuncia personagem quando /bot off está ativo', async () => {
  let reservaTentada = false;
  let mensagemEnviada = false;

  GrupoConfig.findOne = () => ({
    select() { return this; },
    async lean() { return { botAtivo: false }; },
  });
  PetSpawn.obterOuCriar = async () => {
    reservaTentada = true;
  };
  PetSpawn.findOneAndUpdate = async () => {
    reservaTentada = true;
    return {};
  };

  const sock = {
    async sendMessage() {
      mensagemEnviada = true;
    },
  };

  const resultado = await pets.triggerSpawn(sock, groupJid);

  assert.equal(resultado, false);
  assert.equal(reservaTentada, false, 'não deve reservar um personagem no banco');
  assert.equal(mensagemEnviada, false, 'não deve anunciar personagem no grupo');
});

test('a checagem respeita botAtivo e mantém o padrão ligado quando não há configuração', async () => {
  GrupoConfig.findOne = () => ({
    select() { return this; },
    async lean() { return null; },
  });
  assert.equal(await pets.grupoPodeReceberSpawn(groupJid), true);

  GrupoConfig.findOne = () => ({
    select() { return this; },
    async lean() { return { botAtivo: true }; },
  });
  assert.equal(await pets.grupoPodeReceberSpawn(groupJid), true);

  GrupoConfig.findOne = () => ({
    select() { return this; },
    async lean() { return { botAtivo: false }; },
  });
  assert.equal(await pets.grupoPodeReceberSpawn(groupJid), false);
});
