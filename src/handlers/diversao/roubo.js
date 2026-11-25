'use strict';

const { formatarNumeroBR } = require('../../utils/numberFormat');

/**
 * Sistema de Roubo — Tico Bot
 * Comandos: !menuroubar, !roubar, !roubarbanco, !menusec, !equiparroubo, !equiparsec
 *           !buyroubo, !equiparroubarbanco, !invroubarbanco
 *           !meusitensroubo, !meussec, !meiosec, !comprarroubo, !comprarsec
 *
 * Toda a lógica é isolada por grupo via CarteiraGrupo.
 * Prata gerenciada exclusivamente pelo carteiraService.
 */

const path = require('path');
const CarteiraGrupo = require(path.join(__dirname, '..', '..', 'models', 'CarteiraGrupo'));
const LidMapping    = require(path.join(__dirname, '..', '..', 'models', 'LidMapping'));
const {
  getCarteira,
  alterarGold,
  alterarGoldSeguro,
  formatarSaldo,
} = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));
const { incrementMission } = require('./missoes');
const { normalizarJid, normalizarJidComDominio } = require(path.join(__dirname, '..', '..', 'utils', 'jid'));
const { resolveDisplayName, sameWhatsAppIdentity, getAlternateSenderJids } = require(path.join(__dirname, '..', '..', 'utils', 'identity'));
const { getWalletBalance } = require(path.join(__dirname, '..', '..', 'utils', 'carteira', 'wallet'));
const { resolverChaveCatalogo, extrairArgumentosComando } = require(path.join(__dirname, '..', '..', 'utils', 'commandItem'));

const { bloqueadoPorVinculo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira', 'vinculo'));

// ─── CONFIGURAÇÕES ────────────────────────────────────────────────────────────

const COOLDOWN_ROUBO_MS  = 15 * 60 * 1000; // 15 minutos entre tentativas
const COOLDOWN_PRESO_MS  = 2 * 60 * 60 * 1000; // 2 horas preso se falhar
const COOLDOWN_POLICIA_MS = 15 * 60 * 1000; // 15 min pra chamar polícia de novo
const JANELA_DENUNCIA_POLICIA_MS = 2 * 60 * 60 * 1000; // 2 horas após o roubo para chamar a polícia
const IMUNIDADE_ROUBO_MS  = 2 * 60 * 60 * 1000; // 2h de imunidade após ser roubado
const TAXA_SUCESSO_BASE  = 50;
const TAXA_MIN           = 10; // Todo ataque mantém uma chance mínima de sucesso, mesmo contra defesas fortes.
const TAXA_MAX           = 95;
const ROUBO_MIN_PCT      = 30;
const ROUBO_MAX_PCT      = 100;
const CHANCE_POLICIA     = 40; // % de chance de prender
const DEVOLUCAO_POLICIA  = 50; // % do gold roubado que a vítima recupera

// ─── CATÁLOGO — ITENS DE ATAQUE ───────────────────────────────────────────────

const ITENS_ROUBO = {
  mascara:    { nome: '🎭 Máscara',             codigo: 'mascara',  preco: 100, bonus: 10 },
  chave:      { nome: '🔧 Chave Inglesa',        codigo: 'chave',    preco: 150, bonus: 20 },
  lockpick:   { nome: '🔓 Kit de Arrombamento',  codigo: 'lockpick', preco: 200, bonus: 30 },
  corda:      { nome: '🪢 Corda Ninja',          codigo: 'corda',    preco: 250, bonus: 35 },
  dinamite:   { nome: '💣 Dinamite',             codigo: 'dinamite', preco: 300, bonus: 40 },
  disfarce:   { nome: '🕵️ Disfarce Premium',     codigo: 'disfarce', preco: 350, bonus: 45 },
  explorador: { nome: '📡 Detector de Alarmes',  codigo: 'radar',    preco: 400, bonus: 50 },
  cavador:    { nome: '⛏️ Picareta de Diamante', codigo: 'picareta', preco: 500, bonus: 60 },
};

const ITENS_ROUBO_BANCO = {
  macarico_cofre: { nome: '🔥 Maçarico para Cofre',        codigo: 'macarico', preco: 900,  bonus: 15 },
  furadeira:      { nome: '🛠️ Furadeira Industrial',      codigo: 'broca',     preco: 1500, bonus: 25 },
  clone_cartao:   { nome: '💳 Clonador de Cartões',        codigo: 'clone',     preco: 2400, bonus: 35 },
  pulso_emp:      { nome: '⚡ Pulso Eletromagnético',      codigo: 'pulso',     preco: 3800, bonus: 45 },
  tuneladora:     { nome: '🚜 Tuneladora de Alta Pressão', codigo: 'tunel',     preco: 6000, bonus: 60 },
};

// ─── CATÁLOGO — ITENS DE DEFESA ───────────────────────────────────────────────

const ITENS_SEGURANCA = {
  cofre:     { nome: '🔐 Cofre Forte',          codigo: 'cofre',   preco: 150, defesa: 15 },
  alarme:    { nome: '🚨 Sistema de Alarme',     codigo: 'alarme',  preco: 200, defesa: 25 },
  camera:    { nome: '📹 Câmera de Vigilância',  codigo: 'camera',  preco: 250, defesa: 30 },
  cachorro:  { nome: '🐕 Cão de Guarda',         codigo: 'cao',     preco: 300, defesa: 35 },
  seguranca: { nome: '👮 Guarda de Segurança',   codigo: 'guarda',  preco: 400, defesa: 45 },
  bunker:    { nome: '🛡️ Bunker Subterrâneo',   codigo: 'bunker',  preco: 500, defesa: 55 },
  laser:     { nome: '🔴 Raios Laser',           codigo: 'laser',   preco: 600, defesa: 65 },
  militares: { nome: '🪖 Segurança Militar',     codigo: 'tropa',   preco: 800, defesa: 70 },
  drones_taticos: { nome: '🚁 Enxame de Drones Táticos',      codigo: 'drone',   preco: 1200, defesa: 75 },
  equipe_elite:   { nome: '🦾 Equipe de Segurança de Elite',  codigo: 'elite',   preco: 2200, defesa: 78 },
  cofre_titanio:  { nome: '🏦 Cofre Blindado de Titânio',     codigo: 'titanio', preco: 4000, defesa: 82 },
  central_ia:     { nome: '🧠 Central de Segurança com IA',   codigo: 'central', preco: 7500, defesa: 85 },
};

function calcularTaxaSucessoRoubo(taxaBase, bonusAtaque, defesa = 0) {
  const taxaBruta = Number(taxaBase) + Number(bonusAtaque) - Number(defesa || 0);
  return Math.max(TAXA_MIN, Math.min(TAXA_MAX, taxaBruta));
}

const FALAS_VARIADAS = {
  compraRouboUso: [
    () => '⚠️ Informe a chave da ferramenta que deseja comprar. Exemplo: *!buyroubo dinamite*',
    () => '🛒 Qual ferramenta vai para o seu inventário? Use *!buyroubo <chave>*. Exemplo: *!buyroubo dinamite*',
    () => '🔎 Faltou a chave do item! Consulte *!menuroubar* e tente *!buyroubo <chave>*.'
  ],
  compraSecUso: [
    () => '⚠️ Informe a chave da defesa. Exemplo: *!buysec cofre*',
    () => '🛡️ Para comprar uma proteção, use *!buysec <chave>*. Veja as opções em *!menusec*.',
    () => '🔎 Não identifiquei qual defesa deseja. Exemplo: *!buysec alarme*.'
  ],
  itemNaoEncontrado: [
    ({ item, menu }) => `🔎 Não encontrei *${item}* nesta loja. Confira as opções em *!${menu}*.`,
    ({ item, menu }) => `📦 *${item}* não faz parte do catálogo disponível. Consulte *!${menu}* para ver as chaves válidas.`,
    ({ item, menu }) => `🤔 Essa chave (*${item}*) não corresponde a nenhum produto. Dê uma olhada em *!${menu}*.`
  ],
  saldoInsuficiente: [
    ({ preco, saldo, faltam, carteira }) => `💸 *Ainda falta um pouco para essa compra!*

💵 Preço: *${formatarSaldo(preco, carteira)}*
💰 Seu saldo: *${formatarSaldo(saldo, carteira)}*
🪙 Faltam: *${formatarSaldo(faltam, carteira)}*`,
    ({ preco, saldo, faltam, carteira }) => `🏷️ *Você não tem Pratas suficientes.*

Custo: *${formatarSaldo(preco, carteira)}*
Disponível: *${formatarSaldo(saldo, carteira)}*
Diferença: *${formatarSaldo(faltam, carteira)}*`,
    ({ preco, saldo, faltam, carteira }) => `🚫 Compra não concluída: seu saldo ainda não alcança o preço.

🛒 Valor do item: *${formatarSaldo(preco, carteira)}*
👛 Seu saldo: *${formatarSaldo(saldo, carteira)}*
📉 Necessário juntar mais: *${formatarSaldo(faltam, carteira)}*`
  ],
  compraErro: [
    () => '⚠️ A loja não conseguiu concluir a compra desta vez. Tente novamente.',
    () => '🧾 Houve uma falha ao processar o pagamento. Nenhuma nova tentativa foi feita; tente outra vez.',
    () => '🔧 O sistema de compras encontrou um problema. Aguarde um instante e tente novamente.'
  ],
  compraReembolsada: [
    () => '⚠️ O item não foi guardado no inventário. O valor da compra foi devolvido à sua carteira.',
    () => '🔄 A compra não pôde ser finalizada, mas o reembolso já foi realizado.',
    () => '📦 Não consegui entregar o item. Pode ficar tranquilo: o pagamento foi estornado.'
  ],
  compraFalhaCritica: [
    () => '🚨 O item não foi registrado e o reembolso automático também falhou. Não tente comprar novamente antes de contatar um administrador.',
    () => '🆘 Houve uma falha na entrega e na devolução das Pratas. Contacte um administrador para verificar a transação.',
    () => '⚠️ A compra ficou pendente: não foi possível guardar o item nem concluir o reembolso. Avise um administrador.'
  ],
  compraRouboSucesso: [
    ({ itemInfo, carteiraFinal }) => `✅ *Compra concluída!*

🔧 Ferramenta: ${itemInfo.nome}
💵 Preço: *${formatarNumeroBR(itemInfo.preco)} Pratas*
📈 Bônus: *+${itemInfo.bonus}%*
💎 Saldo restante: *${formatarSaldo(carteiraFinal.gold, carteiraFinal)}*

⚡ Para usar, equipe com *!equiparroubo ${itemInfo.codigo}*.`,
    ({ itemInfo, carteiraFinal }) => `🛍️ *Boa escolha! O item já é seu.*

🎭 ${itemInfo.nome}
🏷️ Pago: *${formatarNumeroBR(itemInfo.preco)} Pratas*
🎯 Bônus de sucesso: *+${itemInfo.bonus}%*
👛 Agora tem: *${formatarSaldo(carteiraFinal.gold, carteiraFinal)}*

Não se esqueça de equipar: *!equiparroubo ${itemInfo.codigo}*.`,
    ({ itemInfo, carteiraFinal }) => `📦 *Item adicionado ao inventário!*

Equipamento: ${itemInfo.nome}
Custo: *${formatarNumeroBR(itemInfo.preco)} Pratas*
Bônus: *+${itemInfo.bonus}%*
Saldo: *${formatarSaldo(carteiraFinal.gold, carteiraFinal)}*

Próximo passo: *!equiparroubo ${itemInfo.codigo}*.`
  ],
  compraSecSucesso: [
    ({ itemInfo, carteiraFinal }) => `✅ *Proteção comprada!*

🔐 ${itemInfo.nome}
💵 Preço: *${formatarSaldo(itemInfo.preco, carteiraFinal)}*
🛡️ Nível de defesa: *${itemInfo.defesa} pontos*
💎 Saldo restante: *${formatarSaldo(carteiraFinal.gold, carteiraFinal)}*

Ative com *!equiparsec ${itemInfo.codigo}*.`,
    ({ itemInfo, carteiraFinal }) => `🛡️ *Equipamento de segurança adquirido!*

Item: ${itemInfo.nome}
Nível defensivo: *${itemInfo.defesa} pontos*
Saldo atual: *${formatarSaldo(carteiraFinal.gold, carteiraFinal)}*

Use *!equiparsec ${itemInfo.codigo}* para o ativar.`,
    ({ itemInfo, carteiraFinal }) => `📦 A sua nova defesa já está no inventário!

🔒 ${itemInfo.nome}
Nível defensivo: *${itemInfo.defesa} pontos*
Carteira: *${formatarSaldo(carteiraFinal.gold, carteiraFinal)}*

Falta só ativá-la: *!equiparsec ${itemInfo.codigo}*.`
  ],
  equiparRouboUso: [
    () => '⚠️ Diga qual ferramenta deseja equipar. Exemplo: *!equiparroubo dinamite*.',
    () => '🎒 Preciso da chave do equipamento. Consulte *!menuroubar* e use *!equiparroubo <chave>*.',
    () => '🔧 Qual ferramenta vai usar? Envie a chave depois de *!equiparroubo*.'
  ],
  equiparSecUso: [
    () => '⚠️ Informe a defesa que deseja ativar. Exemplo: *!equiparsec cofre*.',
    () => '🛡️ Escolha uma chave do *!menusec* e envie *!equiparsec <chave>*.',
    () => '🔐 Não identifiquei a proteção. Exemplo: *!equiparsec alarme*.'
  ],
  itemNaoPossuido: [
    ({ itemInfo, comando }) => `🎒 Você ainda não tem *${itemInfo.nome}* no inventário deste grupo.

Compre primeiro com *!${comando} ${itemInfo.codigo}*.`,
    ({ itemInfo, comando }) => `📦 *${itemInfo.nome}* não aparece na sua mochila por aqui.

Pode adquiri-lo usando *!${comando} ${itemInfo.codigo}*.`,
    ({ itemInfo, comando }) => `🤷 Este equipamento ainda não é seu: *${itemInfo.nome}*.

Passe na loja e use *!${comando} ${itemInfo.codigo}* para o comprar.`
  ],
  equiparRouboSucesso: [
    ({ itemInfo, qtd, taxaRoubo, taxaBanco, ferramentaBanco, destino }) => `✅ *Ferramenta equipada!*

🎭 ${itemInfo.nome}
📈 Bônus: *+${itemInfo.bonus}%*
🎲 Chance no /roubar: até *${taxaRoubo}%*
${ferramentaBanco ? `🏦 Chance no /roubarbanco: até *${taxaBanco}%*\n` : ''}🎒 Quantidade no inventário: *${qtd}x*

🔫 Agora pode usar *${destino}*.`,
    ({ itemInfo, qtd, taxaRoubo, taxaBanco, ferramentaBanco, destino }) => `⚡ *Preparado para a ação!*

Equipamento: ${itemInfo.nome}
Bônus de sucesso: *+${itemInfo.bonus}%*
/roubar: até *${taxaRoubo}%*
${ferramentaBanco ? `/roubarbanco: até *${taxaBanco}%*\n` : ''}Restantes: *${qtd}x*

Alvo à vista? Use *${destino}*.`,
    ({ itemInfo, qtd, taxaRoubo, taxaBanco, ferramentaBanco, destino }) => `🧰 *Tudo pronto! Ferramenta selecionada.*

${itemInfo.nome}
Bônus: *+${itemInfo.bonus}%*
Probabilidade no /roubar: até *${taxaRoubo}%*
${ferramentaBanco ? `Probabilidade no /roubarbanco: até *${taxaBanco}%*\n` : ''}Stock disponível: *${qtd}x*

Próximo passo: *${destino}*.`
  ],
  equiparSecSucesso: [
    ({ itemInfo, qtd }) => `✅ *Defesa ativada!*

🔐 ${itemInfo.nome}
🛡️ Nível de defesa: *${itemInfo.defesa} pontos*
⚠️ Reduz a chance do roubo, mas não garante imunidade.
🎒 Quantidade: *${qtd}x*`,
    ({ itemInfo, qtd }) => `🧱 A sua segurança foi reforçada!

Item: ${itemInfo.nome}
Nível defensivo: *${itemInfo.defesa} pontos*
Mesmo assim, o ataque ainda pode funcionar.
No inventário: *${qtd}x*`,
    ({ itemInfo, qtd }) => `🛡️ *Protecção pronta para uso.*

Equipamento: ${itemInfo.nome}
Nível de defesa: *${itemInfo.defesa} pontos*
Nenhuma defesa bloqueia todos os ataques.
Stock: *${qtd}x*`
  ],
  roubarSemMencao: [
    () => '👀 Quem será a vítima? Mencione alguém: *!roubar @pessoa*.',
    () => '🎯 Faltou escolher o alvo. Marque a pessoa que pretende roubar com *!roubar @pessoa*.',
    () => '⚠️ O plano está pronto, mas não há alvo! Use *!roubar @pessoa*.'
  ],
  roubarProprio: [
    () => '😅 Tentar roubar a si próprio? Essa carteira está fora de alcance!',
    () => '🪞 Você não pode ser o ladrão e a vítima ao mesmo tempo.',
    () => '🚫 Operação cancelada: escolha outra pessoa, não a si próprio.'
  ],
  roubarSemFerramenta: [
    () => '🎒 Você está de mãos vazias! Compre uma ferramenta em *!menuroubar* e equipe-a com *!equiparroubo <chave>*.',
    () => '🔧 Sem equipamento, sem assalto. Consulte *!menuroubar*, compre uma ferramenta e equipe-a.',
    () => '🕵️ Antes de agir, prepare a mochila: use *!buyroubo <chave>* e depois *!equiparroubo <chave>*.'
  ],
  roubarSemEstoque: [
    ({ itemInfo }) => `📭 Acabaram as unidades de *${itemInfo.nome}*. Compre outra com *!buyroubo ${itemInfo.codigo}*.`,
    ({ itemInfo }) => `🗑️ Não restou nenhuma *${itemInfo.nome}* no seu inventário. Reponha em *!buyroubo ${itemInfo.codigo}*.`,
    ({ itemInfo }) => `⚠️ A ferramenta *${itemInfo.nome}* está esgotada! A loja vende mais com *!buyroubo ${itemInfo.codigo}*.`
  ],
  roubarBancoSemMencao: [
    () => '🏦 Indique quem tem o banco que pretende assaltar: *!roubarbanco @pessoa*.',
    () => '🎯 Falta marcar o titular do banco. Use *!roubarbanco @pessoa*.',
    () => '⚠️ Não há alvo selecionado para o assalto bancário. Mencione alguém.'
  ],
  roubarBancoProprio: [
    () => '🏦 O seu próprio banco está fora dos limites. Escolha outro alvo.',
    () => '😅 Assaltar o próprio banco não faz sentido. Marque outra pessoa.',
    () => '🚫 Não pode roubar o investimento de si próprio!'
  ],
  roubarBancoSemFerramenta: [
    () => '🏦 Falta uma ferramenta bancária! Compre uma na secção de assalto a banco do *!menuroubar* e equipe-a.',
    () => '🔧 As ferramentas comuns não servem para abrir cofres bancários. Equipe uma ferramenta da categoria *FERRAMENTAS PARA ASSALTO A BANCO*.',
    () => '📦 Para este comando é obrigatório ter uma ferramenta bancária equipada. Veja *!menuroubar* e use *!equiparroubo <chave>*.'
  ],
  roubarBancoSemEstoque: [
    ({ itemInfo }) => `🏦 O seu estoque de *${itemInfo.nome}* acabou. Compre outra unidade com *!buyroubo ${itemInfo.codigo}*.`,
    ({ itemInfo }) => `📭 Não há mais *${itemInfo.nome}* disponível no inventário. Reponha usando *!buyroubo ${itemInfo.codigo}*.`,
    ({ itemInfo }) => `⚠️ Ferramenta bancária esgotada: *${itemInfo.nome}*. A chave para comprar outra é *${itemInfo.codigo}*.`
  ],
  alvoImune: [
    ({ tempo }) => `🛡️ O alvo ainda está protegido! A imunidade termina dentro de *${tempo}*.`,
    ({ tempo }) => `⛔ Essa pessoa foi roubada há pouco e está sob proteção por mais *${tempo}*.`,
    ({ tempo }) => `🛡️ Segurança reforçada: não pode voltar a roubar esta pessoa durante *${tempo}*.`
  ],
  usuarioPreso: [
    ({ tempo }) => `🚔 Você continua atrás das grades. A liberdade chega dentro de *${tempo}*.`,
    ({ tempo }) => `🔒 A polícia ainda não o libertou. Aguarde mais *${tempo}*.`,
    ({ tempo }) => `👮 Sem fugas! Ainda faltam *${tempo}* para terminar a sua prisão.`
  ],
  cooldownRoubo: [
    ({ tempo, banco }) => `⏱️ A poeira ainda não assentou. Aguarde *${tempo}* antes de ${banco ? 'tentar outro assalto ao banco' : 'tentar roubar novamente'}.`,
    ({ tempo, banco }) => `🕒 Está a agir depressa demais! O próximo ${banco ? 'assalto bancário' : 'roubo'} só fica disponível em *${tempo}*.`,
    ({ tempo, banco }) => `⌛ Ainda está em recuperação. Volte a ${banco ? 'assaltar o banco' : 'roubar'} dentro de *${tempo}*.`
  ],
  roubarVitimaSemSaldo: [
    () => '💰 A carteira desta pessoa está vazia. Não há Pratas para levar neste grupo.',
    () => '📭 Parece que a vítima não tem saldo disponível para roubo.',
    () => '😶 Nada por aqui: a carteira do alvo não possui Pratas.'
  ],
  roubarBancoSemInvestimento: [
    () => '🏦 Esse banco não tem nenhum investimento ativo para ser roubado.',
    () => '📉 O alvo não mantém dinheiro investido no banco deste grupo.',
    () => '🔎 Não encontrei saldo aplicado no banco dessa pessoa.'
  ],
  inventarioRouboVazio: [
    () => '🎒 A sua mochila está vazia. Visite *!menuroubar* para começar a montar o equipamento.',
    () => '📦 Ainda não há ferramentas no seu inventário. Use *!buyroubo <chave>* para adquirir a primeira.',
    () => '🕸️ Nenhum equipamento por aqui! A loja *!menuroubar* tem o que precisa.'
  ],
  inventarioSecVazio: [
    () => '🔐 Ainda não tem proteções neste grupo. Veja as opções em *!menusec*.',
    () => '🛡️ O seu inventário de segurança está vazio. Passe pela loja com *!menusec*.',
    () => '📭 Nenhuma defesa guardada. Use *!buysec <chave>* para adquirir uma.'
  ],
  semDefesaAtiva: [
    () => '⚠️ Nenhuma proteção está ativa. Equipe uma com *!equiparsec <chave>*.',
    () => '🛡️ Está sem defesa equipada neste momento. Consulte *!menusec*.',
    () => '🔓 A sua segurança está desativada. Escolha uma defesa com *!equiparsec <chave>*.'
  ],
  policiaSemMencao: [
    () => '👮 Para denunciar, mencione quem o roubou: *!policia @ladrão*.',
    () => '🚨 Falta indicar o suspeito. Use *!policia @ladrão*.',
    () => '🔎 Quem deve ser denunciado? Marque o ladrão no comando *!policia*.'
  ],
  policiaPrazoExpirado: [
    () => '⌛ A denúncia não pode ser registrada. A polícia só aceita chamadas nos primeiros 15 minutos após o roubo.',
    () => '🚔 O prazo para denunciar já passou, ou esse jogador não corresponde ao último registro de roubo.',
    () => '📄 Não foi possível validar a denúncia. Confirme o ladrão e lembre-se: o limite é de 15 minutos.'
  ]
};

const ultimaFalaPorCategoria = new Map();

function sortearFala(chave, dados = {}, aleatorio = Math.random) {
  const variantes = FALAS_VARIADAS[chave];
  if (!Array.isArray(variantes) || variantes.length === 0) {
    throw new Error(`Conjunto de falas desconhecido: ${chave}`);
  }

  const obterIndice = () => {
    const sorteio = Number(aleatorio());
    return Math.min(
      variantes.length - 1,
      Math.max(0, Math.floor((Number.isFinite(sorteio) ? sorteio : 0) * variantes.length))
    );
  };

  let indice = obterIndice();
  const anterior = ultimaFalaPorCategoria.get(chave);
  if (variantes.length > 1 && indice === anterior) {
    const deslocamento = 1 + Math.floor(
      Math.max(0, Math.min(0.999999, Number(aleatorio()) || 0)) * (variantes.length - 1)
    );
    indice = (indice + deslocamento) % variantes.length;
  }

  ultimaFalaPorCategoria.set(chave, indice);
  return variantes[indice](dados);
}

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────

/** JID do remetente da mensagem (funciona em grupo e privado) — normalizado */
function getUserId(msg) {
  const raw = msg.key.participant || msg.key.remoteJid;
  return normalizarJid(raw) || raw;
}

/** JID do grupo (ou privado) onde a mensagem foi enviada */
function getGroupId(msg, jid) {
  // jid já vem do handler principal — é o remoteJid correto
  return jid;
}

/** Lê quantidade de item de um Map do Mongoose ou objeto plain */
function getItemQtd(mapaOuObj, chave) {
  if (!mapaOuObj) return 0;
  if (typeof mapaOuObj.get === 'function') return mapaOuObj.get(chave) ?? 0;
  return mapaOuObj[chave] ?? 0;
}

/**
 * Resolve a ferramenta ativa para o roubo normal.
 * O campo equiparoubo guarda a escolha atual de /roubar (inclusive uma
 * ferramenta bancária); equiparouboBanco continua independente para
 * /roubarbanco. Carteiras antigas sem a escolha atual usam o slot bancário.
 */
function selecionarFerramentaRoubo(carteira) {
  const slugAtivo = carteira?.equiparoubo;
  const catalogoAtivo = ITENS_ROUBO[slugAtivo]
    ? ITENS_ROUBO
    : ITENS_ROUBO_BANCO;
  const opcoes = [
    {
      slug: slugAtivo,
      catalogo: catalogoAtivo,
      inventario: ITENS_ROUBO[slugAtivo] ? 'itensRoubo' : 'itensRouboBanco',
      campoEquipado: 'equiparoubo',
    },
    {
      slug: carteira?.equiparouboBanco,
      catalogo: ITENS_ROUBO_BANCO,
      inventario: 'itensRouboBanco',
      campoEquipado: 'equiparouboBanco',
    },
  ].filter((opcao, index) =>
    opcao.slug
    && opcao.catalogo[opcao.slug]
    && (index === 0 || opcao.slug !== slugAtivo)
  );

  return opcoes.find(opcao => getItemQtd(carteira[opcao.inventario], opcao.slug) > 0)
    || opcoes[0]
    || null;
}

/** /roubarbanco aceita exclusivamente ferramentas do catálogo bancário. */
function selecionarFerramentaBanco(carteira) {
  const slug = carteira?.equiparouboBanco;
  const item = slug && ITENS_ROUBO_BANCO[slug];
  if (!item) return null;
  return { slug, item, inventario: 'itensRouboBanco' };
}

/** Resolve o código curto exibido nos menus; mantém nomes antigos por compatibilidade. */
function resolverChaveFerramenta(valor, catalogo) {
  const codigo = String(valor ?? '').trim().toLowerCase();
  if (!codigo || !catalogo || typeof catalogo !== 'object') return null;

  const correspondencias = Object.entries(catalogo)
    .filter(([, item]) => String(item?.codigo ?? '').toLowerCase() === codigo)
    .map(([chave]) => chave);
  const unicas = [...new Set(correspondencias)];
  if (unicas.length === 1) return unicas[0];
  if (unicas.length > 1) return null;

  return resolverChaveCatalogo(valor, catalogo);
}

/** Converte ms em string legível: "4min 32s" */
function formatarTempo(ms) {
  const totalSeg = Math.ceil(ms / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  if (min > 0 && seg > 0) return `${min}min ${seg}s`;
  if (min > 0) return `${min}min`;
  return `${seg}s`;
}

/**
 * Incrementa a quantidade de um item no Map (itensRoubo ou itensSec)
 * usando $inc sobre o campo correto no CarteiraGrupo.
 */
async function incrementarItem(idWhatsApp, idGrupo, campo, itemSlug, delta = 1) {
  const filtro = { idWhatsApp, idGrupo };

  // Guarda atômica: só decrementa se ainda houver estoque suficiente —
  // evita ir a negativo com chamadas concorrentes (ex.: cliques duplos
  // em !roubar/!roubarbanco quase simultâneos).
  if (delta < 0) {
    filtro[`${campo}.${itemSlug}`] = { $gte: -delta };
  }

  return CarteiraGrupo.findOneAndUpdate(
    filtro,
    { $inc: { [`${campo}.${itemSlug}`]: delta } },
    { upsert: delta > 0, new: true }
  );
  // Se delta < 0 e a guarda falhar, retorna null — os pontos de chamada já
  // relêem a carteira depois pra decidir se desequipam o slot, então uma
  // falha aqui só significa "nada mudou", sem quebrar o fluxo.
}

// ─── !menuroubar ──────────────────────────────────────────────────────────────

async function handleMenuRoubo(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';

  let texto =
`╔══════════════════════╗
     🎭 LOJA DE ROUBO
╚══════════════════════╝

🧰 *EQUIPAMENTOS DISPONÍVEIS*
`;

  for (const [key, item] of Object.entries(ITENS_ROUBO)) {
    texto += `  ▸ ${item.nome} — *${formatarSaldo(item.preco)}*\n`;
    texto += `     └ Bônus de sucesso: *+${item.bonus}%*\n`;
    texto += `     └ Chave: *${item.codigo}* — comprar: \`${P}buyroubo ${item.codigo}\` | equipar: \`${P}equiparroubo ${item.codigo}\`\n`;
  }

  texto += `\n🏦 *FERRAMENTAS PARA ASSALTO A BANCO*\n`;
  for (const [key, item] of Object.entries(ITENS_ROUBO_BANCO)) {
    texto += `  ▸ ${item.nome} — *${formatarSaldo(item.preco)}*\n`;
    texto += `     └ Bônus de sucesso: *+${item.bonus}%*\n`;
    texto += `     └ Chave: *${item.codigo}* — comprar: \`${P}buyroubo ${item.codigo}\` | equipar: \`${P}equiparroubo ${item.codigo}\`\n`;
  }

  texto += `
📜 *COMANDOS*
  ▸ ${P}buyroubo _(chave)_ — Comprar item/ferramenta
  ▸ ${P}equiparroubo _(chave)_ — Escolher a ferramenta ativa de roubo
  ▸ ${P}invroubo — Ver inventários de roubo e banco
  ▸ ${P}roubar @pessoa — Roubar alguém
  ▸ ${P}roubarbanco @pessoa — Assaltar o banco de alguém\r\n  ▸ ${P}policia @ladrão — tentar recuperar o que foi roubado

⚠️ *REGRAS*
  • É obrigatório equipar uma ferramenta antes de tentar roubar.
  • Ferramentas bancárias também funcionam no comando !roubar.
  • A ferramenta escolhida para !roubar não apaga a configuração própria de !roubarbanco.
  • A ferramenta é consumida a cada tentativa de roubo ou assalto ao banco.
  • Cooldown: *${formatarTempo(COOLDOWN_ROUBO_MS)}* entre tentativas
  • Taxa base de sucesso: *${TAXA_SUCESSO_BASE}%*

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── !menusec ─────────────────────────────────────────────────────────────────

async function handleMenuSec(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';

  let texto =
`╔══════════════════════╗
    🔐 LOJA DE SEGURANÇA
╚══════════════════════╝

🛡️ *EQUIPAMENTOS DE DEFESA*
`;

  for (const [key, item] of Object.entries(ITENS_SEGURANCA)) {
    texto += `  ▸ ${item.nome} — *${formatarSaldo(item.preco)}*\n`;
    texto += `     └ Defesa: *${item.defesa} pontos*\n`;
    texto += `     └ Chave: *${item.codigo}* — comprar: \`${P}buysec ${item.codigo}\` | equipar: \`${P}equiparsec ${item.codigo}\`\n`;
  }

  texto += `
📜 *COMANDOS*
  ▸ ${P}buysec _(chave)_ — Comprar item
  ▸ ${P}equiparsec _(chave)_ — Equipar defesa
  ▸ ${P}invsec — Ver inventário de segurança
  ▸ ${P}meiosec — Ver meio de segurança

⚠️ *ATENÇÃO*
  • A defesa reduz a chance, mas não a zera: até a Central com IA deixa pelo menos *${TAXA_MIN}%* de chance para o atacante.
  • Nenhum equipamento concede imunidade total.

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── !buyroubo ────────────────────────────────────────────────────────────────

async function handleComprarRoubo(sock, msg, jid, caption) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);
  const itemDigitado = extrairArgumentosComando(caption || '', 'buyroubo');
  const itemSlug = resolverChaveFerramenta(itemDigitado, { ...ITENS_ROUBO, ...ITENS_ROUBO_BANCO });
  if (!itemSlug) {
    await sock.sendMessage(jid, {
      text: sortearFala('compraRouboUso'),
    }, { quoted: msg });
    return;
  }
  const itemInfo = ITENS_ROUBO[itemSlug] || ITENS_ROUBO_BANCO[itemSlug];
  const campoInventario = ITENS_ROUBO[itemSlug] ? 'itensRoubo' : 'itensRouboBanco';
  if (!itemInfo) {
    await sock.sendMessage(jid, {
      text: sortearFala('itemNaoEncontrado', { item: itemSlug, menu: 'menuroubar' }),
    }, { quoted: msg });
    return;
  }

  // Débito atômico: debita o valor exato apenas se o saldo for suficiente.
  try {
    await alterarGold(userId, idGrupo, -itemInfo.preco, `Compra: ${itemInfo.nome}`);
  } catch (e) {
    if (e instanceof RangeError) {
      const carteira = await getCarteira(userId, idGrupo);
      const saldo    = carteira.gold ?? 0;
      const faltam   = Math.max(0, itemInfo.preco - saldo);
      await sock.sendMessage(jid, {
        text: sortearFala('saldoInsuficiente', { preco: itemInfo.preco, saldo, faltam, carteira }),
      }, { quoted: msg });
      return;
    }
    console.error('Erro ao debitar gold (buyroubo):', e.message);
    await sock.sendMessage(jid, {
      text: sortearFala('compraErro'),
    }, { quoted: msg });
    return;
  }

  try {
    await incrementarItem(userId, idGrupo, campoInventario, itemSlug);
  } catch (e) {
    console.error('Erro ao registrar item de roubo, reembolsando:', e.message);
    try {
      await alterarGold(userId, idGrupo, itemInfo.preco, `Reembolso: ${itemInfo.nome}`);
      await sock.sendMessage(jid, {
        text: sortearFala('compraReembolsada'),
      }, { quoted: msg });
    } catch (refundErr) {
      console.error('FALHA CRÍTICA: reembolso também falhou (buyroubo):', refundErr.message);
      await sock.sendMessage(jid, {
        text: sortearFala('compraFalhaCritica'),
      }, { quoted: msg });
    }
    return;
  }

  const carteiraFinal = await getCarteira(userId, idGrupo);

  await sock.sendMessage(jid, {
    text: sortearFala('compraRouboSucesso', { itemInfo, carteiraFinal }),
  }, { quoted: msg });
}

// ─── !buysec ──────────────────────────────────────────────────────────────────

async function handleComprarSec(sock, msg, jid, caption) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);
  const itemDigitado = extrairArgumentosComando(caption || '', 'buysec');
  const itemSlug = resolverChaveFerramenta(itemDigitado, ITENS_SEGURANCA);
  if (!itemSlug) {
    await sock.sendMessage(jid, {
      text: sortearFala('compraSecUso'),
    }, { quoted: msg });
    return;
  }
  const itemInfo = ITENS_SEGURANCA[itemSlug];
  if (!itemInfo) {
    await sock.sendMessage(jid, {
      text: sortearFala('itemNaoEncontrado', { item: itemSlug, menu: 'menusec' }),
    }, { quoted: msg });
    return;
  }

  // Débito atômico: debita o valor exato apenas se o saldo for suficiente.
  try {
    await alterarGold(userId, idGrupo, -itemInfo.preco, `Compra: ${itemInfo.nome}`);
  } catch (e) {
    if (e instanceof RangeError) {
      const carteira = await getCarteira(userId, idGrupo);
      const saldo    = carteira.gold ?? 0;
      const faltam   = Math.max(0, itemInfo.preco - saldo);
      await sock.sendMessage(jid, {
        text: sortearFala('saldoInsuficiente', { preco: itemInfo.preco, saldo, faltam, carteira }),
      }, { quoted: msg });
      return;
    }
    console.error('Erro ao debitar gold (buysec):', e.message);
    await sock.sendMessage(jid, {
      text: sortearFala('compraErro'),
    }, { quoted: msg });
    return;
  }

  try {
    await incrementarItem(userId, idGrupo, 'itensSec', itemSlug);
  } catch (e) {
    console.error('Erro ao registrar item de segurança, reembolsando:', e.message);
    try {
      await alterarGold(userId, idGrupo, itemInfo.preco, `Reembolso: ${itemInfo.nome}`);
      await sock.sendMessage(jid, {
        text: sortearFala('compraReembolsada'),
      }, { quoted: msg });
    } catch (refundErr) {
      console.error('FALHA CRÍTICA: reembolso também falhou (buysec):', refundErr.message);
      await sock.sendMessage(jid, {
        text: sortearFala('compraFalhaCritica'),
      }, { quoted: msg });
    }
    return;
  }

  const carteiraFinal = await getCarteira(userId, idGrupo);

  await sock.sendMessage(jid, {
    text: sortearFala('compraSecSucesso', { itemInfo, carteiraFinal }),
  }, { quoted: msg });
}

// ─── !equiparroubo ─────────────────────────────────────────────────────────────
async function handleEquiparRoubo(sock, msg, jid, caption) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);
  const itemDigitado = extrairArgumentosComando(caption || '', 'equiparroubo');
  const itemSlug = resolverChaveFerramenta(itemDigitado, { ...ITENS_ROUBO, ...ITENS_ROUBO_BANCO });

  if (!itemSlug) {
    await sock.sendMessage(jid, {
      text: sortearFala('equiparRouboUso'),
    }, { quoted: msg });
    return;
  }
  const itemInfo = ITENS_ROUBO[itemSlug] || ITENS_ROUBO_BANCO[itemSlug];
  const ferramentaBanco = Boolean(ITENS_ROUBO_BANCO[itemSlug]);
  const campoInventario = ferramentaBanco ? 'itensRouboBanco' : 'itensRoubo';
  const campoEquipado = ferramentaBanco ? 'equiparouboBanco' : 'equiparoubo';

  if (!itemInfo) {
    await sock.sendMessage(jid, {
      text: sortearFala('itemNaoEncontrado', { item: itemSlug, menu: 'menuroubar' }),
    }, { quoted: msg });
    return;
  }

  const carteira = await getCarteira(userId, idGrupo);
  const qtd = getItemQtd(carteira[campoInventario], itemSlug);

  if (qtd <= 0) {
    await sock.sendMessage(jid, {
      text: sortearFala('itemNaoPossuido', { itemInfo, comando: 'buyroubo' }),
    }, { quoted: msg });
    return;
  }

  const camposEquipados = { [campoEquipado]: itemSlug };
  // Ferramenta bancária passa a ser também a escolha ativa de /roubar,
  // mas mantém seu próprio slot para continuar disponível em /roubarbanco.
  if (ferramentaBanco) camposEquipados.equiparoubo = itemSlug;

  await CarteiraGrupo.findOneAndUpdate(
    { idWhatsApp: userId, idGrupo },
    { $set: camposEquipados }
  );

  const taxaRoubo = Math.min(TAXA_MAX, TAXA_SUCESSO_BASE + itemInfo.bonus);
  const taxaBanco = Math.min(TAXA_MAX, TAXA_SUCESSO_BASE_BANCO + itemInfo.bonus);
  const destino = ferramentaBanco
    ? '!roubar @pessoa ou !roubarbanco @pessoa'
    : '!roubar @pessoa';

  await sock.sendMessage(jid, {
    text: sortearFala('equiparRouboSucesso', { itemInfo, qtd, taxaRoubo, taxaBanco, ferramentaBanco, destino }),
  }, { quoted: msg });
}

// ─── !equiparsec ──────────────────────────────────────────────────────────────

async function handleEquiparSec(sock, msg, jid, caption) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);
  const itemDigitado = extrairArgumentosComando(caption || '', 'equiparsec');
  const itemSlug = resolverChaveFerramenta(itemDigitado, ITENS_SEGURANCA);

  if (!itemSlug) {
    await sock.sendMessage(jid, {
      text: sortearFala('equiparSecUso'),
    }, { quoted: msg });
    return;
  }
  const itemInfo = ITENS_SEGURANCA[itemSlug];

  if (!itemInfo) {
    await sock.sendMessage(jid, {
      text: sortearFala('itemNaoEncontrado', { item: itemSlug, menu: 'menusec' }),
    }, { quoted: msg });
    return;
  }

  const carteira = await getCarteira(userId, idGrupo);
  const qtd      = getItemQtd(carteira.itensSec, itemSlug);

  if (qtd <= 0) {
    await sock.sendMessage(jid, {
      text: sortearFala('itemNaoPossuido', { itemInfo, comando: 'buysec' }),
    }, { quoted: msg });
    return;
  }

  await CarteiraGrupo.findOneAndUpdate(
    { idWhatsApp: userId, idGrupo },
    { $set: { equiparsec: itemSlug } }
  );

  await sock.sendMessage(jid, {
    text: sortearFala('equiparSecSucesso', { itemInfo, qtd }),
  }, { quoted: msg });
}

// ─── !invroubo ────────────────────────────────────────────────────────────────

async function handleInvRoubo(sock, msg, jid) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);

  const carteira = await getCarteira(userId, idGrupo);
  const secoes = [
    {
      titulo: '🎭 ITENS PARA ROUBO COMUM',
      catalogo: ITENS_ROUBO,
      inventario: carteira.itensRoubo,
      equipado: carteira.equiparoubo,
      taxaBase: TAXA_SUCESSO_BASE,
    },
    {
      titulo: '🏦 FERRAMENTAS PARA ASSALTO A BANCO',
      catalogo: ITENS_ROUBO_BANCO,
      inventario: carteira.itensRouboBanco,
      equipado: carteira.equiparouboBanco,
      taxaBase: TAXA_SUCESSO_BASE_BANCO,
    },
  ];
  let texto = `🎒 ═══ SEUS ITENS DE ROUBO ═══ 🎒\n\n`;
  let possuiItens = false;

  for (const secao of secoes) {
    texto += `*${secao.titulo}*\n`;
    let possuiNaSecao = false;

    for (const [key, item] of Object.entries(secao.catalogo)) {
      const qtd = getItemQtd(secao.inventario, key);
      if (qtd > 0) {
        possuiItens = true;
        possuiNaSecao = true;
        const tag = secao.equipado === key ? ' ⚡ *EQUIPADO*' : '';
        texto += `  ${item.nome}${tag}\n`;
        texto += `    └ Chave: *${item.codigo}* | Qtd: *${qtd}x* | Bônus: *+${item.bonus}%*\n`;
      }
    }

    if (!possuiNaSecao) {
      texto += `_Nenhum item nesta categoria._\n`;
    } else {
      const itemEquipado = secao.equipado && secao.catalogo[secao.equipado];
      if (itemEquipado) {
        const taxaAtual = Math.min(TAXA_MAX, secao.taxaBase + itemEquipado.bonus);
        texto += `📈 Bônus ativo: *+${itemEquipado.bonus}%* | Chance antes da defesa: *${taxaAtual}%*\n`;
      } else {
        texto += `⚠️ Nenhum item desta categoria equipado.\n`;
      }
    }
    texto += `\n━━━━━━━━━━━━━━━━\n\n`;
  }

  if (!possuiItens) {
    texto += sortearFala('inventarioRouboVazio');
  } else {
    texto += `Use *!equiparroubo <chave>* para escolher o equipamento de cada categoria.`;
  }

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── !invsec ──────────────────────────────────────────────────────────────────

async function handleInvSec(sock, msg, jid) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);

  const carteira = await getCarteira(userId, idGrupo);

  let texto   = `🔐 ═══ SEUS ITENS DE SEGURANÇA ═══ 🔐\n\n`;
  let temItem = false;

  for (const [key, item] of Object.entries(ITENS_SEGURANCA)) {
    const qtd = getItemQtd(carteira.itensSec, key);
    if (qtd > 0) {
      temItem = true;
      const ativo = carteira.equiparsec === key;
      const tag = ativo ? ' ⚡ *ATIVO*' : '';
      texto += `  ${item.nome}${tag}\n`;
      texto += `    └ Chave: *${item.codigo}* | Qtd: *${qtd}x* | Defesa: *${item.defesa} pts*\n`;
    }
  }

  if (!temItem) {
    texto += `${sortearFala('inventarioSecVazio')}\n\n`;
    texto += `🛒 Use *!menusec* para consultar a loja.`;
  } else {
    texto += `\n━━━━━━━━━━━━━━━━\n`;

    const eqKey = carteira.equiparsec;
    const eq    = eqKey && ITENS_SEGURANCA[eqKey];

    if (eq) {
      texto += `⚡ *Ativo:* ${eq.nome} (chave: *${eq.codigo}*)\n`;
      texto += `🛡️ *Nível de defesa:* ${eq.defesa} pontos\n`;
      texto += `⚠️ A defesa reduz a chance do roubo, mas não o impede completamente.`;
    } else {
      texto += sortearFala('semDefesaAtiva');
    }
  }

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── !meiosec ─────────────────────────────────────────────────────────────────

async function handleMeioSec(sock, msg, jid) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);

  const carteira = await getCarteira(userId, idGrupo);

  let texto = `🛡️ ═══ SUAS DEFESAS ATIVAS ═══ 🛡️\n\n`;

  const eq = carteira.equiparsec && ITENS_SEGURANCA[carteira.equiparsec];
  if (eq) {
    texto += `✅ *Defesa equipada:* ${eq.nome} (chave: *${eq.codigo}*)\n`;
    texto += `🛡️ *Nível de defesa:* ${eq.defesa} pontos\n\n`;
    texto += `━━━━━━━━━━━━━━━━\n`;
    texto += `📊 *Como funciona:*\n`;
    texto += `  • Os pontos de defesa reduzem a chance de sucesso do ataque.\n`;
    texto += `  • O atacante ainda mantém pelo menos *${TAXA_MIN}%* de chance de sucesso.\n`;
    texto += `  • A Central com IA é a melhor proteção, mas não torna ninguém invulnerável.\n\n`;
    texto += `🔄 Troque com *!equiparsec <chave>*`;
  } else {
    texto += `${sortearFala('semDefesaAtiva')}\n`;
    texto += `⚠️ Sem defesa, o roubo usa a chance-base de *${TAXA_SUCESSO_BASE}%*, antes dos bônus do atacante.\n`;
    texto += `🛒 Consulte *!menusec* para escolher uma proteção.`;
  }

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── !roubar @pessoa ──────────────────────────────────────────────────────────

async function handleRoubar(sock, msg, jid) {
  const atacanteId  = getUserId(msg);
  const vitimaIdRaw = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const vitimaId    = vitimaIdRaw ? (normalizarJid(vitimaIdRaw) || vitimaIdRaw) : null;
  const idGrupo     = getGroupId(msg, jid);

  // ── Validações básicas ───────────────────────────────────────────────────────
  if (!vitimaId) {
    await sock.sendMessage(jid, {
      text: sortearFala('roubarSemMencao'),
    }, { quoted: msg });
    return;
  }

  if (atacanteId === vitimaId) {
    await sock.sendMessage(jid, { text: sortearFala('roubarProprio') }, { quoted: msg });
    return;
  }
  // ── Buscar carteiras em paralelo ─────────────────────────────────────────────
  const [carteiraAtacante, carteiraVitima] = await Promise.all([
    getCarteira(atacanteId, idGrupo),
    getCarteira(vitimaId,   idGrupo),
  ]);

  // ── Item equipado obrigatório (aceita ferramentas comuns e bancárias) ────────
  const ferramentaAtaque = selecionarFerramentaRoubo(carteiraAtacante);

  if (!ferramentaAtaque) {
    await sock.sendMessage(jid, {
      text: sortearFala('roubarSemFerramenta'),
    }, { quoted: msg });
    return;
  }

  const {
    slug: itemSlugAtaque,
    inventario: campoInventarioAtaque,
    campoEquipado: campoEquipadoAtaque,
  } = ferramentaAtaque;
  const itemAtaque = ferramentaAtaque.catalogo[itemSlugAtaque];
  const qtdItemAtaque = getItemQtd(carteiraAtacante[campoInventarioAtaque], itemSlugAtaque);

  if (qtdItemAtaque <= 0) {
    await sock.sendMessage(jid, {
      text: sortearFala('roubarSemEstoque', { itemInfo: itemAtaque }),
    }, { quoted: msg });
    return;
  }

  // ── Cooldown / Preso ──────────────────────────────────────────────────────────
  const agora = Date.now();

  // Verifica se está preso
  const prestoAte = carteiraAtacante.prestoAte
    ? new Date(carteiraAtacante.prestoAte).getTime()
    : 0;
  if (agora < prestoAte) {
    const restante = prestoAte - agora;
    await sock.sendMessage(jid, {
      text: sortearFala('usuarioPreso', { tempo: formatarTempo(restante) }),
    }, { quoted: msg });
    return;
  }

  // Verifica cooldown normal entre tentativas
  const ultimoRoubo  = carteiraAtacante.ultimoRoubo
    ? new Date(carteiraAtacante.ultimoRoubo).getTime()
    : 0;
  const tempoPassado = agora - ultimoRoubo;

  if (tempoPassado < COOLDOWN_ROUBO_MS) {
    const restante = COOLDOWN_ROUBO_MS - tempoPassado;
    await sock.sendMessage(jid, {
      text: sortearFala('cooldownRoubo', { tempo: formatarTempo(restante), banco: false }),
    }, { quoted: msg });
    return;
  }

  // ── Verificar imunidade da vítima ────────────────────────────────────────
  const imunidadeAte = _tsOuZero(carteiraVitima.imunidadeRouboAte);
  if (agora < imunidadeAte) {
    const restante = imunidadeAte - agora;
    await sock.sendMessage(jid, {
      text: sortearFala('alvoImune', { tempo: formatarTempo(restante) }),
    }, { quoted: msg });
    return;
  }

  // ── Verificar saldo da vítima ────────────────────────────────────────────
  const saldoVitima = carteiraVitima.gold ?? 0;
  if (saldoVitima <= 0) {
    await sock.sendMessage(jid, {
      text: sortearFala('roubarVitimaSemSaldo'),
    }, { quoted: msg });
    return;
  }

  // ── Registrar cooldown ANTES da tentativa ────────────────────────────────────
  // (o cooldown consome mesmo se o roubo falhar — custo da tentativa)
  await CarteiraGrupo.findOneAndUpdate(
    { _id: carteiraAtacante._id },
    { $set: { ultimoRoubo: new Date() } }
  );

  // ── Calcular taxa de sucesso ─────────────────────────────────────────────────
  const itemDefesaSlug = carteiraVitima.equiparsec;
  const itemDefesa     = itemDefesaSlug && ITENS_SEGURANCA[itemDefesaSlug];
  const taxaSucesso = calcularTaxaSucessoRoubo(
    TAXA_SUCESSO_BASE,
    itemAtaque.bonus,
    itemDefesa?.defesa ?? 0
  );

  const rolagem = Math.random() * 100;
  const sucesso = rolagem < taxaSucesso;

  // ── Montar resposta ──────────────────────────────────────────────────────────
  let textoResposta =
    `🎭 ═══ TENTATIVA DE ROUBO! ═══ 🎭\n\n` +
    `🔫 *Arma:* ${itemAtaque.nome}\n`;

  if (itemDefesa) {
    textoResposta += `🛡️ *Defesa da vítima:* ${itemDefesa.nome}\n`;
  }

  textoResposta +=
    `🎲 *Rolagem:* ${rolagem.toFixed(1)} / ${taxaSucesso}% necessário\n` +
    `━━━━━━━━━━━━━━━━\n`;

  // ── Consumir item de ataque (sempre, independente do resultado) ──────────
  // Reaproveita o documento retornado pelo próprio decremento — evita um
  // round-trip extra ao banco só para checar se o estoque zerou.
  const carteiraAtacanteAtualizada = await incrementarItem(
    atacanteId, idGrupo, campoInventarioAtaque, itemSlugAtaque, -1
  );
  const qtdItemAtaqueRestante = carteiraAtacanteAtualizada
    ? getItemQtd(carteiraAtacanteAtualizada[campoInventarioAtaque], itemSlugAtaque)
    : Math.max(0, getItemQtd(carteiraAtacante[campoInventarioAtaque], itemSlugAtaque) - 1); // fallback se a guarda atômica bloqueou

  // ── Consumir item de defesa da vítima (se houver, sempre) ────────────────
  if (itemDefesa) {
    const carteiraVitAtualizada = await incrementarItem(vitimaId, idGrupo, 'itensSec', itemDefesaSlug, -1);
    const qtdDefesaRestante = carteiraVitAtualizada
      ? getItemQtd(carteiraVitAtualizada.itensSec, itemDefesaSlug)
      : Math.max(0, getItemQtd(carteiraVitima.itensSec, itemDefesaSlug) - 1);

    if (qtdDefesaRestante <= 0) {
      await CarteiraGrupo.findOneAndUpdate(
        { idWhatsApp: vitimaId, idGrupo },
        { $unset: { equiparsec: '' } }
      );
    }
  }

  if (qtdItemAtaqueRestante <= 0) {
    const camposParaLimpar = {};
    if (carteiraAtacante.equiparoubo === itemSlugAtaque) {
      camposParaLimpar.equiparoubo = '';
    }
    if (carteiraAtacante.equiparouboBanco === itemSlugAtaque) {
      camposParaLimpar.equiparouboBanco = '';
    }
    if (Object.keys(camposParaLimpar).length === 0) {
      camposParaLimpar[campoEquipadoAtaque] = '';
    }

    await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp: atacanteId, idGrupo },
      { $unset: camposParaLimpar }
    );
  }

  if (sucesso) {
    // ── Roubo bem-sucedido ──────────────────────────────────────────────────
    const pct          = Math.floor(Math.random() * (ROUBO_MAX_PCT - ROUBO_MIN_PCT + 1)) + ROUBO_MIN_PCT;
    const ouroRoubado  = Math.max(1, Math.floor(saldoVitima * pct / 100));

    const { debitado, carteira: carteiraVitimaAtualizada } = await alterarGoldSeguro(
      vitimaId, idGrupo, -ouroRoubado, `Roubado por ${atacanteId}`
    );

    if (debitado === 0) {
      textoResposta +=
        `😅 *AZAR!*\n\n` +
        `A vítima ficou sem saldo no último segundo!\n` +
        `🗑️ *Item consumido:* ${itemAtaque.nome}\n` +
        `⏱️ *Próxima tentativa em:* ${formatarTempo(COOLDOWN_ROUBO_MS)}`;
      await sock.sendMessage(jid, { text: textoResposta }, { quoted: msg });
      return;
    }

    const carteiraAtualizada = await alterarGold(
      atacanteId, idGrupo, debitado, `Roubou de ${vitimaId}`
    );

    await incrementMission(atacanteId, 'roubo3', 1).catch(() => {});

    await CarteiraGrupo.findOneAndUpdate(
      { _id: carteiraVitima._id },
      {
        $set: {
          imunidadeRouboAte: new Date(agora + IMUNIDADE_ROUBO_MS),
          lastRobbedBy:      atacanteId,
          lastRobbedAmount:  debitado,
          lastRobbedAt:      new Date(),
        },
      }
    );

    textoResposta +=
      `✅ *ROUBO BEM-SUCEDIDO!*\n\n` +
      `💰 *Valor roubado:* ${formatarSaldo(debitado, carteiraAtualizada)} (${pct}% do saldo)\n` +
      `👤 *Seu novo saldo:* ${formatarSaldo(carteiraAtualizada.gold, carteiraAtualizada)}\n` +
      `😢 *Saldo da vítima:* ${formatarSaldo(carteiraVitimaAtualizada.gold, carteiraVitimaAtualizada)}\n` +
      `🗑️ *Item consumido:* ${itemAtaque.nome}\n` +
      (itemDefesa ? `🛡️ *Defesa da vítima consumida:* ${itemDefesa.nome}\n` : ``) +
      `💡 A vítima tem *15 minutos* para usar *!policia @você*!`;
  } else {
    // ── Roubo fracassado — vai preso ────────────────────────────────────────
    await CarteiraGrupo.findOneAndUpdate(
      { _id: carteiraAtacante._id },
      { $set: { prestoAte: new Date(agora + COOLDOWN_PRESO_MS) } }
    );

    textoResposta +=
      `❌ *ROUBO FRACASSADO!*\n\n` +
      `🚔 A polícia chegou e te prendeu!\n` +
      `😌 *Saldo da vítima:* ${formatarSaldo(saldoVitima, carteiraVitima)} (intacto)\n` +
      `🗑️ *Item consumido:* ${itemAtaque.nome}\n` +
      (itemDefesa ? `🛡️ *Defesa da vítima consumida:* ${itemDefesa.nome}\n` : ``) +
      `🔒 *Você ficará preso por:* ${formatarTempo(COOLDOWN_PRESO_MS)}`;
  }

  await sock.sendMessage(jid, { text: textoResposta }, { quoted: msg });
}

// ─── Helpers locais ───────────────────────────────────────────────────────────

function _tsOuZero(valor) {
  if (!valor) return 0;
  const ts = new Date(valor).getTime();
  return isNaN(ts) ? 0 : ts;
}

/**
 * Retorna todas as "formas" conhecidas de um JID (ele mesmo + o par @lid/@pn
 * cadastrado no LidMapping). Sem isso, comparar lastRobbedBy === mentionedJid
 * falha sempre que o WhatsApp entrega a menção num formato diferente do que
 * foi salvo no momento do roubo.
 */
async function resolverVariantesJid(jid) {
  if (!jid) return [];
  const variantes = new Set([jid]);
  try {
    if (jid.endsWith('@lid')) {
      const map = await LidMapping.findOne({ lid: jid }).lean();
      const pn = normalizarJidComDominio(map?.pn, 's.whatsapp.net');
      if (pn) variantes.add(pn);
    } else {
      const map = await LidMapping.findOne({ pn: jid }).lean();
      const lid = normalizarJidComDominio(map?.lid, 'lid');
      if (lid) variantes.add(lid);
    }
  } catch (e) {
    console.error('⚠️ Erro ao resolver variantes de JID (roubo):', e.message);
  }
  return [...variantes];
}

function _buildTextoCaptura(nomeLadrao, debitavel = 0) {
  const cabecalho =
    `✅ *LADRÃO PRESO!*\n\n` +
    `🚔 *${nomeLadrao}* foi capturado!\n` +
    `🔒 *Ficará preso por mais:* ${formatarTempo(COOLDOWN_PRESO_MS)}\n`;

  if (debitavel > 0) {
    return cabecalho + `💰 *Saldo recuperado:* ${formatarSaldo(debitavel)} (${DEVOLUCAO_POLICIA}% do roubado)`;
  }
  return cabecalho + `😔 O ladrão não tem saldo para devolver.`;
}

// ─── !policia @ladrão ─────────────────────────────────────────────────────────

async function handlePolicia(sock, msg, jid) {
  const vitimaId = getUserId(msg);
  // O roteador aceita mensagens encapsuladas pelo WhatsApp (ex.: temporárias).
  // Extrair a menção do mesmo conteúdo normalizado evita perder o alvo quando
  // o comando chega dentro de ephemeral/view-once.
  const content =
    msg.message?.ephemeralMessage?.message ||
    msg.message?.viewOnceMessage?.message ||
    msg.message?.viewOnceMessageV2?.message ||
    msg.message;
  const ladraoRaw = content?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const ladrao    = ladraoRaw ? (normalizarJid(ladraoRaw) || ladraoRaw) : null;
  const idGrupo   = getGroupId(msg, jid);
  const agora     = Date.now();

  // ── Validações rápidas ────────────────────────────────────────────────────
  if (!ladrao) {
    await sock.sendMessage(jid, {
      text: sortearFala('policiaSemMencao'),
    }, { quoted: msg });
    return;
  }

  if (await sameWhatsAppIdentity(vitimaId, ladrao, sock, getAlternateSenderJids(msg), [])) {
    await sock.sendMessage(jid, {
      text: '❌ Você não pode chamar a polícia em si mesmo!',
    }, { quoted: msg });
    return;
  }
  // ── Buscar carteiras em paralelo ──────────────────────────────────────────
  const [carteiraVitima, carteiraLadrao] = await Promise.all([
    getCarteira(vitimaId, idGrupo),
    getCarteira(ladrao,   idGrupo),
  ]);

  // ── Verificar prazo para denunciar o roubo ─────────────────────────────────
  const ultimoRouboEm = _tsOuZero(carteiraVitima.lastRobbedAt);
  const dentroDaJanelaDenuncia =
    ultimoRouboEm > 0 &&
    agora >= ultimoRouboEm &&
    agora - ultimoRouboEm <= JANELA_DENUNCIA_POLICIA_MS;

  // Compara contra todas as variantes conhecidas do ladrão (@lid ↔ número real)
  // — o mentionedJid da menção pode vir num formato diferente do que foi
  // gravado em lastRobbedBy no momento do !roubar.
  const variantesLadrao = await resolverVariantesJid(ladrao);

  const ladraoCorrespondeAoRegistro = carteiraVitima.lastRobbedBy
    ? await sameWhatsAppIdentity(carteiraVitima.lastRobbedBy, ladrao, sock, [], variantesLadrao)
    : false;

  if (!ladraoCorrespondeAoRegistro || !dentroDaJanelaDenuncia) {
    await sock.sendMessage(jid, {
      text: sortearFala('policiaPrazoExpirado'),
    }, { quoted: msg });
    return;
  }

  // ── Cooldown anti-spam ────────────────────────────────────────────────────
  const ultimaPolicia = _tsOuZero(carteiraVitima.ultimaPolicia);
  const restanteCd    = COOLDOWN_POLICIA_MS - (agora - ultimaPolicia);

  if (restanteCd > 0) {
    await sock.sendMessage(jid, {
      text: `⏱️ Aguarde *${formatarTempo(restanteCd)}* para acionar a polícia novamente.`,
    }, { quoted: msg });
    return;
  }

  // ── Registrar chamada (antes da rolagem para evitar spam em erro) ─────────
  await CarteiraGrupo.findOneAndUpdate(
    { _id: carteiraVitima._id },
    { $set: { ultimaPolicia: new Date() } }
  );

  // ── Rolagem ───────────────────────────────────────────────────────────────
  const rolagem      = Math.random() * 100;
  const prendeu      = rolagem < CHANCE_POLICIA;
  const nomeLadrao = await resolveDisplayName(ladrao, sock, {}, { fallback: 'Ladrão' });

  let textoResultado;

  if (prendeu) {
    // Estender prisão acumulando o tempo restante atual
    const prestoAteAtual = _tsOuZero(carteiraLadrao.prestoAte);
    const novoPrestoAte  = Math.max(agora, prestoAteAtual) + COOLDOWN_PRESO_MS;

    const valorRoubado  = carteiraVitima.lastRobbedAmount ?? 0;
    const valorDevolver = Math.floor(valorRoubado * DEVOLUCAO_POLICIA / 100);
    const saldoLadrao   = carteiraLadrao.gold ?? 0;
    const debitavel     = Math.min(valorDevolver, saldoLadrao);

    // Todas as escritas em paralelo
    const ops = [
      CarteiraGrupo.findOneAndUpdate(
        { _id: carteiraLadrao._id },
        { $set: { prestoAte: new Date(novoPrestoAte) } }
      ),
    ];

    if (debitavel > 0) {
      ops.push(
        alterarGold(ladrao,   idGrupo, -debitavel, `Apreensão policial para ${vitimaId}`),
        alterarGold(vitimaId, idGrupo,  debitavel, `Recuperado pela polícia de ${ladrao}`)
      );
    }

    await Promise.all(ops);

    textoResultado = _buildTextoCaptura(nomeLadrao, debitavel);
  } else {
    textoResultado =
      `❌ *LADRÃO ESCAPOU!*\n\n` +
      `🏃 *${nomeLadrao}* conseguiu fugir da polícia!\n` +
      `😔 Nenhum saldo foi recuperado.`;
  }

  const texto =
    `👮 ═══ ACIONANDO A POLÍCIA! ═══ 👮\n\n` +
    `🎲 *Rolagem:* ${rolagem.toFixed(1)} / ${CHANCE_POLICIA}% necessário\n` +
    `━━━━━━━━━━━━━━━━\n` +
    textoResultado;

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── Configuração !roubarbanco ────────────────────────────────────────────────

const COOLDOWN_ROUBARBANCO_MS = 30 * 60 * 1000;  // 30min entre tentativas
const COOLDOWN_PRESO_BANCO_MS =  4 * 60 * 60 * 1000; // 4h preso se falhar
const TAXA_SUCESSO_BASE_BANCO = 30; // % base (menor que roubo normal)
const MULTA_FALHA_PCT         = 10; // % do gold perdido se falhar
const ROUBO_BANCO_MIN_PCT     = 20; // % mínimo do banco.amount roubado
const ROUBO_BANCO_MAX_PCT     = 40; // % máximo do banco.amount roubado

/**
 * Calcula o intervalo de % roubável do banco baseado no bônus do item.
 * Item melhor → teto mais alto, podendo chegar até 55%.
 */
function calcularPctBanco(bonusItem) {
  const min = ROUBO_BANCO_MIN_PCT;
  const max = Math.min(55, ROUBO_BANCO_MAX_PCT + Math.floor(bonusItem / 10));
  return { min, max };
}

async function consumirFerramentaBanco(atacanteId, idGrupo, itemSlug, carteiraAtacante) {
  const atualizada = await incrementarItem(atacanteId, idGrupo, 'itensRouboBanco', itemSlug, -1);
  const restante = atualizada
    ? getItemQtd(atualizada.itensRouboBanco, itemSlug)
    : Math.max(0, getItemQtd(carteiraAtacante.itensRouboBanco, itemSlug) - 1);

  if (restante <= 0) {
    await Promise.all([
      CarteiraGrupo.findOneAndUpdate(
        { idWhatsApp: atacanteId, idGrupo, equiparouboBanco: itemSlug },
        { $unset: { equiparouboBanco: '' } }
      ),
      CarteiraGrupo.findOneAndUpdate(
        { idWhatsApp: atacanteId, idGrupo, equiparoubo: itemSlug },
        { $unset: { equiparoubo: '' } }
      ),
    ]);
  }
}

// ─── !roubarbanco @pessoa ─────────────────────────────────────────────────────

async function handleRoubarBanco(sock, msg, jid) {
  const atacanteId  = getUserId(msg);
  const vitimaIdRaw = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const vitimaId    = vitimaIdRaw ? (normalizarJid(vitimaIdRaw) || vitimaIdRaw) : null;
  const idGrupo     = getGroupId(msg, jid);
  const agora       = Date.now();

  // ── Validações básicas ────────────────────────────────────────────────────
  if (!vitimaId) {
    await sock.sendMessage(jid, {
      text: sortearFala('roubarBancoSemMencao'),
    }, { quoted: msg });
    return;
  }

  if (atacanteId === vitimaId) {
    await sock.sendMessage(jid, {
      text: sortearFala('roubarBancoProprio'),
    }, { quoted: msg });
    return;
  }
  // ── Buscar carteiras em paralelo ──────────────────────────────────────────
  const [carteiraAtacante, carteiraVitima] = await Promise.all([
    getCarteira(atacanteId, idGrupo),
    getCarteira(vitimaId,   idGrupo),
  ]);

  // ── Item equipado obrigatório ─────────────────────────────────────────────
  const ferramentaBanco = selecionarFerramentaBanco(carteiraAtacante);
  const itemSlugAtaque = ferramentaBanco?.slug;
  const itemAtaque = ferramentaBanco?.item;

  if (!itemAtaque) {
    await sock.sendMessage(jid, {
      text: sortearFala('roubarBancoSemFerramenta'),
    }, { quoted: msg });
    return;
  }

  // Só consulta o inventário bancário: itens comuns nunca são aceitos aqui.
  const qtdItem = getItemQtd(carteiraAtacante.itensRouboBanco, itemSlugAtaque);
  if (qtdItem <= 0) {
    await sock.sendMessage(jid, {
      text: sortearFala('roubarBancoSemEstoque', { itemInfo: itemAtaque }),
    }, { quoted: msg });
    return;
  }

  // ── Verificar imunidade da vítima (mesma regra do !roubar) ────────────────
  const imunidadeAte = _tsOuZero(carteiraVitima.imunidadeRouboAte);
  if (agora < imunidadeAte) {
    const restante = imunidadeAte - agora;
    await sock.sendMessage(jid, {
      text: sortearFala('alvoImune', { tempo: formatarTempo(restante) }),
    }, { quoted: msg });
    return;
  }

  // ── Preso? ────────────────────────────────────────────────────────────────
  const prestoAte = _tsOuZero(carteiraAtacante.prestoAte);
  if (agora < prestoAte) {
    await sock.sendMessage(jid, {
      text: sortearFala('usuarioPreso', { tempo: formatarTempo(prestoAte - agora) }),
    }, { quoted: msg });
    return;
  }

  // ── Cooldown específico do roubarbanco ────────────────────────────────────
  const ultimoRouboBanco = _tsOuZero(carteiraAtacante.ultimoRouboBanco);
  const restanteCd       = COOLDOWN_ROUBARBANCO_MS - (agora - ultimoRouboBanco);
  if (restanteCd > 0) {
    await sock.sendMessage(jid, {
      text: sortearFala('cooldownRoubo', { tempo: formatarTempo(restanteCd), banco: true }),
    }, { quoted: msg });
    return;
  }

  // ── Vítima tem investimento ativo? ────────────────────────────────────────
  const bancoDaVitima = carteiraVitima.banco ?? {};
  const saldoBanco    = bancoDaVitima.amount ?? 0;

  if (saldoBanco <= 0) {
    await sock.sendMessage(jid, {
      text: sortearFala('roubarBancoSemInvestimento'),
    }, { quoted: msg });
    return;
  }

  // ── Registrar cooldown antes da tentativa ─────────────────────────────────
  await CarteiraGrupo.findOneAndUpdate(
    { _id: carteiraAtacante._id },
    { $set: { ultimoRouboBanco: new Date() } }
  );

  // ── Calcular taxa de sucesso ──────────────────────────────────────────────
  const itemDefesaSlug = carteiraVitima.equiparsec;
  const itemDefesa     = itemDefesaSlug && ITENS_SEGURANCA[itemDefesaSlug];
  const taxaSucesso = calcularTaxaSucessoRoubo(
    TAXA_SUCESSO_BASE_BANCO,
    itemAtaque.bonus,
    itemDefesa?.defesa ?? 0
  );

  const rolagem = Math.random() * 100;
  const sucesso = rolagem < taxaSucesso;

  // ── Cabeçalho da resposta ─────────────────────────────────────────────────
  let texto =
    `🏦 ═══ ASSALTO AO BANCO! ═══ 🏦\n\n` +
    `🔫 *Ferramenta:* ${itemAtaque.nome}\n`;

  if (itemDefesa) {
    texto += `🛡️ *Defesa da vítima:* ${itemDefesa.nome}\n`;
  }

  texto +=
    `🎲 *Rolagem:* ${rolagem.toFixed(1)} / ${taxaSucesso}% necessário\n` +
    `━━━━━━━━━━━━━━━━\n`;

  if (sucesso) {
    // ── Sucesso ───────────────────────────────────────────────────────────
    const { min, max } = calcularPctBanco(itemAtaque.bonus);
    const pct          = Math.floor(Math.random() * (max - min + 1)) + min;
    const valorRoubado = Math.max(1, Math.floor(saldoBanco * pct / 100));

    // Debitar do banco da vítima só se ainda houver saldo suficiente —
    // evita banco.amount negativo com assaltos concorrentes.
    const debitoBanco = await CarteiraGrupo.findOneAndUpdate(
      { _id: carteiraVitima._id, 'banco.amount': { $gte: valorRoubado } },
      { $inc: { 'banco.amount': -valorRoubado } },
      { new: true }
    );
    if (!debitoBanco) {
      await sock.sendMessage(jid, {
        text: '⚠️ O saldo do banco mudou durante o assalto. Nenhum roubo foi concluído; tente novamente.',
      }, { quoted: msg });
      return;
    }

    // Creditar atacante
    const carteiraAtualizada = await alterarGold(
      atacanteId, idGrupo, valorRoubado, `Assaltou banco de ${vitimaId}`
    );

    await consumirFerramentaBanco(atacanteId, idGrupo, itemSlugAtaque, carteiraAtacante);

    texto +=
      `✅ *ASSALTO BEM-SUCEDIDO!*\n\n` +
      `🏦 *Roubado do banco:* ${formatarSaldo(valorRoubado, carteiraAtualizada)} (${pct}% do investimento)\n` +
      `💰 *Seu novo saldo:* ${formatarSaldo(carteiraAtualizada.gold, carteiraAtualizada)}\n` +
      `🏦 *Banco da vítima restante:* ${formatarSaldo(saldoBanco - valorRoubado, carteiraVitima)}\n` +
      `🗑️ *Item consumido:* ${itemAtaque.nome}\n\n` +
      `💡 A vítima tem *15 minutos* para usar *!policia @você*!`;

    // Registrar para o !policia funcionar
    await CarteiraGrupo.findOneAndUpdate(
      { _id: carteiraVitima._id },
      {
        $set: {
          imunidadeRouboAte: new Date(agora + IMUNIDADE_ROUBO_MS),
          lastRobbedBy:      atacanteId,
          lastRobbedAmount:  valorRoubado,
          lastRobbedAt:      new Date(),
        },
      }
    );

  } else {
    // ── Falha — prisão 4h + multa 10% gold + consome item ────────────────
    const saldoAtacante = carteiraAtacante.gold ?? 0;
    const multa         = Math.max(1, Math.floor(saldoAtacante * MULTA_FALHA_PCT / 100));

    await Promise.all([
      // 4h preso
      CarteiraGrupo.findOneAndUpdate(
        { _id: carteiraAtacante._id },
        { $set: { prestoAte: new Date(agora + COOLDOWN_PRESO_BANCO_MS) } }
      ),
      // Multa em gold — versão "segura" que nunca lança erro por saldo
      // insuficiente, só debita o que houver (evita crash com gold baixo/zerado).
      alterarGoldSeguro(atacanteId, idGrupo, -multa, 'Multa por falha no assalto ao banco'),
      // Consome 1 item equipado
      consumirFerramentaBanco(atacanteId, idGrupo, itemSlugAtaque, carteiraAtacante),
    ]);

    texto +=
      `❌ *ASSALTO FRACASSADO!*\n\n` +
      `🚔 A segurança do banco te capturou!\n\n` +
      `*PUNIÇÕES:*\n` +
      `  🔒 Preso por: *${formatarTempo(COOLDOWN_PRESO_BANCO_MS)}*\n` +
      `  💸 Multa: *${formatarSaldo(multa, carteiraAtacante)}* (10% do seu saldo)\n` +
      `  🗑️ Item destruído: *${itemAtaque.nome}*\n\n` +
      `😌 *Banco da vítima:* ${formatarSaldo(saldoBanco, carteiraVitima)} (intacto)`;
  }

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── Exportar ─────────────────────────────────────────────────────────────────

module.exports = {
  ITENS_ROUBO,
  ITENS_ROUBO_BANCO,
  ITENS_SEGURANCA,
  calcularTaxaSucessoRoubo,
  resolverChaveFerramenta,
  selecionarFerramentaRoubo,
  selecionarFerramentaBanco,
  sortearFala,
  FALAS_VARIADAS,
  handleMenuRoubo,
  handleMenuSec,
  handleComprarRoubo,
  handleComprarSec,
  handleEquiparRoubo,
  handleEquiparSec,
  handleInvRoubo,
  handleInvSec,
  handleMeioSec,
  handleRoubar,
  handleRoubarBanco,
  handlePolicia,
};