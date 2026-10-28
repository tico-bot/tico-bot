'use strict';

// Nome do arquivo: medievalUtils.js
// Localização: src/utils/medievalUtils.js
// Tabelas de Dados, Helpers do Banco e Fórmulas do Modo Medieval

const MedievalPersonagem = require('../models/MedievalPersonagem');
const GrupoConfig        = require('../models/GrupoConfig');
const { contaVinculada, bloqueadoPorVinculo } = require('./carteira/vinculo');

const JANELA_SAQUE_MS = 3 * 60 * 1000; // 3 minutos

// ── Helpers do Banco de Dados e Estado ────────────────────────────────────────

function somenteGrupo(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

async function getModoAtivo(idGrupo) {
  const cfg = await GrupoConfig.findOne({ idGrupo }).lean();
  return cfg?.medievalAtivo === true;
}

function sanitizarNome(nome, fallback) {
  const limpo = (nome || '')
    .replace(/[*_~`]/g, '')
    .trim()
    .slice(0, 30);
  return limpo || fallback;
}

function normalizarItemKey(nomeItem) {
  return (nomeItem || '').trim().replace(/ /g, '_');
}

function itemKeyParaNome(chaveItem) {
  return (chaveItem || '').replace(/_/g, ' ');
}

function getInventarioMap(personagem) {
  if (!personagem || !personagem.inventarioMedieval) return new Map();
  if (personagem.inventarioMedieval instanceof Map) {
    return personagem.inventarioMedieval;
  }
  return new Map(Object.entries(personagem.inventarioMedieval || {}));
}

function nomeFallbackDoJid(idWhatsApp) {
  return String(idWhatsApp || '').split('@')[0].split(':')[0].replace(/\D/g, '') || 'Usuário';
}

async function getOuCriarPersonagem(idWhatsApp, idGrupo, nome) {
  const nomeLimpo = sanitizarNome(nome, nomeFallbackDoJid(idWhatsApp));
  const existente = await MedievalPersonagem.findOne({ idWhatsApp, idGrupo });
  if (existente) {
    // Personagens antigos podiam guardar apenas o número, porque eram criados
    // quando o alvo era mencionado. Atualiza o nome assim que o WhatsApp
    // fornecer um nome de exibição válido numa interação posterior.
    const nomeAtual = String(existente.nome || '').trim();
    const pareceNumero = /^[+\d\s().-]+$/.test(nomeAtual);
    const nomeRecebidoEhUtil = nomeLimpo && !/^[+\d\s().-]+$/.test(nomeLimpo);
    if (nomeRecebidoEhUtil && pareceNumero) {
      existente.nome = nomeLimpo;
      await existente.save();
    }
    return existente;
  }

  const classe   = sortearAleatorio(CLASSES);
  const elemento = sortearAleatorio(ELEMENTOS);

  if (!classe || !elemento) {
    throw new Error('Falha ao sortear classe/elemento medieval.');
  }

  try {
    return await MedievalPersonagem.create({
      idWhatsApp,
      idGrupo,
      nome:     nomeLimpo,
      classe:   classe.nome,
      elemento: elemento.nome,
      nivel:    1,
      xpMedieval: 0,
      hp:       classe.hp,
      hpMax:    classe.hp,
      mana:     classe.mana,
      manaMax:  classe.mana,
      ataque:   classe.ataque,
      defesa:   classe.defesa,
      vitorias: 0,
      derrotas: 0,
    });
  } catch (err) {
    if (err.code === 11000) {
      return await MedievalPersonagem.findOne({ idWhatsApp, idGrupo });
    }
    throw err;
  }
}

function gerarBarra(atual, maximo, emoji = '❤️', tamanho = 8) {
  if (!maximo || maximo <= 0) return '░'.repeat(tamanho);
  const filled = Math.max(0, Math.min(Math.round((atual / maximo) * tamanho), tamanho));
  return emoji.repeat(filled) + '░'.repeat(tamanho - filled);
}

async function verificarRecuperacaoDerrota(p) {
  if (!p?.derrotadoEm) return p;

  const passouMs = Date.now() - new Date(p.derrotadoEm).getTime();
  if (passouMs < JANELA_SAQUE_MS) return p;

  if (p.hp > 0) {
    await MedievalPersonagem.updateOne(
      { _id: p._id },
      { $unset: { derrotadoEm: '', derrotadoPor: '' } }
    );
  } else {
    const hpMinimo = Math.max(1, Math.floor(p.hpMax * 0.3));
    await MedievalPersonagem.updateOne(
      { _id: p._id },
      { $set: { hp: hpMinimo }, $unset: { derrotadoEm: '', derrotadoPor: '' } }
    );
    p.hp = hpMinimo;
  }
  p.derrotadoEm  = undefined;
  p.derrotadoPor = undefined;
  return p;
}

async function verificarLevelUp(sock, jid, senderJid, pAtual = null) {
  let p = pAtual ?? await MedievalPersonagem.findOne({ idWhatsApp: senderJid, idGrupo: jid }).lean();
  if (!p) return;

  const nivelInicial = p.nivel;
  let totalHp = 0, totalMana = 0, totalAtaque = 0, totalDefesa = 0;

  while (p.xpMedieval >= xpParaNivel(p.nivel + 1)) {
    const novoNivel   = p.nivel + 1;
    const hpBonus     = 15;
    const manaBonus   = 10;
    const ataqueBonus = 2;
    const defesaBonus = 1;

    const novoHpMax   = p.hpMax   + hpBonus;
    const novoManaMax = p.manaMax + manaBonus;

    await MedievalPersonagem.updateOne(
      { idWhatsApp: senderJid, idGrupo: jid },
      {
        $set: {
          nivel:   novoNivel,
          hpMax:   novoHpMax,
          manaMax: novoManaMax,
          hp:      Math.min(p.hp   + hpBonus,  novoHpMax),
          mana:    Math.min(p.mana + manaBonus, novoManaMax),
        },
        $inc: {
          ataque: ataqueBonus,
          defesa: defesaBonus,
        },
      }
    );

    p.nivel  += 1;
    p.hpMax  += hpBonus;
    p.hp     += hpBonus;
    p.manaMax += manaBonus;
    p.mana   += manaBonus;
    p.ataque += ataqueBonus;
    p.defesa += defesaBonus;

    totalHp     += hpBonus;
    totalMana   += manaBonus;
    totalAtaque += ataqueBonus;
    totalDefesa += defesaBonus;
  }

  if (p.nivel === nivelInicial) return;

  const textoNivel = (p.nivel - nivelInicial) > 1
    ? `dos Níveis *${nivelInicial}* → *${p.nivel}*`
    : `para o *Nível ${p.nivel}*`;

  await sock.sendMessage(jid, {
    text:
      `⭐🎉 *LEVEL UP!* 🎉⭐\n\n` +
      `*${p.nome}* subiu ${textoNivel}!\n\n` +
      `📈 *Melhorias totais:*\n` +
      `❤️ +${totalHp} HP Máximo\n` +
      `💧 +${totalMana} Mana Máxima\n` +
      `⚔️ +${totalAtaque} Ataque\n` +
      `🛡️ +${totalDefesa} Defesa\n\n` +
      `_Continue batalhando para ficar mais forte!_`,
    mentions: [senderJid],
  });
}

// ── Classes ──────────────────────────────────────────────────────────────────
const CLASSES = [
  {
    nome: 'Guerreiro',
    emoji: '⚔️',
    descricao: 'Mestre do combate corpo a corpo',
    ataque: 14, defesa: 10, hp: 130, mana: 50,
    armasPermitidas: ['Espada', 'Machado', 'Lança', 'Lança Simples', 'Espada Longa', 'Martelo Sagrado', 'Machado de Guerra', 'Espada Rúnica', 'Machado Sombrio', 'Espada dos Titãs', 'Espada Celestial', 'Lâmina do Vazio'],
  },
  {
    nome: 'Mago',
    emoji: '🧙',
    descricao: 'Conjurador de feitiços poderosos',
    ataque: 18, defesa: 4, hp: 80, mana: 120,
    armasPermitidas: ['Cajado', 'Cajado de Madeira', 'Cetro Enferrujado', 'Cajado de Cristal', 'Cajado das Eras', 'Cetro do Apocalipse'],
  },
  {
    nome: 'Arqueiro',
    emoji: '🏹',
    descricao: 'Preciso e veloz à distância',
    ataque: 13, defesa: 7, hp: 100, mana: 70,
    armasPermitidas: ['Arco', 'Arco Simples', 'Adaga', 'Faca de Caça', 'Arco Élfico', 'Arco da Tempestade', 'Arco do Julgamento'],
  },
  {
    nome: 'Paladino',
    emoji: '🛡️',
    descricao: 'Guerreiro sagrado com poderes divinos',
    ataque: 12, defesa: 14, hp: 120, mana: 80,
    armasPermitidas: ['Espada', 'Lança', 'Lança Simples', 'Bordão Sagrado', 'Martelo Sagrado', 'Espada do Amanhecer', 'Lança Sagrada', 'Espada dos Titãs', 'Espada Celestial'],
  },
  {
    nome: 'Assassino',
    emoji: '🗡️',
    descricao: 'Letal nas sombras, rápido como a morte',
    ataque: 17, defesa: 5, hp: 90, mana: 75,
    armasPermitidas: ['Adaga', 'Faca de Caça', 'Adaga Envenenada', 'Faca Gêmea', 'Adaga da Sombra', 'Adaga do Caos', 'Punhal Eterno'],
  },
  {
    nome: 'Druida',
    emoji: '🌿',
    descricao: 'Em harmonia com a natureza e seus mistérios',
    ataque: 11, defesa: 8, hp: 100, mana: 110,
    armasPermitidas: ['Cajado', 'Cajado de Madeira', 'Arco', 'Arco Simples', 'Ramo Druídico', 'Cajado da Floresta', 'Arco Élfico', 'Arco da Tempestade', 'Cetro da Natureza', 'Cajado Ancestral', 'Arco do Julgamento'],
  },
  {
    nome: 'Bárbaro', emoji: '🪓', descricao: 'Guerreiro brutal que troca técnica por força devastadora',
    ataque: 19, defesa: 7, hp: 145, mana: 35,
    armasPermitidas: ['Machado', 'Machado de Guerra', 'Machado Sombrio', 'Machado do Colosso', 'Martelo de Guerra', 'Espada', 'Espada Longa'],
  },
  {
    nome: 'Berserker', emoji: '🔥', descricao: 'Lutador implacável que avança sem temer ferimentos',
    ataque: 21, defesa: 4, hp: 115, mana: 40,
    armasPermitidas: ['Machado', 'Machado de Guerra', 'Machado do Colosso', 'Lâminas Gêmeas', 'Espada Longa', 'Espada do Dragão'],
  },
  {
    nome: 'Monge', emoji: '🥋', descricao: 'Combatente disciplinado que une agilidade e energia interior',
    ataque: 14, defesa: 11, hp: 110, mana: 85,
    armasPermitidas: ['Bastão de Bambu', 'Bordão Sagrado', 'Cajado', 'Manoplas do Dragão', 'Cajado de Madeira'],
  },
  {
    nome: 'Bardo', emoji: '🎻', descricao: 'Artista místico que inspira aliados e confunde adversários',
    ataque: 12, defesa: 7, hp: 95, mana: 125,
    armasPermitidas: ['Alaúde Encantado', 'Cajado de Madeira', 'Cajado', 'Cetro Enferrujado', 'Faca de Caça'],
  },
  {
    nome: 'Engenheiro Arcano', emoji: '⚙️', descricao: 'Inventor que combina engenhocas, runas e magia',
    ataque: 15, defesa: 9, hp: 105, mana: 100,
    armasPermitidas: ['Besta Mecânica', 'Martelo de Guerra', 'Cajado de Cristal', 'Cajado', 'Lança Simples', 'Besta Rúnica'],
  },
  {
    nome: 'Necromante',
    emoji: '💀',
    descricao: 'Domina a magia negra e os mortos',
    ataque: 20, defesa: 3, hp: 75, mana: 130,
    armasPermitidas: ['Cajado', 'Cajado de Madeira', 'Cetro Enferrujado', 'Grimório Sombrio', 'Cajado dos Mortos', 'Grimório das Trevas', 'Cetro do Apocalipse'],
  },
];

// ── Elementos ────────────────────────────────────────────────────────────────
const ELEMENTOS = [
  {
    nome: 'Fogo',
    emoji: '🔥',
    habilidadeUltima: 'Meteoro Infernal',
    descHabilidade: 'Chove pedras de fogo incandescentes sobre o inimigo, carbonizando tudo ao redor',
    danoBonusContra: ['Terra', 'Ar'],
    fraquezaContra:  ['Água'],
    corNarrativa: 'chamas ardentes',
  },
  {
    nome: 'Água',
    emoji: '💧',
    habilidadeUltima: 'Tsunami Eterno',
    descHabilidade: 'Uma onda colossal engole o inimigo arrastando-o para as profundezas',
    danoBonusContra: ['Fogo', 'Terra'],
    fraquezaContra:  ['Trovão'],
    corNarrativa: 'correntes geladas',
  },
  {
    nome: 'Terra',
    emoji: '🌍',
    habilidadeUltima: 'Terremoto Ancestral',
    descHabilidade: 'O chão racha em fissuras imensas engolindo o adversário nas entranhas da terra',
    danoBonusContra: ['Trovão', 'Sombra'],
    fraquezaContra:  ['Fogo', 'Água'],
    corNarrativa: 'pilares de pedra',
  },
  {
    nome: 'Ar',
    emoji: '🌪️',
    habilidadeUltima: 'Tornado Caótico',
    descHabilidade: 'Um tornado devastador lança o inimigo aos céus antes de despedaçá-lo no chão',
    danoBonusContra: ['Sombra', 'Luz'],
    fraquezaContra:  ['Terra'],
    corNarrativa: 'vendavais cortantes',
  },
  {
    nome: 'Trovão',
    emoji: '⚡',
    habilidadeUltima: 'Relâmpago Divino',
    descHabilidade: 'Um raio desce dos céus com força divina paralisando o inimigo em convulsões',
    danoBonusContra: ['Água', 'Ar'],
    fraquezaContra:  ['Terra'],
    corNarrativa: 'raios furiosos',
  },
  {
    nome: 'Sombra',
    emoji: '🌑',
    habilidadeUltima: 'Vazio Absoluto',
    descHabilidade: 'A escuridão total consome o inimigo drenando sua alma e deixando apenas o vazio',
    danoBonusContra: ['Luz', 'Fogo'],
    fraquezaContra:  ['Luz', 'Ar'],
    corNarrativa: 'trevas absolutas',
  },
  {
    nome: 'Luz',
    emoji: '✨',
    habilidadeUltima: 'Julgamento Celestial',
    descHabilidade: 'Um feixe de luz divina desce dos céus consumindo o alvo em pura energia sagrada',
    danoBonusContra: ['Sombra', 'Magia Negra'],
    fraquezaContra:  ['Sombra', 'Ar'],
    corNarrativa: 'brilho celestial',
  },
  {
    nome: 'Magia Negra',
    emoji: '🖤',
    habilidadeUltima: 'Maldição Eterna',
    descHabilidade: 'Uma maldição ancestral corrói o corpo e a alma do inimigo de dentro para fora',
    danoBonusContra: ['Luz', 'Trovão'],
    fraquezaContra:  ['Luz'],
    corNarrativa: 'energia amaldiçoada',
  },
];

// ── Armas ────────────────────────────────────────────────────────────────────
const ARMAS = [
  // Nível 1
  { nome: 'Espada',              emoji: '⚔️',  bonusAtaque: 8,  preco: 300,  raridade: 'comum',    nivelMinimo: 1  },
  { nome: 'Machado',             emoji: '🪓',  bonusAtaque: 12, preco: 450,  raridade: 'comum',    nivelMinimo: 1  },
  { nome: 'Adaga',               emoji: '🗡️',  bonusAtaque: 6,  preco: 200,  raridade: 'comum',    nivelMinimo: 1  },
  { nome: 'Cajado de Madeira',   emoji: '🪵',  bonusAtaque: 4,  preco: 150,  raridade: 'comum',    nivelMinimo: 1,  bonusMana: 15 },
  { nome: 'Arco Simples',        emoji: '🏹',  bonusAtaque: 5,  preco: 180,  raridade: 'comum',    nivelMinimo: 1  },
  { nome: 'Lança Simples',       emoji: '🔱',  bonusAtaque: 7,  preco: 220,  raridade: 'comum',    nivelMinimo: 1  },
  { nome: 'Cetro Enferrujado',   emoji: '🔩',  bonusAtaque: 3,  preco: 130,  raridade: 'comum',    nivelMinimo: 1,  bonusMana: 20 },
  { nome: 'Faca de Caça',        emoji: '🔪',  bonusAtaque: 8,  preco: 240,  raridade: 'comum',    nivelMinimo: 1  },
  { nome: 'Bordão Sagrado',      emoji: '✝️',   bonusAtaque: 6,  preco: 260,  raridade: 'comum',    nivelMinimo: 1,  bonusMana: 10 },
  { nome: 'Ramo Druídico',       emoji: '🌿',  bonusAtaque: 4,  preco: 160,  raridade: 'comum',    nivelMinimo: 1,  bonusMana: 25 },
  // Nível 3
  { nome: 'Lança',               emoji: '🔱',  bonusAtaque: 10, preco: 350,  raridade: 'incomum',  nivelMinimo: 3  },
  { nome: 'Cajado',              emoji: '🪄',  bonusAtaque: 5,  preco: 400,  raridade: 'incomum',  nivelMinimo: 3,  bonusMana: 30 },
  { nome: 'Arco',                emoji: '🏹',  bonusAtaque: 9,  preco: 380,  raridade: 'incomum',  nivelMinimo: 3  },
  { nome: 'Adaga Envenenada',    emoji: '💚',  bonusAtaque: 10, preco: 420,  raridade: 'incomum',  nivelMinimo: 3  },
  { nome: 'Cajado da Floresta',  emoji: '🌲',  bonusAtaque: 6,  preco: 430,  raridade: 'incomum',  nivelMinimo: 3,  bonusMana: 40 },
  { nome: 'Martelo Sagrado',     emoji: '🔨',  bonusAtaque: 11, preco: 390,  raridade: 'incomum',  nivelMinimo: 3  },
  { nome: 'Grimório Sombrio',    emoji: '📖',  bonusAtaque: 7,  preco: 460,  raridade: 'incomum',  nivelMinimo: 3,  bonusMana: 45 },
  { nome: 'Espada Longa',        emoji: '🗡️',  bonusAtaque: 13, preco: 500,  raridade: 'incomum',  nivelMinimo: 3  },
  // Nível 5
  { nome: 'Arco Élfico',         emoji: '🌟',  bonusAtaque: 14, preco: 650,  raridade: 'incomum',  nivelMinimo: 5  },
  { nome: 'Espada do Amanhecer', emoji: '🌅',  bonusAtaque: 13, preco: 620,  raridade: 'incomum',  nivelMinimo: 5,  bonusMana: 15 },
  { nome: 'Cajado de Cristal',   emoji: '💎',  bonusAtaque: 9,  preco: 680,  raridade: 'incomum',  nivelMinimo: 5,  bonusMana: 55 },
  { nome: 'Faca Gêmea',          emoji: '⚡',  bonusAtaque: 15, preco: 700,  raridade: 'incomum',  nivelMinimo: 5  },
  { nome: 'Machado de Guerra',   emoji: '🪓',  bonusAtaque: 16, preco: 720,  raridade: 'incomum',  nivelMinimo: 5  },
  // Nível 7
  { nome: 'Espada Rúnica',       emoji: '🔮',  bonusAtaque: 18, preco: 900,  raridade: 'raro',     nivelMinimo: 7  },
  { nome: 'Machado Sombrio',     emoji: '💀',  bonusAtaque: 22, preco: 1200, raridade: 'raro',     nivelMinimo: 7  },
  { nome: 'Cajado das Eras',     emoji: '✨',  bonusAtaque: 15, preco: 1100, raridade: 'raro',     nivelMinimo: 7,  bonusMana: 60 },
  { nome: 'Adaga da Sombra',     emoji: '🌑',  bonusAtaque: 20, preco: 1050, raridade: 'raro',     nivelMinimo: 7  },
  { nome: 'Arco da Tempestade',  emoji: '⛈️',  bonusAtaque: 19, preco: 980,  raridade: 'raro',     nivelMinimo: 7  },
  { nome: 'Lança Sagrada',       emoji: '⚜️',  bonusAtaque: 17, preco: 950,  raridade: 'raro',     nivelMinimo: 7,  bonusMana: 25 },
  { nome: 'Cajado dos Mortos',   emoji: '💀',  bonusAtaque: 16, preco: 1000, raridade: 'raro',     nivelMinimo: 7,  bonusMana: 70 },
  { nome: 'Cetro da Natureza',   emoji: '🌺',  bonusAtaque: 14, preco: 920,  raridade: 'raro',     nivelMinimo: 7,  bonusMana: 65 },
  // Nível 10
  { nome: 'Espada dos Titãs',    emoji: '⚡',  bonusAtaque: 23, preco: 1500, raridade: 'raro',     nivelMinimo: 10 },
  { nome: 'Adaga do Caos',       emoji: '🌀',  bonusAtaque: 24, preco: 1550, raridade: 'raro',     nivelMinimo: 10 },
  { nome: 'Grimório das Trevas', emoji: '🖤',  bonusAtaque: 20, preco: 1600, raridade: 'raro',     nivelMinimo: 10, bonusMana: 90 },
  { nome: 'Cajado Ancestral',    emoji: '🌳',  bonusAtaque: 18, preco: 1480, raridade: 'raro',     nivelMinimo: 10, bonusMana: 85 },
  // Nível 12
  { nome: 'Lâmina do Vazio',     emoji: '🌑',  bonusAtaque: 25, preco: 1800, raridade: 'lendário', nivelMinimo: 12 },
  { nome: 'Cetro do Apocalipse', emoji: '☄️',  bonusAtaque: 22, preco: 1900, raridade: 'lendário', nivelMinimo: 12, bonusMana: 100 },
  { nome: 'Arco do Julgamento',  emoji: '🏹',  bonusAtaque: 24, preco: 1850, raridade: 'lendário', nivelMinimo: 12 },
  { nome: 'Espada Celestial',    emoji: '✨',  bonusAtaque: 26, preco: 2000, raridade: 'lendário', nivelMinimo: 12, bonusMana: 30 },
  { nome: 'Punhal Eterno',       emoji: '🗡️',  bonusAtaque: 27, preco: 2100, raridade: 'lendário', nivelMinimo: 12 },
  // Novas armas — níveis 1 a 12
  { nome: 'Bastão de Bambu',       emoji: '🎋', bonusAtaque: 7,  preco: 260,  raridade: 'comum',    nivelMinimo: 1 },
  { nome: 'Besta Mecânica',        emoji: '🏹', bonusAtaque: 11, preco: 520,  raridade: 'incomum',  nivelMinimo: 3 },
  { nome: 'Martelo de Guerra',     emoji: '🔨', bonusAtaque: 14, preco: 580,  raridade: 'incomum',  nivelMinimo: 4 },
  { nome: 'Alaúde Encantado',      emoji: '🎻', bonusAtaque: 8,  preco: 620,  raridade: 'incomum',  nivelMinimo: 4, bonusMana: 35 },
  { nome: 'Manoplas do Dragão',    emoji: '🐉', bonusAtaque: 16, preco: 820,  raridade: 'incomum',  nivelMinimo: 5 },
  { nome: 'Machado do Colosso',    emoji: '🪓', bonusAtaque: 21, preco: 1250, raridade: 'raro',     nivelMinimo: 7 },
  { nome: 'Lâminas Gêmeas',        emoji: '⚔️', bonusAtaque: 19, preco: 1180, raridade: 'raro',     nivelMinimo: 7 },
  { nome: 'Besta Rúnica',          emoji: '🔱', bonusAtaque: 20, preco: 1320, raridade: 'raro',     nivelMinimo: 8 },
  { nome: 'Espada do Dragão',      emoji: '🐲', bonusAtaque: 24, preco: 1650, raridade: 'raro',     nivelMinimo: 10 },
  { nome: 'Cajado Estelar',        emoji: '🌠', bonusAtaque: 20, preco: 1700, raridade: 'raro',     nivelMinimo: 10, bonusMana: 95 },
  { nome: 'Besta Celestial',       emoji: '🌌', bonusAtaque: 27, preco: 2050, raridade: 'lendário', nivelMinimo: 12 },
  { nome: 'Orbe do Infinito',      emoji: '🔮', bonusAtaque: 23, preco: 2150, raridade: 'lendário', nivelMinimo: 12, bonusMana: 120 },
];

// ── Poções ───────────────────────────────────────────────────────────────────
const POCOES = [
  { nome: 'Poção de Cura',        emoji: '🧪', tipo: 'hp',    valor: 50,  preco: 80,  raridade: 'comum'    },
  { nome: 'Poção Grande',         emoji: '💊', tipo: 'hp',    valor: 120, preco: 180, raridade: 'incomum'  },
  { nome: 'Poção Suprema de Vida', emoji: '❤️', tipo: 'hp',   valor: 250, preco: 400, raridade: 'raro'     },
  { nome: 'Elixir de Mana',       emoji: '🔷', tipo: 'mana',  valor: 60,  preco: 100, raridade: 'comum'    },
  { nome: 'Elixir Supremo',       emoji: '💎', tipo: 'mana',  valor: 150, preco: 220, raridade: 'incomum'  },
  { nome: 'Elixir do Arcano',     emoji: '🌀', tipo: 'mana',  valor: 300, preco: 450, raridade: 'raro'     },
  { nome: 'Poção de Batalha',     emoji: '⚗️', tipo: 'ambos', valor: 80,  preco: 250, raridade: 'raro'     },
  { nome: 'Poção Lendária',       emoji: '🌟', tipo: 'ambos', valor: 200, preco: 600, raridade: 'lendário' },
  { nome: 'Tônico do Berserker',   emoji: '🩸', tipo: 'hp',    valor: 90,  preco: 160, raridade: 'incomum' },
  { nome: 'Essência Vital',        emoji: '🌱', tipo: 'hp',    valor: 180, preco: 300, raridade: 'raro' },
  { nome: 'Gota de Mana',          emoji: '💧', tipo: 'mana',  valor: 35,  preco: 65,  raridade: 'comum' },
  { nome: 'Frasco Arcano',         emoji: '🧿', tipo: 'mana',  valor: 220, preco: 340, raridade: 'raro' },
  { nome: 'Elixir do Equilíbrio',  emoji: '☯️', tipo: 'ambos', valor: 130, preco: 420, raridade: 'raro' },
  { nome: 'Lágrima da Fênix',      emoji: '🔥', tipo: 'ambos', valor: 320, preco: 850, raridade: 'lendário' },
];

// ── Armaduras ────────────────────────────────────────────────────────────────
const ARMADURAS = [
  // Nível 1
  { nome: 'Armadura de Couro',    emoji: '🥋', bonusDefesa: 5,  preco: 200,  raridade: 'comum',    nivelMinimo: 1  },
  { nome: 'Cota de Malha',        emoji: '🛡️', bonusDefesa: 10, preco: 400,  raridade: 'comum',    nivelMinimo: 1  },
  { nome: 'Manto de Aprendiz',    emoji: '👘', bonusDefesa: 3,  preco: 150,  raridade: 'comum',    nivelMinimo: 1,  bonusMana: 20 },
  { nome: 'Capuz de Couro',       emoji: '🪖', bonusDefesa: 4,  preco: 170,  raridade: 'comum',    nivelMinimo: 1  },
  { nome: 'Veste de Druida',      emoji: '🍃', bonusDefesa: 4,  preco: 180,  raridade: 'comum',    nivelMinimo: 1,  bonusMana: 15 },
  // Nível 3
  { nome: 'Armadura de Placas',   emoji: '🦾', bonusDefesa: 16, preco: 700,  raridade: 'incomum',  nivelMinimo: 3  },
  { nome: 'Manto Sombrio',        emoji: '🌑', bonusDefesa: 8,  preco: 500,  raridade: 'incomum',  nivelMinimo: 3,  bonusMana: 20 },
  { nome: 'Gibão Reforçado',      emoji: '🧥', bonusDefesa: 11, preco: 560,  raridade: 'incomum',  nivelMinimo: 3  },
  { nome: 'Manto dos Ossos',      emoji: '🦴', bonusDefesa: 6,  preco: 480,  raridade: 'incomum',  nivelMinimo: 3,  bonusMana: 35 },
  { nome: 'Colete de Escamas',    emoji: '🐍', bonusDefesa: 9,  preco: 520,  raridade: 'incomum',  nivelMinimo: 3  },
  // Nível 5
  { nome: 'Armadura Sagrada',     emoji: '✝️',  bonusDefesa: 14, preco: 750,  raridade: 'incomum',  nivelMinimo: 5,  bonusMana: 10 },
  { nome: 'Manto Arcano',         emoji: '🔵', bonusDefesa: 7,  preco: 720,  raridade: 'incomum',  nivelMinimo: 5,  bonusMana: 45 },
  { nome: 'Couraça da Floresta',  emoji: '🌲', bonusDefesa: 10, preco: 700,  raridade: 'incomum',  nivelMinimo: 5,  bonusMana: 30 },
  { nome: 'Sombra Entrelaçada',   emoji: '🌙', bonusDefesa: 12, preco: 780,  raridade: 'incomum',  nivelMinimo: 5  },
  // Nível 7
  { nome: 'Veste Élfica',         emoji: '🌿', bonusDefesa: 12, preco: 650,  raridade: 'raro',     nivelMinimo: 7  },
  { nome: 'Armadura Rúnica',      emoji: '🔮', bonusDefesa: 20, preco: 1000, raridade: 'raro',     nivelMinimo: 7  },
  { nome: 'Manto das Trevas',     emoji: '🖤', bonusDefesa: 15, preco: 980,  raridade: 'raro',     nivelMinimo: 7,  bonusMana: 50 },
  { nome: 'Armadura de Titânio',  emoji: '🤖', bonusDefesa: 22, preco: 1100, raridade: 'raro',     nivelMinimo: 7  },
  { nome: 'Veste da Lua Cheia',   emoji: '🌕', bonusDefesa: 13, preco: 900,  raridade: 'raro',     nivelMinimo: 7,  bonusMana: 40 },
  // Nível 10
  { nome: 'Armadura do Crepúsculo', emoji: '🌇', bonusDefesa: 18, preco: 1350, raridade: 'raro',   nivelMinimo: 10, bonusMana: 20 },
  { nome: 'Manto do Vazio',       emoji: '🌀', bonusDefesa: 14, preco: 1300, raridade: 'raro',     nivelMinimo: 10, bonusMana: 70 },
  { nome: 'Colete Fantasma',      emoji: '👻', bonusDefesa: 16, preco: 1250, raridade: 'raro',     nivelMinimo: 10 },
  // Nível 12
  { nome: 'Placas do Abismo',     emoji: '💀', bonusDefesa: 25, preco: 1500, raridade: 'lendário', nivelMinimo: 12 },
  { nome: 'Manto Celestial',      emoji: '✨', bonusDefesa: 20, preco: 1700, raridade: 'lendário', nivelMinimo: 12, bonusMana: 80 },
  { nome: 'Armadura do Caos',     emoji: '🌪️', bonusDefesa: 23, preco: 1800, raridade: 'lendário', nivelMinimo: 12 },
  { nome: 'Veste do Além',        emoji: '🌌', bonusDefesa: 18, preco: 1600, raridade: 'lendário', nivelMinimo: 12, bonusMana: 100 },
  { nome: 'Braçadeiras de Ferro',   emoji: '🦾', bonusDefesa: 6,  preco: 260,  raridade: 'comum',    nivelMinimo: 1 },
  { nome: 'Manto do Bardo',         emoji: '🎼', bonusDefesa: 5,  preco: 280,  raridade: 'comum',    nivelMinimo: 1, bonusMana: 25 },
  { nome: 'Couraça do Berserker',   emoji: '🩸', bonusDefesa: 9,  preco: 620,  raridade: 'incomum',  nivelMinimo: 3 },
  { nome: 'Túnica do Monge',        emoji: '🥋', bonusDefesa: 8,  preco: 580,  raridade: 'incomum',  nivelMinimo: 3, bonusMana: 20 },
  { nome: 'Armadura de Escamas',    emoji: '🐉', bonusDefesa: 15, preco: 900,  raridade: 'incomum',  nivelMinimo: 5 },
  { nome: 'Manto das Constelações', emoji: '🌌', bonusDefesa: 11, preco: 980,  raridade: 'raro',     nivelMinimo: 7, bonusMana: 55 },
  { nome: 'Armadura do Colosso',    emoji: '🗿', bonusDefesa: 24, preco: 1450, raridade: 'raro',     nivelMinimo: 10 },
  { nome: 'Égide do Infinito',      emoji: '♾️', bonusDefesa: 27, preco: 1950, raridade: 'lendário', nivelMinimo: 12, bonusMana: 35 },
];

// ── Missões ──────────────────────────────────────────────────────────────────
const MISSOES = [
  // Nível 1+ (fácil)
  { titulo: 'A Cripta dos Mortos Vivos',    dificuldade: 'fácil',   nivelMinimo: 1,  xpReward: 50,  goldReward: 100, emoji: '💀' },
  { titulo: 'O Pântano das Almas',          dificuldade: 'fácil',   nivelMinimo: 1,  xpReward: 60,  goldReward: 150, emoji: '🌿' },
  { titulo: 'A Aldeia dos Espíritos',       dificuldade: 'fácil',   nivelMinimo: 1,  xpReward: 70,  goldReward: 180, emoji: '👻' },
  { titulo: 'O Celeiro Amaldiçoado',        dificuldade: 'fácil',   nivelMinimo: 1,  xpReward: 55,  goldReward: 120, emoji: '🌾' },
  { titulo: 'A Caverna dos Morcegos',       dificuldade: 'fácil',   nivelMinimo: 1,  xpReward: 65,  goldReward: 160, emoji: '🦇' },
  { titulo: 'O Mercado Maldito',            dificuldade: 'fácil',   nivelMinimo: 1,  xpReward: 50,  goldReward: 130, emoji: '🏚️' },
  { titulo: 'A Ponte dos Fantasmas',        dificuldade: 'fácil',   nivelMinimo: 1,  xpReward: 60,  goldReward: 140, emoji: '🌉' },
  { titulo: 'O Poço Sem Fundo',             dificuldade: 'fácil',   nivelMinimo: 1,  xpReward: 75,  goldReward: 170, emoji: '🕳️' },
  // Nível 2+ (fácil)
  { titulo: 'As Ruínas do Velho Reino',     dificuldade: 'fácil',   nivelMinimo: 2,  xpReward: 80,  goldReward: 190, emoji: '🏛️' },
  { titulo: 'O Acampamento Goblin',         dificuldade: 'fácil',   nivelMinimo: 2,  xpReward: 85,  goldReward: 200, emoji: '👺' },
  { titulo: 'A Estalagem Fantasma',         dificuldade: 'fácil',   nivelMinimo: 2,  xpReward: 80,  goldReward: 195, emoji: '🏠' },
  // Nível 4+ (médio)
  { titulo: 'A Floresta Amaldiçoada',       dificuldade: 'médio',   nivelMinimo: 4,  xpReward: 100, goldReward: 250, emoji: '🌲' },
  { titulo: 'As Minas do Esquecimento',     dificuldade: 'médio',   nivelMinimo: 4,  xpReward: 120, goldReward: 300, emoji: '⛏️' },
  { titulo: 'O Covil do Lobisomem',         dificuldade: 'médio',   nivelMinimo: 4,  xpReward: 130, goldReward: 320, emoji: '🐺' },
  { titulo: 'A Necrópole Esquecida',        dificuldade: 'médio',   nivelMinimo: 4,  xpReward: 110, goldReward: 270, emoji: '⚰️' },
  { titulo: 'O Labirinto de Pedra',         dificuldade: 'médio',   nivelMinimo: 4,  xpReward: 115, goldReward: 280, emoji: '🌀' },
  { titulo: 'A Fortaleza dos Bandidos',     dificuldade: 'médio',   nivelMinimo: 4,  xpReward: 125, goldReward: 310, emoji: '⚔️' },
  { titulo: 'O Navio Fantasma',             dificuldade: 'médio',   nivelMinimo: 4,  xpReward: 120, goldReward: 295, emoji: '🚢' },
  // Nível 6+ (médio)
  { titulo: 'O Santuário Corrompido',       dificuldade: 'médio',   nivelMinimo: 6,  xpReward: 140, goldReward: 340, emoji: '⛩️' },
  { titulo: 'A Arena dos Condenados',       dificuldade: 'médio',   nivelMinimo: 6,  xpReward: 150, goldReward: 360, emoji: '🏟️' },
  { titulo: 'O Desfiladeiro das Sombras',   dificuldade: 'médio',   nivelMinimo: 6,  xpReward: 145, goldReward: 350, emoji: '🌑' },
  { titulo: 'A Biblioteca Proibida',        dificuldade: 'médio',   nivelMinimo: 6,  xpReward: 135, goldReward: 330, emoji: '📚' },
  // Nível 8+ (difícil)
  { titulo: 'O Dragão das Montanhas',       dificuldade: 'difícil', nivelMinimo: 8,  xpReward: 200, goldReward: 500, emoji: '🐉' },
  { titulo: 'O Castelo do Rei Sombrio',     dificuldade: 'difícil', nivelMinimo: 8,  xpReward: 180, goldReward: 450, emoji: '🏰' },
  { titulo: 'O Golem de Ferro Ancestral',   dificuldade: 'difícil', nivelMinimo: 8,  xpReward: 190, goldReward: 470, emoji: '🤖' },
  { titulo: 'A Hidra dos Pântanos Negros',  dificuldade: 'difícil', nivelMinimo: 8,  xpReward: 195, goldReward: 480, emoji: '🐍' },
  { titulo: 'O Portal Dimensional',         dificuldade: 'difícil', nivelMinimo: 8,  xpReward: 185, goldReward: 460, emoji: '🌌' },
  // Nível 10+ (difícil)
  { titulo: 'A Torre do Mago Louco',        dificuldade: 'difícil', nivelMinimo: 10, xpReward: 220, goldReward: 550, emoji: '🔮' },
  { titulo: 'O Templo da Magia Negra',      dificuldade: 'difícil', nivelMinimo: 10, xpReward: 250, goldReward: 600, emoji: '🖤' },
  { titulo: 'O Lich dos Tempos Antigos',    dificuldade: 'difícil', nivelMinimo: 10, xpReward: 240, goldReward: 580, emoji: '💀' },
  { titulo: 'A Dimensão do Caos',           dificuldade: 'difícil', nivelMinimo: 10, xpReward: 235, goldReward: 570, emoji: '🌀' },
  { titulo: 'O Trono do Deus Esquecido',    dificuldade: 'difícil', nivelMinimo: 10, xpReward: 260, goldReward: 620, emoji: '👑' },
  // Nível 12+ (lendário)
  { titulo: 'O Despertar do Titã',          dificuldade: 'lendário', nivelMinimo: 12, xpReward: 350, goldReward: 900,  emoji: '⚡' },
  { titulo: 'A Forja dos Deuses',           dificuldade: 'lendário', nivelMinimo: 12, xpReward: 380, goldReward: 950,  emoji: '🔥' },
  { titulo: 'O Fim do Mundo Conhecido',     dificuldade: 'lendário', nivelMinimo: 12, xpReward: 400, goldReward: 1000, emoji: '🌍' },
  { titulo: 'A Ascensão do Rei Morto',      dificuldade: 'lendário', nivelMinimo: 12, xpReward: 370, goldReward: 930,  emoji: '👑' },
  { titulo: 'O Coração das Trevas Eternas', dificuldade: 'lendário', nivelMinimo: 12, xpReward: 420, goldReward: 1050, emoji: '🖤' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sortearAleatorio(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return null;
  return lista[Math.floor(Math.random() * lista.length)];
}

function getClasse(nome) {
  return CLASSES.find(c => c.nome.toLowerCase() === (nome || '').toLowerCase()) ?? null;
}

function getElemento(nome) {
  return ELEMENTOS.find(e => e.nome.toLowerCase() === (nome || '').toLowerCase()) ?? null;
}

function getArma(nome) {
  return ARMAS.find(a => a.nome.toLowerCase() === (nome || '').toLowerCase()) ?? null;
}

function getArmadura(nome) {
  return ARMADURAS.find(a => a.nome.toLowerCase() === (nome || '').toLowerCase()) ?? null;
}

function getPocao(nome) {
  return POCOES.find(p => p.nome.toLowerCase() === (nome || '').toLowerCase()) ?? null;
}

function calcularMultElemento(elementoAtacante, elementoDefensor) {
  const el = getElemento(elementoAtacante);
  if (!el) return 1.0;
  if (el.danoBonusContra.includes(elementoDefensor)) return 1.5;
  if (el.fraquezaContra.includes(elementoDefensor))  return 0.7;
  return 1.0;
}

function xpParaNivel(nivel) {
  if (nivel < 1) return 100;
  return Math.floor(100 * Math.pow(Math.max(1, nivel), 1.4));
}

function verificarCooldown(dataUltimaAcao, cooldownMs) {
  if (!dataUltimaAcao) return { pode: true, tempoRestante: null };
  const diff = Date.now() - new Date(dataUltimaAcao).getTime();
  if (diff >= cooldownMs) return { pode: true, tempoRestante: null };
  const restante = cooldownMs - diff;
  const min = Math.floor(restante / 60000);
  const seg = Math.floor((restante % 60000) / 1000);
  return { pode: false, tempoRestante: min > 0 ? `${min}min ${seg}s` : `${seg}s` };
}

function calcularDano(personagem, alvo, habilidade = false) {
  const arma        = personagem.armaEquipada    ? getArma(personagem.armaEquipada)       : null;
  const armaduraAlvo = alvo.armaduraEquipada     ? getArmadura(alvo.armaduraEquipada)     : null;

  const baseAtaque = personagem.ataque + (arma?.bonusAtaque     || 0);
  const baseDefesa = alvo.defesa       + (armaduraAlvo?.bonusDefesa || 0);

  const multElemento   = calcularMultElemento(personagem.elemento, alvo.elemento);
  const critico        = !habilidade && Math.random() < 0.15;
  const multCrit       = critico    ? 1.8 : 1.0;
  const multHabilidade = habilidade ? 2.2 : 1.0;
  const variacao       = 0.85 + Math.random() * 0.3;

  const dano = Math.max(1, Math.floor(
    (baseAtaque * multElemento * multCrit * multHabilidade * variacao) - (baseDefesa * 0.4)
  ));

  return { dano, critico, multElemento };
}

function narrarCombate(atacante, defensor, dano, critico, habilidade = null) {
  const elAtacante = getElemento(atacante.elemento);
  const cor        = elAtacante?.corNarrativa || 'energia mística';

  let pool;

  if (habilidade) {
    pool = [
      `⚡ *${atacante.nome}* invoca *${habilidade}* e libera ${cor} sobre *${defensor.nome}*, causando *${dano}* de dano!`,
      `💥 Os céus tremem enquanto *${atacante.nome}* desencadeia *${habilidade}* sobre *${defensor.nome}* — *${dano}* de dano!`,
      `🌀 *${habilidade}* ressoa pelo campo de batalha! *${defensor.nome}* sofre *${dano}* de dano colossal!`,
      `🌪️ *${atacante.nome}* concentra seu poder e dispara *${habilidade}*! O impacto atinge *${defensor.nome}* em cheio: *${dano}* de dano!`,
      `🔮 Runas brilham ao redor de *${atacante.nome}*, que conjura *${habilidade}* contra *${defensor.nome}* — *${dano}* de dano!`,
      `⚡ Uma onda de poder explode quando *${atacante.nome}* usa *${habilidade}*! *${defensor.nome}* recebe *${dano}* de dano!`,
      `💢 *${atacante.nome}* transforma energia em destruição com *${habilidade}*, atingindo *${defensor.nome}* por *${dano}*!`,
    ];
  } else if (critico) {
    pool = [
      `💥 *GOLPE CRÍTICO!* *${atacante.nome}* desfere um ataque devastador com ${cor}, causando *${dano}* de dano em *${defensor.nome}*!`,
      `⚡ Incrível! *${atacante.nome}* encontrou a brecha perfeita e causou *${dano}* de dano em *${defensor.nome}*!`,
      `🔥 *${atacante.nome}* canalizou ${cor} num golpe certeiro — *${dano}* de dano crítico em *${defensor.nome}*!`,
      `☄️ *${atacante.nome}* encontrou um ponto fraco e acertou em cheio! *${defensor.nome}* sofre *${dano}* de dano crítico!`,
      `🩸 A defesa de *${defensor.nome}* falhou por um instante: *${atacante.nome}* aproveitou e causou *${dano}* de dano!`,
      `🌟 Um movimento perfeito! *${atacante.nome}* desferiu um crítico de *${dano}* contra *${defensor.nome}*!`,
      `💢 O golpe de *${atacante.nome}* rompe a guarda de *${defensor.nome}* e causa *${dano}* de dano devastador!`,
    ];
  } else {
    pool = [
      `⚔️ *${atacante.nome}* ataca *${defensor.nome}* com ${cor}, causando *${dano}* de dano!`,
      `🗡️ *${atacante.nome}* avança com ${cor} e atinge *${defensor.nome}* por *${dano}* de dano!`,
      `🔥 *${atacante.nome}* lança ${cor} em direção a *${defensor.nome}*, causando *${dano}* de dano!`,
      `💫 Com precisão, *${atacante.nome}* usa ${cor} contra *${defensor.nome}* — *${dano}* de dano!`,
      `🛡️ *${atacante.nome}* encontra uma abertura na defesa de *${defensor.nome}* e causa *${dano}* de dano!`,
      `⚔️ As armas se chocam! *${atacante.nome}* leva a melhor e atinge *${defensor.nome}* por *${dano}*!`,
      `💨 Num movimento rápido, *${atacante.nome}* surpreende *${defensor.nome}* e causa *${dano}* de dano!`,
      `🗡️ *${atacante.nome}* muda de estratégia e acerta *${defensor.nome}* em cheio: *${dano}* de dano!`,
      `🔥 O combate esquenta! *${atacante.nome}* avança com ${cor} e retira *${dano}* HP de *${defensor.nome}*!`,
      `💥 Um impacto ecoa pela arena: *${defensor.nome}* recebe *${dano}* de dano de *${atacante.nome}*!`,
    ];
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
  CLASSES,
  ELEMENTOS,
  ARMAS,
  ARMADURAS,
  POCOES,
  MISSOES,
  JANELA_SAQUE_MS,
  contaVinculada,
  bloqueadoPorVinculo,
  somenteGrupo,
  getModoAtivo,
  sanitizarNome,
  normalizarItemKey,
  itemKeyParaNome,
  getInventarioMap,
  getOuCriarPersonagem,
  gerarBarra,
  verificarRecuperacaoDerrota,
  verificarLevelUp,
  sortearAleatorio,
  getClasse,
  getElemento,
  getArma,
  getArmadura,
  getPocao,
  calcularMultElemento,
  calcularDano,
  narrarCombate,
  xpParaNivel,
  verificarCooldown,
};