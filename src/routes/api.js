'use strict';

const crypto        = require('crypto');
const express       = require('express');
const jwt           = require('jsonwebtoken');
const router        = express.Router();
const AuthToken     = require('../models/AuthToken');
const Usuario       = require('../models/Usuario');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const LidMapping    = require('../models/LidMapping');
const JogoRequest   = require('../models/JogoRequest');
const { normalizarJid } = require('../utils/jid');
const { getCarteira, alterarGold, transferirGold, formatarSaldo } = require('../utils/carteira');
const { mapParaObjeto, somarMap } = require('../utils/mapas');
const rateLimit      = require('express-rate-limit');

const { ipKeyGenerator } = require('express-rate-limit');

// Helpers usados pelas rotas públicas de ranking e grupos.
// Mantêm a fórmula de nível igual à usada no site.
function calcularLevel(xp = 0) {
  const valor = Math.max(0, Number(xp) || 0);
  return CarteiraGrupo.levelFromXp(valor);
}

function nomeGrupo(grupo = {}, jid = '') {
  const nome = grupo.nomeCustom || grupo.nomeGrupo || grupo.nomeReal || grupo.nome;
  if (typeof nome === 'string' && nome.trim()) return nome.trim();
  return nomeGrupoFallback(jid);
}

function nomeGrupoFallback(jid = '') {
  const fallback = String(jid || '').split('@')[0].trim();
  return fallback || 'Grupo sem nome';
}

function dadosPublicosUsuario(candidatos = [], fallbackJid = '') {
  const usuarios = candidatos.filter(Boolean);
  const ocultarTelefone = usuarios.some(usuario => usuario.mostrarTelefonePublico === false);
  const usuarioNome = usuarios.find(usuario => usuario.displayName)
    || usuarios.find(usuario => usuario.nome)
    || usuarios.find(usuario => usuario.username)
    || {};
  const usuarioBio = usuarios.find(usuario => typeof usuario.bio === 'string' && usuario.bio.trim()) || {};
  let telefoneRaw = usuarios.find(usuario => usuario.telefone)?.telefone;
  if (!telefoneRaw && typeof fallbackJid === 'string' && fallbackJid.endsWith('@s.whatsapp.net')) {
    telefoneRaw = fallbackJid.split('@')[0].split(':')[0];
  }
  const telefoneDigitos = String(telefoneRaw || '').replace(/\D/g, '');
  const telefone = !ocultarTelefone && telefoneDigitos.length >= 8 && telefoneDigitos.length <= 15
    ? telefoneDigitos
    : null;
  return {
    nome: usuarioNome.displayName || usuarioNome.nome || usuarioNome.username || null,
    bio: usuarioBio.bio ? usuarioBio.bio.trim().slice(0, 150) : null,
    telefone,
    telefoneOculto: ocultarTelefone,
  };
}

// Retorna variantes de números brasileiros com e sem o nono dígito.
// Para números de outros países, mantém apenas o número original.
function gerarVariantesNumero(numero = '') {
  const original = String(numero).replace(/\D/g, '');
  if (!original) return [];

  const variantes = new Set([original]);
  const temCodigoPais = original.startsWith('55') && (original.length === 12 || original.length === 13);
  const nacional = temCodigoPais ? original.slice(2) : original;
  if (nacional.length !== 10 && nacional.length !== 11) return [...variantes];

  const ddd = nacional.slice(0, 2);
  const assinante = nacional.slice(2);
  const prefixos = temCodigoPais ? ['55'] : ['', '55'];

  for (const prefixo of prefixos) {
    variantes.add(`${prefixo}${nacional}`);
    if (assinante.length === 8) {
      variantes.add(`${prefixo}${ddd}9${assinante}`);
    } else if (assinante.length === 9 && assinante.startsWith('9')) {
      variantes.add(`${prefixo}${ddd}${assinante.slice(1)}`);
    }
  }

  return [...variantes];
}

// ─── Variáveis obrigatórias ───────────────────────────────────────────────────
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('❌ ERRO CRÍTICO: JWT_SECRET não definida no arquivo .env!');
    throw new Error('JWT_SECRET não definida no .env');
  }
  return secret;
};

const ADMIN_KEY       = process.env.ADMIN_KEY;
const CONTAS_KEY      = process.env.CONTAS_KEY || ADMIN_KEY;
if (!ADMIN_KEY) console.warn('⚠️  ADMIN_KEY não definida — login administrativo será recusado.');
if (!process.env.CONTAS_KEY) console.warn('⚠️  CONTAS_KEY não definida — a seção Contas exige repetir a chave ADMIN_KEY. Configure uma chave separada para maior isolamento.');

// ─── MIDDLEWARE: JWT de sessão ────────────────────────────────────────────────
async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente.' });
  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (!payload.idWhatsApp) return res.status(401).json({ error: 'Sessão inválida.' });
    const conta = await Usuario.findOne({ idWhatsApp: payload.idWhatsApp })
      .select('idWhatsApp username passwordHash tokenVersion')
      .lean();
    if (!conta || Number(payload.tokenVersion || 0) !== Number(conta.tokenVersion || 0)) {
      return res.status(401).json({ error: 'Sessão encerrada. Entre novamente.' });
    }
    // Tokens de link do WhatsApp permitem abrir o perfil, mas não são login de conta.
    if (payload.tokenType !== 'profile' && (!conta.username || !conta.passwordHash)) {
      return res.status(401).json({ error: 'Sessão encerrada. Entre novamente.' });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

// ─── MIDDLEWARE: chave de admin ────────────────────────────────────────────────
function compararChaveSegura(recebida, configurada) {
  if (typeof recebida !== 'string' || typeof configurada !== 'string'
      || !configurada.length || recebida.length > 512) return false;
  const a = Buffer.from(recebida, 'utf8');
  const b = Buffer.from(configurada, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sessão administrativa ausente.' });
  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (payload.tokenType !== 'admin-session' || payload.role !== 'admin' || !payload.sessionId) {
      return res.status(401).json({ error: 'Sessão administrativa inválida.' });
    }
    req.admin = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'Sessão administrativa inválida ou expirada.' });
  }
}

function contasAuth(req, res, next) {
  const token = req.headers['x-contas-token'];
  if (typeof token !== 'string' || !token) {
    return res.status(401).json({ error: 'Autorização adicional para a seção Contas ausente.' });
  }
  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (payload.tokenType !== 'admin-accounts'
        || payload.adminSessionId !== req.admin?.sessionId) {
      return res.status(401).json({ error: 'Autorização adicional inválida ou expirada.' });
    }
    return next();
  } catch {
    return res.status(401).json({ error: 'Autorização adicional inválida ou expirada.' });
  }
}

// ─── CORS ────────────────────────────────────────────────────────────────────
router.use(require('../utils/cors').corsMiddleware);

// ─── RATE LIMIT de login admin ────────────────────────────────────────────────
const LOGIN_MAX       = 30;
const LOGIN_JANELA_MS = 15 * 60 * 1000;

const rateLimitAdmin = rateLimit({
  windowMs: LOGIN_JANELA_MS,
  max: LOGIN_MAX,
  keyGenerator: req => ipKeyGenerator(req.ip || '0.0.0.0'),
  standardHeaders: true,
  legacyHeaders: false,
  // Apenas falhas contam; as chamadas legítimas do painel não esgotam o limite.
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).json({
    error: 'Muitas tentativas de autenticação administrativa. Aguarde 15 minutos.'
  }),
});

// A proteção cobre TODAS as rotas /admin, não apenas a rota de verificação.
router.use('/admin', rateLimitAdmin);

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS PÚBLICAS
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/auth/token
router.post('/auth/token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token não informado.' });

    const registro = await AuthToken.findOneAndUpdate(
      { token, usado: false, expiresAt: { $gt: new Date() } },
      { $set: { usado: true } },
      { new: false }
    );

    if (!registro) {
      const existe = await AuthToken.findOne({ token });
      if (!existe)      return res.status(404).json({ error: 'Token inválido.' });
      if (existe.usado) return res.status(410).json({ error: 'Token já utilizado.' });
      return res.status(410).json({ error: 'Token expirado.' });
    }

    const usuarioToken = await Usuario.findOne({ idWhatsApp: registro.idWhatsApp })
      .select('tokenVersion').lean();
    if (!usuarioToken) return res.status(404).json({ error: 'Perfil não encontrado.' });
    const sessionJwt = jwt.sign(
      { telefone: registro.telefone, idWhatsApp: registro.idWhatsApp, tokenType: 'profile', tokenVersion: Number(usuarioToken.tokenVersion || 0) },
      getJwtSecret(),
      { expiresIn: '2h' }
    );

    return res.json({ jwt: sessionJwt });
  } catch (err) {
    console.error('[API] POST /auth/token:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/grupos
router.get('/grupos', async (req, res) => {
  try {
    const grupos = await CarteiraGrupo.aggregate([
      { $match: { idGrupo: { $regex: /@g\.us$/ } } },
      {
        $group: {
          _id:        '$idGrupo',
          membros:    { $sum: 1 },
          xpTotal:    { $sum: '$xp' },
          nomeCustom: { $max: '$nomeCustom' },
          nomeGrupo:  { $max: '$nomeGrupo' },
          mensagens:  { $first: '$mensagens' },
        },
      },
      { $sort: { xpTotal: -1 } },
    ]);

    const GrupoConfig = require('../models/GrupoConfig');
    const jids    = grupos.map(g => g._id);
    const configs = await GrupoConfig.find({ idGrupo: { $in: jids } }).lean();
    const configMap = Object.fromEntries(configs.map(c => [c.idGrupo, c]));

    const resultado = grupos.map(g => {
      const cfg = configMap[g._id] || {};
      const docCombined = {
        nomeCustom: cfg.nomeCustom || g.nomeCustom,
        nomeGrupo:  cfg.nomeGrupo  || g.nomeGrupo,
      };
      return {
        jid:        g._id,
        idGrupo:    g._id,
        nome:       nomeGrupo(docCombined, g._id),
        nomeCustom: docCombined.nomeCustom || null,
        membros:    g.membros,
        xpTotal:    g.xpTotal,
        mensagens:  g.mensagens || {},
        config: {
          botAtivo:    cfg.botAtivo    ?? true,
          antiLink:    cfg.antiLink    ?? false,
          boasVindas:  cfg.boasVindas  ?? true,
          xpAtivo:     cfg.xpAtivo     ?? true,
        },
      };
    });

    return res.json({ grupos: resultado });
  } catch (err) {
    console.error('[API] GET /grupos:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/ranking
// Ranking global — soma xp/gold/mensagens de cada usuário em todos os grupos.
//
// Query params: limit (padrão 100, máx 200)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/user/ranking', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);

    const matchGrupo = { $match: { idGrupo: { $regex: /@g\.us$/ } } };

    const [agregados, totaisGlobais, totaisMensagensUsuario] = await Promise.all([
      CarteiraGrupo.aggregate([
        matchGrupo,
        {
          $group: {
            _id:       '$idWhatsApp',
            xp:        { $sum: '$xp' },
            gold:      { $sum: '$gold' },
            mensagens: { $sum: '$mensagens' },
          },
        },
        { $sort: { xp: -1 } },
        { $limit: limit },
      ]),
      CarteiraGrupo.aggregate([
        matchGrupo,
        {
          $group: {
            _id:            null,
            totalMensagens: { $sum: '$mensagens' },
            totalUsuarios:  { $addToSet: '$idWhatsApp' },
          },
        },
      ]),
      // O contador global é atualizado por addUserXp(). Carteiras antigas podem
      // ter XP acumulado sem o campo mensagens preenchido; usa-se esse total como
      // fonte principal e o contador por grupo como compatibilidade histórica.
      Usuario.aggregate([
        {
          $group: {
            _id: null,
            totalMensagens: { $sum: { $ifNull: ['$mensagens', 0] } },
          },
        },
      ]),
    ]);

    const jids = agregados.map(a => a._id);
    const lids = jids.filter(j => j?.endsWith('@lid'));
    const pns = jids.filter(j => j?.endsWith('@s.whatsapp.net'));
    // Resolve aliases in both directions. Older wallet records may be PN-backed even
    // when the canonical profile (and its privacy/bio settings) is stored under a LID.
    const lidMaps = lids.length || pns.length
      ? await LidMapping.find({ $or: [{ lid: { $in: lids } }, { pn: { $in: pns } }] }).lean()
      : [];
    const lidParaPn = Object.fromEntries(lidMaps.map(l => [l.lid, l.pn]));
    const pnParaLid = Object.fromEntries(lidMaps.map(l => [l.pn, l.lid]));

    const todosJidsBusca = [...new Set([...jids, ...Object.values(lidParaPn), ...Object.values(pnParaLid)])];
    const usuarios = todosJidsBusca.length
      ? await Usuario.find({ idWhatsApp: { $in: todosJidsBusca } }).select('idWhatsApp nome displayName username mensagens telefone bio mostrarTelefonePublico').lean()
      : [];
    const usuariosMap = Object.fromEntries(usuarios.map(u => [u.idWhatsApp, u]));

    const carteirasNome = jids.length
      ? await CarteiraGrupo.find({ idWhatsApp: { $in: jids }, nome: { $exists: true, $ne: null } }).select('idWhatsApp nome').lean()
      : [];
    const pushNamesMap = Object.fromEntries(carteirasNome.map(c => [c.idWhatsApp, c.nome]));

    const ranking = agregados.map((a, i) => {
      const pn = a._id?.endsWith('@lid') ? lidParaPn[a._id] : (a._id?.endsWith('@s.whatsapp.net') ? a._id : null);
      const lid = a._id?.endsWith('@lid') ? a._id : (pn ? pnParaLid[pn] : null);
      const candidatos = [usuariosMap[a._id], pn ? usuariosMap[pn] : null, lid ? usuariosMap[lid] : null].filter(Boolean);
      const u = candidatos.find(usuario => usuario.displayName)
        || candidatos.find(usuario => usuario.nome)
        || candidatos.find(usuario => usuario.username)
        || candidatos[0] || {};
      const publico = dadosPublicosUsuario(candidatos, pn || a._id);
      const nomeFinal = publico.nome || pushNamesMap[a._id] || 'Anônimo';

      return {
        nome:       nomeFinal,
        telefone:   publico.telefone,
        telefoneOculto: publico.telefoneOculto,
        bio:        publico.bio,
        xp:         a.xp        ?? 0,
        gold:       a.gold      ?? 0,
        // Usa o contador global se a carteira antiga ainda não tiver mensagens.
        mensagens:  Math.max(Number(a.mensagens) || 0, Number(u.mensagens) || 0),
        level:      calcularLevel(a.xp),
        posicao:    i + 1,
      };
    });

    const t = totaisGlobais[0] || {};
    const totalMensagens = Math.max(
      Number(totaisMensagensUsuario[0]?.totalMensagens) || 0,
      Number(t.totalMensagens) || 0,
    );

    return res.json({
      ranking,
      total:          t.totalUsuarios?.length || ranking.length,
      totalMensagens,
      atualizadoEm:   new Date(),
    });
  } catch (err) {
    console.error('[API] GET /user/ranking:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/ranking/grupo?jid=xxx
// Ranking de um grupo específico (xp/gold/mensagens daquele grupo).
//
// Query params: jid (obrigatório), limit (padrão 100, máx 200)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/user/ranking/grupo', async (req, res) => {
  try {
    const jid = decodeURIComponent(req.query.jid || '');
    if (!jid) return res.status(400).json({ error: 'jid é obrigatório.' });

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);

    const membros = await CarteiraGrupo
      .find({ idGrupo: jid })
      .sort({ xp: -1 })
      .lean();

    const jidsUsuarios = membros.map(m => m.idWhatsApp);
    const lids = jidsUsuarios.filter(j => j?.endsWith('@lid'));
    const pns = jidsUsuarios.filter(j => j?.endsWith('@s.whatsapp.net'));
    const lidMaps = lids.length || pns.length
      ? await LidMapping.find({ $or: [{ lid: { $in: lids } }, { pn: { $in: pns } }] }).lean()
      : [];
    const lidParaPn = Object.fromEntries(lidMaps.map(l => [l.lid, l.pn]));
    const pnParaLid = Object.fromEntries(lidMaps.map(l => [l.pn, l.lid]));

    const todosJidsBusca = [...new Set([...jidsUsuarios, ...Object.values(lidParaPn), ...Object.values(pnParaLid)])];
    const usuarios = todosJidsBusca.length
      ? await Usuario.find({ idWhatsApp: { $in: todosJidsBusca } }).select('idWhatsApp nome displayName username telefone bio mostrarTelefonePublico').lean()
      : [];
    const usuariosMap = Object.fromEntries(usuarios.map(u => [u.idWhatsApp, u]));

    const mapaDeduplicado = new Map();
    for (const m of membros) {
      const pn = m.idWhatsApp?.endsWith('@lid')
        ? lidParaPn[m.idWhatsApp]
        : (m.idWhatsApp?.endsWith('@s.whatsapp.net') ? m.idWhatsApp : null);
      const lid = m.idWhatsApp?.endsWith('@lid') ? m.idWhatsApp : (pn ? pnParaLid[pn] : null);
      const chave = pn || m.idWhatsApp;

      const candidatos = [usuariosMap[m.idWhatsApp], pn ? usuariosMap[pn] : null, lid ? usuariosMap[lid] : null].filter(Boolean);
      const u = candidatos.find(usuario => usuario.displayName)
        || candidatos.find(usuario => usuario.nome)
        || candidatos.find(usuario => usuario.username)
        || candidatos[0] || {};
      const publico = dadosPublicosUsuario(candidatos, pn || m.idWhatsApp);
      const nomeFinal = publico.nome || m.nome || 'Anônimo';

      if (!mapaDeduplicado.has(chave)) {
        mapaDeduplicado.set(chave, {
          nome:       nomeFinal,
          telefone:   publico.telefone,
          telefoneOculto: publico.telefoneOculto,
          bio:        publico.bio,
          xp:         m.xp        ?? 0,
          gold:       m.gold      ?? 0,
          mensagens:  m.mensagens ?? 0,
        });
      } else {
        const item = mapaDeduplicado.get(chave);
        item.xp        += (m.xp ?? 0);
        item.gold      += (m.gold ?? 0);
        item.mensagens += (m.mensagens ?? 0);
        if (nomeFinal !== 'Anônimo' && item.nome === 'Anônimo') item.nome = nomeFinal;
        item.telefoneOculto = item.telefoneOculto || publico.telefoneOculto;
        if (item.telefoneOculto) {
          item.telefone = null;
        } else if (!item.telefone && publico.telefone) {
          item.telefone = publico.telefone;
        }
        if (!item.bio && publico.bio) item.bio = publico.bio;
      }
    }

    const rankingSemOrdem = Array.from(mapaDeduplicado.values());
    rankingSemOrdem.sort((a, b) => b.xp - a.xp);

    const ranking = rankingSemOrdem.slice(0, limit).map((r, i) => ({
      ...r,
      level:   calcularLevel(r.xp),
      posicao: i + 1,
    }));

    return res.json({ ranking, total: rankingSemOrdem.length });
  } catch (err) {
    console.error('[API] GET /user/ranking/grupo:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS AUTENTICADAS (JWT de sessão)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/user/me
router.get('/user/me', auth, async (req, res) => {
  try {
    const idWhatsApp = req.user.idWhatsApp;

    let carteiras = await CarteiraGrupo.find({ idWhatsApp }).sort({ xp: -1 }).lean();

if (!carteiras.length) {
  const variantesPn = gerarVariantesNumero(idWhatsApp.split('@')[0])
    .map(d => `${d}@s.whatsapp.net`);
  const lidMap = await LidMapping.findOne({ pn: { $in: [idWhatsApp, ...variantesPn] } }).lean();
  if (lidMap) {
    carteiras = await CarteiraGrupo.find({ idWhatsApp: lidMap.lid }).sort({ xp: -1 }).lean();
  }
}

    const usuario = await Usuario.findOne({ idWhatsApp }).lean();

    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado.' });

    // Filtra APENAS carteiras de grupos válidos (terminados em @g.us)
    const carteirasGruposValidos = carteiras.filter(c => c.idGrupo && typeof c.idGrupo === 'string' && c.idGrupo.endsWith('@g.us'));

    // A progressão principal usa o XP global de Usuario; as carteiras continuam
    // sendo a fonte dos saldos e das estatísticas individuais de cada grupo.
    const xpGruposTotal = carteirasGruposValidos.reduce((s, c) => s + (c.xp ?? 0), 0);
    const xpSalvoUsuario = usuario.xp;
    const xpTotal = xpSalvoUsuario != null && Number.isFinite(Number(xpSalvoUsuario))
      ? Math.max(0, Number(xpSalvoUsuario))
      : xpGruposTotal;
    const goldTotal = carteirasGruposValidos.reduce((s, c) => s + (c.gold ?? 0), 0);
    const mensagensGruposTotal = carteirasGruposValidos.reduce((s, c) => s + (c.mensagens ?? 0), 0);
    const mensagensSalvasUsuario = Number(usuario.mensagens);
    // Os contadores global e por grupo podem estar desencontrados em registros antigos.
    // Prefere o maior contador disponível para não mostrar zero se a outra fonte já contou.
    const mensagensTotal = Math.max(
      Number.isFinite(mensagensSalvasUsuario) ? mensagensSalvasUsuario : 0,
      mensagensGruposTotal,
      0,
    );

    const levelGlobal = calcularLevel(xpTotal);

    // Mesma curva usada pelo CarteiraGrupo.incrementXp() e pelo !level.
    const xpInicioNivel = CarteiraGrupo.xpParaLevel(levelGlobal);
    const xpParaProximo = CarteiraGrupo.xpParaLevel(levelGlobal + 1);
    const xpNoNivel     = xpParaProximo - xpInicioNivel;
    const xpProgresso   = xpNoNivel > 0
      ? Math.min(100, Math.max(0, Math.floor(((xpTotal - xpInicioNivel) / xpNoNivel) * 100)))
      : 100;

    const posicaoResult = await CarteiraGrupo.aggregate([
      { $match: { idGrupo: { $regex: /@g\.us$/ } } },
      { $group: { _id: '$idWhatsApp', xpTotal: { $sum: '$xp' } } },
      { $match: { xpTotal: { $gt: xpGruposTotal } } },
      { $count: 'acima' },
    ]);
    const posicaoRanking = (posicaoResult[0]?.acima ?? 0) + 1;

    const jidsGruposMe = [...new Set(carteirasGruposValidos.map(c => c.idGrupo))];
    const nomesGruposMe = {};
    if (jidsGruposMe.length) {
      const GrupoConfig = require('../models/GrupoConfig');
      const [docsNomes, configsNomes] = await Promise.all([
        CarteiraGrupo.aggregate([
          { $match: { idGrupo: { $in: jidsGruposMe } } },
          { $group: {
            _id:        '$idGrupo',
            nomeCustom: { $max: '$nomeCustom' },
            nomeGrupo:  { $max: '$nomeGrupo' },
          }},
        ]),
        GrupoConfig.find({ idGrupo: { $in: jidsGruposMe } })
          .select('idGrupo nomeGrupo nomeCustom')
          .lean(),
      ]);
      const configsPorJid = Object.fromEntries(configsNomes.map(c => [c.idGrupo, c]));
      for (const d of docsNomes) {
        const cfg = configsPorJid[d._id] || {};
        nomesGruposMe[d._id] = nomeGrupo({
          nomeCustom: cfg.nomeCustom || d.nomeCustom,
          nomeGrupo:  cfg.nomeGrupo || d.nomeGrupo,
        }, d._id);
      }
      // Também inclui grupos cujo nome só está salvo na configuração.
      for (const cfg of configsNomes) {
        if (!nomesGruposMe[cfg.idGrupo]) {
          nomesGruposMe[cfg.idGrupo] = nomeGrupo(cfg, cfg.idGrupo);
        }
      }
    }

    const grupos = carteirasGruposValidos.map(c => ({
      jid:          c.idGrupo,
      nome:         nomesGruposMe[c.idGrupo] || nomeGrupoFallback(c.idGrupo),
      xp:           c.xp           ?? 0,
      level:        calcularLevel(c.xp ?? 0),
      gold:         c.gold         ?? 0,
      mensagens:    c.mensagens    ?? 0,
      empregoAtual: c.empregoAtual ?? null,
      varaEquipada: c.varaEquipada ?? null,
      statsPesca:   c.statsPesca   ?? null,
    }));

    // Resolve casamento / relacionamento detalhado
    let casamentoInfo = null;
    let casadoComResolvido = usuario.casadoCom ?? null;
    if (casadoComResolvido && casadoComResolvido.endsWith('@lid')) {
      const mapa = await LidMapping.findOne({ lid: casadoComResolvido }).lean();
      if (mapa?.pn) casadoComResolvido = mapa.pn;
    }

    if (casadoComResolvido) {
      const parceiroNum = casadoComResolvido.split('@')[0];
      const variantesParceiro = gerarVariantesNumero(parceiroNum).map(d => `${d}@s.whatsapp.net`);

      const [lidMapParceiro, uParceiro] = await Promise.all([
        LidMapping.findOne({ pn: { $in: variantesParceiro } }).lean(),
        Usuario.findOne({ idWhatsApp: { $in: [casadoComResolvido, ...variantesParceiro] } }).lean(),
      ]);

      const parceiroFinal = uParceiro
        ?? (lidMapParceiro ? await Usuario.findOne({ idWhatsApp: lidMapParceiro.lid }).lean() : null);

      const nomeParceiroReal = parceiroFinal?.nome || parceiroFinal?.username || (parceiroNum ? `+${parceiroNum}` : 'Parceiro(a)');
      const telParceiroReal  = parceiroFinal?.telefone || parceiroNum || null;

      let nomeGrupoCasamento = null;
      if (usuario.casadoGrupo && usuario.casadoGrupo.endsWith('@g.us')) {
        nomeGrupoCasamento = nomesGruposMe[usuario.casadoGrupo] || nomeGrupoFallback(usuario.casadoGrupo);
      }

      const desdeDate = usuario.casadoDesde ? new Date(usuario.casadoDesde) : null;
      let duracaoTxt = null;
      if (desdeDate && !isNaN(desdeDate)) {
        const diffMs = Date.now() - desdeDate.getTime();
        const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (diffDias < 1) duracaoTxt = 'Hoje';
        else if (diffDias < 30) duracaoTxt = `${diffDias} dia${diffDias > 1 ? 's' : ''}`;
        else {
          const diffMeses = Math.floor(diffDias / 30);
          const restoDias = diffDias % 30;
          if (diffMeses < 12) {
            duracaoTxt = `${diffMeses} mês${diffMeses > 1 ? 'es' : ''}${restoDias > 0 ? ` e ${restoDias}d` : ''}`;
          } else {
            const anos = Math.floor(diffMeses / 12);
            const m = diffMeses % 12;
            duracaoTxt = `${anos} ano${anos > 1 ? 's' : ''}${m > 0 ? ` e ${m}m` : ''}`;
          }
        }
      }

      casamentoInfo = {
        ativo: true,
        idWhatsApp: casadoComResolvido,
        nomeParceiro: nomeParceiroReal,
        telefoneParceiro: telParceiroReal,
        tipo: usuario.casadoTipo || 'casamento',
        desde: usuario.casadoDesde || null,
        duracao: duracaoTxt,
        idGrupo: usuario.casadoGrupo || null,
        nomeGrupo: nomeGrupoCasamento,
      };
    }

    // Resolve Pet: prioriza Usuario.pet, se nulo busca em CarteiraGrupo
    let petResolvido = usuario.pet ?? null;
    if (!petResolvido || (!petResolvido.name && !petResolvido.nome)) {
      const cComPet = carteiras.find(c => c.pet && (c.pet.name || c.pet.nome));
      if (cComPet) petResolvido = cComPet.pet;
    }

    // O gráfico de progressão usa o histórico global do usuário. Só recorre
    // aos históricos das carteiras em documentos antigos sem histórico global.
    const xpHistoryUsuario = {};
    for (const [k, v] of Object.entries(mapParaObjeto(usuario.xpHistory ?? {}))) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(Number(v))) {
        xpHistoryUsuario[k] = Number(v);
      }
    }
    const xpHistoryGrupos = {};
    for (const c of carteirasGruposValidos) {
      for (const [k, v] of Object.entries(mapParaObjeto(c.xpHistory ?? {}))) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(Number(v))) {
          xpHistoryGrupos[k] = (xpHistoryGrupos[k] ?? 0) + Number(v);
        }
      }
    }
    const xpHistoryLimpo = Object.keys(xpHistoryUsuario).length > 0
      ? xpHistoryUsuario
      : xpHistoryGrupos;

    const nomeResolvido     = usuario.nome     || carteirasGruposValidos[0]?.nome || null;
    const telefoneResolvido = usuario.telefone
      || (String(idWhatsApp).endsWith('@s.whatsapp.net') ? idWhatsApp.split('@')[0].split(':')[0] : null);


    return res.json({
      nome:        nomeResolvido,
      displayName: usuario.displayName || null,
      telefone:    telefoneResolvido,
      mostrarTelefonePublico: usuario.mostrarTelefonePublico !== false,
      bio:         usuario.bio,

      xp:         xpTotal,
      level:      levelGlobal,
      gold:       goldTotal,
      mensagens:  mensagensTotal,
      quizPoints: usuario.quizPoints ?? 0,
      xpParaProximo,
      xpInicioNivel,
      xpProgresso,
      posicaoRanking,

      xpHistory:        xpHistoryLimpo,
      atividadeSemanal: usuario.atividadeSemanal || [0, 0, 0, 0, 0, 0, 0],
      inventory:        mapParaObjeto(usuario.inventory ?? {}),
      goldHistory:      (usuario.goldHistory || []).slice(-20),

      pet:              petResolvido,

      // Dados completos de relacionamento
      casamento:        casamentoInfo,
      casadoCom:        casadoComResolvido,
      nomeParceiro:     casamentoInfo?.nomeParceiro ?? null,
      casadoTipo:       usuario.casadoTipo ?? null,
      casadoDesde:      usuario.casadoDesde ?? null,

      grupos,
    });
  } catch (err) {
    console.error('[API] GET /user/me:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// PATCH /api/user/privacy — controls whether the account phone is public in rankings.
router.patch('/user/privacy', auth, async (req, res) => {
  try {
    const valor = req.body?.mostrarTelefonePublico;
    if (typeof valor !== 'boolean') {
      return res.status(400).json({ error: 'mostrarTelefonePublico deve ser true ou false.' });
    }
    const idProprio = String(req.user.idWhatsApp || '').trim().toLowerCase();
    const atualizado = await Usuario.findOneAndUpdate(
      { idWhatsApp: idProprio },
      { $set: { mostrarTelefonePublico: valor } },
      { new: true, runValidators: true },
    ).select('mostrarTelefonePublico').lean();
    if (!atualizado) return res.status(404).json({ error: 'Usuário não encontrado.' });

    // PN and LID may have legacy duplicate User documents. Synchronise the preference
    // to both identities so a hidden phone never leaks through the other ranking entry.
    let alias = null;
    if (idProprio.endsWith('@lid')) {
      alias = await LidMapping.findOne({ lid: idProprio }).select('pn').lean();
      alias = alias?.pn;
    } else if (idProprio.endsWith('@s.whatsapp.net')) {
      alias = await LidMapping.findOne({ pn: idProprio }).select('lid').lean();
      alias = alias?.lid;
    }
    if (alias && typeof alias === 'string' && alias.trim().toLowerCase() !== idProprio) {
      await Usuario.updateMany(
        { idWhatsApp: { $in: [idProprio, alias.trim().toLowerCase()] } },
        { $set: { mostrarTelefonePublico: valor } },
      );
    }
    return res.json({ mostrarTelefonePublico: atualizado.mostrarTelefonePublico !== false });
  } catch (err) {
    console.error('[API] PATCH /user/privacy:', err);
    return res.status(500).json({ error: 'Não foi possível salvar a preferência de privacidade.' });
  }
});

// PATCH /api/user/display-name
router.patch('/user/display-name', auth, async (req, res) => {
  try {
    const valor = req.body?.displayName;
    if (typeof valor !== 'string') {
      return res.status(400).json({ error: 'Informe um nome de exibição válido.' });
    }

    const displayName = valor.trim();
    if (!displayName || displayName.length > 40 || /[\r\n\u0000-\u001f\u007f]/.test(displayName)) {
      return res.status(400).json({ error: 'O nome deve ter de 1 a 40 caracteres em uma única linha.' });
    }

    const atualizado = await Usuario.findOneAndUpdate(
      { idWhatsApp: req.user.idWhatsApp },
      { $set: { displayName } },
      { new: true, runValidators: true }
    ).select('displayName').lean();

    if (!atualizado) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    return res.json({ displayName: atualizado.displayName });
  } catch (err) {
    console.error('[API] PATCH /user/display-name:', err);
    return res.status(500).json({ error: 'Não foi possível atualizar o nome de exibição.' });
  }
});

// GET /api/user/grupos
router.get('/user/grupos', auth, async (req, res) => {
  try {
    const idWhatsApp = req.user.idWhatsApp;
    let carteiras = await CarteiraGrupo
      .find({ idWhatsApp })
      .sort({ xp: -1 })
      .lean();

    if (!carteiras.length) {
      const variantesPn = gerarVariantesNumero(idWhatsApp.split('@')[0])
        .map(d => `${d}@s.whatsapp.net`);
      const lidMap = await LidMapping.findOne({ pn: { $in: [idWhatsApp, ...variantesPn] } }).lean();
      if (lidMap) {
        carteiras = await CarteiraGrupo
          .find({ idWhatsApp: lidMap.lid })
          .sort({ xp: -1 })
          .lean();
      }
    }

    // Filtra apenas carteiras de grupos válidos (@g.us)
    carteiras = carteiras.filter(c => c.idGrupo && typeof c.idGrupo === 'string' && c.idGrupo.endsWith('@g.us'));

    // Busca nomes reais dos grupos a partir de qualquer carteira que tenha o campo
    const jidsGruposUser = carteiras.map(c => c.idGrupo);
    const nomesGruposMap = {};
    if (jidsGruposUser.length) {
      const docsNomes = await CarteiraGrupo.aggregate([
        { $match: { idGrupo: { $in: jidsGruposUser } } },
        { $group: {
          _id:        '$idGrupo',
          nomeCustom: { $max: '$nomeCustom' },
          nomeGrupo:  { $max: '$nomeGrupo' },
        }},
      ]);
      for (const d of docsNomes) nomesGruposMap[d._id] = nomeGrupo(d, d._id);
    }

    const grupos = carteiras.map(c => ({
      jid:          c.idGrupo,
      nome:         nomesGruposMap[c.idGrupo] || nomeGrupoFallback(c.idGrupo),
      xp:           c.xp           ?? 0,
      level:        c.level        ?? 1,
      gold:         c.gold         ?? 0,
      mensagens:    c.mensagens    ?? 0,
      empregoAtual: c.empregoAtual ?? null,
      varaEquipada: c.varaEquipada ?? null,
      statsPesca:   c.statsPesca   ?? null,
    }));

    return res.json({ grupos });
  } catch (err) {
    console.error('[API] GET /user/grupos:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS ADMIN — a chave mestra só é aceita no login; o painel usa JWT curto.
// ══════════════════════════════════════════════════════════════════════════════

router.post('/admin/login', (req, res) => {
  const chave = req.body?.key;
  if (!compararChaveSegura(chave, ADMIN_KEY)) {
    return res.status(401).json({ error: 'Chave administrativa inválida.' });
  }
  try {
    const sessionId = crypto.randomUUID();
    const token = jwt.sign(
      { tokenType: 'admin-session', role: 'admin', sessionId },
      getJwtSecret(),
      { expiresIn: '1h' },
    );
    return res.json({ token, expiresIn: 3600 });
  } catch (err) {
    console.error('[API] POST /admin/login:', err);
    return res.status(500).json({ error: 'Não foi possível iniciar a sessão administrativa.' });
  }
});

router.get('/admin/verify', adminAuth, (req, res) => {
  return res.json({ ok: true, expiresAt: req.admin.exp * 1000 });
});

router.get('/admin/verify-contas', adminAuth, (req, res) => {
  if (!CONTAS_KEY) return res.status(503).json({ error: 'A autorização separada para Contas não está configurada no servidor.' });
  const chave = req.headers['x-contas-key'];
  if (!compararChaveSegura(chave, CONTAS_KEY)) return res.status(401).json({ error: 'Chave inválida.' });
  const token = jwt.sign(
    { tokenType: 'admin-accounts', adminSessionId: req.admin.sessionId },
    getJwtSecret(),
    { expiresIn: '15m' },
  );
  return res.json({ ok: true, token, expiresIn: 900 });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/usuarios
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/usuarios', adminAuth, async (req, res) => {
  try {
    const todos = await Usuario
      .find({})
      .select('nome telefone idWhatsApp warnings banido')
      .lean();

    const comWarns = todos
      .map(u => ({
        nome:          u.nome || u.telefone || 'Anônimo',
        telefone:      u.telefone || u.idWhatsApp?.split('@')[0] || '—',
        idWhatsApp:    u.idWhatsApp,
        warns:         somarMap(u.warnings),
        warnsPorGrupo: mapParaObjeto(u.warnings),
        banido:        !!u.banido,
      }))
      .filter(u => u.warns > 0 || u.banido)
      .sort((a, b) => b.warns - a.warns);

    return res.json({ usuarios: comWarns });
  } catch (err) {
    console.error('[API] GET /admin/usuarios:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/usuario/:idWhatsApp
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/usuario/:idWhatsApp', adminAuth, async (req, res) => {
  try {
    const termo = decodeURIComponent(req.params.idWhatsApp);
    const jidNorm = normalizarJid(termo);
    const variantesPn = gerarVariantesNumero(termo.split('@')[0]).map(d => `${d}@s.whatsapp.net`);
    const lidMap = await LidMapping.findOne({ $or: [{ pn: { $in: variantesPn } }, { lid: jidNorm }] }).lean();
    const jidsBusca = [...new Set([jidNorm, ...(lidMap ? [lidMap.lid, lidMap.pn] : []), ...variantesPn].filter(Boolean))];

    let carteiras = await CarteiraGrupo.find({ idWhatsApp: { $in: jidsBusca } }).sort({ xp: -1 }).lean();
    const usuario = await Usuario.findOne({ idWhatsApp: { $in: jidsBusca } }).lean();

    if (!usuario && !carteiras.length)
      return res.status(404).json({ error: 'Usuário não encontrado.' });

    // Filtra carteiras apenas de grupos válidos (@g.us)
    carteiras = carteiras.filter(c => c.idGrupo && typeof c.idGrupo === 'string' && c.idGrupo.endsWith('@g.us'));

    const xpTotal        = carteiras.reduce((s, c) => s + (c.xp        ?? 0), 0);
    const goldTotal      = carteiras.reduce((s, c) => s + (c.gold      ?? 0), 0);
    const mensagensTotal = carteiras.reduce((s, c) => s + (c.mensagens ?? 0), 0);
    const levelGlobal    = calcularLevel(xpTotal);

    // Resolve nomes dos grupos usando agregação
    const jidsGrupos = carteiras.map(c => c.idGrupo);
    const gruposDocs = jidsGrupos.length
      ? await CarteiraGrupo.aggregate([
          { $match: { idGrupo: { $in: jidsGrupos } } },
          { $group: { _id: '$idGrupo', nomeCustom: { $max: '$nomeCustom' }, nomeGrupo: { $max: '$nomeGrupo' } } }
        ])
      : [];
    const nomesMap = Object.fromEntries(gruposDocs.map(g => [g._id, nomeGrupo(g, g._id)]));

    const grupos = carteiras.map(c => ({
      idGrupo:      c.idGrupo,
      nomeGrupo:    nomesMap[c.idGrupo] || nomeGrupoFallback(c.idGrupo),
      xp:           c.xp           ?? 0,
      level:        c.level        ?? 1,
      gold:         c.gold         ?? 0,
      mensagens:    c.mensagens    ?? 0,
      empregoAtual: c.empregoAtual ?? null,
    }));

    const nomeAdmin     = usuario?.nome     || carteiras[0]?.nome || '(sem nome)';
    const telefoneAdmin = usuario?.telefone || (lidMap?.pn || jidNorm).replace('@s.whatsapp.net', '').replace('@lid', '');

    return res.json({
      usuario: {
        idWhatsApp: usuario?.idWhatsApp || jidsBusca[0],
        nome:       nomeAdmin,
        telefone:   telefoneAdmin,
        xp:         xpTotal,
        level:      levelGlobal,
        gold:       goldTotal,
        mensagens:  mensagensTotal,
        grupos,
      }
    });
  } catch (err) {
    console.error('[API] GET /admin/usuario/:id:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/warn/:idWhatsApp?grupo=xxx
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/admin/warn/:idWhatsApp', adminAuth, async (req, res) => {
  try {
    const termoOriginal = decodeURIComponent(req.params.idWhatsApp);
    const { grupo }      = req.query;

    const jidNorm = normalizarJid(termoOriginal);
    const variantesPn = gerarVariantesNumero(termoOriginal.split('@')[0]).map(d => `${d}@s.whatsapp.net`);
    const lidMap = await LidMapping.findOne({ $or: [{ pn: { $in: variantesPn } }, { lid: jidNorm }] }).lean();
    const jidsBusca = [...new Set([jidNorm, ...(lidMap ? [lidMap.lid, lidMap.pn] : []), ...variantesPn].filter(Boolean))];

    const usuarios = await Usuario.find({ idWhatsApp: { $in: jidsBusca } });
    if (!usuarios.length)
      return res.status(404).json({ error: 'Perfil não encontrado.' });

    for (const usuario of usuarios) {
      const warns = mapParaObjeto(usuario.warnings);
      if (grupo) {
        const atual = Number(warns[grupo] || 0);
        if (atual <= 1) delete warns[grupo];
        else warns[grupo] = atual - 1;
      } else {
        for (const k of Object.keys(warns)) delete warns[k];
      }
      usuario.warnings = new Map(Object.entries(warns));
      await usuario.save();
    }

    return res.json({ ok: true, warns: mapParaObjeto(usuarios[0].warnings) });
  } catch (err) {
    console.error('[API] DELETE /admin/warn/:id:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/usuario/:idWhatsApp/ban
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/admin/usuario/:idWhatsApp/ban', adminAuth, async (req, res) => {
  try {
    const termoOriginal = decodeURIComponent(req.params.idWhatsApp);
    const { banido }     = req.body || {};

    if (typeof banido !== 'boolean')
      return res.status(400).json({ error: '"banido" deve ser true ou false.' });

    const jidNorm = normalizarJid(termoOriginal);
    const variantesPn = gerarVariantesNumero(termoOriginal.split('@')[0]).map(d => `${d}@s.whatsapp.net`);
    const lidMap = await LidMapping.findOne({ $or: [{ pn: { $in: variantesPn } }, { lid: jidNorm }] }).lean();
    const jidsBusca = [...new Set([jidNorm, ...(lidMap ? [lidMap.lid, lidMap.pn] : []), ...variantesPn].filter(Boolean))];

    const result = await Usuario.updateMany(
      { idWhatsApp: { $in: jidsBusca } },
      { $set: { banido } }
    );

    if (!result.matchedCount) return res.status(404).json({ error: 'Usuário não encontrado.' });

    return res.json({ ok: true, idWhatsApp: jidNorm, banido });
  } catch (err) {
    console.error('[API] PATCH /admin/usuario/ban:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/usuario/:idWhatsApp/gold
// Dá ou remove gold de um usuário em um grupo específico.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/admin/usuario/:idWhatsApp/gold', adminAuth, async (req, res) => {
  try {
    const termoOriginal = decodeURIComponent(req.params.idWhatsApp);
    const { idGrupo, valor, operacao } = req.body || {};
    const eGlobal = !idGrupo || idGrupo === 'global';

    if (!Number.isFinite(valor) || valor < 0)
      return res.status(400).json({ error: 'valor deve ser um número não negativo.' });
    const op = (operacao || 'dar').toLowerCase();
    if (!['dar', 'remover', 'definir', 'set'].includes(op))
      return res.status(400).json({ error: 'operacao deve ser "dar", "remover" ou "definir".' });

    const jidsBusca = await resolverJidsBusca(termoOriginal);
    const jidNorm   = jidsBusca[0] || normalizarJid(termoOriginal);

    if (!eGlobal) {
      const carteiraAtual = await getCarteira(jidNorm, idGrupo);

      let update = {};
      if (op === 'dar') {
        update = {
          $inc: { gold: valor },
          $push: { goldHistory: { $each: [{ type: 'recebido', item: 'Ajuste Admin', amount: valor, date: new Date() }], $slice: -50 } }
        };
      } else if (op === 'remover') {
        update = {
          $inc: { gold: -valor },
          $push: { goldHistory: { $each: [{ type: 'gasto', item: 'Ajuste Admin', amount: valor, date: new Date() }], $slice: -50 } }
        };
      } else {
        update = { $set: { gold: valor } };
      }

      const resUpdate = await CarteiraGrupo.updateMany(
        { idWhatsApp: { $in: jidsBusca }, idGrupo },
        update
      );

      if (resUpdate.matchedCount === 0) {
        const primaryJid = jidsBusca[0] || jidNorm;
        await CarteiraGrupo.findOneAndUpdate(
          { idWhatsApp: primaryJid, idGrupo },
          update,
          { upsert: true, new: true }
        );
      }

      let updateUsuario = {};
      if (op === 'dar') updateUsuario = { $inc: { gold: valor } };
      else if (op === 'remover') updateUsuario = { $inc: { gold: -valor } };
      else updateUsuario = { $set: { gold: valor } };
      await Usuario.updateMany({ idWhatsApp: { $in: jidsBusca } }, updateUsuario);

      const carteira = await CarteiraGrupo.findOne({ idWhatsApp: { $in: jidsBusca }, idGrupo }).lean();

      return res.json({ ok: true, idWhatsApp: jidsBusca[0], goldAtual: carteira?.gold ?? valor });
    }
  } catch (err) {
    console.error('[API] PATCH /admin/usuario/gold:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// Zera o saldo local de um usuário em todos os grupos.
router.delete('/admin/usuario/:idWhatsApp/gold/reset', adminAuth, async (req, res) => {
  try {
    const termoOriginal = decodeURIComponent(req.params.idWhatsApp);
    const jidNorm = normalizarJid(termoOriginal);
    const variantesPn = gerarVariantesNumero(termoOriginal.split('@')[0]).map(d => `${d}@s.whatsapp.net`);
    const lidMap = await LidMapping.findOne({ $or: [{ pn: { $in: variantesPn } }, { lid: jidNorm }] }).lean();
    const jidsBusca = [...new Set([jidNorm, ...(lidMap ? [lidMap.lid, lidMap.pn] : []), ...variantesPn].filter(Boolean))];
    const [resultadoCarteira, resultadoUsuario] = await Promise.all([
      CarteiraGrupo.updateMany({ idWhatsApp: { $in: jidsBusca } }, { $set: { gold: 0 } }),
      Usuario.updateMany({ idWhatsApp: { $in: jidsBusca } }, { $set: { gold: 0 } }),
    ]);
    if (!resultadoCarteira.matchedCount && !resultadoUsuario.matchedCount) {
      return res.status(404).json({ error: 'Nenhuma carteira encontrada para esse usuário.' });
    }
    return res.json({ ok: true, gruposAtualizados: resultadoCarteira.modifiedCount });
  } catch (err) {
    console.error('[API] DELETE /admin/usuario/gold/reset:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/gold/transferir
// Transfere gold de um usuário (origem) para outro (destino) dentro do mesmo grupo.
//
// Body: { idGrupo, idOrigem, idDestino, valor }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/gold/transferir', adminAuth, async (req, res) => {
  try {
    const { idGrupo, idOrigem, idDestino, valor } = req.body || {};

    if (!idGrupo)
      return res.status(400).json({ error: 'idGrupo é obrigatório.' });
    if (!idOrigem || !idDestino)
      return res.status(400).json({ error: 'idOrigem e idDestino são obrigatórios.' });
    if (!Number.isFinite(valor) || valor <= 0)
      return res.status(400).json({ error: 'valor deve ser um número positivo.' });

    const getJidsBusca = async (term) => {
      const norm = normalizarJid(term);
      const vars = gerarVariantesNumero(term.split('@')[0]).map(d => `${d}@s.whatsapp.net`);
      const map = await LidMapping.findOne({ $or: [{ pn: { $in: vars } }, { lid: norm }] }).lean();
      return [...new Set([norm, ...(map ? [map.lid, map.pn] : []), ...vars].filter(Boolean))];
    };

    const [jidsOrigem, jidsDestino] = await Promise.all([getJidsBusca(idOrigem), getJidsBusca(idDestino)]);

    if (jidsOrigem.some(j => jidsDestino.includes(j)))
      return res.status(400).json({ error: 'Origem e destino não podem ser o mesmo usuário.' });

    // Verifica saldo da origem
    const carteiraOrigem = await getCarteira(jidsOrigem[0], idGrupo);
    if (!carteiraOrigem)
      return res.status(404).json({ error: 'Carteira de origem não encontrada.' });
    if ((carteiraOrigem.gold || 0) < valor)
      return res.status(400).json({ error: `Saldo insuficiente. Origem tem ${carteiraOrigem.gold || 0}.` });

    const { de, para } = await transferirGold(
      jidsOrigem[0],
      jidsDestino[0],
      idGrupo,
      valor,
      'Transferência Admin',
    );

    return res.json({
      ok: true,
      goldOrigem: de.gold,
      goldDestino: para.gold,
    });
  } catch (err) {
    console.error('[API] POST /admin/gold/transferir:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/grupo/:jid/config
// ─────────────────────────────────────────────────────────────────────────────
const CAMPOS_CONFIG_BOOL    = ['xpAtivo', 'antiLink', 'boasVindas', 'botAtivo'];
const PREFIXOS_VALIDOS      = ['!', '.', '/', ','];

router.patch('/admin/grupo/:jid/config', adminAuth, async (req, res) => {
  try {
    const jid    = decodeURIComponent(req.params.jid);
    if (!jid || jid.length > 200) return res.status(400).json({ error: 'JID inválido.' });
    const campos = req.body || {};
    const chaves = Object.keys(campos);

    if (!chaves.length) return res.status(400).json({ error: 'Nenhum campo enviado.' });

    const update = {};
    for (const campo of chaves) {
      if (campo === 'prefixo') {
        if (!PREFIXOS_VALIDOS.includes(campos[campo]))
          return res.status(400).json({ error: `Prefixo inválido. Use um de: ${PREFIXOS_VALIDOS.join(' ')}` });
        update['config.prefixo'] = campos[campo];
      } else if (CAMPOS_CONFIG_BOOL.includes(campo)) {
        if (typeof campos[campo] !== 'boolean')
          return res.status(400).json({ error: `"${campo}" deve ser true ou false.` });
        update[`config.${campo}`] = campos[campo];
      } else {
        return res.status(400).json({ error: `Campo desconhecido: ${campo}` });
      }
    }

    await CarteiraGrupo.updateMany({ idGrupo: jid }, { $set: update });

    // Sincroniza campos relevantes com GrupoConfig (fonte lida pelo bot.js)
    const GrupoConfig = require('../models/GrupoConfig');
    const syncCampos = {};
    if ('config.botAtivo'   in update) syncCampos.botAtivo   = update['config.botAtivo'];
    if ('config.antiLink'   in update) syncCampos.antiLink   = update['config.antiLink'];
    if ('config.xpAtivo'    in update) syncCampos.xpAtivo    = update['config.xpAtivo'];
    if ('config.boasVindas' in update) syncCampos.boasVindas = update['config.boasVindas'];

    if (Object.keys(syncCampos).length) {
      await GrupoConfig.findOneAndUpdate(
        { idGrupo: jid },
        { $set: syncCampos },
        { upsert: true }
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[API] PATCH /admin/grupo/config:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/grupo/:jid/nome
// ─────────────────────────────────────────────────────────────────────────────
const MAX_NOME_GRUPO = 80;

router.patch('/admin/grupo/:jid/nome', adminAuth, async (req, res) => {
  try {
    const jid  = decodeURIComponent(req.params.jid);
    if (!jid || jid.length > 200) return res.status(400).json({ error: 'JID inválido.' });
    const nome = typeof req.body?.nome === 'string' ? req.body.nome.trim() : '';

    if (!nome) return res.status(400).json({ error: 'Nome não pode ser vazio.' });
    if (nome.length > MAX_NOME_GRUPO)
      return res.status(400).json({ error: `Nome muito longo (máx ${MAX_NOME_GRUPO} caracteres).` });

    const resultado = await CarteiraGrupo.updateMany(
      { idGrupo: jid },
      { $set: { nomeCustom: nome } }
    );

    if (!resultado.matchedCount)
      return res.status(404).json({ error: 'Nenhum registro encontrado para esse grupo.' });

    return res.json({ ok: true, jid, nome });
  } catch (err) {
    console.error('[API] PATCH /admin/grupo/nome:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/grupo/:jid/mensagens
// ─────────────────────────────────────────────────────────────────────────────
const MAX_MSG = 5000;

router.put('/admin/grupo/:jid/mensagens', adminAuth, async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    if (!jid || jid.length > 200) return res.status(400).json({ error: 'JID inválido.' });
    const { boasVindas, regras } = req.body || {};

    if (boasVindas != null && typeof boasVindas !== 'string')
      return res.status(400).json({ error: 'boasVindas deve ser texto.' });
    if (regras != null && typeof regras !== 'string')
      return res.status(400).json({ error: 'regras deve ser texto.' });
    if ((boasVindas?.length || 0) > MAX_MSG || (regras?.length || 0) > MAX_MSG)
      return res.status(400).json({ error: `Máximo de ${MAX_MSG} caracteres por mensagem.` });

    // Atualiza em memória no bot (fonte real de verdade para boas-vindas)
    try {
      const grupoHandler = require('../handlers/grupo');
      if (typeof grupoHandler.setBemVindo === 'function') {
        grupoHandler.setBemVindo(jid, boasVindas || '');
      }
    } catch (e) {
      console.warn('[Admin] Não foi possível atualizar bemVindoGroups em memória:', e.message);
    }

    // Persiste no MongoDB como cache (best-effort, não bloqueia)
    CarteiraGrupo.updateMany(
      { idGrupo: jid },
      { $set: { 'mensagens.boasVindas': boasVindas ?? '', 'mensagens.regras': regras ?? '' } }
    ).catch(e => console.warn('[Admin] Erro ao persistir mensagens no MongoDB:', e.message));

    return res.json({ ok: true });
  } catch (err) {
    console.error('[API] PUT /admin/grupo/mensagens:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/grupo/:jid/gold-ranking
// Retorna o ranking de gold dos membros de um grupo específico (top 20).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/grupo/:jid/gold-ranking', adminAuth, async (req, res) => {
  try {
    const jid   = decodeURIComponent(req.params.jid);
    if (!jid || jid.length > 200) return res.status(400).json({ error: 'JID inválido.' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const membros = await CarteiraGrupo
      .find({ idGrupo: jid, gold: { $gt: 0 } })
      .sort({ gold: -1 })
      .limit(limit)
      .lean();

    const jids = membros.map(m => m.idWhatsApp);

    // Resolve @lid → PN para buscar nomes no Usuario
    const lidMappings = await LidMapping.find({
      lid: { $in: jids.filter(j => j?.endsWith('@lid')) }
    }).lean();
    const lidParaPn = Object.fromEntries(lidMappings.map(m => [m.lid, m.pn]));
    const pnsResolvidos = Object.values(lidParaPn);

    const usuariosMap = {};
    if (jids.length) {
      const usuarios = await Usuario.find({ idWhatsApp: { $in: [...jids, ...pnsResolvidos] } })
        .select('idWhatsApp nome telefone')
        .lean();
      for (const u of usuarios) usuariosMap[u.idWhatsApp] = u;
    }

    const ranking = membros.map(m => {
      const pnResolvido = lidParaPn[m.idWhatsApp] || m.idWhatsApp;
      const u = usuariosMap[m.idWhatsApp] || usuariosMap[pnResolvido] || {};
      const numeroPuro = (pnResolvido || m.idWhatsApp)?.split('@')[0]?.replace(/\D/g, '') || '';
      return {
        idWhatsApp: m.idWhatsApp,
        nome:       u.nome || u.telefone || numeroPuro || '—',
        telefone:   u.telefone || numeroPuro || '—',
        gold:       m.gold ?? 0,
        xp:         m.xp   ?? 0,
        level:      m.level ?? 1,
      };
    });

    return res.json({ ranking });
  } catch (err) {
    console.error('[API] GET /admin/grupo/:jid/gold-ranking:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/grupo/:jid/gold/reset
// Zera o gold de TODOS os membros de um grupo.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/admin/grupo/:jid/gold/reset', adminAuth, async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    if (!jid || jid.length > 200) return res.status(400).json({ error: 'JID inválido.' });

    const resultado = await CarteiraGrupo.updateMany(
      { idGrupo: jid },
      { $set: { gold: 0 } }
    );

    if (!resultado.matchedCount)
      return res.status(404).json({ error: 'Nenhum membro encontrado nesse grupo.' });

    return res.json({ ok: true, membrosAtualizados: resultado.modifiedCount });
  } catch (err) {
    console.error('[API] DELETE /admin/grupo/:jid/gold/reset:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/logs
// Retorna logs do bot com paginação, filtro por tipo e busca por texto.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/logs', adminAuth, async (req, res) => {
  try {
    let BotLog;
    try {
      BotLog = require('../models/BotLog');
    } catch {
      // Model ainda não existe — retorna vazio graciosamente
      return res.json({ logs: [], total: 0 });
    }

    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const limite = Math.min(parseInt(req.query.limite, 10) || 50, 200);
    const tipo   = req.query.tipo  || null;
    const busca  = req.query.busca || null;

    const filtro = {};
    if (tipo)  filtro.tipo = tipo;
    if (busca) {
      const re = new RegExp(busca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filtro.$or = [
        { comando:  re },
        { mensagem: re },
        { detalhe:  re },
        { usuario:  re },
        { grupo:    re },
      ];
    }

    const [logs, total] = await Promise.all([
      BotLog.find(filtro)
        .sort({ timestamp: -1 })
        .skip((pagina - 1) * limite)
        .limit(limite)
        .lean(),
      BotLog.countDocuments(filtro),
    ]);

    return res.json({ logs, total });
  } catch (err) {
    console.error('[API] GET /admin/logs:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/economia
// Retorna dados agregados da economia global com rankings de gold, xp e mensagens
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/economia', adminAuth, async (req, res) => {
  try {
    const matchGrupoValido = { $match: { idGrupo: { $regex: /@g\.us$/ } } };

    const [agregacao, topGoldRaw, topXpRaw, topMsgsRaw] = await Promise.all([
      CarteiraGrupo.aggregate([
        matchGrupoValido,
        {
          $group: {
            _id: null,
            totalGold:   { $sum: '$gold' },
            totalXp:     { $sum: '$xp' },
            totalContas: { $sum: 1 },
          }
        }
      ]),
      CarteiraGrupo.aggregate([
        matchGrupoValido,
        { $group: { _id: '$idWhatsApp', gold: { $sum: '$gold' }, xp: { $sum: '$xp' } } },
        { $sort: { gold: -1 } },
        { $limit: 10 },
      ]),
      CarteiraGrupo.aggregate([
        matchGrupoValido,
        { $group: { _id: '$idWhatsApp', xp: { $sum: '$xp' }, gold: { $sum: '$gold' } } },
        { $sort: { xp: -1 } },
        { $limit: 10 },
      ]),
      CarteiraGrupo.aggregate([
        matchGrupoValido,
        { $group: { _id: '$idWhatsApp', mensagens: { $sum: '$mensagens' } } },
        { $sort: { mensagens: -1 } },
        { $limit: 10 },
      ]),
    ]);

    const dados = agregacao[0] || { totalGold: 0, totalXp: 0, totalContas: 0 };

    // Enriquece rankings com nomes dos usuários
    const todosJids = [...topGoldRaw, ...topXpRaw, ...topMsgsRaw]
      .map(m => m._id)
      .filter(Boolean);

    const usuariosMap = {};
    if (todosJids.length) {
      const usuarios = await Usuario.find({ idWhatsApp: { $in: todosJids } })
        .select('idWhatsApp nome telefone')
        .lean();
      for (const u of usuarios) usuariosMap[u.idWhatsApp] = u;
    }

    const enriquecer = (lista) => lista.map(m => {
      const u = usuariosMap[m._id] || {};
      return {
        idWhatsApp: m._id,
        nome:       u.nome || u.telefone || m._id?.split('@')[0] || 'Anônimo',
        gold:       m.gold      ?? 0,
        xp:         m.xp        ?? 0,
        mensagens:  m.mensagens ?? 0,
      };
    });

    const totalUsuariosComGold = await CarteiraGrupo
      .distinct('idWhatsApp', { idGrupo: { $regex: /@g\.us$/ }, gold: { $gt: 0 } })
      .then(r => r.length);

    const mediaGold = totalUsuariosComGold > 0
      ? Math.round(dados.totalGold / totalUsuariosComGold)
      : 0;

    return res.json({
      totalGold:            dados.totalGold,
      totalXp:              dados.totalXp,
      mediaGold,
      totalUsuariosComGold,
      topGold:  enriquecer(topGoldRaw),
      topXp:    enriquecer(topXpRaw),
      topMsgs:  enriquecer(topMsgsRaw),
    });
  } catch (err) {
    console.error('[API] GET /admin/economia:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/usuario/:idWhatsApp/gold/reset-grupo
// Zera o gold de um usuário em um grupo específico.
// Body: { idGrupo }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/usuario/gold/reset-grupo', adminAuth, async (req, res) => {
  try {
    const { idWhatsApp: idRaw, idGrupo } = req.body || {};

    if (!idRaw)
      return res.status(400).json({ error: 'idWhatsApp é obrigatório.' });
    if (!idGrupo)
      return res.status(400).json({ error: 'idGrupo é obrigatório.' });

    const idWhatsApp = await resolverIdWhatsApp(idRaw, idGrupo);

    const resultado = await CarteiraGrupo.updateOne(
      { idWhatsApp, idGrupo },
      { $set: { gold: 0 } }
    );

    if (!resultado.matchedCount)
      return res.status(404).json({ error: 'Carteira não encontrada.' });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[API] POST /admin/usuario/gold/reset-grupo:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS DO CASSINO (JWT de sessão)
// ══════════════════════════════════════════════════════════════════════════════

function parseInteiroJogo(valor) {
  if (typeof valor === 'number') return Number.isSafeInteger(valor) ? valor : null;
  if (typeof valor !== 'string' || !/^-?\d+$/.test(valor.trim())) return null;
  const numero = Number(valor.trim());
  return Number.isSafeInteger(numero) ? numero : null;
}

function idGrupoValidoJogo(idGrupo) {
  return typeof idGrupo === 'string'
    && idGrupo === idGrupo.trim()
    && idGrupo.length <= 128
    && /^\d+@g\.us$/.test(idGrupo);
}

function requestIdJogoValido(requestId) {
  return typeof requestId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId);
}

function mesmaRodadaSalva(registro, dados) {
  return registro.jogo === dados.jogo
    && registro.idGrupo === dados.idGrupo
    && Number(registro.aposta) === Number(dados.aposta)
    && (registro.escolha ?? null) === (dados.escolha ?? null);
}

async function resolverRequestExistente(registro, dados) {
  if (!mesmaRodadaSalva(registro, dados)) {
    return { resposta: true, status: 409, corpo: { error: 'Este identificador já está associado a outra aposta. Confira o saldo antes de continuar.' } };
  }

  let atual = registro;
  for (let tentativa = 0; tentativa < 15 && atual.status !== 'completed'; tentativa++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    atual = await JogoRequest.findOne({ idWhatsApp: dados.idWhatsApp, requestId: dados.requestId }).lean();
    if (!atual) break;
  }

  if (atual?.status === 'completed') {
    return { resposta: true, status: atual.httpStatus || 200, corpo: atual.response || { error: 'A rodada foi concluída, mas não há um resultado salvo.' }, replay: true };
  }

  return { resposta: true, status: 409, corpo: { error: 'Esta rodada ainda está sendo processada. Tente novamente com os mesmos dados; a aposta não será debitada duas vezes.' } };
}

async function iniciarRequestJogo(dados) {
  if (!requestIdJogoValido(dados.requestId)) {
    return { resposta: true, status: 400, corpo: { error: 'requestId inválido ou ausente. Atualize a página do jogo e tente novamente.' } };
  }

  dados.requestId = dados.requestId.toLowerCase();
  dados.idWhatsApp = String(dados.idWhatsApp || '').toLowerCase();
  const query = { idWhatsApp: dados.idWhatsApp, requestId: dados.requestId };
  const existente = await JogoRequest.findOne(query).lean();
  if (existente) return resolverRequestExistente(existente, dados);

  try {
    const registro = await JogoRequest.create({ ...dados, status: 'pending' });
    return { resposta: false, registro };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const concorrente = await JogoRequest.findOne(query).lean();
    if (!concorrente) throw error;
    return resolverRequestExistente(concorrente, dados);
  }
}

async function concluirRequestJogo(dados, status, corpo) {
  await JogoRequest.updateOne(
    { idWhatsApp: String(dados.idWhatsApp || '').toLowerCase(), requestId: String(dados.requestId || '').toLowerCase(), status: 'pending' },
    { $set: { status: 'completed', httpStatus: status, response: corpo } },
  );
}

async function encontrarCarteiraJogo(idWhatsApp, idGrupo) {
  const rawJid = String(idWhatsApp || '').trim().toLowerCase();
  if (!rawJid) return null;

  const jidNorm = normalizarJid(rawJid) || rawJid;
  const digitos = jidNorm.split('@')[0].split(':')[0];
  const variantesPn = gerarVariantesNumero(digitos).map(n => `${n}@s.whatsapp.net`);
  const jidsBusca = new Set([rawJid, jidNorm, ...variantesPn]);

  const lidMap = await LidMapping.findOne({
    $or: [
      { lid: rawJid },
      { lid: jidNorm },
      { pn: { $in: [rawJid, jidNorm, ...variantesPn] } },
    ],
  }).lean();
  if (lidMap?.lid) jidsBusca.add(lidMap.lid);
  if (lidMap?.pn) jidsBusca.add(lidMap.pn);

  const carteiras = await CarteiraGrupo
    .find({ idWhatsApp: { $in: [...jidsBusca] }, idGrupo })
    .sort({ gold: -1, xp: -1 })
    .lean();
  return carteiras[0] || null;
}

const SLOTS_SIMBOLOS = [
  { emoji: '💎', nome: 'Diamante', peso: 2  },
  { emoji: '7️⃣',  nome: 'Sete',    peso: 5  },
  { emoji: '🔔', nome: 'Sino',    peso: 10 },
  { emoji: '🍇', nome: 'Uva',     peso: 15 },
  { emoji: '🍉', nome: 'Melancia',peso: 18 },
  { emoji: '🍋', nome: 'Limão',   peso: 22 },
  { emoji: '🍒', nome: 'Cereja',  peso: 28 },
];

const SLOTS_POOL = SLOTS_SIMBOLOS.flatMap(s => Array(s.peso).fill(s.emoji));

const SLOTS_MULTIPLICADORES = {
  '💎': { tres: 50, dois: 5   },
  '7️⃣':  { tres: 25, dois: 3   },
  '🔔': { tres: 15, dois: 2   },
  '🍇': { tres: 10, dois: 1.5 },
  '🍉': { tres: 8,  dois: 1.5 },
  '🍋': { tres: 6,  dois: 1.2 },
  '🍒': { tres: 4,  dois: 1.2 },
};

function sortearSlotBackend() {
  const pick = () => SLOTS_POOL[crypto.randomInt(SLOTS_POOL.length)];
  return [pick(), pick(), pick()];
}

function calcularResultadoSlot(r1, r2, r3) {
  if (r1 === r2 && r2 === r3) {
    const mult = SLOTS_MULTIPLICADORES[r1]?.tres ?? 4;
    const tipo = mult >= 25 ? 'jackpot_lendario' : mult >= 10 ? 'jackpot' : 'tres_iguais';
    return { mult, tipo };
  }
  if (r1 === r2 || r2 === r3 || r1 === r3) {
    const simbolo = r1 === r2 ? r1 : r3 === r2 ? r2 : r1;
    const mult    = SLOTS_MULTIPLICADORES[simbolo]?.dois ?? 1.2;
    return { mult, tipo: 'dois_iguais' };
  }
  return { mult: 0, tipo: 'derrota' };
}

// ─── Rate limit do cassino (10 giros/min por usuário) ─────────────────────────
const CASSINO_MAX    = 10;
const CASSINO_JANELA = 60 * 1000;

const cassinoRateLimit = rateLimit({
  windowMs:     CASSINO_JANELA,
  max:          CASSINO_MAX,
  keyGenerator: (req) => req.user?.idWhatsApp || ipKeyGenerator(req.ip || '0.0.0.0'),
  handler: (req, res) => {
    return res.status(429).json({
      error: 'Muitos giros! Aguarde antes de tentar novamente.'
    });
  },
  skip: (req) => !req.user,
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cassino/slots
// Body: { idGrupo, aposta }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/cassino/slots', auth, cassinoRateLimit, async (req, res) => {
  let rodadaAtual = null;
  try {
    const idWhatsApp = req.user.idWhatsApp;
    const { idGrupo, aposta, requestId } = req.body || {};

    // Validações estritas: não aceitar decimais, lixo anexado nem IDs que não sejam grupos.
    if (!idGrupoValidoJogo(idGrupo))
      return res.status(400).json({ error: 'Grupo inválido.' });

    const valorAposta = parseInteiroJogo(aposta);
    if (valorAposta === null || valorAposta < 10)
      return res.status(400).json({ error: 'A aposta mínima é 10 e deve ser um número inteiro.' });

    if (valorAposta > 100_000)
      return res.status(400).json({ error: `Aposta máxima: ${formatarSaldo(100_000)}.` });

    const dadosRodada = { idWhatsApp, requestId, jogo: 'slots', idGrupo, aposta: valorAposta, escolha: null };
    const abertura = await iniciarRequestJogo(dadosRodada);
    if (abertura.resposta) return res.status(abertura.status).json(abertura.corpo);
    rodadaAtual = dadosRodada;

    // Confirma participação e resolve variações PN/LID antes de mexer no saldo.
    const carteiraEncontrada = await encontrarCarteiraJogo(idWhatsApp, idGrupo);
    if (!carteiraEncontrada) {
      const corpo = { error: 'Você não pertence a esse grupo.' };
      await concluirRequestJogo(rodadaAtual, 403, corpo);
      return res.status(403).json(corpo);
    }

    let idResolvido = carteiraEncontrada.idWhatsApp;
    const carteiraIntegrada = await getCarteira(idResolvido, idGrupo);
    if (carteiraIntegrada?.idWhatsApp) idResolvido = carteiraIntegrada.idWhatsApp;
    let carteiraDebitada;
    try {
      carteiraDebitada = await alterarGold(
        idResolvido,
        idGrupo,
        -valorAposta,
        'Slots (aposta)',
      );
    } catch (error) {
      if (error instanceof RangeError) {
        const corpo = { error: 'Saldo insuficiente.', saldo: carteiraIntegrada.gold };
        await concluirRequestJogo(rodadaAtual, 400, corpo);
        return res.status(400).json(corpo);
      }
      throw error;
    }

    // ── Sorteia resultado ─────────────────────────────────────────────────────
    const [r1, r2, r3]   = sortearSlotBackend();
    const { mult, tipo } = calcularResultadoSlot(r1, r2, r3);
    const premio         = Math.floor(valorAposta * mult);
    const lucroLiq       = premio - valorAposta;

    // ── Credita prêmio (se ganhou) ────────────────────────────────────────────
    let saldoFinal = carteiraDebitada.gold;

    if (premio > 0) {
      try {
        const carteiraAtualizada = await alterarGold(
          idResolvido,
          idGrupo,
          premio,
          `Slots (${mult}x)`,
        );
        saldoFinal = carteiraAtualizada.gold;
      } catch (error) {
        try {
          await alterarGold(idResolvido, idGrupo, valorAposta, 'Estorno de aposta: prêmio indisponível');
        } catch (refundError) {
          console.error('[API] Estorno crítico de Slots falhou:', refundError);
        }
        throw error;
      }
    }

    const resultado = {
      resultado: [r1, r2, r3],
      tipo,
      mult,
      premio,
      lucroLiq,
      aposta: valorAposta,
      saldoFinal,
    };
    await concluirRequestJogo(rodadaAtual, 200, resultado);
    return res.json(resultado);

  } catch (err) {
    if (rodadaAtual) {
      try { await concluirRequestJogo(rodadaAtual, 500, { error: 'Erro interno.' }); }
      catch (persistErr) { console.error('[API] Não foi possível salvar estado da rodada Slots:', persistErr.message); }
    }
    console.error('[API] POST /cassino/slots:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/grupos/:idWhatsApp
// Retorna os grupos de um usuário com nome e gold (requer JWT).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/user/grupos/:idWhatsApp', auth, async (req, res) => {
  try {
    const idSolicitado = decodeURIComponent(req.params.idWhatsApp || '').trim().toLowerCase();
    const idWhatsApp = String(req.user.idWhatsApp || '').trim().toLowerCase();
    if (!idWhatsApp || idSolicitado !== idWhatsApp) {
      return res.status(403).json({ error: 'Você só pode consultar os grupos da sua própria conta.' });
    }

    const carteiras = await CarteiraGrupo
      .find({ idWhatsApp, $or: [{ xp: { $gt: 0 } }, { mensagens: { $gt: 0 } }] })
      .sort({ xp: -1 })
      .lean();

    if (!carteiras.length)
      return res.json({ grupos: [] });

    const jids = carteiras.map(c => c.idGrupo);
    const nomesMap = {};
    if (jids.length) {
      const docs = await CarteiraGrupo.aggregate([
        { $match: { idGrupo: { $in: jids } } },
        { $group: {
          _id:        '$idGrupo',
          nomeCustom: { $max: '$nomeCustom' },
          nomeGrupo:  { $max: '$nomeGrupo' },
        }},
      ]);
      for (const d of docs) nomesMap[d._id] = nomeGrupo(d, d._id);
    }

    const grupos = carteiras.map(c => ({
      jid:      c.idGrupo,
      nome:     nomesMap[c.idGrupo] || nomeGrupoFallback(c.idGrupo),
      gold:     c.gold     ?? 0,
      xp:       c.xp       ?? 0,
      level:    c.level    ?? 1,
      mensagens: c.mensagens ?? 0,
    }));

    return res.json({ grupos });
  } catch (err) {
    console.error('[API] GET /user/grupos/:idWhatsApp:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS DA CORRIDA (JWT de sessão)
// ══════════════════════════════════════════════════════════════════════════════

// Odds calculadas para ~90% de retorno teórico: probabilidade = velocidade / 37.
// O arredondamento para duas casas e Math.floor do prêmio tornam o retorno real ligeiramente menor.
const CORRIDA_BICHOS_API = [
  { nome: '🐎 Cavalo',    emoji: '🐎', odds: 3.70, velocidade: 9 },
  { nome: '🐅 Tigre',     emoji: '🐅', odds: 4.16, velocidade: 8 },
  { nome: '🦊 Raposa',    emoji: '🦊', odds: 4.76, velocidade: 7 },
  { nome: '🐕 Cachorro',  emoji: '🐕', odds: 5.55, velocidade: 6 },
  { nome: '🐗 Javali',    emoji: '🐗', odds: 6.66, velocidade: 5 },
  { nome: '🐢 Tartaruga', emoji: '🐢', odds: 16.65, velocidade: 2 },
];

const CORRIDA_RATE_MAX    = 10;
const CORRIDA_RATE_JANELA = 60 * 1000;

const corridaRateLimit = rateLimit({
  windowMs:     CORRIDA_RATE_JANELA,
  max:          CORRIDA_RATE_MAX,
  keyGenerator: (req) => req.user?.idWhatsApp || ipKeyGenerator(req.ip || '0.0.0.0'),
  handler: (req, res) => {
    return res.status(429).json({ error: 'Muitas apostas! Aguarde antes de tentar novamente.' });
  },
  skip: (req) => !req.user,
});

function sortearVencedorApi() {
  const pool = CORRIDA_BICHOS_API.flatMap((b, i) => Array(b.velocidade).fill(i));
  return pool[crypto.randomInt(pool.length)];
}

// POST /api/corrida/apostar
// Body: { idGrupo, escolha (0-5), aposta }
router.post('/corrida/apostar', auth, corridaRateLimit, async (req, res) => {
  let rodadaAtual = null;
  try {
    const idWhatsApp = req.user.idWhatsApp;
    const { idGrupo, escolha, aposta, requestId } = req.body || {};

    if (!idGrupoValidoJogo(idGrupo))
      return res.status(400).json({ error: 'Grupo inválido.' });

    const escolhaIdx = parseInteiroJogo(escolha);
    if (escolhaIdx === null || escolhaIdx < 0 || escolhaIdx >= CORRIDA_BICHOS_API.length)
      return res.status(400).json({ error: 'Escolha inválida.' });

    const valorAposta = parseInteiroJogo(aposta);
    if (valorAposta === null || valorAposta < 10)
      return res.status(400).json({ error: 'A aposta mínima é 10 e deve ser um número inteiro.' });

    if (valorAposta > 100_000)
      return res.status(400).json({ error: `Aposta máxima: ${formatarSaldo(100_000)}.` });

    const dadosRodada = { idWhatsApp, requestId, jogo: 'corrida', idGrupo, aposta: valorAposta, escolha: escolhaIdx };
    const abertura = await iniciarRequestJogo(dadosRodada);
    if (abertura.resposta) return res.status(abertura.status).json(abertura.corpo);
    rodadaAtual = dadosRodada;

    const carteiraEncontrada = await encontrarCarteiraJogo(idWhatsApp, idGrupo);
    if (!carteiraEncontrada) {
      const corpo = { error: 'Você não pertence a esse grupo.' };
      await concluirRequestJogo(rodadaAtual, 403, corpo);
      return res.status(403).json(corpo);
    }

    let idResolvido = carteiraEncontrada.idWhatsApp;
    const carteiraIntegrada = await getCarteira(idResolvido, idGrupo);
    if (carteiraIntegrada?.idWhatsApp) idResolvido = carteiraIntegrada.idWhatsApp;
    let carteiraDebitada;
    try {
      carteiraDebitada = await alterarGold(
        idResolvido,
        idGrupo,
        -valorAposta,
        `Corrida (${CORRIDA_BICHOS_API[escolhaIdx].nome})`,
      );
    } catch (error) {
      if (error instanceof RangeError) {
        const corpo = { error: 'Saldo insuficiente.', saldo: carteiraIntegrada.gold };
        await concluirRequestJogo(rodadaAtual, 400, corpo);
        return res.status(400).json(corpo);
      }
      throw error;
    }

    const vencedorIdx = sortearVencedorApi();
    const ganhou      = escolhaIdx === vencedorIdx;
    const bicho       = CORRIDA_BICHOS_API[escolhaIdx];
    const premio      = ganhou ? Math.floor(valorAposta * bicho.odds) : 0;
    const lucroLiq    = premio - valorAposta;

    let saldoFinal = carteiraDebitada.gold;

    if (premio > 0) {
      try {
        const carteiraAtualizada = await alterarGold(
          idResolvido,
          idGrupo,
          premio,
          `Corrida (${bicho.odds}x)`,
        );
        saldoFinal = carteiraAtualizada.gold;
      } catch (error) {
        try {
          await alterarGold(idResolvido, idGrupo, valorAposta, 'Estorno de aposta: prêmio indisponível');
        } catch (refundError) {
          console.error('[API] Estorno crítico de Corrida falhou:', refundError);
        }
        throw error;
      }
    }

    const resultado = {
      vencedorIdx,
      escolhaIdx,
      bichos: CORRIDA_BICHOS_API.map(b => ({ nome: b.nome, emoji: b.emoji, odds: b.odds })),
      ganhou,
      premio,
      lucroLiq,
      aposta: valorAposta,
      saldoFinal,
    };
    await concluirRequestJogo(rodadaAtual, 200, resultado);
    return res.json(resultado);

  } catch (err) {
    if (rodadaAtual) {
      try { await concluirRequestJogo(rodadaAtual, 500, { error: 'Erro interno.' }); }
      catch (persistErr) { console.error('[API] Não foi possível salvar estado da rodada Corrida:', persistErr.message); }
    }
    console.error('[API] POST /corrida/apostar:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/games/request/:requestId
// Confere o estado de uma rodada do próprio usuário após falha de conexão/servidor.
router.get('/games/request/:requestId', auth, async (req, res) => {
  try {
    const requestId = String(req.params.requestId || '').toLowerCase();
    if (!requestIdJogoValido(requestId)) {
      return res.status(400).json({ error: 'Identificador de rodada inválido.' });
    }

    const registro = await JogoRequest.findOne({
      idWhatsApp: String(req.user.idWhatsApp || '').toLowerCase(),
      requestId,
    }).lean();
    if (!registro) return res.status(404).json({ error: 'Nenhuma rodada registrada com este identificador.' });

    return res.json({
      requestId: registro.requestId,
      jogo: registro.jogo,
      idGrupo: registro.idGrupo,
      status: registro.status,
      httpStatus: registro.httpStatus,
      response: registro.status === 'completed' ? registro.response : null,
    });
  } catch (err) {
    console.error('[API] GET /games/request/:requestId:', err);
    return res.status(500).json({ error: 'Não foi possível conferir o estado da rodada.' });
  }
});

// GET /api/games/wallet/:idGrupo
// Retorna o saldo atual usando a mesma resolução PN/LID usada no processamento de apostas.
router.get('/games/wallet/:idGrupo', auth, async (req, res) => {
  try {
    const idGrupo = decodeURIComponent(req.params.idGrupo || '');
    if (!idGrupoValidoJogo(idGrupo)) {
      return res.status(400).json({ error: 'Grupo inválido.' });
    }

    const carteiraEncontrada = await encontrarCarteiraJogo(req.user.idWhatsApp, idGrupo);
    if (!carteiraEncontrada) {
      return res.status(403).json({ error: 'Você não pertence a esse grupo.' });
    }

    const carteira = await getCarteira(carteiraEncontrada.idWhatsApp, idGrupo);
    return res.json({ idGrupo, gold: Number(carteira?.gold) || 0 });
  } catch (err) {
    console.error('[API] GET /games/wallet/:idGrupo:', err);
    return res.status(500).json({ error: 'Não foi possível atualizar o saldo do jogo.' });
  }
});

// GET /api/corrida/bichos
router.get('/corrida/bichos', (req, res) => {
  return res.json({
    bichos: CORRIDA_BICHOS_API.map((b, i) => ({
      idx: i, nome: b.nome, emoji: b.emoji, odds: b.odds, velocidade: b.velocidade,
    }))
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/usuario/:idWhatsApp/level
// Define level E xp de um usuário em um grupo específico (ambos juntos).
// Body: { idGrupo, level, xp }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/admin/usuario/:idWhatsApp/level', adminAuth, async (req, res) => {
  try {
    const termoOriginal = decodeURIComponent(req.params.idWhatsApp);
    const { idGrupo, level, xp } = req.body || {};

    if (level != null && (!Number.isInteger(level) || level < 1))
      return res.status(400).json({ error: 'level deve ser um inteiro >= 1.' });
    if (xp != null && (!Number.isFinite(xp) || xp < 0))
      return res.status(400).json({ error: 'xp deve ser um número >= 0.' });

    const updateData = {};
    if (level != null) updateData.level = level;
    if (xp != null) updateData.xp = xp;

    if (!Object.keys(updateData).length)
      return res.status(400).json({ error: 'Informe level ou xp para atualizar.' });

    const eGlobal = !idGrupo || idGrupo === 'global';

    if (!eGlobal) {
      const idWhatsApp = await resolverIdWhatsApp(termoOriginal, idGrupo);
      const carteira = await CarteiraGrupo.findOneAndUpdate(
        { idWhatsApp, idGrupo },
        { $set: updateData },
        { new: true, upsert: true }
      ).lean();

      return res.json({ ok: true, idWhatsApp, idGrupo, level: carteira.level, xp: carteira.xp });
    } else {
      const jidNorm = normalizarJid(termoOriginal);
      const variantesPn = gerarVariantesNumero(termoOriginal.split('@')[0]).map(d => `${d}@s.whatsapp.net`);
      const lidMap = await LidMapping.findOne({ $or: [{ pn: { $in: variantesPn } }, { lid: jidNorm }] }).lean();
      const jidsBusca = [...new Set([jidNorm, ...(lidMap ? [lidMap.lid, lidMap.pn] : []), ...variantesPn].filter(Boolean))];

      const [resCarteiras] = await Promise.all([
        CarteiraGrupo.updateMany(
          { idWhatsApp: { $in: jidsBusca }, idGrupo: { $regex: /@g\.us$/ } },
          { $set: updateData }
        ),
        Usuario.updateMany(
          { idWhatsApp: { $in: jidsBusca } },
          { $set: updateData }
        )
      ]);

      return res.json({ ok: true, idWhatsApp: jidNorm, gruposAtualizados: resCarteiras.modifiedCount });
    }
  } catch (err) {
    console.error('[API] PATCH /admin/usuario/level:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/usuario/:idWhatsApp/inventario?idGrupo=xxx
// Retorna o inventário do usuário (do grupo ou global).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/usuario/:idWhatsApp/inventario', adminAuth, async (req, res) => {
  try {
    const termoOriginal = decodeURIComponent(req.params.idWhatsApp);
    const idGrupo       = req.query.idGrupo;
    const eGlobal       = !idGrupo || idGrupo === 'global';

    if (!eGlobal) {
      const idWhatsApp = await resolverIdWhatsApp(termoOriginal, idGrupo);
      const carteira   = await CarteiraGrupo.findOne({ idWhatsApp, idGrupo })
        .select('inventario')
        .lean();

      let inventario = carteira?.inventario || [];
      if (!Array.isArray(inventario)) {
        const obj = inventario instanceof Map ? Object.fromEntries(inventario) : (inventario || {});
        inventario = Object.entries(obj).map(([nome, quantidade]) => ({
          nome,
          quantidade: Number(quantidade) || 1,
        }));
      }
      return res.json({ inventario });
    } else {
      const jidNorm = normalizarJid(termoOriginal);
      const variantesPn = gerarVariantesNumero(termoOriginal.split('@')[0]).map(d => `${d}@s.whatsapp.net`);
      const lidMap = await LidMapping.findOne({ $or: [{ pn: { $in: variantesPn } }, { lid: jidNorm }] }).lean();
      const jidsBusca = [...new Set([jidNorm, ...(lidMap ? [lidMap.lid, lidMap.pn] : []), ...variantesPn].filter(Boolean))];

      const usuario = await Usuario.findOne({ idWhatsApp: { $in: jidsBusca } })
        .select('inventory')
        .lean();

      const invObj = mapParaObjeto(usuario?.inventory || {});
      const inventario = Object.entries(invObj).map(([nome, quantidade]) => ({
        nome,
        quantidade: Number(quantidade) || 1,
      }));

      return res.json({ inventario });
    }
  } catch (err) {
    console.error('[API] GET /admin/usuario/inventario:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/usuario/:idWhatsApp/inventario
// Adiciona um item ao inventário do usuário em um grupo ou globalmente.
// Body: { idGrupo, item, quantidade }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/usuario/:idWhatsApp/inventario', adminAuth, async (req, res) => {
  try {
    const termoOriginal                 = decodeURIComponent(req.params.idWhatsApp);
    const { idGrupo, item, quantidade } = req.body || {};

    if (!item || typeof item !== 'string' || !item.trim())
      return res.status(400).json({ error: 'item deve ser uma string não vazia.' });
    const qtd = parseInt(quantidade, 10) || 1;
    if (qtd < 1)
      return res.status(400).json({ error: 'quantidade deve ser >= 1.' });

    const nomeItem = item.trim();
    const eGlobal  = !idGrupo || idGrupo === 'global';

    if (!eGlobal) {
      const idWhatsApp    = await resolverIdWhatsApp(termoOriginal, idGrupo);
      const carteiraAtual = await CarteiraGrupo.findOne({ idWhatsApp, idGrupo })
        .select('inventario')
        .lean();

      const invAtual = carteiraAtual?.inventario;
      const ehArray  = Array.isArray(invAtual);

      let carteira;
      if (ehArray) {
        const idx = (invAtual || []).findIndex(i => i.nome === nomeItem);
        if (idx >= 0) {
          carteira = await CarteiraGrupo.findOneAndUpdate(
            { idWhatsApp, idGrupo, 'inventario.nome': nomeItem },
            { $inc: { 'inventario.$.quantidade': qtd } },
            { new: true }
          ).lean();
        } else {
          carteira = await CarteiraGrupo.findOneAndUpdate(
            { idWhatsApp, idGrupo },
            { $push: { inventario: { nome: nomeItem, quantidade: qtd } } },
            { new: true, upsert: true }
          ).lean();
        }
      } else {
        carteira = await CarteiraGrupo.findOneAndUpdate(
          { idWhatsApp, idGrupo },
          { $inc: { [`inventario.${nomeItem}`]: qtd } },
          { new: true, upsert: true }
        ).lean();
      }

      return res.json({ ok: true, inventario: carteira?.inventario });
    } else {
      const jidNorm = normalizarJid(termoOriginal);
      const variantesPn = gerarVariantesNumero(termoOriginal.split('@')[0]).map(d => `${d}@s.whatsapp.net`);
      const lidMap = await LidMapping.findOne({ $or: [{ pn: { $in: variantesPn } }, { lid: jidNorm }] }).lean();
      const jidsBusca = [...new Set([jidNorm, ...(lidMap ? [lidMap.lid, lidMap.pn] : []), ...variantesPn].filter(Boolean))];

      const u = await Usuario.findOneAndUpdate(
        { idWhatsApp: { $in: jidsBusca } },
        { $inc: { [`inventory.${nomeItem}`]: qtd } },
        { new: true }
      ).lean();

      return res.json({ ok: true, inventory: mapParaObjeto(u?.inventory ?? {}) });
    }
  } catch (err) {
    console.error('[API] POST /admin/usuario/inventario:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/usuario/:idWhatsApp/inventario
// Remove um item do inventário do usuário em um grupo ou globalmente.
// Body: { idGrupo, item }
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/admin/usuario/:idWhatsApp/inventario', adminAuth, async (req, res) => {
  try {
    const termoOriginal     = decodeURIComponent(req.params.idWhatsApp);
    const { idGrupo, item } = req.body || {};

    if (!item || typeof item !== 'string' || !item.trim())
      return res.status(400).json({ error: 'item deve ser uma string não vazia.' });

    const nomeItem = item.trim();
    const eGlobal  = !idGrupo || idGrupo === 'global';

    if (!eGlobal) {
      const idWhatsApp    = await resolverIdWhatsApp(termoOriginal, idGrupo);
      const carteiraAtual = await CarteiraGrupo.findOne({ idWhatsApp, idGrupo })
        .select('inventario')
        .lean();

      const invAtual = carteiraAtual?.inventario;
      const ehArray  = Array.isArray(invAtual);

      let carteira;
      if (ehArray) {
        carteira = await CarteiraGrupo.findOneAndUpdate(
          { idWhatsApp, idGrupo },
          { $pull: { inventario: { nome: nomeItem } } },
          { new: true }
        ).lean();
      } else {
        carteira = await CarteiraGrupo.findOneAndUpdate(
          { idWhatsApp, idGrupo },
          { $unset: { [`inventario.${nomeItem}`]: '' } },
          { new: true }
        ).lean();
      }

      return res.json({ ok: true, inventario: carteira?.inventario });
    } else {
      const jidNorm = normalizarJid(termoOriginal);
      const variantesPn = gerarVariantesNumero(termoOriginal.split('@')[0]).map(d => `${d}@s.whatsapp.net`);
      const lidMap = await LidMapping.findOne({ $or: [{ pn: { $in: variantesPn } }, { lid: jidNorm }] }).lean();
      const jidsBusca = [...new Set([jidNorm, ...(lidMap ? [lidMap.lid, lidMap.pn] : []), ...variantesPn].filter(Boolean))];

      const u = await Usuario.findOneAndUpdate(
        { idWhatsApp: { $in: jidsBusca } },
        { $unset: { [`inventory.${nomeItem}`]: '' } },
        { new: true }
      ).lean();

      return res.json({ ok: true, inventory: mapParaObjeto(u?.inventory ?? {}) });
    }
  } catch (err) {
    console.error('[API] DELETE /admin/usuario/inventario:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/cadastrar
// Cria usuário e senha para acesso ao painel.
// Body: { idWhatsApp, username, password }
// O idWhatsApp deve ser de alguém que já existe no banco (membro ativo).
// ─────────────────────────────────────────────────────────────────────────────
const bcrypt = require('bcryptjs');
const OtpCadastro = require('../models/OtpCadastro');
const { hashOtpCode, consumeOtp } = require('../utils/otp');

// Limites de autenticação. Os limites por IP complementam a limitação por código OTP.
const rateLimitCadastro = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: req => ipKeyGenerator(req.ip || '0.0.0.0'),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Muitas tentativas de cadastro. Tente novamente em 1 hora.' }),
});
const rateLimitRecuperacao = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: req => ipKeyGenerator(req.ip || '0.0.0.0'),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Muitas tentativas de recuperação. Aguarde 15 minutos.' }),
});
const rateLimitLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: req => ipKeyGenerator(req.ip || '0.0.0.0'),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).json({ error: 'Muitas tentativas de login. Aguarde 15 minutos.' }),
});
// Also rate-limit failed login attempts by identifier, not only by IP. This makes
// simple IP rotation less useful for guessing one account's password. The key is
// a one-way digest so usernames/emails/phone numbers are not kept in the limiter map.
const rateLimitLoginIdentificador = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: req => {
    const identificador = String(req.body?.identifier ?? req.body?.username ?? '').trim().toLowerCase();
    return identificador
      ? `login:${crypto.createHash('sha256').update(identificador).digest('hex')}`
      : ipKeyGenerator(req.ip || '0.0.0.0');
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).json({
    error: 'Muitas tentativas para esta identificação. Aguarde 15 minutos antes de tentar novamente.'
  }),
});

const rateLimitOtp = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  keyGenerator: req => ipKeyGenerator(req.ip || '0.0.0.0'),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Muitas solicitações de código. Aguarde 5 minutos.' }),
});
const rateLimitResetPassword = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: req => ipKeyGenerator(req.ip || '0.0.0.0'),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).json({ error: 'Muitas tentativas de alteração de senha. Aguarde 15 minutos.' }),
});

const OTP_RESPOSTA_GENERICA = {
  ok: true,
  message: 'Se o número estiver associado a um perfil elegível, você receberá um código no WhatsApp privado.',
};
const OTP_ERRO_GENERICO = 'Código inválido ou expirado, ou dados não conferem. Solicite um novo código e tente novamente.';

function parseNumeroWhatsApp(valor) {
  if (typeof valor !== 'string') return null;
  let parte = valor.trim();
  if (parte.toLowerCase().endsWith('@s.whatsapp.net')) {
    parte = parte.slice(0, -'@s.whatsapp.net'.length);
  }
  if (!/^\+?[\d\s().-]+$/.test(parte)) return null;
  const digitos = parte.replace(/\D/g, '');
  return digitos.length >= 8 && digitos.length <= 15 ? digitos : null;
}

async function encontrarUsuarioPorNumero(digitosBase) {
  const variantes = gerarVariantesNumero(digitosBase);
  const variantesPn = variantes.map(numero => `${numero}@s.whatsapp.net`);
  const [lidMap, usuariosPn] = await Promise.all([
    LidMapping.findOne({ pn: { $in: variantesPn } }).select('lid pn').lean(),
    Usuario.find({ idWhatsApp: { $in: variantesPn } })
      .select('idWhatsApp username passwordHash telefone tokenVersion')
      .lean(),
  ]);
  const usuarioLid = lidMap?.lid
    ? await Usuario.findOne({ idWhatsApp: String(lidMap.lid).trim().toLowerCase() })
      .select('idWhatsApp username passwordHash telefone tokenVersion')
      .lean()
    : null;

  // PN/LID duplicates can exist in legacy data. Prefer the existing account record
  // with credentials before falling back to a blank identity document, otherwise a
  // duplicate PN row could accidentally shadow a LID account during registration/reset.
  const candidatos = [...usuariosPn, usuarioLid].filter(Boolean);
  const usuarioComConta = candidatos.find(usuario => usuario.username && usuario.passwordHash);
  const pnCanonico = `${String(digitosBase).replace(/\D/g, '')}@s.whatsapp.net`;
  const usuarioPn = usuariosPn.find(usuario => usuario.idWhatsApp === pnCanonico) || usuariosPn[0] || null;
  const usuario = usuarioComConta || usuarioPn || usuarioLid || null;
  return { usuario, lidMap, variantesPn };
}

function idsOtpRelacionados(usuarioId, variantesPn, lidMap) {
  return [...new Set([usuarioId, ...(variantesPn || []), lidMap?.lid, lidMap?.pn]
    .filter(Boolean).map(value => String(value).trim().toLowerCase()))];
}

async function liberarOtpAposFalha(id) {
  if (!id) return;
  try {
    await OtpCadastro.updateOne(
      { _id: id, usado: true, expiresAt: { $gt: new Date() }, tentativas: { $lt: 5 } },
      { $set: { usado: false } },
    );
  } catch (err) {
    console.error('[API] Não foi possível liberar OTP após falha:', err.message);
  }
}

// POST /api/auth/otp/enviar
router.post('/auth/otp/enviar', rateLimitOtp, async (req, res) => {
  try {
    const digitosBase = parseNumeroWhatsApp(req.body?.idWhatsApp);
    if (!digitosBase) return res.status(400).json({ error: 'Número de WhatsApp inválido.' });

    // Verifica o estado do bot antes de consultar a conta, mantendo a mesma resposta
    // para números existentes e inexistentes quando o serviço não pode enviar mensagens.
    const { sock: botSock } = require('../bot');
    if (!botSock) return res.status(503).json({ error: 'Serviço de mensagens indisponível. Tente novamente mais tarde.' });

    const { usuario, lidMap, variantesPn } = await encontrarUsuarioPorNumero(digitosBase);
    if (!usuario || (usuario.username && usuario.passwordHash)) {
      return res.status(202).json(OTP_RESPOSTA_GENERICA);
    }

    const agora = new Date();
    const otpAtual = await OtpCadastro.findOne({
      idWhatsApp: usuario.idWhatsApp,
      finalidade: 'cadastro',
      usado: false,
      expiresAt: { $gt: agora },
    }).select('updatedAt').lean();
    if (otpAtual?.updatedAt && agora.getTime() - new Date(otpAtual.updatedAt).getTime() < 5 * 60 * 1000) {
      return res.status(202).json(OTP_RESPOSTA_GENERICA);
    }

    const codigo = String(crypto.randomInt(100000, 1000000));
    const codigoHash = hashOtpCode(codigo);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const idsRelacionados = idsOtpRelacionados(usuario.idWhatsApp, variantesPn, lidMap);

    // Invalida todos os códigos antigos PN/LID e mantém apenas um OTP canônico por conta.
    await OtpCadastro.updateMany(
      { idWhatsApp: { $in: idsRelacionados }, usado: false },
      { $set: { usado: true } },
    );
    await OtpCadastro.findOneAndUpdate(
      { idWhatsApp: usuario.idWhatsApp },
      { $set: { codigo: codigoHash, finalidade: 'cadastro', expiresAt, usado: false, tentativas: 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const jidDestino = (lidMap?.pn || (String(usuario.idWhatsApp).endsWith('@s.whatsapp.net') ? usuario.idWhatsApp : `${digitosBase}@s.whatsapp.net`)).split(':')[0];
    try {
      await botSock.sendMessage(jidDestino, {
        text: `🔐 *Tico Bot — Verificação de Conta*\n\nSeu código é:\n\n*${codigo}*\n\n⏰ Válido por 10 minutos. Não compartilhe com ninguém.`,
      });
    } catch (sendError) {
      await OtpCadastro.updateOne(
        { idWhatsApp: usuario.idWhatsApp, codigo: codigoHash, usado: false },
        { $set: { usado: true } },
      );
      console.warn('[API] Não foi possível entregar OTP no privado:', sendError.message);
      return res.status(202).json(OTP_RESPOSTA_GENERICA);
    }

    return res.status(202).json(OTP_RESPOSTA_GENERICA);
  } catch (err) {
    console.error('[API] POST /auth/otp/enviar:', err);
    return res.status(500).json({ error: 'Não foi possível processar a solicitação de código.' });
  }
});

// POST /api/auth/cadastrar
router.post('/auth/cadastrar', rateLimitCadastro, async (req, res) => {
  let otpCadastroClaimId = null;
  try {
    const { idWhatsApp, username, password, codigo, email } = req.body || {};
    if (typeof idWhatsApp !== 'string' || typeof username !== 'string'
        || typeof password !== 'string' || typeof codigo !== 'string'
        || typeof email !== 'string') {
      return res.status(400).json({ error: 'WhatsApp, usuário, senha, email e código de verificação são obrigatórios.' });
    }

    const digitosBase = parseNumeroWhatsApp(idWhatsApp);
    const usernameLimpo = username.trim().toLowerCase();
    const passwordLimpa = password;
    const emailLimpo = email.trim().toLowerCase();
    if (!digitosBase) return res.status(400).json({ error: 'Número de WhatsApp inválido.' });
    if (usernameLimpo.length < 3 || usernameLimpo.length > 30)
      return res.status(400).json({ error: 'Usuário deve ter entre 3 e 30 caracteres.' });
    if (!/^[a-z0-9_]+$/.test(usernameLimpo))
      return res.status(400).json({ error: 'Usuário só pode conter letras, números e _.' });
    if (passwordLimpa.length < 10 || passwordLimpa.length > 128 || Buffer.byteLength(passwordLimpa, 'utf8') > 72)
      return res.status(400).json({ error: 'A senha deve ter pelo menos 10 caracteres e no máximo 72 bytes em UTF-8.' });
    if (emailLimpo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailLimpo))
      return res.status(400).json({ error: 'Digite um email válido.' });
    if (!/^\d{6}$/.test(codigo.trim()))
      return res.status(400).json({ error: OTP_ERRO_GENERICO });

    const { usuario, lidMap, variantesPn } = await encontrarUsuarioPorNumero(digitosBase);
    if (!usuario) return res.status(400).json({ error: OTP_ERRO_GENERICO });

    // O OTP só é verificado/consumido depois de validar os campos de entrada; nunca
    // se consulta disponibilidade de conta, username ou email sem prova de posse do WhatsApp.
    const otpCadastro = await consumeOtp(OtpCadastro, usuario.idWhatsApp, codigo.trim(), 'cadastro');
    if (!otpCadastro) return res.status(400).json({ error: OTP_ERRO_GENERICO });
    otpCadastroClaimId = otpCadastro._id;

    if (usuario.username && usuario.passwordHash) {
      await liberarOtpAposFalha(otpCadastroClaimId);
      otpCadastroClaimId = null;
      return res.status(409).json({ error: 'Este perfil já possui uma conta. Entre pela tela de login.' });
    }

    const usernameEmUso = await Usuario.exists({ username: usernameLimpo });
    if (usernameEmUso) {
      await liberarOtpAposFalha(otpCadastroClaimId);
      otpCadastroClaimId = null;
      return res.status(409).json({ error: 'Este nome de usuário já está em uso.' });
    }
    const emailEmUso = await Usuario.exists({ email: emailLimpo });
    if (emailEmUso) {
      await liberarOtpAposFalha(otpCadastroClaimId);
      otpCadastroClaimId = null;
      return res.status(409).json({ error: 'Este email já está sendo usado por outra conta.' });
    }

    const passwordHash = await bcrypt.hash(passwordLimpa, 12);
    const atualizada = await Usuario.findOneAndUpdate(
      {
        idWhatsApp: usuario.idWhatsApp,
        $and: [
          { $or: [{ username: { $exists: false } }, { username: null }] },
          { $or: [{ passwordHash: { $exists: false } }, { passwordHash: null }] },
        ],
      },
      { $set: { username: usernameLimpo, passwordHash, telefone: digitosBase, email: emailLimpo } },
      { new: true, runValidators: true },
    ).select('idWhatsApp').lean();

    if (!atualizada) {
      await liberarOtpAposFalha(otpCadastroClaimId);
      otpCadastroClaimId = null;
      return res.status(409).json({ error: 'Não foi possível concluir o cadastro. Tente entrar ou solicite um novo código.' });
    }

    otpCadastroClaimId = null;
    return res.json({ ok: true, message: 'Conta criada com sucesso! Faça login para acessar o painel.' });
  } catch (err) {
    if (otpCadastroClaimId) await liberarOtpAposFalha(otpCadastroClaimId);
    if (err?.code === 11000) {
      const campo = Object.keys(err.keyPattern || {})[0];
      const mensagem = campo === 'email' ? 'Este email já está sendo usado por outra conta.' : 'Este nome de usuário já está em uso.';
      return res.status(409).json({ error: mensagem });
    }
    console.error('[API] POST /auth/cadastrar:', err);
    return res.status(500).json({ error: 'Erro interno ao criar conta.' });
  }
});

// POST /api/auth/login — aceita nome de usuário, email ou telefone.
const DUMMY_PASSWORD_HASH = '$2b$12$/4C5HRX7b/TVqpPzstGPw.wUkn2e0b9OV6Mq3PK2.7M6cch4DWKw.';
router.post('/auth/login', rateLimitLogin, rateLimitLoginIdentificador, async (req, res) => {
  try {
    const { identifier, username, password } = req.body || {};
    const identifierRaw = typeof identifier === 'string' ? identifier : username;
    if (typeof identifierRaw !== 'string' || !identifierRaw.trim()
        || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Email, telefone ou nome de usuário e senha são obrigatórios.' });
    }
    if (identifierRaw.length > 254 || password.length > 128) {
      return res.status(400).json({ error: 'Credenciais inválidas.' });
    }

    const identificador = identifierRaw.trim().toLowerCase();
    const candidatos = [{ username: identificador }, { email: identificador }];
    const digitos = identificador.replace(/\D/g, '');
    const pareceTelefone = /^[+\d\s().-]+$/.test(identifierRaw.trim())
      && digitos.length >= 8 && digitos.length <= 15;
    if (pareceTelefone) {
      const variantes = gerarVariantesNumero(digitos);
      const variantesPn = variantes.map(numero => `${numero}@s.whatsapp.net`);
      candidatos.push({ telefone: { $in: variantes } }, { idWhatsApp: { $in: variantesPn } });
      const lidMap = await LidMapping.findOne({ pn: { $in: variantesPn } }).select('lid').lean();
      if (lidMap?.lid) candidatos.push({ idWhatsApp: lidMap.lid });
    }

    const usuario = await Usuario.findOne({ $or: candidatos }).lean();
    const hash = usuario?.passwordHash || DUMMY_PASSWORD_HASH;
    const senhaCorreta = await bcrypt.compare(password, hash);
    if (!usuario || !usuario.passwordHash || !senhaCorreta) {
      return res.status(401).json({ error: 'Email, telefone, nome de usuário ou senha incorretos.' });
    }

    const sessionJwt = jwt.sign(
      { idWhatsApp: usuario.idWhatsApp, telefone: usuario.telefone, tokenVersion: Number(usuario.tokenVersion || 0) },
      getJwtSecret(),
      { expiresIn: '24h' },
    );
    return res.json({ jwt: sessionJwt });
  } catch (err) {
    console.error('[API] POST /auth/login:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/auth/recuperar — valida o OTP canônico e o consome uma única vez.
router.post('/auth/recuperar', rateLimitRecuperacao, async (req, res) => {
  let otpClaimId = null;
  try {
    const { idWhatsApp, codigo, novaSenha } = req.body || {};
    const digitosBase = parseNumeroWhatsApp(typeof idWhatsApp === 'string' ? idWhatsApp : '');
    if (!digitosBase || typeof codigo !== 'string' || !/^\d{6}$/.test(codigo.trim())
        || typeof novaSenha !== 'string' || novaSenha.length < 10 || novaSenha.length > 128
        || Buffer.byteLength(novaSenha, 'utf8') > 72) {
      return res.status(400).json({ error: OTP_ERRO_GENERICO });
    }

    const { usuario } = await encontrarUsuarioPorNumero(digitosBase);
    if (!usuario) return res.status(400).json({ error: OTP_ERRO_GENERICO });

    const otpValido = await consumeOtp(OtpCadastro, usuario.idWhatsApp, codigo.trim(), 'recuperacao');
    if (!otpValido) return res.status(400).json({ error: OTP_ERRO_GENERICO });
    otpClaimId = otpValido._id;

    const passwordHash = await bcrypt.hash(novaSenha, 12);
    const atualizado = await Usuario.findOneAndUpdate(
      { idWhatsApp: usuario.idWhatsApp },
      { $set: { passwordHash, telefone: usuario.telefone || digitosBase }, $inc: { tokenVersion: 1 } },
      { new: true, runValidators: true },
    ).select('idWhatsApp').lean();
    if (!atualizado) throw new Error('Usuário desapareceu durante redefinição de senha.');

    otpClaimId = null;
    return res.json({ ok: true, message: 'Senha redefinida com sucesso! Faça login com a nova senha.' });
  } catch (err) {
    if (otpClaimId) await liberarOtpAposFalha(otpClaimId);
    console.error('[API] POST /auth/recuperar:', err);
    return res.status(500).json({ error: 'Erro interno ao redefinir senha.' });
  }
});

// POST /api/auth/resetsenha
// Reseta a senha do usuário — ele precisa estar autenticado via JWT.
// Body: { senhaAtual, novaSenha }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/resetsenha', auth, rateLimitResetPassword, async (req, res) => {
  if (req.user.tokenType === 'profile') return res.status(403).json({ error: 'Entre com usuário/email e senha para alterar sua senha.' });
  try {
    const { senhaAtual, novaSenha } = req.body || {};
    const idWhatsApp = req.user.idWhatsApp;

    if (typeof senhaAtual !== 'string' || !senhaAtual || typeof novaSenha !== 'string')
      return res.status(400).json({ error: 'senhaAtual e novaSenha são obrigatórios.' });
    if (novaSenha.length < 10 || novaSenha.length > 128 || Buffer.byteLength(novaSenha, 'utf8') > 72)
      return res.status(400).json({ error: 'A nova senha deve ter pelo menos 10 caracteres e no máximo 72 bytes em UTF-8.' });

    const usuario = await Usuario.findOne({ idWhatsApp }).lean();
    if (!usuario || !usuario.passwordHash)
      return res.status(404).json({ error: 'Conta não encontrada.' });

    const senhaCorreta = await bcrypt.compare(senhaAtual, usuario.passwordHash);
    if (!senhaCorreta)
      return res.status(401).json({ error: 'Senha atual incorreta.' });

    const novoHash = await bcrypt.hash(novaSenha, 12);
    await Usuario.findOneAndUpdate({ idWhatsApp }, { $set: { passwordHash: novoHash }, $inc: { tokenVersion: 1 } });

    return res.json({ ok: true, message: 'Senha alterada com sucesso!' });

  } catch (err) {
    console.error('[API] POST /auth/resetsenha:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/grupo/:jid/remover-membro
// Remove um membro de um grupo via bot.
// Body: { idWhatsApp }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/grupo/:jid/remover-membro', adminAuth, async (req, res) => {
  try {
    const jid        = decodeURIComponent(req.params.jid);
    const { idWhatsApp } = req.body || {};

    if (!jid || jid.length > 200)
      return res.status(400).json({ error: 'JID inválido.' });
    if (!idWhatsApp)
      return res.status(400).json({ error: 'idWhatsApp é obrigatório.' });

    const { sock: botSock } = require('../bot');
    if (!botSock)
      return res.status(503).json({ error: 'Bot não conectado.' });

    await botSock.groupParticipantsUpdate(jid, [idWhatsApp], 'remove');

    return res.json({ ok: true });
  } catch (err) {
    console.error('[API] POST /admin/grupo/remover-membro:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/grupos/sincronizar
// Força a sincronização e limpeza de grupos inativos ou antigos.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/grupos/sincronizar', adminAuth, async (req, res) => {
  try {
    const { rodarAtualizacao } = require('../scripts/atualizarGrupos');
    const { getBotSock }       = require('../bot');
    const sock = getBotSock ? getBotSock() : null;

    if (sock) {
      await rodarAtualizacao(sock);
      return res.json({ ok: true, mensagem: 'Sincronização e limpeza executadas com sucesso via WhatsApp.' });
    } else {
      const CarteiraGrupoModel = require('../models/CarteiraGrupo');
      const GrupoConfigModel   = require('../models/GrupoConfig');
      const resCarteira = await CarteiraGrupoModel.deleteMany({ idGrupo: { $not: /@g\.us$/ } });
      const resConfig   = await GrupoConfigModel.deleteMany({ idGrupo: { $not: /@g\.us$/ } });
      return res.json({
        ok: true,
        mensagem: 'Socket offline. Limpeza de JIDs inválidos concluída no MongoDB.',
        carteirasRemovidas: resCarteira.deletedCount,
        configsRemovidas: resConfig.deletedCount,
      });
    }
  } catch (err) {
    console.error('[API] POST /admin/grupos/sincronizar:', err);
    return res.status(500).json({ error: 'Erro ao sincronizar grupos: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/broadcast
// Envia mensagem para todos os grupos ativos.
// Body: { mensagem }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/broadcast', adminAuth, async (req, res) => {
  try {
    const { mensagem } = req.body || {};
    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim())
      return res.status(400).json({ error: 'mensagem é obrigatória.' });
    if (mensagem.length > 4000)
      return res.status(400).json({ error: 'Mensagem muito longa (máx 4000 caracteres).' });

    const { sock: botSock } = require('../bot');
    if (!botSock)
      return res.status(503).json({ error: 'Bot não conectado.' });

    const grupos = await CarteiraGrupo.distinct('idGrupo');
    let enviados = 0, falhas = 0;

    for (const jid of grupos) {
      try {
        await botSock.sendMessage(jid, { text: mensagem.trim() });
        enviados++;
        await new Promise(r => setTimeout(r, 500));
      } catch { falhas++; }
    }

    return res.json({ ok: true, enviados, falhas });
  } catch (err) {
    console.error('[API] POST /admin/broadcast:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/grupo/:jid/export
// Exporta todos os dados de um grupo em JSON.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/grupo/:jid/export', adminAuth, async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    if (!jid || jid.length > 200) return res.status(400).json({ error: 'JID inválido.' });

    const membros = await CarteiraGrupo.find({ idGrupo: jid }).lean();
    if (!membros.length) return res.status(404).json({ error: 'Nenhum dado encontrado para esse grupo.' });

    const jids = membros.map(m => m.idWhatsApp);
    const usuarios = await Usuario.find({ idWhatsApp: { $in: jids } })
      .select('idWhatsApp nome telefone warnings banido')
      .lean();
    const usuariosMap = Object.fromEntries(usuarios.map(u => [u.idWhatsApp, u]));

    const dados = membros.map(m => {
      const u = usuariosMap[m.idWhatsApp] || {};
      return {
        idWhatsApp:   m.idWhatsApp,
        nome:         u.nome || m.nome || '—',
        telefone:     u.telefone || m.idWhatsApp.split('@')[0],
        xp:           m.xp       ?? 0,
        level:        m.level    ?? 1,
        gold:         m.gold     ?? 0,
        mensagens:    m.mensagens ?? 0,
        empregoAtual: m.empregoAtual ?? null,
        banido:       !!u.banido,
      };
    });

    return res.json({
      idGrupo:     jid,
      exportadoEm: new Date(),
      totalMembros: dados.length,
      membros:      dados,
    });
  } catch (err) {
    console.error('[API] GET /admin/grupo/:jid/export:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/relacionamentos
// Lista todos os relacionamentos ativos (casadoCom no Usuario).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/relacionamentos', adminAuth, async (req, res) => {
  try {
    const comRelacionamento = await Usuario.find({
      casadoCom: { $exists: true, $ne: null, $ne: '' }
    }).select('idWhatsApp nome telefone casadoCom casadoTipo casadoDesde casadoGrupo').lean();

    // Resolve @lid para pn via LidMapping
    const lids = comRelacionamento.map(u => u.idWhatsApp).filter(j => j?.endsWith('@lid'));
    const lidMaps = lids.length ? await LidMapping.find({ lid: { $in: lids } }).lean() : [];
    const lidParaPn = Object.fromEntries(lidMaps.map(m => [m.lid, m.pn]));
    const pnParaLid = Object.fromEntries(lidMaps.map(m => [m.pn, m.lid]));

    // Índice por JID E por PN equivalente
    const porJid = new Map();
    for (const u of comRelacionamento) {
      porJid.set(u.idWhatsApp, u);
      const pn = lidParaPn[u.idWhatsApp];
      if (pn) porJid.set(pn, u);
    }

    // Detecta e limpa fantasmas
    const fantasmas = comRelacionamento.filter(u => {
      const parceiro = porJid.get(u.casadoCom);
      if (!parceiro) return true;
      const casadoComParceiro = parceiro.casadoCom;
      const lidEquivalente = pnParaLid[u.idWhatsApp] || lidParaPn[u.idWhatsApp];
      return casadoComParceiro !== u.idWhatsApp && casadoComParceiro !== lidEquivalente;
    });

    if (fantasmas.length) {
      const jidsFantasma = fantasmas.map(u => u.idWhatsApp);
      await Usuario.updateMany(
        { idWhatsApp: { $in: jidsFantasma } },
        { $unset: { casadoCom: '', casadoTipo: '', casadoDesde: '' } }
      );
      console.log(`[Admin] Limpou ${fantasmas.length} relacionamento(s) fantasma(s).`);
    }

    // Só processa os válidos
    const validos = comRelacionamento.filter(u => {
      const parceiro = porJid.get(u.casadoCom);
      if (!parceiro) return false;
      const casadoComParceiro = parceiro.casadoCom;
      const lidEquivalente = pnParaLid[u.idWhatsApp] || lidParaPn[u.idWhatsApp];
      return casadoComParceiro === u.idWhatsApp || casadoComParceiro === lidEquivalente;
    });

    // Resolve nomes dos grupos
    const jidsGruposRel = [...new Set(comRelacionamento.map(u => u.casadoGrupo).filter(Boolean))];
    const nomesGruposRel = jidsGruposRel.length
      ? await CarteiraGrupo.aggregate([
          { $match: { idGrupo: { $in: jidsGruposRel } } },
          { $group: { _id: '$idGrupo', nomeCustom: { $max: '$nomeCustom' }, nomeGrupo: { $max: '$nomeGrupo' } } },
        ])
      : [];
    const nomesGruposRelMap = Object.fromEntries(
      nomesGruposRel.map(g => [g._id, nomeGrupo(g, g._id)])
    );

    // Resolve @lid → telefone real para todos os JIDs envolvidos
    const todosLidsRel = [...comRelacionamento.map(u => u.idWhatsApp), ...comRelacionamento.map(u => u.casadoCom)]
      .filter(j => j?.endsWith('@lid'));
    const lidMapsRel = todosLidsRel.length
      ? await LidMapping.find({ lid: { $in: todosLidsRel } }).lean()
      : [];
    const lidParaPnRel = Object.fromEntries(lidMapsRel.map(m => [m.lid, m.pn]));

    function telefoneExibicao(jid) {
      const pn = lidParaPnRel[jid] || jid;
      return pn.split('@')[0].replace(/\D/g, '');
    }

    // Deduplica pares (A-B e B-A viram um só)
    const vistos = new Set();
    const relacionamentos = [];

    for (const u of validos) {
      const jidA  = u.idWhatsApp;
      const jidB  = u.casadoCom;
      const chave = [jidA, jidB].sort().join('|');
      if (vistos.has(chave)) continue;
      vistos.add(chave);

      const parceiro = porJid.get(jidB) || {};
      const nomeA = u.nome || u.telefone || jidA.split('@')[0];
      const nomeB = parceiro.nome || parceiro.telefone || jidB?.split('@')[0] || '—';

      relacionamentos.push({
        jidA,
        jidB,
        nomeA,
        nomeB,
        telefoneA: telefoneExibicao(jidA),
        telefoneB: telefoneExibicao(jidB),
        tipo:      u.casadoTipo  || 'namoro',
        desde:     u.casadoDesde || null,
        idGrupo:   u.casadoGrupo || null,
        nomeGrupo: u.casadoGrupo
          ? (nomesGruposRelMap[u.casadoGrupo] || nomeGrupoFallback(u.casadoGrupo))
          : null,
        xp: 0,
      });
    }

    return res.json({ relacionamentos, fantasmasLimpos: fantasmas.length });
  } catch (err) {
    console.error('[API] GET /admin/relacionamentos:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/relacionamentos/encerrar
// Encerra um relacionamento entre dois usuários.
// Body: { jidA, jidB, idGrupo? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/relacionamentos/encerrar', adminAuth, async (req, res) => {
  try {
    const { jidA, jidB } = req.body || {};
    if (!jidA || !jidB) return res.status(400).json({ error: 'jidA e jidB são obrigatórios.' });

    await Usuario.updateMany(
      { idWhatsApp: { $in: [jidA, jidB] } },
      { $unset: { casadoCom: '', casadoTipo: '', casadoDesde: '' } }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('[API] POST /admin/relacionamentos/encerrar:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/pets
// Lista todos os pets ativos no banco.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/pets', adminAuth, async (req, res) => {
  try {
    const carteirasComPet = await CarteiraGrupo.find({
      'pet.name': { $exists: true, $nin: [null, ''] },
    }).select('idWhatsApp idGrupo pet nomeCustom nome').lean();

    if (!carteirasComPet.length) return res.json({ pets: [] });

    const jids = [...new Set(carteirasComPet.map(c => c.idWhatsApp))];
    const usuarios = await Usuario.find({ idWhatsApp: { $in: jids } })
      .select('idWhatsApp nome telefone')
      .lean();
    const usuariosMap = Object.fromEntries(usuarios.map(u => [u.idWhatsApp, u]));

    const jidsGrupos = [...new Set(carteirasComPet.map(c => c.idGrupo))];
    const nomesGrupos = await CarteiraGrupo.aggregate([
      { $match: { idGrupo: { $in: jidsGrupos } } },
      { $group: { _id: '$idGrupo', nomeCustom: { $max: '$nomeCustom' }, nomeGrupo: { $max: '$nomeGrupo' } } },
    ]);
    const nomesGruposMap = Object.fromEntries(
      nomesGrupos.map(g => [g._id, nomeGrupo(g, g._id)])
    );

    const pets = carteirasComPet.map(c => {
      const u = usuariosMap[c.idWhatsApp] || {};
      return {
        idDono:    c.idWhatsApp,
        nomeDono:  u.nome || u.telefone || c.idWhatsApp.split('@')[0],
        nome:      c.pet.name,
        tipo:      c.pet.type    || '?',
        rarity:    c.pet.rarity  || '?',
        hp:        c.pet.energy  ?? 100,
        maxHp:     100,
        fome:      c.pet.fullness ?? 0,
        nivel:     c.pet.level   ?? 1,
        xp:        c.pet.xp      ?? 0,
        happiness: c.pet.happiness ?? 0,
        idGrupo:   c.idGrupo,
        nomeGrupo: nomesGruposMap[c.idGrupo] || nomeGrupoFallback(c.idGrupo),
      };
    });

    return res.json({ pets });
  } catch (err) {
    console.error('[API] GET /admin/pets:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/pets/curar
// Restaura HP do pet ao máximo.
// Body: { idDono, idGrupo? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/pets/curar', adminAuth, async (req, res) => {
  try {
    const { idDono, idGrupo } = req.body || {};
    if (!idDono)  return res.status(400).json({ error: 'idDono é obrigatório.' });
    if (!idGrupo) return res.status(400).json({ error: 'idGrupo é obrigatório.' });

    const carteira = await CarteiraGrupo.findOne({ idWhatsApp: idDono, idGrupo });
    if (!carteira?.pet?.name) return res.status(404).json({ error: 'Pet não encontrado.' });

    carteira.pet.energy    = 100;
    carteira.pet.happiness = Math.min(100, (carteira.pet.happiness ?? 0) + 20);
    await carteira.save();

    return res.json({ ok: true, energy: carteira.pet.energy });
  } catch (err) {
    console.error('[API] POST /admin/pets/curar:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/pets/alimentar
// Zera a fome do pet.
// Body: { idDono, idGrupo? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/pets/alimentar', adminAuth, async (req, res) => {
  try {
    const { idDono, idGrupo } = req.body || {};
    if (!idDono)  return res.status(400).json({ error: 'idDono é obrigatório.' });
    if (!idGrupo) return res.status(400).json({ error: 'idGrupo é obrigatório.' });

    const carteira = await CarteiraGrupo.findOne({ idWhatsApp: idDono, idGrupo });
    if (!carteira?.pet?.name) return res.status(404).json({ error: 'Pet não encontrado.' });

    carteira.pet.fullness  = 100;
    carteira.pet.happiness = Math.min(100, (carteira.pet.happiness ?? 0) + 10);
    await carteira.save();

    return res.json({ ok: true, fullness: carteira.pet.fullness });
  } catch (err) {
    console.error('[API] POST /admin/pets/alimentar:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/telefone/:idWhatsApp
// Resolve @lid → telefone real via LidMapping.
// Rota pública — não expõe dados sensíveis além do número formatado.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/user/telefone/:idWhatsApp', auth, async (req, res) => {
  try {
    const idRaw = decodeURIComponent(req.params.idWhatsApp || '').trim().toLowerCase();
    const idProprio = String(req.user.idWhatsApp || '').trim().toLowerCase();
    if (!idProprio || idRaw !== idProprio) {
      return res.status(403).json({ error: 'Por privacidade, só é possível consultar o seu próprio número.' });
    }

    // Somente após a verificação de propriedade, resolve o número do próprio usuário.
    if (!idRaw.endsWith('@lid')) {
      const numero = idRaw.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      return res.json({ telefone: numero || null });
    }

    // Tenta resolver via LidMapping
    const mapa = await LidMapping.findOne({ lid: idRaw }).lean();
    if (!mapa?.pn) return res.json({ telefone: null });

    const numero = mapa.pn.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    return res.json({ telefone: numero || null });

  } catch (err) {
    console.error('[API] GET /user/telefone/:idWhatsApp:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/contas
// Lista todos os usuários com conta cadastrada (username + email + telefone).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/contas', adminAuth, contasAuth, async (req, res) => {
  try {
    const contas = await Usuario.find({
      username: { $exists: true, $ne: null },
    })
      .select('idWhatsApp nome telefone username email createdAt')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ contas });
  } catch (err) {
    console.error('[API] GET /admin/contas:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/auth/conta
// Apaga os dados de conta do usuário (mantém dados do jogo).
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/auth/conta', auth, async (req, res) => {
  if (req.user.tokenType === 'profile') return res.status(403).json({ error: 'Entre com usuário/email e senha para apagar a conta.' });
  try {
    const idWhatsApp = req.user.idWhatsApp;

    await Usuario.findOneAndUpdate(
      { idWhatsApp },
      { $unset: { username: '', passwordHash: '', email: '' }, $inc: { tokenVersion: 1 } }
    );

    const numero = String(idWhatsApp).split('@')[0].replace(/\D/g, '');
    const variantesPn = gerarVariantesNumero(numero).map(n => `${n}@s.whatsapp.net`);
    const mapas = await LidMapping.find({ $or: [{ lid: idWhatsApp }, { pn: { $in: variantesPn } }] }).select('lid').lean();
    const idsOtp = [...new Set([idWhatsApp, ...variantesPn, ...mapas.map(m => m.lid)].filter(Boolean))];
    await OtpCadastro.deleteMany({ idWhatsApp: { $in: idsOtp } });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[API] DELETE /auth/conta:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── OBRIGATÓRIO: Mantém a exportação do router como a última linha ───────────
module.exports = router;