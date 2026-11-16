/**
 * Sistema de Quiz — Tico Bot
 * Comandos: /quiz, /quiztiktok, /quizmoda e quizzes temáticos
 *           /pontos, /rankjogos
 * - Banco geral e bancos temáticos separados
 * - Limite de 30 quizzes por janela de 30 minutos por usuário
 * - Pontos salvos na nuvem (MongoDB)
 */

const path = require('path');
const Usuario       = require(path.join(__dirname, '..', '..', 'models', 'Usuario'));
const CarteiraGrupo = require(path.join(__dirname, '..', '..', 'models', 'CarteiraGrupo'));
const { prepareDailyMissionState } = require('./missoes');
const { resolveDisplayName } = require('../../utils/identity');
const carteiraService = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));
const { resolverJidCarteira } = carteiraService;
const { hojeStr } = require('../../utils/tempo');
const { formatarNumeroBR } = require('../../utils/numberFormat');
const QUIZ_DAILY_BONUS_TARGET = 3;
const QUIZ_DAILY_BONUS_PRATA = 500;
const QUIZ_GOLD_BASE_REWARD = 15;
const QUIZ_GOLD_MULTIPLIER = 30;
const QUIZ_GOLD_REWARD = QUIZ_GOLD_BASE_REWARD * QUIZ_GOLD_MULTIPLIER;
const perguntasQuizTikTok = require('./quiz.tiktok-questions');
const perguntasQuizModa = require('./quiz.moda-questions');
// ─── ESTADO ──────────────────────────────────────────────────────────────────

const quizState      = new Map(); // senderJid → { r, resolvedJid, timeout }
const pontosMap      = new Map(); // senderJid → pts (cache)

// ✅ recentQuizMap substitui global.recentQuiz: escopo de módulo, sem vazamento
// entre workers, sem crescimento ilimitado de global
const recentQuizMap  = new Map(); // senderJid → string[] (últimas perguntas sorteadas)

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// Limite por janela móvel, persistido no MongoDB para sobreviver a reinícios.
const QUIZ_WINDOW_LIMIT = 30;
const QUIZ_WINDOW_MS = 30 * 60 * 1000;

const FILTROS_QUIZ = Object.freeze({
  quizfut: q => q.d === 'Futebol',
  quizfutebol: q => q.d === 'Futebol',
  quizctec: q => ['Ciência', 'Química', 'Física', 'Biologia', 'Astronomia', 'Tecnologia'].includes(q.d),
  quizgeo: q => q.d === 'Geografia',
  quizmat: q => ['Matemática', 'Geometria', 'Cálculo', 'Estatística'].includes(q.d),
  quizhis: q => q.d === 'História',
  quizbsq: q => q.d === 'Basquete',
  quizanime: q => q.d === 'Anime',
});

function resolverFiltroQuiz(comando) {
  return FILTROS_QUIZ[comando] || null;
}

function ehComandoQuiz(comando) {
  return comando === 'quiz' || Boolean(resolverFiltroQuiz(comando)) || Boolean(resolverBancoQuiz(comando));
}

function normalizarComandoQuiz(caption) {
  const cmdRaw = String(caption || '').trim().toLowerCase().split(/\s+/)[0] || '';
  return cmdRaw.replace(/^[^a-z0-9]+/, '');
}

// ─── UTILITÁRIOS ─────────────────────────────────────────────────────────────

function somenteGrupo(jid) {
  return jid?.endsWith('@g.us') ?? false;
}

function normalize(str) {
  return String(str ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ABREVIACOES_GEOGRAFICAS = Object.freeze({
  // Capitais e cidades brasileiras frequentemente abreviadas.
  'sao paulo': ['sp'],
  'rio de janeiro': ['rj'],
  'belo horizonte': ['bh'],
  'brasilia': ['bsb', 'df'],
  'porto alegre': ['poa'],
  'curitiba': ['cwb'],
  'salvador': ['ssa'],
  'recife': ['rec'],
  'fortaleza': ['for'],
  'manaus': ['mao'],
  'goiania': ['gyn'],
  'belem': ['bel'],
  'vitoria': ['vix'],
  'florianopolis': ['fln'],
  'natal': ['nat'],
  'joao pessoa': ['jpa'],
  'maceio': ['mcz'],
  'teresina': ['the'],
  'campo grande': ['cgr'],
  'cuiaba': ['cgb'],
  'porto velho': ['pvh'],
  'rio branco': ['rbr'],
  'macapa': ['mcp'],
  'palmas': ['pmw'],
  'aracaju': ['aju'],
  'new york': ['nyc'],
  'nova york': ['nyc'],
  'los angeles': ['la'],
  'washington dc': ['dc'],
  'cidade do mexico': ['cdmx'],
  'mexico city': ['cdmx'],
  // Formas internacionais frequentes dos nomes de capitais.
  'helsinque': ['helsinki', 'hel'],
  'reiquiavique': ['reykjavik', 'rek'],
  'bruxelas': ['brussels', 'bru'],
  'varsovia': ['warsaw', 'waw'],
  'atenas': ['athens', 'ath'],
  'ancara': ['ankara', 'esb'],
  'dacar': ['dakar', 'dss'],
  'catmandu': ['kathmandu', 'ktm'],
  'teera': ['tehran', 'thr', 'ika'],
  'adis abeba': ['addis ababa', 'add'],
  'montevideu': ['montevideo', 'mvd'],
  'assuncao': ['asuncion', 'asu'],
  'bogota': ['bogota', 'bog'],
  'quito': ['ui o', 'uio'],
  'caracas': ['ccs'],
  'riade': ['riyadh', 'ruh'],
  'bagda': ['baghdad', 'bgw'],
  'jacarta': ['jakarta', 'cgk'],
  'kuala lumpur': ['kul'],
  'bangkok': ['bkk'],
  'hanoi': ['han'],
  'manila': ['mnl'],
  'islamabad': ['isb'],
  'nairobi': ['nbo'],
  'luanda': ['lad'],
  'maputo': ['mpm'],
  'rabat': ['rba'],
  'abuja': ['abv'],
  'cairo': ['cai'],
  'oslo': ['osl'],
  'estocolmo': ['stockholm', 'sto'],
  'berna': ['bern', 'brn'],
  'viena': ['vienna', 'vie'],
  'budapeste': ['budapest', 'bud'],
  'helsinki': ['hel'],
  'dublin': ['dub'],
  'nairobi': ['nbo'],

  // Unidades federativas brasileiras.
  'acre': ['ac'],
  'alagoas': ['al'],
  'amapa': ['ap'],
  'amazonas': ['am'],
  'bahia': ['ba'],
  'ceara': ['ce'],
  'distrito federal': ['df'],
  'espirito santo': ['es'],
  'goias': ['go'],
  'maranhao': ['ma'],
  'mato grosso': ['mt'],
  'mato grosso do sul': ['ms'],
  'minas gerais': ['mg'],
  'para': ['pa'],
  'paraiba': ['pb'],
  'parana': ['pr'],
  'pernambuco': ['pe'],
  'piaui': ['pi'],
  'rio de janeiro estado': ['rj'],
  'rio grande do norte': ['rn'],
  'rio grande do sul': ['rs'],
  'rondonia': ['ro'],
  'roraima': ['rr'],
  'santa catarina': ['sc'],
  'sao paulo estado': ['sp'],
  'sergipe': ['se'],
  'tocantins': ['to'],

  // Países: siglas comuns e códigos internacionais.
  'brasil': ['br', 'bra'],
  'estados unidos': ['eua', 'usa', 'us'],
  'reino unido': ['uk', 'gb', 'gbr'],
  'uniao sovietica': ['urss', 'ussr'],
  'alemanha': ['de', 'deu', 'ger'],
  'argentina': ['ar', 'arg'],
  'uruguai': ['uy', 'ury'],
  'paraguai': ['py', 'pry'],
  'chile': ['cl', 'chl'],
  'bolivia': ['bo', 'bol'],
  'peru': ['pe', 'per'],
  'colombia': ['co', 'col'],
  'venezuela': ['ve', 'ven'],
  'equador': ['ec', 'ecu'],
  'portugal': ['pt', 'prt'],
  'espanha': ['es', 'esp'],
  'franca': ['fr', 'fra'],
  'italia': ['it', 'ita'],
  'grecia': ['gr', 'grc'],
  'turquia': ['tr', 'tur'],
  'russia': ['ru', 'rus'],
  'ucrania': ['ua', 'ukr'],
  'polonia': ['pl', 'pol'],
  'noruega': ['no', 'nor'],
  'suecia': ['se', 'swe'],
  'finlandia': ['fi', 'fin'],
  'irlanda': ['ie', 'irl'],
  'belgica': ['be', 'bel'],
  'suica': ['ch', 'che'],
  'austria': ['at', 'aut'],
  'hungria': ['hu', 'hun'],
  'islandia': ['is', 'isl'],
  'dinamarca': ['dk', 'dnk'],
  'paises baixos': ['nl', 'nld'],
  'republica tcheca': ['cz', 'cze'],
  'china': ['cn', 'chn'],
  'japao': ['jp', 'jpn'],
  'coreia do sul': ['kr', 'kor'],
  'coreia do norte': ['kp', 'prk'],
  'india': ['in', 'ind'],
  'paquistao': ['pk', 'pak'],
  'nepal': ['np', 'npl'],
  'vietna': ['vn', 'vnm'],
  'tailandia': ['th', 'tha'],
  'indonesia': ['id', 'idn'],
  'malasia': ['my', 'mys'],
  'filipinas': ['ph', 'phl'],
  'singapura': ['sg', 'sgp'],
  'arabia saudita': ['sa', 'sau'],
  'ira': ['ir', 'irn'],
  'iraque': ['iq', 'irq'],
  'emirados arabes unidos': ['eau', 'uae', 'ae'],
  'catar': ['qa', 'qat'],
  'egito': ['eg', 'egy'],
  'marrocos': ['ma', 'mar'],
  'nigeria': ['ng', 'nga'],
  'angola': ['ao', 'ago'],
  'mocambique': ['mz', 'moz'],
  'senegal': ['sn', 'sen'],
  'quenia': ['ke', 'ken'],
  'etiopia': ['et', 'eth'],
  'africa do sul': ['za', 'zaf'],
  'canada': ['ca', 'can'],
  'mexico': ['mx', 'mex'],
  'australia': ['au', 'aus'],
  'nova zelandia': ['nz', 'nzl'],
  'franca': ['fr', 'fra'],
  'estados unidos da america': ['eua', 'usa', 'us'],
});

function aliasesGeograficos(valor) {
  return ABREVIACOES_GEOGRAFICAS[normalize(valor)] || [];
}

function distanciaEdicao(a, b, limite) {
  if (Math.abs(a.length - b.length) > limite) return limite + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let minimoLinha = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(
        anterior[j] + 1,
        atual[j - 1] + 1,
        anterior[j - 1] + custo
      );
      minimoLinha = Math.min(minimoLinha, atual[j]);
    }
    if (minimoLinha > limite) return limite + 1;
    anterior = atual;
  }

  return anterior[b.length];
}

function tokenCorresponde(token, esperado) {
  if (token === esperado) return true;
  // Evita aceitar fragmentos curtos; tolera apenas pequenos erros em palavras longas.
  if (token.length < 5 || esperado.length < 5) return false;
  const limite = Math.max(token.length, esperado.length) >= 10 ? 2 : 1;
  return distanciaEdicao(token, esperado, limite) <= limite;
}

function respostaCorresponde(respostaUsuario, respostaCorreta, aliases = []) {
  const entrada = normalize(respostaUsuario);
  if (!entrada) return false;

  const candidatosBase = [respostaCorreta, ...aliases]
    .flatMap(valor => {
      const texto = String(valor ?? '');
      // Mantém frações como 1/4 e 3/4; nos demais casos, a barra pode separar sinônimos.
      if (/^\s*[-+]?\d+\s*\/\s*[-+]?\d+\s*$/.test(texto)) return [texto];
      return texto.split(/[\/|]/);
    })
    .map(normalize)
    .filter(Boolean);
  const candidatos = candidatosBase.flatMap(candidato => [
    candidato,
    ...aliasesGeograficos(candidato).map(normalize),
  ]);

  return candidatos.some(candidato => {
    if (entrada === candidato || entrada.replace(/\s/g, '') === candidato.replace(/\s/g, '')) {
      return true;
    }

    const tokensEntrada = entrada.split(' ');
    const tokensCorretos = candidato.split(' ');
    // Aceita nomes incompletos, palavras em outra ordem e pequenos erros de digitação,
    // mas exige que todas as palavras enviadas correspondam à resposta esperada.
    return tokensEntrada.every(token =>
      tokensCorretos.some(esperado => tokenCorresponde(token, esperado))
    );
  });
}

// ─── BANCO DE DADOS ──────────────────────────────────────────────────────────

async function syncQuizPointsFromDB(userId) {
  if (!userId) return;
  try {
    const user = await Usuario.findOne(
      { idWhatsApp: userId },
      { quizPoints: 1 }   // ✅ projection — evita trazer o documento inteiro
    ).lean();
    if (user && typeof user.quizPoints === 'number') {
      pontosMap.set(userId, user.quizPoints);
    }
  } catch (e) {
    console.error('⚠️ Erro ao sincronizar pontos quiz:', e.message);
  }
}

async function saveQuizPointsToDB(userId, groupJid) {
  if (!userId) return;
  const idNorm = await resolverJidCarteira(userId, groupJid);
  try {
    const ops = [
      Usuario.findOneAndUpdate(
        { idWhatsApp: idNorm },
        { $inc: { quizPoints: 10 } },
        { upsert: true }
      ),
    ];
    if (groupJid) {
      ops.push(
        CarteiraGrupo.findOneAndUpdate(
          { idWhatsApp: idNorm, idGrupo: groupJid },
          { $inc: { quizPoints: 10 } },
          { upsert: true }
        )
      );
    }
    await Promise.all(ops);
  } catch (e) {
    console.error('⚠️ Erro ao salvar pontos quiz no MongoDB:', e.message);
  }
}

async function registrarAcertoDiarioQuiz(userId, groupJid) {
  if (!userId || !groupJid) return null;
  // O chamador já fornece o JID PN/LID resolvido e normalizado.
  const idNorm = userId;
  const hoje = hojeStr();
  const progresso = await CarteiraGrupo.findOneAndUpdate(
    { idWhatsApp: idNorm, idGrupo: groupJid },
    [{
      $set: {
        quizDailyCorrectDate: hoje,
        quizDailyCorrect: {
          $cond: [
            { $eq: ['$quizDailyCorrectDate', hoje] },
            { $add: [{ $ifNull: ['$quizDailyCorrect', 0] }, 1] },
            1,
          ],
        },
      },
    }],
    { new: true }
  );
  const acertos = Number(progresso?.quizDailyCorrect) || 0;
  let bonusConcedido = false;

  if (acertos >= QUIZ_DAILY_BONUS_TARGET) {
    const credito = await CarteiraGrupo.updateOne(
      {
        idWhatsApp: idNorm,
        idGrupo: groupJid,
        quizDailyCorrectDate: hoje,
        quizDailyCorrect: { $gte: QUIZ_DAILY_BONUS_TARGET },
        quizDailyBonusDate: { $ne: hoje },
      },
      {
        $inc: { gold: QUIZ_DAILY_BONUS_PRATA },
        $set: { quizDailyBonusDate: hoje },
        $push: {
          goldHistory: {
            $each: [{
              type: 'recebido',
              item: 'Bônus diário de participação no Quiz',
              amount: QUIZ_DAILY_BONUS_PRATA,
              date: new Date(),
            }],
            $slice: -50,
          },
        },
      }
    );
    bonusConcedido = (credito.modifiedCount ?? credito.nModified ?? 0) === 1;
  }

  return { acertos, meta: QUIZ_DAILY_BONUS_TARGET, bonusConcedido };
}

async function changeGold(userId, amount, groupJid) {
  if (!userId) {
    console.warn('⚠️ changeGold ignorado: jid vazio:', userId);
    return 0;
  }

  const idNorm = await resolverJidCarteira(userId, groupJid);

  try {
    // ── 1. Atualiza o saldo local ou compartilhado conforme o vínculo ──────
    if (groupJid) {
      await carteiraService.alterarGold(idNorm, groupJid, amount, 'Recompensa do quiz');
    }

    // ── 2. Atualiza Usuario global (missões diárias) ──────────────────────
    const incPayload = {};
    if (amount > 0) incPayload['dailyMissions.progress.gold500'] = amount;

    if (Object.keys(incPayload).length > 0) {
      await Usuario.findOneAndUpdate(
        { idWhatsApp: idNorm },
        { $inc: incPayload },
        { upsert: true }
      );
    }

    // ── 3. prepareDailyMissionState APÓS o $inc (evita race condition) ────
    if (amount > 0) {
      await prepareDailyMissionState(idNorm).catch(e =>
        console.error('⚠️ Erro ao preparar estado de missão diária:', e.message)
      );
    }

    // ── 4. Retorna o saldo efetivo da carteira ────────────────────────────
    if (groupJid) {
      const carteira = await carteiraService.getCarteira(idNorm, groupJid);
      console.log(`✅ Saldo do quiz alterado: ${idNorm} → ${amount >= 0 ? '+' : ''}${amount} (saldo: ${carteira.gold})`);
      return Number(carteira?.gold) || 0;
    }

    console.log(`✅ Prata alterada: ${idNorm} → ${amount >= 0 ? '+' : ''}${amount} (sem grupo)`);
    return 0;

  } catch (e) {
    console.error('⚠️ Erro ao alterar Prata:', e.message);
    throw e;
  }
}

// ─── LIMITE DE QUIZZES POR JANELA DE 30 MINUTOS ───────────────────────────────

async function registrarInicioQuiz(userId, agora = new Date()) {
  if (!userId) throw new TypeError('Identificador do jogador ausente.');

  const inicioJanelaMaisAntiga = new Date(agora.getTime() - QUIZ_WINDOW_MS);
  const reiniciarJanela = {
    $or: [
      { $eq: [{ $ifNull: ['$quizDaily.windowStartedAt', null] }, null] },
      { $lte: ['$quizDaily.windowStartedAt', inicioJanelaMaisAntiga] },
    ],
  };

  try {
    // Garante a existência da conta; a atualização seguinte é condicional e atômica.
    await Usuario.updateOne(
      { idWhatsApp: userId },
      { $setOnInsert: { idWhatsApp: userId } },
      { upsert: true }
    );

    const usuario = await Usuario.findOneAndUpdate(
      {
        idWhatsApp: userId,
        $or: [
          { 'quizDaily.windowStartedAt': null },
          { 'quizDaily.windowStartedAt': { $lte: inicioJanelaMaisAntiga } },
          {
            'quizDaily.windowStartedAt': { $gt: inicioJanelaMaisAntiga },
            'quizDaily.count': { $lt: QUIZ_WINDOW_LIMIT },
          },
        ],
      },
      [{
        $set: {
          'quizDaily.windowStartedAt': {
            $cond: [reiniciarJanela, agora, '$quizDaily.windowStartedAt'],
          },
          'quizDaily.count': {
            $cond: [
              reiniciarJanela,
              1,
              { $add: [{ $ifNull: ['$quizDaily.count', 0] }, 1] },
            ],
          },
        },
      }],
      { new: true }
    );

    if (usuario) {
      const iniciadoEm = usuario.quizDaily?.windowStartedAt || agora;
      const restante = Math.max(0, QUIZ_WINDOW_MS - (agora.getTime() - new Date(iniciadoEm).getTime()));
      return {
        permitido: true,
        count: Number(usuario.quizDaily?.count) || 1,
        restanteMs: restante,
        windowStartedAt: new Date(iniciadoEm),
      };
    }

    const atual = await Usuario.findOne(
      { idWhatsApp: userId },
      { quizDaily: 1 }
    ).lean();
    const count = Number(atual?.quizDaily?.count) || 0;
    const iniciouEm = atual?.quizDaily?.windowStartedAt
      ? new Date(atual.quizDaily.windowStartedAt)
      : agora;
    const restanteMs = Math.max(0, QUIZ_WINDOW_MS - (agora.getTime() - iniciouEm.getTime()));

    return { permitido: false, count, restanteMs, windowStartedAt: iniciouEm };
  } catch (erro) {
    console.error('⚠️ Erro ao validar limite de quizzes:', erro.message);
    return { permitido: false, indisponivel: true, count: 0, restanteMs: 0 };
  }
}

// ─── PERGUNTAS ────────────────────────────────────────────────────────────────

const perguntasQuiz = [
  // ── FUTEBOL ───────────────────────────────────────────────────────────────
  { p: '⚽ Qual clube brasileiro foi tricampeão da Copa Libertadores?', r: 'sao paulo', d: 'Futebol' },
  { p: '⚽ Qual jogador ganhou mais Copas do Mundo como jogador?', r: 'pele', d: 'Futebol' },
  { p: '⚽ Em que ano o Brasil conquistou sua primeira Copa do Mundo?', r: '1958', d: 'Futebol' },
  { p: '⚽ Qual foi o artilheiro da Copa do Mundo de 2006?', r: 'miroslav klose', d: 'Futebol' },
  { p: '⚽ Qual técnico levou a Alemanha ao tetracampeonato em 1990?', r: 'franz beckenbauer', d: 'Futebol' },
  { p: '⚽ Em qual estádio foi disputada a final da Copa de 2014?', r: 'maracana', d: 'Futebol' },
  { p: '⚽ Qual seleção ganhou a Copa América de 2021?', r: 'argentina', d: 'Futebol' },
  { p: '⚽ Qual jogador é conhecido como "O Rei"?', r: 'pele', d: 'Futebol' },
  { p: '⚽ Em que clube Zidane encerrou a carreira como jogador?', r: 'real madrid', d: 'Futebol' },
  { p: '⚽ Qual seleção foi campeã da Eurocopa de 2016?', r: 'portugal', d: 'Futebol' },
  { p: '⚽ Qual jogador marcou o gol de bicicleta mais famoso da história do futebol em 2018?', r: 'cristiano ronaldo', aliases: ['CR7'], d: 'Futebol' },
  { p: '⚽ Em que ano o Flamengo venceu sua primeira Copa Libertadores?', r: '1981', d: 'Futebol' },
  { p: '⚽ Qual clube tem mais títulos do Campeonato Brasileiro?', r: 'flamengo', d: 'Futebol' },
  { p: '⚽ Quantas vezes Messi ganhou a Bola de Ouro?', r: '8', d: 'Futebol' },
  { p: '⚽ Qual jogador é o maior artilheiro da história da Seleção Argentina?', r: 'lionel messi', d: 'Futebol' },
  { p: '⚽ Em que ano o Paris Saint-Germain foi fundado?', r: '1970', d: 'Futebol' },
  { p: '⚽ Qual seleção venceu a Copa do Mundo de 2010?', r: 'espanha', d: 'Futebol' },
  { p: '⚽ Qual jogador foi artilheiro da Copa do Mundo de 2018?', r: 'harry kane', d: 'Futebol' },
  { p: '⚽ Em que cidade fica o estádio Camp Nou?', r: 'barcelona', d: 'Futebol' },
  { p: '⚽ Qual seleção derrotou o Brasil na semifinal da Copa de 2014?', r: 'alemanha', d: 'Futebol' },
  { p: '⚽ Qual jogador ganhou a Chuteira de Ouro na Copa de 2014?', r: 'james rodriguez', d: 'Futebol' },
  { p: '⚽ Qual clube italiano tem o apelido de "La Vecchia Signora"?', r: 'juventus', d: 'Futebol' },
  { p: '⚽ Em que ano o São Paulo venceu sua última Copa Libertadores?', r: '1994', d: 'Futebol' },
  { p: '⚽ Qual jogador é conhecido como "CR7"?', r: 'cristiano ronaldo', aliases: ['CR7'], d: 'Futebol' },
  { p: '⚽ Quantos títulos da Eurocopa a Espanha tem?', r: '3', d: 'Futebol' },
  { p: '⚽ Qual jogador levou o Liverpool ao título da Premier League em 2020?', r: 'jordan henderson', d: 'Futebol' },
  { p: '⚽ Qual foi o primeiro país africano a chegar às semifinais de uma Copa?', r: 'camaroes', d: 'Futebol' },
  { p: '⚽ Em qual posição Cafu jogou durante toda a sua carreira?', r: 'lateral direito', d: 'Futebol' },
  { p: '⚽ Qual clube vendeu Neymar ao PSG pelo valor recorde de 222 milhões de euros?', r: 'barcelona', d: 'Futebol' },
  { p: '⚽ Qual técnico venceu a Liga dos Campeões com dois clubes diferentes?', r: 'jose mourinho', d: 'Futebol' },
  { p: '⚽ Qual seleção ganhou a Copa do Mundo de 2006?', r: 'italia', d: 'Futebol' },
  { p: '⚽ Em que ano foi realizada a primeira Copa do Mundo?', r: '1930', d: 'Futebol' },
  { p: '⚽ Qual país foi campeão da primeira Copa do Mundo?', r: 'uruguai', d: 'Futebol' },
  { p: '⚽ Qual clube inglês tem o apelido de "The Blues"?', r: 'chelsea', d: 'Futebol' },
  { p: '⚽ Qual jogador ganhou o Prêmio Puskas de 2022?', r: 'marcin oleksy', d: 'Futebol' },
  { p: '⚽ Em que ano o Cruzeiro foi fundado?', r: '1921', d: 'Futebol' },
  { p: '⚽ Quantas Copas do Mundo o Brasil conquistou?', r: '5', d: 'Futebol' },
  { p: '⚽ Qual foi o último país a sediar a Copa do Mundo pela segunda vez?', r: 'brasil', d: 'Futebol' },
  { p: '⚽ Em que posição jogava Roberto Carlos?', r: 'lateral esquerdo', d: 'Futebol' },
  { p: '⚽ Qual seleção venceu a Copa das Confederações de 2017?', r: 'alemanha', d: 'Futebol' },
  { p: '⚽ Qual time italiano foi campeão da Champions League em 2003?', r: 'milan', d: 'Futebol' },
  { p: '⚽ Qual é o apelido do estádio do Corinthians?', r: 'neo quimica arena', d: 'Futebol' },
  { p: '⚽ Qual jogador é o maior artilheiro da história da Champions League?', r: 'cristiano ronaldo', aliases: ['CR7'], d: 'Futebol' },
  { p: '⚽ Em que ano Ronaldinho Gaúcho venceu a Copa do Mundo?', r: '2002', d: 'Futebol' },
  { p: '⚽ Qual seleção venceu a Copa do Mundo de 1998?', r: 'franca', d: 'Futebol' },
  { p: '⚽ Qual jogador tem mais títulos na história do futebol europeu?', r: 'cristiano ronaldo', aliases: ['CR7'], d: 'Futebol' },
  { p: '⚽ Qual clube ganhou a Libertadores de 2022?', r: 'flamengo', d: 'Futebol' },
  { p: '⚽ Em que ano o Grêmio ganhou sua última Copa Libertadores?', r: '1995', d: 'Futebol' },
  { p: '⚽ Qual jogador ficou conhecido como "O Fenômeno"?', r: 'ronaldo', d: 'Futebol' },
  { p: '⚽ Qual clube holandês revelou Johan Cruyff?', r: 'ajax', d: 'Futebol' },

  // ── HISTÓRIA ──────────────────────────────────────────────────────────────
  { p: '📜 Em que ano ocorreu a Revolução Francesa?', r: '1789', d: 'História' },
  { p: '🏛️ Quem foi o último faraó do Egito Antigo?', r: 'cleópatra', d: 'História' },
  { p: '⚔️ Em que ano Alexandre o Grande morreu?', r: '323 ac', d: 'História' },
  { p: '📚 Qual foi a primeira civilização da América a usar a escrita?', r: 'olmeca', d: 'História' },
  { p: '⚖️ Quem assinou a Lei Áurea no Brasil?', r: 'princesa isabel', d: 'História' },
  { p: '🗡️ Em que ano ocorreu a queda de Constantinopla?', r: '1453', d: 'História' },
  { p: '💀 Qual imperador romano é conhecido como "o Augusto"?', r: 'augusto', d: 'História' },
  { p: '⚔️ Em que ano começou a Revolução Industrial?', r: '1760', d: 'História' },
  { p: '🏛️ Qual civilização construiu Machu Picchu?', r: 'inca', d: 'História' },
  { p: '📜 Em que ano ocorreu a Independência do México?', r: '1810', d: 'História' },
  { p: '🔥 Em que ano ocorreu a Revolução Russa?', r: '1917', d: 'História' },
  { p: '⚔️ Em que ano começou a Segunda Guerra Mundial?', r: '1939', d: 'História' },
  { p: '🏰 Qual foi o último czar da Rússia?', r: 'nicolau ii', d: 'História' },
  { p: '🌙 Em que ano foi lançado o primeiro homem ao espaço?', r: '1961', d: 'História' },
  { p: '💣 Qual país lançou as bombas atômicas no Japão?', r: 'estados unidos', d: 'História' },
  { p: '📜 Qual imperador mandou construir a Grande Muralha da China?', r: 'qin shi huang', d: 'História' },
  { p: '🏛️ Em que ano foi promulgada a Constituição Brasileira atual?', r: '1988', d: 'História' },
  { p: '⚔️ Em que batalha os persas foram derrotados pelos gregos em 490 a.C.?', r: 'maratona', d: 'História' },
  { p: '🗡️ Quem foi o fundador do Islã?', r: 'maome', d: 'História' },
  { p: '🌍 Em que ano Nelson Mandela se tornou presidente da África do Sul?', r: '1994', d: 'História' },
  { p: '📚 Qual foi o primeiro livro impresso por Gutenberg?', r: 'biblia', d: 'História' },
  { p: '⚖️ Em que ano os EUA declararam guerra ao Japão?', r: '1941', d: 'História' },
  { p: '🔱 Qual foi o maior império da história em extensão territorial?', r: 'britanico', d: 'História' },
  { p: '🌊 Em que ano ocorreu o bombardeio de Pearl Harbor?', r: '1941', d: 'História' },
  { p: '🏰 Em que ano Getúlio Vargas assumiu o poder no Brasil?', r: '1930', d: 'História' },
  { p: '⚔️ Qual tratado dividiu o mundo entre Portugal e Espanha?', r: 'tordesilhas', d: 'História' },
  { p: '📜 Qual filósofo grego foi condenado à morte por corromper a juventude?', r: 'socrates', d: 'História' },
  { p: '🌍 Em que ano a União Soviética foi dissolvida?', r: '1991', d: 'História' },
  { p: '🏛️ Qual civilização inventou a democracia?', r: 'grega', d: 'História' },
  { p: '⚔️ Quantos anos durou a Primeira Guerra Mundial?', r: '4', d: 'História' },

  // ── GEOGRAFIA ─────────────────────────────────────────────────────────────
  { p: '🌍 Qual é a capital da Nova Zelândia?', r: 'wellington', d: 'Geografia' },
  { p: '🏔️ Qual é a montanha mais alta do mundo?', r: 'everest', d: 'Geografia' },
  { p: '🌊 Qual é o lago mais profundo do mundo?', r: 'baikal', d: 'Geografia' },
  { p: '🌐 Qual é o menor país do mundo?', r: 'vaticano', d: 'Geografia' },
  { p: '🏙️ Qual é a cidade mais populosa do Brasil?', r: 'sao paulo', d: 'Geografia' },
  { p: '🌴 Em qual continente fica o Rio Amazonas?', r: 'america do sul', d: 'Geografia' },
  { p: '🏝️ Qual é a maior ilha do mundo?', r: 'groelandia', d: 'Geografia' },
  { p: '🌏 Qual país tem a maior população do mundo?', r: 'india', d: 'Geografia' },
  { p: '🏙️ Qual é a capital da Argentina?', r: 'buenos aires', d: 'Geografia' },
  { p: '🗺️ Qual é o maior estado do Brasil?', r: 'amazonas', d: 'Geografia' },
  { p: '🏔️ Qual é o ponto mais baixo da Terra?', r: 'mar morto', d: 'Geografia' },
  { p: '🌊 Qual é o maior oceano do mundo?', r: 'pacifico', d: 'Geografia' },
  { p: '🏜️ Qual é o maior deserto quente do mundo?', r: 'saara', d: 'Geografia' },
  { p: '🗿 Em qual continente fica o Egito?', r: 'africa', d: 'Geografia' },
  { p: '🌍 Qual é a capital da África do Sul?', r: 'pretoria', d: 'Geografia' },
  { p: '🏝️ De qual país faz parte a Ilha de Páscoa?', r: 'chile', d: 'Geografia' },
  { p: '🌊 Qual é o maior mar do mundo?', r: 'mar das filipinas', d: 'Geografia' },
  { p: '🌐 Qual é o rio mais longo da América do Sul?', r: 'amazonas', d: 'Geografia' },
  { p: '🏙️ Qual é a capital do México?', r: 'cidade do mexico', d: 'Geografia' },
  { p: '🗺️ Qual é a capital da Coreia do Sul?', r: 'seul', d: 'Geografia' },
  { p: '🌍 Qual é o país mais extenso da América do Sul?', r: 'brasil', d: 'Geografia' },
  { p: '🏔️ Em qual país ficam os Alpes?', r: 'suica franca italia austria', d: 'Geografia' },
  { p: '🌐 Qual é o ponto mais fundo do oceano?', r: 'fossa das marianas', d: 'Geografia' },
  { p: '🏜️ Qual é o maior país da África?', r: 'algeria', d: 'Geografia' },
  { p: '🌊 Qual estreito separa a Europa da África?', r: 'gibraltar', d: 'Geografia' },

  // ── CIÊNCIA & TECNOLOGIA ──────────────────────────────────────────────────
  { p: '⚛️ Qual é o número atômico do carbono?', r: '6', d: 'Ciência' },
  { p: '🔬 Quem descobriu a teoria da gravitação universal?', r: 'isaac newton', d: 'Ciência' },
  { p: '🌌 Qual é o planeta mais distante do Sol?', r: 'netuno', d: 'Astronomia' },
  { p: '💻 Qual empresa criou o sistema iOS?', r: 'apple', d: 'Tecnologia' },
  { p: '🧬 Quantas bases nitrogenadas compõem o DNA?', r: '4', d: 'Biologia' },
  { p: '⭐ Qual é o nome da nossa estrela?', r: 'sol', d: 'Astronomia' },
  { p: '🧪 Qual é o símbolo químico da prata?', r: 'ag', d: 'Química' },
  { p: '🔭 Em que ano foi lançado o Telescópio Hubble?', r: '1990', d: 'Astronomia' },
  { p: '💡 Quem inventou o telefone?', r: 'alexander graham bell', d: 'Tecnologia' },
  { p: '🚀 Qual foi o primeiro homem a ir ao espaço?', r: 'yuri gagarin', d: 'Tecnologia' },
  { p: '⚛️ Qual partícula subatômica tem carga positiva?', r: 'proton', d: 'Física' },
  { p: '🌡️ A quantos graus Celsius a água congela?', r: '0', d: 'Física' },
  { p: '🧲 Qual cientista descobriu a teoria da evolução?', r: 'charles darwin', d: 'Biologia' },
  { p: '💻 Qual linguagem de programação é usada para desenvolvimento web front-end?', r: 'javascript', d: 'Tecnologia' },
  { p: '🔬 Qual é a unidade de medida da corrente elétrica?', r: 'ampere', d: 'Física' },
  { p: '🧬 Quantos reinos existem na classificação dos seres vivos?', r: '5', d: 'Biologia' },
  { p: '⚛️ Qual é o símbolo químico do sódio?', r: 'na', d: 'Química' },
  { p: '🌌 Qual é o maior planeta do sistema solar?', r: 'jupiter', d: 'Astronomia' },
  { p: '💡 Qual é a força que atrai os objetos para o centro da Terra?', r: 'gravidade', d: 'Física' },
  { p: '🧪 Qual gás os animais expiram no processo da respiração?', r: 'dioxido de carbono', d: 'Biologia' },
  { p: '🚀 Qual foi a missão que levou o primeiro homem à Lua?', r: 'apollo 11', d: 'Tecnologia' },
  { p: '⚛️ Qual é o nome da partícula responsável pela força eletromagnética?', r: 'foton', d: 'Física' },
  { p: '🌡️ Qual é o elemento com maior ponto de ebulição?', r: 'tungstenio', d: 'Física' },
  { p: '💻 Qual empresa criou o Android?', r: 'google', d: 'Tecnologia' },
  { p: '🔬 Qual estrutura celular é responsável pela síntese de proteínas?', r: 'ribossomo', d: 'Biologia' },

  // ── MATEMÁTICA ────────────────────────────────────────────────────────────
  { p: '🔢 Qual é o resultado de 5! (fatorial de 5)?', r: '120', d: 'Matemática' },
  { p: '📐 Qual é a fórmula para calcular a área de um triângulo?', r: 'base vezes altura dividido por 2', d: 'Matemática' },
  { p: '📊 Qual é o valor aproximado de π (pi)?', r: '3.14', d: 'Matemática' },
  { p: '🧮 Quantos lados tem um decágono?', r: '10', d: 'Matemática' },
  { p: '📈 Qual é o quinto número de Fibonacci?', r: '5', d: 'Matemática' },
  { p: '🔢 Qual é o resultado de 2^10?', r: '1024', d: 'Matemática' },
  { p: '📐 Quantos graus tem um ângulo raso?', r: '180', d: 'Geometria' },
  { p: '🎯 Qual é a derivada de sen(x)?', r: 'cos x', d: 'Cálculo' },
  { p: '📈 Quantos números primos existem entre 1 e 10?', r: '4', d: 'Matemática' },
  { p: '🧮 Quanto é cos(0°)?', r: '1', d: 'Matemática' },
  { p: '🔢 Qual é o resultado de 144 / 12?', r: '12', d: 'Matemática' },
  { p: '📐 Quantos ângulos iguais tem um triângulo equilátero?', r: '3', d: 'Geometria' },
  { p: '∑ Qual é a soma dos ângulos internos de um quadrilátero?', r: '360', d: 'Geometria' },
  { p: '🎲 Qual é a probabilidade de tirar cara em um lançamento de moeda?', r: '1/2', d: 'Matemática' },
  { p: '🧮 Quanto é log₁₀(1000)?', r: '3', d: 'Matemática' },
  { p: '📊 Qual é a moda de {3, 3, 5, 7, 7, 7, 9}?', r: '7', d: 'Estatística' },
  { p: '🔢 Qual é o resultado de 15² - 10²?', r: '125', d: 'Matemática' },
  { p: '📐 Qual é a área de um quadrado com lado 6?', r: '36', d: 'Geometria' },
  { p: '∑ Qual é o resultado da soma de 1 + 2 + 3 + ... + 10?', r: '55', d: 'Matemática' },

  // ── BASQUETE ──────────────────────────────────────────────────────────────
  { p: '🏀 Qual jogador é conhecido como "The Answer"?', r: 'allen iverson', d: 'Basquete' },
  { p: '🏀 Qual time foi campeão da NBA em 2021?', r: 'milwaukee bucks', d: 'Basquete' },
  { p: '🏀 Em qual time Hakeem Olajuwon ganhou seus dois títulos?', r: 'houston rockets', d: 'Basquete' },
  { p: '🏀 Quantos títulos da NBA o Golden State Warriors tem?', r: '7', d: 'Basquete' },
  { p: '🏀 Qual jogador é conhecido como "The Point God"?', r: 'chris paul', d: 'Basquete' },
  { p: '🏀 Qual time foi campeão da NBA em 2022?', r: 'golden state warriors', d: 'Basquete' },
  { p: '🏀 Em que posição joga um armador?', r: 'point guard', d: 'Basquete' },
  { p: '🏀 Quantos títulos da NBA Michael Jordan ganhou?', r: '6', d: 'Basquete' },
  { p: '🏀 Qual jogador ganhou o MVP da temporada NBA em 2024?', r: 'nikola jokic', d: 'Basquete' },
  { p: '🏀 Em que time Magic Johnson jogou toda a carreira?', r: 'los angeles lakers', d: 'Basquete' },
  { p: '🏀 Qual time foi campeão da NBA em 2023?', r: 'denver nuggets', d: 'Basquete' },
  { p: '🏀 Qual jogador tem o apelido de "The Big Fundamental"?', r: 'tim duncan', d: 'Basquete' },
  { p: '🏀 Quantos títulos da NBA Bill Russell ganhou pelo Celtics?', r: '11', d: 'Basquete' },
  { p: '🏀 Em que posição joga um pivô?', r: 'center', d: 'Basquete' },
  { p: '🏀 Qual brasileiro atuou no Phoenix Suns?', r: 'leandro barbosa', d: 'Basquete' },
  { p: '🏀 Qual jogador tem mais assistências na história da NBA?', r: 'john stockton', d: 'Basquete' },
  { p: '🏀 Quantos pontos vale uma cesta de três pontos?', r: '3', d: 'Basquete' },
  { p: '🏀 Qual time foi campeão da NBA em 2018?', r: 'golden state warriors', d: 'Basquete' },
  { p: '🏀 Qual é o apelido de Shaquille O\'Neal?', r: 'shaq', d: 'Basquete' },
  { p: '🏀 Em que estado fica o time dos Celtics?', r: 'massachusetts', d: 'Basquete' },
  { p: '🏀 Qual jogador marcou 100 pontos em um único jogo da NBA?', r: 'wilt chamberlain', d: 'Basquete' },
  { p: '🏀 Qual time foi campeão da NBA em 2024?', r: 'boston celtics', d: 'Basquete' },
  { p: '🏀 Quantas temporadas LeBron James jogou no Miami Heat?', r: '4', d: 'Basquete' },
  { p: '🏀 Em que time Charles Barkley jogou a maior parte da carreira?', r: 'phoenix suns', d: 'Basquete' },
  { p: '🏀 Qual time foi campeão da NBA em 2015?', r: 'golden state warriors', d: 'Basquete' },
  { p: '🏀 Qual país venceu o basquete masculino nas Olimpíadas de 2024?', r: 'estados unidos', d: 'Basquete' },
  { p: '🏀 Qual foi a pontuação máxima de Wilt Chamberlain em uma temporada?', r: '50.4', d: 'Basquete' },
  { p: '🏀 Qual jogador é chamado de "The Joker"?', r: 'nikola jokic', d: 'Basquete' },
  { p: '🏀 Qual time ganhou o primeiro título da NBA depois de ser criado em 1966?', r: 'chicago bulls', d: 'Basquete' },
  { p: '🏀 Quantos MVPs da NBA LeBron James ganhou?', r: '4', d: 'Basquete' },
  { p: '🏀 Qual é o apelido de Jayson Tatum?', r: 'tatum', d: 'Basquete' },
  { p: '🏀 Qual foi o Dream Team mais famoso (ano)?', r: '1992', d: 'Basquete' },
  { p: '🏀 Em que cidade ficam os Lakers?', r: 'los angeles', d: 'Basquete' },
  { p: '🏀 Qual seleção venceu o basquete feminino nas Olimpíadas de 2024?', r: 'estados unidos', d: 'Basquete' },
  { p: '🏀 Qual seleção ganhou o Mundial FIBA de 2019?', r: 'espanha', d: 'Basquete' },
  { p: '🏀 Quantos pontos vale um lançamento livre?', r: '1', d: 'Basquete' },
  { p: '🏀 Quantos minutos dura uma partida de basquete olímpico?', r: '40', d: 'Basquete' },
  { p: '🏀 Quantos segundos um time tem para cruzar a linha do meio-campo na NBA?', r: '8', d: 'Basquete' },
  { p: '🏀 Qual é a distância da linha de três pontos ao aro na NBA (em metros)?', r: '7.24', d: 'Basquete' },
  { p: '🏀 Quantas faltas técnicas resultam em expulsão na NBA?', r: '2', d: 'Basquete' },
  { p: '🏀 Qual franquia da NBA nunca ganhou um título?', r: 'oklahoma city thunder', d: 'Basquete' },
  { p: '🏀 Em qual país o basquete foi criado?', r: 'canada', d: 'Basquete' },
  { p: '🏀 Em que ano Kobe Bryant foi draftado pela NBA?', r: '1996', d: 'Basquete' },
  { p: '🏀 Qual é o nome do troféu de MVP da temporada NBA?', r: 'maurice podoloff', d: 'Basquete' },
  { p: '🏀 Em que ano a WNBA foi fundada?', r: '1996', d: 'Basquete' },

  // ── ANIME ─────────────────────────────────────────────────────────────────

  // ── NARUTO ────────────────────────────────────────────────────────────────
  { p: '🍥 Qual é o nome do demônio selado dentro de Naruto?', r: 'kurama', d: 'Anime' },
  { p: '🍥 Qual técnica é a mais famosa de Naruto?', r: 'rasengan', d: 'Anime' },
  { p: '🍥 Qual é o nome do sensei de Naruto, Sasuke e Sakura?', r: 'kakashi', d: 'Anime' },
  { p: '🍥 Em qual vila ninja Naruto nasceu?', r: 'vila da folha', d: 'Anime' },
  { p: '🍥 Qual é o clã de Sasuke?', r: 'uchiha', d: 'Anime' },
  { p: '🍥 Quem é o pai de Naruto?', r: 'minato', d: 'Anime' },
  { p: '🍥 Qual organização criminosa persegue os bijuus?', r: 'akatsuki', d: 'Anime' },
  { p: '🍥 Quem é o irmão mais velho de Sasuke?', r: 'itachi', d: 'Anime' },
  { p: '🍥 Qual personagem usa a técnica Chidori?', r: 'sasuke', d: 'Anime' },
  { p: '🍥 Qual bijuu está dentro de Gaara?', r: 'shukaku', d: 'Anime' },
  { p: '🍥 Quem criou o jutsu Rasengan?', r: 'minato', d: 'Anime' },
  { p: '🍥 Qual vilão quer usar o plano Tsuki no Me?', r: 'madara', d: 'Anime' },
  { p: '🍥 Qual é o nome do filho de Naruto?', r: 'boruto', d: 'Anime' },
  { p: '🍥 Qual personagem tem o kekkei genkai Byakugan?', r: 'hinata', d: 'Anime' },
  { p: '🍥 Qual é o modo supremo de poder de Naruto?', r: 'modo seis caminhos', d: 'Anime' },
  { p: '🍥 Qual é o nome do grupo de Naruto quando criança?', r: 'time 7', d: 'Anime' },
  { p: '🍥 Qual é o título do líder máximo da Vila da Folha?', r: 'hokage', d: 'Anime' },
  { p: '🍥 Qual personagem é sensei lendário e mestre de Minato?', r: 'jiraiya', d: 'Anime' },
  { p: '🍥 Qual é o nome da mãe de Naruto?', r: 'kushina', d: 'Anime' },
  { p: '🍥 Qual é o kekkei genkai do clã Uchiha?', r: 'sharingan', d: 'Anime' },
  { p: '🍥 Qual personagem usa areia como arma em Naruto?', r: 'gaara', d: 'Anime' },
  { p: '🍥 Qual é o nome do cachorro ninja de Kiba?', r: 'akamaru', d: 'Anime' },
  { p: '🍥 Qual é o jutsu de clone mais usado por Naruto?', r: 'kage bunshin', d: 'Anime' },
  { p: '🍥 Qual personagem é especialista em genjutsu e usa cabelo rosa?', r: 'sakura', d: 'Anime' },
  { p: '🍥 Qual é o nome do vilão final de Naruto Shippuden?', r: 'kaguya', d: 'Anime' },
  { p: '🍥 Qual personagem carrega o bijuu de dez caudas?', r: 'obito', d: 'Anime' },
  { p: '🍥 Qual técnica Itachi usa para prender inimigos em ilusões eternas?', r: 'tsukuyomi', d: 'Anime' },
  { p: '🍥 Qual é o nome da esposa de Naruto?', r: 'hinata', d: 'Anime' },
  { p: '🍥 Qual bijuu tem nove caudas?', r: 'kurama', d: 'Anime' },
  { p: '🍥 Qual personagem é o "eterno rival" de Naruto?', r: 'sasuke', d: 'Anime' },

  // ── DEATH NOTE ────────────────────────────────────────────────────────────
  { p: '📓 Qual é o nome do shinigami dono do Death Note original?', r: 'ryuk', d: 'Anime' },
  { p: '📓 Qual é o verdadeiro nome de Kira?', r: 'light yagami', d: 'Anime' },
  { p: '📓 Qual é o apelido do detetive que investiga Kira?', r: 'l', d: 'Anime' },
  { p: '📓 O que acontece com quem tem o nome escrito no Death Note?', r: 'morre', d: 'Anime' },
  { p: '📓 Qual é o nome completo de L?', r: 'l lawliet', d: 'Anime' },
  { p: '📓 Qual personagem substitui L após sua morte?', r: 'near', d: 'Anime' },
  { p: '📓 Qual é o nome da shinigami feminina?', r: 'rem', d: 'Anime' },
  { p: '📓 Quem escreve o nome de Light no Death Note no final?', r: 'ryuk', d: 'Anime' },
  { p: '📓 Qual é a seguidora fanática de Kira que se torna atriz?', r: 'misa amane', d: 'Anime' },
  { p: '📓 O que Light perde quando abandona o Death Note temporariamente?', r: 'memorias', d: 'Anime' },
  { p: '📓 Em quantos segundos a pessoa morre de ataque cardíaco no Death Note?', r: '40', d: 'Anime' },
  { p: '📓 Qual é o rival de Near que trabalha com a Máfia?', r: 'mello', d: 'Anime' },
  { p: '📓 Qual organização internacional L usa como fachada?', r: 'wammy', d: 'Anime' },
  { p: '📓 Qual é o cargo do pai de Light Yagami?', r: 'policial', d: 'Anime' },
  { p: '📓 Qual é o hábito característico de L ao sentar?', r: 'agachado', d: 'Anime' },
  { p: '📓 Qual comida L come o tempo todo em Death Note?', r: 'doces', d: 'Anime' },
  { p: '📓 Qual é o nome do shinigami que dá o Death Note para Misa?', r: 'jealous', d: 'Anime' },
  { p: '📓 Qual sentido Misa sacrifica duas vezes para ter o olho do shinigami?', r: 'metade da vida', d: 'Anime' },
  { p: '📓 Qual é o nome do orfanato onde L, Near e Mello foram criados?', r: 'wammy', d: 'Anime' },
  { p: '📓 Qual é a profissão de Misa Amane antes de conhecer Light?', r: 'modelo', d: 'Anime' },

  // ── DRAGON BALL ───────────────────────────────────────────────────────────
  { p: '🐉 Quantas esferas do dragão existem?', r: '7', d: 'Anime' },
  { p: '🐉 Qual é o nome do dragão invocado pelas esferas?', r: 'shenlong', d: 'Anime' },
  { p: '🐉 Qual é a raça de Goku?', r: 'saiyajin', d: 'Anime' },
  { p: '🐉 Qual é o nome do pai de Goku?', r: 'bardock', d: 'Anime' },
  { p: '🐉 Qual é o rival mais icônico de Goku?', r: 'vegeta', d: 'Anime' },
  { p: '🐉 Qual é o nome da fusão de Goku e Vegeta com os brincos?', r: 'vegito', d: 'Anime' },
  { p: '🐉 Qual vilão destruiu o planeta dos Saiyajins?', r: 'freeza', d: 'Anime' },
  { p: '🐉 Qual personagem inventou o Kame Hame Ha?', r: 'muten roshi', d: 'Anime' },
  { p: '🐉 Qual é o nome do deus da destruição do universo 7?', r: 'beerus', d: 'Anime' },
  { p: '🐉 Qual vilão absorve Androides para ficar mais forte?', r: 'cell', d: 'Anime' },
  { p: '🐉 Quem matou Freeza pela primeira vez?', r: 'trunks', d: 'Anime' },
  { p: '🐉 Qual é o nome da transformação divina de Goku?', r: 'super saiyajin blue', d: 'Anime' },
  { p: '🐉 Qual é o nome do filho mais velho de Goku?', r: 'gohan', d: 'Anime' },
  { p: '🐉 Qual é o nome do filho mais novo de Goku?', r: 'goten', d: 'Anime' },
  { p: '🐉 Qual é o nome do anjo guia de Beerus?', r: 'whis', d: 'Anime' },
  { p: '🐉 Qual é o nome da fusão por dança de Goku e Vegeta?', r: 'gogeta', d: 'Anime' },
  { p: '🐉 Qual é o planeta natal dos Saiyajins?', r: 'vegeta', d: 'Anime' },
  { p: '🐉 Qual vilão é o rei dos Androides criado pelo Dr. Gero?', r: 'cell', d: 'Anime' },
  { p: '🐉 Qual é o nome do avô adotivo de Goku?', r: 'gohan', d: 'Anime' },
  { p: '🐉 Qual forma Gohan usou para derrotar Cell definitivamente?', r: 'super saiyajin 2', d: 'Anime' },
  { p: '🐉 Qual é o nível mais alto de Super Saiyajin clássico?', r: 'super saiyajin 3', d: 'Anime' },
  { p: '🐉 Qual personagem é o melhor amigo de Goku desde criança?', r: 'krillin', d: 'Anime' },
  { p: '🐉 Qual é o nome da esposa de Goku?', r: 'chi-chi', d: 'Anime' },
  { p: '🐉 Qual androide feminina se torna esposa de Krillin?', r: 'androide 18', d: 'Anime' },
  { p: '🐉 Qual personagem é o filho do Vegeta e Bulma do futuro?', r: 'trunks', d: 'Anime' },
  { p: '🐉 Qual é o nome do vilão mais poderoso de Dragon Ball Super?', r: 'moro', d: 'Anime' },
  { p: '🐉 Qual personagem tem o apelido de "O Guerreiro Lendário"?', r: 'broly', d: 'Anime' },
  { p: '🐉 Qual é o nome do torneio entre os universos em DBS?', r: 'torneio do poder', d: 'Anime' },
  { p: '🐉 Qual universo Goku representa no Torneio do Poder?', r: 'universo 7', d: 'Anime' },
  { p: '🐉 Qual é a cor do cabelo de Goku no Super Saiyajin?', r: 'dourado', d: 'Anime' },

  // ── ATTACK ON TITAN ───────────────────────────────────────────────────────
  { p: '⚔️ Qual é o nome do protagonista de Attack on Titan?', r: 'eren yeager', d: 'Anime' },
  { p: '⚔️ Qual é o nome do capitão da Tropa de Reconhecimento?', r: 'levi', d: 'Anime' },
  { p: '⚔️ Qual é o nome da melhor amiga de Eren?', r: 'mikasa', d: 'Anime' },
  { p: '⚔️ Qual é o plano final de Eren para proteger Paradis?', r: 'rumbling', d: 'Anime' },
  { p: '⚔️ Qual tropa combate os titãs fora das muralhas?', r: 'tropa de reconhecimento', d: 'Anime' },
  { p: '⚔️ Qual é o poder especial de Eren?', r: 'tita ataque', d: 'Anime' },
  { p: '⚔️ Qual é o nome do amigo de infância de Eren que carrega o Tita Blindado?', r: 'reiner', d: 'Anime' },
  { p: '⚔️ Qual personagem carrega o Tita Colossal além de Bertholdt?', r: 'armin', d: 'Anime' },
  { p: '⚔️ Qual é o nome do melhor amigo de Eren desde criança (além de Mikasa)?', r: 'armin', d: 'Anime' },
  { p: '⚔️ Qual é o nome da raça humana que pode virar titã?', r: 'eldians', d: 'Anime' },
  { p: '⚔️ Qual é o nome do pai de Eren que lhe injetou o titan?', r: 'grisha', d: 'Anime' },
  { p: '⚔️ Qual é o nome da organização militar de elite dentro das muralhas?', r: 'policia militar', d: 'Anime' },
  { p: '⚔️ Qual personagem é o comandante supremo da Tropa de Reconhecimento?', r: 'erwin', d: 'Anime' },
  { p: '⚔️ Qual é o nome da ilha onde os Eldians de Paradis vivem?', r: 'paradis', d: 'Anime' },
  { p: '⚔️ Qual nação está em guerra contra Paradis em AoT?', r: 'marley', d: 'Anime' },
  { p: '⚔️ Qual é o nome do Tita de 60 metros que aparece no início?', r: 'tita colossal', d: 'Anime' },
  { p: '⚔️ Qual personagem tem o poder do Tita Mandíbula?', r: 'porco', d: 'Anime' },
  { p: '⚔️ Qual é o sobrenome da família de Mikasa?', r: 'ackerman', d: 'Anime' },
  { p: '⚔️ Qual é o nome do tita que devorou a mãe de Eren?', r: 'tita sorridente', d: 'Anime' },
  { p: '⚔️ Qual é a arma usada pelos soldados para se mover entre os telhados?', r: 'equipamento de mobilidade', d: 'Anime' },

  // ── NOVAS PERGUNTAS: MAIS VARIEDADE NOS TEMAS EXISTENTES ───────────────────
  // Futebol
  { p: '⚽ Quantos jogadores de cada equipe começam uma partida de futebol em campo?', r: '11', d: 'Futebol' },
  { p: '⚽ Qual país sediou a Copa do Mundo masculina de 2022?', r: 'catar', d: 'Futebol' },
  { p: '⚽ Qual é o nome do estádio do Real Madrid?', r: 'santiago bernabeu', d: 'Futebol' },
  { p: '⚽ Qual seleção é conhecida como Albiceleste?', r: 'argentina', d: 'Futebol' },
  { p: '⚽ Qual é a duração regulamentar de uma partida de futebol, sem acréscimos?', r: '90 minutos', d: 'Futebol' },
  { p: '⚽ Qual país venceu a Copa do Mundo feminina de 2023?', r: 'espanha', d: 'Futebol' },
  { p: '⚽ Qual clube brasileiro manda seus jogos no Allianz Parque?', r: 'palmeiras', d: 'Futebol' },
  { p: '⚽ Como se chama quando um jogador marca três gols na mesma partida?', r: 'hat-trick', d: 'Futebol' },

  // História
  { p: '📜 Qual civilização antiga construiu Machu Picchu?', r: 'inca', d: 'História' },
  { p: '📜 Em que ano caiu o Muro de Berlim?', r: '1989', d: 'História' },
  { p: '📜 Qual navio afundou em sua viagem inaugural em 1912?', r: 'titanic', d: 'História' },
  { p: '📜 Quem foi a primeira pessoa a viajar para o espaço?', r: 'yuri gagarin', d: 'História' },
  { p: '📜 Qual império tinha Constantinopla como capital?', r: 'imperio bizantino', d: 'História' },
  { p: '📜 Em que ano foi proclamada a Independência do Brasil?', r: '1822', d: 'História' },
  { p: '📜 Qual documento inglês de 1215 limitou os poderes do rei?', r: 'magna carta', d: 'História' },
  { p: '📜 Qual povo antigo desenvolveu a escrita cuneiforme na Mesopotâmia?', r: 'sumérios', d: 'História' },

  // Geografia
  { p: '🗺️ Qual é a capital do Canadá?', r: 'ottawa', d: 'Geografia' },
  { p: '🗺️ Qual país tem formato aproximado de uma bota?', r: 'italia', d: 'Geografia' },
  { p: '🗺️ Em qual país fica a cidade de Kyoto?', r: 'japao', d: 'Geografia' },
  { p: '🗺️ Qual linha imaginária divide a Terra em hemisférios Norte e Sul?', r: 'linha do equador', d: 'Geografia' },
  { p: '🗺️ Qual é a capital da Nova Zelândia?', r: 'wellington', d: 'Geografia' },
  { p: '🗺️ Qual país sul-americano não faz fronteira com o Brasil: Chile ou Bolívia?', r: 'chile', d: 'Geografia' },
  { p: '🗺️ Em qual continente fica o deserto de Gobi?', r: 'asia', d: 'Geografia' },
  { p: '🗺️ Qual é a capital de Portugal?', r: 'lisboa', d: 'Geografia' },

  // Ciência, tecnologia e natureza
  { p: '🔬 Qual órgão bombeia o sangue pelo corpo humano?', r: 'coracao', d: 'Biologia' },
  { p: '🧪 Qual é a fórmula química da água?', r: 'h2o', d: 'Química' },
  { p: '🌱 Como se chama o processo pelo qual as plantas usam luz para produzir alimento?', r: 'fotossintese', d: 'Biologia' },
  { p: '🌍 Qual camada da atmosfera ajuda a absorver grande parte da radiação ultravioleta?', r: 'camada de ozonio', d: 'Ciência' },
  { p: '🪐 Qual planeta é famoso por seus anéis visíveis?', r: 'saturno', d: 'Astronomia' },
  { p: '⚡ Qual é a unidade de medida da resistência elétrica?', r: 'ohm', d: 'Física' },
  { p: '🦴 Qual é o maior osso do corpo humano?', r: 'femur', d: 'Biologia' },
  { p: '💻 O que significa a sigla CPU em computadores?', r: 'unidade central de processamento', d: 'Tecnologia' },
  { p: '🌡️ Qual instrumento mede a pressão atmosférica?', r: 'barometro', d: 'Física' },
  { p: '🧬 Qual molécula carrega grande parte da informação genética dos seres vivos?', r: 'dna', d: 'Biologia' },

  // Matemática
  { p: '🔢 Quanto é 15% de 200?', r: '30', d: 'Matemática' },
  { p: '📐 Como se chama um polígono de oito lados?', r: 'octogono', d: 'Geometria' },
  { p: '🧮 Resolva: 7 × (8 − 3).', r: '35', d: 'Matemática' },
  { p: '📊 Qual é a média aritmética de 4, 6 e 8?', r: '6', d: 'Estatística' },
  { p: '📐 Quantos centímetros há em um metro?', r: '100', d: 'Matemática' },
  { p: '🔢 Qual é o menor número primo?', r: '2', d: 'Matemática' },
  { p: '📐 Qual é o perímetro de um quadrado com lados de 5 cm?', r: '20 cm', d: 'Geometria' },
  { p: '🧮 Resolva a equação 3x = 21. Qual é o valor de x?', r: '7', d: 'Matemática' },

  // Basquete
  { p: '🏀 Quantos jogadores de cada equipe ficam em quadra durante uma partida de basquete?', r: '5', d: 'Basquete' },
  { p: '🏀 Quantos pontos vale uma cesta feita dentro da linha de três pontos, durante uma jogada normal?', r: '2', d: 'Basquete' },
  { p: '🏀 Qual liga profissional é conhecida pela sigla NBA?', r: 'national basketball association', d: 'Basquete' },
  { p: '🏀 Qual fundamento reinicia o jogo com a bola lançada ao alto pelo árbitro?', r: 'bola ao alto', d: 'Basquete' },
  { p: '🏀 Qual jogador brasileiro ficou conhecido como Nenê?', r: 'nene hilario', d: 'Basquete' },

  // Anime — novas séries e perguntas variadas
  { p: '🏴‍☠️ Em One Piece, qual é o sonho de Monkey D. Luffy?', r: 'ser o rei dos piratas', d: 'Anime' },
  { p: '🏴‍☠️ Qual é o nome do espadachim que viaja com Luffy em One Piece?', r: 'roronoa zoro', d: 'Anime' },
  { p: '🦸 Em My Hero Academia, qual é o nome do herói que passa seu poder a Deku?', r: 'all might', d: 'Anime' },
  { p: '🧪 Em Fullmetal Alchemist, quais irmãos procuram a Pedra Filosofal?', r: 'edward e alphonse elric', d: 'Anime' },
  { p: '👊 Em One Punch Man, quantos socos Saitama normalmente precisa para derrotar um inimigo?', r: 'um', d: 'Anime' },
  { p: '🗡️ Em Demon Slayer, qual é o nome da irmã de Tanjiro?', r: 'nezuko', d: 'Anime' },
  { p: '🏐 Qual esporte é o foco principal do anime Haikyuu!!?', r: 'volei', d: 'Anime' },
  { p: '🧠 Em Code Geass, qual poder permite a Lelouch dar ordens absolutas?', r: 'geass', d: 'Anime' },
];

// Perguntas adicionais: 50 novas entradas para cada tema existente.
perguntasQuiz.push(...require('./quiz.extra-questions.json'));

// Registra abreviações explícitas de nomes consagrados em perguntas antigas.
for (const pergunta of perguntasQuiz) {
  if (normalize(pergunta.r || '') === 'cristiano ronaldo') {
    pergunta.aliases = [...new Set([...(pergunta.aliases || []), 'CR7'])];
  }
}

// handleQuiz
async function handleQuiz(sock, msg, jid, author, senderJid, caption = '') {

  // ── Resolver @lid → telefone real ─────────────────────────────────────────
  const resolvedJidNorm = await resolverJidCarteira(senderJid, jid);

  await syncQuizPointsFromDB(resolvedJidNorm);

  // ── Verificar se está respondendo uma pergunta ativa ──────────────────────
  if (quizState.has(senderJid)) {
    const state = quizState.get(senderJid);

    const textoRaw =
      caption ||
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.ephemeralMessage?.message?.conversation ||
      msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text || '';

    const comandoSolicitado = normalizarComandoQuiz(textoRaw);
    if (ehComandoQuiz(comandoSolicitado)) {
      // Um novo comando de quiz substitui a pergunta pendente. Antes, este
      // caminho retornava silenciosamente e impedia trocar de tema (ex.: /quizgeo).
      clearTimeout(state.timeout);
      quizState.delete(senderJid);
    } else {
      // Nunca interpretar comandos prefixados como respostas do quiz.
      if (/^[!.,\/@#]/.test(textoRaw)) return;

      const resposta = normalize(textoRaw);

      if (!resposta) {
        await sock.sendMessage(jid, {
          text: `❌ Você deve enviar uma *resposta em texto*! 😅`,
        }, { quoted: msg });
        return;
      }

      clearTimeout(state.timeout);
      quizState.delete(senderJid);

      // Usa o JID resolvido salvo no state (garante que veio do LidMapping correto)
      const effectiveJid = state.resolvedJid ?? resolvedJidNorm;

      const acertou = respostaCorresponde(textoRaw, state.r, state.aliases || []);

      if (acertou) {
        const pts = (pontosMap.get(effectiveJid) || 0) + 10;
        pontosMap.set(effectiveJid, pts);

        const goldReward = QUIZ_GOLD_REWARD;
        const [, novoSaldoGold] = await Promise.all([
          saveQuizPointsToDB(effectiveJid, jid),
          changeGold(effectiveJid, goldReward, jid),
          Usuario.findOneAndUpdate(
            { idWhatsApp: effectiveJid },
            { $inc: { 'dailyMissions.progress.quiz5': 1 } }
          ).catch(e => console.error('⚠️ Erro ao atualizar progresso quiz5:', e.message)),
        ]);
        const incentivoDiario = await registrarAcertoDiarioQuiz(effectiveJid, jid).catch(e => {
          console.error('⚠️ Erro ao atualizar bônus diário do Quiz:', e.message);
          return null;
        });

        const linhaGold = `💵 *+${formatarNumeroBR(goldReward)} Pratas!* Saldo: *${formatarNumeroBR(novoSaldoGold)} Pratas*`;
        const linhaIncentivo = !incentivoDiario ? '' : incentivoDiario.bonusConcedido
          ? `\n🎁 *BÔNUS DIÁRIO!* Você completou ${QUIZ_DAILY_BONUS_TARGET} acertos e recebeu *+${QUIZ_DAILY_BONUS_PRATA} Pratas extras!*`
          : `\n🎯 *Meta diária:* ${incentivoDiario.acertos}/${QUIZ_DAILY_BONUS_TARGET} acertos — complete a meta e ganhe *+${QUIZ_DAILY_BONUS_PRATA} Pratas!*`;

        await sock.sendMessage(jid, {
          text:
            `✅ *CORRETO!* Parabéns, *${author}*! 🎉\n\n` +
            `💰 *+10 pontos!* Total: *${pts} pts*\n` +
            linhaGold + linhaIncentivo,
        }, { quoted: msg });

      } else {
        await sock.sendMessage(jid, {
          text: `❌ *ERROU!* *${author}*! Tente novamente no próximo quiz. 😬`,
        }, { quoted: msg });
      }
      return;
    }
  }

  // ── Filtrar por categoria ─────────────────────────────────────────────────
  const cmdClean = normalizarComandoQuiz(caption);
  const filtro = resolverFiltroQuiz(cmdClean);
  const bancoEspecial = resolverBancoQuiz(cmdClean);
  const perguntasFiltradas = bancoEspecial || (filtro ? perguntasQuiz.filter(filtro) : perguntasQuiz);

  if (perguntasFiltradas.length === 0) {
    await sock.sendMessage(jid, {
      text: '⚠️ Nenhuma pergunta disponível para essa categoria no momento.',
    }, { quoted: msg });
    return;
  }

  // Registra a tentativa atomicamente para impedir que comandos simultâneos
  // ultrapassem o limite de 30 quizzes na mesma janela de 30 minutos.
  const tentativaQuiz = await registrarInicioQuiz(resolvedJidNorm);
  if (!tentativaQuiz.permitido) {
    const minutos = Math.max(1, Math.ceil((tentativaQuiz.restanteMs || 0) / 60_000));
    const texto = tentativaQuiz.indisponivel
      ? '⚠️ Não consegui verificar seu limite de quizzes agora. Tente novamente em instantes.'
      : `⚠️ *${author}*, você atingiu o limite de *${QUIZ_WINDOW_LIMIT} quizzes a cada 30 minutos*! Tente novamente em aproximadamente *${minutos} minuto(s)*. 😴`;
    await sock.sendMessage(jid, { text: texto }, { quoted: msg });
    return;
  }
  const quizCount = tentativaQuiz.count - 1;

  // ── Sortear pergunta sem repetir recentemente ─────────────────────────────
  const recentes    = recentQuizMap.get(resolvedJidNorm) ?? [];
  const naoRecentes = perguntasFiltradas.filter(p => !recentes.includes(p.p));
  const pool        = naoRecentes.length > 0 ? naoRecentes : perguntasFiltradas;
  const q           = pool[Math.floor(Math.random() * pool.length)];

  recentes.push(q.p);
  const janelaRecentes = Math.min(5, Math.floor(perguntasFiltradas.length / 2));
  while (recentes.length > janelaRecentes) recentes.shift();
  recentQuizMap.set(resolvedJidNorm, recentes);

  // ── Timeout de 30s ────────────────────────────────────────────────────────
  const authorSnapshot = author;

  const timeout = setTimeout(() => {
    if (quizState.has(senderJid)) {
      quizState.delete(senderJid);
      sock.sendMessage(jid, {
        text: mensagemQuizTempoEsgotado(authorSnapshot),
      }, { quoted: msg }).catch(() => {});
    }
  }, 30_000);

  // Salva resolvedJidNorm para usar na correção da resposta
  quizState.set(senderJid, { r: q.r, aliases: q.aliases || [], resolvedJid: resolvedJidNorm, timeout });

  const restantes = QUIZ_WINDOW_LIMIT - tentativaQuiz.count;

  await sock.sendMessage(jid, {
    text:
      `🧠 *QUIZ — ${q.d.toUpperCase()}*\n\n` +
      `❓ *${q.p}*\n\n` +
      `⏱️ _Você tem 30 segundos!_\n` +
      `📊 _Quiz ${tentativaQuiz.count}/${QUIZ_WINDOW_LIMIT} na janela de 30 min · ${restantes} restante(s)_\n` +
      `🎁 _Acerte ${QUIZ_DAILY_BONUS_TARGET} perguntas no dia e ganhe +${QUIZ_DAILY_BONUS_PRATA.toLocaleString('pt-BR')} Pratas extras!_`,
  }, { quoted: msg });
}


function mensagemQuizTempoEsgotado(author) {
  return `⏰ *Tempo esgotado*, *${author}*! Você não conseguiu responder a tempo. 😬`;
}

function resolverBancoQuiz(comando) {
  if (comando === 'quiztiktok') return perguntasQuizTikTok;
  if (comando === 'quizmoda') return perguntasQuizModa;
  return null;
}

// ─── !pontos ─────────────────────────────────────────────────────────────────

async function handlePontos(sock, msg, jid, author, senderJid) {

  // ── Resolver @lid para jid real ───────────────────────────────────────────
  const resolvedJid = await resolverJidCarteira(senderJid, jid);

  await syncQuizPointsFromDB(resolvedJid);        // ← corrigido
  const pts = pontosMap.get(resolvedJid) || 0;    // ← corrigido

  const { emoji, titulo, comentario } =
    pts === 0   ? { emoji: '😴', titulo: 'Novato',        comentario: 'Nem começou ainda... joga logo!' } :
    pts < 30    ? { emoji: '😬', titulo: 'Iniciante',     comentario: 'Tá fraco(a)! Joga mais!' } :
    pts < 80    ? { emoji: '🙂', titulo: 'Aprendiz',      comentario: 'Razoável, pode melhorar!' } :
    pts < 150   ? { emoji: '😊', titulo: 'Intermediário', comentario: 'Bom desempenho! Continua assim!' } :
    pts < 250   ? { emoji: '😎', titulo: 'Avançado',      comentario: 'Excelente! Quase no topo!' } :
    pts < 500   ? { emoji: '🏆', titulo: 'Expert',        comentario: 'Impressionante! Você é bom(a)!' } :
                  { emoji: '👑', titulo: 'LENDA',          comentario: 'MONSTRO! Que pontuação absurda!' };

  // Barra de progresso
  const niveis     = [0, 30, 80, 150, 250, 500, Infinity];
  const nivelAtual = niveis.findIndex(n => pts < n) - 1;
  const ptsBase    = niveis[Math.max(nivelAtual, 0)];
  const ptsTopo    = niveis[Math.min(nivelAtual + 1, niveis.length - 1)];
  const pct        = ptsTopo === Infinity ? 100 : Math.floor(((pts - ptsBase) / (ptsTopo - ptsBase)) * 100);
  const barsOn     = Math.min(10, Math.floor(pct / 10));
  const barra      = '█'.repeat(barsOn) + '░'.repeat(10 - barsOn);

  await sock.sendMessage(jid, {
    text:
      `${emoji} *PONTUAÇÃO DE QUIZ*\n\n` +
      `👤 *Jogador:* ${author}\n` +
      `🏅 *Pontos:* ${pts} pts\n` +
      `🎖️ *Rank:* ${titulo}\n\n` +
      `📊 *Progresso:* [${barra}] ${pct}%\n\n` +
      `💬 _${comentario}_`,
  }, { quoted: msg });
}

// ─── !rankjogos ──────────────────────────────────────────────────────────────

async function handleRankJogos(sock, msg, jid, contactNames = {}) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, {
      text: '⚠️ Este comando só pode ser usado em grupos.',
    }, { quoted: msg });
    return;
  }

  try {
    const sorted = await CarteiraGrupo.find({ idGrupo: jid, quizPoints: { $gt: 0 } })
      .sort({ quizPoints: -1 })
      .limit(10)
      .lean();

    if (!sorted.length) {
      await sock.sendMessage(jid, {
        text:
          `🏆 *RANKING DE QUIZ — ESTE GRUPO*\n\n` +
          `📭 Nenhum ponto registrado ainda!\n\n` +
          `_Use *!quiz* para começar a pontuar!_`,
      }, { quoted: msg });
      return;
    }

    const totalPontos = sorted.reduce((s, u) => s + (u.quizPoints || 0), 0);
    const maxPontos   = sorted[0].quizPoints || 1;

    const linhas = await Promise.all(sorted.map(async (u, i) => {
      const nome = await resolveDisplayName(u.idWhatsApp, sock, contactNames, { fallback: 'Participante' });
      const pts = u.quizPoints || 0;
      const pct = ((pts / totalPontos) * 100).toFixed(1);
      const filled = Math.min(Math.round((pts / maxPontos) * 10), 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
      return MEDALS[i] + ' *' + nome + '*\n   ' + bar + ' ' + pts + ' pts (' + pct + '%)';
    }));

    await sock.sendMessage(jid, {
      text:
        `🏆 *RANKING DE QUIZ — ESTE GRUPO* 🏆\n\n` +
        `${linhas.join('\n\n')}\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🎯 Total de pontos no grupo: *${totalPontos} pts*\n` +
        `_Use *!quiz* para subir no ranking!_`,
    }, { quoted: msg });

  } catch (e) {
    console.error('[RankJogos] handleRankJogos:', e.message);
    await sock.sendMessage(jid, {
      text: '⚠️ Erro ao carregar o ranking. Tente novamente!',
    }, { quoted: msg });
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  handleQuiz,
  handlePontos,
  handleRankJogos,
  changeGold,
  registrarAcertoDiarioQuiz,
  respostaCorresponde,
  mensagemQuizTempoEsgotado,
  registrarInicioQuiz,
  QUIZ_WINDOW_LIMIT,
  QUIZ_WINDOW_MS,
  QUIZ_GOLD_BASE_REWARD,
  QUIZ_GOLD_MULTIPLIER,
  QUIZ_GOLD_REWARD,
  resolverBancoQuiz,
  resolverFiltroQuiz,
  ehComandoQuiz,
  normalizarComandoQuiz,
  quizState,
  perguntasQuiz,
  perguntasQuizTikTok,
  perguntasQuizModa,
};