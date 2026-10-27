'use strict';

// ─── Tabela de Dados Estáticos do Módulo Medieval ────────────────────────────

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
    nome: 'Necromante',
    emoji: '💀',
    descricao: 'Domina a magia negra e os mortos',
    ataque: 20, defesa: 3, hp: 75, mana: 130,
    armasPermitidas: ['Cajado', 'Cajado de Madeira', 'Cetro Enferrujado', 'Grimório Sombrio', 'Cajado dos Mortos', 'Grimório das Trevas', 'Cetro do Apocalipse'],
  },
];

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

module.exports = {
  CLASSES,
  ELEMENTOS,
};
