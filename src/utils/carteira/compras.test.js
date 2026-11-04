'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const CarteiraGrupo = require('../../models/CarteiraGrupo');
const { comprarComGold, venderComGold } = require('./compras');

function compraParams(modeloInventario) {
  return {
    idWhatsApp: '5511999999999@s.whatsapp.net',
    idGrupo: '120363000000000000@g.us',
    preco: 50,
    descricaoGold: 'Compra: pizza',
    modeloInventario,
    filtroInventario: { idWhatsApp: '5511999999999@s.whatsapp.net' },
    campoInventario: 'inventory.pizza',
    quantidade: 1,
  };
}

test('compra confirmada permanece confirmada mesmo se endSession falhar', async t => {
  let endSessionCalls = 0;
  const session = {
    async withTransaction(callback) {
      await callback();
    },
    async endSession() {
      endSessionCalls++;
      throw new Error('falha simulada ao encerrar sessão');
    },
  };

  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(CarteiraGrupo, 'findOneAndUpdate', async () => ({ gold: 75 }));
  t.mock.method(console, 'error', () => {});

  const inventario = {
    async findOneAndUpdate() {
      return { inventory: { pizza: 1 } };
    },
  };

  const result = await comprarComGold(compraParams(inventario));

  assert.equal(result.ok, true);
  assert.equal(result.carteira.gold, 75);
  assert.equal(endSessionCalls, 1);
});

test('fallback de compra é usado e a falha ao abrir sessão fica diagnosticável', async t => {
  let walletCalls = 0;
  t.mock.method(mongoose, 'startSession', async () => {
    throw new Error('sessão não disponível');
  });
  t.mock.method(CarteiraGrupo, 'findOneAndUpdate', async () => {
    walletCalls++;
    return { gold: 75 };
  });
  t.mock.method(console, 'error', () => {});

  const inventario = {
    async findOneAndUpdate() {
      return { inventory: { pizza: 1 } };
    },
  };

  const result = await comprarComGold(compraParams(inventario));

  assert.equal(result.ok, true);
  assert.equal(walletCalls, 1);
});

test('compra sinaliza quando falham o crédito do item e o estorno do débito', async t => {
  let walletCalls = 0;
  t.mock.method(mongoose, 'startSession', async () => {
    throw new Error('standalone MongoDB');
  });
  t.mock.method(CarteiraGrupo, 'findOneAndUpdate', async () => {
    walletCalls++;
    if (walletCalls === 1) return { gold: 25 };
    throw new Error('falha simulada no estorno');
  });
  t.mock.method(console, 'error', () => {});

  const inventario = {
    async findOneAndUpdate() {
      throw new Error('falha simulada ao creditar item');
    },
  };

  const result = await comprarComGold(compraParams(inventario));

  assert.deepEqual(result, { ok: false, motivo: 'ESTORNO_FALHOU' });
  assert.equal(walletCalls, 2);
});

test('venda sinaliza quando falham o crédito de Prata e a devolução do item', async t => {
  let inventoryCalls = 0;
  t.mock.method(CarteiraGrupo, 'findOneAndUpdate', async () => {
    throw new Error('falha simulada ao creditar venda');
  });
  t.mock.method(console, 'error', () => {});

  const inventario = {
    async findOneAndUpdate() {
      inventoryCalls++;
      if (inventoryCalls === 1) return { inventory: { pizza: 0 } };
      throw new Error('falha simulada ao devolver item');
    },
  };

  const result = await venderComGold({
    idWhatsApp: '5511999999999@s.whatsapp.net',
    idGrupo: '120363000000000000@g.us',
    valorTotal: 25,
    descricaoGold: 'Venda: pizza',
    modeloInventario: inventario,
    filtroInventario: { idWhatsApp: '5511999999999@s.whatsapp.net' },
    campoInventario: 'inventory.pizza',
    quantidade: 1,
  });

  assert.deepEqual(result, { ok: false, motivo: 'ESTORNO_FALHOU' });
  assert.equal(inventoryCalls, 2);
});
