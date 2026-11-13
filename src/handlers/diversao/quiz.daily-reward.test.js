'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CarteiraGrupo = require('../../models/CarteiraGrupo');
const Usuario = require('../../models/Usuario');
const LidMapping = require('../../models/LidMapping');
const carteiraService = require('../../utils/carteira');
const { getTodayStr } = require('./missoes');
const { hojeStr } = require('../../utils/tempo');
const { registrarAcertoDiarioQuiz, changeGold } = require('./quiz');

const jogador = '5511999999999@s.whatsapp.net';
const grupo = '120363000000000000@g.us';

test('bônus diário é concedido ao terceiro acerto e não se repete no mesmo dia', async t => {
  const chamadasProgresso = [];
  const chamadasBonus = [];
  const resultadosBonus = [{ modifiedCount: 1 }, { modifiedCount: 0 }];
  const contagens = [3, 4];

  t.mock.method(CarteiraGrupo, 'findOneAndUpdate', async (...args) => {
    chamadasProgresso.push(args);
    return { quizDailyCorrect: contagens[chamadasProgresso.length - 1] };
  });
  t.mock.method(CarteiraGrupo, 'updateOne', async (...args) => {
    chamadasBonus.push(args);
    return resultadosBonus[chamadasBonus.length - 1];
  });

  const primeiro = await registrarAcertoDiarioQuiz(jogador, grupo);
  const segundo = await registrarAcertoDiarioQuiz(jogador, grupo);

  assert.deepEqual(primeiro, { acertos: 3, meta: 3, bonusConcedido: true });
  assert.deepEqual(segundo, { acertos: 4, meta: 3, bonusConcedido: false });
  assert.equal(chamadasProgresso.length, 2);

  const [filtroProgresso, pipeline, opcoes] = chamadasProgresso[0];
  assert.deepEqual(filtroProgresso, { idWhatsApp: jogador, idGrupo: grupo });
  assert.equal(pipeline[0].$set.quizDailyCorrectDate, hojeStr());
  assert.deepEqual(pipeline[0].$set.quizDailyCorrect.$cond, [
    { $eq: ['$quizDailyCorrectDate', hojeStr()] },
    { $add: [{ $ifNull: ['$quizDailyCorrect', 0] }, 1] },
    1,
  ]);
  assert.equal(opcoes.new, true);

  const [filtroBonus, updateBonus] = chamadasBonus[0];
  assert.equal(filtroBonus.quizDailyCorrectDate, hojeStr());
  assert.deepEqual(filtroBonus.quizDailyCorrect, { $gte: 3 });
  assert.deepEqual(filtroBonus.quizDailyBonusDate, { $ne: hojeStr() });
  assert.equal(updateBonus.$inc.gold, 500);
  assert.equal(updateBonus.$set.quizDailyBonusDate, hojeStr());
  assert.equal(updateBonus.$push.goldHistory.$each[0].amount, 500);
  assert.match(updateBonus.$push.goldHistory.$each[0].item, /bônus diário de participação/i);
});


test('changeGold devolve apenas o saldo numérico da carteira', async t => {
  t.mock.method(LidMapping, 'findOne', () => ({ lean: async () => null }));
  t.mock.method(carteiraService, 'alterarGold', async () => ({ gold: 345 }));
  t.mock.method(carteiraService, 'getCarteira', async () => ({ gold: 345 }));
  t.mock.method(Usuario, 'findOneAndUpdate', async () => ({}));
  t.mock.method(Usuario, 'findOne', () => ({
    lean: async () => ({ dailyMissions: { date: getTodayStr() } }),
  }));

  const saldo = await changeGold(jogador, 15, grupo);

  assert.equal(saldo, 345);
  assert.equal(typeof saldo, 'number');
});
