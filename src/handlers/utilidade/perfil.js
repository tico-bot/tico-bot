'use strict';

const path = require('path');
const fs   = require('fs');
const { fetchBuffer } = require(path.join(__dirname, '..', '..', 'fetchurl'));
const Usuario = require(path.join(__dirname, '..', '..', 'models', 'Usuario'));
const LidMapping = require(path.join(__dirname, '..', '..', 'models', 'LidMapping'));
const CarteiraGrupo = require(path.join(__dirname, '..', '..', 'models', 'CarteiraGrupo'));
const { ACESSORIOS_CASAL } = require('../diversao/acessoriosCasal');

const { resolveUsuarioInfo } = require(path.join(__dirname, '..', '..', 'utils', 'identity'));
const { calcularMensagensPerfil, somarContagensIdentidades } = require(path.join(__dirname, '..', '..', 'utils', 'message-count'));
const { countGroupCounter, listGroupCounters } = require(path.join(__dirname, '..', '..', 'utils', 'group-activity'));
const { normalizarJid } = require(path.join(__dirname, '..', '..', 'utils', 'jid'));
const { getCarteira, formatarSaldo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));

const PET_EMOJIS = {
  tubarao: '🦈', dragao: '🐉', falcao: '🦅', leao: '🦁', tigre: '🐯',
  lobo: '🐺', urso: '🐻', macaco: '🐵', raposa: '🦊', coelho: '🐰',
  gato: '🐱', cachorro: '🐶', elefante: '🐘', girafa: '🦒', pinguim: '🐧',
  coruja: '🦉', fenix: '🔥', feneco: '🦝', leao_marinho: '🦭',
};

function extractNumber(jidStr) {
  if (!jidStr) return '';
  return jidStr.split('@')[0].split(':')[0];
}

function isLidJid(jidStr) {
  return typeof jidStr === 'string' && jidStr.endsWith('@lid');
}

function numeroSeguro(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function jidEquivalentes(userInfo, alvoJid) {
  return new Set([
    alvoJid, userInfo?.jid, userInfo?.resolvedJid, userInfo?.pnJid, userInfo?.lidJid,
  ].filter(value => typeof value === 'string' && value.length > 0));
}

function formatarDataAniversario(dataString, agora = new Date()) {
  const partes = String(dataString || '').split('/');
  if (partes.length !== 3) return '';
  const [dia, mes, ano] = partes.map(Number);
  if (!dia || !mes || !ano || mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano > agora.getFullYear()) return '';

  const nascimento = new Date(ano, mes - 1, dia);
  if (nascimento.getFullYear() !== ano || nascimento.getMonth() !== mes - 1 || nascimento.getDate() !== dia) return '';

  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  let idade = agora.getFullYear() - ano;
  const aniversarioEsteAno = new Date(agora.getFullYear(), mes - 1, dia);
  if (aniversarioEsteAno > hoje) idade--;

  let proximo = aniversarioEsteAno;
  if (proximo < hoje) proximo = new Date(agora.getFullYear() + 1, mes - 1, dia);
  const dias = Math.round((proximo - hoje) / 86400000);
  return `🎂 ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}  ·  ${idade} anos  ·  ${dias === 0 ? '🥳 Hoje!' : `em ${dias} dia(s)`}`;
}

async function handlePerfil(sock, msg, content, jid, contactNames, msgCount, cmdCount, stickerCount, relacionamentos, groupMsgCount, groupCmdCount, groupStickerCount) {
  const contextInfo = content?.extendedTextMessage?.contextInfo
                    || msg?.message?.extendedTextMessage?.contextInfo;
  const mentions  = Array.isArray(contextInfo?.mentionedJid) ? contextInfo.mentionedJid : [];
  const senderJid = msg?.key?.participant || msg?.key?.remoteJid;
  const alvoJid   = mentions[0] || contextInfo?.participant || senderJid;
  if (!alvoJid || !jid) {
    await sock.sendMessage(jid || senderJid, { text: '⚠️ Não consegui identificar o usuário para montar o perfil.' }, { quoted: msg });
    return;
  }

  // Resolve informações completas do usuário (LID, PN, Telefone, Nome, Model Usuario)
  const userInfo = await resolveUsuarioInfo(alvoJid, sock, contactNames);
  const { resolvedJid, number, formattedNumber, nome, userData } = userInfo;

  const mentionsList = [];
  if (resolvedJid && resolvedJid.endsWith('@s.whatsapp.net')) {
    mentionsList.push(resolvedJid);
  }

  let userGold = 0;
  let walletInfo = null;
  let bankText = '❌ Sem investimento ativo';
  try {
    const carteira = await getCarteira(resolvedJid, jid);

    userGold = carteira?.gold ?? 0;
    walletInfo = carteira;
    const banco = carteira?.banco;
    if (banco?.amount > 0) {
      const msLeft = Math.max(0, new Date(banco.startDate).getTime() + 3 * 60 * 60 * 1000 - Date.now());
      const status = msLeft > 0
        ? `⏳ Faltam ${Math.ceil(msLeft / 60000)}min`
        : '✅ Pronto para resgatar!';
      bankText = `💳 ${formatarSaldo(banco.amount, carteira)} investido (${banco.interest}% juros)  ${status}`;
    }
  } catch {}

  const identities = jidEquivalentes(userInfo, alvoJid);
  const findCount = (map, field = null) => somarContagensIdentidades(
    map, identities, normalizarJid, field,
  );

  let usuariosEquivalentes = userData ? [userData] : [];
  try {
    const docs = await Usuario.find({ idWhatsApp: { $in: [...identities] } })
      .select('idWhatsApp mensagens').lean();
    if (Array.isArray(docs) && docs.length) usuariosEquivalentes = docs;
  } catch (err) {
    console.warn('⚠️ Não foi possível consolidar mensagens PN/LID no perfil:', err.message);
  }
  const perfilPorGrupo = jid.endsWith('@g.us');
  // Os contadores legados são globais e não guardam o grupo de origem. Em grupos,
  // usamos apenas contadores com chave (grupo, usuário) para não misturar chats.
  const msgsRec = perfilPorGrupo
    ? countGroupCounter(groupMsgCount, jid, identities, normalizarJid)
    : calcularMensagensPerfil({
        usuarios: usuariosEquivalentes,
        fallback: userData?.mensagens,
        contadorLocal: findCount(msgCount, 'count'),
      });
  const cmdsRec = perfilPorGrupo
    ? countGroupCounter(groupCmdCount, jid, identities, normalizarJid)
    : findCount(cmdCount);
  const sticks = perfilPorGrupo
    ? countGroupCounter(groupStickerCount, jid, identities, normalizarJid)
    : findCount(stickerCount);
  const total   = msgsRec + cmdsRec + sticks;
  const activity =
    total > 1000 ? '🔥 Hiperativo' :
    total > 500  ? '⚡ Ativo'      :
    total > 100  ? '😊 Participativo' : '📉 Calmo';

  let rankText = '';
  if (perfilPorGrupo) {
    try {
      const ranks = listGroupCounters(groupMsgCount, jid, normalizarJid)
        .sort((a, b) => b[1] - a[1]);
      const alvoNormalizado = new Set([...identities].map(id => normalizarJid(id) || id));
      const idx = ranks.findIndex(([key]) => alvoNormalizado.has(key));
      if (idx >= 0) rankText = `  ·  #${idx + 1} no grupo`;
    } catch {}
  }

  let xp       = 0;
  let level    = 1;
  let xpNext   = 100;
  let xpPct    = 0;
  let xpBar    = '░'.repeat(10);

  try {
    const carteiraXp =
      await CarteiraGrupo.findOne({ idWhatsApp: resolvedJid, idGrupo: jid }) ||
      await CarteiraGrupo.findOne({ idWhatsApp: alvoJid,     idGrupo: jid }) ||
      (userInfo.lidJid ? await CarteiraGrupo.findOne({ idWhatsApp: userInfo.lidJid, idGrupo: jid }) : null);

    if (carteiraXp) {
      const prog = carteiraXp.getProgressoXp();
      xp      = numeroSeguro(prog.xp);
      level   = Math.max(1, Math.floor(numeroSeguro(prog.level, 1)));
      xpNext  = Math.max(1, numeroSeguro(prog.xpNecessario, 100));
      xpPct   = Math.min(100, numeroSeguro(prog.progresso));
      const barsOn = Math.max(0, Math.min(10, Math.floor(xpPct / 10)));
      xpBar   = '█'.repeat(barsOn) + '░'.repeat(10 - barsOn);
    }
  } catch {}

  let isAdmin   = false;
  let groupName = '';
  if (jid.endsWith('@g.us')) {
    try { groupName = (await sock.groupMetadata(jid)).subject || ''; } catch {}
    try {
      const grupoHandler = require('../grupo');
      isAdmin = await grupoHandler.isAdmin(sock, jid, alvoJid);
    } catch {}
  }

  let missaoText = '';
  try {
    const { dailyMissionDefinitions, getTodayStr } = require('../diversao/missoes');
    const dm    = userData?.dailyMissions;
    const today = getTodayStr();
    if (dm && dm.date === today) {
      const concluidas = dailyMissionDefinitions.filter(m =>
        (dm.progress?.[m.id] || 0) >= m.target || dm.completed?.[m.id]
      ).length;
      const resgatadas = dailyMissionDefinitions.filter(m => dm.claimed?.[m.id]).length;
      missaoText = `${concluidas}/${dailyMissionDefinitions.length} concluídas  ·  ${resgatadas} resgatadas`;
    }
  } catch {}

  let petText = '❌ Sem pet';
  try {
    // Pets são persistidos por grupo em CarteiraGrupo. getCarteira() já resolve
    // aliases PN/LID para a carteira atual, enquanto Usuario.pet pode estar vazio.
    const petPerfil = walletInfo?.pet && (walletInfo.pet.name || walletInfo.pet.nome)
      ? walletInfo.pet
      : userData?.pet;
    const nomePet = petPerfil?.name ?? petPerfil?.nome;
    if (nomePet) {
      const emoji = PET_EMOJIS[petPerfil.type] ?? '🐾';
      const hap   = petPerfil.happiness ?? 60;
      const mood  = hap >= 80 ? '😄' : hap >= 50 ? '😊' : '😔';
      petText = `${emoji} *${nomePet}*  Lvl ${petPerfil.level || 1}  ${mood} ${hap}%`;
    }
  } catch {}

  let birthdayText = '';
  try {
    const dataPath = path.resolve(__dirname, '../../../data.json');
    if (fs.existsSync(dataPath)) {
      const dataFile = JSON.parse(fs.readFileSync(dataPath, 'utf8') || '{}');
      let birthday = null;
      for (const id of identities) {
        if (dataFile?.birthdays?.[id]?.date) { birthday = dataFile.birthdays[id].date; break; }
      }
      if (birthday) birthdayText = formatarDataAniversario(birthday);
    }
  } catch (err) {
    console.warn('⚠️ Não foi possível carregar o aniversário do perfil:', err.message);
  }

  let relStatus   = '💔 Solteiro(a)';
  let parceiroJid = null;
  try {
    if (relacionamentos && typeof relacionamentos[Symbol.iterator] === 'function') {
      const idsAlvo = identities;
      for (const [key, rel] of relacionamentos) {
        if (!key.startsWith(`${jid}|`) || !rel?.jidA || !rel?.jidB) continue;
        const ehA = idsAlvo.has(rel.jidA);
        const ehB = idsAlvo.has(rel.jidB);
        if (ehA === ehB) continue;

        parceiroJid = ehA ? rel.jidB : rel.jidA;
        const parceiroNumero = extractNumber(parceiroJid);
        const tipo = rel.tipo === 'casamento' ? 'casamento' : 'namoro';
        relStatus = tipo === 'casamento'
          ? `💍 Casado(a) com @${parceiroNumero}`
          : `❤️ Namorando com @${parceiroNumero}`;
        break;
      }
    }

    // O Map de relacionamentos ativos é a fonte de verdade para o perfil.
    // Não usar Usuario.casadoCom como fallback: dados persistidos antigos/inconsistentes
    // podem continuar exibindo "casado" depois que o casal terminou.

    if (parceiroJid) mentionsList.push(parceiroJid);
  } catch {}

  let acessoriosText = '';
  try {
    const equipados = userData?.acessoriosCasal;
    if (equipados) {
      const ativos = [];
      for (const [key, info] of Object.entries(ACESSORIOS_CASAL)) {
        const isAtivo = typeof equipados.get === 'function' ? equipados.get(key) : equipados[key];
        if (isAtivo) ativos.push(`${info.emoji} ${info.nome}`);
      }
      if (ativos.length > 0) acessoriosText = ativos.join('  ');
    }
  } catch {}

  let bio = typeof userData?.bio === 'string' ? userData.bio.trim().slice(0, 150) : '';
  if (perfilPorGrupo) {
    // Em grupo, a bio é totalmente independente da bio global e das demais comunidades.
    bio = '';
    try {
      const bioGrupo = await CarteiraGrupo.findOne({
        idGrupo: jid,
        idWhatsApp: { $in: [...identities] },
      }).select('bio').lean();
      bio = typeof bioGrupo?.bio === 'string' ? bioGrupo.bio.trim().slice(0, 150) : '';
    } catch {}
  }


  let picBuffer = null;
  try {
    const photoJid = (resolvedJid && resolvedJid.endsWith('@s.whatsapp.net')) ? resolvedJid : alvoJid;
    const url = await sock.profilePictureUrl(photoJid, 'image');
    if (url) picBuffer = await fetchBuffer(url);
  } catch {}

  const displayPhone = (number && number !== 'N/D')
    ? `@${number}` + (formattedNumber !== 'N/D' && formattedNumber !== `+${number}` ? ` (${formattedNumber})` : '')
    : 'N/D';

  const L = [
    `🔎 *PERFIL DO USUÁRIO* 🔎`,
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`,
    `👤 *Nome:* ${nome}`,
    `📞 *Número:* ${displayPhone}`,
  ];

  if (groupName)             L.push(`🏠 *Grupo:* ${groupName}`);
  if (jid.endsWith('@g.us')) L.push(`👑 *Admin:* ${isAdmin ? '✅ Sim' : '❌ Não'}`);
  if (bio)                   L.push(`📝 *Bio:* ${bio}`);

  L.push(
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`,
    `📊 *ATIVIDADE*`,
    `💬 Mensagens: *${msgsRec.toLocaleString('pt-BR')}*${rankText}`,
    `🤖 Comandos:  *${cmdsRec.toLocaleString('pt-BR')}*`,
    `😄 Figurinhas: *${sticks.toLocaleString('pt-BR')}*`,
    `🔁 Total: *${total.toLocaleString('pt-BR')}*  ${activity}`,
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`,
    `⭐ *PROGRESSO*`,
    `🏅 Level *${level}*  ·  XP ${xp.toLocaleString('pt-BR')}/${xpNext.toLocaleString('pt-BR')} (${Math.round(xpPct)}%)`,
    `[${xpBar}]`,
  );

  if (missaoText) L.push(`🎯 Missões: ${missaoText}`);

  L.push(
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`,
    `💰 *ECONOMIA*`,
    `👛 Carteira: *${formatarSaldo(numeroSeguro(userGold), walletInfo)}*`,
    `🏦 Banco: ${bankText}`,
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`,
    `🐾 *PET ATIVO*`,
    petText,
  );

  if (birthdayText) {
    L.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`, `🎂 *ANIVERSÁRIO*`, birthdayText);
  }

  L.push(
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`,
    `💑 *RELACIONAMENTO*`,
    relStatus,
  );

  if (acessoriosText) L.push(`💎 *Acessórios:* ${acessoriosText}`);

  L.push(
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`,
    `🤖 _Tico Bot_`,
  );

  const texto = L.join('\n');

  try {
    if (picBuffer) {
      await sock.sendMessage(jid, { image: picBuffer, caption: texto, mentions: mentionsList }, { quoted: msg });
    } else {
      await sock.sendMessage(jid, { text: texto, mentions: mentionsList }, { quoted: msg });
    }
  } catch (e) {
    console.error('⚠️ Erro ao enviar perfil:', e.message);
    try { await sock.sendMessage(jid, { text: texto, mentions: mentionsList }, { quoted: msg }); } catch {}
  }
}

async function handleBio(sock, msg, jid, caption) {
  const senderOriginal = String(msg.key.participant || msg.key.remoteJid || '').split(':')[0].trim().toLowerCase();
  const senderPn = String(msg.key.participantPn || '').split(':')[0].trim().toLowerCase();
  let senderJid = senderPn.endsWith('@s.whatsapp.net') ? senderPn : senderOriginal;
  const bio = String(caption || '').replace(/^[!.,\/]bio\s*/i, '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();

  if (!senderJid) {
    await sock.sendMessage(jid, { text: '⚠️ Não consegui identificar sua conta do WhatsApp.' }, { quoted: msg });
    return;
  }

  if (!bio) {
    await sock.sendMessage(jid, {
      text: '⚠️ Digite sua bio!\nExemplo: *!bio Amo jogar e ouvir música*\n\n_Máximo: 150 caracteres_',
    }, { quoted: msg });
    return;
  }

  if (bio.length > 150) {
    await sock.sendMessage(jid, {
      text: `⚠️ Bio muito longa (${bio.length}/150 caracteres). Resuma um pouco!`,
    }, { quoted: msg });
    return;
  }

  try {
    // Resolve PN/LID aliases once. In a group the bio is stored only in that group's
    // CarteiraGrupo records; in private chat it remains the global Usuario bio.
    let mapping = null;
    if (senderOriginal.endsWith('@lid')) {
      mapping = await LidMapping.findOne({ lid: senderOriginal }).select('lid pn').lean();
    } else if (senderPn.endsWith('@s.whatsapp.net')) {
      mapping = await LidMapping.findOne({ pn: senderPn }).select('lid pn').lean();
    }
    const idsBio = [...new Set([senderOriginal, senderPn, senderJid, mapping?.lid, mapping?.pn]
      .filter(value => typeof value === 'string' && value.length)
      .map(value => value.split(':')[0].trim().toLowerCase()))];

    if (jid?.endsWith('@g.us')) {
      const atualizacao = await CarteiraGrupo.updateMany(
        { idGrupo: jid, idWhatsApp: { $in: idsBio } },
        { $set: { bio } },
      );
      const encontrados = Number(atualizacao?.matchedCount ?? atualizacao?.n ?? 0);
      if (!encontrados) {
        await CarteiraGrupo.findOneAndUpdate(
          { idWhatsApp: senderOriginal || senderJid, idGrupo: jid },
          { $set: { bio } },
          { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
        );
      }
    } else {
      const atualizacao = idsBio.length
        ? await Usuario.updateMany({ idWhatsApp: { $in: idsBio } }, { $set: { bio } })
        : { matchedCount: 0 };
      if (!Number(atualizacao?.matchedCount ?? atualizacao?.n ?? 0)) {
        const idExistenteOriginal = senderOriginal || senderJid;
        await Usuario.findOneAndUpdate(
          { idWhatsApp: idExistenteOriginal },
          { $set: { bio } },
          { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
        );
      }
    }

    await sock.sendMessage(jid, {
      text: `✅ *Bio atualizada${jid?.endsWith('@g.us') ? ' neste grupo' : ''}!*\n\n📝 "${bio}"`,
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ Erro ao salvar bio:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao salvar sua bio. Tente novamente.' }, { quoted: msg });
  }
}

module.exports = {
  handlePerfil,
  handleBio,
};
