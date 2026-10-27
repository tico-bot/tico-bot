'use strict';

const crypto        = require('crypto');
const express       = require('express');
const jwt           = require('jsonwebtoken');
const router        = express.Router();
const AuthToken     = require('../models/AuthToken');
const Usuario       = require('../models/Usuario');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const LidMapping    = require('../models/LidMapping');
const { getCarteira, alterarGold, transferirGold, formatarSaldo } = require('../utils/carteira');
const rateLimit      = require('express-rate-limit');

const { ipKeyGenerator } = require('express-rate-limit');

// Helpers usados pelas rotas públicas de ranking e grupos.
// Mantêm a fórmula de nível igual à usada no site.
function calcularLevel(xp = 0) {
  const valor = Math.max(0, Number(xp) || 0);
  return Math.max(1, Math.floor(Math.pow(valor / 100, 1 / 1.5)) + 1);
}

function nomeGrupo(grupo = {}, jid = '') {
  const nome = grupo.nomeCustom || grupo.nomeGrupo;
  if (typeof nome === 'string' && nome.trim()) return nome.trim();
  return String(jid).split('@')[0] || 'Grupo sem nome';
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
if (!ADMIN_KEY) console.warn('⚠️  ADMIN_KEY não definida — rotas /admin/* vão recusar acesso.');

// ─── MIDDLEWARE: JWT de sessão ────────────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente.' });
  try {
    req.user = jwt.verify(token, getJwtSecret());
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

// ─── MIDDLEWARE: chave de admin ───────────────────────────────────────────────
function adminAuth(req, res, next) {
  const chave = req.headers['x-admin-key'];
  if (!ADMIN_KEY || !chave) return res.status(401).json({ error: 'Chave de admin inválida.' });
  const a = Buffer.from(String(chave));
  const b = Buffer.from(String(ADMIN_KEY));
  const valido = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valido) return res.status(401).json({ error: 'Chave de admin inválida.' });
  next();
}

// ─── CORS ────────────────────────────────────────────────────────────────────
router.use(require('../utils/cors').corsMiddleware);

// ─── RATE LIMIT de login admin ────────────────────────────────────────────────
const LOGIN_MAX       = 10;
const LOGIN_JANELA_MS = 15 * 60 * 1000;

const rateLimitAdmin = rateLimit({
  windowMs:     LOGIN_JANELA_MS,
  max:          LOGIN_MAX,
  keyGenerator: (req) => ipKeyGenerator(req) ?? 'desconhecido',
  handler: (req, res) => {
    return res.status(429).json({
      error: 'Muitas tentativas. Tente novamente mais tarde.'
    });
  },
});

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

    const sessionJwt = jwt.sign(
      { telefone: registro.telefone, idWhatsApp: registro.idWhatsApp },
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

    const [agregados, totaisGlobais] = await Promise.all([
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
    ]);

    const jids = agregados.map(a => a._id);
    const lids = jids.filter(j => j?.endsWith('@lid'));
    const lidMaps = lids.length ? await LidMapping.find({ lid: { $in: lids } }).lean() : [];
    const lidParaPn = Object.fromEntries(lidMaps.map(l => [l.lid, l.pn]));
    const pnsResolvidos = Object.values(lidParaPn);

    const todosJidsBusca = [...new Set([...jids, ...pnsResolvidos])];
    const usuarios = todosJidsBusca.length
      ? await Usuario.find({ idWhatsApp: { $in: todosJidsBusca } }).select('idWhatsApp nome telefone username').lean()
      : [];
    const usuariosMap = Object.fromEntries(usuarios.map(u => [u.idWhatsApp, u]));

    const carteirasNome = jids.length
      ? await CarteiraGrupo.find({ idWhatsApp: { $in: jids }, nome: { $exists: true, $ne: null } }).select('idWhatsApp nome').lean()
      : [];
    const pushNamesMap = Object.fromEntries(carteirasNome.map(c => [c.idWhatsApp, c.nome]));

    const ranking = agregados.map((a, i) => {
      const pn = lidParaPn[a._id];
      const u = usuariosMap[a._id] || (pn ? usuariosMap[pn] : {}) || {};
      const numRaw = (pn || a._id).split('@')[0].replace(/\D/g, '');
      const telFormatado = numRaw.length >= 8 ? `+${numRaw}` : null;
      const nomeFinal = u.nome || u.username || u.telefone || pushNamesMap[a._id] || telFormatado || 'Anônimo';

      return {
        idWhatsApp: a._id,
        nome:       nomeFinal,
        xp:         a.xp        ?? 0,
        gold:       a.gold      ?? 0,
        mensagens:  a.mensagens ?? 0,
        level:      calcularLevel(a.xp),
        posicao:    i + 1,
      };
    });

    const t = totaisGlobais[0] || {};

    return res.json({
      ranking,
      total:          t.totalUsuarios?.length || ranking.length,
      totalMensagens: t.totalMensagens || 0,
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

    const jidsUsuarios  = membros.map(m => m.idWhatsApp);
    const lids          = jidsUsuarios.filter(j => j?.endsWith('@lid'));
    const lidMaps       = lids.length ? await LidMapping.find({ lid: { $in: lids } }).lean() : [];
    const lidParaPn     = Object.fromEntries(lidMaps.map(l => [l.lid, l.pn]));
    const pnsResolvidos = Object.values(lidParaPn);

    const todosJidsBusca = [...new Set([...jidsUsuarios, ...pnsResolvidos])];
    const usuarios = todosJidsBusca.length
      ? await Usuario.find({ idWhatsApp: { $in: todosJidsBusca } }).select('idWhatsApp nome telefone username').lean()
      : [];
    const usuariosMap = Object.fromEntries(usuarios.map(u => [u.idWhatsApp, u]));

    const mapaDeduplicado = new Map();
    for (const m of membros) {
      const pn = lidParaPn[m.idWhatsApp] || (m.idWhatsApp.endsWith('@s.whatsapp.net') ? m.idWhatsApp : null);
      const chave = pn || m.idWhatsApp;

      const u = usuariosMap[m.idWhatsApp] || (pn ? usuariosMap[pn] : {}) || {};
      const numRaw = (pn || m.idWhatsApp).split('@')[0].replace(/\D/g, '');
      const telFormatado = numRaw.length >= 8 ? `+${numRaw}` : null;
      const nomeFinal = u.nome || u.username || u.telefone || m.nome || telFormatado || 'Anônimo';

      if (!mapaDeduplicado.has(chave)) {
        mapaDeduplicado.set(chave, {
          idWhatsApp: m.idWhatsApp,
          nome:       nomeFinal,
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

    const xpTotal        = carteirasGruposValidos.reduce((s, c) => s + (c.xp        ?? 0), 0);
    const goldTotal      = carteirasGruposValidos.reduce((s, c) => s + (c.gold      ?? 0), 0);
    const mensagensTotal = carteirasGruposValidos.reduce((s, c) => s + (c.mensagens ?? 0), 0);

    const levelGlobal = calcularLevel(xpTotal);

    const xpParaProximo = Math.ceil(80 * Math.pow(levelGlobal, 1.4));
    const xpInicioNivel = Math.ceil(80 * Math.pow(Math.max(0, levelGlobal - 1), 1.4));
    const xpNoNivel     = xpParaProximo - xpInicioNivel;
    const xpProgresso   = xpNoNivel > 0
      ? Math.min(100, Math.max(0, Math.floor(((xpTotal - xpInicioNivel) / xpNoNivel) * 100)))
      : 100;

    const posicaoResult = await CarteiraGrupo.aggregate([
      { $match: { idGrupo: { $regex: /@g\.us$/ } } },
      { $group: { _id: '$idWhatsApp', xpTotal: { $sum: '$xp' } } },
      { $match: { xpTotal: { $gt: xpTotal } } },
      { $count: 'acima' },
    ]);
    const posicaoRanking = (posicaoResult[0]?.acima ?? 0) + 1;

    const jidsGruposMe = carteirasGruposValidos.map(c => c.idGrupo);
    const nomesGruposMe = {};
    if (jidsGruposMe.length) {
      const docsNomes = await CarteiraGrupo.aggregate([
        { $match: { idGrupo: { $in: jidsGruposMe } } },
        { $group: {
          _id:        '$idGrupo',
          nomeCustom: { $first: { $ifNull: ['$nomeCustom', null] } },
          nomeReal:   { $first: { $ifNull: ['$nome', null] } },
        }},
      ]);
      for (const d of docsNomes) nomesGruposMe[d._id] = nomeGrupo(d, d._id);
    }

    const grupos = carteirasGruposValidos.map(c => ({
      jid:          c.idGrupo,
      nome:         nomesGruposMe[c.idGrupo] || nomeGrupoFallback(c.idGrupo),
      xp:           c.xp           ?? 0,
      level:        c.level        ?? 1,
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

    // xpHistory: soma o xpHistory de todas as carteiras do usuário
    const xpHistoryMerge = {};
    for (const c of carteirasGruposValidos) {
      const raw = mapParaObjeto(c.xpHistory ?? {});
      for (const [k, v] of Object.entries(raw)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(Number(v))) {
          xpHistoryMerge[k] = (xpHistoryMerge[k] ?? 0) + Number(v);
        }
      }
    }
    const xpHistoryLimpo = Object.keys(xpHistoryMerge).length > 0
      ? xpHistoryMerge
      : (() => {
          const raw = mapParaObjeto(usuario.xpHistory);
          const obj = {};
          for (const [k, v] of Object.entries(raw)) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(Number(v))) obj[k] = Number(v);
          }
          return obj;
        })();

    const nomeResolvido     = usuario.nome     || carteirasGruposValidos[0]?.nome || null;
    const telefoneResolvido = usuario.telefone || idWhatsApp.split('@')[0] || null;

    return res.json({
      nome:     nomeResolvido,
      telefone: telefoneResolvido,
      bio:      usuario.bio,

      xp:         xpTotal,
      level:      levelGlobal,
      gold:       goldTotal,
      mensagens:  mensagensTotal,
      quizPoints: usuario.quizPoints ?? 0,
      xpParaProximo,
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
          nomeCustom: { $first: { $ifNull: ['$nomeCustom', null] } },
          nomeReal:   { $first: { $ifNull: ['$nome',       null] } }, // campo real é "nome"
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
// ROTAS ADMIN (x-admin-key)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/verify
router.get('/admin/verify', rateLimitAdmin, adminAuth, (req, res) => {
  return res.json({ ok: true });
});

router.get('/admin/verify-contas', rateLimitAdmin, (req, res) => {
  const chave = req.headers['x-admin-key'];
  if (!chave || chave !== CONTAS_KEY) return res.status(401).json({ error: 'Chave inválida.' });
  return res.json({ ok: true });
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
          { $group: { _id: '$idGrupo', nomeCustom: { $first: '$nomeCustom' }, nomeReal: { $first: '$nome' } } }
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
  const pick = () => SLOTS_POOL[Math.floor(Math.random() * SLOTS_POOL.length)];
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
  keyGenerator: (req) => req.user?.idWhatsApp || ipKeyGenerator(req),
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
  try {
    const idWhatsApp = req.user.idWhatsApp;
    const { idGrupo, aposta } = req.body || {};

    // ── Validações ────────────────────────────────────────────────────────────
    if (!idGrupo)
      return res.status(400).json({ error: 'idGrupo é obrigatório.' });

    const valorAposta = parseInt(aposta, 10);
    if (!valorAposta || isNaN(valorAposta) || valorAposta <= 0)
      return res.status(400).json({ error: 'Aposta deve ser um número positivo.' });

    if (valorAposta > 100_000)
      return res.status(400).json({ error: `Aposta máxima: ${formatarSaldo(100_000)}.` });

    // ── Confirma que o usuário pertence ao grupo (resolve @lid se necessário) ─
    let idResolvido = idWhatsApp;
    let carteira = await CarteiraGrupo.findOne({ idWhatsApp: idResolvido, idGrupo });

    if (!carteira) {
      const variantesPn = gerarVariantesNumero(idWhatsApp.split('@')[0])
        .map(d => `${d}@s.whatsapp.net`);
      const lidMap = await LidMapping.findOne({ pn: { $in: [idWhatsApp, ...variantesPn] } }).lean();
      if (lidMap) {
        idResolvido = lidMap.lid;
        carteira = await CarteiraGrupo.findOne({ idWhatsApp: idResolvido, idGrupo });
      }
    }

    if (!carteira)
      return res.status(403).json({ error: 'Você não pertence a esse grupo.' });

    const carteiraIntegrada = await getCarteira(idResolvido, idGrupo);
    let carteiraDebitada;
    try {
      carteiraDebitada = await alterarGold(
        idResolvido,
        idGrupo,
        -valorAposta,
        'Slots (aposta)',
        crypto.randomUUID(),
      );
    } catch (error) {
      if (error instanceof RangeError) {
        return res.status(400).json({ error: 'Saldo insuficiente.', saldo: carteiraIntegrada.gold });
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
          crypto.randomUUID(),
        );
        saldoFinal = carteiraAtualizada.gold;
      } catch (error) {
        try {
          await alterarGold(idResolvido, idGrupo, valorAposta, 'Estorno de aposta: prêmio indisponível', crypto.randomUUID());
        } catch (refundError) {
          console.error('[API] Estorno crítico de Slots falhou:', refundError);
        }
        throw error;
      }
    }

    return res.json({
      resultado: [r1, r2, r3],
      tipo,
      mult,
      premio,
      lucroLiq,
      aposta:    valorAposta,
      saldoFinal,
    });

  } catch (err) {
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
    const idWhatsApp = decodeURIComponent(req.params.idWhatsApp).trim().toLowerCase();

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
          nomeCustom: { $first: { $ifNull: ['$nomeCustom', null] } },
          nomeReal:   { $first: { $ifNull: ['$nome',       null] } },
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

const CORRIDA_BICHOS_API = [
  { nome: '🐎 Cavalo',    emoji: '🐎', odds: 2.0, velocidade: 9 },
  { nome: '🐅 Tigre',     emoji: '🐅', odds: 2.5, velocidade: 8 },
  { nome: '🦊 Raposa',    emoji: '🦊', odds: 3.0, velocidade: 7 },
  { nome: '🐕 Cachorro',  emoji: '🐕', odds: 3.5, velocidade: 6 },
  { nome: '🐗 Javali',    emoji: '🐗', odds: 4.0, velocidade: 5 },
  { nome: '🐢 Tartaruga', emoji: '🐢', odds: 8.0, velocidade: 2 },
];

const CORRIDA_RATE_MAX    = 10;
const CORRIDA_RATE_JANELA = 60 * 1000;

const corridaRateLimit = rateLimit({
  windowMs:     CORRIDA_RATE_JANELA,
  max:          CORRIDA_RATE_MAX,
  keyGenerator: (req) => req.user?.idWhatsApp || ipKeyGenerator(req),
  handler: (req, res) => {
    return res.status(429).json({ error: 'Muitas apostas! Aguarde antes de tentar novamente.' });
  },
  skip: (req) => !req.user,
});

function sortearVencedorApi() {
  const pool = CORRIDA_BICHOS_API.flatMap((b, i) => Array(b.velocidade).fill(i));
  return pool[Math.floor(Math.random() * pool.length)];
}

// POST /api/corrida/apostar
// Body: { idGrupo, escolha (0-5), aposta }
router.post('/corrida/apostar', auth, corridaRateLimit, async (req, res) => {
  try {
    const idWhatsApp = req.user.idWhatsApp;
    const { idGrupo, escolha, aposta } = req.body || {};

    if (!idGrupo)
      return res.status(400).json({ error: 'idGrupo é obrigatório.' });

    const escolhaIdx = parseInt(escolha, 10);
    if (isNaN(escolhaIdx) || escolhaIdx < 0 || escolhaIdx >= CORRIDA_BICHOS_API.length)
      return res.status(400).json({ error: 'Escolha inválida.' });

    const valorAposta = parseInt(aposta, 10);
    if (!valorAposta || isNaN(valorAposta) || valorAposta <= 0)
      return res.status(400).json({ error: 'Aposta deve ser um número positivo.' });

    if (valorAposta > 100_000)
      return res.status(400).json({ error: `Aposta máxima: ${formatarSaldo(100_000)}.` });

    const carteira = await CarteiraGrupo.findOne({ idWhatsApp, idGrupo });
    if (!carteira)
      return res.status(403).json({ error: 'Você não pertence a esse grupo.' });

    const carteiraIntegrada = await getCarteira(idWhatsApp, idGrupo);
    let carteiraDebitada;
    try {
      carteiraDebitada = await alterarGold(
        idWhatsApp,
        idGrupo,
        -valorAposta,
        `Corrida (${CORRIDA_BICHOS_API[escolhaIdx].nome})`,
        crypto.randomUUID(),
      );
    } catch (error) {
      if (error instanceof RangeError) {
        return res.status(400).json({ error: 'Saldo insuficiente.', saldo: carteiraIntegrada.gold });
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
          idWhatsApp,
          idGrupo,
          premio,
          `Corrida (${bicho.odds}x)`,
          crypto.randomUUID(),
        );
        saldoFinal = carteiraAtualizada.gold;
      } catch (error) {
        try {
          await alterarGold(idWhatsApp, idGrupo, valorAposta, 'Estorno de aposta: prêmio indisponível', crypto.randomUUID());
        } catch (refundError) {
          console.error('[API] Estorno crítico de Corrida falhou:', refundError);
        }
        throw error;
      }
    }

    return res.json({
      vencedorIdx,
      escolhaIdx,
      bichos:    CORRIDA_BICHOS_API.map(b => ({ nome: b.nome, emoji: b.emoji, odds: b.odds })),
      ganhou,
      premio,
      lucroLiq,
      aposta:    valorAposta,
      saldoFinal,
    });

  } catch (err) {
    console.error('[API] POST /corrida/apostar:', err);
    return res.status(500).json({ error: 'Erro interno.' });
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

// Rate limit específico pro cadastro — evita criação em massa
const rateLimitCadastro = rateLimit({
  windowMs:     60 * 60 * 1000,
  max:          5,
  keyGenerator: (req) => ipKeyGenerator(req) ?? 'desconhecido',
  handler: (req, res) =>
    res.status(429).json({ error: 'Muitas tentativas de cadastro. Tente novamente em 1 hora.' }),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/otp/enviar
// ─────────────────────────────────────────────────────────────────────────────
const OtpCadastro = require('../models/OtpCadastro');

const rateLimitOtp = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => ipKeyGenerator(req) ?? 'desconhecido',
  handler: (req, res) =>
    res.status(429).json({ error: 'Muitas tentativas. Aguarde 5 minutos.' }),
});

router.post('/auth/otp/enviar', rateLimitOtp, async (req, res) => {
  try {
    const { idWhatsApp } = req.body || {};

    if (!idWhatsApp || typeof idWhatsApp !== 'string')
      return res.status(400).json({ error: 'idWhatsApp é obrigatório.' });

    const digitosBase = idWhatsApp.split('@')[0].replace(/\D/g, '');
    if (!digitosBase || digitosBase.length < 8 || digitosBase.length > 15)
      return res.status(400).json({ error: 'Número inválido.' });

    const variantesPn = gerarVariantesNumero(digitosBase).map(d => `${d}@s.whatsapp.net`);
    const [lidMap, usuario] = await Promise.all([
      LidMapping.findOne({ pn: { $in: variantesPn } }).lean(),
      Usuario.findOne({ idWhatsApp: { $in: variantesPn } }).lean(),
    ]);
    const usuarioFinal = usuario
      ?? (lidMap ? await Usuario.findOne({ idWhatsApp: lidMap.lid }).lean() : null);

    if (!usuarioFinal)
      return res.status(404).json({ error: 'Perfil não encontrado. Mande uma mensagem no grupo primeiro.' });

    if (usuarioFinal.username && usuarioFinal.passwordHash)
      return res.status(409).json({ error: 'Você já possui uma conta. Faça login normalmente.' });

    const codigo    = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OtpCadastro.findOneAndUpdate(
      { idWhatsApp: usuarioFinal.idWhatsApp },
      { codigo, expiresAt, usado: false },
      { upsert: true }
    );

    if (!usuarioFinal.telefone && digitosBase) {
      await Usuario.findOneAndUpdate(
        { idWhatsApp: usuarioFinal.idWhatsApp },
        { $set: { telefone: digitosBase } }
      );
    }

    // Envia código via WhatsApp
    const { sock: botSock } = require('../bot');
    if (!botSock)
      return res.status(503).json({ error: 'Bot não conectado. Tente novamente em instantes.' });

    const numeroDestino = `${digitosBase}@s.whatsapp.net`;
    await botSock.sendMessage(numeroDestino, {
      text: `🔐 *Tico Bot — Verificação de Conta*\n\nSeu código de verificação é:\n\n*${codigo}*\n\n⏰ Válido por 10 minutos. Não compartilhe com ninguém.`,
    });

    return res.json({ ok: true, message: 'Código enviado no seu WhatsApp!' });
  } catch (err) {
    console.error('[API] POST /auth/otp/enviar:', err);
    return res.status(500).json({ error: 'Erro interno ao enviar código.' });
  }
});

router.post('/auth/cadastrar', rateLimitCadastro, async (req, res) => {
  try {
    const { idWhatsApp, username, password } = req.body || {};

    // ── Validação de presença ─────────────────────────────────────────────────
    if (!idWhatsApp || typeof idWhatsApp !== 'string' ||
        !username   || typeof username   !== 'string' ||
        !password   || typeof password   !== 'string')
      return res.status(400).json({ error: 'idWhatsApp, username e password são obrigatórios.' });

    // ── Sanitização básica ────────────────────────────────────────────────────
    const usernameLimpo = username.trim().toLowerCase();
    const passwordLimpa = password; // não trimma senha — espaços podem ser intencionais

    // ── Validações de formato ─────────────────────────────────────────────────
    if (usernameLimpo.length < 3 || usernameLimpo.length > 30)
      return res.status(400).json({ error: 'Usuário deve ter entre 3 e 30 caracteres.' });
    if (!/^[a-z0-9_]+$/.test(usernameLimpo))
      return res.status(400).json({ error: 'Usuário só pode conter letras, números e _.' });
    if (passwordLimpa.length < 6 || passwordLimpa.length > 128)
      return res.status(400).json({ error: 'Senha deve ter entre 6 e 128 caracteres.' });

    // ── Valida formato do idWhatsApp recebido ─────────────────────────────────
    const digitosBase = idWhatsApp.split('@')[0].replace(/\D/g, '');
    if (!digitosBase || digitosBase.length < 8 || digitosBase.length > 15)
      return res.status(400).json({ error: 'Número de WhatsApp inválido.' });

    // ── Resolve variantes (BR com/sem 9; estrangeiro passa direto; @lid) ──────
    const variantesPn = gerarVariantesNumero(digitosBase).map(d => `${d}@s.whatsapp.net`);

    const [lidMap, usuario] = await Promise.all([
      LidMapping.findOne({ pn: { $in: variantesPn } }).lean(),
      Usuario.findOne({ idWhatsApp: { $in: variantesPn } }),
    ]);

    // Se não achou pelo pn, tenta pelo LID
    const usuarioFinal = usuario
      ?? (lidMap ? await Usuario.findOne({ idWhatsApp: lidMap.lid }) : null);

    if (!usuarioFinal)
      return res.status(404).json({ error: 'Perfil não encontrado. Mande uma mensagem no grupo primeiro.' });

    const idWhatsAppReal = usuarioFinal.idWhatsApp;

    // ── Verifica se já tem conta ──────────────────────────────────────────────
    if (usuarioFinal.username && usuarioFinal.passwordHash)
      return res.status(409).json({ error: 'Você já possui uma conta. Faça login normalmente.' });

    // ── Verifica disponibilidade do username (case-insensitive) ───────────────
    const usernameEmUso = await Usuario.exists({ username: usernameLimpo });
    if (usernameEmUso)
      return res.status(409).json({ error: 'Este nome de usuário já está em uso.' });

    // ── Salva email se fornecido ──────────────────────────────────────────────
    const { email } = req.body || {};
    const emailLimpo = typeof email === 'string' ? email.trim().toLowerCase() : null;
    if (emailLimpo) {
      const emailEmUso = await Usuario.exists({ email: emailLimpo });
      if (emailEmUso)
        return res.status(409).json({ error: 'Este email já está sendo usado por outra conta.' });
    }

    const passwordHash = await bcrypt.hash(passwordLimpa, 12);

    await Usuario.findOneAndUpdate(
      { idWhatsApp: idWhatsAppReal },
      { $set: {
          username:     usernameLimpo,
          passwordHash,
          ...(digitosBase && { telefone: digitosBase }),
          ...(emailLimpo  && { email: emailLimpo }),
      }},
      { new: true }
    );

    return res.json({ ok: true, message: 'Conta criada com sucesso! Faça login para acessar o painel.' });

  } catch (err) {
    console.error('[API] POST /auth/cadastrar:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// Login com usuário e senha. Retorna JWT de sessão.
// Body: { username, password }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/login', rateLimitAdmin, async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password)
      return res.status(400).json({ error: 'username e password são obrigatórios.' });

    const usuario = await Usuario.findOne({ username: username.toLowerCase() }).lean();
    if (!usuario || !usuario.passwordHash)
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });

    const senhaCorreta = await bcrypt.compare(password, usuario.passwordHash);
    if (!senhaCorreta)
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });

    const sessionJwt = jwt.sign(
      { idWhatsApp: usuario.idWhatsApp, telefone: usuario.telefone },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    return res.json({ jwt: sessionJwt });

  } catch (err) {
    console.error('[API] POST /auth/login:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/recuperar
// Redefine a senha do usuário usando o código OTP obtido via !recuperar no grupo
// Body: { idWhatsApp, codigo, novaSenha }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/recuperar', rateLimitCadastro, async (req, res) => {
  try {
    const { idWhatsApp, codigo, novaSenha } = req.body || {};

    if (!idWhatsApp || !codigo || !novaSenha)
      return res.status(400).json({ error: 'Número do WhatsApp, código e nova senha são obrigatórios.' });

    if (novaSenha.length < 6 || novaSenha.length > 128)
      return res.status(400).json({ error: 'Nova senha deve ter no mínimo 6 caracteres.' });

    const digitosBase = String(idWhatsApp).split('@')[0].replace(/\D/g, '');
    if (!digitosBase || digitosBase.length < 8 || digitosBase.length > 15)
      return res.status(400).json({ error: 'Número de WhatsApp inválido.' });

    const variantesPn = gerarVariantesNumero(digitosBase).map(d => `${d}@s.whatsapp.net`);

    const [lidMap, usuario] = await Promise.all([
      LidMapping.findOne({ pn: { $in: variantesPn } }).lean(),
      Usuario.findOne({ idWhatsApp: { $in: variantesPn } }),
    ]);

    const usuarioFinal = usuario
      ?? (lidMap ? await Usuario.findOne({ idWhatsApp: lidMap.lid }) : null);

    if (!usuarioFinal)
      return res.status(404).json({ error: 'Perfil não encontrado. Digite !recuperar em um grupo no WhatsApp primeiro.' });

    const jidsAceitos = [usuarioFinal.idWhatsApp, ...variantesPn];
    const otpValido = await OtpCadastro.findOne({
      idWhatsApp: { $in: jidsAceitos },
      codigo: String(codigo).trim(),
      usado: false,
      expiresAt: { $gt: new Date() },
    });

    if (!otpValido)
      return res.status(400).json({ error: 'Código inválido ou expirado. Digite !recuperar em um grupo no WhatsApp para gerar um novo código.' });

    otpValido.usado = true;
    await otpValido.save();

    const passwordHash = await bcrypt.hash(novaSenha, 12);
    usuarioFinal.passwordHash = passwordHash;
    if (!usuarioFinal.telefone && digitosBase) {
      usuarioFinal.telefone = digitosBase;
    }
    await usuarioFinal.save();

    return res.json({ ok: true, message: 'Senha redefinida com sucesso! Faça login com a nova senha.' });
  } catch (err) {
    console.error('[API] POST /auth/recuperar:', err);
    return res.status(500).json({ error: 'Erro interno ao redefinir senha.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/resetsenha
// Reseta a senha do usuário — ele precisa estar autenticado via JWT.
// Body: { senhaAtual, novaSenha }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/resetsenha', auth, async (req, res) => {
  try {
    const { senhaAtual, novaSenha } = req.body || {};
    const idWhatsApp = req.user.idWhatsApp;

    if (!senhaAtual || !novaSenha)
      return res.status(400).json({ error: 'senhaAtual e novaSenha são obrigatórios.' });
    if (novaSenha.length < 6)
      return res.status(400).json({ error: 'Nova senha deve ter no mínimo 6 caracteres.' });

    const usuario = await Usuario.findOne({ idWhatsApp }).lean();
    if (!usuario || !usuario.passwordHash)
      return res.status(404).json({ error: 'Conta não encontrada.' });

    const senhaCorreta = await bcrypt.compare(senhaAtual, usuario.passwordHash);
    if (!senhaCorreta)
      return res.status(401).json({ error: 'Senha atual incorreta.' });

    const novoHash = await bcrypt.hash(novaSenha, 12);
    await Usuario.findOneAndUpdate({ idWhatsApp }, { $set: { passwordHash: novoHash } });

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
          { $group: { _id: '$idGrupo', nomeCustom: { $first: '$nomeCustom' }, nomeReal: { $first: '$nome' } } },
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
      { $group: { _id: '$idGrupo', nomeCustom: { $first: '$nomeCustom' }, nomeReal: { $first: '$nome' } } },
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
router.get('/user/telefone/:idWhatsApp', async (req, res) => {
  try {
    const idRaw = decodeURIComponent(req.params.idWhatsApp).trim().toLowerCase();

    // Se já é um número normal, devolve direto
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
router.get('/admin/contas', adminAuth, async (req, res) => {
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
  try {
    const idWhatsApp = req.user.idWhatsApp;

    await Usuario.findOneAndUpdate(
      { idWhatsApp },
      { $unset: { username: '', passwordHash: '', email: '' } }
    );

    await OtpCadastro.deleteMany({ idWhatsApp });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[API] DELETE /auth/conta:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── OBRIGATÓRIO: Mantém a exportação do router como a última linha ───────────
module.exports = router;