'use strict';

// ─── Jogos extras: forca, adivinha, velha, contas ─────────────────────────────
// Estado em memória, um jogo por grupo. Expira sozinho (TTL) se ninguém jogar.

const { normalizarJid } = require('../../utils/identity');

const TTL_MS          = 10 * 60 * 1000;
const TTL_PENDENTE_MS = 2 * 60 * 1000;
const TTL_CONTAS_MS   = 30 * 1000;
const TTL_CHARADA_MS  = 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const num      = j => (j || '').split(':')[0].split('@')[0];
const sender   = msg => msg.key.participant || msg.key.remoteJid;
const norm     = j => { try { const r = normalizarJid(j); return typeof r === 'string' && r ? r : j; } catch { return j; } };
const mesmo    = (a, b) => !!a && !!b && num(norm(a)) === num(norm(b));
const limparResp = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]/g, '').replace(/^(a|o|um|uma)\s+/, '').trim();
function encerrar(map, jid) {
  const g = map.get(jid);
  if (g?.timer) clearTimeout(g.timer);
  map.delete(jid);
}
const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const isGrupo  = jid => jid.endsWith('@g.us');
const pref     = (getPrefix, jid) => (typeof getPrefix === 'function' ? getPrefix(jid) : '!');
const argsDe   = caption => caption.trim().split(/\s+/).slice(1).join(' ').trim();
const rand     = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick     = arr => arr[Math.floor(Math.random() * arr.length)];
const dizer    = (pool, ...args) => pick(pool)(...args);

// ─── Banco de frases (uma é sorteada a cada resposta) ─────────────────────────
const F = {
  letraCerta: [
    l => `✅ Boa! Tem a letra *${l}*!`,
    l => `🎯 Acertou! A letra *${l}* está na palavra.`,
    l => `👏 Isso aí! O *${l}* está lá.`,
    l => `🔥 Mandou bem! Tem *${l}*!`,
    l => `✨ Positivo! A letra *${l}* existe.`,
  ],
  letraErrada: [
    l => `❌ Não tem a letra *${l}*.`,
    l => `🙈 Errou! Nada de *${l}* por aqui.`,
    l => `😬 Ih... o *${l}* não está na palavra.`,
    l => `🥶 Frio! A letra *${l}* não existe.`,
    l => `💔 Perdeu uma vida! Sem *${l}*.`,
  ],
  forcaVitoria: [
    (q, p) => `🎉 *@${q}* completou a palavra *${p}*! Vitória do grupo!`,
    (q, p) => `🏆 *@${q}* fechou a palavra: *${p}*! Grupo campeão!`,
    (q, p) => `🥳 É isso! *${p}*! Valeu, *@${q}*!`,
    (q, p) => `👑 *@${q}* deu o golpe final: *${p}*!`,
  ],
  forcaDerrota: [
    p => `💀 Fim de jogo! A palavra era *${p}*.`,
    p => `⚰️ Enforcados! Era *${p}*.`,
    p => `😵 Não deu! A resposta: *${p}*.`,
    p => `🪦 O boneco não resistiu... era *${p}*.`,
  ],
  chuteErrado: [
    c => `❌ *${c}* não é a palavra.`,
    c => `🤔 Quase... mas *${c}* não é.`,
    c => `🙅 Não foi dessa vez: *${c}* não é a palavra.`,
  ],
  adivinhaAcerto: [
    (q, n, t, m) => `🎉 *@${q}* acertou! Era *${n}* (palpite ${t}/${m}).`,
    (q, n, t, m) => `🧠 Cérebro! *@${q}* cravou o *${n}* no palpite ${t}/${m}!`,
    (q, n, t, m) => `🎯 Na mosca, *@${q}*! Era *${n}* (${t}/${m}).`,
    (q, n, t, m) => `🔮 *@${q}* leu minha mente: *${n}*! (${t}/${m})`,
  ],
  adivinhaDerrota: [
    n => `💀 Acabaram os palpites! O número era *${n}*.`,
    n => `😅 Ninguém acertou! Eu pensei no *${n}*.`,
    n => `🤷 Fim dos palpites. Era o *${n}*!`,
  ],
  adivinhaMaior: [
    (n, r) => `⬆️ É *maior* que *${n}*. Restam *${r}* palpites.`,
    (n, r) => `📈 Sobe mais! Maior que *${n}*. Restam *${r}*.`,
    (n, r) => `🔼 Mais alto que *${n}*! Restam *${r}* palpites.`,
  ],
  adivinhaMenor: [
    (n, r) => `⬇️ É *menor* que *${n}*. Restam *${r}* palpites.`,
    (n, r) => `📉 Desce um pouco! Menor que *${n}*. Restam *${r}*.`,
    (n, r) => `🔽 Mais baixo que *${n}*! Restam *${r}* palpites.`,
  ],
  velhaVitoria: [
    (q, t) => `🏆 *@${q}* venceu!\n\n${t}`,
    (q, t) => `👑 Aula de estratégia! *@${q}* ganhou!\n\n${t}`,
    (q, t) => `🎉 Três em linha! *@${q}* levou a partida!\n\n${t}`,
    (q, t) => `😎 Sem chance pro adversário! *@${q}* venceu!\n\n${t}`,
  ],
  velhaEmpate: [
    t => `🤝 *Deu velha!* Empate.\n\n${t}`,
    t => `😐 Ninguém levou essa! Empate.\n\n${t}`,
    t => `⚖️ Partida equilibrada: *empate*!\n\n${t}`,
  ],
  velhaVez: [
    (t, p, s) => `${t}\n\nVez de @${p} ${s}`,
    (t, p, s) => `${t}\n\nSua jogada, @${p} ${s}`,
    (t, p, s) => `${t}\n\n@${p}, pense bem ${s}`,
  ],
  contasTempo: [
    r => `⏰ Tempo esgotado! A resposta era *${r}*.`,
    r => `⌛ Acabou o tempo! Era *${r}*.`,
    r => `😴 Ninguém acertou... a resposta era *${r}*.`,
  ],
  contasAcerto: [
    (q, t, r) => `🎉 *@${q}* acertou! *${t} = ${r}*`,
    (q, t, r) => `⚡ Rápido! *@${q}* resolveu: *${t} = ${r}*`,
    (q, t, r) => `🧮 *@${q}* é uma calculadora! *${t} = ${r}*`,
    (q, t, r) => `🥇 Primeiro lugar pra *@${q}*! *${t} = ${r}*`,
  ],
  charadaTempo: [
    r => `⏰ Tempo esgotado! A resposta era *${r}*.`,
    r => `⌛ Ninguém descobriu... era *${r}*!`,
    r => `🤯 Difícil, né? A resposta: *${r}*.`,
  ],
  charadaAcerto: [
    (q, r) => `🎉 *@${q}* acertou! A resposta era *${r}*.`,
    (q, r) => `🧠 *@${q}* desvendou o mistério: *${r}*!`,
    (q, r) => `🕵️ Boa, detetive *@${q}*! Era *${r}*.`,
    (q, r) => `💡 Sacada genial de *@${q}*: *${r}*!`,
  ],
  termoVitoria: [
    (q, n, m, t) => `🏆 *@${q}* acertou em *${n}/${m}*!\n\n${t}`,
    (q, n, m, t) => `🎯 Termo resolvido por *@${q}* em *${n}/${m}*!\n\n${t}`,
    (q, n, m, t) => `🥳 Palavra descoberta! Valeu, *@${q}* (${n}/${m})!\n\n${t}`,
  ],
  termoDerrota: [
    (p, t) => `💀 Fim de jogo! A palavra era *${p}*.\n\n${t}`,
    (p, t) => `😵 Não foi dessa vez... era *${p}*.\n\n${t}`,
    (p, t) => `🫠 Quase! Mas a palavra era *${p}*.\n\n${t}`,
  ],
  batataPassa: [
    (q, a, n) => `🥔 *@${q}* passou a batata para *@${a}*! (passes: ${n}) 🔥`,
    (q, a, n) => `🔥 Tá quente! *@${q}* jogou a batata em *@${a}*! (passes: ${n})`,
    (q, a, n) => `😱 *@${a}* recebeu a batata de *@${q}*! Corre! (passes: ${n})`,
    (q, a, n) => `🏃 Passa rápido! *@${a}* está com a batata agora! (passes: ${n})`,
  ],
  batataBoom: [
    (q, n) => `💥 *BOOM!* A batata explodiu na mão de *@${q}* depois de *${n}* passes! 🥔🔥`,
    (q, n) => `🧨 Explodiu! *@${q}* ficou com a batata quente (${n} passes)!`,
    (q, n) => `☠️ *@${q}* não passou a tempo! BOOM! (${n} passes) 🥔`,
    (q, n) => `🔥 Ai, ai, ai! A batata queimou *@${q}* depois de ${n} passes!`,
  ],
  dueloTitulo: [
    () => `⚔️ *DUELO DE DADOS*`,
    () => `🎲 *NO ESTALO DOS DADOS*`,
    () => `🥊 *DUELO NA MESA*`,
    () => `🎰 *QUEM TEM MAIS SORTE?*`,
  ],
  dueloVenc: [
    q => `🏆 *@${q}* venceu!`,
    q => `👑 A sorte sorriu pra *@${q}*!`,
    q => `🎉 *@${q}* levou essa!`,
    q => `😎 Sem chance: *@${q}* ganhou!`,
  ],
};

function reply(sock, msg, jid, text, mentions) {
  return sock.sendMessage(jid, { text, ...(mentions ? { mentions } : {}) }, { quoted: msg });
}

function ativo(map, jid) {
  const g = map.get(jid);
  if (!g) return null;
  if (Date.now() > g.expira) { map.delete(jid); return null; }
  return g;
}

async function soGrupo(sock, msg, jid) {
  if (isGrupo(jid)) return true;
  await reply(sock, msg, jid, '⚠️ Este jogo só funciona em grupos.');
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔤 FORCA  —  !forca | !letra x | !chutar palavra | !forca parar
// ═══════════════════════════════════════════════════════════════════════════════

const PALAVRAS = [
  'computador', 'abacaxi', 'elefante', 'janela', 'bicicleta', 'chocolate',
  'montanha', 'guitarra', 'foguete', 'biblioteca', 'tartaruga', 'girassol',
  'sorvete', 'borboleta', 'telefone', 'futebol', 'dinossauro', 'castelo',
  'pirata', 'vulcao', 'planeta', 'cachorro', 'escola', 'oceano', 'floresta',
  'mochila', 'aventura', 'dragao', 'tesouro', 'microfone', 'helicoptero',
  'caminhao', 'musica', 'churrasco', 'campeonato', 'programador',
  'ventilador', 'geladeira', 'paraquedas', 'submarino', 'astronauta',
  'trovao', 'panqueca', 'esmeralda', 'labirinto', 'carnaval',
];
const MAX_ERROS = 6;
const forcaState = new Map();

function forcaTexto(g) {
  const mask  = [...g.palavra].map(c => (g.acertos.has(c) ? c.toUpperCase() : '_')).join(' ');
  const vidas = MAX_ERROS - g.erros.length;
  return (
    '```' + mask + '```\n\n' +
    `Vidas: ${'❤️'.repeat(vidas)}${'🖤'.repeat(g.erros.length)}\n` +
    `Erros: ${g.erros.map(e => e.toUpperCase()).join(', ') || '—'}`
  );
}

async function handleForca(sock, msg, jid, caption, getPrefix) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const P = pref(getPrefix, jid);

  if (argsDe(caption).toLowerCase() === 'parar') {
    const g = ativo(forcaState, jid);
    if (!g) return reply(sock, msg, jid, '⚠️ Não há forca em andamento.');
    forcaState.delete(jid);
    return reply(sock, msg, jid, `🛑 Forca encerrada. A palavra era *${g.palavra.toUpperCase()}*.`);
  }

  const g = ativo(forcaState, jid);
  if (g) {
    return reply(sock, msg, jid,
      `🔤 *FORCA EM ANDAMENTO*\n\n${forcaTexto(g)}\n\n` +
      `▸ ${P}letra _(a)_ — chutar uma letra\n▸ ${P}chutar _(palavra)_ — chutar a palavra`);
  }

  const novo = {
    palavra: PALAVRAS[rand(0, PALAVRAS.length - 1)],
    acertos: new Set(),
    erros: [],
    expira: Date.now() + TTL_MS,
  };
  forcaState.set(jid, novo);

  return reply(sock, msg, jid,
    `🔤 *FORCA* — ${novo.palavra.length} letras\n\n${forcaTexto(novo)}\n\n` +
    `▸ ${P}letra _(a)_ — chutar uma letra\n▸ ${P}chutar _(palavra)_ — chutar a palavra\n` +
    `▸ ${P}forca parar — encerrar`);
}

async function handleLetra(sock, msg, jid, caption) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const g = ativo(forcaState, jid);
  if (!g) return reply(sock, msg, jid, '⚠️ Não há forca em andamento. Use *forca* para começar.');

  const l = semAcento(argsDe(caption));
  if (!/^[a-z]$/.test(l)) return reply(sock, msg, jid, '⚠️ Mande uma única letra. Ex: *letra a*');
  if (g.acertos.has(l) || g.erros.includes(l)) return reply(sock, msg, jid, `⚠️ A letra *${l.toUpperCase()}* já foi tentada.`);

  g.expira = Date.now() + TTL_MS;
  const quem = sender(msg);

  if (g.palavra.includes(l)) {
    g.acertos.add(l);
    if ([...new Set(g.palavra)].every(c => g.acertos.has(c))) {
      forcaState.delete(jid);
      return reply(sock, msg, jid,
        `🎉 *@${num(quem)}* completou a palavra *${g.palavra.toUpperCase()}*! Vitória do grupo!`, [quem]);
    }
    return reply(sock, msg, jid, `✅ Tem a letra *${l.toUpperCase()}*!\n\n${forcaTexto(g)}`);
  }

  g.erros.push(l);
  if (g.erros.length >= MAX_ERROS) {
    forcaState.delete(jid);
    return reply(sock, msg, jid, `💀 Fim de jogo! A palavra era *${g.palavra.toUpperCase()}*.`);
  }
  return reply(sock, msg, jid, `❌ Não tem a letra *${l.toUpperCase()}*.\n\n${forcaTexto(g)}`);
}

async function handleChutar(sock, msg, jid, caption) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const g = ativo(forcaState, jid);
  if (!g) return reply(sock, msg, jid, '⚠️ Não há forca em andamento. Use *forca* para começar.');

  const chute = semAcento(argsDe(caption));
  if (!chute) return reply(sock, msg, jid, '⚠️ Use: *chutar (palavra)*');

  g.expira = Date.now() + TTL_MS;
  const quem = sender(msg);

  if (chute === g.palavra) {
    forcaState.delete(jid);
    return reply(sock, msg, jid, dizer(F.forcaVitoria, num(quem), g.palavra.toUpperCase()), [quem]);
  }

  g.erros.push(`(${chute})`);
  if (g.erros.length >= MAX_ERROS) {
    forcaState.delete(jid);
    return reply(sock, msg, jid, dizer(F.forcaDerrota, g.palavra.toUpperCase()));
  }
  return reply(sock, msg, jid, `${dizer(F.chuteErrado, chute.toUpperCase())}\n\n${forcaTexto(g)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔢 ADIVINHA O NÚMERO  —  !adivinha | !palpite N
// ═══════════════════════════════════════════════════════════════════════════════

const adivinhaState = new Map();
const MAX_PALPITES = 7;

async function handleAdivinha(sock, msg, jid, getPrefix) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const P = pref(getPrefix, jid);

  const g = ativo(adivinhaState, jid);
  if (g) {
    return reply(sock, msg, jid,
      `🔢 Já existe um jogo! Número entre *1 e 100*.\nPalpites restantes: *${MAX_PALPITES - g.tentativas}*\n▸ ${P}palpite _(número)_`);
  }

  adivinhaState.set(jid, { alvo: rand(1, 100), tentativas: 0, expira: Date.now() + TTL_MS });
  return reply(sock, msg, jid,
    `🔢 *ADIVINHA O NÚMERO*\n\nPensei em um número de *1 a 100*.\nO grupo tem *${MAX_PALPITES} palpites*!\n\n▸ ${P}palpite _(número)_`);
}

async function handlePalpite(sock, msg, jid, caption) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const g = ativo(adivinhaState, jid);
  if (!g) return reply(sock, msg, jid, '⚠️ Não há jogo em andamento. Use *adivinha* para começar.');

  const txt = argsDe(caption);
  const n = /^\d{1,3}$/.test(txt) ? parseInt(txt, 10) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 100) return reply(sock, msg, jid, '⚠️ Mande um número de 1 a 100. Ex: *palpite 42*');

  g.tentativas++;
  g.expira = Date.now() + TTL_MS;
  const quem = sender(msg);

  if (n === g.alvo) {
    adivinhaState.delete(jid);
    return reply(sock, msg, jid, dizer(F.adivinhaAcerto, num(quem), g.alvo, g.tentativas, MAX_PALPITES), [quem]);
  }
  if (g.tentativas >= MAX_PALPITES) {
    adivinhaState.delete(jid);
    return reply(sock, msg, jid, dizer(F.adivinhaDerrota, g.alvo));
  }
  const restam = MAX_PALPITES - g.tentativas;
  return reply(sock, msg, jid, dizer(n < g.alvo ? F.adivinhaMaior : F.adivinhaMenor, n, restam));
}

// ═══════════════════════════════════════════════════════════════════════════════
// ⭕ JOGO DA VELHA  —  !velha @fulano | !velha aceitar | !jogar 1-9 | !velha parar
// ═══════════════════════════════════════════════════════════════════════════════

const velhaState = new Map();
const SIMB  = { x: '❌', o: '⭕' };
const NUMS  = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const LINHAS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function tabuleiro(b) {
  const c = i => (b[i] ? SIMB[b[i]] : NUMS[i]);
  return [0, 3, 6].map(r => `${c(r)}${c(r + 1)}${c(r + 2)}`).join('\n');
}
const vencedor = b => LINHAS.some(([a, c, d]) => b[a] && b[a] === b[c] && b[a] === b[d]);

async function handleVelha(sock, msg, content, jid, caption, getPrefix) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const P    = pref(getPrefix, jid);
  const quem = sender(msg);
  const arg  = argsDe(caption).toLowerCase();
  const g    = ativo(velhaState, jid);

  if (arg === 'parar') {
    if (!g) return reply(sock, msg, jid, '⚠️ Não há partida em andamento.');
    if (!mesmo(quem, g.x) && !mesmo(quem, g.o)) return reply(sock, msg, jid, '⚠️ Só os jogadores podem encerrar a partida.');
    velhaState.delete(jid);
    return reply(sock, msg, jid, '🛑 Partida encerrada.');
  }

  if (arg === 'aceitar') {
    if (!g || g.estado !== 'pendente') return reply(sock, msg, jid, '⚠️ Não há desafio pendente.');
    if (!mesmo(quem, g.o)) return reply(sock, msg, jid, '⚠️ Só o desafiado pode aceitar.');
    g.estado = 'jogando';
    g.expira = Date.now() + TTL_MS;
    return reply(sock, msg, jid,
      `⭕ *JOGO DA VELHA*\n\n${tabuleiro(g.board)}\n\n` +
      `${SIMB.x} @${num(g.x)}  vs  ${SIMB.o} @${num(g.o)}\n` +
      `Vez de @${num(g.x)} ▸ ${P}jogar _(1-9)_`, [g.x, g.o]);
  }

  if (g) return reply(sock, msg, jid, `⚠️ Já existe uma partida neste grupo. Use *${P}velha parar* para encerrar.`);

  const ctx  = content?.extendedTextMessage?.contextInfo;
  const alvo = ctx?.mentionedJid?.[0] || ctx?.participant;
  if (!alvo) return reply(sock, msg, jid, `⚠️ Use: *${P}velha @fulano* (ou responda a mensagem dele)`);
  if (mesmo(alvo, quem)) return reply(sock, msg, jid, '⚠️ Você não pode jogar contra você mesmo.');

  velhaState.set(jid, {
    estado: 'pendente', x: quem, o: alvo,
    board: Array(9).fill(null), vez: 'x', expira: Date.now() + TTL_PENDENTE_MS,
  });
  return reply(sock, msg, jid,
    `⭕ @${num(alvo)}, *@${num(quem)}* te desafiou para o jogo da velha!\n▸ ${P}velha aceitar`, [quem, alvo]);
}

async function handleJogar(sock, msg, jid, caption) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const g = ativo(velhaState, jid);
  if (!g || g.estado !== 'jogando') return reply(sock, msg, jid, '⚠️ Não há partida em andamento.');

  const quem = sender(msg);
  const jogadorDaVez = g.vez === 'x' ? g.x : g.o;
  if (!mesmo(quem, g.x) && !mesmo(quem, g.o)) return reply(sock, msg, jid, '⚠️ Você não está nessa partida.');
  if (!mesmo(quem, jogadorDaVez)) return reply(sock, msg, jid, '⏳ Não é a sua vez.');

  const txtPos = argsDe(caption);
  const pos = /^\d$/.test(txtPos) ? parseInt(txtPos, 10) : NaN;
  if (!Number.isInteger(pos) || pos < 1 || pos > 9) return reply(sock, msg, jid, '⚠️ Escolha uma casa de 1 a 9. Ex: *jogar 5*');
  if (g.board[pos - 1]) return reply(sock, msg, jid, '⚠️ Essa casa já está ocupada.');

  g.board[pos - 1] = g.vez;
  g.expira = Date.now() + TTL_MS;

  if (vencedor(g.board)) {
    velhaState.delete(jid);
    return reply(sock, msg, jid, dizer(F.velhaVitoria, num(quem), tabuleiro(g.board)), [quem]);
  }
  if (g.board.every(Boolean)) {
    velhaState.delete(jid);
    return reply(sock, msg, jid, dizer(F.velhaEmpate, tabuleiro(g.board)));
  }

  g.vez = g.vez === 'x' ? 'o' : 'x';
  const prox = g.vez === 'x' ? g.x : g.o;
  return reply(sock, msg, jid, dizer(F.velhaVez, tabuleiro(g.board), num(prox), SIMB[g.vez]), [prox]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ➕ CONTAS RÁPIDAS  —  !contas | !resp N
// ═══════════════════════════════════════════════════════════════════════════════

const contasState = new Map();

function gerarConta() {
  const nivel = rand(1, 3);
  if (nivel === 1) { const a = rand(10, 99), b = rand(10, 99); return { texto: `${a} + ${b}`, resposta: a + b }; }
  if (nivel === 2) { const a = rand(2, 12),  b = rand(2, 15);  return { texto: `${a} × ${b}`, resposta: a * b }; }
  const a = rand(2, 9), b = rand(2, 9), c = rand(1, 50);
  return { texto: `${a} × ${b} + ${c}`, resposta: a * b + c };
}

async function handleContas(sock, msg, jid, getPrefix) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const P = pref(getPrefix, jid);

  if (ativo(contasState, jid)) return reply(sock, msg, jid, `⚠️ Já existe uma conta valendo! Responda com ${P}resp _(número)_`);

  const estado = { ...gerarConta(), expira: Date.now() + TTL_CONTAS_MS, timer: null };
  contasState.set(jid, estado);
  estado.timer = setTimeout(async () => {
    if (contasState.get(jid) !== estado) return;
    contasState.delete(jid);
    await sock.sendMessage(jid, { text: dizer(F.contasTempo, estado.resposta) }).catch(() => {});
  }, TTL_CONTAS_MS);
  estado.timer.unref?.();

  return reply(sock, msg, jid,
    `➕ *CONTA RÁPIDA* ⏱️ 30s\n\nQuanto é *${estado.texto}* ?\n\n▸ ${P}resp _(número)_ — o primeiro a acertar ganha!`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🧩 CHARADA  —  !charada | !resp texto
// ═══════════════════════════════════════════════════════════════════════════════

const charadaState = new Map();
const CHARADAS = [
  { p: 'O que é, o que é? Quanto mais se tira, maior fica.',                    r: ['buraco'] },
  { p: 'O que é, o que é? Cai em pé e corre deitada.',                           r: ['chuva'] },
  { p: 'O que é, o que é? Quanto mais seca, mais molhada fica.',                 r: ['toalha'] },
  { p: 'O que é, o que é? Tem dentes, mas não morde.',                           r: ['pente', 'alho'] },
  { p: 'O que é, o que é? Está sempre à sua frente, mas você não pode ver.',     r: ['futuro'] },
  { p: 'O que é, o que é? Quanto maior, menos se vê.',                           r: ['escuridao', 'escuro'] },
  { p: 'O que é, o que é? Tem coroa, mas não é rei; tem escamas, mas não é peixe.', r: ['abacaxi'] },
  { p: 'O que é, o que é? Desaparece quando falamos o nome dele.',               r: ['silencio'] },
  { p: 'O que é, o que é? Se quebra sem nunca ser tocado.',                      r: ['promessa'] },
  { p: 'O que é, o que é? Nasce grande e morre pequeno.',                        r: ['lapis'] },
  { p: 'O que é, o que é? Tem cabeça e tem dente, mas não é gente.',             r: ['alho'] },
  { p: 'O que é, o que é? Anda com os pés na cabeça.',                           r: ['piolho'] },
  { p: 'O que é, o que é? Anda sem ter pernas e chora sem ter olhos.',           r: ['nuvem'] },
  { p: 'O que é, o que é? Tem pescoço, mas não tem cabeça.',                     r: ['garrafa'] },
  { p: 'O que é, o que é? Sobe quando a chuva desce.',                           r: ['guardachuva', 'guarda chuva'] },
  { p: 'O que é, o que é? Quanto mais quente, mais fresco é.',                   r: ['pao'] },
];

async function handleCharada(sock, msg, jid, getPrefix) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const P = pref(getPrefix, jid);

  const atual = ativo(charadaState, jid);
  if (atual) return reply(sock, msg, jid, `🧩 Já existe uma charada valendo:\n\n${atual.pergunta}\n\n▸ ${P}resp _(resposta)_`);

  const c = CHARADAS[rand(0, CHARADAS.length - 1)];
  const estado = { pergunta: c.p, respostas: c.r, expira: Date.now() + TTL_CHARADA_MS, timer: null };
  charadaState.set(jid, estado);
  estado.timer = setTimeout(async () => {
    if (charadaState.get(jid) !== estado) return;
    charadaState.delete(jid);
    await sock.sendMessage(jid, { text: dizer(F.charadaTempo, estado.respostas[0]) }).catch(() => {});
  }, TTL_CHARADA_MS);
  estado.timer.unref?.();

  return reply(sock, msg, jid, `🧩 *CHARADA* ⏱️ 60s\n\n${c.p}\n\n▸ ${P}resp _(resposta)_ — o primeiro a acertar ganha!`);
}

// resp atende contas e charada
async function handleResp(sock, msg, jid, caption) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const conta   = ativo(contasState, jid);
  const charada = ativo(charadaState, jid);
  if (!conta && !charada) return reply(sock, msg, jid, '⚠️ Não há conta nem charada em andamento. Use *contas* ou *charada*.');

  const txt = argsDe(caption);
  if (!txt) return reply(sock, msg, jid, '⚠️ Mande sua resposta. Ex: *resp 42*');
  const quem = sender(msg);

  if (conta && /^-?\d+$/.test(txt) && parseInt(txt, 10) === conta.resposta) {
    encerrar(contasState, jid);
    return reply(sock, msg, jid, dizer(F.contasAcerto, num(quem), conta.texto, conta.resposta), [quem]);
  }
  if (charada && charada.respostas.includes(limparResp(txt))) {
    encerrar(charadaState, jid);
    return reply(sock, msg, jid, dizer(F.charadaAcerto, num(quem), charada.respostas[0]), [quem]);
  }
  // errou: silêncio, para não poluir o grupo
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🟩 TERMO  —  !termo | !tentar palavra | !termo parar
// ═══════════════════════════════════════════════════════════════════════════════

const termoState = new Map();
const TERMO_MAX = 6;
const PALAVRAS_TERMO = [
  'livro', 'tempo', 'mundo', 'amigo', 'festa', 'praia', 'carro', 'banco', 'campo', 'dente',
  'verde', 'noite', 'terra', 'ponte', 'pedra', 'nuvem', 'sorte', 'moeda', 'sonho', 'bravo',
  'calor', 'risco', 'gente', 'carta', 'prato', 'vinho', 'samba', 'navio', 'trigo', 'jogar',
  'falar', 'andar', 'comer', 'beber', 'cinco', 'ontem', 'mesmo', 'placa', 'tinta', 'fruta',
  'folha', 'peixe', 'cobra', 'tigre', 'zebra', 'ideia', 'turma', 'grupo', 'conta', 'texto',
  'ponto', 'forte', 'longe', 'claro', 'perto',
  'areia', 'barco', 'cesta', 'disco', 'flora', 'garfo', 'homem', 'leite', 'lugar', 'manha',
  'nobre', 'oasis', 'pilha', 'queda', 'rosto', 'saude', 'tarde', 'unido', 'vento',
];

function avaliarTermo(palpite, alvo) {
  const res = Array(5).fill('⬜');
  const resto = {};
  for (let i = 0; i < 5; i++) {
    if (palpite[i] === alvo[i]) res[i] = '🟩';
    else resto[alvo[i]] = (resto[alvo[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] === '🟩') continue;
    if (resto[palpite[i]] > 0) { res[i] = '🟨'; resto[palpite[i]]--; }
  }
  return res.join('');
}

function termoTexto(g) {
  const linhas = g.tentativas.map(t => `${t.res}  ${t.palavra.toUpperCase()}`);
  return `${linhas.join('\n') || '_nenhuma tentativa ainda_'}\n\nTentativas: *${g.tentativas.length}/${TERMO_MAX}*`;
}

async function handleTermo(sock, msg, jid, caption, getPrefix) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const P = pref(getPrefix, jid);

  if (argsDe(caption).toLowerCase() === 'parar') {
    const g = ativo(termoState, jid);
    if (!g) return reply(sock, msg, jid, '⚠️ Não há termo em andamento.');
    termoState.delete(jid);
    return reply(sock, msg, jid, `🛑 Termo encerrado. A palavra era *${g.palavra.toUpperCase()}*.`);
  }

  const atual = ativo(termoState, jid);
  if (atual) return reply(sock, msg, jid, `🟩 *TERMO EM ANDAMENTO*\n\n${termoTexto(atual)}\n\n▸ ${P}tentar _(palavra)_`);

  termoState.set(jid, {
    palavra: PALAVRAS_TERMO[rand(0, PALAVRAS_TERMO.length - 1)],
    tentativas: [],
    expira: Date.now() + TTL_MS,
  });
  return reply(sock, msg, jid,
    `🟩 *TERMO* — descubra a palavra de *5 letras*!\n\n` +
    `🟩 letra certa no lugar\n🟨 letra existe em outro lugar\n⬜ letra não existe\n\n` +
    `O grupo tem *${TERMO_MAX} tentativas*.\n▸ ${P}tentar _(palavra)_\n▸ ${P}termo parar — encerrar`);
}

async function handleTentar(sock, msg, jid, caption) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const g = ativo(termoState, jid);
  if (!g) return reply(sock, msg, jid, '⚠️ Não há termo em andamento. Use *termo* para começar.');

  const p = semAcento(argsDe(caption));
  if (!/^[a-z]{5}$/.test(p)) return reply(sock, msg, jid, '⚠️ Mande uma palavra de 5 letras. Ex: *tentar livro*');
  if (g.tentativas.some(t => t.palavra === p)) return reply(sock, msg, jid, `⚠️ *${p.toUpperCase()}* já foi tentada.`);

  g.expira = Date.now() + TTL_MS;
  g.tentativas.push({ palavra: p, res: avaliarTermo(p, g.palavra) });
  const quem = sender(msg);

  if (p === g.palavra) {
    termoState.delete(jid);
    return reply(sock, msg, jid, dizer(F.termoVitoria, num(quem), g.tentativas.length, TERMO_MAX, termoTexto(g)), [quem]);
  }
  if (g.tentativas.length >= TERMO_MAX) {
    termoState.delete(jid);
    return reply(sock, msg, jid, dizer(F.termoDerrota, g.palavra.toUpperCase(), termoTexto(g)));
  }
  return reply(sock, msg, jid, termoTexto(g));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🥔 BATATA QUENTE  —  !batata | !passar @fulano | !batata parar
// ═══════════════════════════════════════════════════════════════════════════════

const batataState = new Map();

async function handleBatata(sock, msg, jid, caption, getPrefix) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const P    = pref(getPrefix, jid);
  const quem = sender(msg);
  const g    = batataState.get(jid);

  if (argsDe(caption).toLowerCase() === 'parar') {
    if (!g) return reply(sock, msg, jid, '⚠️ Não há batata em andamento.');
    if (!mesmo(quem, g.holder)) return reply(sock, msg, jid, '⚠️ Só quem está com a batata pode encerrar.');
    encerrar(batataState, jid);
    return reply(sock, msg, jid, '🛑 Batata jogada fora. Fim de jogo.');
  }

  if (g) return reply(sock, msg, jid, `🥔 A batata já está com *@${num(g.holder)}*! Use ${P}passar @fulano`, [g.holder]);

  const novo = { holder: quem, passes: 0, timer: null };
  novo.timer = setTimeout(async () => {
    if (batataState.get(jid) !== novo) return;
    batataState.delete(jid);
    await sock.sendMessage(jid, {
      text: dizer(F.batataBoom, num(novo.holder), novo.passes),
      mentions: [novo.holder],
    }).catch(() => {});
  }, rand(25, 50) * 1000);
  novo.timer.unref?.();
  batataState.set(jid, novo);

  return reply(sock, msg, jid,
    `🥔 *BATATA QUENTE!*\n\n*@${num(quem)}* está com a batata e ela vai explodir a qualquer momento!\n` +
    `▸ ${P}passar @fulano — passe para alguém (ou responda a mensagem dele)`, [quem]);
}

async function handlePassar(sock, msg, content, jid) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const g = batataState.get(jid);
  if (!g) return reply(sock, msg, jid, '⚠️ Não há batata em andamento. Use *batata* para começar.');

  const quem = sender(msg);
  if (!mesmo(quem, g.holder)) return reply(sock, msg, jid, `⚠️ Você não está com a batata. Ela está com @${num(g.holder)}.`, [g.holder]);

  const ctx  = content?.extendedTextMessage?.contextInfo;
  const alvo = ctx?.mentionedJid?.[0] || ctx?.participant;
  if (!alvo) return reply(sock, msg, jid, '⚠️ Marque alguém ou responda a mensagem dele. Ex: *passar @fulano*');
  if (mesmo(alvo, quem)) return reply(sock, msg, jid, '⚠️ Você não pode passar a batata para você mesmo!');

  g.holder = alvo;
  g.passes++;
  return reply(sock, msg, jid, dizer(F.batataPassa, num(quem), num(alvo), g.passes), [quem, alvo]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎲 DUELO DE DADOS  —  !duelo @fulano
// ═══════════════════════════════════════════════════════════════════════════════

async function handleDuelo(sock, msg, content, jid) {
  if (!(await soGrupo(sock, msg, jid))) return;
  const quem = sender(msg);
  const ctx  = content?.extendedTextMessage?.contextInfo;
  const alvo = ctx?.mentionedJid?.[0] || ctx?.participant;

  if (!alvo) return reply(sock, msg, jid, '⚠️ Use: *duelo @fulano*');
  if (mesmo(alvo, quem)) return reply(sock, msg, jid, '⚠️ Você não pode duelar contra você mesmo.');

  let a, b;
  do { a = rand(1, 100); b = rand(1, 100); } while (a === b);
  const venc = a > b ? quem : alvo;

  return reply(sock, msg, jid,
    `${dizer(F.dueloTitulo)}\n\n🎲 @${num(quem)}: *${a}*\n🎲 @${num(alvo)}: *${b}*\n\n${dizer(F.dueloVenc, num(venc))}`, [quem, alvo]);
}

// ─── Limpeza periódica (partidas abandonadas) ─────────────────────────────────
const MAPAS_COM_TTL = [forcaState, adivinhaState, velhaState, contasState, charadaState, termoState];
setInterval(() => {
  const agora = Date.now();
  for (const mapa of MAPAS_COM_TTL) {
    for (const [jid, g] of mapa) {
      if (agora > g.expira) {
        if (g.timer) clearTimeout(g.timer);
        mapa.delete(jid);
      }
    }
  }
}, 60 * 1000).unref();

module.exports = {
  handleForca, handleLetra, handleChutar,
  handleAdivinha, handlePalpite,
  handleVelha, handleJogar,
  handleContas, handleResp,
  handleCharada,
  handleTermo, handleTentar,
  handleBatata, handlePassar,
  handleDuelo,
};