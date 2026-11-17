'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolverDestinoInventarioAdmin,
  listarInventarioAdmin,
  slugPersonalizado,
} = require('./adminInventory');

test('encaminha cada catálogo administrativo para o inventário real do jogo', () => {
  const casos = [
    ['loja-comida', 'pizza', 'global', 'inventory'],
    ['loja-petcomida', 'racao', 'grupo', 'itensPets'],
    ['loja-pet', 'cachorro', 'grupo', 'itensPets'],
    ['casal-equipaveis', 'camisetacasal', 'global', 'inventory'],
    ['pesca-varas', 'vara_bambu', 'grupo', 'itensPesca'],
    ['pesca-iscas', 'isca_minhoca', 'grupo', 'itensPesca'],
    ['pesca-achados', 'peixe_pequeno', 'grupo', 'itensPesca'],
    ['roubo-ferramentas', 'dinamite', 'grupo', 'itensRoubo'],
    ['roubo-banco', 'clone_cartao', 'grupo', 'itensRouboBanco'],
    ['seguranca', 'cofre', 'grupo', 'itensSec'],
  ];

  for (const [area, key, escopo, campo] of casos) {
    const destino = resolverDestinoInventarioAdmin(area, key);
    assert.ok(destino, `${area}/${key} deve existir no catálogo real`);
    assert.equal(destino.escopo, escopo, `${area}/${key} deve ir para ${escopo}`);
    assert.equal(destino.campo, campo, `${area}/${key} deve usar ${campo}`);
    assert.ok(destino.nome);
  }
});

test('rejeita chaves que não pertencem à área escolhida', () => {
  assert.equal(resolverDestinoInventarioAdmin('pesca-varas', 'peixe_pequeno'), null);
  assert.equal(resolverDestinoInventarioAdmin('roubo-banco', 'dinamite'), null);
  assert.equal(resolverDestinoInventarioAdmin('loja-comida', 'racao'), null);
  assert.equal(resolverDestinoInventarioAdmin('area-desconhecida', 'pizza'), null);
});

test('cria chave segura para itens personalizados no inventário global', () => {
  assert.equal(slugPersonalizado('🌟 Poção de Teste +1'), 'pocao_de_teste_1');
  assert.equal(resolverDestinoInventarioAdmin('__personalizado__', 'Poção Rara')?.campo, 'inventory');
  assert.equal(resolverDestinoInventarioAdmin('__personalizado__', '💎') , null);
});

test('lista inventário global, campos específicos do grupo e itens legados', () => {
  const itens = listarInventarioAdmin(
    { inventory: { pizza: 2, camisetacasal: 1, custom_item: 3 } },
    {
      itensPets: new Map([['racao', 4]]),
      itensPesca: { peixe_pequeno: 5 },
      itensRoubo: { dinamite: 1 },
      itensRouboBanco: {},
      itensSec: { cofre: 2 },
      inventario: [{ nome: 'Item antigo', quantidade: 7 }],
    }
  );

  const find = (area, key) => itens.find(item => item.area === area && item.key === key);
  assert.equal(find('loja-comida', 'pizza').quantidade, 2);
  assert.equal(find('casal-equipaveis', 'camisetacasal').escopo, 'global');
  assert.equal(find('loja-petcomida', 'racao').quantidade, 4);
  assert.equal(find('pesca-achados', 'peixe_pequeno').quantidade, 5);
  assert.equal(find('roubo-ferramentas', 'dinamite').quantidade, 1);
  assert.equal(find('seguranca', 'cofre').quantidade, 2);
  assert.equal(find('__legado__', 'Item antigo').quantidade, 7);
});
