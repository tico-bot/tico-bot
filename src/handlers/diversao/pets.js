const path          = require('path');
const fs            = require('fs');
const Usuario       = require(path.join(__dirname, '..', '..', 'models', 'Usuario'));
const CarteiraGrupo = require(path.join(__dirname, '..', '..', 'models', 'CarteiraGrupo'));
const { resolverJidCarteira, getCarteira } = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));
const { isAdmin } = require('../grupo/helpers');
const { getAlternateSenderJids, resolveDisplayName } = require('../../utils/identity');
const { logError } = require('../../utils/logging');
const { ABRIGO_TEMPO_MAXIMO_MS, filtroAbrigoDoGrupo, limparPetsExpiradosDoAbrigo } = require('../../utils/petShelter');
const { atualizarNecessidades, obterEstagioPet, calcularHumorPet, gerarPetId } = require('../../utils/petNeeds');
const GrupoConfig = require('../../models/GrupoConfig');

const { prepareDailyMissionState } = require('./missoes');

const somenteGrupo = (jid) => jid?.endsWith('@g.us') ?? false;

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  STAT_MAX:           100,
  NIVEL_MAX:          100,
  COOLDOWN_ALIMENTAR: 30 * 60 * 1000,  // 30 min
  COOLDOWN_BRINCAR:   20 * 60 * 1000,  // 20 min
  COOLDOWN_CURAR:     60 * 60 * 1000,  // 1 hora
};

// ─── CATÁLOGO DE PERSONAGENS ──────────────────────────────────────────────────
// Os nomes e imagens vêm de /image/Pet. A raridade é sorteada no spawn.
const PET_IMAGE_DIR = path.resolve(__dirname, '..', '..', '..', 'image', 'Pet');
const PERSONAGENS = [
  { type: 'arrogante', nome: 'Arrogante', arquivo: 'Arrogante.png' },
  { type: 'bolsonaro', nome: 'Bolsonaro', arquivo: 'Bolsonaro.png' },
  { type: 'douglas', nome: 'Douglas', arquivo: 'Douglas.png' },
  { type: 'flavio-bolsonaro', nome: 'Flávio Bolsonaro', arquivo: 'FlávioBolsonaro.jpeg' },
  { type: 'lula', nome: 'Lula', arquivo: 'Lula.jpeg' },
  { type: 'manoel-gomes-judeo', nome: 'Manoel Gomes Judeo', arquivo: 'Manoel Gomes Judeo.png' },
  { type: 'oruam', nome: 'Oruam', arquivo: 'Oruam.png' },
  { type: 'rodney', nome: 'Rodney', arquivo: 'Rodney.png' },
  { type: 'seu-ze', nome: 'Seu Zé', arquivo: 'SeuZé.png' },
  { type: 'mbappeditador', nome: 'Mbappé Ditador', arquivo: 'mbappeditador.png' },
  { type: 'yuri22', nome: 'Yuri 22', arquivo: 'yuri22.png' },
];
const RARIDADES_PET = [
  { rarity: 'COMUM', peso: 45, xpMult: 1.0, pontMult: 1.0, catchRate: 0.75 },
  { rarity: 'RARO', peso: 30, xpMult: 1.2, pontMult: 1.1, catchRate: 0.50 },
  { rarity: 'ULTRA-RARO', peso: 18, xpMult: 1.5, pontMult: 1.4, catchRate: 0.30 },
  { rarity: 'LENDÁRIO', peso: 7, xpMult: 2.0, pontMult: 2.0, catchRate: 0.12 },
];
const PET_SYSTEM = Object.fromEntries(PERSONAGENS.map(personagem => [personagem.type, {
  ...personagem, emoji: '🐾', desc: `Personagem ${personagem.nome}.`, rarity: 'COMUM',
  xpMult: 1.0, pontMult: 1.0, catchRate: 0.75,
}]));
function getPersonagem(petOrType) {
  const type = typeof petOrType === 'string' ? petOrType : petOrType?.type;
  if (PET_SYSTEM[type]) return PET_SYSTEM[type];
  const nome = String(typeof petOrType === 'object' ? (petOrType?.name || petOrType?.nome || '') : '');
  const normalizar = valor => valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const match = PERSONAGENS.find(p => normalizar(p.nome) === normalizar(nome));
  if (match) return PET_SYSTEM[match.type];
  const key = type || nome || 'personagem';
  const hash = [...key].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0);
  return PET_SYSTEM[PERSONAGENS[hash % PERSONAGENS.length].type];
}
function getPetImage(personagem) {
  return fs.readFileSync(path.join(PET_IMAGE_DIR, personagem.arquivo));
}

async function replyWithPetImage(sock, jid, msg, pet, caption, options = {}) {
  const def = getPersonagem(pet);
  try {
    return await sock.sendMessage(jid, {
      image: getPetImage(def),
      caption,
      ...(options.mentions ? { mentions: options.mentions } : {}),
    }, { quoted: msg });
  } catch (err) {
    console.error(`[pets:${options.context || 'imagem'}] Não foi possível enviar imagem:`, err.message || err);
    return reply(sock, jid, msg, caption);
  }
}
function sortearRaridadePet() {
  const total = RARIDADES_PET.reduce((sum, item) => sum + item.peso, 0);
  let roll = Math.random() * total;
  for (const item of RARIDADES_PET) {
    roll -= item.peso;
    if (roll < 0) return item;
  }
  return RARIDADES_PET[0];
}

const RARITY_EMOJI = {
  'COMUM':      '⭐',
  'RARO':       '🌟',
  'ULTRA-RARO': '💎',
  'LENDÁRIO':   '👑',
};

const MEDALS = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

// ─── ESTADO EM MEMÓRIA ────────────────────────────────────────────────────────
const spawnedPets = new Map(); // jid    → { type, rarity, spawnedAt }

// Cache com TTL de 5 minutos para evitar dados velhos presos em memória
const PET_CACHE_TTL_MS = 5 * 60 * 1000;
const petCache = {
  _store: new Map(),

  get(userId) {
    const entry = this._store.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.ts > PET_CACHE_TTL_MS) {
      this._store.delete(userId);
      return null;
    }
    return entry.data;
  },

  set(userId, pet) {
    this._store.set(userId, { data: pet, ts: Date.now() });
  },

  delete(userId) {
    this._store.delete(userId);
  },

  has(userId) {
    return this.get(userId) !== null;
  },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Extrai e resolve o ID do usuário para a mesma carteira do grupo.
 * @param {object} msg
 * @param {string} [idGrupo]
 * @returns {Promise<string|null>}
 */
async function getUserId(msg, idGrupo) {
  const raw = msg?.key?.participant || msg?.key?.remoteJid;
  if (!raw) return null;
  return resolverJidCarteira(raw, idGrupo);
}

/**
 * Responde uma mensagem com quote.
 * @param {object} sock
 * @param {string} jid
 * @param {object} msg
 * @param {string} text
 */
function reply(sock, jid, msg, text) {
  return sock.sendMessage(jid, { text }, { quoted: msg });
}

// Mapa de cooldowns isolado
const _cooldownMap = new Map();

/**
 * Verifica cooldown de um comando para um usuário.
 * @param {string} userId
 * @param {string} cmd
 * @param {number} ms — duração do cooldown em milissegundos
 * @returns {number} 0 se liberado, ou ms restantes se ainda em cooldown
 */
function checkCooldown(userId, cmd, ms) {
  const key  = `${userId}:${cmd}`;
  const last = _cooldownMap.get(key) ?? 0;
  const diff = Date.now() - last;
  if (diff < ms) return ms - diff;

  // Limpeza de entradas velhas (> 2h) se o Map crescer muito
  if (_cooldownMap.size > 500) {
    const agora = Date.now();
    for (const [k, ts] of _cooldownMap.entries()) {
      if (agora - ts > 2 * 60 * 60 * 1000) _cooldownMap.delete(k);
    }
  }

  _cooldownMap.set(key, Date.now());
  return 0;
}

/**
 * Remove o cooldown de um usuário para um comando (útil em rollbacks).
 * @param {string} userId
 * @param {string} cmd
 */
function clearCooldown(userId, cmd) {
  _cooldownMap.delete(`${userId}:${cmd}`);
}

/**
 * Formata milissegundos em string legível.
 * Ex: 90min → "1h 30min" | 75s → "1min 15s"
 * @param {number} ms
 * @returns {string}
 */
function formatarTempo(ms) {
  if (ms <= 0) return '0s';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min ${s}s`;
  return `${s}s`;
}

/**
 * Retorna o estado de humor do pet com base na média dos atributos.
 * @param {object} pet
 * @returns {string}
 */
function getHumor(pet) {
  return calcularHumorPet(pet);
}

/**
 * Calcula o score de ranking do pet (nível tem peso maior que XP).
 * @param {object} pet
 * @returns {number}
 */
function getRankScore(pet) {
  return ((pet.level ?? 1) * 1000 + (pet.xp ?? 0)) * (pet.pontMult ?? 1);
}

/**
 * Busca o pet ativo do usuário (cache com TTL → banco).
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
function petParaObjeto(pet) {
  if (!pet) return null;
  return typeof pet.toObject === 'function' ? pet.toObject() : { ...pet };
}

function mesmaIdentidadePet(a, b) {
  if (!a || !b) return false;
  if (a.petId && b.petId) return a.petId === b.petId;
  return a.type === b.type && a.name === b.name && String(a.capturedAt || '') === String(b.capturedAt || '');
}

async function obterCarteiraComColecao(userId, idGrupo) {
  const carteira = await getCarteira(userId, idGrupo);
  if (!carteira) return null;

  let alterada = false;
  const colecao = Array.from(carteira.pets || []).map(petParaObjeto).filter(p => p?.name);
  let ativo = petParaObjeto(carteira.pet);

  // Associa registros legados sem petId antes de gerar IDs novos, para não duplicar
  // o mesmo personagem que já exista tanto no campo ativo quanto na coleção.
  if (ativo?.name && !ativo.petId) {
    const correspondente = colecao.find(p =>
      p.type === ativo.type &&
      p.name === ativo.name &&
      String(p.capturedAt || '') === String(ativo.capturedAt || '')
    );
    ativo.petId = correspondente?.petId || gerarPetId();
    if (correspondente && !correspondente.petId) correspondente.petId = ativo.petId;
    alterada = true;
  }

  for (let i = 0; i < colecao.length; i++) {
    let pet = colecao[i];
    if (!pet.petId) { pet = { ...pet, petId: gerarPetId() }; alterada = true; }
    const atualizado = atualizarNecessidades(pet);
    if (JSON.stringify(atualizado) !== JSON.stringify(pet)) alterada = true;
    colecao[i] = atualizado;
  }

  if (ativo?.name) {
    const atualizado = atualizarNecessidades(ativo);
    if (JSON.stringify(atualizado) !== JSON.stringify(ativo)) alterada = true;
    ativo = atualizado;
    const indice = colecao.findIndex(p => mesmaIdentidadePet(p, ativo));
    if (indice >= 0) colecao[indice] = ativo;
    else { colecao.push(ativo); alterada = true; }
  } else if (colecao.length) {
    ativo = colecao[0];
    alterada = true;
  }

  if (alterada) {
    carteira.pets = colecao;
    carteira.pet = ativo || null;
    await carteira.save();
  }
  return carteira;
}

async function getPet(userId, idGrupo) {
  const cacheKey = `${userId}:${idGrupo}`;
  const cached = petCache.get(cacheKey);
  if (cached) return cached;

  const carteira = await obterCarteiraComColecao(userId, idGrupo);
  const pet = petParaObjeto(carteira?.pet);
  if (!pet?.name) return null;

  const atualizado = atualizarNecessidades({ ...pet, petId: pet.petId || gerarPetId() });
  petCache.set(cacheKey, atualizado);
  return atualizado;
}

/** Salva o pet ativo e mantém a cópia correspondente na coleção do grupo. */
async function savePet(userId, idGrupo, pet) {
  const cacheKey = `${userId}:${idGrupo}`;
  const petSalvo = { ...pet, petId: pet.petId || gerarPetId() };
  const carteira = await getCarteira(userId, idGrupo);
  if (!carteira) throw new Error('Carteira do grupo não encontrada.');

  const colecao = Array.from(carteira.pets || []).map(petParaObjeto).filter(p => p?.name);
  const indice = colecao.findIndex(p => mesmaIdentidadePet(p, petSalvo));
  if (indice >= 0) colecao[indice] = petSalvo;
  else colecao.push(petSalvo);

  carteira.pets = colecao;
  carteira.pet = petSalvo;
  await carteira.save();
  petCache.set(cacheKey, petSalvo);
  return petSalvo;
}

/** Adiciona um personagem à coleção sem substituir o ativo, salvo quando não houver um. */
async function addPetToCollection(userId, idGrupo, pet, { activateIfEmpty = true } = {}) {
  const petSalvo = { ...pet, petId: pet.petId || gerarPetId() };
  const carteira = await getCarteira(userId, idGrupo);
  if (!carteira) throw new Error('Carteira do grupo não encontrada.');
  const colecao = Array.from(carteira.pets || []).map(petParaObjeto).filter(p => p?.name);
  const indice = colecao.findIndex(p => mesmaIdentidadePet(p, petSalvo));
  if (indice >= 0) colecao[indice] = petSalvo;
  else colecao.push(petSalvo);
  carteira.pets = colecao;
  if (activateIfEmpty && !carteira.pet?.name) carteira.pet = petSalvo;
  await carteira.save();
  if (carteira.pet?.petId === petSalvo.petId) petCache.set(`${userId}:${idGrupo}`, petSalvo);
  return petSalvo;
}

/** Remove um personagem transferido/abandonado e ativa o próximo da coleção, se existir. */
async function removerPetDaColecao(userId, idGrupo, pet) {
  const carteira = await getCarteira(userId, idGrupo);
  if (!carteira) throw new Error('Carteira do grupo não encontrada.');
  const colecao = Array.from(carteira.pets || []).map(petParaObjeto).filter(p => p?.name && !mesmaIdentidadePet(p, pet));
  const ativo = petParaObjeto(carteira.pet);
  carteira.pets = colecao;
  if (ativo && mesmaIdentidadePet(ativo, pet)) carteira.pet = colecao[0] || null;
  await carteira.save();
  petCache.delete(`${userId}:${idGrupo}`);
  return carteira.pet;
}

async function getPetCollection(userId, idGrupo) {
  const carteira = await obterCarteiraComColecao(userId, idGrupo);
  return Array.from(carteira?.pets || []).map(petParaObjeto).filter(p => p?.name);
}

async function clearPet(userId, idGrupo) {
  petCache.delete(`${userId}:${idGrupo}`);
  const carteira = await getCarteira(userId, idGrupo);
  if (!carteira) return;
  carteira.pet = null;
  await carteira.save();
}


async function consumirItemPet(userId, idGrupo, chaves) {
  for (const chave of chaves) {
    const carteira = await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp: userId, idGrupo, [`itensPets.${chave}`]: { $gt: 0 } },
      { $inc: { [`itensPets.${chave}`]: -1 } },
      { new: true }
    );
    if (carteira) return { chave, origem: 'grupo' };
  }

  // Compatibilidade: itens comprados antes de a loja separar inventários por grupo.
  for (const chave of chaves) {
    const usuario = await Usuario.findOneAndUpdate(
      { idWhatsApp: userId, [`inventory.${chave}`]: { $gt: 0 } },
      { $inc: { [`inventory.${chave}`]: -1 } },
      { new: true }
    );
    if (usuario) return { chave, origem: 'global' };
  }
  return null;
}

async function devolverItemPet(userId, idGrupo, item) {
  if (!item) return;
  if (item.origem === 'global') {
    await Usuario.updateOne({ idWhatsApp: userId }, { $inc: { [`inventory.${item.chave}`]: 1 } });
  } else {
    await CarteiraGrupo.updateOne({ idWhatsApp: userId, idGrupo }, { $inc: { [`itensPets.${item.chave}`]: 1 } });
  }
}

function textoItemPet(chave) {
  return ({
    racao: 'Ração Normal', racaopremium: 'Ração Premium', carnefresh: 'Carne Fresca',
    peixe: 'Peixe Fresco', leite: 'Leite', bolinha: 'Bolinha de Tênis',
    pelucia: 'Pelúcia', corda: 'Corda de Puxar', disco: 'Disco Voador',
    casabrinquedo: 'Casa de Brinquedo', remedio: 'Remédio Geral', vacina: 'Vacina',
    shampoo: 'Shampoo Especial', sabonete: 'Sabonete Pet', coleira: 'Coleira Colorida',
    coleiraouro: 'Coleira de Ouro', bandana: 'Bandana', coroa: 'Coroa Pet',
  })[chave] || chave;
}

/**
 * Spawna um novo pet selvagem para um grupo.
 * Remove o spawn automaticamente após 1 hora.
 * @param {string} jid — JID do grupo
 * @returns {object} dados do spawn
 */
function spawnNovoPet(jid) {
  const raridade = sortearRaridadePet();
  const personagem = PERSONAGENS[Math.floor(Math.random() * PERSONAGENS.length)];
  const spawn = { type: personagem.type, rarity: raridade.rarity, spawnedAt: Date.now() };

  spawnedPets.set(jid, spawn);

  // Só remove se ainda for este mesmo spawn (evita apagar spawn mais recente)
  setTimeout(() => {
    if (spawnedPets.get(jid)?.spawnedAt === spawn.spawnedAt) {
      spawnedPets.delete(jid);
    }
  }, 60 * 60 * 1000);

  return spawn;
}

/**
 * Retorna o spawn ativo de um grupo, ou null se não houver.
 * @param {string} jid
 * @returns {object|null}
 */
function getSpawnAtivo(jid) {
  return spawnedPets.get(jid) ?? null;
}

// ============================================================
//  PET HANDLERS — capturar / alimentar / brincar / curar
// ============================================================

// --------------- helpers internos ---------------------------

/**
 * Garante que um valor numérico fique entre 0 e CONFIG.STAT_MAX.
 */
const clamp = (val, min = 0, max = CONFIG.STAT_MAX) =>
  Math.min(max, Math.max(min, val));

/**
 * Retorna um objeto pet com lastInteraction atualizado para agora.
 */
const comTimestamp = (pet) => ({
  ...pet,
  lastInteraction: new Date().toISOString(),
});

// --------------- !capturar ----------------------------------

/**
 * Captura o personagem que está ativo no grupo (jid).
 * Falha se o usuário já tiver um personagem ou se não houver spawn ativo.
 */
async function handleCapturarPet(sock, msg, jid) {
  const userId = await getUserId(msg, jid);
  if (!userId) return;

  // MongoDB é a fonte da verdade; o cache local pode estar desatualizado.
  let spawn;
  try {
    const registroSpawn = await PetSpawn.findOne({ idGrupo: jid }).select('personagemAtivo').lean();
    const ativo = registroSpawn?.personagemAtivo;
    if (ativo?.type && ativo?.rarity && ativo?.spawnedAt && Date.now() - ativo.spawnedAt < 60 * 60 * 1000) {
      spawn = { type: ativo.type, rarity: ativo.rarity, spawnedAt: ativo.spawnedAt };
      spawnedPets.set(jid, spawn);
    }
  } catch (err) {
    console.error('[capturar] Erro ao buscar personagem ativo:', err.message || err);
    return reply(sock, jid, msg, '❌ Não consegui verificar o personagem agora. Tente novamente.');
  }
  if (!spawn) {
    spawnedPets.delete(jid);
    return reply(sock, jid, msg, '❌ Nenhum personagem apareceu por aqui ainda. Aguarde o próximo personagem!');
  }

  const def = PET_SYSTEM[spawn.type];
  const rarityDef = RARIDADES_PET.find(r => r.rarity === spawn.rarity) || RARIDADES_PET[0];
  if (!def) {
    console.error(`[capturar] Tipo de personagem desconhecido: ${spawn.type}`);
    return reply(sock, jid, msg, '❌ Erro interno: personagem inválido.');
  }

  // O jogador pode colecionar vários personagens; apenas um fica ativo por vez.
  // 2. Reserva atomicamente o personagem: apenas uma captura pode vencer.
  let reservado;
  try {
    reservado = await PetSpawn.findOneAndUpdate(
      { idGrupo: jid, 'personagemAtivo.spawnedAt': spawn.spawnedAt },
      { $unset: { personagemAtivo: '' } },
      { new: false }
    );
  } catch (err) {
    console.error('[capturar] Não foi possível reservar personagem:', err.message || err);
    return reply(sock, jid, msg, '❌ Não consegui reservar o personagem. Tente novamente.');
  }
  if (!reservado) {
    spawnedPets.delete(jid);
    return reply(sock, jid, msg, '⚠️ Outro jogador já está tentando capturar esse personagem.');
  }
  spawnedPets.delete(jid);

  // 3. Sistema de taxa de captura
  const taxasRaridade = { 'COMUM': 0.75, 'RARO': 0.50, 'ULTRA-RARO': 0.30, 'LENDÁRIO': 0.12 };
  const chanceSucesso = rarityDef.catchRate ?? taxasRaridade[spawn.rarity] ?? 0.50;
  
  if (Math.random() > chanceSucesso) {
    return replyWithPetImage(sock, jid, msg, def,
      `💨 *O PERSONAGEM FUGIU!*\n\nVocê tentou se aproximar de fininho, mas o *${def.nome}* se assustou e correu para longe! 🌲`,
      { context: 'capturar' }
    );
  }

  // 4. Instanciação do novo pet capturado
  const agora = new Date();
  const novoPet = {
    petId:           gerarPetId(),
    type:            spawn.type,
    name:            def.nome,
    rarity:          spawn.rarity,
    xpMult:          rarityDef.xpMult,
    pontMult:        rarityDef.pontMult,
    level:           1,
    xp:              0,
    happiness:       50,
    energy:          100,
    fullness:        100,
    health:          100,
    hygiene:         100,
    accessories:     [],
    skills:          [],
    capturedAt:      agora,
    lastInteraction: agora,
    lastNeedsUpdate: agora,
  };

  try {
    await addPetToCollection(userId, jid, novoPet, { activateIfEmpty: true });
  } catch (err) {
    console.error('[capturar] Erro ao salvar pet:', err);
    spawnedPets.set(jid, spawn);
    try {
      await PetSpawn.updateOne(
        { idGrupo: jid, $or: [{ personagemAtivo: null }, { 'personagemAtivo.spawnedAt': { $exists: false } }] },
        { $set: { personagemAtivo: spawn } }
      );
    } catch (restoreErr) { console.error('[capturar] Não foi possível restaurar personagem ativo:', restoreErr.message || restoreErr); }
    return reply(sock, jid, msg, '❌ Erro ao guardar o personagem. Tente novamente!');
  }

  // 5. Retorno visual de sucesso para o chat
  const emoji = RARITY_EMOJI[spawn.rarity] ?? '⭐';
  const limiteNivel = typeof CONFIG !== 'undefined' && CONFIG.NIVEL_MAX ? CONFIG.NIVEL_MAX : 100;

  return replyWithPetImage(sock, jid, msg, novoPet,
    `${emoji} *${def.nome} CAPTURADO!* (${spawn.rarity}) ${emoji}\n\n` +
    `${def.emoji} _"${def.desc}"_\n\n` +
    `🏆 Nível: *1* | ✨ XP: *0 / ${limiteNivel > 1 ? '100' : '—'}*\n` +
    `😊 Felicidade: *50%* | ⚡ Energia: *100%* | 🍽️ Fome: *100%*\n\n` +
    `💡 Use *!statuspet* para ver as ações disponíveis ou dê um nome para ele com *!nomearpet [nome]*!`,
    { context: 'capturar' }
  );
}

// --------------- !alimentar ---------------------------------

/**
 * Alimenta o pet do usuário, consumindo 1 unidade de comida do inventário.
 * Aumenta fullness (+30) e happiness (+10).
 */
async function handleAlimentarPet(sock, msg, jid) {
  const userId = await getUserId(msg, jid);
  if (!userId) return;
  const espera = checkCooldown(`${userId}:${jid}`, 'alimentar', CONFIG.COOLDOWN_ALIMENTAR);
  if (espera > 0) return reply(sock, jid, msg, `⏳ Aguarde *${formatarTempo(espera)}* para alimentar novamente!`);

  let pet;
  try { pet = await getPet(userId, jid); }
  catch (err) {
    console.error('[alimentar] Erro ao buscar pet:', err);
    return reply(sock, jid, msg, '❌ Erro interno ao buscar seu personagem. Tente novamente!');
  }
  if (!pet?.name) return reply(sock, jid, msg, '⚠️ Você não tem um personagem ativo neste grupo. Use *!pets* para ver sua coleção.');
  if (pet.fullness >= CONFIG.STAT_MAX) {
    clearCooldown(`${userId}:${jid}`, 'alimentar');
    return reply(sock, jid, msg, `❌ *${pet.name}* está completamente satisfeito (🍽️ 100%) e não quer comer agora!`);
  }

  const alimentos = {
    racaopremium: { fome: 45, felicidade: 10 },
    carnefresh: { fome: 40, felicidade: 10 },
    peixe: { fome: 35, felicidade: 12 },
    racao: { fome: 30, felicidade: 5 },
    leite: { fome: 20, felicidade: 15 },
    comida: { fome: 20, felicidade: 5 }, // item legado
  };
  let item;
  try { item = await consumirItemPet(userId, jid, Object.keys(alimentos)); }
  catch (err) {
    clearCooldown(`${userId}:${jid}`, 'alimentar');
    console.error('[alimentar] Erro ao consumir alimento:', err);
    return reply(sock, jid, msg, '❌ Não consegui acessar seu estoque de alimentos. Tente novamente.');
  }
  if (!item) {
    clearCooldown(`${userId}:${jid}`, 'alimentar');
    return reply(sock, jid, msg, '❌ Você não tem alimentos para pets! Compre ração na *!lojapet*.');
  }

  const efeito = alimentos[item.chave];
  const atualizado = comTimestamp({
    ...pet,
    fullness: clamp(pet.fullness + efeito.fome),
    happiness: clamp(pet.happiness + efeito.felicidade),
  });
  try { await savePet(userId, jid, atualizado); }
  catch (err) {
    try { await devolverItemPet(userId, jid, item); }
    catch (rollbackErr) { console.error('[alimentar] Falha ao devolver alimento:', rollbackErr); }
    clearCooldown(`${userId}:${jid}`, 'alimentar');
    console.error('[alimentar] Erro ao salvar pet:', err);
    return reply(sock, jid, msg, '❌ Erro ao alimentar o pet. O alimento foi devolvido quando possível.');
  }
  await prepareDailyMissionState(userId).then(() => Usuario.updateOne(
    { idWhatsApp: userId }, { $inc: { 'dailyMissions.progress.pet10': 1 } }
  )).catch(err => console.warn('[alimentar] Não foi possível atualizar a missão diária:', err.message));

  return replyWithPetImage(sock, jid, msg, atualizado,
    `🍖 Você alimentou *${atualizado.name}* com *${textoItemPet(item.chave)}*!\n\n` +
    `🍽️ Fome: *${atualizado.fullness}%*\n😊 Felicidade: *${atualizado.happiness}%*\n` +
    `❤️ Saúde: *${atualizado.health ?? 100}%*`,
    { context: 'alimentar' }
  );
}

// --------------- !brincar -----------------------------------

/**
 * Faz o usuário brincar com o pet, aumentando nível e felicidade,
 * mas consumindo energia e fome.
 */
async function handleBrincarPet(sock, msg, jid, caption = '') {
  const userId = await getUserId(msg, jid);
  if (!userId) return;
  const espera = checkCooldown(`${userId}:${jid}`, 'brincar', CONFIG.COOLDOWN_BRINCAR);
  if (espera > 0) return reply(sock, jid, msg, `⏳ Aguarde *${formatarTempo(espera)}* para brincar novamente!`);

  let pet;
  try { pet = await getPet(userId, jid); }
  catch (err) {
    console.error('[brincar] Erro ao buscar pet:', err);
    return reply(sock, jid, msg, '❌ Erro interno ao buscar seu personagem. Tente novamente!');
  }
  if (!pet?.name) return reply(sock, jid, msg, '⚠️ Você não tem um personagem ativo neste grupo. Use *!pets* para ver sua coleção.');
  if ((pet.energy ?? 0) < 15) return reply(sock, jid, msg, `❌ *${pet.name}* está sem energia para brincar! Use *!curar* ou espere descansar.`);
  if ((pet.fullness ?? 0) <= 0) return reply(sock, jid, msg, `❌ *${pet.name}* está com fome demais para brincar! Use *!alimentar* primeiro.`);

  const brinquedos = {
    bolinha: { felicidade: 10, xp: 8, energia: 5 },
    pelucia: { felicidade: 12, xp: 5, energia: 0 },
    corda: { felicidade: 8, xp: 10, energia: 7 },
    disco: { felicidade: 10, xp: 12, energia: 8 },
    casabrinquedo: { felicidade: 15, xp: 15, energia: 0 },
  };
  const brinquedoDigitado = caption.replace(/^[!.,/]\s*brincar\b/i, '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  let itemBrinquedo = null;
  if (brinquedoDigitado) {
    if (!brinquedos[brinquedoDigitado]) return reply(sock, jid, msg, `⚠️ Brinquedo desconhecido. Use: *${Object.keys(brinquedos).join('*, *')}*.`);
    try { itemBrinquedo = await consumirItemPet(userId, jid, [brinquedoDigitado]); }
    catch (err) { console.error('[brincar] Erro ao consumir brinquedo:', err); }
    if (!itemBrinquedo) return reply(sock, jid, msg, `❌ Você não tem *${textoItemPet(brinquedoDigitado)}* no inventário deste grupo. Veja *!lojapet*.`);
  }

  const bonus = itemBrinquedo ? brinquedos[itemBrinquedo.chave] : { felicidade: 0, xp: 0, energia: 0 };
  const xpGanho = Math.round((20 + bonus.xp) * (pet.xpMult ?? 1));
  const { pet: petComXp, desbloqueios } = aplicarExperienciaPet(pet, xpGanho);
  const petAtualizado = comTimestamp({
    ...petComXp,
    happiness: clamp(pet.happiness + 20 + bonus.felicidade),
    energy: clamp(pet.energy - 15 - bonus.energia),
    fullness: clamp(pet.fullness - 10),
  });

  try { await savePet(userId, jid, petAtualizado); }
  catch (err) {
    if (itemBrinquedo) await devolverItemPet(userId, jid, itemBrinquedo).catch(e => console.error('[brincar] Falha ao devolver brinquedo:', e));
    console.error('[brincar] Erro ao atualizar:', err);
    return reply(sock, jid, msg, '❌ Erro interno ao brincar com o pet. O brinquedo foi devolvido quando possível.');
  }
  await prepareDailyMissionState(userId).then(() => Usuario.updateOne(
    { idWhatsApp: userId }, { $inc: { 'dailyMissions.progress.pet10': 1 } }
  )).catch(err => console.warn('[brincar] Não foi possível atualizar a missão diária:', err.message));

  const xpMax = petAtualizado.level < CONFIG.NIVEL_MAX ? petAtualizado.level * 100 : null;
  const xpBar = xpMax ? buildXpBar(petAtualizado.xp, xpMax) : '👑 *NÍVEL MÁXIMO*';
  const nivelMsg = petAtualizado.level > (pet.level ?? 1) ? `\n\n🎉 *${petAtualizado.name}* chegou ao nível *${petAtualizado.level}*!` : '';
  const habilidadeMsg = desbloqueios.length ? `\n🔓 Habilidade${desbloqueios.length > 1 ? 's' : ''} desbloqueada${desbloqueios.length > 1 ? 's' : ''}: ${desbloqueios.join(', ')}` : '';
  const brinquedoMsg = itemBrinquedo ? ` com *${textoItemPet(itemBrinquedo.chave)}*` : '';
  return replyWithPetImage(sock, jid, msg, petAtualizado,
    `🎾 Você brincou com *${petAtualizado.name}*${brinquedoMsg}!\n\n` +
    `😊 Felicidade: *${petAtualizado.happiness}%*\n⚡ Energia: *${petAtualizado.energy}%*\n` +
    `🍽️ Fome: *${petAtualizado.fullness}%*\n❤️ Saúde: *${petAtualizado.health ?? 100}%*\n` +
    `🏆 Nível: *${petAtualizado.level}/${CONFIG.NIVEL_MAX}*\n✨ XP: +${xpGanho} ${xpBar}${nivelMsg}${habilidadeMsg}`,
    { context: 'brincar' }
  );
}

// Barra de progresso de XP  ex: [████░░░░░░] 40/100
function buildXpBar(xpAtual, xpTotal, tamanho = 10) {
  if (!xpTotal || xpTotal <= 0) return `[██████████] MAX`;
  const preenchido = Math.min(Math.round((xpAtual / xpTotal) * tamanho), tamanho);
  const vazio      = tamanho - preenchido;
  return `[${'█'.repeat(preenchido)}${'░'.repeat(vazio)}] ${xpAtual}/${xpTotal}`;
}

// --------------- !curar -------------------------------------

/**
 * Usa um remédio do inventário para recuperar energia (+50) e felicidade (+20) do pet.
 */
async function handleCurarPet(sock, msg, jid) {
  const userId = await getUserId(msg, jid);
  if (!userId) return;
  const espera = checkCooldown(`${userId}:${jid}`, 'curar', CONFIG.COOLDOWN_CURAR);
  if (espera > 0) return reply(sock, jid, msg, `⏳ Aguarde *${formatarTempo(espera)}* para curar novamente!`);

  let pet;
  try { pet = await getPet(userId, jid); }
  catch (err) {
    console.error('[curar] Erro ao buscar pet:', err);
    return reply(sock, jid, msg, '❌ Erro interno ao buscar seu personagem. Tente novamente!');
  }
  if (!pet?.name) return reply(sock, jid, msg, '⚠️ Você não tem um personagem ativo neste grupo.');
  if ((pet.health ?? 100) >= 100 && (pet.energy ?? 0) >= 100 && (pet.happiness ?? 0) >= 100) {
    clearCooldown(`${userId}:${jid}`, 'curar');
    return reply(sock, jid, msg, `✅ *${pet.name}* já está completamente saudável!`);
  }

  let item;
  try { item = await consumirItemPet(userId, jid, ['remedio']); }
  catch (err) {
    clearCooldown(`${userId}:${jid}`, 'curar');
    console.error('[curar] Erro ao consumir remédio:', err);
    return reply(sock, jid, msg, '❌ Não consegui acessar seu estoque de remédios.');
  }
  if (!item) {
    clearCooldown(`${userId}:${jid}`, 'curar');
    return reply(sock, jid, msg, '❌ Você não tem Remédio Geral! Compre na *!lojapet*.');
  }

  const atualizado = comTimestamp({
    ...pet,
    health: clamp((pet.health ?? 100) + 50, 1),
    energy: clamp((pet.energy ?? 0) + 25),
    happiness: clamp((pet.happiness ?? 0) + 10),
  });
  try { await savePet(userId, jid, atualizado); }
  catch (err) {
    try { await devolverItemPet(userId, jid, item); }
    catch (rollbackErr) { console.error('[curar] Falha ao devolver remédio:', rollbackErr); }
    clearCooldown(`${userId}:${jid}`, 'curar');
    console.error('[curar] Erro ao salvar pet:', err);
    return reply(sock, jid, msg, '❌ Erro interno ao salvar a cura. O remédio foi devolvido quando possível.');
  }

  return replyWithPetImage(sock, jid, msg, atualizado,
    `💊 Você tratou *${atualizado.name}*!\n❤️ Saúde: *${atualizado.health}%*\n⚡ Energia: *${atualizado.energy}%*\n😊 Felicidade: *${atualizado.happiness}%*`,
    { context: 'curar' }
  );
}

function extrairMencao(msg, caption = '') {
  const contexto = msg?.message?.extendedTextMessage?.contextInfo
    || msg?.message?.imageMessage?.contextInfo
    || msg?.message?.videoMessage?.contextInfo
    || {};
  const mencionados = contexto.mentionedJid || [];
  if (mencionados[0]) return mencionados[0];
  const match = String(caption).match(/@([0-9]{5,})/);
  return match ? `${match[1]}@s.whatsapp.net` : null;
}

function aplicarExperienciaPet(pet, quantidade) {
  let level = Math.max(1, pet.level || 1);
  let xp = Math.max(0, pet.xp || 0) + Math.max(0, quantidade);
  while (level < CONFIG.NIVEL_MAX && xp >= level * 100) {
    xp -= level * 100;
    level++;
  }
  const skills = new Set(pet.skills || []);
  const desbloqueios = [
    [5, 'Truques'], [10, 'Agilidade'], [20, 'Companheiro Experiente'], [50, 'Lenda do Grupo'],
  ].filter(([nivel, nome]) => level >= nivel && !skills.has(nome));
  for (const [, nome] of desbloqueios) skills.add(nome);
  return { pet: { ...pet, level, xp, skills: [...skills] }, desbloqueios: desbloqueios.map(([, nome]) => nome) };
}

async function handleSelecionarPet(sock, msg, jid, caption = '') {
  const userId = await getUserId(msg, jid);
  if (!userId) return;
  const nomeBusca = caption.replace(/^[!.,/]\s*petselecionar\s*/i, '').trim().replace(/^['"]|['"]$/g, '');
  if (!nomeBusca) return reply(sock, jid, msg, '⚠️ Informe o nome do personagem. Exemplo: *!petselecionar Lula*');
  try {
    const colecao = await getPetCollection(userId, jid);
    const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const exatos = colecao.filter(p => normalizar(p.name) === normalizar(nomeBusca));
    const parciais = colecao.filter(p => normalizar(p.name).includes(normalizar(nomeBusca)));
    const pet = exatos[0] || (parciais.length === 1 ? parciais[0] : null);
    if (!pet) return reply(sock, jid, msg, parciais.length > 1 ? '⚠️ Há vários personagens com esse trecho de nome. Informe o nome completo.' : `❌ Você não tem *${nomeBusca}* na coleção deste grupo. Use *!pets*.`);
    await savePet(userId, jid, pet);
    return replyWithPetImage(sock, jid, msg, pet, `✅ *${pet.name}* agora é seu personagem ativo!\n\nUse *!statuspet* para consultar os atributos.`, { context: 'selecionar' });
  } catch (err) {
    console.error('[petselecionar] Erro:', err);
    return reply(sock, jid, msg, '❌ Não foi possível trocar o personagem ativo. Tente novamente.');
  }
}

async function handleBanharPet(sock, msg, jid) {
  const userId = await getUserId(msg, jid);
  if (!userId) return;
  const pet = await getPet(userId, jid).catch(err => { console.error('[banhar] Erro ao buscar pet:', err); return null; });
  if (!pet?.name) return reply(sock, jid, msg, '⚠️ Você não tem um personagem ativo neste grupo.');
  if ((pet.hygiene ?? 100) >= 100) return reply(sock, jid, msg, `🧼 *${pet.name}* já está limpinho!`);
  let item;
  try { item = await consumirItemPet(userId, jid, ['shampoo', 'sabonete']); }
  catch (err) { console.error('[banhar] Erro ao consumir higiene:', err); }
  if (!item) return reply(sock, jid, msg, '❌ Você precisa de Shampoo Especial ou Sabonete Pet. Compre na *!lojapet*.');
  const higiene = item.chave === 'shampoo' ? 70 : 40;
  const atualizado = comTimestamp({ ...pet, hygiene: clamp((pet.hygiene ?? 0) + higiene), happiness: clamp((pet.happiness ?? 0) + 5) });
  try { await savePet(userId, jid, atualizado); }
  catch (err) {
    await devolverItemPet(userId, jid, item).catch(e => console.error('[banhar] Falha no estorno:', e));
    return reply(sock, jid, msg, '❌ Não foi possível salvar o banho. O item foi devolvido quando possível.');
  }
  return replyWithPetImage(sock, jid, msg, atualizado, `🧼 *${atualizado.name}* tomou banho com ${textoItemPet(item.chave)}!\n✨ Higiene: *${atualizado.hygiene}%*\n😊 Felicidade: *${atualizado.happiness}%*`, { context: 'banhar' });
}

async function handleVacinarPet(sock, msg, jid) {
  const userId = await getUserId(msg, jid);
  if (!userId) return;
  const pet = await getPet(userId, jid).catch(err => { console.error('[vacinar] Erro ao buscar pet:', err); return null; });
  if (!pet?.name) return reply(sock, jid, msg, '⚠️ Você não tem um personagem ativo neste grupo.');
  if ((pet.health ?? 100) >= 100 && pet.lastVaccinatedAt && Date.now() - new Date(pet.lastVaccinatedAt).getTime() < 30 * 24 * 60 * 60 * 1000) {
    return reply(sock, jid, msg, `✅ *${pet.name}* já está saudável e vacinado recentemente.`);
  }
  let item;
  try { item = await consumirItemPet(userId, jid, ['vacina']); }
  catch (err) { console.error('[vacinar] Erro ao consumir vacina:', err); }
  if (!item) return reply(sock, jid, msg, '❌ Você não tem Vacina! Compre na *!lojapet*.');
  const atualizado = comTimestamp({ ...pet, health: clamp((pet.health ?? 100) + 45, 1), lastVaccinatedAt: new Date() });
  try { await savePet(userId, jid, atualizado); }
  catch (err) {
    await devolverItemPet(userId, jid, item).catch(e => console.error('[vacinar] Falha no estorno:', e));
    return reply(sock, jid, msg, '❌ Não foi possível registrar a vacinação. O item foi devolvido quando possível.');
  }
  return replyWithPetImage(sock, jid, msg, atualizado, `💉 *${atualizado.name}* foi vacinado!\n❤️ Saúde: *${atualizado.health}%*\n📅 Vacinação registrada.`, { context: 'vacinar' });
}

async function handleEquiparPet(sock, msg, jid, caption = '') {
  const userId = await getUserId(msg, jid);
  if (!userId) return;
  const chave = caption.replace(/^[!.,/]\s*equiparpet\s*/i, '').trim().toLowerCase().replace(/\s+/g, '');
  const acessorios = ['coleira', 'coleiraouro', 'bandana', 'coroa'];
  if (!acessorios.includes(chave)) return reply(sock, jid, msg, `⚠️ Informe um acessório: *${acessorios.join('*, *')}*.`);
  const pet = await getPet(userId, jid).catch(() => null);
  if (!pet?.name) return reply(sock, jid, msg, '⚠️ Você não tem um personagem ativo neste grupo.');
  if ((pet.accessories || []).includes(chave)) return reply(sock, jid, msg, `🎀 *${pet.name}* já está usando ${textoItemPet(chave)}.`);
  const item = await consumirItemPet(userId, jid, [chave]).catch(err => { console.error('[equiparpet] Erro no inventário:', err); return null; });
  if (!item) return reply(sock, jid, msg, `❌ Você não possui ${textoItemPet(chave)} neste grupo. Compre na *!lojapet*.`);
  const atualizado = comTimestamp({ ...pet, accessories: [...(pet.accessories || []), chave] });
  try { await savePet(userId, jid, atualizado); }
  catch (err) {
    await devolverItemPet(userId, jid, item).catch(e => console.error('[equiparpet] Falha no estorno:', e));
    return reply(sock, jid, msg, '❌ Não foi possível equipar o acessório. O item foi devolvido quando possível.');
  }
  return replyWithPetImage(sock, jid, msg, atualizado, `🎀 *${pet.name}* agora está usando *${textoItemPet(chave)}*!\nAcessórios: ${(atualizado.accessories || []).map(textoItemPet).join(', ')}`, { context: 'equipar' });
}

async function handleDesequiparPet(sock, msg, jid, caption = '') {
  const userId = await getUserId(msg, jid);
  if (!userId) return;
  const chave = caption.replace(/^[!.,/]\s*desequiparpet\s*/i, '').trim().toLowerCase().replace(/\s+/g, '');
  const pet = await getPet(userId, jid).catch(() => null);
  if (!pet?.name) return reply(sock, jid, msg, '⚠️ Você não tem um personagem ativo neste grupo.');
  const acessorios = pet.accessories || [];
  const item = acessorios.find(a => a === chave || textoItemPet(a).toLowerCase() === chave);
  if (!item) return reply(sock, jid, msg, `⚠️ *${pet.name}* não está usando esse acessório. Veja *!statuspet*.`);
  const atualizado = comTimestamp({ ...pet, accessories: acessorios.filter(a => a !== item) });
  try {
    await savePet(userId, jid, atualizado);
    await CarteiraGrupo.updateOne({ idWhatsApp: userId, idGrupo: jid }, { $inc: { [`itensPets.${item}`]: 1 } });
  } catch (err) {
    console.error('[desequiparpet] Erro:', err);
    return reply(sock, jid, msg, '❌ Não foi possível devolver o acessório ao inventário.');
  }
  return reply(sock, jid, msg, `✅ *${textoItemPet(item)}* foi retirado de *${pet.name}* e devolvido ao inventário deste grupo.`);
}

async function handlePassearPet(sock, msg, jid) {
  const userId = await getUserId(msg, jid);
  if (!userId) return;
  const espera = checkCooldown(`${userId}:${jid}`, 'passear', 60 * 60 * 1000);
  if (espera > 0) return reply(sock, jid, msg, `⏳ *${formatarTempo(espera)}* para passear novamente.`);
  const pet = await getPet(userId, jid).catch(err => { console.error('[passear] Erro:', err); return null; });
  if (!pet?.name) { clearCooldown(`${userId}:${jid}`, 'passear'); return reply(sock, jid, msg, '⚠️ Você não tem um personagem ativo neste grupo.'); }
  if ((pet.energy ?? 0) < 15 || (pet.fullness ?? 0) < 10) { clearCooldown(`${userId}:${jid}`, 'passear'); return reply(sock, jid, msg, `⚠️ *${pet.name}* precisa descansar ou comer antes do passeio.`); }
  const { pet: comXp, desbloqueios } = aplicarExperienciaPet(pet, 25 * (pet.xpMult ?? 1));
  const atualizado = comTimestamp({ ...comXp, energy: clamp(pet.energy - 10), fullness: clamp(pet.fullness - 5), happiness: clamp(pet.happiness + 12) });
  const encontrou = Math.random() < 0.25;
  try {
    await savePet(userId, jid, atualizado);
    if (encontrou) await CarteiraGrupo.updateOne({ idWhatsApp: userId, idGrupo: jid }, { $inc: { 'itensPets.racao': 1 } });
  } catch (err) { console.error('[passear] Erro ao registrar passeio:', err); return reply(sock, jid, msg, '❌ Não foi possível concluir o passeio.'); }
  return replyWithPetImage(sock, jid, msg, atualizado,
    `🌳 Você passeou com *${atualizado.name}*!\n😊 Felicidade: *${atualizado.happiness}%*\n⚡ Energia: *${atualizado.energy}%*\n✨ XP: +25` +
    (encontrou ? '\n🎁 Vocês encontraram uma Ração Normal no caminho!' : '') +
    (desbloqueios.length ? `\n🔓 Habilidade${desbloqueios.length > 1 ? 's' : ''} desbloqueada${desbloqueios.length > 1 ? 's' : ''}: ${desbloqueios.join(', ')}` : ''),
    { context: 'passear' }
  );
}

async function handleTreinarPet(sock, msg, jid) {
  const userId = await getUserId(msg, jid);
  if (!userId) return;
  const espera = checkCooldown(`${userId}:${jid}`, 'treinar', 30 * 60 * 1000);
  if (espera > 0) return reply(sock, jid, msg, `⏳ Aguarde *${formatarTempo(espera)}* para treinar novamente.`);
  const pet = await getPet(userId, jid).catch(err => { console.error('[treinar] Erro:', err); return null; });
  if (!pet?.name) { clearCooldown(`${userId}:${jid}`, 'treinar'); return reply(sock, jid, msg, '⚠️ Você não tem um personagem ativo neste grupo.'); }
  if ((pet.energy ?? 0) < 25 || (pet.fullness ?? 0) < 15) { clearCooldown(`${userId}:${jid}`, 'treinar'); return reply(sock, jid, msg, `⚠️ *${pet.name}* precisa de energia e comida para treinar.`); }
  const { pet: comXp, desbloqueios } = aplicarExperienciaPet(pet, 35 * (pet.xpMult ?? 1));
  const atualizado = comTimestamp({ ...comXp, energy: clamp(pet.energy - 20), fullness: clamp(pet.fullness - 10), happiness: clamp(pet.happiness + 5) });
  try { await savePet(userId, jid, atualizado); }
  catch (err) { console.error('[treinar] Erro ao salvar:', err); return reply(sock, jid, msg, '❌ Não foi possível salvar o treino.'); }
  return replyWithPetImage(sock, jid, msg, atualizado,
    `🏋️ *${atualizado.name}* terminou o treino!\n🏆 Nível: *${atualizado.level}*\n✨ XP: *${atualizado.xp}*\n⚡ Energia: *${atualizado.energy}%*` +
    (desbloqueios.length ? `\n🔓 Habilidade${desbloqueios.length > 1 ? 's' : ''} desbloqueada${desbloqueios.length > 1 ? 's' : ''}: ${desbloqueios.join(', ')}` : ''),
    { context: 'treinar' }
  );
}

async function handleVisitarPet(sock, msg, jid, caption = '') {
  const alvoRaw = extrairMencao(msg, caption);
  if (!alvoRaw) return reply(sock, jid, msg, '⚠️ Marque a pessoa cujo personagem deseja visitar. Exemplo: *!visitarpet @pessoa*');
  const alvoId = await resolverJidCarteira(alvoRaw, jid);
  const pet = await getPet(alvoId, jid).catch(err => { console.error('[visitarpet] Erro:', err); return null; });
  if (!pet?.name) return reply(sock, jid, msg, '😕 Essa pessoa não tem um personagem ativo neste grupo.');
  const nomeDono = await resolveDisplayName(alvoId, sock, {}, { fallback: 'Jogador' });
  return replyWithPetImage(sock, jid, msg, pet,
    `👋 Você visitou o personagem de *${nomeDono}*!\n🐾 *${pet.name}* (${pet.rarity ?? 'COMUM'})\n🏆 Nível ${pet.level ?? 1} • ${obterEstagioPet(pet)}\n😊 ${pet.happiness ?? 0}% • ⚡ ${pet.energy ?? 0}% • ❤️ ${pet.health ?? 100}%`,
    { context: 'visitar' }
  );
}

async function handleCompeticaoPet(sock, msg, jid, caption = '', modalidade = 'duelo') {
  const userId = await getUserId(msg, jid);
  if (!userId) return;
  const alvoRaw = extrairMencao(msg, caption);
  if (!alvoRaw) return reply(sock, jid, msg, `⚠️ Marque um adversário. Exemplo: *!${modalidade === 'corrida' ? 'corridapet' : 'duelopet'} @pessoa*`);
  const alvoId = await resolverJidCarteira(alvoRaw, jid);
  if (!alvoId || alvoId === userId) return reply(sock, jid, msg, '⚠️ Você precisa desafiar outra pessoa do grupo.');

  const cooldown = modalidade === 'corrida' ? 'corridapet' : 'duelopet';
  const espera = checkCooldown(`${userId}:${jid}`, cooldown, 30 * 60 * 1000);
  if (espera > 0) return reply(sock, jid, msg, `⏳ Aguarde *${formatarTempo(espera)}* para desafiar novamente.`);
  const esperaAlvo = checkCooldown(`${alvoId}:${jid}`, cooldown, 30 * 60 * 1000);
  if (esperaAlvo > 0) { clearCooldown(`${userId}:${jid}`, cooldown); return reply(sock, jid, msg, '⏳ Essa pessoa acabou de participar de uma competição. Tente mais tarde.'); }

  const [petA, petB] = await Promise.all([
    getPet(userId, jid).catch(() => null),
    getPet(alvoId, jid).catch(() => null),
  ]);
  if (!petA?.name || !petB?.name) {
    clearCooldown(`${userId}:${jid}`, cooldown);
    clearCooldown(`${alvoId}:${jid}`, cooldown);
    return reply(sock, jid, msg, '⚠️ Os dois jogadores precisam ter um personagem ativo neste grupo.');
  }

  const sorteio = () => Math.random() * 25;
  const pontos = pet => modalidade === 'corrida'
    ? (pet.energy ?? 0) + (pet.happiness ?? 0) * 0.25 + (pet.level ?? 1) * 1.5 + sorteio()
    : (pet.level ?? 1) * 2 + (pet.health ?? 100) * 0.25 + (pet.energy ?? 0) * 0.15 + (pet.happiness ?? 0) * 0.1 + sorteio();
  const venceA = pontos(petA) >= pontos(petB);
  const vencedor = venceA ? petA : petB;
  const perdedor = venceA ? petB : petA;
  const donoVencedor = venceA ? userId : alvoId;
  const donoPerdedor = venceA ? alvoId : userId;
  const { pet: vencedorXp, desbloqueios } = aplicarExperienciaPet(vencedor, modalidade === 'corrida' ? 35 : 40);
  const vencedorFinal = comTimestamp({ ...vencedorXp, happiness: clamp(vencedor.happiness + 8) });
  const perdedorFinal = comTimestamp({ ...perdedor, energy: clamp(perdedor.energy - 8) });
  try {
    await savePet(donoVencedor, jid, vencedorFinal);
    await savePet(donoPerdedor, jid, perdedorFinal);
  } catch (err) {
    console.error(`[${cooldown}] Falha ao salvar resultado:`, err);
    return reply(sock, jid, msg, '❌ A competição terminou, mas não consegui salvar o resultado.');
  }
  const nomeVencedor = await resolveDisplayName(donoVencedor, sock, {}, { fallback: 'Vencedor' });
  const tipo = modalidade === 'corrida' ? 'CORRIDA DE PETS' : 'DUELO DE PETS';
  return replyWithPetImage(sock, jid, msg, vencedorFinal,
    `🏆 *${tipo}*\n\n🥇 *${nomeVencedor}* venceu com *${vencedor.name}*!\n🆚 ${petA.name} vs. ${petB.name}\n✨ O vencedor ganhou experiência.\n⚡ O outro personagem gastou um pouco de energia.` +
    (desbloqueios.length ? `\n🔓 Habilidade desbloqueada: ${desbloqueios.join(', ')}` : ''),
    { context: cooldown }
  );
}

async function handleDueloPet(sock, msg, jid, caption = '') {
  return handleCompeticaoPet(sock, msg, jid, caption, 'duelo');
}

async function handleCorridaPet(sock, msg, jid, caption = '') {
  return handleCompeticaoPet(sock, msg, jid, caption, 'corrida');
}

// !renomearpet / !nomearpet <nome>
async function handleRenomearPet(sock, msg, jid, caption) {
  const userId = await getUserId(msg, jid);
  if (!userId) return;

  const novoNome = caption
    .replace(/^[!.,/]?(?:renomearpet|nomearpet)\s*/i, '')
    .trim();

  if (!novoNome) {
    return reply(sock, jid, msg,
      '⚠️ Informe o novo nome!\n\n*Exemplo:* !nomearpet Farofa'
    );
  }

  if (novoNome.length < 2 || novoNome.length > 24) {
    return reply(sock, jid, msg,
      `⚠️ Nome deve ter entre *2 e 24 caracteres*.\n_Atual: ${novoNome.length} caractere(s)._`
    );
  }

  let pet;
  try {
    pet = await getPet(userId, jid);
  } catch (err) {
    console.error('[renomear] Erro ao buscar pet:', err);
    return reply(sock, jid, msg, '❌ Erro interno ao buscar seu personagem. Tente novamente!');
  }

  if (!pet?.name) {
    return reply(sock, jid, msg,
      '⚠️ Você não tem um pet para renomear!\n_Use *!capturar* quando um aparecer._'
    );
  }

  if (pet.name.toLowerCase() === novoNome.toLowerCase()) {
    return reply(sock, jid, msg, `⚠️ *${pet.name}* já tem esse nome!`);
  }

  const nomeAntigo    = pet.name;
  const petAtualizado = comTimestamp({ ...pet, name: novoNome });

  petCache.delete(`${userId}:${jid}`);

  try {
    await savePet(userId, jid, petAtualizado);
  } catch (err) {
    console.error('[renomear] Erro ao salvar pet:', err);
    petCache.set(`${userId}:${jid}`, pet);
    return reply(sock, jid, msg, '❌ Erro interno ao renomear. Tente novamente!');
  }

  const def = getPersonagem(pet);

  return replyWithPetImage(sock, jid, msg, petAtualizado,
    `✅ *Pet renomeado com sucesso!*\n\n` +
    `${def.emoji} *${nomeAntigo}* → *${novoNome}*\n\n` +
    `_Use *!statuspet* para ver seu pet atualizado!_`,
    { context: 'renomear' }
  );
}

// !rankpet
async function handlePetRank(sock, msg, jid, contactNames = {}) {
  // ── Garantir que é grupo ──────────────────────────────────
  if (!jid?.endsWith('@g.us')) {
    return reply(sock, jid, msg, '⚠️ Este comando só pode ser usado em grupos.');
  }

  try {
    // ── Buscar membros do grupo ───────────────────────────────
    let metadata;
    try {
      metadata = await sock.groupMetadata(jid);
    } catch (err) {
      console.error('[PetRank] Erro ao buscar metadata do grupo:', err);
      return reply(sock, jid, msg, '⚠️ Não consegui acessar os dados do grupo. Tente novamente.');
    }

    if (!metadata?.participants?.length) {
      return reply(sock, jid, msg,
        `🐾 *RANKING DE PETS*\n\nNão foi possível obter os membros do grupo.`
      );
    }

    // ── JIDs reais dos membros atuais — sem reconstruir @lid como telefone ──
const membrosAtuais = new Set(
  metadata.participants
    .map(p => p.id?.toLowerCase())
    .filter(Boolean)
);

    if (membrosAtuais.size === 0) {
      return reply(sock, jid, msg, `🐾 *RANKING DE PETS*\n\nNenhum membro encontrado no grupo.`);
    }

    // ── Buscar usuários com pet ───────────────────────────────
    const carteiras = await CarteiraGrupo.find({
      idGrupo:     jid,
      idWhatsApp:  { $in: [...membrosAtuais] },
      'pet.name':  { $exists: true, $nin: [null, ''] },
      'pet.level': { $exists: true },
    })
      .select('idWhatsApp pet')
      .lean();

    if (!carteiras.length) {
      return reply(sock, jid, msg,
        `🐾 *RANKING DE PETS — ESTE GRUPO*\n\nNenhum pet registrado ainda.\n\n_Use *!capturar* para conseguir o seu!_`
      );
    }

    const ranks = carteiras
      .map(c => ({ ...c, score: getRankScore(c.pet) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const linhas = await Promise.all(ranks.map(async (entry, i) => {
      const nome = await resolveDisplayName(entry.idWhatsApp, sock, contactNames, { fallback: 'Tutor' });
      const def = getPersonagem(entry.pet);
      const re    = RARITY_EMOJI[entry.pet.rarity] ?? '⭐';
      const nivel = entry.pet.level ?? 1;
      const xp    = entry.pet.xp    ?? 0;
      const humor = getHumor(entry.pet);

      return (
        MEDALS[i] + ' *' + nome + '*\n' +
        `   ${def.emoji} *${entry.pet.name}* ${re} (${entry.pet.rarity ?? '?'})\n` +
        `   🏆 Nível *${nivel}* | ✨ XP *${xp}* | ${humor}`
      );
    }));

    const texto =
      `🐾 *RANKING DE PETS — TOP ${ranks.length}* 🐾\n` +
      `━━━━━━━━━━━━━━━━\n\n` +
      linhas.join('\n\n') +
      `\n\n━━━━━━━━━━━━━━━━\n` +
      `_Use *!capturar* para entrar no ranking!_`;

    return sock.sendMessage(jid, { text: texto }, { quoted: msg });

  } catch (e) {
    console.error('[PetRank] Erro geral:', e);
    return reply(sock, jid, msg, '⚠️ Erro ao carregar o ranking de pets. Tente novamente.');
  }
}

// !pets — coleção particular do jogador neste grupo
async function handlePets(sock, msg, jid, caption = '') {
  const userId = await getUserId(msg, jid);
  if (!userId) return;
  try {
    const colecao = await getPetCollection(userId, jid);
    if (!colecao.length) {
      return reply(sock, jid, msg,
        `🎒 *SUA COLEÇÃO DE PERSONAGENS*\n\nVocê ainda não capturou nenhum personagem neste grupo.\n\n` +
        `Use *!personagens* para ver o catálogo e *!capturar* quando um aparecer.`
      );
    }

    const carteira = await getCarteira(userId, jid);
    const ativoId = carteira?.pet?.petId;
    let texto = `🎒 *SUA COLEÇÃO — ESTE GRUPO* (${colecao.length})\n━━━━━━━━━━━━━━━━━━\n\n`;
    for (const [i, pet] of colecao.entries()) {
      const def = getPersonagem(pet);
      const raridade = RARITY_EMOJI[pet.rarity] ?? '⭐';
      const ativo = pet.petId === ativoId;
      texto += `${i + 1}. ${def.emoji} *${pet.name}* ${raridade}${ativo ? ' ✅ _ativo_' : ''}\n`;
      texto += `   └ ${pet.rarity ?? 'COMUM'} • Nível ${pet.level ?? 1} • ${obterEstagioPet(pet)}\n`;
      texto += `   └ 😊 ${pet.happiness ?? 0}% • ⚡ ${pet.energy ?? 0}% • ❤️ ${pet.health ?? 100}%\n`;
      if (!ativo) texto += `   └ 📌 _!petselecionar ${pet.name.includes(' ') ? `"${pet.name}"` : pet.name}_\n`;
      texto += '\n';
    }
    texto += `━━━━━━━━━━━━━━━━━━\n`;
    texto += `📌 Para trocar o personagem ativo: *!petselecionar <nome>*\n`;
    texto += `🌿 Para ver todos os personagens existentes: *!personagens*`;
    return reply(sock, jid, msg, texto);
  } catch (err) {
    console.error('[pets:colecao] Erro ao carregar coleção:', err);
    return reply(sock, jid, msg, '⚠️ Não foi possível carregar sua coleção agora. Tente novamente.');
  }
}

// !personagens — catálogo de espécies/personagens que podem surgir
async function handleCatalogoPersonagens(sock, msg, jid, caption = '') {
  const prefixMatch = caption.match(/^([!.,/])/);
  const prefix = prefixMatch ? prefixMatch[1] : '!';
  const grupos = { 'PERSONAGENS (RARIDADE ALEATÓRIA)': PERSONAGENS.map(p => `  🐾 *${p.nome}*`) };
  const spawnAtivo = getSpawnAtivo(jid);
  const spawnAviso = spawnAtivo
    ? `\n🌿 *UM PERSONAGEM ESTÁ APARECIDO AGORA!* Use *${prefix}capturar* rápido!\n`
    : '';
  let texto = `🎭 *CATÁLOGO DE PERSONAGENS* 🎭${spawnAviso}\n`;
  for (const [rar, lista] of Object.entries(grupos)) {
    if (!lista.length) continue;
    texto += `🎲 *${rar}* (${lista.length})\n${lista.join('\n')}\n\n`;
  }
  texto += `💡 _Um personagem pode surgir a cada 30 minutos, quando os spawns estão ativados no grupo._`;
  return reply(sock, jid, msg, texto);
}

// handleAbrigo — !abrigo deixar / !abrigo <nome> pegar
async function handleAbrigo(sock, msg, jid, caption = '') {
  if (!jid?.endsWith('@g.us')) {
    return reply(sock, jid, msg, '⚠️ O abrigo de personagens só pode ser usado em grupos.');
  }

  const userId = await getUserId(msg, jid);
  if (!userId) return;

  const prefixMatch = caption.match(/^([!.,/])/);
  const prefix = prefixMatch ? prefixMatch[1] : '!';

  const args = caption
    .replace(/^[!.,/]?(?:abrigo|shelter)\s*/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(s => s.toLowerCase());

  try {
    await Promise.all([
      limparPetsExpiradosDoAbrigo(CarteiraGrupo),
      limparPetsExpiradosDoAbrigo(Usuario), // limpa apenas registros globais antigos, ainda não migrados
    ]);
  } catch (err) {
    logError('abrigo', err, 'Falha ao expirar personagens antigos');
    return reply(sock, jid, msg, '⚠️ Não foi possível atualizar o abrigo agora. Tente novamente!');
  }

  // ── !abrigo migrar — trazer o antigo abrigo global para este grupo ─────────
  if (args[0] === 'migrar') {
    let legado;
    try {
      legado = await Usuario.findOne({
        idWhatsApp: userId,
        'petShelter.isSheltered': true,
        'petShelter.shelteredPet.name': { $exists: true },
      }).select('petShelter').lean();
    } catch (err) {
      console.error('[abrigo:migrar] Erro ao buscar abrigo legado:', err);
      return reply(sock, jid, msg, '❌ Não foi possível consultar seu abrigo antigo. Tente novamente!');
    }

    const petLegado = legado?.petShelter?.shelteredPet;
    if (!petLegado?.name) {
      return reply(sock, jid, msg, 'ℹ️ Você não tem personagem guardado no abrigo antigo para migrar.');
    }

    const leftAtLegado = legado.petShelter.leftAt ? new Date(legado.petShelter.leftAt) : new Date();
    if (!Number.isFinite(leftAtLegado.getTime()) || Date.now() - leftAtLegado.getTime() >= ABRIGO_TEMPO_MAXIMO_MS) {
      await Usuario.findOneAndUpdate(
        { idWhatsApp: userId, 'petShelter.isSheltered': true, 'petShelter.shelteredPet.name': petLegado.name },
        { $set: { 'petShelter.isSheltered': false, 'petShelter.shelteredPet': null, 'petShelter.leftAt': null } }
      );
      return reply(sock, jid, msg, '⌛ Seu personagem do abrigo antigo já ultrapassou os 20 minutos e expirou.');
    }

    let carteira;
    try {
      carteira = await getCarteira(userId, jid);
    } catch (err) {
      console.error('[abrigo:migrar] Erro ao resolver carteira do grupo:', err);
      return reply(sock, jid, msg, '❌ Não foi possível abrir a carteira deste grupo. Tente novamente!');
    }

    if (carteira?.pet?.name) {
      return reply(sock, jid, msg, `⚠️ Você já tem *${carteira.pet.name}* ativo neste grupo. Use *${prefix}abrigo deixar* ou libere-o antes de migrar.`);
    }
    if (carteira?.petShelter?.isSheltered && carteira.petShelter.shelteredPet?.name) {
      return reply(sock, jid, msg, `⚠️ Você já tem *${carteira.petShelter.shelteredPet.name}* no abrigo deste grupo.`);
    }

    let retiradoDoLegado;
    try {
      retiradoDoLegado = await Usuario.findOneAndUpdate(
        {
          idWhatsApp: userId,
          'petShelter.isSheltered': true,
          'petShelter.shelteredPet.name': petLegado.name,
          'petShelter.leftAt': legado.petShelter.leftAt ?? null,
        },
        { $set: { 'petShelter.isSheltered': false, 'petShelter.shelteredPet': null, 'petShelter.leftAt': null } },
        { new: true }
      );
    } catch (err) {
      console.error('[abrigo:migrar] Erro ao reservar personagem antigo:', err);
      return reply(sock, jid, msg, '❌ Não foi possível reservar seu personagem antigo. Tente novamente!');
    }

    if (!retiradoDoLegado) {
      return reply(sock, jid, msg, '⚠️ Seu abrigo antigo foi alterado por outra ação. Consulte novamente.');
    }

    try {
      const salvo = await CarteiraGrupo.findOneAndUpdate(
        {
          _id: carteira._id,
          idGrupo: jid,
          'pet.name': { $in: [null, ''] },
          'petShelter.isSheltered': { $ne: true },
        },
        {
          $set: {
            petShelter: {
              isSheltered: true,
              shelteredPet: petLegado,
              leftAt: leftAtLegado,
            },
          },
        },
        { new: true }
      );
      if (!salvo) throw new Error('A carteira do grupo mudou durante a migração.');
    } catch (err) {
      console.error('[abrigo:migrar] Erro ao salvar personagem no grupo:', err);
      await Usuario.findOneAndUpdate(
        { idWhatsApp: userId, 'petShelter.isSheltered': false, 'petShelter.shelteredPet': null },
        { $set: { petShelter: legado.petShelter } }
      ).catch(rollbackError => console.error('[abrigo:migrar] Falha ao restaurar o abrigo antigo:', rollbackError));
      return reply(sock, jid, msg, '❌ Não foi possível migrar o personagem. O abrigo antigo foi restaurado; tente novamente.');
    }

    return reply(sock, jid, msg,
      `✅ *PERSONAGEM MIGRADO!*\n\n` +
      `🐾 *${petLegado.name}* agora está no abrigo deste grupo.\n` +
      `⏳ O prazo original de 20 minutos foi preservado.\n\n` +
      `Use *${prefix}abrigo* para consultar ou *${prefix}abrigo ${petLegado.name.includes(' ') ? `\"${petLegado.name}\"` : petLegado.name} pegar* para resgatar.`
    );
  }

  // ── !abrigo deixar ───────────────────────────────────────────────────────────
  if (args[0] === 'deixar') {
    let pet;
    try {
      pet = await getPet(userId, jid);
    } catch (err) {
      console.error('[abrigo:deixar] Erro ao buscar pet:', err);
      return reply(sock, jid, msg, '❌ Erro interno ao buscar seu personagem. Tente novamente!');
    }

    if (!pet?.name) {
      return reply(sock, jid, msg,
        `⚠️ Você não tem um pet para deixar no abrigo.\n_Capture um com *${prefix}capturar*!_`
      );
    }

    let carteira;
    try {
      carteira = await getCarteira(userId, jid);
      pet = petParaObjeto(carteira?.pet) ?? pet;
    } catch (err) {
      console.error('[abrigo:deixar] Erro ao resolver carteira do grupo:', err);
      return reply(sock, jid, msg, '❌ Erro interno ao verificar seu abrigo. Tente novamente!');
    }

    if (carteira?.petShelter?.isSheltered && carteira.petShelter.shelteredPet?.name) {
      const nomePetAbrigo = carteira.petShelter.shelteredPet.name;
      const nomeCmdResgatar = nomePetAbrigo.includes(' ') ? `"${nomePetAbrigo}"` : nomePetAbrigo;
      return reply(sock, jid, msg,
        `⚠️ Você já tem *${nomePetAbrigo}* no abrigo deste grupo!\n\n` +
        `_Resgate-o primeiro com: *${prefix}abrigo ${nomeCmdResgatar} pegar*_`
      );
    }

    try {
      const petsRestantes = Array.from(carteira.pets || [])
        .map(petParaObjeto)
        .filter(p => p?.name && !mesmaIdentidadePet(p, pet));
      const resultado = await CarteiraGrupo.findOneAndUpdate(
        {
          _id: carteira._id,
          idGrupo: jid,
          'pet.name': pet.name,
          'petShelter.isSheltered': { $ne: true },
        },
        {
          $set: {
            pet: petsRestantes[0] || null,
            pets: petsRestantes,
            petShelter: {
              isSheltered: true,
              shelteredPet: pet,
              leftAt: new Date(),
            },
          },
        },
        { new: true }
      );

      if (!resultado) {
        return reply(sock, jid, msg, '⚠️ Seu personagem mudou enquanto era enviado ao abrigo. Consulte *!statuspet* e tente novamente.');
      }
      petCache.delete(`${userId}:${jid}`);
    } catch (err) {
      console.error('[abrigo:deixar] Erro ao salvar no abrigo do grupo:', err);
      return reply(sock, jid, msg, '❌ Erro interno ao enviar pet ao abrigo. Tente novamente!');
    }

    const def = getPersonagem(pet);
    const re  = RARITY_EMOJI[pet.rarity] ?? '⭐';
    const nomeCmdPegar = pet.name.includes(' ') ? `"${pet.name}"` : pet.name;

    return reply(sock, jid, msg,
      `🏥 *PET ENVIADO AO ABRIGO!*\n\n` +
      `${def.emoji} *${pet.name}* ${re} (${pet.rarity ?? '?'})\n` +
      `🏆 Nível *${pet.level ?? 1}* | ✨ XP *${pet.xp ?? 0}*\n` +
      `😊 Felicidade *${pet.happiness ?? 0}%* | ⚡ Energia *${pet.energy ?? 0}%* | 🍽️ Fome *${pet.fullness ?? 0}%*\n\n` +
      `📋 Para ver o abrigo: *${prefix}abrigo*\n` +
      `🔄 Para resgatar: *${prefix}abrigo ${nomeCmdPegar} pegar*\n\n` +
      `💡 _Qualquer pessoa pode adotá-lo nos próximos 20 minutos. Depois disso, ele será removido do abrigo._`
    );
  }

  // ── !abrigo <nome> pegar ─────────────────────────────────────────────────────
  if (args.length >= 2 && args[args.length - 1] === 'pegar') {
    // Reconstrói o nome preservando capitalização original (antes do .toLowerCase())
    const nomeBusca = caption
      .replace(/^[!.,/]?(?:abrigo|shelter)\s*/i, '')
      .trim()
      .replace(/\s+pegar$/i, '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .trim();

    let alvo;
    try {
      const candidatos = await CarteiraGrupo.find(filtroAbrigoDoGrupo(jid))
        .select('idWhatsApp petShelter')
        .lean();
      const normalizarNome = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const exatos = candidatos.filter(c => normalizarNome(c.petShelter?.shelteredPet?.name) === normalizarNome(nomeBusca));
      const parciais = candidatos.filter(c => normalizarNome(c.petShelter?.shelteredPet?.name).includes(normalizarNome(nomeBusca)));
      alvo = exatos[0] || (parciais.length === 1 ? parciais[0] : null);
      if (!exatos.length && parciais.length > 1) {
        return reply(sock, jid, msg, `⚠️ Há mais de um personagem parecido com *${nomeBusca}*. Informe o nome completo que aparece em *!abrigo*.`);
      }
    } catch (err) {
      console.error('[abrigo:pegar] Erro ao buscar no banco:', err);
      return reply(sock, jid, msg, '❌ Erro interno ao buscar no abrigo. Tente novamente!');
    }

    if (!alvo?.petShelter?.shelteredPet) {
      // Lista os pets disponíveis para ajudar o usuário
      let sugestoes = '';
      try {
        const disponiveis = await CarteiraGrupo.find(filtroAbrigoDoGrupo(jid))
          .select('petShelter.shelteredPet.name petShelter.shelteredPet.type petShelter.shelteredPet.rarity')
          .lean();
        const nomes = disponiveis
          .map(u => {
            const p = u.petShelter?.shelteredPet;
            if (!p?.name) return null;
            const def = getPersonagem(p);
            const re  = RARITY_EMOJI[p.rarity] ?? '⭐';
            return `${def.emoji} *${p.name}* ${re}`;
          })
          .filter(Boolean);
        if (nomes.length) {
          sugestoes = `\n\n🐾 *Pets disponíveis no abrigo:*\n${nomes.map(n => `• ${n}`).join('\n')}`;
        }
      } catch (error) {
        logError('abrigo', error, 'Falha ao carregar sugestões de pets do abrigo');
      }

      return reply(sock, jid, msg,
        `❌ Nenhum pet com o nome "*${nomeBusca}*" encontrado no abrigo.\n` +
        `_Verifique o nome exato — use o nome que aparece na lista._` +
        sugestoes +
        `\n\nVer lista completa: *${prefix}abrigo*`
      );
    }

    // Adoção acrescenta à coleção; o personagem ativo atual não é substituído.
    try { await getCarteira(userId, jid); }
    catch (err) {
      console.error('[abrigo:pegar] Erro ao buscar carteira do adotante:', err);
      return reply(sock, jid, msg, '❌ Erro interno. Tente novamente!');
    }

    const petAdotado   = alvo.petShelter.shelteredPet;
    const donoOriginal = alvo.idWhatsApp;
    const donoResolvido = await resolverJidCarteira(donoOriginal, jid);
    const ehSeuProprio = donoResolvido === userId;

    // Trava otimista: marca como não-sheltered antes de salvar no adotante
    // para evitar adoções duplas simultâneas
    let liberou;
    try {
      liberou = await CarteiraGrupo.findOneAndUpdate(
        {
          _id: alvo._id,
          ...filtroAbrigoDoGrupo(jid),
          'petShelter.shelteredPet.name': petAdotado.name,
        },
        {
          $set: {
            petShelter: {
              isSheltered: false,
              shelteredPet: null,
              leftAt: null,
            },
          },
        },
        { new: true }
      );
    } catch (err) {
      console.error('[abrigo:pegar] Erro ao liberar pet do abrigo:', err);
      return reply(sock, jid, msg, '❌ Erro interno ao liberar o pet do abrigo. Tente novamente!');
    }

    if (!liberou) {
      return reply(sock, jid, msg,
        `⚠️ *${petAdotado.name}* já foi adotado por outra pessoa agora mesmo!\n\n` +
        `Ver lista atualizada: *${prefix}abrigo*`
      );
    }

    try {
      await addPetToCollection(userId, jid, petAdotado, { activateIfEmpty: true });
    } catch (err) {
      console.error('[abrigo:pegar] Erro ao salvar pet adotado:', err);
      // Rollback: restaura o pet no abrigo do dono original se falhar ao salvar no adotante
      try {
        await CarteiraGrupo.findOneAndUpdate(
          { _id: alvo._id, idGrupo: jid, 'petShelter.isSheltered': false },
          {
            $set: {
              petShelter: {
                isSheltered: true,
                shelteredPet: petAdotado,
                leftAt: alvo.petShelter.leftAt,
              },
            },
          }
        );
      } catch (rbErr) {
        console.error('[abrigo:pegar] Erro no rollback:', rbErr);
      }
      return reply(sock, jid, msg, '❌ Erro interno ao adotar o pet. Tente novamente!');
    }

    const def = getPersonagem(petAdotado);
    const re = RARITY_EMOJI[petAdotado.rarity] ?? '⭐';
    const nomeDono = ehSeuProprio
      ? ''
      : await resolveDisplayName(donoOriginal, sock, {}, { fallback: 'um membro' });
    const dono = ehSeuProprio ? '_era seu próprio pet_' : '_de *' + nomeDono + '*_';

    return replyWithPetImage(sock, jid, msg, petAdotado,
        `🎉 *ADOÇÃO CONCLUÍDA!*\n\n` +
        `${def.emoji} *${petAdotado.name}* ${re} (${petAdotado.rarity ?? '?'})\n` +
        `🏆 Nível *${petAdotado.level ?? 1}* | ✨ XP *${petAdotado.xp ?? 0}*\n` +
        `😊 Felicidade *${petAdotado.happiness ?? 0}%* | ⚡ Energia *${petAdotado.energy ?? 0}%*\n` +
        `${dono}\n\n` +
        `O personagem foi adicionado à sua coleção. Use *${prefix}petselecionar ${petAdotado.name.includes(' ') ? `\"${petAdotado.name}\"` : petAdotado.name}* para ativá-lo; *${prefix}statuspet* mostra o personagem ativo.`,
      { context: 'abrigo' }
    );
  }

  // ── !abrigo (listagem) ───────────────────────────────────────────────────────
  try {
    const lista = await CarteiraGrupo.find(filtroAbrigoDoGrupo(jid))
      .select('idWhatsApp petShelter')
      .lean();

    // Filtra entradas inválidas (sem pet ou sem nome)
    const validos = lista.filter(u => u.petShelter?.shelteredPet?.name);

    if (!validos.length) {
      return reply(sock, jid, msg,
        `🏥 *ABRIGO DE PETS*\n\n` +
        `😔 O abrigo está vazio no momento!\n\n` +
        `💡 Deixe seu pet com: *${prefix}abrigo deixar*\n` +
        `_Tinha um personagem no abrigo antigo? Use *${prefix}abrigo migrar* neste grupo._`
      );
    }

    // Ordena: pet do próprio usuário aparece primeiro
    validos.sort((a, b) => {
      if (a.idWhatsApp === userId) return -1;
      if (b.idWhatsApp === userId) return 1;
      return 0;
    });

    let texto = '🏥 *ABRIGO DE PETS DESTE GRUPO* — ' + validos.length + ' pet(s)\n⏳ Permanência máxima: *20 minutos*\n━━━━━━━━━━━━━━━━━━\n\n';

    for (const [i, u] of validos.entries()) {
      const p = u.petShelter.shelteredPet;
      const def = getPersonagem(p);
      const re = RARITY_EMOJI[p.rarity] ?? '⭐';
      const humor = getHumor(p);
      const ehSeu = u.idWhatsApp === userId;
      const nomeDono = ehSeu ? '' : await resolveDisplayName(u.idWhatsApp, sock, {}, { fallback: 'membro' });
      const dono = ehSeu ? ' *(seu)*' : ' _de *' + nomeDono + '*_';

      // Tempo no abrigo
      let tempoAbrigo = '';
      if (u.petShelter?.leftAt) {
        const diffMs = Date.now() - new Date(u.petShelter.leftAt).getTime();
        tempoAbrigo = ` • ⏳ ${formatarTempo(diffMs)} no abrigo`;
      }

      texto += `${i + 1}. ${def.emoji} *${p.name}* ${re}${dono}${tempoAbrigo}\n`;
      texto += `   └ 🏆 Nível *${p.level ?? 1}* | 😊 *${p.happiness ?? 0}%* | ⚡ *${p.energy ?? 0}%* | 🍽️ *${p.fullness ?? 0}%*\n`;
      texto += `   └ ${humor}\n`;
      texto += `   └ 📋 _${prefix}abrigo ${p.name.includes(' ') ? `"${p.name}"` : p.name} pegar_\n\n`;
    }

    texto += `━━━━━━━━━━━━━━━━━━\n`;
    texto += `🔄 *Adotar:* _${prefix}abrigo <nome exato> pegar_\n`;
    texto += `📤 *Deixar seu personagem:* _${prefix}abrigo deixar_`;

    return reply(sock, jid, msg, texto);
  } catch (err) {
    console.error('[abrigo:listar] Erro ao carregar lista:', err);
    return reply(sock, jid, msg, '⚠️ Erro ao carregar o abrigo. Tente novamente!');
  }
}

// Stub de compatibilidade
async function handleAdoptarPet(sock, msg, jid, caption = '') {
  const prefixMatch = caption?.match(/^([!.,/])/);
  const prefix = prefixMatch ? prefixMatch[1] : '!';
  return reply(sock, jid, msg, `⚠️ Use *${prefix}abrigo <nome> pegar* para adotar um personagem do abrigo!`);
}

// ─── TRIGGER MANUAL (compatibilidade + uso interno do scheduler) ──────────────

// ─── SPAWN DE PETS ────────────────────────────────────────────────────────────

/**
 * Dispara um spawn de pet selvagem num grupo.
 * Retorna true em sucesso, false em falha (sem lançar exceção).
 */
async function grupoPodeReceberSpawn(groupJid) {
  const config = await GrupoConfig.findOne({ idGrupo: groupJid }).select('botAtivo').lean();
  // Grupo sem configuração ainda segue o padrão do roteador: bot ligado.
  return config?.botAtivo !== false;
}

async function triggerSpawn(sock, groupJid) {
  let spawn;
  try {
    // O scheduler deve respeitar /bot off, mesmo que !pet on continue configurado.
    if (!(await grupoPodeReceberSpawn(groupJid))) {
      console.log(`[triggerSpawn] Bot desligado em ${groupJid}; spawn cancelado.`);
      return false;
    }

    // Garante o documento e reivindica o espaço apenas se não houver personagem válido.
    await PetSpawn.obterOuCriar(groupJid);
    const agora = Date.now();
    spawn = {
      type: PERSONAGENS[Math.floor(Math.random() * PERSONAGENS.length)].type,
      rarity: sortearRaridadePet().rarity,
      spawnedAt: agora,
    };
    const reivindicado = await PetSpawn.findOneAndUpdate(
      {
        idGrupo: groupJid,
        $or: [
          { personagemAtivo: null },
          { 'personagemAtivo.spawnedAt': { $exists: false } },
          { 'personagemAtivo.spawnedAt': { $lte: agora - 60 * 60 * 1000 } },
        ],
      },
      { $set: { personagemAtivo: spawn } },
      { new: true }
    );
    if (!reivindicado) {
      console.log(`[triggerSpawn] Já existe personagem ativo em ${groupJid}; spawn ignorado.`);
      return false;
    }
    spawnedPets.set(groupJid, spawn);
    setTimeout(() => {
      if (spawnedPets.get(groupJid)?.spawnedAt === spawn.spawnedAt) spawnedPets.delete(groupJid);
    }, 60 * 60 * 1000);
  } catch (err) {
    console.error('[triggerSpawn] Não foi possível reservar personagem ativo:', err.message || err);
    spawnedPets.delete(groupJid);
    return false;
  }
  const def   = PET_SYSTEM[spawn.type];
  const re    = RARITY_EMOJI[spawn.rarity] ?? '⭐';

  if (!def) {
    console.error(`[triggerSpawn] Tipo de pet inválido após spawn: "${spawn.type}"`);
    spawnedPets.delete(groupJid); // limpa spawn inválido
    return false;
  }

  // Evita anunciar caso /bot off tenha sido ativado durante a reserva do personagem.
  try {
    if (!(await grupoPodeReceberSpawn(groupJid))) {
      spawnedPets.delete(groupJid);
      await PetSpawn.updateOne(
        { idGrupo: groupJid, 'personagemAtivo.spawnedAt': spawn.spawnedAt },
        { $unset: { personagemAtivo: '' } }
      );
      console.log(`[triggerSpawn] Bot desligado durante a reserva em ${groupJid}; spawn cancelado.`);
      return false;
    }
  } catch (err) {
    spawnedPets.delete(groupJid);
    try {
      await PetSpawn.updateOne(
        { idGrupo: groupJid, 'personagemAtivo.spawnedAt': spawn.spawnedAt },
        { $unset: { personagemAtivo: '' } }
      );
    } catch (cleanupErr) {
      console.error('[triggerSpawn] Falha ao liberar reserva após erro de configuração:', cleanupErr.message || cleanupErr);
    }
    console.error('[triggerSpawn] Não foi possível confirmar se o bot está ligado:', err.message || err);
    return false;
  }

  // Mensagem varia levemente por raridade para dar mais impacto
  const abertura = {
    'COMUM':      '🌿 *UM PERSONAGEM APARECEU!* 🌿',
    'RARO':       '🌟 *UM PERSONAGEM RARO SURGIU DAS SOMBRAS!* 🌟',
    'ULTRA-RARO': '💎 *UM PERSONAGEM ULTRA-RARO EMERGIU!* 💎',
    'LENDÁRIO':   '👑 *UM PERSONAGEM LENDÁRIO DESCEU DOS CÉUS!* 👑',
  }[spawn.rarity] ?? '🌿 *UM PERSONAGEM APARECEU!* 🌿';

  try {
    await sock.sendMessage(groupJid, {
      image: getPetImage(def),
      caption:
        `${abertura}\n\n` +
        `*${def.nome}* ${re} (${spawn.rarity})\n\n` +
        `⚡ Digite *!capturar* para tentar capturar!\n` +
        `📊 Taxa de captura: *${Math.round((RARIDADES_PET.find(r => r.rarity === spawn.rarity)?.catchRate ?? 0.5) * 100)}%*\n` +
        `⏳ Vai embora em *1 hora*.\n\n` +
        `_Seja rápido — só um jogador pode capturá-lo!_`,
    });
    return true;
  } catch (err) {
    console.error(`[triggerSpawn] Falha ao enviar mensagem para ${groupJid}:`, err.message ?? err);
    // Remove o spawn do mapa se não conseguiu nem avisar o grupo
    spawnedPets.delete(groupJid);
    try { await PetSpawn.updateOne({ idGrupo: groupJid, 'personagemAtivo.spawnedAt': spawn.spawnedAt }, { $unset: { personagemAtivo: '' } }); } catch (cleanupErr) { console.error('[triggerSpawn] Falha ao limpar personagem não enviado:', cleanupErr.message || cleanupErr); }
    return false;
  }
}

// ─── REGISTRO DE GRUPOS ATIVOS ────────────────────────────────────────────────

const activeGroups = new Set();

/**
 * Registra um grupo como ativo para receber spawns periódicos.
 * Idempotente — chamar múltiplas vezes com o mesmo JID não duplica.
 */
function registerActiveGroup(jid) {
  if (!jid?.endsWith('@g.us')) return; // ignora JIDs inválidos silenciosamente
  activeGroups.add(jid);
}

// ─── HELPERS DO SCHEDULER ─────────────────────────────────────────────────────

/**
 * Verifica se o socket está pronto para enviar mensagens.
 */
function isSockReady(sock) {
  return !!(sock?.user);
}

/**
 * Aguarda N milissegundos.
 */
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

/**
 * Tenta disparar o spawn com retentativas em caso de falha de conexão.
 * Não lança exceção — erros são logados e absorvidos.
 *
 * @param {object} sock
 * @param {string} jid
 * @param {number} tentativas — máximo de tentativas (padrão 3)
 * @param {number} delayMs    — espera entre tentativas em ms (padrão 15s)
 */
async function tentarSpawnComRetry(sock, jid, tentativas = 3, delayMs = 15_000) {
  for (let i = 1; i <= tentativas; i++) {

    // Aguarda a conexão estar pronta antes de tentar
    if (!isSockReady(sock)) {
      console.warn(
        `[PetScheduler] Socket não pronto para ${jid} ` +
        `(tentativa ${i}/${tentativas}). Aguardando ${delayMs / 1000}s...`
      );
      await sleep(delayMs);
      continue;
    }

    const ok = await triggerSpawn(sock, jid);

    if (ok) {
      if (i > 1) console.log(`[PetScheduler] Spawn concluído para ${jid} na tentativa ${i}.`);
      return true;
    }

    // triggerSpawn retornou false — verifica se vale tentar de novo
    if (i < tentativas) {
      console.warn(
        `[PetScheduler] Spawn falhou para ${jid} ` +
        `(tentativa ${i}/${tentativas}). Nova tentativa em ${delayMs / 1000}s...`
      );
      await sleep(delayMs);
    } else {
      console.error(
        `[PetScheduler] Spawn abandonado para ${jid} após ${tentativas} tentativa(s).`
      );
    }
  }
  return false;
}

// ─── SCHEDULER PRINCIPAL ──────────────────────────────────────────────────────

const PetSpawn = require('../../models/PetSpawn');

const INTERVALO_MS = 30 * 60 * 1000; // 30 minutos
const CHECK_INTERVAL = 30 * 1000; // verifica cooldowns a cada 30s
const GROUP_REFRESH_INTERVAL = 10 * 60 * 1000; // atualiza grupos no máximo a cada 10 min
const FUSO_PET = 'America/Cuiaba';

// Pausa automática das 22:00 às 09:00, no fuso de Cuiabá.
function dentroDaPausaDeSpawn(data = new Date()) {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO_PET, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(data);
  const hora = Number(partes.find(p => p.type === 'hour')?.value ?? 0);
  return hora >= 22 || hora < 9;
}

/**
 * Inicia o scheduler de spawn de pets com persistência no MongoDB.
 * O timestamp do último spawn é salvo por grupo, então reinicializações
 * do servidor não resetam o cooldown. Grupos com spawnAtivo=false
 * (definido via !pet off) são pulados automaticamente.
 */
function initPetScheduler(sock) {
  let currentSock = sock;
  let cicloEmAndamento = false;
  let timerInicial = null;
  let ultimaAtualizacaoGrupos = 0;

  initPetScheduler.updateSock = (newSock) => {
    currentSock = newSock;
    console.log('[PetScheduler] Socket atualizado após reconexão.');
  };

  async function cicloSpawn() {
    if (cicloEmAndamento) return;
    cicloEmAndamento = true;
    try {
    // Atualiza a lista de grupos com limite de frequência. Consultar o WhatsApp
    // a cada ciclo (30s) causa rate-overlimit; em caso de erro, mantém os grupos
    // já conhecidos e aguarda o próximo intervalo antes de tentar novamente.
    const agoraRefresh = Date.now();
    if (
      isSockReady(currentSock) &&
      typeof currentSock.groupFetchAllParticipating === 'function' &&
      agoraRefresh - ultimaAtualizacaoGrupos >= GROUP_REFRESH_INTERVAL
    ) {
      ultimaAtualizacaoGrupos = agoraRefresh;
      try {
        const grupos = await currentSock.groupFetchAllParticipating();
        for (const jid of Object.keys(grupos || {})) registerActiveGroup(jid);
      } catch (err) {
        console.warn('[PetScheduler] Não foi possível atualizar grupos; mantendo a lista em cache:', err.message);
      }
    }

    // Expira personagens do abrigo a cada ciclo, mesmo quando não há grupos
    // ativos ou quando os spawns automáticos estão na pausa noturna.
    try {
      const [removidosAbrigo, removidosAbrigoLegado] = await Promise.all([
        limparPetsExpiradosDoAbrigo(CarteiraGrupo),
        limparPetsExpiradosDoAbrigo(Usuario),
      ]);
      const totalRemovidos = removidosAbrigo + removidosAbrigoLegado;
      if (totalRemovidos > 0) {
        console.log(`[PetScheduler] Abrigo: ${totalRemovidos} personagem(ns) expirado(s) após 20 minutos.`);
      }
    } catch (err) {
      console.error('[PetScheduler] Falha ao limpar personagens expirados do abrigo:', err.message);
    }

    const total = activeGroups.size;

    if (total === 0) {
      console.log('[PetScheduler] Nenhum grupo ativo, ciclo ignorado.');
      return;
    }

    if (!isSockReady(currentSock)) {
      console.warn('[PetScheduler] Socket não pronto, ciclo ignorado.');
      return;
    }

    if (dentroDaPausaDeSpawn()) {
      console.log('[PetScheduler] Pausa noturna ativa (22:00–09:00, horário de Cuiabá); spawns automáticos suspensos.');
      return;
    }

    console.log(`[PetScheduler] Ciclo iniciado — ${total} grupo(s) ativo(s).`);

    const agora = Date.now();
    let sucessos   = 0;
    let ignorados  = 0;
    let desativados = 0;

    for (const jid of activeGroups) {
      try {
        // /bot off também pausa spawns automáticos, sem alterar a preferência !pet on/off.
        if (!(await grupoPodeReceberSpawn(jid))) {
          desativados++;
          continue;
        }

        // Busca o registro completo deste grupo no banco
        const registro = await PetSpawn.findOne({ idGrupo: jid }).lean();

        // ── Spawn desativado via !pet off — pula sem mexer no timestamp ──
        if (registro?.spawnAtivo !== true) {
          desativados++;
          continue;
        }

        const ultimoSpawn  = registro?.ultimoSpawn ? new Date(registro.ultimoSpawn).getTime() : 0;
        const tempoPassado = agora - ultimoSpawn;

        // Se ainda não passou o intervalo desde o último spawn, pula
        if (tempoPassado < INTERVALO_MS) {
          const falta = INTERVALO_MS - tempoPassado;
          const min   = Math.ceil(falta / 60000);
          console.log(`[PetScheduler] ${jid} — próximo spawn em ${min}min, pulando.`);
          ignorados++;
          continue;
        }

        // Só registra o horário quando a mensagem realmente foi enviada.
        // Falhas de conexão não devem consumir o intervalo de 30 minutos.
        const enviado = await tentarSpawnComRetry(currentSock, jid);
        if (enviado) {
          await PetSpawn.findOneAndUpdate(
            { idGrupo: jid },
            { $set: { ultimoSpawn: new Date() }, $inc: { totalSpawns: 1 } },
            { upsert: true }
          );
          sucessos++;
        } else {
          console.warn(`[PetScheduler] ${jid} não recebeu spawn; tentará novamente no próximo ciclo.`);
        }

        if (total > 1) await sleep(500);
      } catch (err) {
        console.error(`[PetScheduler] Erro ao processar spawn para ${jid}:`, err.message);
      }
    }

    console.log(
      `[PetScheduler] Ciclo concluído — ✅ ${sucessos} spawn(s) | ⏭️ ${ignorados} aguardando | 🔇 ${desativados} desativado(s).`
    );
    } finally {
      cicloEmAndamento = false;
    }
  }

  if (initPetScheduler._timer) clearInterval(initPetScheduler._timer);
  if (initPetScheduler._initialTimer) clearTimeout(initPetScheduler._initialTimer);

  // Primeira verificação rápida após conectar; depois checa a cada 30 segundos.
  initPetScheduler._initialTimer = setTimeout(() => {
    cicloSpawn().catch(err => console.error('[PetScheduler] Falha no ciclo:', err.message));
    initPetScheduler._timer = setInterval(() => {
      cicloSpawn().catch(err => console.error('[PetScheduler] Falha no ciclo:', err.message));
    }, CHECK_INTERVAL);
  }, 10 * 1000);

  console.log(`[PetScheduler] Iniciado. Intervalo entre spawns: ${INTERVALO_MS / 60000}min; pausa automática 22:00–09:00 (${FUSO_PET}); verificação a cada ${CHECK_INTERVAL / 1000}s.`);
}

// !statuspet
async function handleStatusPet(sock, msg, jid, caption = '') {
  const userId = await getUserId(msg, jid);
  if (!userId) return;

  const prefixMatch = caption?.match(/^([!.,/])/);
  const prefix = prefixMatch ? prefixMatch[1] : '!';

  // ── Buscar pet ────────────────────────────────────────────
  let pet;
  try {
    pet = await getPet(userId, jid);
  } catch (err) {
    console.error('[statuspet] Erro ao buscar pet:', err);
    return reply(sock, jid, msg, '❌ Erro interno ao buscar seu personagem. Tente novamente!');
  }

  if (!pet?.name) {
    return reply(sock, jid, msg,
      `⚠️ Você não tem um pet!\n\n_Aguarde um spawn e use *${prefix}capturar* para pegar um._`
    );
  }

  // ── Dados do pet ──────────────────────────────────────────
  const def   = getPersonagem(pet);
  const re    = RARITY_EMOJI[pet.rarity] ?? '⭐';
  const humor = getHumor(pet);
  const nivel = pet.level ?? 1;
  const xp    = pet.xp    ?? 0;

  // Nível máximo → barra cheia; caso contrário, XP até o próximo nível
  const xpMax = nivel < CONFIG.NIVEL_MAX ? nivel * 100 : null;
  const xpBar = xpMax !== null ? buildXpBar(xp, xpMax) : '👑 *NÍVEL MÁXIMO*';

  // ── Barra visual de atributos ─────────────────────────────
  const barraAtributo = (val) => {
    const v       = Math.max(0, Math.min(100, val ?? 0));
    const cheio   = Math.round(v / 10);
    const vazio   = 10 - cheio;
    const cor     = v >= 60 ? '🟩' : v >= 30 ? '🟨' : '🟥';
    return `${cor.repeat(cheio)}${'⬛'.repeat(vazio)} *${v}%*`;
  };

  // ── Cooldowns ─────────────────────────────────────────────
  const tempoRestante = (cmd, cooldownMs) => {
    const last  = _cooldownMap.get(`${userId}:${jid}:${cmd}`);
    if (!last) return '✅ Pronto';
    const resto = cooldownMs - (Date.now() - last);
    return resto > 0 ? `⏳ ${formatarTempo(resto)}` : '✅ Pronto';
  };

  const cdAlimentar = tempoRestante('alimentar', CONFIG.COOLDOWN_ALIMENTAR);
  const cdBrincar   = tempoRestante('brincar',   CONFIG.COOLDOWN_BRINCAR);
  const cdCurar     = tempoRestante('curar',     CONFIG.COOLDOWN_CURAR);

  // ── Alertas de estado crítico ─────────────────────────────
  const alertas = [];
  if ((pet.fullness  ?? 0) <= 20) alertas.push(`🍽️ _${pet.name} está com fome! Use *${prefix}alimentar*._`);
  if ((pet.energy    ?? 0) <= 20) alertas.push(`⚡ _${pet.name} está sem energia! Use *${prefix}curar*._`);
  if ((pet.happiness ?? 0) <= 20) alertas.push(`😟 _${pet.name} está triste! Use *${prefix}brincar*._`);
  if ((pet.health ?? 100) <= 30) alertas.push(`❤️ _${pet.name} está com a saúde baixa! Use *${prefix}curar* ou *${prefix}vacinar*._`);
  if ((pet.hygiene ?? 100) <= 25) alertas.push(`🧼 _${pet.name} precisa de um banho! Use *${prefix}banhar*._`);

  const alertaTexto = alertas.length > 0
    ? `\n⚠️ *AVISOS URGENTES:*\n${alertas.join('\n')}\n`
    : '';

  // ── Tempo desde última interação ──────────────────────────
  let ultimaInteracao = '_Nunca interagiu_';
  if (pet.lastInteraction) {
    const diffMs  = Date.now() - new Date(pet.lastInteraction).getTime();
    ultimaInteracao = diffMs < 60_000
      ? 'Agora há pouco'
      : `há ${formatarTempo(diffMs)}`;
  }

  // ── Montar resposta ───────────────────────────────────────
  const statusTexto =
    `🐾 *${PET_SYSTEM[pet.type] ? (pet.name || def.nome) : def.nome}* ${re}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📋 *Tipo    :* ${def.nome} (${pet.rarity ?? '?'})\n` +
    `🌱 *Estágio :* ${obterEstagioPet(pet)}\n` +
    `🎭 *Humor   :* ${humor}\n` +
    `🏆 *Nível   :* ${nivel}/${CONFIG.NIVEL_MAX}\n` +
    `✨ *XP      :* ${xpBar}\n` +
    `🕒 *Última  :* ${ultimaInteracao}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `😊 *Felicidade*\n${barraAtributo(pet.happiness)}\n` +
    `⚡ *Energia*\n${barraAtributo(pet.energy)}\n` +
    `🍽️ *Fome*\n${barraAtributo(pet.fullness)}\n` +
    `❤️ *Saúde*\n${barraAtributo(pet.health ?? 100)}\n` +
    `🧼 *Higiene*\n${barraAtributo(pet.hygiene ?? 100)}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `⏱️ *Cooldowns:*\n` +
    `  🍖 Alimentar : ${cdAlimentar}\n` +
    `  🎾 Brincar   : ${cdBrincar}\n` +
    `  💊 Curar     : ${cdCurar}\n` +
    `━━━━━━━━━━━━━━━━━━` +
    alertaTexto +
    (alertaTexto ? '' : '\n') +
    `📌 *Comandos:*\n` +
    `  *${prefix}alimentar* | *${prefix}brincar* | *${prefix}curar*\n` +
    `  *${prefix}banhar* | *${prefix}vacinar* | *${prefix}passear* | *${prefix}treinar*\n` +
    `  *${prefix}equiparpet* | *${prefix}desequiparpet* | *${prefix}petselecionar*\n` +
    `  *${prefix}renomearpet* | *${prefix}abrigo deixar*` +
    (pet.accessories?.length ? `\n🎀 *Acessórios:* ${pet.accessories.map(textoItemPet).join(', ')}` : '');
  return sock.sendMessage(jid, { image: getPetImage(def), caption: statusTexto }, { quoted: msg });
}

// ─── !pet on / !pet off ───────────────────────────────────────────────────────
//
// Liga ou desliga o spawn automático de pets selvagens no grupo.
// Apenas admins podem usar. Quando desativado, o cicloSpawn pula o grupo
// mesmo que ele esteja em activeGroups.
//
// Persistido no MongoDB (model PetSpawn) para sobreviver a reinícios.
// ────────────────────────────────────────────────────────────────────────────

// !pet on / !pet off / !pet status
async function handlePetToggle(sock, msg, jid, caption = '') {
  if (!jid?.endsWith('@g.us')) {
    return reply(sock, jid, msg, '⚠️ Este comando só pode ser usado em grupos.');
  }

  // ── Extrai o argumento (on/off/status) ─────────────────────
  // Remove o prefixo (!, ., /, ,) + "pet" + espaços, deixando só o argumento
  const arg = caption
    .replace(/^[!.,/]\s*pet\b/i, '')
    .trim()
    .toLowerCase();

  if (!['on', 'off', 'status', 'spawn'].includes(arg)) {
    return reply(sock, jid, msg,
      `⚠️ Uso incorreto!\n\n` +
      `*!pet on* — ativa o spawn automático neste grupo\n` +
      `*!pet off* — desativa o spawn automático neste grupo\n` +
      `*!pet status* — vê o status atual\n` +
      `*!pet spawn* — admin pode invocar um pet manualmente, inclusive na pausa noturna`
    );
  }

  // ── Status: qualquer membro pode consultar ──────────────────
  if (arg === 'status') {
    let registro;
    try {
      registro = await PetSpawn.findOne({ idGrupo: jid }).select('spawnAtivo').lean();
    } catch (err) {
      console.error('[handlePetToggle] Erro ao buscar status:', err.message);
      return reply(sock, jid, msg, '❌ Erro ao consultar status. Tente novamente!');
    }

    const ativo = registro?.spawnAtivo === true; // default false se nunca configurado
    return reply(sock, jid, msg,
      `🐾 *SPAWN DE PETS — STATUS*\n\n` +
      `${ativo ? '✅ *Ativado*' : '❌ *Desativado*'} neste grupo.\n\n` +
      `_Use *!pet ${ativo ? 'off' : 'on'}* para ${ativo ? 'desativar' : 'ativar'}._`
    );
  }

  // ── Ligar/Desligar exige admin ───────────────────────────────
  const senderJid = msg.key.participant || msg.key.remoteJid;
  if (!senderJid) {
    return reply(sock, jid, msg, '❌ Não foi possível identificar quem enviou o comando.');
  }

  const souAdmin = await isAdmin(sock, jid, senderJid, getAlternateSenderJids(msg));

  if (!souAdmin) {
    return reply(sock, jid, msg, '❌ Apenas administradores podem usar este comando!');
  }

  if (arg === 'spawn') {
    if (spawnedPets.has(jid)) {
      return reply(sock, jid, msg, 'Já existe um personagem neste grupo. Capture-o antes de invocar outro.');
    }
    const enviado = await triggerSpawn(sock, jid);
    if (!enviado) {
      return reply(sock, jid, msg, '❌ Não foi possível invocar o personagem. Tente novamente.');
    }
    try {
      await PetSpawn.findOneAndUpdate(
        { idGrupo: jid },
        { $set: { ultimoSpawn: new Date() }, $inc: { totalSpawns: 1 } },
        { upsert: true }
      );
    } catch (err) {
      console.error('[handlePetToggle] Pet invocado, mas falhou ao registrar horário:', err.message);
    }
    return reply(sock, jid, msg, '✅ Personagem invocado manualmente pelo administrador!');
  }

  const novoEstado = arg === 'on';

  // ── Upsert direto com findOneAndUpdate + retorno do doc anterior ──
  // Evita race condition entre "ler estado atual" e "escrever novo estado"
  // (dois admins clicando ao mesmo tempo não geram leituras desatualizadas).
  let docAnterior;
  try {
    docAnterior = await PetSpawn.findOneAndUpdate(
      { idGrupo: jid },
      { $set: { spawnAtivo: novoEstado } },
      { upsert: true, new: false } // new:false retorna o doc ANTES da atualização
    ).select('spawnAtivo').lean();
  } catch (err) {
    console.error('[handlePetToggle] Erro ao salvar:', err.message);
    return reply(sock, jid, msg, '❌ Erro interno ao salvar configuração. Tente novamente!');
  }

  const estadoAnterior = docAnterior?.spawnAtivo === true; // default false se documento não existia
  if (estadoAnterior === novoEstado) {
    return reply(sock, jid, msg,
      `ℹ️ O spawn de pets já está *${novoEstado ? 'ativado' : 'desativado'}* neste grupo!`
    );
  }

  if (novoEstado) {
    registerActiveGroup(jid); // garante que volta a ser monitorado pelo scheduler
  }

  return reply(sock, jid, msg,
    novoEstado
      ? `✅ *Spawn de pets ATIVADO* neste grupo! 🐾\n\n_Pets selvagens voltarão a aparecer periodicamente._`
      : `❌ *Spawn de pets DESATIVADO* neste grupo.\n\n_Nenhum pet selvagem vai mais aparecer aqui até reativar com *!pet on*._`
  );
}

// ─── EXPORTAR ─────────────────────────────────────────────────────────────────

module.exports = {
  // Inicialização — chame no boot
  initPetScheduler,
  registerActiveGroup,

  // Handlers de comandos
  handleCapturarPet,
  handleAdoptarPet,
  handleAlimentarPet,
  handleBrincarPet,
  handleCurarPet,
  handleRenomearPet,
  handleSelecionarPet,
  handleBanharPet,
  handleVacinarPet,
  handleEquiparPet,
  handleDesequiparPet,
  handlePassearPet,
  handleTreinarPet,
  handleVisitarPet,
  handleDueloPet,
  handleCorridaPet,
  handlePetRank,
  handlePets,
  handleCatalogoPersonagens,
  handleAbrigo,
  handleStatusPet,
  handlePetToggle,

  // Utilitários externos
  triggerSpawn,
  grupoPodeReceberSpawn,
  PET_SYSTEM,
  getSpawnAtivo,
};