'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selecionarAviso,
  montarMensagem,
  formatarMinutos,
  processarAvisosTrabalho,
} = require('./empregoAvisos');
const { dentroDoHorario } = require('./emprego');
const CarteiraGrupo = require('../../models/CarteiraGrupo');
const GrupoConfig = require('../../models/GrupoConfig');

// 10:00 no fuso UTC-3 usado pelo relógio do expediente.
const BASE = Date.UTC(2026, 10, 13, 13, 0, 0);
const MIN = 60_000;

function avisoApos(minutos, avisos = []) {
  return selecionarAviso(new Date(BASE), BASE + minutos * MIN, avisos);
}

test('avisa 10 minutos antes de liberar o próximo turno', () => {
  const aviso = avisoApos(30);
  assert.equal(aviso.codigo, 'turno_10');
  assert.equal(aviso.restanteMs, 10 * MIN);
});

test('avisa 5 minutos antes de liberar o próximo turno', () => {
  const aviso = avisoApos(35);
  assert.equal(aviso.codigo, 'turno_5');
  assert.equal(aviso.restanteMs, 5 * MIN);
});

test('avisa quando a tolerância começa e o turno já pode ser feito', () => {
  const aviso = avisoApos(40);
  assert.equal(aviso.codigo, 'tolerancia_inicio');
  assert.equal(aviso.restanteMs, 30 * MIN);
});

test('avisa quando faltam 10 minutos para o limite de demissão', () => {
  const aviso = avisoApos(60, ['tolerancia_inicio']);
  assert.equal(aviso.codigo, 'demissao_10');
  assert.equal(aviso.restanteMs, 10 * MIN);
});

test('avisa quando faltam 5 minutos para o limite de demissão', () => {
  const aviso = avisoApos(65, ['tolerancia_inicio', 'demissao_10']);
  assert.equal(aviso.codigo, 'demissao_5');
  assert.equal(aviso.restanteMs, 5 * MIN);
});

test('não repete o aviso de início da tolerância', () => {
  assert.equal(avisoApos(45, ['tolerancia_inicio']), null);
});

test('não envia avisos depois de encerrada a janela de tolerância', () => {
  assert.equal(avisoApos(70), null);
});

test('o expediente só permite notificações entre 08h e 23h', () => {
  const oitoHoras = Date.UTC(2026, 10, 13, 11, 0, 0);
  const vinteETres = Date.UTC(2026, 10, 14, 2, 0, 0);
  assert.equal(dentroDoHorario(oitoHoras), true);
  assert.equal(dentroDoHorario(vinteETres), false);
});

test('pausa a contagem durante a noite e não antecipa os avisos', () => {
  const inicio = Date.UTC(2026, 10, 14, 1, 50, 0); // 22:50 em Brasília
  const agora = Date.UTC(2026, 10, 14, 11, 10, 0); // 08:10 em Brasília
  assert.equal(selecionarAviso(new Date(inicio), agora), null);
});


test('envia o aviso no grupo, menciona o trabalhador e não duplica o mesmo marco', async () => {
  const grupo = '120363000000000000@g.us';
  const usuario = '5511999999999@s.whatsapp.net';
  const carteira = {
    _id: 'carteira-teste',
    idWhatsApp: usuario,
    idGrupo: grupo,
    empregoAtual: 'Entregador de Pizza',
    ultimoTrabalho: new Date(BASE),
    avisosEmprego: [],
  };
  const originalFind = CarteiraGrupo.find;
  const originalUpdateOne = CarteiraGrupo.updateOne;
  const originalGrupoFind = GrupoConfig.find;
  const marcados = new Set();
  const mensagens = [];
  const query = linhas => ({ select() { return this; }, async lean() { return linhas; } });

  CarteiraGrupo.find = () => query([carteira]);
  CarteiraGrupo.updateOne = async (_filtro, atualizacao) => {
    const codigo = atualizacao?.$addToSet?.avisosEmprego;
    if (!codigo || marcados.has(codigo)) return { modifiedCount: 0 };
    marcados.add(codigo);
    return { modifiedCount: 1 };
  };
  GrupoConfig.find = () => query([{ idGrupo: grupo, botAtivo: true, prefixo: '/' }]);

  try {
    const sock = {
      user: { id: 'bot@s.whatsapp.net' },
      async sendMessage(jid, payload) { mensagens.push({ jid, payload }); },
    };
    const agora = BASE + 30 * MIN;
    assert.equal(await processarAvisosTrabalho(sock, agora), 1);
    assert.equal(await processarAvisosTrabalho(sock, agora), 0);
    assert.equal(mensagens.length, 1);
    assert.equal(mensagens[0].jid, grupo);
    assert.deepEqual(mensagens[0].payload.mentions, [usuario]);
    assert.match(mensagens[0].payload.text, /\/work/);
  } finally {
    CarteiraGrupo.find = originalFind;
    CarteiraGrupo.updateOne = originalUpdateOne;
    GrupoConfig.find = originalGrupoFind;
  }
});

test('formata o tempo e respeita o prefixo configurado do grupo', () => {
  assert.equal(formatarMinutos(60_001), '2 minutos');
  const mensagem = montarMensagem(
    { tipo: 'demissao', restanteMs: 5 * MIN },
    '5511999999999@s.whatsapp.net',
    'Entregador de Pizza',
    '/'
  );
  assert.match(mensagem, /@5511999999999/);
  assert.match(mensagem, /\/work/);
  assert.match(mensagem, /5 minutos/);
});
