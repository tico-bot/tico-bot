'use strict';

// ─── Dados estáticos de economia ────────────────────────────────────────────
// Extraído de handlers/diversao/economia.js (monolito antigo).
// Nenhum valor foi alterado — apenas movido para cá.

const ITENS_LOJA = {
  // COMIDAS
  pizza:        { nome: 'Pizza Margherita', preco: 50,  categoria: 'comida' },
  hamburger:    { nome: 'Hamburger Simples', preco: 40,  categoria: 'comida' },
  frango:       { nome: 'Frango Frito',     preco: 35,  categoria: 'comida' },
  picanha:      { nome: 'Picanha',          preco: 120, categoria: 'comida' },
  chocolate:    { nome: 'Chocolate',        preco: 25,  categoria: 'comida' },
  bolo:         { nome: 'Bolo de Aniversário', preco: 150, categoria: 'comida' },
  refrigerante: { nome: 'Refrigerante',     preco: 10,  categoria: 'comida' },
  cerveja:      { nome: 'Cerveja',          preco: 80,  categoria: 'comida' },

  // COMIDA PARA PETS
  racao:        { nome: 'Ração Normal',  preco: 20, categoria: 'petcomida' },
  racaopremium: { nome: 'Ração Premium', preco: 45, categoria: 'petcomida' },
  carnefresh:   { nome: 'Carne Fresca',  preco: 55, categoria: 'petcomida' },
  peixe:        { nome: 'Peixe Fresco',  preco: 60, categoria: 'petcomida' },
  leite:        { nome: 'Leite',         preco: 15, categoria: 'petcomida' },

  // BRINQUEDOS
  bolinha: { nome: 'Bolinha de Tênis', preco: 35,  categoria: 'petbrinquedo' },
  pelucia: { nome: 'Pelúcia',          preco: 50,  categoria: 'petbrinquedo' },
  corda:   { nome: 'Corda de Puxar',   preco: 40,  categoria: 'petbrinquedo' },
  disco:   { nome: 'Disco Voador',     preco: 60,  categoria: 'petbrinquedo' },
  casabrinquedo: { nome: 'Casa de Brinquedo', preco: 150, categoria: 'petbrinquedo' },

  // CUIDADOS PET
  remedio:  { nome: 'Remédio Geral',    preco: 80,  categoria: 'petcuidado' },
  vacina:   { nome: 'Vacina',           preco: 120, categoria: 'petcuidado' },
  shampoo:  { nome: 'Shampoo Especial', preco: 70,  categoria: 'petcuidado' },
  sabonete: { nome: 'Sabonete Pet',     preco: 40,  categoria: 'petcuidado' },

  // ACESSÓRIOS PET
  coleira:     { nome: 'Coleira Colorida', preco: 55,  categoria: 'petacessorio' },
  coleiraouro: { nome: 'Coleira de Ouro',  preco: 200, categoria: 'petacessorio' },
  bandana:     { nome: 'Bandana',          preco: 45,  categoria: 'petacessorio' },
  coroa:       { nome: 'Coroa Pet',        preco: 100, categoria: 'petacessorio' },

  // ESPECIAIS
  trofeu:       { nome: 'Troféu Miniatura', preco: 250, categoria: 'especial' },
  pocaoenergia: { nome: 'Poção de Energia', preco: 180, categoria: 'especial' },
  gema:         { nome: 'Gema Brilhante',   preco: 300, categoria: 'especial' },
  cristal:      { nome: 'Cristal Mágico',   preco: 400, categoria: 'especial' },

  // PETS (compatibilidade)
  cachorro: { nome: 'Cachorro', preco: 100, categoria: 'pet' },
  gato:     { nome: 'Gato',     preco: 100, categoria: 'pet' },
  coelho:   { nome: 'Coelho',   preco: 80,  categoria: 'pet' },

  // CASAL
  flores:   { nome: 'Flores',               preco: 60,  categoria: 'casal' },
  carta:    { nome: 'Carta de Amor',         preco: 80,  categoria: 'casal' },
  anel:     { nome: 'Anel',                  preco: 500, categoria: 'casal' },
  morango:  { nome: 'Morango com Chocolate', preco: 55,  categoria: 'casal' },
  perfume:  { nome: 'Perfume Premium',       preco: 150, categoria: 'casal' },
  urso:     { nome: 'Ursinho de Pelúcia',    preco: 130, categoria: 'casal' },
  caixa:    { nome: 'Caixa Presente Luxo',   preco: 50,  categoria: 'casal' },
  garrafa:  { nome: 'Garrafa Vinho Tinto',   preco: 250, categoria: 'casal' },

  // ESTILO
  camiseta: { nome: 'Camiseta', preco: 50, categoria: 'estilo' },
  calcas:   { nome: 'Calças',   preco: 60, categoria: 'estilo' },
  sapato:   { nome: 'Sapato',   preco: 70, categoria: 'estilo' },

  // TECNOLOGIA
  celular:          { nome: 'Celular',           preco: 200,   categoria: 'tec' },
  notebook:         { nome: 'Notebook Gamer',    preco: 5000,  categoria: 'tec' },
  smartphonebasico: { nome: 'Smartphone Básico', preco: 1500,  categoria: 'tec' },
  mousegamer:       { nome: 'Mouse Gamer',       preco: 350,   categoria: 'tec' },
  monitor24:        { nome: 'Monitor 24"',       preco: 1200,  categoria: 'tec' },
  fonesemfio:       { nome: 'Fone Sem Fio',      preco: 600,   categoria: 'tec' },
  ssd1tb:           { nome: 'SSD 1TB',           preco: 800,   categoria: 'tec' },
  pcgamerlegendario:{ nome: 'PC Gamer Lendário', preco: 15000, categoria: 'tec' },
};

// ─── Tabela de minérios do !garimpar (probabilidades somam exatamente 100%) ──
// A raridade é explícita: não deve ser inferida apenas pela chance individual.
const MINERIOS = [
  // ── MÍTICOS (0,30% no total) ───────────────────────────────────────────────
  { nome: '🌌 Núcleo do Abismo',       emoji: '🌌', gold: 25000, chance: 0.05, xp: 520, raridade: 'mitico' },
  { nome: '🐉 Coração de Dragão',      emoji: '🐉', gold: 22000, chance: 0.10, xp: 480, raridade: 'mitico' },
  { nome: '☄️ Fragmento Celestial',    emoji: '☄️', gold: 19000, chance: 0.15, xp: 440, raridade: 'mitico' },

  // ── LENDÁRIOS (1,00% no total) ─────────────────────────────────────────────
  { nome: '🌟 Cristal Estelar',        emoji: '🌟', gold: 15000, chance: 0.20, xp: 360, raridade: 'lendario' },
  { nome: '🔱 Obsidiana Divina',       emoji: '🔱', gold: 10500, chance: 0.30, xp: 300, raridade: 'lendario' },
  { nome: '💎 Diamante Negro',         emoji: '💎', gold: 7500,  chance: 0.50, xp: 255, raridade: 'lendario' },

  // ── ÉPICOS (6,50% no total) ────────────────────────────────────────────────
  { nome: '🪬 Pedra do Destino',       emoji: '🪬', gold: 6500, chance: 0.75, xp: 235, raridade: 'epico' },
  { nome: '💎 Diamante',               emoji: '💎', gold: 5400, chance: 1.00, xp: 195, raridade: 'epico' },
  { nome: '🔮 Ametista Negra',         emoji: '🔮', gold: 4200, chance: 1.25, xp: 170, raridade: 'epico' },
  { nome: '🔮 Ametista',               emoji: '🔮', gold: 3360, chance: 1.50, xp: 145, raridade: 'epico' },
  { nome: '💠 Safira Real',            emoji: '💠', gold: 2800, chance: 2.00, xp: 120, raridade: 'epico' },

  // ── RAROS (15,00% no total) ────────────────────────────────────────────────
  { nome: '💠 Safira',                 emoji: '💠', gold: 2380, chance: 2.00, xp: 106, raridade: 'raro' },
  { nome: '❤️‍🔥 Rubi de Fogo',         emoji: '❤️‍🔥', gold: 1875, chance: 2.50, xp: 80, raridade: 'raro' },
  { nome: '❤️ Rubi',                   emoji: '❤️', gold: 1500, chance: 3.00, xp: 70, raridade: 'raro' },
  { nome: '🫧 Água-marinha',            emoji: '🫧', gold: 1300, chance: 3.50, xp: 60, raridade: 'raro' },
  { nome: '🟣 Tanzanita',              emoji: '🟣', gold: 1125, chance: 4.00, xp: 55, raridade: 'raro' },

  // ── INCOMUNS (29,00% no total) ─────────────────────────────────────────────
  { nome: '🔵 Turquesa',               emoji: '🔵', gold: 1000, chance: 4.50, xp: 50, raridade: 'incomum' },
  { nome: '🟡 Topázio Dourado',         emoji: '🟡', gold: 770,  chance: 4.50, xp: 40, raridade: 'incomum' },
  { nome: '🟡 Topázio',                emoji: '🟡', gold: 616,  chance: 5.00, xp: 33, raridade: 'incomum' },
  { nome: '🟢 Esmeralda',              emoji: '🟢', gold: 506,  chance: 5.00, xp: 29, raridade: 'incomum' },
  { nome: '🟠 Ônix Laranja',           emoji: '🟠', gold: 418,  chance: 5.00, xp: 24, raridade: 'incomum' },
  { nome: '🪩 Opala',                  emoji: '🪩', gold: 352,  chance: 5.00, xp: 20, raridade: 'incomum' },

  // ── COMUNS (48,20% no total) ───────────────────────────────────────────────
  { nome: '🌸 Quartzo Rosa',           emoji: '🌸', gold: 234,  chance: 7.00, xp: 13, raridade: 'comum' },
  { nome: '⚪ Quartzo',                emoji: '⚪', gold: 180,  chance: 8.00, xp: 9,  raridade: 'comum' },
  { nome: '🩶 Granito',                emoji: '🩶', gold: 135,  chance: 9.00, xp: 7,  raridade: 'comum' },
  { nome: '🪨 Pedra Calcária',         emoji: '🪨', gold: 99,   chance: 10.00, xp: 5,  raridade: 'comum' },
  { nome: '🪨 Pedra Comum',            emoji: '🪨', gold: 63,   chance: 14.20, xp: 4,  raridade: 'comum' },
];

// ─── Acontecimentos aleatórios do garimpo (24,5% de chance combinada) ────────
// Cada acontecimento pode alterar o pagamento e, opcionalmente, o XP.
const EVENTOS_GARIMPO = [
  { id: 'veia_rica', chance: 4, multiplicador: 2, xpMultiplicador: 1.5, mensagens: [
    '✨ *VEIO RICO!* A sua picareta abriu uma passagem para uma camada cheia de minério. O pagamento dobrou!',
    '💰 *VEIO RICO!* Você encontrou uma faixa brilhante de pedras valiosas. Tudo o que extraiu vale o dobro!',
  ] },
  { id: 'tesouro_antigo', chance: 1, multiplicador: 3, xpMultiplicador: 2, mensagens: [
    '🏺 *TESOURO ESQUECIDO!* Um baú antigo estava escondido atrás da rocha. O valor da descoberta triplicou!',
    '👑 *CÂMARA SECRETA!* Você encontrou uma reserva de minério preservada há séculos. Ganho triplicado!',
  ] },
  { id: 'geodo_dourado', chance: 2.5, multiplicador: 2.5, xpMultiplicador: 1.75, mensagens: [
    '🌕 *GEODO DOURADO!* A pedra se abriu e revelou cristais raríssimos. O ganho foi multiplicado por 2,5!',
    '💠 *GEODO EXTRAORDINÁRIO!* O interior da rocha estava coberto de cristais. Uma descoberta valiosa!',
  ] },
  { id: 'fosseis', chance: 4, multiplicador: 1.25, xpMultiplicador: 1.5, mensagens: [
    '🦴 *FÓSSIL RARO!* Você encontrou vestígios de uma criatura pré-histórica. Um pesquisador pagou um extra pela descoberta!',
    '📜 *RELÍQUIA DO PASSADO!* Um fóssil preservado chamou a atenção dos especialistas. Você recebeu uma recompensa adicional!',
  ] },
  { id: 'luz_misteriosa', chance: 0.5, multiplicador: 4, xpMultiplicador: 2.5, mensagens: [
    '🌠 *LUZ MISTERIOSA!* Um brilho atravessou a caverna e envolveu o minério. A energia multiplicou seu resultado por quatro!',
    '✨ *RESSONÂNCIA CRISTALINA!* As pedras vibraram em harmonia e potencializaram sua descoberta. Ganho quadruplicado!',
  ] },
  { id: 'explosao', chance: 1.5, multiplicador: 0, xpMultiplicador: 0.5, mensagens: [
    '💥 *EXPLOSÃO!* Uma bolsa de gás explodiu perto da parede. O minério foi destruído, mas você escapou a tempo!',
    '🧨 *DESABAMENTO EXPLOSIVO!* Uma detonação inesperada pulverizou a descoberta. Você saiu ileso, porém sem pagamento!',
  ] },
  { id: 'inundacao', chance: 2, multiplicador: 0.5, xpMultiplicador: 0.75, mensagens: [
    '🌊 *INUNDAÇÃO!* Água invadiu o túnel. Você conseguiu salvar apenas metade do material!',
    '💧 *LENÇOL FREÁTICO!* A parede cedeu e alagou a escavação. Parte do minério se perdeu na correnteza!',
  ] },
  { id: 'desmoronamento', chance: 1, multiplicador: 0.25, xpMultiplicador: 0.75, mensagens: [
    '🪨 *DESMORONAMENTO!* Pedras bloquearam a passagem. Você recolheu apenas uma pequena parte da descoberta!',
    '⚠️ *TETO INSTÁVEL!* O túnel começou a ceder e você precisou fugir, deixando quase todo o minério para trás!',
  ] },
  { id: 'morcegos', chance: 3, multiplicador: 0.8, xpMultiplicador: 1, mensagens: [
    '🦇 *ENXAME DE MORCEGOS!* Uma colônia acordou com o barulho. Na confusão, você perdeu parte do material!',
    '🌑 *ASAS NA ESCURIDÃO!* Morcegos atravessaram o túnel e fizeram você abandonar parte da carga!',
  ] },
  { id: 'ajuda_geologo', chance: 3, multiplicador: 1.5, xpMultiplicador: 1.75, mensagens: [
    '🧭 *GEÓLOGO VIAJANTE!* Um especialista reconheceu a formação rochosa e ajudou você a extrair mais minério!',
    '👷 *AJUDA INESPERADA!* Uma garimpeira experiente ensinou uma técnica que aumentou o valor da sua extração!',
  ] },
  { id: 'veio_vulcanico', chance: 2, multiplicador: 2.25, xpMultiplicador: 2, mensagens: [
    '🔥 *VEIO VULCÂNICO!* O calor revelou uma camada mineral incomum. Sua descoberta valeu muito mais!',
    '🌋 *ROCHA INCANDESCENTE!* Você encontrou minerais formados sob pressão e calor extremos. Bónus de 2,25 vezes!',
  ] },
];

// ─── Narrações por raridade ─────────────────────────────────────────────────
const NARRATIVAS = {
  mitico: [
    '🌌 A caverna ficou em silêncio quando a pedra começou a flutuar diante de você...',
    '🐉 Um calor antigo percorreu a picareta. Aquilo não parecia pertencer a este mundo...',
    '☄️ Uma luz vinda das profundezas revelou algo que os mapas nem sequer mencionavam...',
    '🔮 As paredes estremeceram. Você acabou de encontrar uma lenda enterrada...',
    '✨ Por um instante, todas as lanternas se apagaram — e a pedra continuou brilhando...',
  ],
  lendario: [
    '👑 O brilho atravessou a poeira e fez até os garimpeiros experientes pararem para olhar...',
    '🌟 Você ouviu um estalo cristalino. Uma descoberta dessas pode mudar uma vida...',
    '⚡ A picareta revelou uma formação que poucos acreditariam existir...',
    '🏆 O velho mapa da mina marcava aquele ponto com um aviso: não escavar...',
    '💎 Uma peça perfeita surgiu da rocha, sem uma única rachadura...',
  ],
  epico: [
    '🔮 A rocha se partiu em duas e revelou um brilho intenso em seu interior...',
    '💠 Você seguiu um veio de cristais até uma pequena câmara escondida...',
    '✨ A sua experiência falou mais alto: havia algo especial naquela formação...',
    '⛏️ Foram necessários vários golpes precisos, mas o esforço valeu a pena...',
    '🧭 Um reflexo azul indicou o caminho para uma pedra de grande valor...',
  ],
  raro: [
    '🔥 A poeira baixou e revelou uma pedra com cores que pareciam mudar...',
    '💫 O som da picareta mudou quando atingiu uma camada mais profunda...',
    '🪨 Você encontrou uma formação incomum entre duas paredes de granito...',
    '🔍 Um pequeno reflexo chamou a sua atenção no meio dos fragmentos...',
    '⛏️ A paciência compensou: esta escavação rendeu algo especial...',
  ],
  incomum: [
    '🟢 Uma faixa colorida atravessava a rocha. Você decidiu investigar...',
    '🧱 Entre os fragmentos comuns, uma pedra se destacou pelo brilho...',
    '🧭 Você desviou do túnel principal e encontrou uma pequena reserva...',
    '✨ A luz da lanterna revelou uma formação que quase passou despercebida...',
    '⛏️ Não foi uma descoberta lendária, mas certamente valeu o esforço...',
  ],
  comum: [
    '▫️ Mais uma jornada de trabalho duro nas profundezas da mina...',
    '🪨 A picareta bateu na rocha e você recolheu o que conseguiu...',
    '⛏️ Nem todo dia é de grandes descobertas. O importante é continuar...',
    '🧤 A poeira cobriu suas luvas, mas alguns minerais apareceram...',
    '🕯️ Com a lanterna quase no fim, você encontrou uma última pedra...',
    '🚶 Você percorreu um túnel estreito e voltou com uma pequena recompensa...',
  ],
};

// ─── Falas de quem trabalha nas minas ────────────────────────────────────────
const FALAS_GARIMPO = {
  mitico: [
    { personagem: 'Velho Anselmo', texto: 'Há coisas debaixo desta terra que nem deveriam ser acordadas...' },
    { personagem: 'Mara, a geóloga', texto: 'Isto não aparece em nenhuma tabela mineralógica que eu conheço!' },
    { personagem: 'Voz da caverna', texto: 'Finalmente... alguém encontrou o que estava escondido.' },
  ],
  lendario: [
    { personagem: 'Velho Anselmo', texto: 'Guarde bem isso. Talvez você nunca mais veja outro igual.' },
    { personagem: 'Mara, a geóloga', texto: 'Pela formação e pelo brilho, isto é uma descoberta extraordinária!' },
    { personagem: 'Garimpeiro Raul', texto: 'Eu trabalho aqui há quarenta anos e nunca vi uma pedra dessas.' },
  ],
  epico: [
    { personagem: 'Mara, a geóloga', texto: 'Olhe as inclusões neste cristal. A qualidade é impressionante!' },
    { personagem: 'Garimpeiro Raul', texto: 'Esse veio ainda pode render. Não pare agora!' },
    { personagem: 'Velho Anselmo', texto: 'Boa descoberta! Só não conte para todo mundo onde encontrou.' },
  ],
  raro: [
    { personagem: 'Garimpeira Joana', texto: 'Bata mais para o lado esquerdo. A camada continua por ali.' },
    { personagem: 'Mara, a geóloga', texto: 'Uma peça dessas tem bom valor no mercado de colecionadores.' },
    { personagem: 'Garimpeiro Raul', texto: 'Está vendo? Paciência também é ferramenta de trabalho.' },
  ],
  incomum: [
    { personagem: 'Garimpeira Joana', texto: 'Não é todo dia que aparece uma pedra assim. Boa!' },
    { personagem: 'Garimpeiro Raul', texto: 'Separe as pedras por tipo. O comprador paga melhor assim.' },
    { personagem: 'Mara, a geóloga', texto: 'Interessante! Vale a pena guardar uma amostra para análise.' },
  ],
  comum: [
    { personagem: 'Garimpeiro Raul', texto: 'Devagar se chega longe. Mais uma picaretada!' },
    { personagem: 'Garimpeira Joana', texto: 'Pelo menos hoje a gente não voltou de mãos vazias.' },
    { personagem: 'Velho Anselmo', texto: 'A mina recompensa quem não desiste tão fácil.' },
    { personagem: 'Mara, a geóloga', texto: 'Até as pedras mais simples contam a história deste lugar.' },
    { personagem: 'Garimpeiro novato', texto: 'Acho que ouvi alguma coisa lá no fundo do túnel...' },
  ],
};

module.exports = { ITENS_LOJA, MINERIOS, EVENTOS_GARIMPO, NARRATIVAS, FALAS_GARIMPO };