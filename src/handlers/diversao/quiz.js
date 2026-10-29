/**
 * Sistema de Quiz — Tico Bot
 * Comandos: !quiz, !quizfut, !quizctec, !quizgeo, !quizmat, !quizhis, !quizbsq
 *           !pontos, !rankjogos
 * - 185+ questões
 * - Limite de 10 quiz por dia por usuário
 * - Pontos salvos na nuvem (MongoDB)
 */

const path = require('path');
const Usuario       = require(path.join(__dirname, '..', '..', 'models', 'Usuario'));
const CarteiraGrupo = require(path.join(__dirname, '..', '..', 'models', 'CarteiraGrupo'));
const { prepareDailyMissionState } = require('./missoes');
const carteiraService = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));
const { resolverJidCarteira } = carteiraService;
// ─── ESTADO ──────────────────────────────────────────────────────────────────

const quizState      = new Map(); // senderJid → { r, resolvedJid, timeout }
const pontosMap      = new Map(); // senderJid → pts (cache)
const quizDailyCount = new Map(); // "senderJid_YYYY-MM-DD" → número de quizzes jogados hoje (cache)

// ✅ recentQuizMap substitui global.recentQuiz: escopo de módulo, sem vazamento
// entre workers, sem crescimento ilimitado de global
const recentQuizMap  = new Map(); // senderJid → string[] (últimas perguntas sorteadas)

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// ✅ Limite diário de quizzes — alterar aqui caso queira mudar futuramente
const DAILY_QUIZ_LIMIT = 15;

// ✅ Limpeza periódica de quizDailyCount — remove entradas de dias anteriores
// para evitar crescimento ilimitado da Map em processos de longa duração
const _dailyCleanup = setInterval(() => {
  const hoje = new Date().toISOString().split('T')[0];
  for (const key of quizDailyCount.keys()) {
    if (!key.endsWith(hoje)) quizDailyCount.delete(key);
  }
}, 60 * 60 * 1_000); // a cada hora

if (_dailyCleanup.unref) _dailyCleanup.unref();

// ─── UTILITÁRIOS ─────────────────────────────────────────────────────────────

function somenteGrupo(jid) {
  return jid?.endsWith('@g.us') ?? false;
}

function resolverNome(idWhatsApp, contactNames) {
  return contactNames?.[idWhatsApp] || idWhatsApp.split('@')[0];
}

function normalize(str) {
  return str
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getTodayKey(senderJid) {
  const today = new Date().toISOString().split('T')[0];
  return `${senderJid}_${today}`;
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
      return carteira;
    }

    console.log(`✅ Prata alterada: ${idNorm} → ${amount >= 0 ? '+' : ''}${amount} (sem grupo)`);
    return 0;

  } catch (e) {
    console.error('⚠️ Erro ao alterar Prata:', e.message);
    throw e;
  }
}

// ─── CONTAGEM DIÁRIA DE QUIZ (persistente) ──────────────────────────────────

// ✅ Lê a contagem diária. Usa o cache em memória se disponível; caso
// contrário (ex: logo após reiniciar o bot), consulta o MongoDB e
// repopula o cache — evitando que o limite "resete" sozinho ao reiniciar.
async function getQuizCountToday(userId) {
  const todayKey = getTodayKey(userId);

  if (quizDailyCount.has(todayKey)) {
    return quizDailyCount.get(todayKey);
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const user = await Usuario.findOne(
      { idWhatsApp: userId },
      { quizDaily: 1 }
    ).lean();

    const count = (user?.quizDaily?.date === today) ? (user.quizDaily.count || 0) : 0;
    quizDailyCount.set(todayKey, count);
    return count;
  } catch (e) {
    console.error('⚠️ Erro ao sincronizar contagem diária de quiz:', e.message);
    return 0;
  }
}

// ✅ Atualiza o cache em memória e persiste no MongoDB (quizDaily.date / quizDaily.count)
async function incrementQuizCountToday(userId, newCount) {
  const todayKey = getTodayKey(userId);
  quizDailyCount.set(todayKey, newCount);

  const today = new Date().toISOString().split('T')[0];
  try {
    await Usuario.findOneAndUpdate(
      { idWhatsApp: userId },
      { $set: { 'quizDaily.date': today, 'quizDaily.count': newCount } },
      { upsert: true }
    );
  } catch (e) {
    console.error('⚠️ Erro ao salvar contagem diária de quiz no MongoDB:', e.message);
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
  { p: '⚽ Qual jogador marcou o gol de bicicleta mais famoso da história do futebol em 2018?', r: 'cristiano ronaldo', d: 'Futebol' },
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
  { p: '⚽ Qual jogador é conhecido como "CR7"?', r: 'cristiano ronaldo', d: 'Futebol' },
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
  { p: '⚽ Qual jogador é o maior artilheiro da história da Champions League?', r: 'cristiano ronaldo', d: 'Futebol' },
  { p: '⚽ Em que ano Ronaldinho Gaúcho venceu a Copa do Mundo?', r: '2002', d: 'Futebol' },
  { p: '⚽ Qual seleção venceu a Copa do Mundo de 1998?', r: 'franca', d: 'Futebol' },
  { p: '⚽ Qual jogador tem mais títulos na história do futebol europeu?', r: 'cristiano ronaldo', d: 'Futebol' },
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

    // Ignora comandos durante quiz ativo
    if (/^[!.,\/@]/.test(textoRaw)) return;

    const resposta = normalize(textoRaw);

    if (!resposta.trim()) {
      await sock.sendMessage(jid, {
        text: `❌ Você deve enviar uma *resposta em texto*! 😅`,
      }, { quoted: msg });
      return;
    }

    clearTimeout(state.timeout);
    quizState.delete(senderJid);

    // Usa o JID resolvido salvo no state (garante que veio do LidMapping correto)
    const effectiveJid = state.resolvedJid ?? resolvedJidNorm;

    const correta = normalize(state.r);
    const respostasValidas = correta
      .split(/[\/|]/)
      .map(r => r.trim())
      .filter(Boolean);

    const acertou = resposta.length >= 2 && respostasValidas.some(rv =>
      resposta === rv ||
      resposta.includes(rv) ||
      rv.includes(resposta)
    );

    if (acertou) {
      const pts = (pontosMap.get(effectiveJid) || 0) + 10;
      pontosMap.set(effectiveJid, pts);

      const goldReward = 15;
      const [, novoSaldoGold] = await Promise.all([
        saveQuizPointsToDB(effectiveJid, jid),
        changeGold(effectiveJid, goldReward, jid),
        Usuario.findOneAndUpdate(
          { idWhatsApp: effectiveJid },
          { $inc: { 'dailyMissions.progress.quiz5': 1 } }
        ).catch(e => console.error('⚠️ Erro ao atualizar progresso quiz5:', e.message)),
      ]);

      const linhaGold = `💵 *+${goldReward} Prata!* Saldo: *${novoSaldoGold} Prata*`;

      await sock.sendMessage(jid, {
        text:
          `✅ *CORRETO!* Parabéns, *${author}*! 🎉\n\n` +
          `💰 *+10 pontos!* Total: *${pts} pts*\n` +
          linhaGold,
      }, { quoted: msg });

    } else {
      await sock.sendMessage(jid, {
        text: `❌ *ERROU!* *${author}*! Tente novamente no próximo quiz. 😬`,
      }, { quoted: msg });
    }
    return;
  }

  // ── Verificar limite diário ───────────────────────────────────────────────
  const quizCount = await getQuizCountToday(resolvedJidNorm);

  if (quizCount >= DAILY_QUIZ_LIMIT) {
    await sock.sendMessage(jid, {
      text: `⚠️ *${author}*, você atingiu o limite de *${DAILY_QUIZ_LIMIT} quiz por dia*! Volte amanhã! 😴`,
    }, { quoted: msg });
    return;
  }

  // ── Filtrar por categoria ─────────────────────────────────────────────────
  const cmdRaw   = caption.trim().toLowerCase().split(' ')[0];
  const cmdClean = cmdRaw.replace(/^[!.,\/@]+/, '');

  const categoriaMap = {
    quizfut:   q => q.d === 'Futebol',
    quizctec:  q => ['Ciência', 'Química', 'Física', 'Biologia', 'Astronomia', 'Tecnologia'].includes(q.d),
    quizgeo:   q => q.d === 'Geografia',
    quizmat:   q => ['Matemática', 'Geometria', 'Cálculo', 'Estatística'].includes(q.d),
    quizhis:   q => q.d === 'História',
    quizbsq:   q => q.d === 'Basquete',
    quizanime: q => q.d === 'Anime',
  };

  const filtro = categoriaMap[cmdClean];
  const perguntasFiltradas = filtro ? perguntasQuiz.filter(filtro) : perguntasQuiz;

  if (perguntasFiltradas.length === 0) {
    await sock.sendMessage(jid, {
      text: '⚠️ Nenhuma pergunta disponível para essa categoria no momento.',
    }, { quoted: msg });
    return;
  }

  // ── Incrementar contador diário ───────────────────────────────────────────
  await incrementQuizCountToday(resolvedJidNorm, quizCount + 1);

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
  const authorSnapshot  = author;
  const respostaCorreta = q.r;

  const timeout = setTimeout(() => {
    if (quizState.has(senderJid)) {
      quizState.delete(senderJid);
      sock.sendMessage(jid, {
        text: `⏰ *Tempo esgotado*, *${authorSnapshot}*!\n\n✅ Resposta correta: *${respostaCorreta}* 😬`,
      }, { quoted: msg }).catch(() => {});
    }
  }, 30_000);

  // Salva resolvedJidNorm para usar na correção da resposta
  quizState.set(senderJid, { r: q.r, resolvedJid: resolvedJidNorm, timeout });

  const restantes = DAILY_QUIZ_LIMIT - quizCount - 1;

  await sock.sendMessage(jid, {
    text:
      `🧠 *QUIZ — ${q.d.toUpperCase()}*\n\n` +
      `❓ *${q.p}*\n\n` +
      `⏱️ _Você tem 30 segundos!_\n` +
      `📊 _Quiz ${quizCount + 1}/${DAILY_QUIZ_LIMIT} hoje · ${restantes} restante(s)_`,
  }, { quoted: msg });
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

    const linhas = sorted.map((u, i) => {
      const numero = u.idWhatsApp.split('@')[0].split(':')[0];
      const pts    = u.quizPoints || 0;
      const pct    = ((pts / totalPontos) * 100).toFixed(1);
      const filled = Math.min(Math.round((pts / maxPontos) * 10), 10);
      const bar    = '█'.repeat(filled) + '░'.repeat(10 - filled);
      return (
        `${MEDALS[i]} *@${numero}*\n` +
        `   ${bar} ${pts} pts (${pct}%)`
      );
    });

    const mentions = sorted.map(u => u.idWhatsApp);

    await sock.sendMessage(jid, {
      text:
        `🏆 *RANKING DE QUIZ — ESTE GRUPO* 🏆\n\n` +
        `${linhas.join('\n\n')}\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🎯 Total de pontos no grupo: *${totalPontos} pts*\n` +
        `_Use *!quiz* para subir no ranking!_`,
      mentions,
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
  quizState,
  perguntasQuiz,
};