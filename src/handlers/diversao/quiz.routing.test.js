'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Usuario = require('../../models/Usuario');
const LidMapping = require('../../models/LidMapping');
const {
  handleQuiz,
  quizState,
  perguntasQuiz,
  perguntasQuizTikTok,
  perguntasQuizModa,
  resolverFiltroQuiz,
  resolverBancoQuiz,
  ehComandoQuiz,
  normalizarComandoQuiz,
} = require('./quiz');

function bancoDoComando(comando) {
  const especial = resolverBancoQuiz(comando);
  if (especial) return especial;
  const filtro = resolverFiltroQuiz(comando);
  return filtro ? perguntasQuiz.filter(filtro) : perguntasQuiz;
}

test('todos os temas gerais possuem um banco não vazio ligado ao comando correcto', () => {
  const comandos = [
    ['quizfut', 'Futebol'],
    ['quizfutebol', 'Futebol'],
    ['quizhis', 'História'],
    ['quizgeo', 'Geografia'],
    ['quizbsq', 'Basquete'],
    ['quizanime', 'Anime'],
  ];

  for (const [comando, tema] of comandos) {
    const filtro = resolverFiltroQuiz(comando);
    assert.equal(typeof filtro, 'function', comando);
    const perguntas = perguntasQuiz.filter(filtro);
    assert.ok(perguntas.length > 0, comando + ' não pode ter banco vazio');
    assert.ok(perguntas.every(pergunta => pergunta.d === tema), comando + ' mistura temas');
  }

  assert.equal(perguntasQuiz.filter(resolverFiltroQuiz('quizctec')).length, 335);
  assert.equal(perguntasQuiz.filter(resolverFiltroQuiz('quizmat')).length, 227);
  assert.equal(ehComandoQuiz('quiz'), true);
  assert.equal(ehComandoQuiz('quiztiktok'), true);
  assert.equal(ehComandoQuiz('quizmoda'), true);
  assert.equal(normalizarComandoQuiz('#QUIZGEO'), 'quizgeo');
});

test('todos os temas iniciam uma pergunta e substituem correctamente um quiz pendente', async t => {
  const grupo = '120363000000000000@g.us';
  const jogador = '5511999999999@s.whatsapp.net';

  t.mock.method(LidMapping, 'findOne', () => ({
    lean: async () => null,
  }));
  t.mock.method(Usuario, 'findOne', () => ({
    lean: async () => null,
  }));
  t.mock.method(Usuario, 'updateOne', async () => ({ upsertedCount: 0 }));
  t.mock.method(Usuario, 'findOneAndUpdate', async () => ({
    quizDaily: { windowStartedAt: new Date(), count: 1 },
  }));

  const timeoutInicial = setTimeout(() => {}, 60_000);
  quizState.set(jogador, {
    r: 'resposta da pergunta anterior',
    aliases: [],
    resolvedJid: jogador,
    timeout: timeoutInicial,
  });

  t.after(() => {
    clearTimeout(timeoutInicial);
    const estado = quizState.get(jogador);
    if (estado?.timeout) clearTimeout(estado.timeout);
    quizState.delete(jogador);
  });

  const mensagens = [];
  const sock = {
    sendMessage: async (_jid, payload) => mensagens.push(payload.text),
  };
  const comandos = [
    'quizgeo',
    'quizfut',
    'quizfutebol',
    'quizhis',
    'quizbsq',
    'quizanime',
    'quizctec',
    'quizmat',
    'quiztiktok',
    'quizmoda',
    'quiz',
  ];
  const timeoutsCriados = [timeoutInicial];

  for (const comando of comandos) {
    const caption = '/' + comando;
    const msg = {
      key: { remoteJid: grupo, participant: jogador },
      message: { conversation: caption },
    };
    const mensagensAntes = mensagens.length;
    const timeoutAnterior = quizState.get(jogador)?.timeout;

    await handleQuiz(sock, msg, grupo, 'Jogador', jogador, caption);

    assert.equal(mensagens.length, mensagensAntes + 1, caption + ' deve enviar uma pergunta');
    assert.match(mensagens.at(-1), /QUIZ — /, caption + ' deve identificar o tema');
    assert.match(mensagens.at(-1), /30 segundos/, caption + ' deve mostrar o tempo de resposta');

    const estadoNovo = quizState.get(jogador);
    assert.ok(estadoNovo, caption + ' deve deixar uma pergunta activa');
    const banco = bancoDoComando(comando);
    assert.ok(
      banco.some(pergunta => pergunta.r === estadoNovo.r),
      caption + ' deve seleccionar a resposta do banco correcto'
    );

    if (timeoutAnterior) {
      assert.equal(timeoutAnterior._destroyed, true, caption + ' deve cancelar o temporizador anterior');
    }
    if (estadoNovo.timeout) timeoutsCriados.push(estadoNovo.timeout);
  }

  assert.equal(timeoutInicial._destroyed, true, 'o temporizador que existia antes dos comandos deve ser cancelado');
  assert.equal(mensagens.length, comandos.length, 'cada comando deve produzir exactamente uma pergunta');
});
