/**
 * Handler de Marketplace — Bot
 * Sistema de compra/venda entre usuários
 *
 * v4.0 — Arquivo único, sem duplicatas, sem 'use strict' soltos:
 *  - Um único 'use strict' no topo
 *  - BUY_COOLDOWNS, checkCooldown, parseBuyArgs, buildMensagem* declarados UMA vez
 *  - CONFIG centralizado com todas as chaves usadas no código
 *  - logSchema com índices compostos reais (não só comentário)
 *  - logSchema com compradorNome/vendedorNome para exibição no histórico
 *  - executarCompra salva nomes no log
 *  - executarCompra: !saldoDoc verificado antes de acessar .gold
 *  - handleOfertar: getQuantidadeInventario recebe session na mensagem de erro
 *  - handleOfertar: contagem de ofertas relida após commit (não +1 hardcoded)
 *  - handleAvenda/$or cobre documentos legados sem expiresAt
 *  - handleBuscarOferta/$or idem
 */

'use strict';

const path     = require('path');
const crypto   = require('crypto');
const mongoose = require('mongoose');
const Usuario  = require(path.join(__dirname, '..', '..', 'models', 'Usuario'));
const { bloqueadoPorVinculo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira', 'vinculo'));
const { formatarSaldo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));

// ─── CATÁLOGO ─────────────────────────────────────────────────────────────────

function tryRequire(modPath, label) {
  try {
    return require(modPath);
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.warn(`[Market] Módulo opcional não encontrado: ${label} (${modPath}). Ignorando.`);
      return {};
    }
    throw e;
  }
}

const { ITENS_LOJA }                   = tryRequire('./economia', 'economia');
const { ITENS_ROUBO, ITENS_SEGURANCA } = tryRequire('./roubo',    'roubo');
const { VARAS_PESCA, ISCAS }           = tryRequire('./pesca',    'pesca');

let CATALOGO_COMPLETO = {
  ...(ITENS_LOJA      || {}),
  ...(ITENS_ROUBO     || {}),
  ...(ITENS_SEGURANCA || {}),
  ...(VARAS_PESCA     || {}),
  ...(ISCAS           || {}),
};

function registerCatalog(itens = {}) {
  CATALOGO_COMPLETO = { ...CATALOGO_COMPLETO, ...itens };
}

function getNomeItem(itemKey) {
  return CATALOGO_COMPLETO[itemKey]?.nome ?? itemKey;
}

// ─── CONFIGURAÇÃO ─────────────────────────────────────────────────────────────

const CONFIG = {
  TAXA_MERCADO_PCT:                5,
  MAX_OFERTAS_USER:                10,
  PRECO_MINIMO:                    1,
  PRECO_MAXIMO:                    999_999,
  QTD_MINIMA:                      1,
  QTD_MAXIMA:                      999,
  MAX_QTD_COMPRA:                  99,
  OFERTA_EXPIRA_DIAS:              7,
  ITENS_POR_PAGINA:                10,
  COOLDOWN_BUY_MS:                 3_000,
  COOLDOWN_BUY_CLEANUP_INTERVAL_MS: 10 * 60 * 1_000,
  TRANSACTION_TIMEOUT_MS:          10_000,
};

// ─── SCHEMAS ──────────────────────────────────────────────────────────────────

const ofertaSchema = new mongoose.Schema(
  {
    sellerId:   { type: String, required: true },
    sellerName: { type: String, required: true, trim: true },
    itemKey:    { type: String, required: true, trim: true, lowercase: true },
    itemNome:   { type: String, required: true, trim: true },
    preco: {
      type:     Number,
      required: true,
      min:      [CONFIG.PRECO_MINIMO, `Preço mínimo é ${CONFIG.PRECO_MINIMO}`],
      max:      [CONFIG.PRECO_MAXIMO, `Preço máximo é ${CONFIG.PRECO_MAXIMO}`],
      validate: {
        validator: Number.isInteger,
        message:   'Preço deve ser um inteiro',
      },
    },
    quantidade: {
      type:     Number,
      required: true,
      min:      [1,                `Quantidade mínima é 1`],
      max:      [CONFIG.QTD_MAXIMA, `Quantidade máxima é ${CONFIG.QTD_MAXIMA}`],
      validate: {
        validator: Number.isInteger,
        message:   'Quantidade deve ser um inteiro',
      },
    },
    expiresAt: {
      type:    Date,
      default: CONFIG.OFERTA_EXPIRA_DIAS > 0
        ? () => new Date(Date.now() + CONFIG.OFERTA_EXPIRA_DIAS * 86_400_000)
        : null,
    },
    // ── BUG 4 FIX: rastreia de qual campo do Usuario cada unidade da oferta
    // veio (inventory / itensRoubo / itensSec / itensPesca). Sem isso, ao
    // cancelar uma oferta, o item sempre voltava pro campo "inventory" —
    // mesmo que tivesse sido retirado de itensRoubo ou itensPesca — deixando
    // o item preso num campo onde o sistema de origem não procura por ele.
    // Invariante: soma dos valores deste mapa === quantidade da oferta.
    origemInventario: {
      type:    Map,
      of:      Number,
      default: () => ({}),
    },
  },
  {
    timestamps: true,   // gerencia createdAt e updatedAt; evita dessincronismo em upserts
    strict:     true,
    versionKey: false,  // remove __v — não usado, gera writes extras
  }
);

// ── Índices de ofertaSchema ──────────────────────────────────────────────────

ofertaSchema.index({ sellerId: 1, itemKey: 1 }, { unique: true }); // chave de negócio
ofertaSchema.index({ createdAt: -1 });                              // handleAvenda (listagem pública)
ofertaSchema.index({ itemKey: 1, preco: 1 });                       // handleBuscarOferta (mais barato primeiro)
ofertaSchema.index({ sellerId: 1, createdAt: -1 });                 // handleMinhasOfertas / handleOfertar

if (CONFIG.OFERTA_EXPIRA_DIAS > 0) {
  ofertaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL automático
}

// ─────────────────────────────────────────────────────────────────────────────

const logSchema = new mongoose.Schema(
  {
    compradorId:   { type: String, required: true },
    compradorNome: { type: String, default: null, trim: true },
    vendedorId:    { type: String, required: true },
    vendedorNome:  { type: String, default: null, trim: true },
    itemKey:       { type: String, required: true, trim: true, lowercase: true },
    itemNome:      { type: String, required: true, trim: true },
    quantidade: {
      type:     Number,
      required: true,
      min:      [1, 'Quantidade mínima é 1'],
      validate: { validator: Number.isInteger, message: 'Quantidade deve ser um inteiro' },
    },
    precoUnit: {
      type:     Number,
      required: true,
      min:      [CONFIG.PRECO_MINIMO, `Preço mínimo é ${CONFIG.PRECO_MINIMO}`],
      validate: { validator: Number.isInteger, message: 'Preço deve ser um inteiro' },
    },
    totalBruto:   { type: Number, required: true, min: [0, 'totalBruto não pode ser negativo']   },
    taxa:         { type: Number, required: true, min: [0, 'taxa não pode ser negativa']          },
    totalLiquido: { type: Number, required: true, min: [0, 'totalLiquido não pode ser negativo']  },
    purchaseId: { type: String, default: null },
    buyerWalletLinked: { type: Boolean, default: false },
    sellerWalletLinked: { type: Boolean, default: false },
    settlementStatus: { type: String, enum: ['pending', 'completed', 'reversed'], default: 'completed' },
    offerSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    buyerNameForLog: { type: String, default: null },
    sellerNameForLog: { type: String, default: null },
  },
  {
    timestamps: true,
    strict:     true,
    versionKey: false,
  }
);

// ── Índices de logSchema ─────────────────────────────────────────────────────
//
// handleHistoricoMarket faz duas queries separadas por campo indexado
// (compradorId, vendedorId) e merge em memória — estratégia mais previsível
// do que $or com index union, que o query planner pode não otimizar bem
// dependendo da seletividade de cada ramo.
//
// Índice composto (campo + createdAt DESC) cobre tanto o find quanto o
// countDocuments de cada lado sem FETCH extra.
logSchema.index({ compradorId: 1, createdAt: -1 }); // find/count lado comprador
logSchema.index({ vendedorId:  1, createdAt: -1 }); // find/count lado vendedor

// Índice de cobertura para countDocuments({ compradorId, vendedorId }) —
// útil caso uma query futura precise contar transações entre dois usuários
// específicos sem collection scan.
// ATENÇÃO: este índice NÃO cobre o countDocuments({ $or: [...] }) atual;
// cada ramo do $or usa o seu índice composto acima via index union.
logSchema.index({ compradorId: 1, vendedorId: 1 });
logSchema.index({ purchaseId: 1 }, { unique: true, sparse: true });

// ─────────────────────────────────────────────────────────────────────────────

// ?? em vez de || para evitar falsy acidental (0, '') em modelo já registrado.
// mongoose.models é o registro global; re-compilar o mesmo modelo lança erro
// em hot-reload (ex: Next.js, nodemon), por isso a guarda é necessária.
const Oferta    = mongoose.models.Oferta    ?? mongoose.model('Oferta',    ofertaSchema);
const MarketLog = mongoose.models.MarketLog ?? mongoose.model('MarketLog', logSchema);

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────

/**
 * Retorna o JID do remetente da mensagem.
 * - Em grupos: msg.key.participant (JID do membro)
 * - Em DMs:    msg.key.remoteJid   (JID do contato)
 * Retorna null se a estrutura da mensagem for inválida.
 */
function getUserId(msg) {
  if (!msg?.key) return null;
  // participant só existe em mensagens de grupo; remoteJid é o fallback para DMs
  return msg.key.participant ?? msg.key.remoteJid ?? null;
}

/**
 * Remove o sufixo @s.whatsapp.net (ou qualquer @domínio) e caracteres
 * não-numéricos, retornando apenas os dígitos do número.
 * Retorna string vazia se jid for falsy.
 */
function formatarNumero(jid = '') {
  if (!jid) return '';
  return String(jid).replace(/@\S+/, '').replace(/\D/g, '');
}

/**
 * Converte um número de telefone ou JID completo em JID WhatsApp padrão.
 *
 * Regras:
 *  - Se já contiver '@', retorna como está (assume JID válido).
 *  - Remove qualquer caractere não-numérico antes de validar.
 *  - Rejeita números com menos de 8 dígitos (inválidos para qualquer país).
 *
 * @param  {string|number} numero
 * @returns {string|null} JID no formato "<dígitos>@s.whatsapp.net" ou null
 */
function toJid(numero) {
  const str = String(numero ?? '').trim();

  // JID já formatado — devolve sem alteração
  if (str.includes('@')) return str;

  const limpo = str.replace(/\D/g, '');

  if (limpo.length < 8) {
    console.warn(`[Market] toJid: número inválido ou curto demais: "${str}"`);
    return null;
  }

  return `${limpo}@s.whatsapp.net`;
}

/**
 * Envia uma mensagem de texto como resposta (quote) à mensagem original.
 * Falhas de envio são capturadas e logadas; a Promise resolve para undefined
 * em vez de rejeitar, evitando crashes em erros de rede pontuais.
 *
 * @param  {object} sock  - Instância do cliente WhatsApp
 * @param  {string} jid   - JID do destinatário
 * @param  {object} msg   - Mensagem original (para quote)
 * @param  {string} texto - Conteúdo da resposta
 * @returns {Promise<object|undefined>}
 */
async function reply(sock, jid, msg, texto) {
  try {
    return await sock.sendMessage(jid, { text: String(texto) }, { quoted: msg });
  } catch (e) {
    // Não relança: falha de envio não deve derrubar o fluxo do handler
    console.error(`[Market] reply falhou (jid=${jid}):`, e.message);
  }
}

// ─── INVENTÁRIO ───────────────────────────────────────────────────────────────

// Ordem de prioridade de remoção de itens
const CAMPOS_INVENTARIO = ['inventory', 'itensRoubo', 'itensSec', 'itensPesca'];

function somarCampos(user, itemKey) {
  return CAMPOS_INVENTARIO.reduce((total, campo) => {
    const val = user[campo]?.[itemKey];
    return total + (typeof val === 'number' && val > 0 ? val : 0);
  }, 0);
}

async function getQuantidadeInventario(userId, itemKey, session = null) {
  try {
    const projection = CAMPOS_INVENTARIO.reduce((proj, campo) => {
      proj[`${campo}.${itemKey}`] = 1;
      return proj;
    }, {});
    const user = await Usuario.findOne(
      { idWhatsApp: userId },
      projection,
      session ? { session } : {}
    ).lean();
    if (!user) return 0;
    return somarCampos(user, itemKey);
  } catch (e) {
    console.error('[Market] getQuantidadeInventario:', e.message);
    return 0;
  }
}

// ─── CONSTANTES LOCAIS ────────────────────────────────────────────────────────

// Compilada uma vez no módulo — reutilizada em removerInventario e adicionarInventario
const ITEM_KEY_RE = /^[a-z0-9_-]+$/;

// ─── REMOVER INVENTÁRIO ───────────────────────────────────────────────────────

/**
 * Remove `quantidade` unidades de `itemKey` do inventário de `userId`,
 * distribuindo o desconto entre os campos de CAMPOS_INVENTARIO em ordem de prioridade.
 *
 * Comportamento por contexto:
 *  - Com session (dentro de transação): lança Error em qualquer falha → abort automático.
 *  - Sem session (uso avulso):          retorna null em falhas recuperáveis,
 *                                       lança TypeError apenas para erros de programação.
 *
 * @param  {string}           userId    - JID do usuário
 * @param  {string}           itemKey   - Chave do item (ex: "dinamite")
 * @param  {number}           quantidade - Inteiro positivo a remover
 * @param  {ClientSession|null} session - Session Mongoose (opcional)
 * @returns {Promise<Object|null>} objeto { campo: quantidadeRemovidaDoCampo, ... }
 *          em sucesso (BUG 4 FIX — antes retornava só `true`); null se sem
 *          session e estoque insuficiente.
 */
async function removerInventario(userId, itemKey, quantidade, session = null) {

  // ── 1. Validações de programação (síncronas, sem I/O) ─────────────────────
  // Sempre lançam, independente de session: dados inválidos indicam bug no caller.

  if (!userId || typeof userId !== 'string') {
    throw new TypeError(`[Market] removerInventario: userId inválido (${userId})`);
  }
  if (!itemKey || !ITEM_KEY_RE.test(itemKey)) {
    throw new TypeError(`[Market] removerInventario: itemKey inválido ("${itemKey}")`);
  }
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    throw new TypeError(`[Market] removerInventario: quantidade inválida (${quantidade})`);
  }

  // ── 2. Leitura do inventário atual ────────────────────────────────────────
  // Projeção precisa: busca apenas os campos que serão decrementados,
  // evitando trazer o documento inteiro (pode ser grande).

  const projection = CAMPOS_INVENTARIO.reduce((proj, campo) => {
    proj[campo] = 1;
    return proj;
  }, {});

  const opts = session ? { session } : {};

  const user = await Usuario.findOne({ idWhatsApp: userId }, projection, opts).lean();

  if (!user) {
    const errMsg = `[Market] removerInventario: usuário não encontrado — userId=${userId}`;
    console.warn(errMsg);
    // Dentro de transação: lança para forçar abort via withTransaction.
    // Fora: retorna false para compatibilidade com callers que verificam o booleano.
    if (session) throw new Error(errMsg);
    return false;
  }

  // ── 3. Verificação de saldo ───────────────────────────────────────────────

  const totalDisponivel = somarCampos(user, itemKey);

  if (totalDisponivel < quantidade) {
    console.warn(
      `[Market] removerInventario: estoque insuficiente — ` +
      `userId=${userId} item=${itemKey} disponivel=${totalDisponivel} pedido=${quantidade}`
    );
    // Prefixo estruturado para facilitar identificação no catch do caller
    if (session) throw new Error(`INVENTARIO_INSUFICIENTE:${userId}:${itemKey}`);
    return false;
  }

  // ── 4. Cálculo do $inc distribuído pelos campos ───────────────────────────
  // Consome da primeira fonte com saldo antes de passar para a próxima,
  // seguindo a ordem de prioridade definida em CAMPOS_INVENTARIO.
  // Ex: se "inventory" tem 2 e "itensRoubo" tem 3, e pediu=4,
  //     desconta 2 de inventory e 2 de itensRoubo.

  let restante          = quantidade;
  const incrMap         = {};
  const distribuicao    = {}; // BUG 4 FIX: contagem positiva por campo, devolvida ao caller

  for (const campo of CAMPOS_INVENTARIO) {
    if (restante <= 0) break;

    const disponivel = user[campo]?.[itemKey];
    if (typeof disponivel !== 'number' || disponivel <= 0) continue;

    const descontar               = Math.min(disponivel, restante);
    incrMap[`${campo}.${itemKey}`] = -descontar;
    distribuicao[campo]           = descontar;
    restante                     -= descontar;
  }

  // Invariante: somarCampos garantiu totalDisponivel >= quantidade.
  // Se restante > 0 aqui, os dados do documento estão corrompidos — lança sempre.
  if (restante > 0) {
    throw new Error(
      `[Market] removerInventario: inconsistência interna — restante=${restante} após distribuição ` +
      `(userId=${userId} item=${itemKey} totalDisponivel=${totalDisponivel})`
    );
  }

  // ── 5. Aplicação atômica com condição de guarda ───────────────────────────
  // A condição $gte em cada campo impede que valores negativos sejam gerados
  // caso outro processo tenha decrementado o inventário entre o findOne (passo 2)
  // e este update (race condition). Se a guarda falhar, result === null.

  const guardas = Object.entries(incrMap).reduce((acc, [campoKey, decremento]) => {
    // decremento é negativo; -decremento é o mínimo esperado no campo
    acc[campoKey] = { $gte: -decremento };
    return acc;
  }, { idWhatsApp: userId });

  const result = await Usuario.findOneAndUpdate(
    guardas,
    { $inc: incrMap },
    {
      ...opts,
      // new: false — o documento pré-update não é usado por nenhum caller;
      // evita o FETCH extra que new: true exigiria no driver
      new: false,
    }
  );

  if (!result) {
    // Guarda falhou: outro processo consumiu o estoque no intervalo entre
    // findOne e findOneAndUpdate. Dentro de transação o withTransaction
    // pode fazer retry se o erro tiver label TransientTransactionError.
    const errMsg =
      `[Market] removerInventario: guarda falhou (possível race condition) — ` +
      `userId=${userId} item=${itemKey}`;
    console.warn(errMsg);
    if (session) throw new Error(errMsg);
    return null; // BUG 4 FIX: null (não false) — o contrato agora é objeto|null
  }

  // BUG 4 FIX: retorna de onde cada unidade saiu, para handleOfertar poder
  // gravar isso na oferta e handleCancelarOferta devolver ao lugar certo.
  return distribuicao;
}

// ─── ADICIONAR INVENTÁRIO ─────────────────────────────────────────────────────

/**
 * Adiciona `quantidade` unidades de `itemKey` ao campo `inventory` do usuário.
 * Sempre usa `inventory` como destino (sem distribuição entre campos),
 * pois novos itens chegam pelo canal padrão.
 *
 * Comportamento por contexto: igual a removerInventario.
 *
 * @param  {string}           userId
 * @param  {string}           itemKey
 * @param  {number}           quantidade
 * @param  {ClientSession|null} session
 * @returns {Promise<boolean>}
 */
async function adicionarInventario(userId, itemKey, quantidade, session = null) {

  // ── Validações de programação (fora do try — não devem ser silenciadas) ───

  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    const errMsg = `[Market] adicionarInventario: quantidade inválida (${quantidade})`;
    console.error(errMsg);
    if (session) throw new Error(errMsg);
    return false;
  }

  if (!ITEM_KEY_RE.test(itemKey)) {
    const errMsg = `[Market] adicionarInventario: itemKey inválido ("${itemKey}")`;
    console.error(errMsg);
    if (session) throw new Error(errMsg);
    return false;
  }

  // ── Operação atômica ──────────────────────────────────────────────────────
  // $inc cria o campo com o valor se não existir — não é necessário $setOnInsert.

  try {
    const opts   = session ? { session } : {};
    const result = await Usuario.findOneAndUpdate(
      { idWhatsApp: userId },
      { $inc: { [`inventory.${itemKey}`]: quantidade } },
      { new: false, ...opts }
      // new: false — valor pós-update não é utilizado; evita FETCH desnecessário
    );

    if (!result) {
      const errMsg = `[Market] adicionarInventario: usuário não encontrado — userId=${userId}`;
      console.error(errMsg);
      if (session) throw new Error(errMsg);
      return false;
    }

    return true;

  } catch (e) {
    // Relança imediatamente dentro de transação para garantir abort via withTransaction.
    // Fora de transação, loga e retorna false para não derrubar o fluxo do caller.
    if (session) throw e;
    console.error('[Market] adicionarInventario:', e.message);
    return false;
  }
}

// ─── ORIGEM DO INVENTÁRIO (BUG 4 FIX) ─────────────────────────────────────────

/**
 * Calcula, em ordem de prioridade de CAMPOS_INVENTARIO, de quais campos
 * `quantidadeConsumir` unidades devem ser descontadas do mapa `origemAtual`
 * (o `origemInventario` salvo na oferta). Usada quando parte de uma oferta
 * é vendida — o restante da oferta precisa continuar sabendo de onde veio,
 * pra um cancelamento futuro devolver certo.
 *
 * Não lança se o mapa não cobrir toda a quantidade (dado legado de ofertas
 * criadas antes desta correção, sem origemInventario) — nesse caso apenas
 * desconta o que existe; a diferença fica pro caller decidir.
 *
 * @param  {Map|Object|null} origemAtual
 * @param  {number}          quantidadeConsumir
 * @returns {Object} incremento NEGATIVO por campo, pronto pra usar em $inc
 *          (ex: { 'origemInventario.itensPesca': -2 })
 */
function consumirOrigemInventario(origemAtual, quantidadeConsumir) {
  const origemObj = origemAtual instanceof Map ? Object.fromEntries(origemAtual) : (origemAtual || {});
  const incDelta  = {};
  let restante    = quantidadeConsumir;

  for (const campo of CAMPOS_INVENTARIO) {
    if (restante <= 0) break;
    const disponivel = origemObj[campo] || 0;
    if (disponivel <= 0) continue;
    const consumir = Math.min(disponivel, restante);
    incDelta[`origemInventario.${campo}`] = -consumir;
    restante -= consumir;
  }

  return incDelta;
}

// ─── TRANSAÇÃO ────────────────────────────────────────────────────────────────

// Labels do driver MongoDB que indicam erros transitórios passíveis de retry
const RETRY_CODES = new Set([
  'TransientTransactionError',
  'UnknownTransactionCommitResult',
]);

const MAX_TRANSACTION_RETRIES = 3;

/**
 * Backoff exponencial com jitter para evitar thundering herd em retries.
 * Cresce como: 50ms, 100ms, 200ms … com cap em 1 000ms.
 *
 * @param  {number} tentativa - Número da tentativa atual (base 1)
 * @returns {number} Milissegundos a aguardar antes do próximo retry
 */
function _retryDelay(tentativa) {
  const BASE   = 50;
  const CAP    = 1_000;
  const jitter = Math.random() * BASE; // distribui retries em janelas diferentes
  return Math.min(BASE * 2 ** tentativa + jitter, CAP);
}

/**
 * Executa `callback(session)` dentro de uma transação MongoDB com retry
 * automático para erros transitórios.
 *
 * Contrato do callback:
 *  - Deve lançar erros de negócio com `err.userMsg` para falha imediata (sem retry).
 *  - Deve ser idempotente: pode ser chamado mais de uma vez em caso de retry
 *    com label `UnknownTransactionCommitResult` (commit incerto).
 *
 * @param  {function} callback - async (session: ClientSession) => any
 * @returns {Promise<any>} Valor retornado pelo callback em caso de sucesso
 * @throws  Relança o último erro após esgotar retries, ou imediatamente
 *          se o erro for de negócio (e.userMsg) ou não-transitório.
 */
async function withTransaction(callback) {
  let tentativa = 0;

  while (true) {
    // Session criada dentro do loop: cada retry começa com um estado limpo,
    // evitando reutilizar uma session em estado indeterminado após abort.
    const session = await mongoose.startSession();

    try {
      session.startTransaction({
        readConcern:    { level: 'snapshot' },  // leitura consistente dentro da transação
        writeConcern:   { w: 'majority' },       // durabilidade garantida pela maioria do replica set
        readPreference: 'primary',              // evita ler de secondary desatualizado
        maxTimeMS:      CONFIG.TRANSACTION_TIMEOUT_MS,
      });

      const result = await callback(session);

      // commitTransaction pode lançar com label 'UnknownTransactionCommitResult':
      // o commit pode ou não ter sido aplicado. O retry re-executa o callback
      // inteiro — por isso o callback deve ser idempotente.
      await session.commitTransaction();

      return result;

    } catch (e) {

      // Só aborta se a transação ainda estiver ativa.
      // commitTransaction pode ter lançado após commit parcial,
      // deixando a transação já encerrada — chamar abort nesse estado é erro.
      if (session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch (abortErr) {
          // Abort falhou (ex: sessão expirou por maxTimeMS).
          // Apenas loga — o servidor vai limpar a transação por timeout.
          console.warn('[Market] withTransaction: abortTransaction falhou:', abortErr.message);
        }
      }

      // Erros de negócio (e.userMsg) nunca são retentados — sinalizam
      // condição esperada que o retry não vai resolver (ex: saldo insuficiente).
      const isTransient = !e.userMsg && e.errorLabels?.some(l => RETRY_CODES.has(l));

      if (isTransient && tentativa < MAX_TRANSACTION_RETRIES) {
        tentativa++;
        const delay = _retryDelay(tentativa);
        console.warn(
          `[Market] withTransaction: retry ${tentativa}/${MAX_TRANSACTION_RETRIES}` +
          ` — aguardando ${Math.round(delay)}ms — ${e.message}`
        );
        await new Promise(res => setTimeout(res, delay));
        continue; // volta ao topo do while com nova session
      }

      // Esgotou retries ou erro não-transitório: relança preservando stack original
      throw e;

    } finally {
      // endSession sempre chamado, independente do caminho tomado.
      // Chamar em session já encerrada é no-op seguro no driver oficial.
      session.endSession();
    }
  }
}

// ─── COOLDOWN ─────────────────────────────────────────────────────────────────

const BUY_COOLDOWNS = new Map();

// ✅ Intervalo de cleanup alinhado com o próprio cooldown,
// evitando acúmulo de entradas obsoletas por até 10 minutos
const _cooldownCleanup = setInterval(() => {
  const agora  = Date.now();
  const limite = CONFIG.COOLDOWN_BUY_MS;
  for (const [id, ts] of BUY_COOLDOWNS) {
    if (agora - ts > limite) BUY_COOLDOWNS.delete(id);
  }
}, CONFIG.COOLDOWN_BUY_MS);

if (_cooldownCleanup.unref) _cooldownCleanup.unref();

function checkCooldown(compradorId) {
  const agora    = Date.now();
  const ultimo   = BUY_COOLDOWNS.get(compradorId) ?? 0;
  const restante = CONFIG.COOLDOWN_BUY_MS - (agora - ultimo);
  return restante > 0 ? Math.ceil(restante / 1000) : 0;
}

// ─── FILTRO DE OFERTAS ATIVAS (reutilizado em handleAvenda e handleBuscarOferta) ──

function filtroOfertasAtivas(extra = {}) {
  const agora = new Date();
  return {
    quantidade: { $gt: 0 },
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: agora } },
    ],
    ...extra,
  };
}

// ─── MENSAGENS ────────────────────────────────────────────────────────────────

function parseBuyArgs(caption) {
  // Antes o regex procurava "buy" seguido de espaço — mas o comando real é
  // "!buyoferta", onde depois de "buy" vem "oferta" (sem espaço), não whitespace.
  // O match nunca acontecia e !buyoferta ficava permanentemente quebrado.
  const match = caption.match(/buyoferta\s+([\d@.\w]+)\s+([A-Za-z0-9_-]+)\s+(\d{1,6})/i);
  if (!match) return null;
  const quantidade = parseInt(match[3], 10);
  if (!Number.isFinite(quantidade) || quantidade < 1) return null;
  return { vendedorRaw: match[1], itemKey: match[2].toLowerCase(), quantidade };
}

function buildMensagemComprador({
  oferta, quantidade, totalBruto, taxa, novoSaldoComprador, currencyInfoBuyer, currencyInfoSeller,
}) {
  const vendedorExibicao = oferta.sellerName
    ? `${oferta.sellerName} (${formatarNumero(oferta.sellerId)})`
    : formatarNumero(oferta.sellerId);

  return (
    `✅ *COMPRA REALIZADA!*\n\n` +
    `📦 *Item:* ${oferta.itemNome}\n` +
    `📊 *Quantidade:* ${quantidade}\n` +
    `💵 *Preço unit.:* ${formatarSaldo(oferta.preco, currencyInfoBuyer)}\n` +
    `💳 *Total pago:* ${formatarSaldo(totalBruto, currencyInfoBuyer)} _(${formatarSaldo(oferta.preco, currencyInfoBuyer)} × ${quantidade})_\n` +
    `🏦 *Taxa do mercado:* ${formatarSaldo(taxa, currencyInfoSeller)} _(paga pelo vendedor)_\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `👤 *Vendedor:* ${vendedorExibicao}\n` +
    `💰 *Seu saldo:* ${formatarSaldo(novoSaldoComprador, currencyInfoBuyer)}`
  );
}

function buildMensagemVendedor({
  oferta, quantidade, totalBruto, totalLiquido, taxa, compradorId, compradorNome, novoSaldoVendedor,
  currencyInfoBuyer, currencyInfoSeller,
}) {
  const compradorExibicao = compradorNome
    ? `${compradorNome} (@${formatarNumero(compradorId)})`
    : `@${formatarNumero(compradorId)}`;

  return {
    text:
      `🛒 *VENDA REALIZADA!*\n\n` +
      `📦 *Item:* ${oferta.itemNome} × ${quantidade}\n` +
      `💵 *Preço unit.:* ${formatarSaldo(oferta.preco, currencyInfoSeller)}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `💸 *Valor bruto:* ${formatarSaldo(totalBruto, currencyInfoSeller)}\n` +
      `🏦 *Taxa (${CONFIG.TAXA_MERCADO_PCT}%):* -${formatarSaldo(taxa, currencyInfoSeller)}\n` +
      `💰 *Você recebeu:* +${formatarSaldo(totalLiquido, currencyInfoSeller)}\n` +
      (novoSaldoVendedor == null ? '' : `💳 *Seu saldo:* ${formatarSaldo(novoSaldoVendedor, currencyInfoSeller)}\n`) +
      `━━━━━━━━━━━━━━━━\n` +
      `👤 *Comprador:* ${compradorExibicao}`,
    mentions: [compradorId],
  };
}

// ─── LÓGICA DE COMPRA ─────────────────────────────────────────────────────────

async function executarCompra({
  compradorId, vendedorId, itemKey, quantidade, compradorNome, vendedorNome,
  buyerWalletLinked = false, sellerWalletLinked = false, purchaseId,
}, session) {

  // 1. Leitura paralela — sem writes ainda
  // BUG 2 FIX: filtroOfertasAtivas garante que ofertas expiradas (ainda não
  // limpas pelo TTL) não sejam compráveis. Sem este filtro, o vendedor poderia
  // receber gold de uma oferta que ele considerava encerrada há dias.
  const [ofertaExistente, saldoDoc, vendedorDoc] = await Promise.all([
    Oferta.findOne(
      filtroOfertasAtivas({ sellerId: vendedorId, itemKey }),
      { preco: 1, quantidade: 1, itemNome: 1, sellerId: 1, sellerName: 1, origemInventario: 1 },
      { session }
    ).lean(),
    Usuario.findOne({ idWhatsApp: compradorId }, { gold: 1 }, { session }).lean(),
    Usuario.findOne({ idWhatsApp: vendedorId }, { gold: 1 }, { session }).lean(),
  ]);

  // 2. Validações antes de qualquer write
  if (!ofertaExistente) {
    const err = new Error('OFERTA_NAO_ENCONTRADA');
    err.userMsg = `❌ Oferta não encontrada!\n\nVer ofertas disponíveis: *!avenda*`;
    throw err;
  }

  if (!saldoDoc) {
    const err = new Error('COMPRADOR_NAO_ENCONTRADO');
    err.userMsg = '⚠️ Seu usuário não foi encontrado. Tente novamente.';
    throw err;
  }

  if (!vendedorDoc) {
    const err = new Error('VENDEDOR_NAO_ENCONTRADO');
    err.userMsg = '⚠️ O vendedor não foi encontrado. Contate um administrador.';
    throw err;
  }

  if (ofertaExistente.quantidade < quantidade) {
    const err = new Error('QUANTIDADE_INSUFICIENTE');
    err.userMsg =
      `⚠️ *Quantidade indisponível!*\n\n` +
      `📦 Estoque atual: *${ofertaExistente.quantidade}*\n` +
      `📊 Você pediu: *${quantidade}*\n` +
      `🔍 Verifique: *!buscaroferta ${itemKey}*`;
    throw err;
  }

  const totalBruto   = ofertaExistente.preco * quantidade;
  const taxa         = Math.floor(totalBruto * CONFIG.TAXA_MERCADO_PCT / 100);
  const totalLiquido = totalBruto - taxa;
  const saldoAtual   = saldoDoc.gold ?? 0;

  if (!buyerWalletLinked && saldoAtual < totalBruto) {
    const err = new Error('SALDO_INSUFICIENTE');
    err.userMsg =
      `❌ *SALDO INSUFICIENTE*\n\n` +
      `💰 Você tem: *${formatarSaldo(saldoAtual)}*\n` +
      `💸 Precisa: *${formatarSaldo(totalBruto)}*\n` +
      `📊 Faltam: *${formatarSaldo(totalBruto - saldoAtual)}*`;
    throw err;
  }

  // 3. Decrementa/remove oferta atomicamente
  // BUG 2 FIX (continuação): filtroOfertasAtivas também nas etapas de write,
  // cobrindo o intervalo entre a leitura acima e este update. Sem isso, uma
  // oferta poderia expirar entre as duas operações e ainda ser consumida.
  let oferta;

  if (ofertaExistente.quantidade === quantidade) {
    // BUG 1 FIX: quantidade exata em vez de $gte.
    // Com $gte, se outro processo comprou parte das unidades entre o findOne
    // da etapa 1 e este delete, a oferta ainda passaria no filtro e seria
    // deletada — creditando ao comprador unidades que já não existiam na oferta.
    // A condição exata garante que só deletamos se o estoque ainda for o mesmo
    // que lemos; caso contrário, retorna null → CONFLITO_ESTOQUE abaixo.
    oferta = await Oferta.findOneAndDelete(
      filtroOfertasAtivas({ sellerId: vendedorId, itemKey, quantidade: quantidade }),
      { session }
    ).lean();
  } else {
    // O $gte aqui é correto: para compra parcial, qualquer quantidade >= pedida
    // é válida. A diferença é que o resultado pode ter mais unidades do que
    // ofertaExistente indicava — o comprador recebe exatamente o que pediu.
    //
    // BUG 4 FIX: junto do $inc de quantidade, também desconta do
    // origemInventario (mesma ordem de prioridade usada por removerInventario),
    // pra que a oferta restante continue sabendo de onde vieram as unidades
    // que sobraram — necessário pra um cancelamento futuro devolver certo.
    const incOrigemConsumido = consumirOrigemInventario(ofertaExistente.origemInventario, quantidade);

    oferta = await Oferta.findOneAndUpdate(
      filtroOfertasAtivas({ sellerId: vendedorId, itemKey, quantidade: { $gte: quantidade } }),
      { $inc: { quantidade: -quantidade, ...incOrigemConsumido } },
      { session, new: false }
    ).lean();
  }

  if (!oferta) {
    const err = new Error('CONFLITO_ESTOQUE');
    err.userMsg =
      `⚠️ Outra compra acabou de esgotar o estoque.\n\n` +
      `🔍 Verifique disponibilidade: *!buscaroferta ${itemKey}*`;
    throw err;
  }

  // 4. Transferência financeira + entrega do item
  const [compradorAtualizado, vendedorAtualizado] = await Promise.all([
    Usuario.findOneAndUpdate(
      buyerWalletLinked
        ? { idWhatsApp: compradorId }
        : { idWhatsApp: compradorId, gold: { $gte: totalBruto } },
      {
        $inc: {
          ...(buyerWalletLinked ? {} : { gold: -totalBruto }),
          [`inventory.${itemKey}`]: quantidade,
        },
      },
      { session, new: true }
    ).lean(),
    sellerWalletLinked
      ? Promise.resolve(vendedorDoc)
      : Usuario.findOneAndUpdate(
          { idWhatsApp: vendedorId },
          { $inc: { gold: totalLiquido } },
          { session, new: true },
        ).lean(),
  ]);

  if (!compradorAtualizado) {
    const existe = await Usuario.exists({ idWhatsApp: compradorId }, { session });
    const err = new Error(existe ? 'SALDO_INSUFICIENTE_RACE' : 'COMPRADOR_NAO_ENCONTRADO');
    err.userMsg = existe
      ? `❌ Seu saldo foi alterado durante a compra. Tente novamente.`
      : `⚠️ Seu usuário não foi encontrado. Tente novamente.`;
    throw err;
  }

  if (!vendedorAtualizado) {
    const err = new Error('VENDEDOR_NAO_ENCONTRADO');
    err.userMsg = `⚠️ O vendedor não foi encontrado. Contate um administrador.`;
    throw err;
  }

  // 5. Registrar log (com nomes para exibição no histórico)
  await MarketLog.create([{
    compradorId,
    compradorNome: compradorNome ?? null,
    vendedorId,
    vendedorNome:  vendedorNome  ?? oferta.sellerName ?? null,
    itemKey,
    itemNome:      oferta.itemNome,
    quantidade,
    precoUnit:     oferta.preco,
    totalBruto,
    taxa,
    totalLiquido,
    purchaseId: purchaseId || null,
    buyerWalletLinked,
    sellerWalletLinked,
    settlementStatus: buyerWalletLinked || sellerWalletLinked ? 'pending' : 'completed',
    offerSnapshot: oferta,
    buyerNameForLog: compradorNome ?? null,
    sellerNameForLog: vendedorNome ?? oferta.sellerName ?? null,
    createdAt:     new Date(),
  }], { session });

  return {
    oferta,
    totalBruto,
    taxa,
    totalLiquido,
    novoSaldoComprador: compradorAtualizado.gold,
    novoSaldoVendedor:  vendedorAtualizado.gold,
  };
}

async function liquidarCompraPendente(registro) {
  if (registro.settlementStatus === 'completed') return;
  if (registro.settlementStatus !== 'pending' || !registro.purchaseId) {
    throw new Error('Registro de liquidação do marketplace inválido.');
  }

  if (registro.buyerWalletLinked || registro.sellerWalletLinked) {
    throw new Error('Compra pendente da antiga carteira vinculada exige reconciliação manual; nenhuma chamada externa foi feita.');
  }
  let buyerBalance = null;
  let sellerBalance = null;

  const updated = await MarketLog.updateOne(
    { purchaseId: registro.purchaseId, settlementStatus: 'pending' },
    { $set: { settlementStatus: 'completed' } },
  );
  if (updated.matchedCount === 0) {
    const current = await MarketLog.findOne({ purchaseId: registro.purchaseId }, { settlementStatus: 1 }).lean();
    if (current?.settlementStatus !== 'completed') {
      throw new Error('A liquidação do marketplace não foi confirmada.');
    }
  }
  return { buyerBalance, sellerBalance };
}

async function retomarLiquidacoesPendentes(userId) {
  const pendentes = await MarketLog.find({
    settlementStatus: 'pending',
    $or: [{ compradorId: userId }, { vendedorId: userId }],
  }).sort({ createdAt: 1 }).limit(10).lean();

  for (const registro of pendentes) await liquidarCompraPendente(registro);
  return pendentes.length;
}

async function reverterCompraSemSaldo(registro) {
  if (!registro.offerSnapshot || registro.settlementStatus !== 'pending') {
    throw new Error('Não é possível reverter a compra sem o registro de reserva original.');
  }

  const offer = registro.offerSnapshot;
  const originChanges = consumirOrigemInventario(offer.origemInventario, registro.quantidade);
  const restoreOrigin = Object.fromEntries(
    Object.entries(originChanges).map(([path, delta]) => [path, -delta]),
  );

  await withTransaction(async (session) => {
    const buyerItem = await Usuario.findOneAndUpdate(
      {
        idWhatsApp: registro.compradorId,
        [`inventory.${registro.itemKey}`]: { $gte: registro.quantidade },
      },
      {
        $inc: {
          [`inventory.${registro.itemKey}`]: -registro.quantidade,
          ...(registro.buyerWalletLinked ? {} : { gold: registro.totalBruto }),
        },
      },
      { session, new: true },
    );
    if (!buyerItem) throw new Error('Não foi possível retirar o item reservado durante a reversão.');

    if (!registro.sellerWalletLinked) {
      const sellerRefunded = await Usuario.findOneAndUpdate(
        { idWhatsApp: registro.vendedorId, gold: { $gte: registro.totalLiquido } },
        { $inc: { gold: -registro.totalLiquido } },
        { session, new: true },
      );
      if (!sellerRefunded) {
        throw new Error('O saldo creditado ao vendedor já foi utilizado; a compra exige reconciliação.');
      }
    }

    const currentOffer = await Oferta.findById(offer._id, null, { session }).lean();
    if (currentOffer) {
      const restoredOffer = await Oferta.updateOne(
        { _id: offer._id },
        { $inc: { quantidade: registro.quantidade, ...restoreOrigin } },
        { session },
      );
      if (restoredOffer.matchedCount !== 1) {
        throw new Error('A oferta mudou durante a reversão da compra.');
      }
    } else {
      const sameListing = await Oferta.findOne(
        { sellerId: offer.sellerId, itemKey: offer.itemKey },
        { _id: 1 },
        { session },
      ).lean();
      if (sameListing) {
        const restoredInventory = await Usuario.updateOne(
          { idWhatsApp: registro.vendedorId },
          { $inc: { [`inventory.${registro.itemKey}`]: registro.quantidade } },
          { session },
        );
        if (restoredInventory.matchedCount !== 1) {
          throw new Error('Não foi possível devolver o item ao inventário do vendedor.');
        }
      } else {
        const restoredOfferSnapshot = {
          ...offer,
          _id: offer._id,
          ...(offer.expiresAt && new Date(offer.expiresAt) <= new Date()
            ? { expiresAt: new Date(Date.now() + CONFIG.OFERTA_EXPIRA_DIAS * 86_400_000) }
            : {}),
        };
        await Oferta.create([restoredOfferSnapshot], { session });
      }
    }

    const logUpdate = await MarketLog.updateOne(
      { _id: registro._id, settlementStatus: 'pending' },
      { $set: { settlementStatus: 'reversed' } },
      { session },
    );
    if (logUpdate.modifiedCount !== 1) {
      throw new Error('O estado da compra mudou antes de concluir a reversão.');
    }
  });
}

// ─── HANDLERS ─────────────────────────────────────────────────────────────────

// !avenda [página]
async function handleAvenda(sock, msg, jid, caption = '') {
  try {
    const pageArg = parseInt(caption.match(/avenda\s+(\d+)/i)?.[1] ?? '1', 10);
    const page    = Number.isFinite(pageArg) && pageArg > 0 ? pageArg : 1;
    const skip    = (page - 1) * CONFIG.ITENS_POR_PAGINA;

    const filtro = filtroOfertasAtivas();

    const [total, ofertas] = await Promise.all([
      Oferta.countDocuments(filtro),
      Oferta.find(filtro)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(CONFIG.ITENS_POR_PAGINA)
        .lean(),
    ]);

    if (total === 0) {
      return reply(sock, jid, msg,
        `📦 *MARKETPLACE VAZIO*\n\n` +
        `Nenhum item à venda no momento.\n\n` +
        `💡 Quer vender algo?\n` +
        `➡️ *!ofertar <item> <preco> <qtd>*`
      );
    }

    const totalPags   = Math.ceil(total / CONFIG.ITENS_POR_PAGINA);
    const agora       = new Date();

    // Agrupa por vendedor preservando a ordem de chegada (sort createdAt desc já aplicado)
    const porVendedor = new Map();
    for (const o of ofertas) {
      if (!porVendedor.has(o.sellerId)) porVendedor.set(o.sellerId, []);
      porVendedor.get(o.sellerId).push(o);
    }

    let texto  = `🛒 *MARKETPLACE* — Página ${page}/${totalPags}\n`;
    texto     += `📊 _${total} oferta(s) ativa(s)_\n`;
    texto     += `━━━━━━━━━━━━━━━━`;

    for (const [sellerId, lista] of porVendedor) {
      const num         = formatarNumero(sellerId);
      const nomeExibido = lista[0].sellerName?.trim() || num;
      texto += `\n\n👤 *${nomeExibido}* (${num})\n`;

      for (const o of lista) {
        const totalVal = o.preco * o.quantidade;
        const taxaEst  = Math.floor(totalVal * CONFIG.TAXA_MERCADO_PCT / 100);

        let expiraTexto = '';
        if (o.expiresAt) {
          const horas = Math.floor((new Date(o.expiresAt) - agora) / 3_600_000);
          if (horas <= 0) {
            expiraTexto = `     ⚠️ _Expirando agora_\n`;
          } else if (horas < 24) {
            expiraTexto = `     ⚠️ _Expira em *${horas}h*!_\n`;
          } else {
            const dias = Math.floor(horas / 24);
            expiraTexto = `     ⏳ _Expira em ${dias} dia(s)_\n`;
          }
        }

        texto += `  📦 *${o.itemNome}*\n`;
        texto += `     💵 ${formatarSaldo(o.preco)} × ${o.quantidade} un. _(total: ${formatarSaldo(totalVal)})_\n`;
        texto += `     🏦 _Taxa estimada: ${formatarSaldo(taxaEst)} (${CONFIG.TAXA_MERCADO_PCT}%)_\n`;
        texto += expiraTexto;
        texto += `     🛒 \`!buyoferta ${num} ${o.itemKey} <qtd>\`\n`;
      }
    }

    texto += `\n━━━━━━━━━━━━━━━━\n`;
    if (page > 1)         texto += `◀️ Anterior: *!avenda ${page - 1}*\n`;
    if (page < totalPags) texto += `▶️ Próxima:  *!avenda ${page + 1}*\n`;
    texto += `🔍 Buscar item: *!buscaroferta <item>*\n`;
    texto += `📋 Suas ofertas: *!minhasofertas*\n`;
    texto += `❌ Cancelar oferta: *!cancelaroferta <item>*`;

    return reply(sock, jid, msg, texto);

  } catch (e) {
    console.error('[Market] handleAvenda:', e.message, e.stack);
    return reply(sock, jid, msg,
      '⚠️ Erro ao carregar o marketplace. Tente novamente em instantes.'
    );
  }
}

// !buscaroferta <item>
async function handleBuscarOferta(sock, msg, jid, caption) {
  // Aceita tanto "!buscaroferta" quanto o alias "!buscaoferta" registrado no bot.js
  const match = caption.match(/busca(?:r)?oferta\s+([A-Za-z0-9_-]+)/i);
  if (!match) {
    return reply(sock, jid, msg,
      '⚠️ Use: *!buscaroferta <item>*\n📌 Exemplo: *!buscaroferta dinamite*'
    );
  }

  const itemKey  = match[1].toLowerCase();
  const itemNome = getNomeItem(itemKey);

  try {
    const ofertas = await Oferta.find(filtroOfertasAtivas({ itemKey }))
      .sort({ preco: 1 })
      .lean();

    if (ofertas.length === 0) {
      return reply(sock, jid, msg,
        `🔍 Nenhuma oferta encontrada para *${itemNome}*.\n\n` +
        `💡 Seja o primeiro a vender:\n` +
        `➡️ *!ofertar ${itemKey} <preco> <qtd>*`
      );
    }

    const totalDisponivel = ofertas.reduce((s, o) => s + o.quantidade, 0);
    const maisBarato      = ofertas[0];
    const agora           = new Date();

    let texto  = `🔍 *OFERTAS: ${itemNome}*\n`;
    texto     += `📊 _${ofertas.length} vendedor(es) · ${totalDisponivel} un. disponíveis_\n`;
    texto     += `━━━━━━━━━━━━━━━━\n\n`;

    for (const o of ofertas) {
      const num         = formatarNumero(o.sellerId);
      const nomeExibido = o.sellerName?.trim() || num;
      const totalVal    = o.preco * o.quantidade;
      const taxaEst     = Math.floor(totalVal * CONFIG.TAXA_MERCADO_PCT / 100);

      let expiraTexto = '';
      if (o.expiresAt) {
        const horas = Math.floor((new Date(o.expiresAt) - agora) / 3_600_000);
        if (horas <= 0) {
          expiraTexto = `   ⚠️ _Expirando agora_\n`;
        } else if (horas < 24) {
          expiraTexto = `   ⚠️ _Expira em *${horas}h*!_\n`;
        } else {
          const dias = Math.floor(horas / 24);
          expiraTexto = `   ⏳ _Expira em ${dias} dia(s)_\n`;
        }
      }

      texto += `👤 *${nomeExibido}* (${num})\n`;
      texto += `   💵 ${formatarSaldo(o.preco)} × ${o.quantidade} un. _(total: ${formatarSaldo(totalVal)})_\n`;
      texto += `   🏦 _Taxa estimada: ${formatarSaldo(taxaEst)} (${CONFIG.TAXA_MERCADO_PCT}%)_\n`;
      texto += expiraTexto;
      texto += `   🛒 \`!buyoferta ${num} ${itemKey} <qtd>\`\n\n`;
    }

    const nomeBarato = maisBarato.sellerName?.trim() || formatarNumero(maisBarato.sellerId);
    texto += `━━━━━━━━━━━━━━━━\n`;
    texto += `🏆 Mais barato: *${formatarSaldo(maisBarato.preco)}* de ${nomeBarato}\n`;
    texto += `🛒 \`!buyoferta ${formatarNumero(maisBarato.sellerId)} ${itemKey} <qtd>\``;

    return reply(sock, jid, msg, texto);
  } catch (e) {
    console.error('[Market] handleBuscarOferta:', e.message, e.stack);
    return reply(sock, jid, msg, '⚠️ Erro ao buscar oferta. Tente novamente em instantes.');
  }
}

// ─── HANDLER: OFERTAR ────────────────────────────────────────────────────────

/**
 * !ofertar <item> <preco> <quantidade>
 *
 * Fluxo:
 *  1. Identifica o usuário
 *  2. Valida argumentos (sintaxe → negócio)
 *  3. Pré-checks fora da transação (limite de ofertas, inventário) — feedback rápido
 *  4. Transação: re-valida limite + remove inventário + upsert da oferta
 *  5. Resposta de sucesso com resumo financeiro
 *
 * Nota: o comentário original dizia "!cancelaroferta <item>" no cabeçalho —
 * era um copy-paste incorreto; corrigido abaixo.
 */
async function handleOfertar(sock, msg, jid, caption) {

  // ── 1. Identificação do usuário ──────────────────────────────────────────

  const userId = getUserId(msg);
  if (!userId) {
    return reply(sock, jid, msg, '⚠️ Não foi possível identificar seu usuário.');
  }

  // Contas vinculadas ao app não usam o marketplace (ele paga em Usuario.gold, saldo legado).
  // ── 2. Parse dos argumentos ──────────────────────────────────────────────

  const match = caption.match(/ofertar\s+([A-Za-z0-9_-]+)\s+(\d+)\s+(\d+)/i);
  if (!match) {
    return reply(sock, jid, msg,
      '⚠️ *Uso correto:* `!ofertar <item> <preco> <quantidade>`\n' +
      '📌 *Exemplo:* `!ofertar dinamite 200 3`\n\n' +
      '🛒 Ver marketplace: *!avenda*'
    );
  }

  const itemKey    = match[1].toLowerCase();
  const preco      = parseInt(match[2], 10);
  const quantidade = parseInt(match[3], 10);

  // ── 3. Validações de negócio (síncronas, sem I/O) ────────────────────────

  if (!CATALOGO_COMPLETO[itemKey]) {
    // Mostra até 5 exemplos para orientar o usuário sem expor o catálogo inteiro
    const exemplos = Object.keys(CATALOGO_COMPLETO).slice(0, 5).join(', ');
    return reply(sock, jid, msg,
      `❌ Item *${itemKey}* não encontrado no catálogo.\n\n` +
      `📋 *Exemplos válidos:* ${exemplos}…\n` +
      `🔍 Ver catálogo completo: *!loja*`
    );
  }

  // parseInt já retorna inteiro; a guarda Number.isInteger cobre NaN/Infinity
  if (!Number.isInteger(preco) || preco < CONFIG.PRECO_MINIMO || preco > CONFIG.PRECO_MAXIMO) {
    return reply(sock, jid, msg,
      `❌ *Preço inválido!*\n` +
      `💵 Deve ser um inteiro entre *${formatarSaldo(CONFIG.PRECO_MINIMO)}* e *${formatarSaldo(CONFIG.PRECO_MAXIMO)}*`
    );
  }

  if (!Number.isInteger(quantidade) || quantidade < CONFIG.QTD_MINIMA || quantidade > CONFIG.QTD_MAXIMA) {
    return reply(sock, jid, msg,
      `❌ *Quantidade inválida!*\n` +
      `📊 Deve ser um inteiro entre *${CONFIG.QTD_MINIMA}* e *${CONFIG.QTD_MAXIMA}*`
    );
  }

  // ── 4. Pré-checks fora da transação ─────────────────────────────────────
  //
  // Objetivo: retornar feedback rápido antes de abrir uma transação
  // (que tem custo no servidor e nos locks). Estes checks são "otimistas":
  // podem ser invalidados por race condition — por isso são repetidos
  // dentro da transação no passo 5.

  const filtroAtivas = filtroOfertasAtivas({ sellerId: userId });

  // Busca paralela para minimizar latência
  const [usuarioDoc, qtdOfertasAtual, ofertaExistentePrevia] = await Promise.all([
    Usuario.findOne({ idWhatsApp: userId }, { nome: 1 }).lean(),
    Oferta.countDocuments(filtroAtivas),
    Oferta.exists({ sellerId: userId, itemKey }),
  ]);

  // usuarioDoc pode ser null se o usuário ainda não tiver registro;
  // nesse caso usa o número formatado como nome de exibição
  const sellerName = usuarioDoc?.nome?.trim() || formatarNumero(userId);
  const itemNome   = getNomeItem(itemKey);

  // Só bloqueia se não existir oferta prévia para este item:
  // adicionar quantidade a uma oferta existente não ocupa nova slot
  if (!ofertaExistentePrevia && qtdOfertasAtual >= CONFIG.MAX_OFERTAS_USER) {
    return reply(sock, jid, msg,
      `❌ Você atingiu o limite de *${CONFIG.MAX_OFERTAS_USER} ofertas ativas*!\n\n` +
      `📋 Ver suas ofertas: *!minhasofertas*\n` +
      `❌ Cancelar uma: *!cancelaroferta <item>*`
    );
  }

  // Verificação de inventário antes de abrir transação:
  // getQuantidadeInventario lê fora de session aqui (intencionalmente),
  // pois serve apenas para feedback rápido. A remoção real é transacional.
  const qtdInventario = await getQuantidadeInventario(userId, itemKey);
  if (qtdInventario < quantidade) {
    return reply(sock, jid, msg,
      `❌ *Itens insuficientes no inventário!*\n\n` +
      `📦 Você tem: *${qtdInventario}* ${itemNome}\n` +
      `📊 Pediu ofertar: *${quantidade}*\n\n` +
      `🎒 Ver inventário: *!inventario*`
    );
  }

  // ── 5. Transação ─────────────────────────────────────────────────────────
  //
  // Re-valida limite e inventário dentro da transação para cobrir o intervalo
  // entre os pré-checks acima e os writes abaixo (race condition).

  let ofertaCriada;

  try {
    await withTransaction(async (session) => {

      // Re-leitura transacional — garante isolamento snapshot
      const [qtdTransacional, ofertaJaExiste] = await Promise.all([
        Oferta.countDocuments(filtroOfertasAtivas({ sellerId: userId }), { session }),
        Oferta.exists({ sellerId: userId, itemKey }, { session }),
      ]);

      if (!ofertaJaExiste && qtdTransacional >= CONFIG.MAX_OFERTAS_USER) {
        const err   = new Error('LIMITE_OFERTAS');
        err.userMsg =
          `❌ Você atingiu o limite de *${CONFIG.MAX_OFERTAS_USER} ofertas ativas*!\n\n` +
          `📋 Ver suas ofertas: *!minhasofertas*\n` +
          `❌ Cancelar uma: *!cancelaroferta <item>*`;
        throw err;
      }

      // removerInventario lança com session ativa em caso de falha,
      // garantindo abort automático pela withTransaction. O retorno indica
      // de qual(is) campo(s) o item saiu — necessário pra devolver certo
      // se a oferta for cancelada depois (BUG 4 FIX).
      const distribuicao = await removerInventario(userId, itemKey, quantidade, session);

      // $inc por campo de origem, além do $inc de quantidade — acumula
      // corretamente mesmo se o vendedor já tinha oferta ativa deste item
      // (upsert soma em cima do que já estava lá).
      const incOrigem = Object.entries(distribuicao || {}).reduce((acc, [campo, qtd]) => {
        acc[`origemInventario.${campo}`] = qtd;
        return acc;
      }, {});

      // findOneAndUpdate com upsert: cria oferta se não existir,
      // ou acumula quantidade + atualiza preço/nome se já existir.
      // new: true devolve o documento pós-update para usar na resposta.
      ofertaCriada = await Oferta.findOneAndUpdate(
        { sellerId: userId, itemKey },
        {
          $set: { sellerName, itemNome, preco },
          $inc: { quantidade, ...incOrigem },
        },
        { upsert: true, new: true, session }
      );
    });

  } catch (e) {
    // Erros de negócio (e.userMsg) são exibidos diretamente ao usuário
    if (e.userMsg) return reply(sock, jid, msg, e.userMsg);

    // Erros inesperados: loga com contexto completo para diagnóstico
    console.error('[Market] handleOfertar: erro inesperado', {
      userId, itemKey, preco, quantidade,
      erro:  e.message,
      stack: e.stack,
    });
    return reply(sock, jid, msg,
      '⚠️ Erro interno ao criar oferta. Seus itens *não foram afetados*.\n' +
      'Aguarde alguns instantes e tente novamente.'
    );
  }

  // ── 6. Resposta de sucesso ────────────────────────────────────────────────
  //
  // Contagem relida pós-commit para refletir o estado real do banco,
  // evitando exibir um valor defasado calculado antes da transação.

  const restantes = await Oferta.countDocuments(filtroOfertasAtivas({ sellerId: userId }));

  // Calcula tempo de expiração a partir do documento atualizado
  let expiraTexto = '';
  if (ofertaCriada.expiresAt) {
    const msRestantes = new Date(ofertaCriada.expiresAt) - Date.now();
    const horas       = Math.floor(msRestantes / 3_600_000);
    const dias        = Math.floor(horas / 24);

    if (horas <= 0) {
      // Pode ocorrer se o clock do servidor divergir ou o TTL estiver muito baixo
      expiraTexto = `\n⚠️ *Atenção:* oferta já expirada — contate um admin`;
    } else {
      const tempoLabel = dias > 0
        ? `${dias} dia(s)`
        : `${horas}h`;
      expiraTexto =
        `\n⏳ *Expira em:* ${tempoLabel}` +
        ` (${ofertaCriada.expiresAt.toLocaleDateString('pt-BR')})`;
    }
  }

  // Estimativa financeira baseada no estoque total atual da oferta
  const totalOferta     = preco * ofertaCriada.quantidade;
  const taxaEstimada    = Math.floor(totalOferta * CONFIG.TAXA_MERCADO_PCT / 100);
  const liquidoEstimado = totalOferta - taxaEstimada;

  return reply(sock, jid, msg,
    `✅ *OFERTA CRIADA COM SUCESSO!*\n\n` +
    `📦 *Item:* ${itemNome}\n` +
    `💵 *Preço unitário:* ${formatarSaldo(preco)}\n` +
    `📊 *Quantidade adicionada:* ${quantidade}\n` +
    `💰 *Estoque total na oferta:* ${ofertaCriada.quantidade}\n` +
    expiraTexto + `\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `💸 *Se vender tudo:* ~${formatarSaldo(liquidoEstimado)} líquido\n` +
    `   _(bruto ${formatarSaldo(totalOferta)} − taxa ${formatarSaldo(taxaEstimada)})_\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📋 *Suas ofertas ativas:* ${restantes}/${CONFIG.MAX_OFERTAS_USER}\n` +
    `🛒 Ver marketplace: *!avenda*\n` +
    `❌ Cancelar oferta: *!cancelaroferta ${itemKey}*`
  );
}

// ─── HANDLER: BUY ─────────────────────────────────────────────────────────────

// !buy
async function handleBuy(sock, msg, jid, caption) {

  // ── 1. Identificação do comprador ────────────────────────────────────────

  const compradorId = getUserId(msg);
  if (!compradorId) {
    return reply(sock, jid, msg, '⚠️ Não foi possível identificar seu usuário.');
  }

  // ── 2. Parse dos argumentos ──────────────────────────────────────────────

  const args = parseBuyArgs(caption);
  if (!args) {
    return reply(sock, jid, msg,
      '⚠️ *Uso correto:* `!buyoferta <vendedor> <item> <quantidade>`\n' +
      '📌 *Exemplo:* `!buyoferta 5511999999999 dinamite 2`\n\n' +
      '🛒 Ver vendedores disponíveis: *!avenda*'
    );
  }

  const { vendedorRaw, itemKey, quantidade } = args;

  // ── 4. Validações síncronas de negócio ───────────────────────────────────

  const vendedorId = toJid(vendedorRaw);
  if (!vendedorId) {
    return reply(sock, jid, msg,
      `❌ Número de vendedor inválido: *${vendedorRaw}*\n\n` +
      `📱 Use o número com DDD: *5511999999999*\n` +
      `🛒 Ver vendedores: *!avenda*`
    );
  }

  if (formatarNumero(compradorId) === formatarNumero(vendedorId)) {
    return reply(sock, jid, msg, '❌ Você não pode comprar sua própria oferta!');
  }

  // Bloqueia se comprador OU vendedor estiver vinculado (o vendedor receberia gold legado).
  if (quantidade > CONFIG.MAX_QTD_COMPRA) {
    return reply(sock, jid, msg,
      `❌ Quantidade máxima por compra: *${CONFIG.MAX_QTD_COMPRA}*\n` +
      `📊 Você pediu: *${quantidade}*`
    );
  }

  const purchaseId = crypto.createHash('sha256')
    .update(`${compradorId}:${msg?.key?.id || crypto.randomUUID()}`)
    .digest('hex');

  const compraAnterior = await MarketLog.findOne({ purchaseId }).lean();
  if (compraAnterior) {
    try {
      if (compraAnterior.settlementStatus === 'pending') {
        await liquidarCompraPendente(compraAnterior);
      }
      return reply(sock, jid, msg, '✅ Esta compra já foi processada e não será cobrada novamente.');
    } catch (error) {
      if (error.settlementReversed) {
        return reply(sock, jid, msg,
          '❌ A compra anterior foi cancelada porque o saldo ficou insuficiente; o item e a oferta foram restaurados. Tente novamente após conferir seu saldo.'
        );
      }
      console.error('[Market] Não foi possível retomar compra pendente:', error);
      return reply(sock, jid, msg,
        '⏳ A compra anterior continua em processamento. O saldo e a entrega serão reconciliados sem cobrança duplicada; tente novamente em instantes.'
      );
    }
  }

  try {
    const pendentesConcluidas = await retomarLiquidacoesPendentes(compradorId);
    if (pendentesConcluidas > 0) {
      await reply(sock, jid, msg, '✅ Uma liquidação anterior foi concluída antes de iniciar outra compra.');
    }
  } catch (error) {
    if (error.settlementReversed) {
      return reply(sock, jid, msg,
        '❌ Uma compra pendente foi cancelada porque o saldo ficou insuficiente; o item e a oferta foram restaurados. Confira seu saldo antes de comprar novamente.'
      );
    }
    console.error('[Market] Há liquidação pendente para o comprador:', error);
    return reply(sock, jid, msg,
      '⏳ Uma compra anterior ainda está sendo liquidada. Não iniciei outra compra; tente novamente em instantes.'
    );
  }

  // ── 3. Cooldown ──────────────────────────────────────────────────────────
  const espera = checkCooldown(compradorId);
  if (espera > 0) {
    return reply(sock, jid, msg, `⏳ Aguarde *${espera}s* antes de comprar novamente.`);
  }

  // ── 4. Verificação prévia de saldo (antes de abrir transação) ────────────

  const [compradorPreview] = await Promise.all([
    Usuario.findOne({ idWhatsApp: compradorId }, { gold: 1, nome: 1 }).lean(),
  ]);
  const buyerWallet = null;
  const sellerWallet = null;

  if (!compradorPreview) {
    return reply(sock, jid, msg, '⚠️ Seu usuário não foi encontrado. Tente novamente.');
  }

  const ofertaPreview = await Oferta.findOne(
    filtroOfertasAtivas({ sellerId: vendedorId, itemKey }),
    { preco: 1, quantidade: 1, itemNome: 1 }
  ).lean().catch(() => null);

  if (!ofertaPreview) {
    return reply(sock, jid, msg,
      `❌ Oferta não encontrada!\n\n` +
      `🔍 Ver ofertas de *${getNomeItem(itemKey)}*: *!buscaroferta ${itemKey}*\n` +
      `🛒 Ver todas as ofertas: *!avenda*`
    );
  }

  if (ofertaPreview.quantidade < quantidade) {
    return reply(sock, jid, msg,
      `⚠️ *Quantidade indisponível!*\n\n` +
      `📦 Estoque atual: *${ofertaPreview.quantidade}*\n` +
      `📊 Você pediu: *${quantidade}*\n` +
      `🔍 Ver oferta: *!buscaroferta ${itemKey}*`
    );
  }

  const custoTotal = ofertaPreview.preco * quantidade;
  const buyerWalletLinked = Boolean(buyerWallet);
  const sellerWalletLinked = Boolean(sellerWallet);
  const saldoDisponivel = buyerWalletLinked ? buyerWallet.balanceCents : (compradorPreview.gold ?? 0);
  if (saldoDisponivel < custoTotal) {
    const faltam = custoTotal - saldoDisponivel;
    const moedaComprador = buyerWallet || {};
    return reply(sock, jid, msg,
      `❌ *SALDO INSUFICIENTE*\n\n` +
      `💰 Você tem: *${formatarSaldo(saldoDisponivel, moedaComprador)}*\n` +
      `💸 Precisa: *${formatarSaldo(custoTotal, moedaComprador)}* _(${formatarSaldo(ofertaPreview.preco, moedaComprador)} × ${quantidade})_\n` +
      `📊 Faltam: *${formatarSaldo(faltam, moedaComprador)}*`
    );
  }

  // ── 5. Registro do cooldown ──────────────────────────────────────────────
  // Setado somente após TODAS as validações síncronas e prévias passarem

  BUY_COOLDOWNS.set(compradorId, Date.now());

  // ── 6. Busca de nomes para exibição (fora da transação) ──────────────────

  let compradorNome = compradorPreview.nome?.trim() ?? null;
  let vendedorNome  = null;

  try {
    const vendedorDoc = await Usuario.findOne(
      { idWhatsApp: vendedorId },
      { nome: 1 }
    ).lean();
    vendedorNome = vendedorDoc?.nome?.trim() ?? null;
  } catch (e) {
    console.warn('[Market] handleBuy: falha ao buscar nome do vendedor (não crítico):', e.message);
  }

  // ── 7. Reserva do item e registro da compra ──────────────────────────────

  let resultado;

  try {
    resultado = await withTransaction((session) =>
      executarCompra(
        {
          compradorId, vendedorId, itemKey, quantidade, compradorNome, vendedorNome,
          buyerWalletLinked, sellerWalletLinked, purchaseId,
        },
        session
      )
    );
  } catch (e) {
    // Erro: libera o cooldown pra permitir retry imediato — não faz sentido
    // punir uma tentativa que nem chegou a completar.
    BUY_COOLDOWNS.delete(compradorId);

    const savedPurchase = await MarketLog.findOne({ purchaseId }).lean().catch(() => null);
    if (savedPurchase?.settlementStatus === 'pending') {
      try {
        await liquidarCompraPendente(savedPurchase);
        return reply(sock, jid, msg, '✅ Esta compra já foi processada e não será cobrada novamente.');
      } catch (settlementError) {
        console.error('[Market] Liquidação pendente após tentativa concorrente:', settlementError);
        return reply(sock, jid, msg,
          '⏳ A compra foi registrada e sua liquidação ainda está pendente. Tente novamente em instantes; não haverá cobrança duplicada.'
        );
      }
    }

    if (e.userMsg) {
      return reply(sock, jid, msg, e.userMsg);
    }

    console.error('[Market] handleBuy: erro inesperado na transação', {
      compradorId,
      vendedorId,
      itemKey,
      quantidade,
      erro:  e.message,
      stack: e.stack,
    });

    return reply(sock, jid, msg,
      '⚠️ Erro interno ao processar a compra.\n' +
      'Seus dados *não foram alterados*. Tente novamente em alguns instantes.'
    );
  }

  let settlement = { buyerBalance: null, sellerBalance: null };
  if (buyerWalletLinked || sellerWalletLinked) {
    try {
      const purchaseLog = await MarketLog.findOne({ purchaseId }).lean();
      if (!purchaseLog) throw new Error('Registro da compra não encontrado após a reserva.');
      settlement = await liquidarCompraPendente(purchaseLog);
    } catch (error) {
      if (error.settlementReversed) {
        BUY_COOLDOWNS.delete(compradorId);
        return reply(sock, jid, msg,
          `❌ Saldo insuficiente. A compra foi cancelada e o item/oferta foram restaurados. Total necessário: *${formatarSaldo(custoTotal, buyerWallet)}*.`
        );
      }
      console.error('[Market] A compra foi registrada, mas sua liquidação está pendente:', error);
      return reply(sock, jid, msg,
        '⏳ Item e oferta foram registrados; a movimentação do saldo está pendente. Ela será retomada na próxima compra e não será cobrada duas vezes.'
      );
    }
  }

  const saldoCompradorFinal = buyerWalletLinked
    ? settlement.buyerBalance
    : resultado.novoSaldoComprador;
  const saldoVendedorFinal = sellerWalletLinked
    ? settlement.sellerBalance
    : resultado.novoSaldoVendedor;

  // ── CORREÇÃO: sem sucesso, NÃO apagamos o cooldown aqui — antes isso
  // liberava o comprador pra comprar de novo instantaneamente após uma
  // compra bem-sucedida, anulando o throttle de 3s entre compras. Agora o
  // cooldown expira sozinho (checkCooldown já calcula por timestamp, e o
  // _cooldownCleanup varre entradas velhas periodicamente).

  // ── 9. Notificações pós-transação ────────────────────────────────────────

  await reply(
    sock, jid, msg,
    buildMensagemComprador({
      ...resultado,
      quantidade,
      novoSaldoComprador: saldoCompradorFinal,
      currencyInfoBuyer: buyerWallet || {},
      currencyInfoSeller: sellerWallet || {},
    })
  );

  sock
    .sendMessage(
      vendedorId,
      buildMensagemVendedor({
        ...resultado,
        quantidade,
        compradorId,
        compradorNome,
        novoSaldoVendedor: saldoVendedorFinal,
        currencyInfoBuyer: buyerWallet || {},
        currencyInfoSeller: sellerWallet || {},
      })
    )
    .catch((err) =>
      console.warn('[Market] handleBuy: notificação ao vendedor falhou:', {
        vendedorId,
        erro: err.message,
      })
    );
}

// handleCancelarOferta
async function handleCancelarOferta(sock, msg, jid, caption) {
  const userId = getUserId(msg);
  if (!userId) return reply(sock, jid, msg, '⚠️ Não foi possível identificar seu usuário.');

  // Aceita tanto "!cancelaroferta" quanto o alias "!canceloferta" registrado no bot.js
  const match = caption.match(/cancela(?:r)?oferta\s+([A-Za-z0-9_-]+)/i);
  if (!match) {
    return reply(sock, jid, msg,
      '⚠️ Use: *!cancelaroferta <item>*\nExemplo: *!cancelaroferta dinamite*'
    );
  }

  const itemKey = match[1].toLowerCase();

  try {
    const ofertaCancelada = await withTransaction(async (session) => {
      // ✅ Oferta.exists removido — findOneAndDelete já retorna null se não existir,
      // eliminando o TOCTOU entre o exists externo e o delete interno.
      // Não filtramos por expiresAt intencionalmente: o usuário deve poder
      // cancelar (e recuperar os itens de) uma oferta expirada ainda não
      // removida pelo TTL.
      const oferta = await Oferta.findOneAndDelete(
        { sellerId: userId, itemKey },
        { session }
      ).lean();

      if (!oferta) {
        const err   = new Error('OFERTA_NAO_ENCONTRADA');
        err.userMsg =
          `❌ Você não tem oferta ativa de *${getNomeItem(itemKey)}*.\n\n` +
          `Ver suas ofertas: *!minhasofertas*`;
        throw err;
      }

      // ── BUG 4 FIX: devolve cada unidade pro campo de onde ela realmente
      // saiu (inventory / itensRoubo / itensSec / itensPesca), em vez de
      // sempre jogar tudo em "inventory". Ofertas criadas antes desta
      // correção não têm origemInventario — pra essas, mantém o comportamento
      // antigo (tudo em "inventory") como fallback.
      const origemObj  = oferta.origemInventario instanceof Map
        ? Object.fromEntries(oferta.origemInventario)
        : (oferta.origemInventario || {});
      const somaOrigem = Object.values(origemObj).reduce((a, b) => a + (b || 0), 0);

      if (somaOrigem > 0) {
        await Promise.all(
          Object.entries(origemObj)
            .filter(([, qtd]) => qtd > 0)
            .map(([campo, qtd]) =>
              Usuario.findOneAndUpdate(
                { idWhatsApp: userId },
                { $inc: { [`${campo}.${itemKey}`]: qtd } },
                { session, upsert: true }
              )
            )
        );

        // Sobra não coberta pelo mapa de origem (drift ou dado parcialmente
        // legado) — devolve pro fallback antigo, pra nunca perder unidades.
        const faltante = oferta.quantidade - somaOrigem;
        if (faltante > 0) {
          await adicionarInventario(userId, itemKey, faltante, session);
        }
      } else {
        // Oferta sem origemInventario registrado (criada antes da correção) —
        // comportamento legado preservado.
        await adicionarInventario(userId, itemKey, oferta.quantidade, session);
      }

      return oferta;
    });

    // ✅ filtroOfertasAtivas garante consistência com handleOfertar e handleMinhasOfertas:
    // ofertas expiradas ainda não limpas pelo TTL não inflam a contagem exibida.
    const restantes = await Oferta.countDocuments(filtroOfertasAtivas({ sellerId: userId }));

    return reply(sock, jid, msg,
      `✅ *OFERTA CANCELADA!*\n\n` +
      `📦 *${ofertaCancelada.itemNome}* × ${ofertaCancelada.quantidade} devolvido(s) ao inventário.\n` +
      `📊 Ofertas ativas restantes: *${restantes}/${CONFIG.MAX_OFERTAS_USER}*`
    );
  } catch (e) {
    if (e.userMsg) return reply(sock, jid, msg, e.userMsg);
    console.error('[Market] handleCancelarOferta:', { userId, itemKey, erro: e.message });
    return reply(sock, jid, msg, '⚠️ Erro ao cancelar oferta! Seus itens não foram afetados.');
  }
}

// handleMinhasOfertas
async function handleMinhasOfertas(sock, msg, jid) {
  const userId = getUserId(msg);
  if (!userId) return reply(sock, jid, msg, '⚠️ Não foi possível identificar seu usuário.');

  try {
    // ✅ filtroOfertasAtivas em vez de filtro inline — evita dessincronização
    // caso a função central seja alterada no futuro
    const ofertas = await Oferta
      .find(filtroOfertasAtivas({ sellerId: userId }))
      .sort({ createdAt: -1 })
      .lean();

    if (ofertas.length === 0) {
      return reply(sock, jid, msg,
        `📦 *VOCÊ NÃO TEM OFERTAS ATIVAS*\n\n` +
        `Crie uma com: *!ofertar <item> <preco> <qtd>*\n` +
        `Ver marketplace: *!avenda*`
      );
    }

    const agora        = new Date();
    let texto          = `📊 *SUAS OFERTAS ATIVAS* (${ofertas.length}/${CONFIG.MAX_OFERTAS_USER})\n\n`;
    let totalPotencial = 0;

    for (const o of ofertas) {
      const totalItem = o.preco * o.quantidade;
      const taxa      = Math.floor(totalItem * CONFIG.TAXA_MERCADO_PCT / 100);
      const liquido   = totalItem - taxa;
      totalPotencial += liquido;

      let expiraTexto = '';
      if (o.expiresAt) {
        const horas = Math.floor((o.expiresAt - agora) / 3_600_000);
        // ✅ horas <= 0 cobre deriva de clock e race entre find e loop
        expiraTexto = horas <= 0
          ? `\n   ⚠️ Expirando agora!`
          : horas < 24
            ? `\n   ⚠️ Expira em *${horas}h*!`
            : `\n   ⏳ Expira: ${o.expiresAt.toLocaleDateString('pt-BR')}`;
      }

      texto += `📦 *${o.itemNome}*\n`;
      texto += `   💵 ${formatarSaldo(o.preco)} × ${o.quantidade} un.\n`;
      texto += `   💰 Você recebe: *${formatarSaldo(liquido)}* _(bruto ${formatarSaldo(totalItem)} − taxa ${formatarSaldo(taxa)})_`;
      texto += expiraTexto + '\n';
      texto += `   ❌ \`!cancelaroferta ${o.itemKey}\`\n\n`;
    }

    texto += `━━━━━━━━━━━━━━━━\n`;
    texto += `💰 *Potencial líquido total:* ${formatarSaldo(totalPotencial)}`;

    return reply(sock, jid, msg, texto);
  } catch (e) {
    console.error('[Market] handleMinhasOfertas:', { userId, erro: e.message });
    return reply(sock, jid, msg, '⚠️ Erro ao carregar suas ofertas!');
  }
}

// handleHistoricoMarket
async function handleHistoricoMarket(sock, msg, jid, caption = '') {
  const userId = getUserId(msg);
  if (!userId) return reply(sock, jid, msg, '⚠️ Não foi possível identificar seu usuário.');

  // Aceita tanto "!historicomarket" quanto o alias "!mercadohistorico" registrado
  // no bot.js — antes, usar o alias sempre caía silenciosamente na página 1.
  const pageStr = caption.match(/(?:historicomarket|mercadohistorico)\s+(\d+)/i)?.[1] ?? '1';
  const page    = parseInt(pageStr, 10);

  if (!Number.isFinite(page) || page < 1) {
    return reply(sock, jid, msg,
      '⚠️ Página inválida.\nUse: *!historicomarket <número>*\nExemplo: *!historicomarket 2*'
    );
  }

  const LIMITE = 10;
  const skip   = (page - 1) * LIMITE;

  // Campos necessários para exibição — evita trazer o documento inteiro
  const PROJECTION = {
    compradorId:   1,
    compradorNome: 1,
    vendedorId:    1,
    vendedorNome:  1,
    itemNome:      1,
    quantidade:    1,
    precoUnit:     1,
    totalBruto:    1,
    taxa:          1,
    totalLiquido:  1,
    createdAt:     1,
  };

  try {
    // Conta cada lado separadamente para usar os índices compostos
    // (compradorId + createdAt) e (vendedorId + createdAt) sem collection scan
    const [totalComprador, totalVendedor] = await Promise.all([
      MarketLog.countDocuments({ compradorId: userId }),
      MarketLog.countDocuments({ vendedorId:  userId }),
    ]);

    // Upper bound antes da deduplicação. Auto-compras (compradorId === vendedorId,
    // caso raro) fazem totalEstimado contar o mesmo doc duas vezes — aceitável:
    // gera no máximo uma página extra vazia, nunca perde registros.
    const totalEstimado = totalComprador + totalVendedor;

    if (totalEstimado === 0) {
      return reply(sock, jid, msg,
        `📋 Você ainda não tem transações no marketplace.\n\nVer ofertas: *!avenda*`
      );
    }

    // BUG 5 FIX: totalReal era calculado sobre `todos`, que é uma slice
    // limitada por buscarAte — não o universo completo. Para páginas avançadas
    // o valor ficava menor que o real, gerando totalPags incorreto e escondendo
    // páginas existentes. totalEstimado é o upper bound correto: errar para
    // cima (mostrar uma página a mais) é inofensivo; errar para baixo
    // (esconder páginas) perde dados do usuário.
    const totalPags = Math.ceil(totalEstimado / LIMITE);

    if (page > totalPags) {
      return reply(sock, jid, msg,
        `⚠️ Página *${page}* não existe. O histórico tem *${totalPags}* página(s).\n\n` +
        `Última página: *!historicomarket ${totalPags}*`
      );
    }

    // Busca apenas os documentos necessários para a página atual + margem para
    // absorver duplicatas do merge antes de atingir LIMITE registros úteis
    const buscarAte = skip + LIMITE * 2;

    const [resultadosComprador, resultadosVendedor] = await Promise.all([
      MarketLog.find({ compradorId: userId }, PROJECTION)
        .sort({ createdAt: -1 })
        .limit(buscarAte)
        .lean(),
      MarketLog.find({ vendedorId: userId }, PROJECTION)
        .sort({ createdAt: -1 })
        .limit(buscarAte)
        .lean(),
    ]);

    // Merge + deduplicação + ordenação cronológica inversa
    const vistos = new Set();
    const todos  = [...resultadosComprador, ...resultadosVendedor]
      .filter(doc => {
        const id = doc._id.toString();
        if (vistos.has(id)) return false;
        vistos.add(id);
        return true;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const logs = todos.slice(skip, skip + LIMITE);

    // Fallback para o caso extremo onde buscarAte não trouxe docs suficientes
    // para cobrir skip + LIMITE após deduplicação (histórico muito denso em
    // auto-compras). Avisa em vez de mostrar página vazia sem explicação.
    if (logs.length === 0) {
      return reply(sock, jid, msg,
        `⚠️ Página *${page}* não tem registros suficientes.\n\n` +
        `Tente: *!historicomarket ${Math.max(1, page - 1)}*`
      );
    }

    let texto = `📋 *HISTÓRICO* — Página ${page}/${totalPags} _(${totalEstimado} transação/ões)_\n\n`;

    for (const log of logs) {
      const ehComprador     = log.compradorId === userId;
      const dt              = new Date(log.createdAt);
      const data            = dt.toLocaleDateString('pt-BR');
      const hora            = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const contraparteId   = ehComprador ? log.vendedorId   : log.compradorId;
      const contraparteNome = ehComprador ? log.vendedorNome : log.compradorNome;
      const contraparteExib = contraparteNome
        ? `${contraparteNome} (${formatarNumero(contraparteId)})`
        : formatarNumero(contraparteId);

      texto += ehComprador
        ? `🛒 *COMPRA* — ${data} ${hora}\n`
        : `📥 *VENDA* — ${data} ${hora}\n`;

      texto += `   📦 ${log.itemNome} × ${log.quantidade} _(${formatarSaldo(log.precoUnit)}/un.)_\n`;

      if (ehComprador) {
        texto +=
          `   💸 Pago: *${formatarSaldo(log.totalBruto)}* ` +
          `_(taxa ${formatarSaldo(log.taxa)} paga pelo vendedor)_ | ${contraparteExib}\n\n`;
      } else {
        texto +=
          `   💰 Bruto: ${formatarSaldo(log.totalBruto)} − taxa ${formatarSaldo(log.taxa)} = ` +
          `*+${formatarSaldo(log.totalLiquido)}* | ${contraparteExib}\n\n`;
      }
    }

    texto += `━━━━━━━━━━━━━━━━\n`;
    if (page > 1)         texto += `📄 Anterior: *!historicomarket ${page - 1}*\n`;
    if (page < totalPags) texto += `📄 Próxima:  *!historicomarket ${page + 1}*\n`;

    return reply(sock, jid, msg, texto);
  } catch (e) {
    console.error('[Market] handleHistoricoMarket:', { userId, page, erro: e.message, stack: e.stack });
    return reply(sock, jid, msg, '⚠️ Erro ao carregar histórico!');
  }
}

// ─── ALIASES ──────────────────────────────────────────────────────────────────

async function handleOfertasRecebidas(sock, msg, jid) {
  return handleMinhasOfertas(sock, msg, jid);
}

async function handleAceitarOfferta(sock, msg, jid) {
  return reply(sock, jid, msg,
    '💼 Este comando foi substituído por *!buyoferta*!\n\n' +
    'Exemplo: *!buyoferta 5511999999999 dinamite 2*\n' +
    'Ver ofertas disponíveis: *!avenda*'
  );
}

// ─── EXPORTAÇÕES ──────────────────────────────────────────────────────────────

module.exports = {
  // Comandos principais
  handleAvenda,
  handleBuscarOferta,
  handleOfertar,
  handleBuy,
  handleCancelarOferta,
  handleMinhasOfertas,
  handleHistoricoMarket,

  // Compatibilidade retroativa
  handleOfertasRecebidas,
  handleAceitarOfferta,

  // Modelos Mongoose
  Oferta,
  MarketLog,

  // Configuração e catálogo
  CONFIG,
  registerCatalog,
};