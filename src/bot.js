/**
 * WhatsApp Sticker Bot – Tico
 * bot.js principal – Integrado com o router modular (router.js)
 */
require('dotenv').config();

// Fuso horário padrão de todo o processo: Cuiabá (MT).
// Datas persistidas como Date continuam sendo instantes UTC no MongoDB.
process.env.TZ = 'America/Cuiaba';

const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

// ─── Core Node.js ─────────────────────────────────────────────────────────────
const path = require('path');
const fs   = require('fs');

// ─── Dependências externas ────────────────────────────────────────────────────
const {
  default: makeWASocket,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const { useMongoAuthState, clearMongoAuthState, removeSessionsForUser } = require('./mongoAuthState');
const { Boom }  = require('@hapi/boom');
const pino      = require('pino');
const QRCode    = require('qrcode');
const mongoose  = require('mongoose');
const PetSpawn  = require('./models/PetSpawn');
const GrupoConfig = require('./models/GrupoConfig');
const CarteiraGrupo = require('./models/CarteiraGrupo');

// ─── Scripts & Utils ──────────────────────────────────────────────────────────
const { rodarAtualizacao } = require('./scripts/atualizarGrupos.js');
const { acquireLock, startHeartbeat, releaseLock } = require('./utils/instanceLock');
const { acquireLockWithRetry } = require('./utils/acquireLockWithRetry');
const { saveData } = require('./utils/persistence');

// ─── Router & Handlers ────────────────────────────────────────────────────────
// Fix #3: Conectado ao router.js modular!
const { handleMessage, setBotJid, contactNames } = require('./router');
const { processarBemVindo }       = require('./handlers/grupo');

const { initPetScheduler, registerActiveGroup, initFilhosScheduler } = require('./handlers/diversao');
const { initQuizRankingScheduler }                                   = require('./handlers/quizRanking');
const downloadsHandler                                               = require('./handlers/utilidade/downloads');

// ─── Silenciar logs ruidosos ──────────────────────────────────────────────────
const _log = console.log.bind(console);
const _err = console.error.bind(console);
const NOISE = [
  'Closing open session', 'Closing session:', 'SessionEntry', '_chains',
  'registrationId', 'currentRatchet', 'indexInfo', 'ephemeralKeyPair',
  'lastRemoteEphemeralKey', 'previousCounter', 'rootKey', 'baseKey',
  'remoteIdentityKey', 'Bad MAC', 'MessageCounterError', 'Failed to decrypt',
  'chainKey', 'chainType', 'messageKeys', 'pubKey', 'privKey',
  'Over 2000 messages into the future', 'Session error',
];
const isNoise = (...args) => {
  try {
    for (const x of args) {
      if (x && typeof x === 'object') {
        const keys = Object.keys(x);
        if (keys.some(k => NOISE.includes(k))) return true;
        const name = x?.constructor?.name || '';
        if (name === 'SessionEntry' || NOISE.some(p => name.includes(p))) return true;
      }
    }
    const s = args
      .map(x => { try { return typeof x === 'object' ? JSON.stringify(x) : String(x); } catch { return ''; } })
      .join(' ');
    return NOISE.some(p => s.includes(p));
  } catch { return false; }
};
console.log   = (...a) => { if (!isNoise(...a)) _log(...a); };
console.error = (...a) => { if (!isNoise(...a)) _err(...a); };

// ─── Diretórios ───────────────────────────────────────────────────────────────
const SESSION_DIR = path.resolve(__dirname, '../session');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

let _botSock = null;

// ─── Guards de crash ──────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  // Stack completo para identificar a origem das falhas assíncronas do Baileys.
  console.error('⚠️ unhandledRejection capturado:', reason?.stack || reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ uncaughtException capturado:', err?.message || err);
});

process.on('SIGINT',  async () => { saveData(); await releaseLock(); process.exit(); });
process.on('SIGTERM', async () => { saveData(); await releaseLock(); process.exit(); });

// ─── Logger global ───────────────────────────────────────────────────────────
// Silencioso, exceto por um "ouvido" para falhas de decrypt Signal. Quando a
// sessão salva de um contato fica defasada ("Over 2000 messages into the
// future" / Bad MAC em loop), apagamos só a sessão DELE no Mongo: o Baileys
// pede retry e o remetente renegocia uma sessão nova sozinho.
const _healCooldown = new Map(); // user -> timestamp da última limpeza
const HEAL_COOLDOWN_MS = 60 * 1000;

function healSessionFromLog(line) {
  if (!line.includes('Over 2000 messages into the future')) return;

  let obj;
  try { obj = JSON.parse(line); } catch { return; }

  // Baileys pode aninhar a chave dentro de `data`, `context` ou `err`; não
  // presuma que ela estará sempre na raiz do objeto Pino.
  const jids = new Set();
  const vistos = new Set();
  const visitar = (valor, profundidade = 0) => {
    if (!valor || typeof valor !== 'object' || profundidade > 7 || vistos.has(valor)) return;
    vistos.add(valor);

    const possiveis = [
      valor.remoteJid, valor.participant, valor.remoteJidAlt, valor.participantAlt,
    ];
    for (const jid of possiveis) {
      if (typeof jid === 'string' && jid.includes('@') &&
          !jid.endsWith('@g.us') && !jid.endsWith('@broadcast')) jids.add(jid);
    }
    for (const filho of Object.values(valor)) visitar(filho, profundidade + 1);
  };
  visitar(obj);

  for (const jid of jids) {
    const user = jid.split('@')[0].split(':')[0];
    if (!user) continue;
    const last = _healCooldown.get(user) || 0;
    if (Date.now() - last < HEAL_COOLDOWN_MS) continue;
    _healCooldown.set(user, Date.now());
    removeSessionsForUser(user)
      .then(n => _log(`🩹 Sessão Signal defasada de ${user} removida (${n} registro(s)). Aguardando renegociação.`))
      .catch(err => _err('⚠️ Falha ao corrigir sessão Signal:', err?.message || err));
  }
}

const logger = pino(
  { level: 'error' },
  { write: (line) => { try { healSessionFromLog(String(line)); } catch {} } }
);

// ─── Iniciar bot ───────────────────────────────────────────────────────────────
async function startBot() {
  if (_botSock) {
    console.warn('⚠️ startBot() chamado, mas já existe um socket ativo.');
    return;
  }

  const { state, saveCreds } = await useMongoAuthState();
  const { version }          = await fetchLatestBaileysVersion();

  console.log(`\n🤖 Iniciando bot com Baileys v${version.join('.')}\n`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ['Ubuntu', 'Chrome-Bot', '1.0.0'],
    patchMessageBeforeSending: (message) => {
      const requiresPatch = !!(
        message.buttonsMessage  ||
        message.templateMessage ||
        message.listMessage     ||
        message.stickerMessage
      );
      if (requiresPatch) {
        message = {
          viewOnceMessageV2: {
            message: {
              messageContextInfo: {
                deviceListMetadataVersion: 2,
                deviceListMetadata: {},
              },
              ...message,
            },
          },
        };
      }
      return message;
    },
  });

  _botSock = sock;

  sock.ev.on('creds.update', saveCreds);

  // Popula contactNames (usado por !gold, !mute, !ban, etc. para mostrar nome
  // em vez do número/LID cru) — sem isso o objeto fica sempre vazio.
  sock.ev.on('contacts.upsert', cs => {
    for (const c of cs) if (c.name || c.notify) contactNames[c.id] = c.name || c.notify;
  });
  sock.ev.on('contacts.update', cs => {
    for (const c of cs) if (c.name || c.notify) contactNames[c.id] = c.name || c.notify;
  });

  // Votos de enquete
  const grupoHandler = require('./handlers/grupo');
  grupoHandler.registerPollVoteHandler(sock);

  // Boas-Vindas e Saída de Grupos
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    if (action === 'add') {
      for (const p of participants) {
        await processarBemVindo(sock, id, p, p.split('@')[0]);
      }
    } else if (action === 'remove' || action === 'leave') {
      const botNum = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : null;
      const botLid = sock.user?.lid ? sock.user.lid.split(':')[0].split('@')[0] : null;

      const botSaiu = participants.some(p => {
        const pNum = p.split(':')[0].split('@')[0];
        return (botNum && pNum === botNum) || (botLid && pNum === botLid);
      });

      if (botSaiu) {
        console.log(`🚪 Bot foi removido ou saiu do grupo ${id}. Limpando dados do ranking e integrantes do grupo...`);
        const CarteiraGrupo = require('./models/CarteiraGrupo');
        const GrupoConfig   = require('./models/GrupoConfig');
        await CarteiraGrupo.deleteMany({ idGrupo: id });
        await GrupoConfig.deleteOne({ idGrupo: id });
      } else {
        // Um ou mais integrantes saíram/foram removidos do grupo — remove do rank do grupo
        const CarteiraGrupo = require('./models/CarteiraGrupo');
        const LidMapping    = require('./models/LidMapping');

        const targetJids = [];
        for (const p of participants) {
          const rawNum = p.split(':')[0].split('@')[0];
          targetJids.push(p);
          targetJids.push(`${rawNum}@s.whatsapp.net`);
          targetJids.push(`${rawNum}@lid`);
        }

        const lidMaps = await LidMapping.find({
          $or: [
            { pn: { $in: targetJids } },
            { lid: { $in: targetJids } }
          ]
        }).lean();

        for (const lm of lidMaps) {
          if (lm.pn)  targetJids.push(lm.pn);
          if (lm.lid) targetJids.push(lm.lid);
        }

        const setJids = new Set(targetJids);
        for (const jid of targetJids) {
          const num = jid.split('@')[0].replace(/\D/g, '');
          if (num && num.length >= 10 && num.length <= 15) {
            const digitos = String(num || '').replace(/\D/g, '');
            setJids.add(`${digitos}@s.whatsapp.net`);
            if (digitos.startsWith('55') && digitos.length >= 12) {
              const ddd = digitos.slice(2, 4);
              const resto = digitos.slice(4);
              if (resto.length === 8) setJids.add(`55${ddd}9${resto}@s.whatsapp.net`);
              else if (resto.length === 9 && resto.startsWith('9')) setJids.add(`55${ddd}${resto.slice(1)}@s.whatsapp.net`);
            }
          }
        }

        const deletados = await CarteiraGrupo.deleteMany({
          idGrupo: id,
          idWhatsApp: { $in: Array.from(setJids) }
        });

        if (deletados.deletedCount > 0) {
          console.log(`👤 Removidos ${deletados.deletedCount} integrante(s) que saíram do grupo ${id} do ranking.`);
        }
      }
    }
  });

  // Mensagens
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Diagnóstico temporário: confirma se o Baileys entrega mensagens ao roteador,
    // sem registrar conteúdo, texto ou números dos participantes.
    console.log(`[Messages] upsert recebido — type=${type} count=${messages?.length ?? 0}`);
    if (type !== 'notify') {
      console.log(`[Messages] upsert ignorado pelo filtro — type=${type}`);
      return;
    }

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.message) {
        console.warn('[Messages] Mensagem recebida sem payload de conteúdo.');
        continue;
      }

      console.log(`[Messages] Encaminhando ao roteador — jidType=${msg.key.remoteJid?.split('@')[1] || 'unknown'}`);
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        console.error('❌ Erro no processamento da mensagem:', err?.stack || err?.message || err);
      }
    }
  });

  // Conexão
  let schedulersIniciados = false;

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 Escaneie o QR Code:\n');
      try {
        console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
        await QRCode.toFile(path.resolve(__dirname, '../qrcode.png'), qr, { width: 400 });
      } catch (err) {
        console.error('[QRCode] Erro ao gerar QR:', err.message);
      }
    }

    if (connection === 'close') {
      schedulersIniciados = false;
      _botSock = null;

      const code   = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const motivo = lastDisconnect?.error?.message ?? 'desconhecido';
      const logado = code !== DisconnectReason.loggedOut;

      console.warn(`🔌 Desconectado. Código: ${code} | Motivo: ${motivo}`);

      if (code === DisconnectReason.connectionReplaced) {
        console.error('🚨 CONEXÃO SUBSTITUÍDA (440). Parando...');
        await releaseLock();
        process.exit(1);
      }

      if (logado) {
        const isRestartRequired = code === DisconnectReason.restartRequired;
        const delay = isRestartRequired ? 1_000 : 3_000;

        console.log(`🔄 Reconectando em ${delay / 1000}s...`);
        setTimeout(() => {
          startBot().catch(err => console.error('❌ Erro ao reiniciar:', err));
        }, delay);
      } else {
        console.log('🚪 Sessão encerrada no WhatsApp (loggedOut - 401). Limpando credenciais...');
        await clearMongoAuthState();
        saveData();
        await releaseLock();
        console.log('\n⚠️ Credenciais resetadas com sucesso! Execute "npm start" para gerar um novo QR Code.\n');
        process.exit(0);
      }
    }

    if (connection === 'open') {
      const bJid = sock.user?.id ?? null;
      setBotJid(bJid);
      console.log(`✅ Bot conectado! JID: ${bJid}\n`);

      if (!schedulersIniciados) {
        // Restaura XP dos casais e XP Dobro ativo (estavam só em memória)
        try {
          const { relacionamentos } = require('./utils/persistence');
          await require('./handlers/relacionamento').hidratarEstadoCasais(relacionamentos);
        } catch (err) {
          console.error('⚠️ Erro ao hidratar estado dos casais:', err.message);
        }

        initPetScheduler(sock);
        initQuizRankingScheduler(sock, new Set());
        initFilhosScheduler();

        setInterval(() => downloadsHandler.limparTmpAntigos(10 * 60 * 1000), 5 * 60 * 1000);
        downloadsHandler.limparTmpAntigos(10 * 60 * 1000);

        schedulersIniciados = true;
        console.log('[Schedulers] Iniciados.');

        setTimeout(() => rodarAtualizacao(sock), 10000);
        setInterval(() => {
          rodarAtualizacao(sock).catch(e => console.error('⚠️ Erro na sincronização periódica de grupos:', e.message));
        }, 15 * 60 * 1000);
      }
    }
  });
}

// Exporta getBotSock para que a API possa disparar ações do socket no bot
function getBotSock() {
  return _botSock;
}

module.exports = {
  getBotSock,
  get sock() { return _botSock; },
};

// ─── Servidor Web ─────────────────────────────────────────────────────────────
const express = require('express');
const app     = express();
const port    = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(require('./utils/cors').corsMiddleware);

app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => res.send('Bot Online!'));

try {
  const apiRouter = require('./routes/api');
  app.use('/api', apiRouter);
  console.log('✅ API router carregado com sucesso');
} catch (err) {
  console.error('❌ ERRO AO CARREGAR API ROUTER:', err);
}

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
  }
  console.error('[Servidor Web] Erro não tratado:', err);
  return res.status(500).json({ error: 'Erro interno do servidor.' });
});

app.listen(port, () => console.log(`🌐 Servidor web do bot rodando na porta ${port}`));

// ── Iniciar ───────────────────────────────────────────────────────────────────
async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/piroquinhas';
  try {
    console.log('⏳ Conectando ao MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB conectado com sucesso!');
    await require('./utils/prefixos').hydratePrefixCache();
  } catch (err) {
    console.error('❌ Erro ao conectar ao MongoDB:', err.message);
    process.exit(1);
  }

  // A nova instância aguarda a antiga liberar o lock. Não desistir após 30s:
  // o Render pode encerrar a versão antiga só 60s depois da troca.
  const acquired = await acquireLockWithRetry({ acquireLock });

  // Só o processo que adquiriu o lock pode resetar as preferências automáticas.
  // Assim, uma instância concorrente não altera os sistemas da instância ativa.
  try {
    const resultadoSpawn = await PetSpawn.desativarTodosNoBoot();
    console.log(
      `[PetScheduler] Inicialização segura: spawn automático OFF em ${resultadoSpawn.matchedCount ?? 0} grupo(s).`
    );

    const resultadoLevel = await GrupoConfig.desativarTodosNoBoot();
    const resultadoCarteirasXp = await CarteiraGrupo.desativarXpTodosNoBoot();
    console.log(
      `[LevelSystem] Inicialização segura: XP/níveis OFF em ${resultadoLevel.matchedCount ?? 0} configuração(ões) de grupo e ${resultadoCarteirasXp.matchedCount ?? 0} carteira(s).`
    );
  } catch (err) {
    console.error(
      '❌ Não foi possível garantir os sistemas automáticos OFF (pets/níveis). O bot do WhatsApp não será iniciado:',
      err.message
    );
    await releaseLock().catch(() => {});
    return;
  }

  startHeartbeat();
  startBot().catch(console.error);
}

main().catch(console.error);
