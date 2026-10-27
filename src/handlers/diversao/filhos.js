'use strict';

const path   = require('path');
const Filho  = require(path.join(__dirname, '..', '..', 'models', 'Filho'));
const Usuario= require(path.join(__dirname, '..', '..', 'models', 'Usuario'));
const CarteiraGrupo = require(path.join(__dirname, '..', '..', 'models', 'CarteiraGrupo'));
const { resolverJidCarteira, formatarSaldo, alterarGold } = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));
const { bloqueadoPorVinculo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira', 'vinculo'));

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CHANCE_FILHO       = 0.40;  // 40% de chance
const MAX_FILHOS         = 3;
const DIAS_POR_ANO       = 7;     // 7 dias reais = 1 ano
const COOLDOWN_CUIDAR    = 20 * 60 * 60 * 1000; // 20h
const COOLDOWN_TENTAR = 20 * 60 * 1000; // 20 minutos
const CUSTO_REMEDIO      = 300;   // gold
const RENOMEAR_MAX_LEN   = 20;    // tamanho máximo do nome do filho

const PERSONALIDADES = [
  'curioso 🔍', 'agitado ⚡', 'tímido 🌸', 'corajoso 🦁',
  'preguiçoso 😴', 'esperto 🧠', 'carinhoso 💕', 'teimoso 😤',
];

const NOMES_MENINO = [
  'Miguel', 'Arthur', 'Heitor', 'Davi', 'Gabriel',
  'Pedro', 'Lucas', 'Matheus', 'Rafael', 'Enzo',
  'Bernardo', 'Théo', 'Gael', 'Noah', 'Samuel',
  'Benício', 'Joaquim', 'Anthony', 'Ravi', 'Lorenzo',
  'Vicente', 'Henrique', 'Bryan', 'Daniel', 'Caio',
  'Nicolas', 'Felipe', 'Thiago', 'Eduardo', 'Vinícius',
];

const NOMES_MENINA = [
  'Alice', 'Sofia', 'Isabella', 'Valentina', 'Júlia',
  'Laura', 'Manuela', 'Luiza', 'Heloísa', 'Lívia',
  'Helena', 'Maria Alice', 'Maite', 'Cecília', 'Eloá',
  'Lorena', 'Beatriz', 'Maria Clara', 'Mariana', 'Antonella',
  'Liz', 'Isadora', 'Yasmin', 'Clara', 'Esther',
  'Giovanna', 'Melissa', 'Gabriela', 'Rafaela', 'Letícia',
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function calcularIdade(nascidoEm) {
  const diasVividos = (Date.now() - new Date(nascidoEm).getTime()) / (1000 * 60 * 60 * 24);
  return Math.floor(diasVividos / DIAS_POR_ANO);
}

function statusBar(valor, tamanho = 8) {
  const v = Math.max(0, Math.min(100, valor));
  const preenchido = Math.round((v / 100) * tamanho);
  const vazio = tamanho - preenchido;
  return `[${'█'.repeat(preenchido)}${'░'.repeat(vazio)}] ${v}%`;
}

function formatarTempo(ms) {
  const horas = Math.floor(ms / 3_600_000);
  const min   = Math.floor((ms % 3_600_000) / 60_000);
  const seg   = Math.floor((ms % 60_000) / 1000);
  if (horas > 0) return `${horas}h ${min}min`;
  if (min > 0)   return `${min}min ${seg}s`;
  return `${seg}s`;
}

async function buscarUsuarioComParceiro(userId) {
  const usuario = await Usuario.findOne({ idWhatsApp: userId }).lean();
  if (!usuario?.casadoCom) return null;
  return { usuario, parceiro: usuario.casadoCom };
}

// Filtro para quando AINDA se conhece o parceiro (ex: tentar ter filho)
function filtroFilhos(jid, userId, parceiro) {
  return {
    idGrupo: jid,
    $or: [
      { jidA: userId, jidB: parceiro },
      { jidA: parceiro, jidB: userId },
    ],
  };
}

// Filtro independente de relacionamento ativo: pega todos os filhos
// onde o usuário é um dos pais, dentro do grupo — funciona mesmo
// depois de uma separação, preservando a guarda compartilhada.
function filtroFilhosPorPai(jid, userId) {
  return {
    idGrupo: jid,
    $or: [
      { jidA: userId },
      { jidB: userId },
    ],
  };
}

// Retorna true se jidA e jidB do filho estão atualmente casados/namorando
// um com o outro — ou seja, o casal reconciliou. Nesse caso a guarda
// compartilhada é desativada e qualquer um dos pais pode cuidar.
async function estaoJuntos(filho) {
  if (!filho.jidB) return false; // sem segundo pai cadastrado, nada a checar

  const pais = await Usuario.find(
    { idWhatsApp: { $in: [filho.jidA, filho.jidB] } },
    { idWhatsApp: 1, casadoCom: 1 }
  ).lean();

  const a = pais.find(p => p.idWhatsApp === filho.jidA);
  const b = pais.find(p => p.idWhatsApp === filho.jidB);

  return !!(a?.casadoCom === filho.jidB && b?.casadoCom === filho.jidA);
}

// Troca a guarda do filho 1x por dia, apenas enquanto o casal está separado.
// Se reconciliarem, a guarda fica "livre" (null) e ambos podem cuidar.
async function atualizarGuarda(filho) {
  const juntos = await estaoJuntos(filho);

  if (juntos) {
    // Casal reconciliou: guarda compartilhada desativada
    if (filho.guardaAtual !== null) {
      filho.guardaAtual = null;
      await filho.save();
    }
    return null; // null = guarda livre, qualquer um dos pais cuida
  }

  // Separados: garante que a guarda esteja definida e troca 1x/dia
  if (!filho.guardaAtual) {
    filho.guardaAtual = filho.jidA;
    filho.ultimaTroca = new Date();
    await filho.save();
    return filho.guardaAtual;
  }

  const diasDesdeUltimaTroca = (Date.now() - new Date(filho.ultimaTroca).getTime()) / (1000 * 60 * 60 * 24);
  if (diasDesdeUltimaTroca >= 1) {
    filho.guardaAtual = filho.guardaAtual === filho.jidA ? filho.jidB : filho.jidA;
    filho.ultimaTroca = new Date();
    await filho.save();
  }
  return filho.guardaAtual;
}

// ─── !tentarfilho ─────────────────────────────────────────────────────────────
// Só faz sentido com relacionamento ativo — continua exigindo casadoCom.

async function handleTentarFilho(sock, msg, jid) {
  const userId = msg.key.participant || msg.key.remoteJid;

  try {
    const info = await buscarUsuarioComParceiro(userId);
    if (!info) {
      return sock.sendMessage(jid, {
        text: '❌ Você precisa estar em um relacionamento para ter filhos!',
      }, { quoted: msg });
    }

    const { usuario, parceiro } = info;

    // ── Cooldown de 20 minutos ──
    if (usuario.ultimaTentativaFilho) {
      const restante = COOLDOWN_TENTAR - (Date.now() - new Date(usuario.ultimaTentativaFilho).getTime());
      if (restante > 0) {
        return sock.sendMessage(jid, {
          text: `⏳ Aguarde *${formatarTempo(restante)}* para tentar ter um filho novamente.`,
        }, { quoted: msg });
      }
    }

    // ── Verifica limite de filhos (apenas com o parceiro atual) ──
    const totalFilhos = await Filho.countDocuments(filtroFilhos(jid, userId, parceiro));
    if (totalFilhos >= MAX_FILHOS) {
      return sock.sendMessage(jid, {
        text: `❌ Vocês já têm *${totalFilhos} filhos*! O limite é ${MAX_FILHOS}.`,
      }, { quoted: msg });
    }

    // ── Registra a tentativa (independente do resultado) ──
    await Usuario.updateOne(
      { idWhatsApp: userId },
      { $set: { ultimaTentativaFilho: new Date() } }
    );

    // ── Sorteio ──
    if (Math.random() > CHANCE_FILHO) {
      const tentativas = [
        '😔 Dessa vez não rolou... Tentem novamente em 20 minutos!',
        '🍀 Quase! A sorte não sorriu dessa vez. Não desistam!',
        '💔 Não foi dessa vez. Continuem tentando em 20 minutos!',
      ];
      return sock.sendMessage(jid, {
        text: tentativas[Math.floor(Math.random() * tentativas.length)],
      }, { quoted: msg });
    }

    // ── Nasce o filho ──
    const sexo          = Math.random() < 0.5 ? 'menino' : 'menina';
    const nomes         = sexo === 'menino' ? NOMES_MENINO : NOMES_MENINA;
    const nome          = nomes[Math.floor(Math.random() * nomes.length)];
    const personalidade = PERSONALIDADES[Math.floor(Math.random() * PERSONALIDADES.length)];
    const emoji         = sexo === 'menino' ? '👦' : '👧';

    await Filho.create({
      jidA: userId,
      jidB: parceiro,
      idGrupo: jid,
      nome,
      sexo,
      personalidade,
      felicidade: 100,
      fome:       100,
      sono:       100,
      alegria:    100,
      doente:     false,
      guardaAtual: null,
      ultimaTroca: new Date(),
      nascidoEm:   new Date(),
    });

    return sock.sendMessage(jid, {
      text:
        `🎉 *PARABÉNS! NASCEU UM(A) FILHO(A)!* 🎉\n\n` +
        `${emoji} *${nome}*\n` +
        `🧬 Sexo: *${sexo}*\n` +
        `✨ Personalidade: *${personalidade}*\n` +
        `🎂 Idade: *recém-nascido(a)*\n\n` +
        `😊 Felicidade : ${statusBar(100)}\n` +
        `🍽️ Fome       : ${statusBar(100)}\n` +
        `😴 Sono       : ${statusBar(100)}\n` +
        `🎈 Alegria    : ${statusBar(100)}\n\n` +
        `💡 Use *!cuidarfilho* para cuidar dele(a) diariamente!`,
      mentions: [userId, parceiro],
    }, { quoted: msg });

  } catch (e) {
    console.error('[handleTentarFilho] Erro:', e.message);
    return sock.sendMessage(jid, {
      text: '⚠️ Erro ao tentar ter um filho. Tente novamente.',
    }, { quoted: msg }).catch(() => {});
  }
}

// ─── !filho ───────────────────────────────────────────────────────────────────
// Funciona independente de relacionamento ativo — guarda compartilhada
// só vale enquanto o casal estiver separado.
async function handleVerFilho(sock, msg, jid) {
  const userId = msg.key.participant || msg.key.remoteJid;

  try {
    // .sort() garante que o número exibido aqui seja o MESMO número que
    // !renomearfilho vai usar — sem isso a ordem do MongoDB não é garantida
    // entre consultas diferentes.
    const filhos = await Filho.find(filtroFilhosPorPai(jid, userId)).sort({ nascidoEm: 1 });

    if (filhos.length === 0) {
      return sock.sendMessage(jid, {
        text: '👶 Você ainda não tem filhos! Use *!tentarfilho* (com um relacionamento ativo) para tentar.',
      }, { quoted: msg });
    }

    let texto = `👨‍👩‍👧‍👦 *SEUS FILHOS* (${filhos.length}/${MAX_FILHOS})\n\n`;

    for (let i = 0; i < filhos.length; i++) {
      const filho   = filhos[i];
      const idade   = calcularIdade(filho.nascidoEm);
      const emoji   = filho.sexo === 'menino' ? '👦' : '👧';
      const guarda  = await atualizarGuarda(filho);

      let guardaStr;
      if (guarda === null) {
        guardaStr = 'compartilhada (vocês estão juntos)';
      } else if (guarda === userId) {
        guardaStr = 'com você hoje';
      } else {
        guardaStr = 'com seu ex-parceiro(a) hoje';
      }

      const doente = filho.doente ? '\n⚠️ *DOENTE!* Use *!remediofil* para curar.' : '';

      texto +=
        `*${i + 1}.* ${emoji} *${filho.nome}* — ${idade} ano(s)\n` +
        `✨ ${filho.personalidade}\n` +
        `😊 Felicidade : ${statusBar(filho.felicidade)}\n` +
        `🍽️ Fome       : ${statusBar(filho.fome)}\n` +
        `😴 Sono       : ${statusBar(filho.sono)}\n` +
        `🎈 Alegria    : ${statusBar(filho.alegria)}\n` +
        `🏠 Guarda     : *${guardaStr}*` +
        doente +
        `\n\n`;
    }

    texto += `_Use *!renomearfilho* para dar um novo nome a um deles._`;

    return sock.sendMessage(jid, { text: texto.trim() }, { quoted: msg });
  } catch (e) {
    console.error('[handleVerFilho] Erro:', e.message);
    return sock.sendMessage(jid, { text: '⚠️ Erro ao buscar seus filhos. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !cuidarfilho ─────────────────────────────────────────────────────────────
// Funciona independente de relacionamento ativo. Se o casal está junto,
// guarda é livre (null) e qualquer um dos pais pode cuidar. Se separados,
// só quem está com a guarda no dia pode cuidar.
async function handleCuidarFilho(sock, msg, jid) {
  const userId = msg.key.participant || msg.key.remoteJid;

  try {
    const filhos = await Filho.find(filtroFilhosPorPai(jid, userId)).sort({ nascidoEm: 1 });

    if (filhos.length === 0) {
      return sock.sendMessage(jid, { text: '👶 Você não tem filhos ainda!' }, { quoted: msg });
    }

    const agora = Date.now();
    let texto = `💝 *CUIDANDO DOS FILHOS*\n\n`;
    let algumCuidado = false;
    let algumIndisponivel = false;

    for (const filho of filhos) {
      const guarda = await atualizarGuarda(filho);

      // guarda === null → casal junto, guarda livre, qualquer um cuida.
      // guarda !== null → separados, só quem está com a guarda cuida.
      if (guarda !== null && guarda !== userId) {
        texto += `👶 *${filho.nome}* está com seu ex-parceiro(a) hoje.\n\n`;
        algumIndisponivel = true;
        continue;
      }

      // Cooldown
      if (filho.ultimoCuidado && agora - new Date(filho.ultimoCuidado).getTime() < COOLDOWN_CUIDAR) {
        const restante = COOLDOWN_CUIDAR - (agora - new Date(filho.ultimoCuidado).getTime());
        texto += `👶 *${filho.nome}* — já foi cuidado(a)! Próximo em *${formatarTempo(restante)}*.\n\n`;
        algumIndisponivel = true;
        continue;
      }

      // Cuida
      filho.felicidade = Math.min(100, filho.felicidade + 20);
      filho.fome       = Math.min(100, filho.fome       + 25);
      filho.sono       = Math.min(100, filho.sono       + 20);
      filho.alegria    = Math.min(100, filho.alegria    + 20);
      filho.ultimoCuidado = new Date();
      await filho.save();

      algumCuidado = true;
      const emoji = filho.sexo === 'menino' ? '👦' : '👧';

      texto +=
        `${emoji} *${filho.nome}* foi cuidado(a)!\n` +
        `😊 Felicidade : ${statusBar(filho.felicidade)}\n` +
        `🍽️ Fome       : ${statusBar(filho.fome)}\n` +
        `😴 Sono       : ${statusBar(filho.sono)}\n` +
        `🎈 Alegria    : ${statusBar(filho.alegria)}\n\n`;
    }

    if (!algumCuidado && !algumIndisponivel) {
      texto += 'Nenhum filho disponível para cuidar agora.';
    }

    return sock.sendMessage(jid, { text: texto.trim() }, { quoted: msg });
  } catch (e) {
    console.error('[handleCuidarFilho] Erro:', e.message);
    return sock.sendMessage(jid, { text: '⚠️ Erro ao cuidar dos filhos. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !remediofil ─────────────────────────────────────────────────────────────
// Funciona independente de relacionamento ativo.
async function handleRemedioFilho(sock, msg, jid) {
  const userId = msg.key.participant || msg.key.remoteJid;

  try {
    const filhoDoente = await Filho.findOne({
      ...filtroFilhosPorPai(jid, userId),
      doente: true,
    });

    if (!filhoDoente) {
      return sock.sendMessage(jid, { text: '✅ Nenhum filho doente no momento!' }, { quoted: msg });
    }

    // Conta vinculada ao app: o gold do grupo não vale mais (o saldo vive no app).
    const userIdCarteira = await resolverJidCarteira(userId, jid);
    // Débito atômico — evita corrida com outros comandos de gold
    const carteiraAtualizada = await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp: userIdCarteira, idGrupo: jid, gold: { $gte: CUSTO_REMEDIO } },
      { $inc: { gold: -CUSTO_REMEDIO } },
      { new: true }
    );

    if (!carteiraAtualizada) {
      const carteira = await CarteiraGrupo.findOne({ idWhatsApp: userIdCarteira, idGrupo: jid }).lean();
      return sock.sendMessage(jid, {
        text: `❌ Você precisa de *${formatarSaldo(CUSTO_REMEDIO, carteira)}* para comprar o remédio! Seu saldo é *${formatarSaldo(carteira?.gold ?? 0, carteira)}*.`,
      }, { quoted: msg });
    }

    filhoDoente.doente     = false;
    filhoDoente.felicidade = 60;
    filhoDoente.fome       = 60;
    filhoDoente.sono       = 60;
    filhoDoente.alegria    = 60;

    try {
      await filhoDoente.save();
    } catch (e) {
      // Reverte o débito se não conseguir salvar o filho
      await alterarGold(userIdCarteira, jid, CUSTO_REMEDIO, 'Estorno do remédio para filho');
      throw e;
    }

    const emoji = filhoDoente.sexo === 'menino' ? '👦' : '👧';

    return sock.sendMessage(jid, {
      text:
        `💊 *${filhoDoente.nome}* foi curado(a)!\n\n` +
        `${emoji} Já está se sentindo melhor.\n` +
        `💰 Gasto: *${formatarSaldo(CUSTO_REMEDIO, carteiraAtualizada)}*\n\n` +
        `😊 Felicidade : ${statusBar(60)}\n` +
        `🍽️ Fome       : ${statusBar(60)}\n` +
        `😴 Sono       : ${statusBar(60)}\n` +
        `🎈 Alegria    : ${statusBar(60)}`,
    }, { quoted: msg });
  } catch (e) {
    console.error('[handleRemedioFilho] Erro:', e.message);
    return sock.sendMessage(jid, { text: '⚠️ Erro ao curar o filho. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !renomearfilho ───────────────────────────────────────────────────────────
// Funciona independente de relacionamento ativo e independente de guarda —
// dar nome não é uma ação de cuidado diário, então qualquer um dos pais pode.

async function _aplicarRenome(sock, msg, jid, filho, novoNomeRaw) {
  const novoNome = novoNomeRaw.trim();

  if (!novoNome) {
    return sock.sendMessage(jid, { text: '⚠️ O novo nome não pode ser vazio.' }, { quoted: msg });
  }
  if (novoNome.length > RENOMEAR_MAX_LEN) {
    return sock.sendMessage(jid, {
      text: `⚠️ O nome deve ter no máximo *${RENOMEAR_MAX_LEN} caracteres*.`,
    }, { quoted: msg });
  }
  if (/[\n@]/.test(novoNome)) {
    return sock.sendMessage(jid, {
      text: '⚠️ O nome não pode conter quebra de linha nem "@".',
    }, { quoted: msg });
  }

  const nomeAntigo = filho.nome;
  filho.nome = novoNome;
  await filho.save();

  const emoji = filho.sexo === 'menino' ? '👦' : '👧';
  return sock.sendMessage(jid, {
    text: `✅ ${emoji} *${nomeAntigo}* agora se chama *${novoNome}*!`,
  }, { quoted: msg });
}

async function handleRenomearFilho(sock, msg, jid, args) {
  const userId = msg.key.participant || msg.key.remoteJid;

  try {
    const filhos = await Filho.find(filtroFilhosPorPai(jid, userId)).sort({ nascidoEm: 1 });

    if (filhos.length === 0) {
      return sock.sendMessage(jid, { text: '👶 Você não tem filhos ainda!' }, { quoted: msg });
    }

    const texto = (args || '').trim();

    // ── Um único filho: !renomearfilho <novo nome> ────────────────────────────
    if (filhos.length === 1) {
      if (!texto) {
        return sock.sendMessage(jid, {
          text: `✏️ Use: *!renomearfilho <novo nome>*\nExemplo: *!renomearfilho Enzo*`,
        }, { quoted: msg });
      }
      return _aplicarRenome(sock, msg, jid, filhos[0], texto);
    }

    // ── Vários filhos: !renomearfilho <número> <novo nome> ────────────────────
    const match = texto.match(/^(\d+)\s+(.+)$/);
    if (!match) {
      const lista = filhos.map((f, i) => `  *${i + 1}.* ${f.nome}`).join('\n');
      return sock.sendMessage(jid, {
        text:
          `✏️ Você tem mais de um filho! Use:\n*!renomearfilho <número> <novo nome>*\n\n` +
          `Seus filhos:\n${lista}`,
      }, { quoted: msg });
    }

    const indice    = parseInt(match[1], 10) - 1;
    const filhoAlvo = filhos[indice];

    if (!filhoAlvo) {
      return sock.sendMessage(jid, {
        text: `❌ Número inválido! Use *!filho* para ver a lista numerada de novo.`,
      }, { quoted: msg });
    }

    return _aplicarRenome(sock, msg, jid, filhoAlvo, match[2]);

  } catch (e) {
    console.error('[handleRenomearFilho] Erro:', e.message);
    return sock.sendMessage(jid, { text: '⚠️ Erro ao renomear o filho. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── DECAY DIÁRIO (rodar via scheduler) ──────────────────────────────────────
async function decayFilhos() {
  try {
    const result = await Filho.updateMany({}, [
      {
        $set: {
          felicidade: { $max: [0, { $subtract: ['$felicidade', 10] }] },
          fome:       { $max: [0, { $subtract: ['$fome', 15] }] },
          sono:       { $max: [0, { $subtract: ['$sono', 10] }] },
          alegria:    { $max: [0, { $subtract: ['$alegria', 10] }] },
        },
      },
    ]);

    // Marca como doente quem ficou com felicidade 0
    await Filho.updateMany(
      { felicidade: 0, doente: false },
      { $set: { doente: true } }
    );

    console.log(`[Filhos] Decay aplicado em ${result.modifiedCount} filho(s).`);
  } catch (e) {
    console.error('[Filhos] Erro no decay:', e.message);
  }
}

// ─── SCHEDULER ────────────────────────────────────────────────────────────────
function initFilhosScheduler() {
  // Decay a cada 6 horas
  setInterval(decayFilhos, 6 * 60 * 60 * 1000);
  console.log('[FilhosScheduler] Iniciado.');
}

module.exports = {
  handleTentarFilho,
  handleVerFilho,
  handleCuidarFilho,
  handleRemedioFilho,
  handleRenomearFilho,
  initFilhosScheduler,
};