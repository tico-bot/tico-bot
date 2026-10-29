'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const utilidade = require('../utilidade');
const diversao = require('../diversao');
const grupo = require('../grupo');
const figurinha = require('../figurinha');
const imagem = require('../imagem');
const aniversario = require('../aniversario');
const medieval = require('../medieval');
const futebol = require('../futebol-api');

const jid = 'menus-test@g.us';
const msg = { key: { remoteJid: jid }, message: {} };
const getPrefix = () => '!';
const sentTexts = [];
const sock = {
  sendMessage: async (_jid, payload) => {
    if (typeof payload?.text === 'string') sentTexts.push(payload.text);
  },
};

async function renderMenu(name, action) {
  const before = sentTexts.length;
  await action();
  assert.ok(sentTexts.length > before, name + ' did not send a text menu');
  const text = sentTexts[sentTexts.length - 1];
  assert.ok(text.trim().length > 50, name + ' rendered an empty menu');
  assert.doesNotMatch(text, /\bundefined\b/, name + ' contains an undefined value');
  return text;
}

test('all active Tico menus render with a configured prefix and no missing values', async () => {
  const cases = [
    ['principal', () => utilidade.handleMenu(sock, msg, jid, '!menu', getPrefix, 'Tester')],
    ['utilidades', () => utilidade.handleMenuUtil(sock, msg, jid, getPrefix)],
    ['jogos', () => utilidade.handleMenuJogos(sock, msg, jid, getPrefix)],
    ['downloads', () => utilidade.handleMenuBaixar(sock, msg, jid, getPrefix)],
    ['alteradores', () => utilidade.handleAlteradores(sock, msg, jid, getPrefix)],
    ['casal', () => utilidade.handleMenuRelacionamento(sock, msg, jid, getPrefix)],
    ['filhos', () => utilidade.handleMenuFilho(sock, msg, jid, getPrefix)],
    ['administração', () => grupo.handleMenuAdm(sock, msg, jid, getPrefix)],
    ['figurinhas', () => figurinha.handleMenuFig(sock, msg, jid, getPrefix)],
    ['efeitos', () => imagem.handleMenuEfeitos(sock, msg, jid, '!')],
    ['aniversários', () => aniversario.handleMenuAniversario(sock, msg, jid, getPrefix)],
    ['Prata', () => diversao.handleMenuPrata(sock, msg, jid, getPrefix)],
    ['ajuda Prata', () => diversao.handleSistemaPrata(sock, msg, jid, getPrefix)],
    ['personagens', () => diversao.handleMenuPet(sock, msg, jid, getPrefix)],
    ['ajuda personagens', () => diversao.handleSistemaPet(sock, msg, jid, getPrefix)],
    ['menu medieval', () => medieval.handleMenuMedieval(sock, msg, jid, getPrefix)],
    ['ajuda medieval', () => diversao.handleSistemaMedieval(sock, msg, jid, getPrefix)],
    ['marketplace', () => diversao.handleMenuMarket(sock, msg, jid, getPrefix)],
    ['empregos', () => diversao.handleMenuWork(sock, msg, jid, getPrefix)],
    ['brincadeiras', () => diversao.handleBrincadeiras(sock, msg, jid, getPrefix)],
    ['roubo', () => diversao.handleMenuRoubo(sock, msg, jid, getPrefix)],
    ['segurança', () => diversao.handleMenuSec(sock, msg, jid, getPrefix)],
  ];

  for (const [name, action] of cases) {
    await renderMenu(name, action);
  }
});

test('sticker menu documents all ATTP styles without a text placeholder', async () => {
  const menu = await renderMenu('figurinhas', () =>
    figurinha.handleMenuFig(sock, msg, jid, getPrefix));
  assert.match(menu, /▸ !attp — texto animado/);
  assert.match(menu, /▸ !attp2 — texto animado v2/);
  assert.match(menu, /▸ !attp3 — texto animado colorido/);
  assert.doesNotMatch(menu, /!attp(?:2|3)? _\(texto\)_/i);
});

test('main and category menus include key working commands', async () => {
  const main = await renderMenu('principal', () =>
    utilidade.handleMenu(sock, msg, jid, '!menu', getPrefix, 'Tester'));
  assert.match(main, /menujogos/);
  assert.match(main, /menubaixar/);
  assert.match(main, /menufutebol/);
  assert.doesNotMatch(main, /Use o prefixo configurado neste grupo/);
  assert.match(main, /╔══════════════════════╗/);
  assert.match(main, /━━━━━━━━━━━━━━━━━━━━━━━━/);
  assert.match(main, /  ▸ !menufutebol/);
  assert.match(main, /  ▸ !meupainel/);
  assert.match(main, /  ▸ !bot — informações do bot/);

  const hashPrefixMenu = await renderMenu('principal with alternate prefix', () =>
    utilidade.handleMenu(sock, msg, jid, '#menu', () => '#', 'Tester'));
  assert.match(hashPrefixMenu, /  ▸ #menujogos/);
  assert.doesNotMatch(hashPrefixMenu, /  ▸ !menujogos/);

  const utility = await renderMenu('utilidades', () =>
    utilidade.handleMenuUtil(sock, msg, jid, getPrefix));
  assert.match(utility, /recuperar/);
  assert.match(utility, /resetsenha/);
  assert.match(utility, /!bot — tempo ativo, comandos executados e versão/);

  const games = await renderMenu('jogos', () =>
    utilidade.handleMenuJogos(sock, msg, jid, getPrefix));
  for (const command of ['quizfut', 'forca', 'pescar', 'eredivisie', 'mundial', 'campeonatozoeira']) {
    assert.ok(games.includes(command), 'menujogos should include ' + command);
  }

  const downloads = await renderMenu('downloads', () =>
    utilidade.handleMenuBaixar(sock, msg, jid, getPrefix));
  assert.match(downloads, /!mediafire <link>/);
  assert.match(downloads, /!googledriver <link>/);
  assert.match(downloads, /DOCX\/XLSX\/PPTX/);
  assert.match(downloads, /!letram\u00fasica <m\u00fasica\/artista>/);
  assert.match(downloads, /!letramusica \/ !letramsc/);

  const family = await renderMenu('filhos', () =>
    utilidade.handleMenuFilho(sock, msg, jid, getPrefix));
  assert.match(family, /renomearfilho/);

  const admin = await renderMenu('administração', () =>
    grupo.handleMenuAdm(sock, msg, jid, getPrefix));
  assert.match(admin, /fixarinfo/);
  assert.match(admin, /limparwarns/);

  const prata = await renderMenu('Prata', () =>
    diversao.handleMenuPrata(sock, msg, jid, getPrefix));
  assert.match(prata, /doarprata/);
  assert.match(prata, /rankingpesca/);
  assert.match(prata, /!prata/);
  assert.match(prata, /!rankprata/);

  const effects = await renderMenu('efeitos', () =>
    imagem.handleMenuEfeitos(sock, msg, jid, '!'));
  assert.match(effects, /cinemaimg/);
  assert.match(effects, /Apenas imagens suportam/);
  assert.doesNotMatch(effects, /!cinema — Widescreen/);
});

test('the robbery menu does not duplicate bank tools and includes the police command', async () => {
  const text = await renderMenu('roubo', () =>
    diversao.handleMenuRoubo(sock, msg, jid, getPrefix));
  assert.equal((text.match(/FERRAMENTAS PARA ASSALTO A BANCO/g) || []).length, 1);
  assert.match(text, /policia @ladrão/);
  assert.match(text, /buyroubo/);
});

test('international football help lists the same aliases supported by the router', () => {
  const help = futebol.helpText('!');
  for (const command of ['champions', 'premier', 'laliga', 'bundesliga', 'seriea', 'ligue1', 'portuguesa', 'eredivisie', 'mundial']) {
    assert.ok(help.includes(command), 'football help should include ' + command);
  }
  assert.deepEqual(futebol.resolveFootballAlias('!eredivisie', ['!', '.', '/', ',']), {
    code: 'DED',
    action: 'standings',
  });
  assert.deepEqual(futebol.resolveFootballAlias('!eredivisiejg', ['!', '.', '/', ',']), {
    code: 'DED',
    action: 'matches',
  });
  assert.deepEqual(futebol.resolveFootballAlias('!mundial', ['!', '.', '/', ',']), {
    code: 'WC',
    action: 'standings',
  });

  const routerPath = path.resolve(__dirname, '../../router.js');
  const routerSource = fs.readFileSync(routerPath, 'utf8');
  assert.match(routerSource, /matchCmdStart\(cmd, 'campeonatozoeira'\)/);
  assert.match(routerSource, /matchCmd\(cmdWord, 'campeonato'\).*handleCompetition/);
  assert.match(routerSource, /filter\(name => name !== 'cinema'\)/);
});
