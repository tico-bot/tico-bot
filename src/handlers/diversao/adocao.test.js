'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const AdocaoSolicitacao = require('../../models/AdocaoSolicitacao');
const Filho = require('../../models/Filho');
const Usuario = require('../../models/Usuario');
const RepublicaLicenca = require('../../models/RepublicaLicenca');
const social = require('../republica/social');
const filhosHandler = require('./filhos');

test('o pedido de adoção exige os dois responsáveis, prazo, código e criança', () => {
  const doc = new AdocaoSolicitacao({
    idGrupo: 'grupo@g.us',
    codigo: 'A1B2C3D4',
    solicitanteId: 'a@s.whatsapp.net',
    parceiroId: 'b@s.whatsapp.net',
    chaveCasal: 'a@s.whatsapp.net|b@s.whatsapp.net',
    nome: 'Luna',
    sexo: 'menina',
    personalidade: 'carinhosa',
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(doc.validateSync(), undefined);
  assert.deepEqual(AdocaoSolicitacao.schema.path('status').enumValues,
    ['pendente', 'processando', 'aceita', 'recusada', 'cancelada', 'expirada']);
  assert.ok(AdocaoSolicitacao.schema.path('codigo').options.unique);
  const indiceCasal = AdocaoSolicitacao.schema.indexes().find(([keys]) =>
    keys.idGrupo === 1 && keys.chaveCasal === 1
  );
  assert.ok(indiceCasal);
  assert.equal(indiceCasal[1].unique, true);
  assert.deepEqual(indiceCasal[1].partialFilterExpression.status.$in, ['pendente', 'processando']);
});

test('o registo de uma criança identifica adoção sem alterar o padrão biológico', () => {
  const doc = new Filho({
    jidA: 'a@s.whatsapp.net',
    jidB: 'b@s.whatsapp.net',
    idGrupo: 'grupo@g.us',
    nome: 'Luna',
    sexo: 'menina',
    personalidade: 'carinhosa',
  });
  assert.equal(doc.adotado, false);
  doc.adotado = true;
  doc.adotadoEm = new Date();
  assert.equal(doc.adotado, true);
  assert.equal(doc.validateSync(), undefined);
  assert.ok(Filho.schema.path('adocaoSolicitacaoId'));
  assert.ok(Filho.schema.indexes().some(([keys, options]) =>
    keys.adocaoSolicitacaoId === 1 && options.unique === true
  ));
});

test('a licença parental aceita adoção e mantém exactamente 48 horas', () => {
  assert.ok(RepublicaLicenca.schema.path('tipo').enumValues.includes('adocao'));
  assert.equal(social.LICENCA_MS, 48 * 60 * 60 * 1000);
  assert.equal(typeof social.registrarLicencasAdocao, 'function');
});


test('a resolução de identidade mantém os aliases PN/LID do mesmo participante', () => {
  const pn = '5511999999999@s.whatsapp.net';
  const lid = '123456789012345@lid';

  assert.deepEqual(
    filhosHandler._normalizarListaJids([pn, lid, pn, null, '']),
    [pn, lid]
  );
  assert.equal(filhosHandler._identidadesSeSobrepoem([pn, lid], [lid]), true);
  assert.equal(filhosHandler._identidadesSeSobrepoem([pn], [lid]), false);
});

test('o limite do casal considera PN/LID em qualquer ordem dos responsáveis', () => {
  const filtro = filhosHandler._filtroFilhos(
    'grupo@g.us',
    ['5511999999999@s.whatsapp.net', '123456789012345@lid'],
    ['5521888888888@s.whatsapp.net', '987654321098765@lid']
  );

  assert.equal(filtro.idGrupo, 'grupo@g.us');
  assert.equal(filtro.$or.length, 2);
  assert.deepEqual(filtro.$or[0].jidA.$in, [
    '5511999999999@s.whatsapp.net',
    '123456789012345@lid',
  ]);
  assert.deepEqual(filtro.$or[0].jidB.$in, [
    '5521888888888@s.whatsapp.net',
    '987654321098765@lid',
  ]);
  assert.deepEqual(filtro.$or[1].jidA.$in, filtro.$or[0].jidB.$in);
  assert.deepEqual(filtro.$or[1].jidB.$in, filtro.$or[0].jidA.$in);
});

test('a consulta de filhos por responsável aceita todos os aliases sem abrir a busca', () => {
  const ids = ['5511999999999@s.whatsapp.net', '123456789012345@lid'];
  const filtro = filhosHandler._filtroFilhosPorPai('grupo@g.us', ids);

  assert.equal(filtro.idGrupo, 'grupo@g.us');
  assert.equal(filtro.$or.length, 2);
  assert.deepEqual(filtro.$or[0].jidA.$in, ids);
  assert.deepEqual(filtro.$or[1].jidB.$in, ids);

  assert.deepEqual(
    filhosHandler._filtroFilhosPorPai('grupo@g.us', []),
    { idGrupo: 'grupo@g.us', _id: null }
  );
  assert.deepEqual(
    filhosHandler._filtroFilhos('grupo@g.us', [], ids),
    { idGrupo: 'grupo@g.us', _id: null }
  );
});

test('o cooldown de /tentarfilho está declarado no modelo de usuário', () => {
  assert.ok(Usuario.schema.path('ultimaTentativaFilho'));
  assert.equal(Usuario.schema.path('ultimaTentativaFilho').instance, 'Date');
});

test('o solicitante pode cancelar e o responsável convidado pode aceitar ou recusar', () => {
  const solicitante = [
    '5511999999999@s.whatsapp.net',
    '123456789012345@lid',
  ];
  const convidado = [
    '5521888888888@s.whatsapp.net',
    '987654321098765@lid',
  ];

  const solicitanteAtual = filhosHandler._avaliarParticipacaoPedidoAdocao(
    solicitante, convidado, solicitante, convidado
  );
  assert.equal(solicitanteAtual.pertenceAoCasal, true);
  assert.equal(solicitanteAtual.usuarioEhSolicitante, true);
  assert.equal(solicitanteAtual.usuarioEhConvidado, false);

  const convidadoAtual = filhosHandler._avaliarParticipacaoPedidoAdocao(
    solicitante, convidado, convidado, solicitante
  );
  assert.equal(convidadoAtual.pertenceAoCasal, true);
  assert.equal(convidadoAtual.usuarioEhSolicitante, false);
  assert.equal(convidadoAtual.usuarioEhConvidado, true);

  const terceiro = filhosHandler._avaliarParticipacaoPedidoAdocao(
    solicitante, convidado, ['9999999999999@s.whatsapp.net'], convidado
  );
  assert.equal(terceiro.pertenceAoCasal, false);
});

test('as mensagens de ajuda identificam o prefixo usado no comando', () => {
  assert.equal(
    filhosHandler._obterPrefixoComando({ message: { conversation: '/filho' } }),
    '/'
  );
  assert.equal(
    filhosHandler._obterPrefixoComando({ message: { extendedTextMessage: { text: '.renomearfilho Luna' } } }),
    '.'
  );
  assert.equal(
    filhosHandler._obterPrefixoComando({ message: { conversation: '#filho' } }),
    '#'
  );
  assert.equal(
    filhosHandler._obterPrefixoComando({
      message: { ephemeralMessage: { message: { viewOnceMessageV2: { message: { conversation: ',remediofil' } } } } },
    }),
    ','
  );
  assert.equal(filhosHandler._obterPrefixoComando({ message: {} }), '!');
});

test('o handler de adoção está exportado para o router', () => {
  assert.equal(typeof filhosHandler.handleAdotarFilho, 'function');
});