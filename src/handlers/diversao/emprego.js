/**
 * Handler de Empregos — Bot WhatsApp
 * Sistema de carreira com 35 empregos (7 opções por nível), escolha livre de vagas,
 * salários valorizados, funções únicas e específicas para CADA emprego,
 * cooldown de 40min e tolerância de 30min sem demissões injustas à noite.
 */

'use strict';

const path = require('path');
const { randomUUID } = require('node:crypto');
let CarteiraGrupo;
let getCarteira;
let alterarGold;
let resolverJidCarteira;
let formatarSaldo;

try {
  CarteiraGrupo = require('../../models/CarteiraGrupo');
  ({ getCarteira, alterarGold, resolverJidCarteira, formatarSaldo } = require('../../utils/carteira'));
} catch (err) {
  console.error('[Emprego] ERRO CRÍTICO ao importar dependências:', err.message);
  process.exit(1);
}

const { bloqueadoPorVinculo } = require('../../utils/carteira/vinculo');

// ─── TABELA DE EMPREGOS (7 POR NÍVEL / TIER) ──────────────────────────────────

const CATALGO_EMPREGOS = [
  // ── TIER 1: Nível 1+ (Iniciante) — Salários: 400 a 800 Prata (3 Funções Únicas) ────────
  {
    tier: 1,
    nivelMin: 1,
    nomeTier: '🥉 Tier 1 — Empregos Iniciais',
    salarioMin: 400,
    salarioMax: 800,
    exigenciaTurnos: 12,
    cargos: [
      {
        id: 1, slug: 'entregador_pizza', nome: '🛵 Entregador de Pizza', desc: 'Entregar pizzas quentes pela cidade',
        funcoes: [
          'Conferência dos pedidos e caixas térmicas na pizzaria',
          'Pilotagem ágil na rota de entrega pelo bairro',
          'Entrega presencial ao cliente com recebimento correto'
        ]
      },
      {
        id: 2, slug: 'ajudante_limpeza', nome: '🧹 Ajudante de Limpeza', desc: 'Manter escritórios e lojas limpos',
        funcoes: [
          'Varrição e aspiração de salas e corredores',
          'Higienização completa dos banheiros e superfícies',
          'Recolhimento e descarte adequado dos resíduos'
        ]
      },
      {
        id: 3, slug: 'repositor_estoque', nome: '📦 Repositor de Estoque', desc: 'Organizar prateleiras e caixas',
        funcoes: [
          'Conferência de caixas recebidas dos fornecedores',
          'Etiquetagem e checagem de validade dos produtos',
          'Organização de produtos nas gôndolas e prateleiras'
        ]
      },
      {
        id: 4, slug: 'passeador_caes', nome: '🐕 Passeador de Cães', desc: 'Passear com pets dos moradores',
        funcoes: [
          'Recepção dos cães na residência dos tutores',
          'Passeio orientado pela praça e parque do bairro',
          'Hidratação e higienização das patas após a caminhada'
        ]
      },
      {
        id: 5, slug: 'atendente_cafe', nome: '☕ Atendente de Cafeteria', desc: 'Servir cafés expresso e salgados',
        funcoes: [
          'Moagem de grãos e extração de cafés expressos',
          'Aquecimento de salgados e montagem de balcão',
          'Atendimento cortês aos clientes e controle do caixa'
        ]
      },
      {
        id: 6, slug: 'lavador_carros', nome: '🚗 Lavador de Carros', desc: 'Lavar e encerar veículos de clientes',
        funcoes: [
          'Enxágue e lavagem com xampu automotivo na lataria',
          'Aspiração de estofados e limpeza dos vidros',
          'Aplicação de pretinho nos pneus e polimento final'
        ]
      },
      {
        id: 7, slug: 'panfleteiro', nome: '📜 Panfleteiro de Rua', desc: 'Distribuir panfletos comerciais',
        funcoes: [
          'Contagem e loteamento dos panfletos informativos',
          'Abordagem educada de pedestres no centro comercial',
          'Distribuição direta aos motoristas nos semáforos'
        ]
      },
    ]
  },

  // ── TIER 2: Nível 10+ (Intermediário) — Salários: 1.500 a 3.000 Prata (3 Funções Únicas) ─
  {
    tier: 2,
    nivelMin: 10,
    nomeTier: '🥈 Tier 2 — Empregos Intermediários',
    salarioMin: 1500,
    salarioMax: 3000,
    exigenciaTurnos: 20,
    cargos: [
      {
        id: 1, slug: 'vendedor_loja', nome: '🏪 Vendedor de Loja', desc: 'Atender clientes e bater metas de vendas',
        funcoes: [
          'Recepção dos clientes e sondagem de necessidades',
          'Demonstração das vantagens e qualidade do produto',
          'Fechamento de venda e registro no sistema da loja'
        ]
      },
      {
        id: 2, slug: 'mecanico_assist', nome: '🔧 Assistente de Mecânico', desc: 'Consertar motores e trocar óleo',
        funcoes: [
          'Drenagem e substituição do óleo do motor',
          'Troca de filtros de combustível e filtro de ar',
          'Checagem da calibragem e alinhamento de pneus'
        ]
      },
      {
        id: 3, slug: 'auxiliar_cozinha', nome: '🧑‍🍳 Auxiliar de Cozinha', desc: 'Preparar pratos em restaurantes',
        funcoes: [
          'Higienização e corte (mise en place) dos ingredientes',
          'Grelha de acompanhamentos e controle de temperatura',
          'Montagem rápida e envio dos pratos para garçons'
        ]
      },
      {
        id: 4, slug: 'telemarketing', nome: '📞 Atendente de Telemarketing', desc: 'Atendimento ao cliente e suporte',
        funcoes: [
          'Recepção de chamadas ativas e atendimento do protocolo',
          'Registro de solicitações no sistema de atendimento CRM',
          'Resolução de dúvidas e encaminhamento de chamados'
        ]
      },
      {
        id: 5, slug: 'motorista_app', nome: '🚖 Motorista de Aplicativo', desc: 'Transportar passageiros na cidade',
        funcoes: [
          'Aceitação e confirmação de chamadas no aplicativo',
          'Condução pela rota mais rápida sugerida no GPS',
          'Desembarque seguro do passageiro e encerramento'
        ]
      },
      {
        id: 6, slug: 'seguranca_eventos', nome: '🛡️ Segurança de Eventos', desc: 'Proteger shows e eventos fechados',
        funcoes: [
          'Checagem de credenciais e ingressos na portaria',
          'Revista preventiva de bolsas e pertences de acesso',
          'Monitoramento presencial e ronda durante o show'
        ]
      },
      {
        id: 7, slug: 'barbeiro', nome: '💇 Barbeiro / Cabeleireiro', desc: 'Realizar cortes e barbas modernos',
        funcoes: [
          'Consulta do estilo desejado com o cliente',
          'Execução do corte de cabelo na tesoura e máquina',
          'Acabamento com navalha e hidratação de barba'
        ]
      },
    ]
  },

  // ── TIER 3: Nível 25+ (Especializado) — Salários: 4.500 a 8.500 Prata (3 Funções Únicas) ─
  {
    tier: 3,
    nivelMin: 25,
    nomeTier: '🥇 Tier 3 — Empregos Especializados',
    salarioMin: 4500,
    salarioMax: 8500,
    exigenciaTurnos: 30,
    cargos: [
      {
        id: 1, slug: 'desenvolvedor_ti', nome: '💻 Desenvolvedor de Software', desc: 'Programar sistemas e resolver bugs',
        funcoes: [
          'Desenvolvimento de novos módulos em arquitetura limpa',
          'Execução de testes unitários e refatoração de código',
          'Correção de vulnerabilidades e bugs em produção'
        ]
      },
      {
        id: 2, slug: 'chef_cozinha', nome: '👨‍🍳 Chef de Cozinha', desc: 'Comandar equipe de alta gastronomia',
        funcoes: [
          'Criação e teste de novos pratos para o menu degustação',
          'Supervisão do ritmo de trabalho da brigada da cozinha',
          'Finalização e aprovação dos pratos antes de servir'
        ]
      },
      {
        id: 3, slug: 'mecanico_chefe', nome: '⚙️ Mecânico Chefe', desc: 'Diagnosticar e reparar veículos',
        funcoes: [
          'Diagnóstico computadorizado com scanner de injeção',
          'Retífica de componentes críticos e troca de correia',
          'Teste de rodagem e validação final de desempenho'
        ]
      },
      {
        id: 4, slug: 'fotografo_prof', nome: '📸 Fotógrafo Profissional', desc: 'Ensaios e cobertura de eventos',
        funcoes: [
          'Configuração de iluminação e ilhas de flash no estúdio',
          'Captura fotográfica do ensaio em alta resolução RAW',
          'Edição e tratamento de cores em software profissional'
        ]
      },
      {
        id: 5, slug: 'designer_grafico', nome: '🎨 Designer Gráfico', desc: 'Criar identidades visuais',
        funcoes: [
          'Criação do conceito de identidade visual da marca',
          'Vetorização de logotipos e paletas de cores',
          'Exportação de peças gráficas para mídia impressa e digital'
        ]
      },
      {
        id: 6, slug: 'personal_trainer', nome: '🏋️ Personal Trainer', desc: 'Treinos e acompanhamento físico',
        funcoes: [
          'Avaliação de composição corporal e bioimpedância',
          'Montagem do programa de treino personalizado',
          'Acompanhamento postural e correção de técnica do aluno'
        ]
      },
      {
        id: 7, slug: 'analista_financeiro', nome: '📊 Analista Financeiro', desc: 'Análise de investimentos e custos',
        funcoes: [
          'Consolidação do balanço mensal de receita e despesas',
          'Modelagem de viabilidade de novos investimentos',
          'Elaboração da projeção do fluxo de caixa corporativo'
        ]
      },
    ]
  },

  // ── TIER 4: Nível 45+ (Liderança/Gerência) — Salários: 10.000 a 18.000 Prata (3 Funções Gerenciais) ─
  {
    tier: 4,
    nivelMin: 45,
    nomeTier: '👔 Tier 4 — Liderança & Gerência (Multi-Funções)',
    salarioMin: 10000,
    salarioMax: 18000,
    exigenciaTurnos: 40,
    cargos: [
      {
        id: 1, slug: 'gerente_loja', nome: '👔 Gerente Geral de Loja', desc: 'Gerenciar equipes, estoque e vendas',
        funcoes: [
          '📊 Análise do balancete e metas diárias de vendas',
          '👥 Reunião de alinhamento com equipe comercial',
          '📦 Negociação direta de compras com fornecedores'
        ]
      },
      {
        id: 2, slug: 'engenheiro_civil', nome: '🏗️ Engenheiro Civil', desc: 'Supervisionar obras de infraestrutura',
        funcoes: [
          '📐 Vistoria técnica no canteiro de obras da estrutura',
          '👷 Gerenciamento das normas de segurança do trabalho',
          '📋 Assinatura de laudos técnicos de engenharia'
        ]
      },
      {
        id: 3, slug: 'medico_especialista', nome: '🩺 Médico Especialista', desc: 'Consultas e diagnósticos avançados',
        funcoes: [
          '🩺 Consultas médicas e diagnósticos de alta complexidade',
          '🔬 Análise minuciosa de tomografias e laudos',
          '💊 Prescrição médica de tratamentos específicos'
        ]
      },
      {
        id: 4, slug: 'advogado_senior', nome: '⚖️ Advogado Sênior', desc: 'Defesa de processos nos tribunais',
        funcoes: [
          '📜 Redação de petições judiciais de alta complexidade',
          '🏛️ Sustentação oral nas câmaras do tribunal de justiça',
          '🤝 Mediação presencial de acordos empresariais'
        ]
      },
      {
        id: 5, slug: 'diretor_producao', nome: '🎬 Diretor de Produção', desc: 'Comandar gravações e grandes projetos',
        funcoes: [
          '🎬 Aprovação do roteiro técnico e plano de filmagem',
          '🎥 Direção e alinhamento de equipe técnica no set',
          '🎞️ Supervisão do corte final na pós-produção'
        ]
      },
      {
        id: 6, slug: 'gerente_projetos', nome: '🚀 Gerente de Projetos (PM)', desc: 'Planejar cronogramas e entregas',
        funcoes: [
          '📅 Planejamento de sprints e matriz de entregas',
          '📊 Gestão de riscos e contingência do projeto',
          '💬 Apresentação de status e resultados aos clientes'
        ]
      },
      {
        id: 7, slug: 'piloto_comercial', nome: '✈️ Piloto Comercial', desc: 'Comandar voos internacionais',
        funcoes: [
          '🛫 Checagem pré-voo de sistemas e briefing da rota',
          '✈️ Pilotagem e navegação em voo internacional',
          '🛬 Pouso preciso e desembarque seguro dos passageiros'
        ]
      },
    ]
  },

  // ── TIER 5: Nível 70+ (Alta Executiva/Magnata) — Salários: 22.000 a 45.000 Prata (4 Funções Executivas!) ─
  {
    tier: 5,
    nivelMin: 70,
    nomeTier: '👑 Tier 5 — Alta Executiva & Magnatas (Multi-Funções)',
    salarioMin: 22000,
    salarioMax: 45000,
    exigenciaTurnos: 50,
    cargos: [
      {
        id: 1, slug: 'ceo_executivo', nome: '🏢 Diretor Executivo (CEO)', desc: 'Decisões estratégicas de multinacional',
        funcoes: [
          '📈 Aprovação da fusão estratégica com conglomerado rival',
          '💼 Reestruturação global do conselho diretivo',
          '💎 Lançamento de nova linha de negócios multinacional',
          '🏆 Homologação da distribuição de dividendos aos acionistas'
        ]
      },
      {
        id: 2, slug: 'investidor_anjo', nome: '💎 Investidor Anjo / VC', desc: 'Aportar capital em grandes negócios',
        funcoes: [
          '🔍 Triagem de pitches e modelos de negócio de startups',
          '💰 Aporte de capital semente em rodada de investimento',
          '📈 Mentoria executiva de aceleração de empreendedores',
          '💵 Realização de saída lucrativa (Exit) em IPO na bolsa'
        ]
      },
      {
        id: 3, slug: 'cirurgiao_chefe', nome: '🏥 Cirurgião Chefe', desc: 'Cirurgias de alta complexidade',
        funcoes: [
          '🏥 Coordenação da equipe multidisciplinar do bloco cirúrgico',
          '🩺 Realização de intervenção cirúrgica de alta precisão',
          '🔬 Supervisão direta do protocolo de UTI pós-operatório',
          '📑 Publicação de artigo científico em revista internacional'
        ]
      },
      {
        id: 4, slug: 'juiz_federal', nome: '🏛️ Juiz Federal', desc: 'Julgar casos de grande impacto',
        funcoes: [
          '🏛️ Presidência de audiências judiciais de repercussão nacional',
          '📜 Redação fundamentada de sentença em processo federal',
          '⚖️ Análise de recursos constitucionais em câmara superior',
          '🏛️ Deferimento de liminar de grande impacto público'
        ]
      },
      {
        id: 5, slug: 'socio_majoritario', nome: '👑 Sócio Majoritário', desc: 'Comandar conselhos e holding',
        funcoes: [
          '👑 Homologação do planejamento estratégico anual do grupo',
          '💼 Eleição e destituição da diretoria executiva',
          '💰 Acompanhamento e recolhimento de lucros e royalties',
          '🌐 Expansão de subsidiárias e Holdings no exterior'
        ]
      },
      {
        id: 6, slug: 'engenheiro_aeroespacial', nome: '🛸 Engenheiro Aeroespacial', desc: 'Projetar foguetes e satélites',
        funcoes: [
          '🛸 Teste estático de propulsão de motor de foguete',
          '🛰️ Calibração de sistemas de telemetria de satélite orbital',
          '📊 Simulação termodinâmica de reentrada atmosférica',
          '🚀 Lançamento bem-sucedido de veículo lançador ao espaço'
        ]
      },
      {
        id: 7, slug: 'magnata_bilionario', nome: '🏆 Magnata Bilionário', desc: 'Gerenciar império econômico',
        funcoes: [
          '🏆 Aquisição de novo conglomerado industrial multinacional',
          '✈️ Deslocamento internacional em jato executivo de grande porte',
          '💎 Inauguração de empreendimento imobiliário de altíssimo padrão',
          '📊 Fechamento do balanço anual com faturamento recorde'
        ]
      },
    ]
  }
];

// Mapeamentos rápidos
const CARGO_MAP = new Map();
const ALL_CARGOS = [];
for (const t of CATALGO_EMPREGOS) {
  for (const c of t.cargos) {
    const obj = { ...c, tierInfo: t };
    CARGO_MAP.set(c.slug, obj);
    ALL_CARGOS.push(obj);
  }
}

// ─── CONFIGURAÇÃO DE TEMPO (40min cooldown / 30min tolerância / 08:00 às 23:00 Brasília) ─

const HORARIO = {
  INICIO_MIN: 8 * 60,       // 08:00
  FIM_MIN:    23 * 60,      // 23:00
};

const TEMPO = {
  COOLDOWN_MS: 40 * 60 * 1000, // 40 minutos entre turnos
  JANELA_MS:   30 * 60 * 1000, // 30 minutos de tolerância
};
TEMPO.DEMISSAO_MS = TEMPO.COOLDOWN_MS + TEMPO.JANELA_MS; // 1h10min totais de expediente

const LABEL_COOLDOWN = '40min';
const LABEL_JANELA   = '30min';
const LABEL_HORARIO  = '08:00 às 23:00 (Brasília)';

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────

function getUserId(msg) {
  return msg?.key?.participant || msg?.key?.remoteJid || null;
}

function getGroupId(msg) {
  const jid = msg?.key?.remoteJid ?? '';
  return jid.endsWith('@g.us') ? jid : null;
}

async function reply(sock, jid, msg, texto) {
  return sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatMs(ms) {
  if (ms <= 0) return '0min';
  const totalMin = Math.ceil(ms / 60_000);
  const h        = Math.floor(totalMin / 60);
  const m        = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0)          return `${h}h`;
  return `${m}min`;
}

/**
 * Retorna os minutos desde meia-noite em Brasília (UTC-3).
 * Cálculo determinístico imune a locale de OS.
 */
function getMinutosBrasilia(ts = Date.now()) {
  const dateBrasilia = new Date(ts - 3 * 3600 * 1000);
  return dateBrasilia.getUTCHours() * 60 + dateBrasilia.getUTCMinutes();
}

/**
 * Verifica se agora está dentro do horário comercial (08:00 às 23:00 Brasília).
 */
function dentroDoHorario(ts = Date.now()) {
  const min = getMinutosBrasilia(ts);
  return min >= HORARIO.INICIO_MIN && min < HORARIO.FIM_MIN;
}

/**
 * Quantos ms faltam para abertura do expediente (08:00 Brasília).
 */
function msParaAbertura(ts = Date.now()) {
  const min      = getMinutosBrasilia(ts);
  const faltaMin = min < HORARIO.INICIO_MIN
    ? HORARIO.INICIO_MIN - min
    : (24 * 60 - min) + HORARIO.INICIO_MIN;
  return faltaMin * 60_000;
}

async function resolverContexto(sock, msg, jid) {
  const userIdRaw = getUserId(msg);
  const groupId   = getGroupId(msg);

  if (!userIdRaw) {
    await reply(sock, jid, msg, '⚠️ Não foi possível identificar seu usuário.');
    return null;
  }
  if (!groupId) {
    await reply(sock, jid, msg, '💼 *Os empregos são por grupo!*\n\nUse este comando dentro de um grupo.');
    return null;
  }

  const userId = resolverJidCarteira
    ? await resolverJidCarteira(userIdRaw, groupId)
    : userIdRaw;

  return { userId, groupId };
}

function filtro(userId, groupId) {
  return { idWhatsApp: userId, idGrupo: groupId };
}

// ─── CÁLCULO DE TEMPO FORA DO HORÁRIO (Congela tolerância à noite) ────────────

function calcularTempoForaHorario(desde, ate) {
  const PASSO = 60_000;
  const bruto = ate - desde;
  const HORAS_ABERTAS = HORARIO.FIM_MIN - HORARIO.INICIO_MIN; // minutos
  const FOLGA_DIA_MS  = (24 * 60 - HORAS_ABERTAS) * 60_000;
  const DIAS_MARGEM   = Math.ceil(bruto / (24 * 60 * 60_000)) + 1;
  const tetoFora      = FOLGA_DIA_MS * DIAS_MARGEM;

  if (bruto - tetoFora >= TEMPO.DEMISSAO_MS) {
    return tetoFora;
  }

  let fora   = 0;
  let cursor = desde;

  while (cursor < ate) {
    const min = getMinutosBrasilia(cursor);
    if (min < HORARIO.INICIO_MIN || min >= HORARIO.FIM_MIN) {
      fora += Math.min(PASSO, ate - cursor);
    }
    cursor += PASSO;
  }

  return fora;
}

function _msgForaHorario() {
  const falta = msParaAbertura();
  return (
    `🌙 *FORA DO HORÁRIO COMERCIAL*\n\n` +
    `Os empregos funcionam das *${LABEL_HORARIO}*.\n\n` +
    `⏰ Expediente abre em: *${formatMs(falta)}*\n` +
    `💡 _Seu tempo de tolerância está congelado até a abertura!_`
  );
}

// O sistema de emprego deste bot usa exclusivamente a carteira local.
// A carreira usa somente os dados locais deste bot.

function formatarVaga(vaga, carteira) {
  return `  *${vaga.id}.* ${vaga.name}\n` +
    `     💰 Salário: *${formatarSaldo(vaga.salaryMinCents, carteira)}–${formatarSaldo(vaga.salaryMaxCents, carteira)}*`;
}

// ─── !procuraremprego ─────────────

async function handleProcurarEmprego(sock, msg, jid, caption) {
  const ctx = await resolverContexto(sock, msg, jid);
  if (!ctx) return;
  const { userId, groupId } = ctx;

  if (!dentroDoHorario()) {
    return reply(sock, jid, msg, _msgForaHorario());
  }

  try {
    const carteira = await getCarteira(userId, groupId);
    const userLevel = CarteiraGrupo.levelFromXp(carteira?.xp ?? 0);

    // 1. Cooldown de demissão voluntária
    if (carteira.demissaoVoluntariaAte) {
      const bloqueio = new Date(carteira.demissaoVoluntariaAte).getTime();
      const falta    = bloqueio - Date.now();
      if (falta > 0) {
        return reply(sock, jid, msg,
          `⏳ *AGUARDE PARA SE REEMPREGAR*\n\n` +
          `Você pediu demissão recentemente.\n` +
          `Agência de empregos liberada em: *${formatMs(falta)}*\n\n` +
          `_Aguarde o processamento da sua saída voluntária._`
        );
      }
    }

    // 2. Histórico sujo
    if (carteira.historicoSujo && Math.random() >= 0.30) {
      return reply(sock, jid, msg,
        `📋 *HISTÓRICO SUJO DETECTADO*\n\n` +
        `Você foi demitido por justa causa anteriormente.\n` +
        `As empresas recusaram sua candidatura desta vez...\n\n` +
        `💡 Tente novamente! Você tem *30%* de chance de ser contratado.`
      );
    }

    // Encontra os tiers que o usuário possui nível para acessar
    const tiersLiberados = CATALGO_EMPREGOS.filter(t => userLevel >= t.nivelMin);
    const tierAtual      = tiersLiberados[tiersLiberados.length - 1] || CATALGO_EMPREGOS[0];

    // Trata argumento de escolha (ex: !procuraremprego 3 ou !procuraremprego entregador_pizza)
    const args = (caption || '').trim().split(/\s+/).slice(1);
    const escolhaArg = args[0] ? args[0].trim().toLowerCase() : null;

    // Se NÃO passou argumento -> exibe o painel de vagas com as 7 opções do seu nível!
    if (!escolhaArg) {
      const opcoesTexto = tierAtual.cargos.map(c =>
        `  *${c.id}.* ${c.nome}\n` +
        `     💰 Salário: *${formatarSaldo(tierAtual.salarioMin, carteira)}–${formatarSaldo(tierAtual.salarioMax, carteira)}*\n` +
        `     📝 _${c.desc}_`
      ).join('\n\n');

      return reply(sock, jid, msg,
        `🏢 *AGÊNCIA DE EMPREGOS — VAGAS DISPONÍVEIS*\n\n` +
        `📊 Seu Nível Atual: *Lv.${userLevel}*\n` +
        `🎖️ Categoria Liberada: *${tierAtual.nomeTier}*\n\n` +
        `👇 *ESCOLHA SEU NOVO EMPREGO (1 a 7):*\n\n` +
        `${opcoesTexto}\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💡 *COMO SE CANDIDATAR:*\n` +
        `Digite: *!procuraremprego <número>* (ex: *!procuraremprego 1*)`
      );
    }

    // Se passou argumento -> tenta contratar na vaga escolhida!
    let cargoEscolhido = null;
    const num = parseInt(escolhaArg, 10);

    if (!isNaN(num) && num >= 1 && num <= 7) {
      const vagaEscolhida = tierAtual.cargos[num - 1];
      cargoEscolhido = vagaEscolhida ? CARGO_MAP.get(vagaEscolhida.slug) : null;
    } else {
      cargoEscolhido = ALL_CARGOS.find(c => c.slug === escolhaArg || c.nome.toLowerCase().includes(escolhaArg));
    }

    if (!cargoEscolhido) {
      return reply(sock, jid, msg,
        `⚠️ Vaga inválida! Escolha um número de *1 a 7* referente às vagas disponíveis para o seu nível.\n\n` +
        `Digite apenas *!procuraremprego* para ver a lista.`
      );
    }

    // Verifica se possui nível mínimo para a vaga escolhida
    if (userLevel < cargoEscolhido.tierInfo.nivelMin) {
      return reply(sock, jid, msg,
        `⚠️ *NÍVEL INSUFICIENTE*\n\n` +
        `A vaga *${cargoEscolhido.nome}* exige Nível *${cargoEscolhido.tierInfo.nivelMin}+*.\n` +
        `Seu nível atual: *Lv.${userLevel}*.`
      );
    }

    // Contrata o usuário
    await CarteiraGrupo.findOneAndUpdate(
      filtro(userId, groupId),
      {
        $set: {
          empregoAtual:             cargoEscolhido.slug,
          totalTrabalhosComSucesso: 0,
          ultimoTrabalho:           null,
          historicoSujo:            false,
          demissaoVoluntariaAte:    null,
        },
      },
      { upsert: true }
    );

    const funcoesTexto = `📋 Funções sob sua responsabilidade (${cargoEscolhido.funcoes.length}):\n` +
      cargoEscolhido.funcoes.map((f, i) => `  ${i + 1}. ${f}`).join('\n');

    return reply(sock, jid, msg,
      `🎉 *PARABÉNS! VOCÊ FOI CONTRATADO!* 🎉\n\n` +
      `💼 Cargo: *${cargoEscolhido.nome}*\n` +
      `🏅 Categoria: *${cargoEscolhido.tierInfo.nomeTier}*\n` +
      `💰 Salário por turno: *${formatarSaldo(cargoEscolhido.tierInfo.salarioMin, carteira)}–${formatarSaldo(cargoEscolhido.tierInfo.salarioMax, carteira)}*\n\n` +
      `${funcoesTexto}\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `📋 Use *!trabalhar* ou *!work* para iniciar o turno!\n` +
      `⏰ Cooldown entre turnos: *${LABEL_COOLDOWN}*\n` +
      `⏱️ Tolerância para bater ponto: *${LABEL_JANELA}*\n` +
      `🕐 Horário comercial: *${LABEL_HORARIO}*`
    );

  } catch (e) {
    console.error('[Emprego] handleProcurarEmprego:', e);
    return reply(sock, jid, msg, '⚠️ Erro ao buscar vagas de emprego. Tente novamente.');
  }
}

// ─── !trabalhar / !work ───────────

async function handleTrabalhar(sock, msg, jid, caption = '') {
  const ctx = await resolverContexto(sock, msg, jid);
  if (!ctx) return;
  const { userId, groupId } = ctx;
  try {
    const carteira = await getCarteira(userId, groupId);
    if (!carteira.empregoAtual || carteira.empregoAtual === 'desempregado') {
      return reply(sock, jid, msg,
        `😴 *VOCÊ ESTÁ DESEMPREGADO!*\n\n` +
        `Use *!procuraremprego* para escolher um cargo e começar a trabalhar.`
      );
    }

    const cargo = CARGO_MAP.get(carteira.empregoAtual);
    if (!cargo) {
      await CarteiraGrupo.findOneAndUpdate(filtro(userId, groupId), { $set: { empregoAtual: null } });
      return reply(sock, jid, msg, `⚠️ Cargo inválido. Seu emprego foi resetado. Use *!procuraremprego* para se reempregar.`);
    }

    const agora          = Date.now();
    const ultimoTrabalho = carteira.ultimoTrabalho
      ? new Date(carteira.ultimoTrabalho).getTime()
      : null;

    if (!ultimoTrabalho) {
      if (!dentroDoHorario()) {
        return reply(sock, jid, msg, _msgForaHorario());
      }
      return _executarTurno(sock, msg, jid, userId, groupId, carteira, cargo, agora);
    }

    const tempoFora = calcularTempoForaHorario(ultimoTrabalho, agora);
    const decorridoEfetivo = (agora - ultimoTrabalho) - tempoFora;

    // Cooldown ativo (40 minutos)
    if (decorridoEfetivo < TEMPO.COOLDOWN_MS) {
      const falta = TEMPO.COOLDOWN_MS - decorridoEfetivo;
      return reply(sock, jid, msg,
        `⏳ *TURNO EM ANDAMENTO!*\n\n` +
        `💼 Cargo: *${cargo.nome}*\n` +
        `🕐 Próximo turno em: *${formatMs(falta)}* _(tempo comercial)_\n\n` +
        `💡 _Você possui ${LABEL_JANELA} de tolerância após o cooldown para bater o ponto._`
      );
    }

    // Cooldown passou, mas estamos fora do horário
    if (!dentroDoHorario()) {
      return reply(sock, jid, msg, _msgForaHorario());
    }

    // Justa causa por atraso excessivo durante horário comercial (após 40min + 30min tolerância)
    if (decorridoEfetivo >= TEMPO.DEMISSAO_MS) {
      await CarteiraGrupo.findOneAndUpdate(
        filtro(userId, groupId),
        {
          $set: {
            empregoAtual:             null,
            totalTrabalhosComSucesso: 0,
            historicoSujo:            true,
            ultimoTrabalho:           null,
          },
        }
      );

      return reply(sock, jid, msg,
        `🔴 *DEMITIDO POR JUSTA CAUSA!*\n\n` +
        `Você excedeu a janela de tolerância de *${LABEL_JANELA}* no horário comercial.\n\n` +
        `📋 *Consequências:*\n` +
        `  ❌ Cargo perdido: *${cargo.nome}*\n` +
        `  ⚠️ Histórico sujo ativado (30% de chance na próxima contratação)\n\n` +
        `Use *!procuraremprego* para tentar se reempregar.`
      );
    }

    return _executarTurno(sock, msg, jid, userId, groupId, carteira, cargo, agora);

  } catch (e) {
    console.error('[Emprego] handleTrabalhar:', e);
    return reply(sock, jid, msg, '⚠️ Erro ao processar turno. Tente novamente.');
  }
}

// ─── Executar turno com funções específicas do cargo ─────────────────────────

async function _executarTurno(sock, msg, jid, userId, groupId, carteira, cargo, agora) {
  const tierInfo  = cargo.tierInfo;
  const numFuncoes = cargo.funcoes.length;
  const salarioTotal = randInt(tierInfo.salarioMin, tierInfo.salarioMax);
  const sucessos     = (carteira.totalTrabalhosComSucesso ?? 0) + 1;

  await CarteiraGrupo.findOneAndUpdate(
    filtro(userId, groupId),
    {
      $set: { ultimoTrabalho: new Date(agora) },
      $inc: { totalTrabalhosComSucesso: 1 },
    }
  );

  const carteiraAtualizada = await alterarGold(userId, groupId, salarioTotal);

  const parcela = Math.floor(salarioTotal / numFuncoes);
  const detalheFuncoes = `\n📋 *FUNÇÕES DESEMPENHADAS NESTE TURNO (${numFuncoes}):*\n` +
    cargo.funcoes.map((f, i) => `  ${i + 1}. ${f} *(+${parcela} Prata)*`).join('\n') + '\n';

  const proximoTier = CATALGO_EMPREGOS.find(t => t.tier === tierInfo.tier + 1);
  let progressoTexto = '';

  if (proximoTier) {
    const faltam = Math.max(0, tierInfo.exigenciaTurnos - sucessos);
    const barsOn = Math.min(10, Math.floor((sucessos / tierInfo.exigenciaTurnos) * 10));
    const barra  = '█'.repeat(barsOn) + '░'.repeat(10 - barsOn);
    progressoTexto = faltam === 0
      ? `\n✅ *Promoção de Categoria disponível!* Use *!promocao*!`
      : `\n📈 Progresso na categoria: [${barra}] *${sucessos}/${tierInfo.exigenciaTurnos}* turnos para a próxima categoria (*${proximoTier.nomeTier}*)`;
  } else {
    progressoTexto = `\n🏆 _Você está na categoria máxima de empregos!_`;
  }

  return reply(sock, jid, msg,
    `✅ *TURNO DE TRABALHO CONCLUÍDO!* ✅\n\n` +
    `💼 Cargo: *${cargo.nome}*\n` +
    `🎖️ Categoria: *${tierInfo.nomeTier}*\n` +
    `${detalheFuncoes}\n` +
    `💰 *Salário Total Recebido:* *+${formatarSaldo(salarioTotal, carteiraAtualizada)}*\n` +
    `📊 Turnos no cargo atual: *${sucessos}*\n` +
    `⏰ Próximo turno em: *${LABEL_COOLDOWN}* _(horário comercial)_\n` +
    `⏱️ Janela de tolerância: *${LABEL_JANELA}*\n` +
    progressoTexto
  );
}

// ─── !promocao ────────────────────────────────────────────────────────────────

async function handlePromocao(sock, msg, jid) {
  const ctx = await resolverContexto(sock, msg, jid);
  if (!ctx) return;
  const { userId, groupId } = ctx;

  try {
    const carteira = await getCarteira(userId, groupId);
    if (!carteira.empregoAtual || carteira.empregoAtual === 'desempregado') {
      return reply(sock, jid, msg, `😴 *VOCÊ ESTÁ DESEMPREGADO!*\n\nUse *!procuraremprego* primeiro.`);
    }

    const cargoAtual = CARGO_MAP.get(carteira.empregoAtual);
    if (!cargoAtual) {
      return reply(sock, jid, msg, '⚠️ Cargo inválido. Use *!procuraremprego* para se reempregar.');
    }

    const tierInfo   = cargoAtual.tierInfo;
    const proximoTier = CATALGO_EMPREGOS.find(t => t.tier === tierInfo.tier + 1);

    if (!proximoTier) {
      return reply(sock, jid, msg,
        `🏆 *VOCÊ JÁ ESTÁ NA CATEGORIA MÁXIMA!*\n\n` +
        `Cargo: *${cargoAtual.nome}*\n\n` +
        `Você atingiu o topo do mercado de trabalho!`
      );
    }

    const userLevel = CarteiraGrupo.levelFromXp(carteira?.xp ?? 0);
    if (userLevel < proximoTier.nivelMin) {
      return reply(sock, jid, msg,
        `📋 *PROMOÇÃO INDISPONÍVEL*\n\n` +
        `A próxima categoria (*${proximoTier.nomeTier}*) exige Nível *${proximoTier.nivelMin}+*.\n` +
        `Seu nível atual: *Lv.${userLevel}*.\n\n` +
        `Ganhe mais XP no grupo para desbloquear!`
      );
    }

    const sucessos = carteira.totalTrabalhosComSucesso ?? 0;
    if (sucessos < tierInfo.exigenciaTurnos) {
      const faltam = tierInfo.exigenciaTurnos - sucessos;
      return reply(sock, jid, msg,
        `📋 *PROMOÇÃO INDISPONÍVEL*\n\n` +
        `Categoria Atual: *${tierInfo.nomeTier}*\n` +
        `✅ Turnos na categoria: *${sucessos}*\n` +
        `🎯 Exigência: *${tierInfo.exigenciaTurnos} turnos*\n` +
        `⏳ Faltam: *${faltam} turno(s)*\n\n` +
        `Continue usando *!trabalhar* para acumular turnos!`
      );
    }

    const vagasTexto = proximoTier.cargos.map(c => `  • *${c.id}.* ${c.nome}`).join('\n');

    return reply(sock, jid, msg,
      `🎊 *PARABÉNS! VOCÊ QUALIFICOU PARA PROMOÇÃO DE CATEGORIA!* 🎊\n\n` +
      `📤 Categoria anterior: *${tierInfo.nomeTier}*\n` +
      `📥 Nova categoria liberada: *${proximoTier.nomeTier}*\n\n` +
      `👇 *Vagas liberadas na nova categoria:*\n${vagasTexto}\n\n` +
      `Digite *!procuraremprego* para escolher sua nova vaga na categoria superior!`
    );

  } catch (e) {
    console.error('[Emprego] handlePromocao:', e);
    return reply(sock, jid, msg, '⚠️ Erro ao processar promoção! Tente novamente.');
  }
}

// ─── !emprego ─────────────────────────────────────────────────────────────────

async function handleEmprego(sock, msg, jid) {
  const ctx = await resolverContexto(sock, msg, jid);
  if (!ctx) return;
  const { userId, groupId } = ctx;

  try {
    const carteira = await getCarteira(userId, groupId);
    if (!carteira.empregoAtual || carteira.empregoAtual === 'desempregado') {
      return reply(sock, jid, msg,
        `😴 *VOCÊ ESTÁ DESEMPREGADO*\n\n` +
        `Use *!procuraremprego* para escolher um cargo entre as vagas disponíveis!`
      );
    }

    const cargo = CARGO_MAP.get(carteira.empregoAtual);
    if (!cargo) {
      await CarteiraGrupo.findOneAndUpdate(filtro(userId, groupId), { $set: { empregoAtual: null } });
      return reply(sock, jid, msg, `⚠️ Cargo inválido. Seu emprego foi resetado. Use *!procuraremprego* para escolher um novo.`);
    }

    const tierInfo   = cargo.tierInfo;
    const proximoTier = CATALGO_EMPREGOS.find(t => t.tier === tierInfo.tier + 1);
    const sucessos   = carteira.totalTrabalhosComSucesso ?? 0;
    const agora      = Date.now();
    const ultimoTs   = carteira.ultimoTrabalho ? new Date(carteira.ultimoTrabalho).getTime() : null;

    let statusTurno = dentroDoHorario()
      ? '🟢 Disponível para bater ponto!'
      : `🌙 Fora do horário comercial *(${LABEL_HORARIO})*`;

    if (ultimoTs) {
      const tempoFora = calcularTempoForaHorario(ultimoTs, agora);
      const decorrido = (agora - ultimoTs) - tempoFora;

      if (decorrido < TEMPO.COOLDOWN_MS) {
        const falta = TEMPO.COOLDOWN_MS - decorrido;
        statusTurno = `🟡 Próximo turno em *${formatMs(falta)}*`;
      } else if (decorrido < TEMPO.DEMISSAO_MS) {
        const janelaRestante = TEMPO.DEMISSAO_MS - decorrido;
        statusTurno = `🔴 *ATENÇÃO!* Janela de tolerância expira em *${formatMs(janelaRestante)}*!`;
      }
    }

    const funcoesTexto = `\n📋 *Funções do Cargo (${cargo.funcoes.length}):*\n` +
      cargo.funcoes.map((f, i) => `  ${i + 1}. ${f}`).join('\n');

    let texto =
      `💼 *SEU CARGO ATUAL NESTE GRUPO*\n\n` +
      `🏢 Cargo: *${cargo.nome}*\n` +
      `🎖️ Categoria: *${tierInfo.nomeTier}*\n` +
      `💰 Salário por turno: *${formatarSaldo(tierInfo.salarioMin, carteira)}–${formatarSaldo(tierInfo.salarioMax, carteira)}*\n` +
      `📊 Turnos concluídos nesta categoria: *${sucessos}*\n` +
      `📅 Status do expediente: ${statusTurno}\n` +
      funcoesTexto +
      `\n\n🕐 Horário: *${LABEL_HORARIO}*`;

    return reply(sock, jid, msg, texto);

  } catch (e) {
    console.error('[Emprego] handleEmprego:', e);
    return reply(sock, jid, msg, '⚠️ Erro ao carregar informações de emprego.');
  }
}

// ─── !demitir ─────────────────────────────────────────────────────────────────

async function handleDemitir(sock, msg, jid) {
  const ctx = await resolverContexto(sock, msg, jid);
  if (!ctx) return;
  const { userId, groupId } = ctx;

  try {
    const carteira = await getCarteira(userId, groupId);
    if (!carteira.empregoAtual || carteira.empregoAtual === 'desempregado') {
      return reply(sock, jid, msg, `😴 *VOCÊ JÁ ESTÁ DESEMPREGADO!*\n\nUse *!procuraremprego* para se candidatar.`);
    }

    const cargo = CARGO_MAP.get(carteira.empregoAtual);
    const bloqueioAte = new Date(Date.now() + 20 * 60 * 1000);

    await CarteiraGrupo.findOneAndUpdate(
      filtro(userId, groupId),
      {
        $set: {
          empregoAtual:             null,
          totalTrabalhosComSucesso: 0,
          ultimoTrabalho:           null,
          demissaoVoluntariaAte:    bloqueioAte,
        },
      }
    );

    return reply(sock, jid, msg,
      `👋 *VOCÊ PEDIU DEMISSÃO!* 👋\n\n` +
      `Cargo encerrado: *${cargo?.nome ?? carteira.empregoAtual}*\n\n` +
      `✅ Seu histórico permanece limpo (saída voluntária).\n` +
      `⏳ Agência de empregos liberada em *20 minutos*.\n\n` +
      `Use *!procuraremprego* após o cooldown para escolher outro cargo!`
    );

  } catch (e) {
    console.error('[Emprego] handleDemitir:', e);
    return reply(sock, jid, msg, '⚠️ Erro ao processar demissão voluntária.');
  }
}

// ─── !menuwork ────────────────────────────────────────────────────────────────

async function handleMenuWork(sock, msg, jid, getPrefix) {
  return require('../menus/trabalho').handleMenuWork(sock, msg, jid, getPrefix);
}

module.exports = {
  handleProcurarEmprego,
  handleTrabalhar,
  handlePromocao,
  handleEmprego,
  handleDemitir,
  handleMenuWork,
  CATALGO_EMPREGOS,
  CARGO_MAP,
};