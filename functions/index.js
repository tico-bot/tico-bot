"use strict";

const { createHash, createHmac, randomBytes, randomInt, randomUUID, scryptSync } = require("node:crypto");
const { getAuth } = require("firebase-admin/auth");
const { cert, initializeApp } = require("firebase-admin/app");
const { v2: cloudinary } = require("cloudinary");
const { FieldPath, FieldValue, getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("./callable");
const {
  blackjackHandValue,
  coinFlipResult,
  crashMultiplierBasisPoints,
  crashPointBasisPoints,
  createShuffledDeck,
  createMinefield,
  diceGuessResult,
  footballShotResult,
  isBlackjack,
  minesCashoutPayout,
  memoryChallengeResult,
  quizChallengeResult,
  codebreakerChallengeResult,
  mazeChallengeResult,
  rockPaperScissorsResult,
  parityDiceResult,
  rouletteResult,
  resolveOnlineDuel,
  scratchCardResult,
  settleBlackjack,
  spinSlots,
  validateWager,
} = require("./game-logic");
const {
  advanceMissionProgress,
  advanceSportsMissionProgress,
  getMissionProgress,
  initializeBalance,
  levelProgress,
  normalizeBio,
  normalizeUsername,
} = require("./profile-logic");
const { applyStreakMessage, dateUtc } = require("./chat-logic");
const { AVATAR_ITEM_SLOTS, equipAvatarItem, unequipAvatarSlot } = require("./avatar-logic");
const {
  combinedOddsBps,
  estimateMatchMarkets,
  fixtureWinner,
  parseFootballDataMatches,
  settleSportsSelection,
  sportsPayoutCents,
} = require("./sports-logic");
const {
  COMPLETED_ROOM_RETENTION_MS,
  MAX_PULLS_PER_BATCH,
  applyTugPull,
  chooseBalancedTeam,
  recordCompletedRoomExit,
} = require("./tug-logic");
const {
  ACHIEVEMENT_DEFINITIONS,
  advanceWeeklyEvent,
  canAddClanMember,
  canViewPlayerProfile,
  canTransitionReport,
  isoWeekKey,
  qualifiesForWeeklyEvent,
  validateClan,
  validateReport,
  weeklyEventForDate,
} = require("./social-logic");

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
initializeApp(serviceAccount ? { credential: cert(JSON.parse(serviceAccount)) } : {});

const database = getFirestore();
const INITIAL_BALANCE_CENTS = 50_000;
const MAX_TRANSFER_CENTS = 1_000_000;
const GAME_COOLDOWN_MS = 250;
const CHAT_COOLDOWN_MS = 300;
const DEFAULT_MINES_RTP_BPS = 9_800;
const JOKENPO_QUEUE_TTL_MS = 90_000;
const SOLO_CHALLENGE_TTL_MS = 5 * 60_000;
const SOLO_CHALLENGE_GAMES = new Set(["memorySequence", "quizSprint", "codebreaker", "mazeRunner"]);
const CLOUDINARY_CLOUD_NAME = "vwctfu9u";
const COSMETICS = {
  frame_aurora: { name: "Moldura Aurora", priceCents: 1_299 },
  title_lucky: { name: "Título: Sorte Grande", priceCents: 799 },
  frame_neon: { name: "Moldura Neon", priceCents: 1_999 },
  frame_gold: { name: "Moldura Dourada", priceCents: 2_499 },
  title_highroller: { name: "Título: Alto Rolo", priceCents: 1_499 },
  frame_emerald: { name: "Moldura Esmeralda", priceCents: 1_699 },
  title_champion: { name: "Título: Campeão", priceCents: 2_999 },
  frame_royal: { name: "Moldura Real", priceCents: 3_999 },
  title_jucineia: { name: "Título: Jucineia", priceCents: 1_250_000 },
  title_donizete: { name: "Título: Donizete", priceCents: 1_000_000 },
  title_erasmo: { name: "Título: Erasmo", priceCents: 1_500_000 },
  title_milena: { name: "Título: Milena", priceCents: 1_100_000 },
  avatar_hair_wave: { name: "Cabelo Ondulado", priceCents: 999, slot: "hair" },
  avatar_hair_curls: { name: "Cachos", priceCents: 1_299, slot: "hair" },
  avatar_hair_silver: { name: "Cor Prateada", priceCents: 899, slot: "hairColor" },
  avatar_skin_sun: { name: "Tom Solar", priceCents: 699, slot: "skin" },
  avatar_skin_cocoa: { name: "Tom Cacau", priceCents: 699, slot: "skin" },
  avatar_top_hoodie: { name: "Moletom Neon", priceCents: 1_299, slot: "outfit" },
  avatar_top_jacket: { name: "Jaqueta Aurora", priceCents: 1_499, slot: "outfit" },
  avatar_glasses_round: { name: "Óculos Redondos", priceCents: 799, slot: "accessory" },
  avatar_crown_neon: { name: "Coroa Neon", priceCents: 1_999, slot: "accessory" },
  avatar_hair_afro: { name: "Afro Lunar", priceCents: 1_599, slot: "hair" },
  avatar_hair_blue: { name: "Tinta Azul", priceCents: 1_099, slot: "hairColor" },
  avatar_skin_olive: { name: "Tom Oliva", priceCents: 799, slot: "skin" },
  avatar_top_sport: { name: "Jaqueta Esportiva", priceCents: 1_599, slot: "outfit" },
  avatar_top_space: { name: "Traje Estelar", priceCents: 1_899, slot: "outfit" },
  avatar_glasses_square: { name: "Óculos Quadrados", priceCents: 899, slot: "accessory" },
  avatar_earrings_star: { name: "Brincos Estrela", priceCents: 799, slot: "earrings" },
  avatar_cap_mint: { name: "Boné Menta", priceCents: 1_099, slot: "headwear" },
};

function authenticatedUid(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Entre na sua conta para continuar.");
  }
  return request.auth.uid;
}

function requireAdmin(request) {
  const uid = authenticatedUid(request);
  if (request.auth.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Acesso restrito à administração.");
  }
  return uid;
}

function recordMinigameSettlement(transaction, userRef, {
  gameId,
  gameName,
  outcome,
  netCents = 0,
  summary,
  recordId,
  atMs = Date.now(),
  clanId = "",
}) {
  const week = isoWeekKey(new Date(atMs));
  const weekly = weeklyEventForDate(new Date(atMs));
  const event = weekly && qualifiesForWeeklyEvent(gameId, weekly.eventKey)
    ? advanceWeeklyEvent({
      eventKey: weekly.eventKey,
      weekKey: weekly.weekKey,
      progress: 0,
      increment: 1,
      target: weekly.target,
      rewardCents: weekly.rewardCents,
    })
    : null;
  transaction.create(userRef.collection("gameHistory").doc(recordId), {
    gameId,
    gameName,
    outcome,
    netCents,
    summary: typeof summary === "string" ? summary.slice(0, 240) : "",
    atMs,
  });
  const statsRef = userRef.collection("minigameStats");
  const won = outcome === "won";
  const lost = outcome === "lost";
  const tied = outcome === "tied";
  const increments = {
    gameName,
    played: FieldValue.increment(1),
    wins: FieldValue.increment(won ? 1 : 0),
    losses: FieldValue.increment(lost ? 1 : 0),
    ties: FieldValue.increment(tied ? 1 : 0),
    netCents: FieldValue.increment(netCents),
    currentStreak: won ? FieldValue.increment(1) : 0,
  };
  transaction.set(statsRef.doc(gameId), increments, { merge: true });
  transaction.set(statsRef.doc("all"), increments, { merge: true });
  if (weekly && event?.valid) {
    transaction.set(userRef.collection("weeklyEvents").doc(weekly.id), {
      eventKey: weekly.eventKey,
      weekKey: weekly.weekKey,
      title: weekly.title,
      description: weekly.description,
      target: weekly.target,
      rewardCents: weekly.rewardCents,
      progress: FieldValue.increment(1),
    }, { merge: true });
    if (clanId) {
      transaction.set(database.collection("clans").doc(clanId), {
        weeklyScores: { [week]: FieldValue.increment(won ? 1 : 0) },
      }, { merge: true });
    }
  }
}

async function deleteMatchingDocuments(query) {
  while (true) {
    const snapshot = await query.limit(400).get();
    if (snapshot.empty) return;
    const batch = database.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
}

async function deleteUserTransfers(targetUid) {
  const transfers = database.collection("transfers");
  const [sent, received] = await Promise.all([
    transfers.where("senderUid", "==", targetUid).get(),
    transfers.where("recipientUid", "==", targetUid).get(),
  ]);
  const transferDocuments = [...new Map(
    [...sent.docs, ...received.docs].map((document) => [document.id, document]),
  ).values()];

  for (let offset = 0; offset < transferDocuments.length; offset += 150) {
    const batch = database.batch();
    for (const transferDocument of transferDocuments.slice(offset, offset + 150)) {
      const transfer = transferDocument.data();
      batch.delete(
        database.collection("users").doc(transfer.senderUid)
          .collection("transactions").doc(transferDocument.id),
      );
      batch.delete(
        database.collection("users").doc(transfer.recipientUid)
          .collection("transactions").doc(transferDocument.id),
      );
      batch.delete(transferDocument.ref);
    }
    await batch.commit();
  }
}

function timestampMillis(value) {
  return value && typeof value.toMillis === "function" ? value.toMillis() : null;
}

function hashTugPassword(password, roomId) {
  return password ? scryptSync(password, roomId, 32).toString("hex") : "";
}

async function deleteCloudinaryAvatarFolder(uid) {
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new HttpsError("failed-precondition", "Configure as credenciais administrativas do Cloudinary antes de excluir contas.");
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  try {
    let nextCursor;
    try {
      do {
        const options = { max_results: 500 };
        if (nextCursor) options.next_cursor = nextCursor;
        const result = await cloudinary.api.resources_by_asset_folder(`zeca/avatars/${uid}`, options);
        const publicIds = (result.resources || []).map((resource) => resource.public_id).filter(Boolean);
        for (let index = 0; index < publicIds.length; index += 100) {
          await cloudinary.api.delete_resources(publicIds.slice(index, index + 100), {
            resource_type: "image",
            type: "upload",
            invalidate: true,
          });
        }
        nextCursor = result.next_cursor || null;
      } while (nextCursor);
    } catch (error) {
      if (error.http_code !== 404 && error.error?.http_code !== 404) throw error;
      nextCursor = null;
      do {
        const options = {
          resource_type: "image",
          type: "upload",
          invalidate: true,
        };
        if (nextCursor) options.next_cursor = nextCursor;
        const result = await cloudinary.api.delete_resources_by_prefix(`zeca/avatars/${uid}/`, options);
        nextCursor = result.partial === true ? result.next_cursor : null;
        if (result.partial === true && !nextCursor) {
          throw new Error("Cloudinary omitted the next cursor for a partial deletion.");
        }
      } while (nextCursor);
    }
  } catch {
    throw new HttpsError("failed-precondition", "Não foi possível remover os avatares do Cloudinary; nenhum dado da conta foi apagado.");
  }
}

function normalizePixKey(key) {
  if (typeof key !== "string") {
    throw new HttpsError("invalid-argument", "Informe uma chave Pix.");
  }
  const normalized = key.trim().toLowerCase();
  const isEmail = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized);
  const isRandom = /^[a-f0-9]{32}$/.test(normalized)
    || /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(normalized);
  if (!isEmail && !isRandom) {
    throw new HttpsError("invalid-argument", "Use um e-mail ou uma chave aleatória válida.");
  }
  return { normalized, type: isEmail ? "email" : "random" };
}

function pixKeyHash(key) {
  return createHash("sha256").update(key).digest("hex");
}

function safeName(value, fallback) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 24) {
    return fallback;
  }
  return name;
}

function enforceGameCooldown(profile, nowMs) {
  const lastActionAtMs = profile.lastGameActionAtMs;
  if (Number.isSafeInteger(lastActionAtMs) && nowMs - lastActionAtMs < GAME_COOLDOWN_MS) {
    throw new HttpsError("resource-exhausted", "Aguarde um instante antes da próxima ação.");
  }
}

async function footballDataGet(endpoint, params = {}) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) {
    throw new HttpsError("failed-precondition", "Configure FOOTBALL_DATA_TOKEN no servidor para consultar partidas e resultados.");
  }
  const url = new URL(endpoint, "https://api.football-data.org/v4/");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  let response;
  try {
    response = await fetch(url, {
      headers: { "X-Auth-Token": token },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new HttpsError("resource-exhausted", "football-data.org não respondeu. Tente novamente.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new HttpsError("failed-precondition", "football-data.org recusou o token ou o plano não permite esta consulta.");
  }
  if (response.status === 429) {
    throw new HttpsError("resource-exhausted", "Limite de consultas do football-data.org atingido. Tente novamente mais tarde.");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload?.message === "string" ? `: ${payload.message.slice(0, 180)}` : ".";
    throw new HttpsError("failed-precondition", `football-data.org respondeu com erro ${response.status}${detail}`);
  }
  if (payload.errorCode || payload.message) {
    throw new HttpsError("failed-precondition", "football-data.org recusou a consulta. Verifique token, competições autorizadas e cota.");
  }
  return payload;
}

function dateUtcOffset(date, days) {
  const timestamp = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function profitTotals(profitCents) {
  return {
    totalWonCents: FieldValue.increment(profitCents > 0 ? profitCents : 0),
    totalLostCents: FieldValue.increment(profitCents < 0 ? -profitCents : 0),
  };
}

function registrarPremioNivel(transaction, userRef, requestId, progression) {
  if (progression.rewardCents <= 0) return;
  transaction.create(userRef.collection("transactions").doc(`${requestId}_level_reward`), {
    description: `Nível ${progression.level} · prêmio`,
    deltaCents: progression.rewardCents,
    type: "level_reward",
    createdAt: FieldValue.serverTimestamp(),
  });
}

function registrarPremiosMissao(transaction, userRef, missions) {
  for (const reward of missions.rewards) {
    transaction.create(userRef.collection("transactions").doc(reward.id), {
      description: reward.description,
      deltaCents: reward.deltaCents,
      type: "mission_reward",
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

exports.ensurePlayerProfile = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const authUser = await getAuth().getUser(uid);
  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const emailName = authUser.email?.split("@")[0]?.trim() || "";
  const fallbackName = emailName.length >= 2 && emailName.length <= 24 ? emailName : "Jogador";
  const displayName = safeName(authUser.displayName, fallbackName);

  await database.runTransaction(async (transaction) => {
    const [userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    const existing = userSnapshot.data() || {};
    const { balanceCents } = initializeBalance(existing, INITIAL_BALANCE_CENTS);
    const gamesPlayed = Number.isSafeInteger(existing.gamesPlayed) ? existing.gamesPlayed : 0;
    const username = normalizeUsername(existing.username) || "";

    const profile = {
      ...existing,
      uid,
      displayName: safeName(existing.displayName, displayName),
      email: authUser.email || existing.email || "",
      balanceCents,
      balanceInitialized: true,
      level: Math.max(
        Number.isSafeInteger(existing.level) && existing.level > 0 ? existing.level : 1,
        levelProgress(gamesPlayed).level,
      ),
      avatarUrl: existing.avatarUrl || authUser.photoURL || "",
      avatarAsProfilePhoto: existing.avatarAsProfilePhoto === true,
      equippedAvatarItems: Array.isArray(existing.equippedAvatarItems) ? existing.equippedAvatarItems : [],
      equippedFrame: typeof existing.equippedFrame === "string" ? existing.equippedFrame : "",
      equippedTitle: typeof existing.equippedTitle === "string" ? existing.equippedTitle : "",
      username,
      profileSetupComplete: existing.profileSetupComplete === true && username !== "",
      pixKey: existing.pixKey || "",
      pixKeyType: existing.pixKeyType || "",
      pixKeyHash: existing.pixKeyHash || "",
      gamesPlayed,
      wins: Number.isSafeInteger(existing.wins) ? existing.wins : 0,
      inventory: Array.isArray(existing.inventory) ? existing.inventory : [],
      createdAt: existing.createdAt || FieldValue.serverTimestamp(),
    };
    const publicProfile = {
      displayName: profile.displayName,
      balanceCents: profile.balanceCents,
      level: profile.level,
      avatarUrl: profile.avatarUrl,
      avatarAsProfilePhoto: profile.avatarAsProfilePhoto,
      equippedAvatarItems: profile.equippedAvatarItems,
      equippedFrame: profile.equippedFrame,
      username: profile.username,
    };

    if (userSnapshot.exists) transaction.set(userRef, profile);
    else transaction.create(userRef, profile);
    if (rankSnapshot.exists) transaction.set(rankRef, publicProfile);
    else transaction.create(rankRef, publicProfile);
  });

  return { ok: true };
});

exports.updatePlayerProfile = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const displayName = safeName(request.data?.displayName, "");
  const username = normalizeUsername(request.data?.username);
  const bio = normalizeBio(request.data?.bio ?? "");
  const avatarUrl = typeof request.data?.avatarUrl === "string" ? request.data.avatarUrl.trim() : "";
  const avatarAsProfilePhoto = request.data?.avatarAsProfilePhoto === true;
  if (!displayName) {
    throw new HttpsError("invalid-argument", "O nome de exibição deve ter entre 2 e 24 caracteres.");
  }
  if (!username) {
    throw new HttpsError("invalid-argument", "Use um nome de usuário de 3 a 20 caracteres: letras, números e _.");
  }
  if (bio === null) {
    throw new HttpsError("invalid-argument", "A bio deve ter no máximo 160 caracteres.");
  }
  const fotoCloudinary = avatarUrl.startsWith("https://res.cloudinary.com/vwctfu9u/image/upload/");
  const fotoGoogle = /^https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com\//i.test(avatarUrl);
  if (avatarUrl && ((!fotoCloudinary && !fotoGoogle) || avatarUrl.length > 2_048)) {
    throw new HttpsError("invalid-argument", "A foto de perfil precisa estar armazenada no Cloudinary.");
  }

  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const usernameRef = database.collection("usernames").doc(username);
  await database.runTransaction(async (transaction) => {
    const [userSnapshot, rankSnapshot, usernameSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(rankRef),
      transaction.get(usernameRef),
    ]);
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }
    if (usernameSnapshot.exists && usernameSnapshot.data().uid !== uid) {
      throw new HttpsError("already-exists", "Este nome de usuário já está em uso.");
    }
    const oldUsername = normalizeUsername(userSnapshot.get("username"));
    const oldUsernameRef = oldUsername && oldUsername !== username
      ? database.collection("usernames").doc(oldUsername)
      : null;
    const oldUsernameSnapshot = oldUsernameRef ? await transaction.get(oldUsernameRef) : null;
    if (oldUsernameSnapshot?.exists && oldUsernameSnapshot.data().uid === uid) {
      transaction.delete(oldUsernameRef);
    }
    transaction.set(usernameRef, { uid, createdAt: FieldValue.serverTimestamp() });
    const equippedAvatarItems = Array.isArray(userSnapshot.get("equippedAvatarItems"))
      ? userSnapshot.get("equippedAvatarItems")
      : [];
    const changedFields = [
      ["displayName", displayName],
      ["username", username],
      ["bio", bio],
      ["avatarUrl", avatarUrl],
      ["avatarAsProfilePhoto", avatarAsProfilePhoto],
    ].filter(([field, value]) => userSnapshot.get(field) !== value).map(([field]) => field);
    transaction.update(userRef, {
      username,
      displayName,
      bio,
      avatarUrl,
      avatarAsProfilePhoto,
      equippedAvatarItems,
      profileSetupComplete: true,
    });
    transaction.update(rankRef, { username, displayName, avatarUrl, avatarAsProfilePhoto, equippedAvatarItems });
    if (changedFields.length > 0) {
      transaction.create(userRef.collection("accountActivity").doc(randomUUID()), {
        fields: changedFields,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: Date.now(),
      });
    }
  });
  return { ok: true, username, displayName, bio, avatarUrl, avatarAsProfilePhoto };
});

exports.registerPixKey = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const { normalized, type } = normalizePixKey(request.data?.key);
  const requestedType = String(request.data?.type || "").toLowerCase();
  if ((type === "email" && !["email", "e-mail"].includes(requestedType))
      || (type === "random" && !["random", "aleatória", "aleatoria"].includes(requestedType))) {
    throw new HttpsError("invalid-argument", "Tipo de chave incompatível.");
  }

  if (type === "email") {
    const authUser = await getAuth().getUser(uid);
    const verifiedEmail = String(authUser.email || "").toLowerCase();
    if (!authUser.emailVerified || normalized !== verifiedEmail) {
      throw new HttpsError("failed-precondition", "Confirme seu e-mail e use o mesmo endereço da conta.");
    }
  }

  const userRef = database.collection("users").doc(uid);
  const newHash = pixKeyHash(normalized);
  const newKeyRef = database.collection("pixKeys").doc(newHash);
  await database.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }
    const profile = userSnapshot.data();
    const oldHash = profile.pixKeyHash || "";
    const oldKeyRef = oldHash ? database.collection("pixKeys").doc(oldHash) : null;
    const newKeySnapshot = await transaction.get(newKeyRef);
    const oldKeySnapshot = oldKeyRef && oldHash !== newHash
      ? await transaction.get(oldKeyRef)
      : null;

    if (newKeySnapshot.exists && newKeySnapshot.data().uid !== uid) {
      throw new HttpsError("already-exists", "Esta chave já está vinculada a outra conta.");
    }
    if (oldKeySnapshot?.exists && oldKeySnapshot.data().uid === uid) {
      transaction.delete(oldKeyRef);
    }
    transaction.set(newKeyRef, { uid, createdAt: FieldValue.serverTimestamp() });
    transaction.update(userRef, {
      pixKey: normalized,
      pixKeyType: type,
      pixKeyHash: newHash,
    });
  });

  return { ok: true };
});

exports.lookupPixKey = onCall(async (request) => {
  authenticatedUid(request);
  const { normalized } = normalizePixKey(request.data?.key);
  const keySnapshot = await database.collection("pixKeys").doc(pixKeyHash(normalized)).get();
  if (!keySnapshot.exists) {
    throw new HttpsError("not-found", "Nenhuma conta encontrada para essa chave.");
  }
  const uid = keySnapshot.data().uid;
  const profileSnapshot = await database.collection("leaderboard").doc(uid).get();
  if (!profileSnapshot.exists) {
    throw new HttpsError("not-found", "Perfil do destinatário não encontrado.");
  }
  const profile = profileSnapshot.data();
  return {
    uid,
    displayName: profile.displayName || "Jogador",
    username: profile.username || "",
    level: profile.level || 1,
    avatarUrl: profile.avatarUrl || "",
  };
});

exports.transferByPixKey = onCall(async (request) => {
  const senderUid = authenticatedUid(request);
  const { normalized } = normalizePixKey(request.data?.key);
  const amountCents = request.data?.amountCents;
  const requestId = request.data?.requestId;
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > MAX_TRANSFER_CENTS) {
    throw new HttpsError("invalid-argument", "Valor da transferência inválido.");
  }
  if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Identificador da transferência inválido.");
  }

  const transferRef = database.collection("transfers").doc(requestId);
  const keyRef = database.collection("pixKeys").doc(pixKeyHash(normalized));
  const senderRef = database.collection("users").doc(senderUid);
  let response;

  await database.runTransaction(async (transaction) => {
    const previousTransfer = await transaction.get(transferRef);
    if (previousTransfer.exists) {
      const prior = previousTransfer.data();
      if (prior.senderUid !== senderUid) {
        throw new HttpsError("already-exists", "Identificador já utilizado.");
      }
      response = {
        transferId: requestId,
        recipientName: prior.recipientName,
        balanceCents: prior.senderBalanceAfter,
      };
      return;
    }

    const keySnapshot = await transaction.get(keyRef);
    if (!keySnapshot.exists) {
      throw new HttpsError("not-found", "Nenhuma conta encontrada para essa chave.");
    }
    const recipientUid = keySnapshot.data().uid;
    if (recipientUid === senderUid) {
      throw new HttpsError("invalid-argument", "Escolha a chave de outro usuário.");
    }

    const recipientRef = database.collection("users").doc(recipientUid);
    const senderRankRef = database.collection("leaderboard").doc(senderUid);
    const recipientRankRef = database.collection("leaderboard").doc(recipientUid);
    const senderHistoryRef = senderRef.collection("transactions").doc(requestId);
    const recipientHistoryRef = recipientRef.collection("transactions").doc(requestId);
    const [senderSnapshot, recipientSnapshot, senderRankSnapshot, recipientRankSnapshot] = await Promise.all([
      transaction.get(senderRef),
      transaction.get(recipientRef),
      transaction.get(senderRankRef),
      transaction.get(recipientRankRef),
    ]);

    if (!senderSnapshot.exists || !recipientSnapshot.exists
        || !senderRankSnapshot.exists || !recipientRankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Uma das contas ainda não está pronta.");
    }

    const sender = senderSnapshot.data();
    const recipient = recipientSnapshot.data();
    const senderBalance = sender.balanceCents || 0;
    const recipientBalance = recipient.balanceCents || 0;
    if (senderBalance < amountCents) {
      throw new HttpsError("failed-precondition", "Saldo insuficiente.");
    }

    const senderAfter = senderBalance - amountCents;
    const recipientAfter = recipientBalance + amountCents;
    const senderName = sender.displayName || "Jogador";
    const recipientName = recipient.displayName || "Jogador";
    const now = FieldValue.serverTimestamp();
    transaction.update(senderRef, { balanceCents: senderAfter });
    transaction.update(recipientRef, { balanceCents: recipientAfter });
    transaction.update(senderRankRef, { balanceCents: senderAfter });
    transaction.update(recipientRankRef, { balanceCents: recipientAfter });
    transaction.create(transferRef, {
      senderUid,
      recipientUid,
      senderName,
      recipientName,
      amountCents,
      senderBalanceAfter: senderAfter,
      createdAt: now,
    });
    transaction.create(senderHistoryRef, {
      description: `Para ${recipientName}`,
      deltaCents: -amountCents,
      type: "pix_transfer",
      transferId: requestId,
      counterpartyUid: recipientUid,
      createdAt: now,
    });
    transaction.create(recipientHistoryRef, {
      description: `De ${senderName}`,
      deltaCents: amountCents,
      type: "pix_transfer",
      transferId: requestId,
      counterpartyUid: senderUid,
      createdAt: now,
    });
    response = { transferId: requestId, recipientName, balanceCents: senderAfter };
  });

  return response;
});

exports.playGame = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const game = request.data?.game;
  const amountCents = request.data?.amountCents;
  const requestId = request.data?.requestId;
  if (!validateWager(amountCents, MAX_TRANSFER_CENTS)) {
    throw new HttpsError("invalid-argument", "Valor da aposta inválido.");
  }
  if (!new Set([
    "slots", "roulette", "coin", "dice", "parity", "scratch", "football",
    "rps",
    "memorySequence", "quizSprint", "codebreaker", "mazeRunner",
  ]).has(game)
      || typeof requestId !== "string"
      || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Jogo ou identificador inválido.");
  }

  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const requestRef = userRef.collection("gameRequests").doc(requestId);
  const transactionRef = userRef.collection("transactions").doc(requestId);
  const challengeRef = userRef.collection("soloChallenges").doc("current");
  let response;

  await database.runTransaction(async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) {
      response = previousRequest.data().response;
      return;
    }
    const [userSnapshot, rankSnapshot, challengeSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(rankRef),
      transaction.get(challengeRef),
    ]);
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }
    const profile = userSnapshot.data();
    if (SOLO_CHALLENGE_GAMES.has(game)) {
      const challenge = challengeSnapshot.exists ? challengeSnapshot.data() : null;
      const submittedSeed = typeof request.data?.selection === "string"
        ? request.data.selection.split(":", 1)[0]
        : "";
      if (!challenge || challenge.status !== "active" || challenge.game !== game
          || challenge.amountCents !== amountCents || challenge.seed !== submittedSeed
          || Date.now() - challenge.createdAtMs > SOLO_CHALLENGE_TTL_MS) {
        throw new HttpsError("failed-precondition", "Desafio expirado ou inválido. Inicie uma nova rodada.");
      }
    }
    const actionAtMs = Date.now();
    enforceGameCooldown(profile, actionAtMs);
    const balance = profile.balanceCents || 0;
    if (balance < amountCents) {
      throw new HttpsError("failed-precondition", "Saldo insuficiente.");
    }

    let result;
    let returnedCents;
    if (game === "slots") {
      result = spinSlots(amountCents);
      returnedCents = result.payoutCents;
    } else if (game === "roulette") {
      try {
        result = rouletteResult(
          request.data?.betType,
          request.data?.selection,
          randomInt(37),
          amountCents,
        );
        returnedCents = result.payoutCents;
      } catch {
        throw new HttpsError("invalid-argument", "Aposta de roleta inválida.");
      }
    } else {
      try {
        if (game === "coin") result = coinFlipResult(request.data?.selection, amountCents);
        else if (game === "dice") result = diceGuessResult(request.data?.selection, amountCents);
        else if (game === "parity") result = parityDiceResult(request.data?.selection, amountCents);
        else if (game === "football") result = footballShotResult(request.data?.selection, amountCents);
        else if (game === "rps") result = rockPaperScissorsResult(request.data?.selection, amountCents);
        else if (game === "memorySequence") result = memoryChallengeResult(request.data?.selection, amountCents);
        else if (game === "quizSprint") result = quizChallengeResult(request.data?.selection, amountCents);
        else if (game === "codebreaker") result = codebreakerChallengeResult(request.data?.selection, amountCents);
        else if (game === "mazeRunner") result = mazeChallengeResult(request.data?.selection, amountCents);
        else result = scratchCardResult(amountCents);
        returnedCents = result.payoutCents;
      } catch {
        throw new HttpsError("invalid-argument", "Aposta do minijogo inválida.");
      }
    }

    const deltaCents = returnedCents - amountCents;
    const balanceAfter = balance + deltaCents;
    if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
      throw new HttpsError("failed-precondition", "Saldo resultante inválido.");
    }
    const gamesPlayed = (profile.gamesPlayed || 0) + 1;
    const wins = (profile.wins || 0) + (returnedCents > amountCents ? 1 : 0);
    const progression = levelProgress(gamesPlayed);
    const missions = advanceMissionProgress(profile, actionAtMs);
    const balanceFinal = balanceAfter + progression.rewardCents + missions.totalRewardCents;
    if (!Number.isSafeInteger(balanceFinal)) {
      throw new HttpsError("failed-precondition", "Saldo resultante inválido.");
    }
    const gameNames = {
      coin: "Cara ou coroa",
      dice: "Dado",
      parity: "Par ou ímpar",
      scratch: "Raspadinha",
      football: "Futebol",
      rps: "Pedra, papel e tesoura",
      memorySequence: "Memória em sequência",
      quizSprint: "Desafio relâmpago",
      codebreaker: "Quebra-código",
      mazeRunner: "Labirinto",
    };
    const description = game === "slots"
      ? `Slots · ${result.reels.join(" ")}`
      : game === "roulette"
        ? `Roleta · ${result.number} ${result.color}`
        : `${gameNames[game]} · ${result.displayText}`;
    transaction.update(userRef, {
      balanceCents: balanceFinal,
      gamesPlayed,
      wins,
      level: progression.level,
      gamesTowardNextLevel: progression.gamesTowardNextLevel,
      lastGameActionAtMs: actionAtMs,
      ...missions.profileFields,
      ...profitTotals(deltaCents),
    });
    transaction.update(rankRef, { balanceCents: balanceFinal, level: progression.level });
    if (SOLO_CHALLENGE_GAMES.has(game)) {
      transaction.update(challengeRef, { status: "completed", completedAtMs: actionAtMs });
    }
    transaction.create(transactionRef, {
      description,
      deltaCents,
      createdAt: FieldValue.serverTimestamp(),
    });
    recordMinigameSettlement(transaction, userRef, {
      gameId: game,
      gameName: gameNames[game] || (game === "slots" ? "Slots" : "Roleta"),
      outcome: returnedCents > amountCents ? "won" : returnedCents < amountCents ? "lost" : "tied",
      netCents: deltaCents,
      summary: description,
      recordId: requestId,
      atMs: actionAtMs,
      clanId: typeof profile.clanId === "string" ? profile.clanId : "",
    });
    registrarPremioNivel(transaction, userRef, requestId, progression);
    registrarPremiosMissao(transaction, userRef, missions);
    response = {
      result: game === "slots"
        ? result.reels
        : game === "roulette"
          ? { number: result.number, color: result.color }
          : { display: result.displayText },
      payoutMultiplier: result.multiplier,
      deltaCents,
      balanceCents: balanceFinal,
      gamesPlayed,
      wins,
      level: progression.level,
      gamesTowardNextLevel: progression.gamesTowardNextLevel,
      levelRewardCents: progression.rewardCents,
      missionRewardCents: missions.totalRewardCents,
    };
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });

  return response;
});

exports.startSoloChallenge = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const game = request.data?.game;
  const amountCents = request.data?.amountCents;
  const requestId = request.data?.requestId;
  if (!SOLO_CHALLENGE_GAMES.has(game) || !validateWager(amountCents, MAX_TRANSFER_CENTS)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Desafio, aposta ou identificador inválido.");
  }
  const userRef = database.collection("users").doc(uid);
  const challengeRef = userRef.collection("soloChallenges").doc("current");
  let response;
  await database.runTransaction(async (transaction) => {
    const [profile, current] = await Promise.all([
      transaction.get(userRef),
      transaction.get(challengeRef),
    ]);
    if (!profile.exists || profile.get("isBlocked") === true) {
      throw new HttpsError("failed-precondition", "Perfil indisponível para jogar.");
    }
    const balanceCents = profile.get("balanceCents") || 0;
    if (balanceCents < amountCents) {
      throw new HttpsError("failed-precondition", "Saldo insuficiente.");
    }
    if (current.exists && current.get("status") === "active"
        && Date.now() - current.get("createdAtMs") <= SOLO_CHALLENGE_TTL_MS) {
      const challenge = current.data();
      if (challenge.game !== game || challenge.amountCents !== amountCents) {
        throw new HttpsError("failed-precondition", "Conclua o desafio ativo com a mesma aposta antes de trocar de jogo.");
      }
      response = { game: challenge.game, challengeId: challenge.requestId, seed: challenge.seed, resumed: true };
      return;
    }
    const seed = randomUUID();
    transaction.set(challengeRef, {
      game,
      requestId,
      seed,
      amountCents,
      status: "active",
      createdAtMs: Date.now(),
    });
    response = { game, challengeId: requestId, seed };
  });
  return response;
});

exports.queueJokenpoMatch = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const requestId = request.data?.requestId;
  const gameId = request.data?.gameId || "rps";
  if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || !["rps", "duelParity", "duelCoin", "duelMemory", "duelQuiz", "duelTarget"].includes(gameId)) {
    throw new HttpsError("invalid-argument", "Identificador de busca inválido.");
  }

  const queueRef = database.collection("jokenpoQueue").doc(uid);
  const userRef = database.collection("users").doc(uid);
  const waitingQuery = database.collection("jokenpoQueue").where("status", "==", "waiting").limit(25);
  let response;
  await database.runTransaction(async (transaction) => {
    const [queueSnapshot, userSnapshot] = await Promise.all([
      transaction.get(queueRef),
      transaction.get(userRef),
    ]);
    if (!userSnapshot.exists || userSnapshot.get("isBlocked") === true) {
      throw new HttpsError("failed-precondition", "Perfil indisponível para partidas.");
    }

    if (queueSnapshot.exists && queueSnapshot.get("status") === "matched") {
      const currentMatchId = queueSnapshot.get("matchId");
      const currentMatch = typeof currentMatchId === "string"
        ? await transaction.get(database.collection("jokenpoMatches").doc(currentMatchId))
        : null;
      if (currentMatch?.exists && currentMatch.get("status") === "playing") {
        response = { status: "matched", matchId: currentMatchId };
        return;
      }
    }

    const waitingSnapshot = await transaction.get(waitingQuery);
    const nowMs = Date.now();
    const staleQueueRefs = [];
    let opponentQueue = null;
    let opponentProfile = null;
    const candidates = [...waitingSnapshot.docs]
      .filter((document) => document.id !== uid && normalizeJokenpoGameId(document.get("gameId")) === gameId)
      .sort((left, right) => (left.get("createdAtMs") || 0) - (right.get("createdAtMs") || 0));
    for (const candidate of candidates) {
      const ageMs = nowMs - (candidate.get("createdAtMs") || 0);
      if (ageMs < 0 || ageMs > JOKENPO_QUEUE_TTL_MS) {
        staleQueueRefs.push(candidate.ref);
        continue;
      }
      const profile = await transaction.get(database.collection("users").doc(candidate.id));
      if (!profile.exists || profile.get("isBlocked") === true) {
        staleQueueRefs.push(candidate.ref);
        continue;
      }
      opponentQueue = candidate;
      opponentProfile = profile;
      break;
    }

    staleQueueRefs.forEach((ref) => transaction.delete(ref));
    if (opponentQueue == null || opponentProfile == null) {
      transaction.set(queueRef, {
        uid,
        status: "waiting",
        gameId,
        requestId,
        createdAtMs: nowMs,
        hasPlayed: false,
      });
      response = { status: "waiting", matchId: "" };
      return;
    }

    const matchId = randomUUID();
    const matchRef = database.collection("jokenpoMatches").doc(matchId);
    const playerUids = [uid, opponentQueue.id].sort();
    const playerNames = {
      [uid]: safeName(userSnapshot.get("displayName"), "Jogador"),
      [opponentQueue.id]: safeName(opponentProfile.get("displayName"), "Jogador"),
    };
    transaction.create(matchRef, {
      gameId,
      playerUids,
      playerNames,
      status: "playing",
      winnerUid: "",
      resultText: "",
      createdAtMs: nowMs,
    });
    transaction.set(queueRef, { uid, status: "matched", matchId, hasPlayed: false, updatedAtMs: nowMs });
    transaction.update(opponentQueue.ref, { status: "matched", matchId, hasPlayed: false, updatedAtMs: nowMs });
    response = { status: "matched", matchId };
  });
  return response;
});

function normalizeJokenpoGameId(gameId) {
  return !gameId || gameId === "jokenpo" ? "rps" : gameId;
}

exports.cancelJokenpoQueue = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const queueRef = database.collection("jokenpoQueue").doc(uid);
  let cancelled = false;
  await database.runTransaction(async (transaction) => {
    const queueSnapshot = await transaction.get(queueRef);
    if (!queueSnapshot.exists) return;
    if (queueSnapshot.get("status") === "matched") {
      throw new HttpsError("failed-precondition", "A partida já encontrou um adversário.");
    }
    transaction.delete(queueRef);
    cancelled = true;
  });
  return { ok: true, cancelled };
});

exports.requestJokenpoRematch = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const matchId = request.data?.matchId;
  const requestId = request.data?.requestId;
  if (typeof matchId !== "string" || !/^[a-f0-9-]{36}$/i.test(matchId)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Partida ou identificador de revanche inválido.");
  }

  const matchRef = database.collection("jokenpoMatches").doc(matchId);
  const requestRef = database.collection("users").doc(uid).collection("gameRequests").doc(requestId);
  let response;
  await database.runTransaction(async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) {
      response = previousRequest.get("response");
      return;
    }
    const matchSnapshot = await transaction.get(matchRef);
    if (!matchSnapshot.exists || matchSnapshot.get("status") !== "completed") {
      throw new HttpsError("failed-precondition", "A revanche só pode ser pedida após o fim da partida.");
    }
    const match = matchSnapshot.data();
    const playerUids = Array.isArray(match.playerUids) ? match.playerUids : [];
    if (playerUids.length !== 2 || !playerUids.includes(uid)) {
      throw new HttpsError("permission-denied", "Você não participou desta partida.");
    }
    const nowMs = Date.now();
    const existingRequests = match.rematchRequests && typeof match.rematchRequests === "object"
      ? match.rematchRequests
      : {};
    const validRequests = Object.fromEntries(Object.entries(existingRequests).filter(([, atMs]) => (
      Number.isFinite(atMs) && atMs <= nowMs && nowMs - atMs <= 2 * 60_000
    )));
    const queueRefs = playerUids.map((playerUid) => database.collection("jokenpoQueue").doc(playerUid));
    const queues = await Promise.all(queueRefs.map((ref) => transaction.get(ref)));
    const activeWaitingQueue = queues.some((queue) => (
      queue.exists && queue.get("status") === "waiting"
        && Number.isFinite(queue.get("createdAtMs"))
        && queue.get("createdAtMs") <= nowMs
        && nowMs - queue.get("createdAtMs") <= JOKENPO_QUEUE_TTL_MS
    ));
    const conflictingMatchIds = [...new Set(queues
      .filter((queue) => queue.exists && queue.get("status") === "matched"
        && typeof queue.get("matchId") === "string" && queue.get("matchId") !== matchId)
      .map((queue) => queue.get("matchId")))];
    const conflictingMatches = await Promise.all(conflictingMatchIds.map((id) => (
      transaction.get(database.collection("jokenpoMatches").doc(id))
    )));
    const activeOtherMatch = activeWaitingQueue || conflictingMatches.some((snapshot) => (
      snapshot.exists && snapshot.get("status") === "playing"
    ));
    if (activeOtherMatch) throw new HttpsError("failed-precondition", "Termine sua partida atual antes de pedir revanche.");

    if (playerUids.some((playerUid) => playerUid !== uid && validRequests[playerUid])) {
      const newMatchId = randomUUID();
      const newMatchRef = database.collection("jokenpoMatches").doc(newMatchId);
      const playerNames = match.playerNames || {};
      transaction.create(newMatchRef, {
        gameId: normalizeJokenpoGameId(match.gameId),
        playerUids,
        playerNames,
        status: "playing",
        winnerUid: "",
        resultText: "",
        createdAtMs: nowMs,
        rematchOf: matchId,
      });
      for (let index = 0; index < playerUids.length; index += 1) {
        transaction.set(queueRefs[index], {
          uid: playerUids[index],
          status: "matched",
          matchId: newMatchId,
          hasPlayed: false,
          updatedAtMs: nowMs,
        });
      }
      transaction.update(matchRef, {
        rematchRequests: { ...validRequests, [uid]: nowMs },
        rematchMatchId: newMatchId,
        rematchStartedAtMs: nowMs,
      });
      response = { status: "matched", matchId: newMatchId };
    } else {
      transaction.update(matchRef, {
        rematchRequests: { ...validRequests, [uid]: nowMs },
        rematchExpiresAtMs: nowMs + 2 * 60_000,
      });
      response = { status: "waiting", matchId: "" };
    }
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });
  return response;
});

exports.submitJokenpoChoice = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const matchId = request.data?.matchId;
  const choice = request.data?.choice;
  const requestId = request.data?.requestId;
  const choiceSupported = typeof choice === "string" && choice.length <= 40
    && (/^(rock|paper|scissors|even|odd|heads|tails)(,(even|odd|heads|tails)){0,4}$/.test(choice)
      || /^[0-3]{7}$/.test(choice)
      || /^[0-3](,[0-3]){4}$/.test(choice)
      || /^[0-9](,[0-9]){4}$/.test(choice));
  if (typeof matchId !== "string" || !/^[a-f0-9-]{36}$/i.test(matchId)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || !choiceSupported) {
    throw new HttpsError("invalid-argument", "Partida, jogada ou identificador inválido.");
  }

  const matchRef = database.collection("jokenpoMatches").doc(matchId);
  const queueRef = database.collection("jokenpoQueue").doc(uid);
  const movesRef = matchRef.collection("moves");
  const ownMoveRef = movesRef.doc(uid);
  const requestRef = database.collection("users").doc(uid).collection("gameRequests").doc(requestId);
  let response;
  await database.runTransaction(async (transaction) => {
    const [previousRequest, matchSnapshot, queueSnapshot, ownMoveSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(matchRef),
      transaction.get(queueRef),
      transaction.get(ownMoveRef),
    ]);
    if (previousRequest.exists) {
      response = previousRequest.get("response");
      return;
    }
    if (!matchSnapshot.exists) throw new HttpsError("not-found", "Partida não encontrada.");
    const match = matchSnapshot.data();
    const gameId = normalizeJokenpoGameId(match.gameId);
    const validChoice = gameId === "rps"
      ? ["rock", "paper", "scissors"].includes(choice)
      : gameId === "duelParity"
        ? /^(even|odd)$|^(even|odd)(,(even|odd)){4}$/.test(choice)
        : gameId === "duelCoin"
          ? /^(heads|tails)$|^(heads|tails)(,(heads|tails)){4}$/.test(choice)
          : gameId === "duelMemory"
            ? /^[0-3]{7}$/.test(choice)
            : gameId === "duelQuiz"
              ? /^[0-3](,[0-3]){4}$/.test(choice)
              : gameId === "duelTarget" && /^[0-9](,[0-9]){4}$/.test(choice);
    if (!validChoice) throw new HttpsError("invalid-argument", "Jogada inválida para este minijogo.");
    const playerUids = Array.isArray(match.playerUids) ? match.playerUids : [];
    if (!playerUids.includes(uid)) throw new HttpsError("permission-denied", "Você não participa desta partida.");
    if (match.status !== "playing") throw new HttpsError("failed-precondition", "A partida já terminou.");
    if (!queueSnapshot.exists || queueSnapshot.get("matchId") !== matchId) {
      throw new HttpsError("failed-precondition", "Sua fila de partida não está ativa.");
    }
    if (queueSnapshot.get("hasPlayed") === true || ownMoveSnapshot.exists) {
      throw new HttpsError("already-exists", "Sua jogada já foi enviada.");
    }
    const opponentUid = playerUids.find((playerUid) => playerUid !== uid);
    if (!opponentUid) throw new HttpsError("failed-precondition", "A partida não tem dois jogadores.");
    const opponentMoveRef = movesRef.doc(opponentUid);
    const opponentMoveSnapshot = await transaction.get(opponentMoveRef);
    const settlementProfiles = opponentMoveSnapshot.exists
      ? await Promise.all(playerUids.map((playerUid) => transaction.get(database.collection("users").doc(playerUid))))
      : [];
    transaction.create(ownMoveRef, { uid, choice, createdAtMs: Date.now() });
    transaction.update(queueRef, { hasPlayed: true, updatedAtMs: Date.now() });

    response = { status: "playing", winnerUid: "", resultText: "Aguardando o adversário escolher." };
    if (opponentMoveSnapshot.exists) {
      const choices = {
        [uid]: choice,
        [opponentUid]: opponentMoveSnapshot.get("choice"),
      };
      const orderedChoices = playerUids.map((playerUid) => choices[playerUid]);
      const result = resolveOnlineDuel(gameId, orderedChoices[0], orderedChoices[1], randomInt, matchId);
      const winnerUid = result.winnerIndex < 0 ? "" : playerUids[result.winnerIndex];
      const resultText = `${result.result.displayText}${winnerUid ? "" : " · Empate"}`;
      transaction.update(matchRef, {
        choices,
        status: "completed",
        winnerUid,
        resultText,
        updatedAtMs: Date.now(),
      });
      const settledAtMs = Date.now();
      const gameNames = {
        rps: "Pedra, papel e tesoura",
        duelParity: "Par ou ímpar",
        duelCoin: "Cara ou coroa",
        duelMemory: "Memória em duelo",
        duelQuiz: "Quiz em duelo",
        duelTarget: "Mira certeira",
      };
      playerUids.forEach((playerUid, index) => {
        const outcome = winnerUid ? (winnerUid === playerUid ? "won" : "lost") : "tied";
        recordMinigameSettlement(
          transaction,
          database.collection("users").doc(playerUid),
          {
            gameId,
            gameName: gameNames[gameId] || "Duelo",
            outcome,
            summary: resultText,
            recordId: matchId,
            atMs: settledAtMs,
            clanId: typeof settlementProfiles[index]?.get("clanId") === "string"
              ? settlementProfiles[index].get("clanId")
              : "",
          },
        );
      });
      response = { status: "completed", winnerUid, resultText };
    }
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });
  return response;
});

exports.listFootballMatches = onCall(async (request) => {
  authenticatedUid(request);
  const date = request.data?.date || new Date().toISOString().slice(0, 10);
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpsError("invalid-argument", "Data de partidas inválida.");
  }
  const dayOffset = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.now()) / 86_400_000);
  if (!Number.isFinite(dayOffset) || dayOffset < -1 || dayOffset > 7) {
    throw new HttpsError("invalid-argument", "Consulte partidas de hoje ou dos próximos 7 dias.");
  }
  const [fixturesPayload, historyPayload] = await Promise.all([
    footballDataGet("matches", { dateFrom: date, dateTo: date }),
    footballDataGet("matches", { dateFrom: dateUtcOffset(date, -9), dateTo: date }),
  ]);
  const history = parseFootballDataMatches(historyPayload);
  const fixtures = parseFootballDataMatches(fixturesPayload)
    .filter((fixture) => fixture.status === "NS" && fixture.kickoffMs > Date.now());
  const matches = fixtures.map((fixture) => {
    const markets = estimateMatchMarkets(fixture, history);
    const home = markets.find((option) => option.marketId === "match_winner" && option.selectionId === "home");
    const away = markets.find((option) => option.marketId === "match_winner" && option.selectionId === "away");
    return {
      ...fixture,
      markets,
      homeOddsBps: home?.oddsBps || 0,
      awayOddsBps: away?.oddsBps || 0,
    };
  });
  return { date, matches: matches.slice(0, 50) };
});

exports.listMySportsBets = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const snapshot = await database.collection("sportsBets")
    .where("uid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(30)
    .get();
  return {
    bets: snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
  };
});

exports.placeSportsBet = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const rawLegs = Array.isArray(request.data?.legs)
    ? request.data.legs
    : [{ fixtureId: request.data?.fixtureId, marketId: "match_winner", selectionId: request.data?.selection }];
  const amountCents = request.data?.amountCents;
  const requestId = request.data?.requestId;
  const legs = rawLegs.map((leg) => ({
    fixtureId: leg?.fixtureId,
    marketId: leg?.marketId,
    selectionId: leg?.selectionId,
    expectedOddsBps: leg?.expectedOddsBps,
  }));
  const validLeg = (leg) => Number.isSafeInteger(leg.fixtureId) && leg.fixtureId > 0
    && ((leg.marketId === "match_winner" && ["home", "draw", "away"].includes(leg.selectionId))
      || (leg.marketId === "total_goals" && /^(over|under)_\d+(?:_\d+)?$/.test(leg.selectionId || ""))
      || (leg.marketId === "both_teams_score" && ["yes", "no"].includes(leg.selectionId)))
    && (leg.expectedOddsBps == null
      || (Number.isSafeInteger(leg.expectedOddsBps) && leg.expectedOddsBps > 10_000));
  if (legs.length < 1 || legs.length > 10 || legs.some((leg) => !validLeg(leg))
      || new Set(legs.map((leg) => leg.fixtureId)).size !== legs.length
      || !validateWager(amountCents, MAX_TRANSFER_CENTS)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Seleções, partidas, aposta ou identificador inválido. Use até 10 partidas diferentes.");
  }

  const betRef = database.collection("sportsBets").doc(requestId);
  const legKey = (leg) => `${leg.fixtureId}:${leg.marketId}:${leg.selectionId}`;
  const sameTicket = (bet) => {
    const storedLegs = Array.isArray(bet.legs) && bet.legs.length > 0
      ? bet.legs
      : [{ fixtureId: bet.fixtureId, marketId: "match_winner", selectionId: bet.selection }];
    return bet.uid === uid && bet.stakeCents === amountCents
      && JSON.stringify(storedLegs.map(legKey)) === JSON.stringify(legs.map(legKey));
  };
  const previous = await betRef.get();
  if (previous.exists) {
    const bet = previous.data();
    if (!sameTicket(bet)) {
      throw new HttpsError("already-exists", "Identificador de aposta já utilizado.");
    }
    return { betId: requestId, status: bet.status, oddsBps: bet.oddsBps, payoutPotentialCents: bet.payoutPotentialCents };
  }

  const date = new Date().toISOString().slice(0, 10);
  const [fixturesPayload, historyPayload] = await Promise.all([
    footballDataGet("matches", { dateFrom: date, dateTo: date }),
    footballDataGet("matches", { dateFrom: dateUtcOffset(date, -9), dateTo: date }),
  ]);
  const fixtures = parseFootballDataMatches(fixturesPayload);
  const history = parseFootballDataMatches(historyPayload);
  const quotedLegs = legs.map((leg) => {
    const fixture = fixtures.find((item) => item.fixtureId === leg.fixtureId);
    if (!fixture || fixture.status !== "NS" || fixture.kickoffMs <= Date.now()) {
      throw new HttpsError("failed-precondition", "Só é possível apostar antes do início de cada partida.");
    }
    const quote = estimateMatchMarkets(fixture, history)
      .find((option) => option.marketId === leg.marketId && option.selectionId === leg.selectionId);
    if (!quote || quote.oddsBps <= 10_000) {
      throw new HttpsError("failed-precondition", "Não foi possível calcular a odd para uma das seleções.");
    }
    if (leg.expectedOddsBps != null && leg.expectedOddsBps !== quote.oddsBps) {
      throw new HttpsError("failed-precondition", "A estimativa mudou. Atualize as partidas e confira o bilhete novamente.");
    }
    return { ...fixture, ...quote, fixtureId: leg.fixtureId };
  });
  let oddsBps;
  try {
    oddsBps = combinedOddsBps(quotedLegs);
  } catch {
    throw new HttpsError("invalid-argument", "A odd total do bilhete excede o limite permitido.");
  }
  const payoutPotentialCents = sportsPayoutCents(amountCents, oddsBps);
  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const historyRef = userRef.collection("transactions").doc(`sports_bet_${requestId}`);
  let response;
  await database.runTransaction(async (transaction) => {
    const [userSnapshot, rankSnapshot, betSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(rankRef),
      transaction.get(betRef),
    ]);
    if (betSnapshot.exists) {
      const bet = betSnapshot.data();
      if (!sameTicket(bet)) {
        throw new HttpsError("already-exists", "Identificador de aposta já utilizado.");
      }
      response = { betId: requestId, status: bet.status, oddsBps: bet.oddsBps, payoutPotentialCents: bet.payoutPotentialCents };
      return;
    }
    if (!userSnapshot.exists || !rankSnapshot.exists) throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    const balanceCents = userSnapshot.get("balanceCents") || 0;
    if (balanceCents < amountCents) throw new HttpsError("failed-precondition", "Saldo insuficiente.");
    const balanceAfter = balanceCents - amountCents;
    const selectionName = quotedLegs.length === 1 ? quotedLegs[0].selectionName : `${quotedLegs.length} seleções`;
    const primaryLeg = quotedLegs[0];
    const bet = {
      uid,
      fixtureId: primaryLeg.fixtureId,
      league: primaryLeg.league,
      homeTeam: primaryLeg.homeTeam,
      awayTeam: primaryLeg.awayTeam,
      kickoffMs: primaryLeg.kickoffMs,
      selection: quotedLegs.length === 1 ? primaryLeg.selectionId : "multiple",
      selectionName,
      marketId: quotedLegs.length === 1 ? primaryLeg.marketId : "multiple",
      legs: quotedLegs.map((leg) => ({
        fixtureId: leg.fixtureId,
        league: leg.league,
        homeTeam: leg.homeTeam,
        awayTeam: leg.awayTeam,
        kickoffMs: leg.kickoffMs,
        marketId: leg.marketId,
        marketName: leg.marketName,
        selectionId: leg.selectionId,
        selectionName: leg.selectionName,
        line: leg.line,
        oddsBps: leg.oddsBps,
        bookmaker: leg.bookmaker,
      })),
      oddsBps,
      stakeCents: amountCents,
      payoutPotentialCents,
      status: "open",
      createdAt: FieldValue.serverTimestamp(),
    };
    transaction.update(userRef, { balanceCents: balanceAfter });
    transaction.update(rankRef, { balanceCents: balanceAfter });
    transaction.create(betRef, bet);
    transaction.create(historyRef, {
      description: `Aposta esportiva · ${selectionName} (${(oddsBps / 10_000).toFixed(2)}x)`,
      deltaCents: -amountCents,
      type: "sports_bet",
      betId: requestId,
      createdAt: FieldValue.serverTimestamp(),
    });
    response = { betId: requestId, status: "open", oddsBps, payoutPotentialCents, balanceCents: balanceAfter };
  });
  return response;
});

exports.settleMySportsBets = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const openBets = await database.collection("sportsBets")
    .where("uid", "==", uid)
    .where("status", "==", "open")
    .limit(10)
    .get();
  let settledCount = 0;
  const allLegs = openBets.docs.flatMap((document) => {
    const bet = document.data();
    return Array.isArray(bet.legs) && bet.legs.length > 0
      ? bet.legs
      : [{ fixtureId: bet.fixtureId, kickoffMs: bet.kickoffMs, homeTeam: bet.homeTeam, awayTeam: bet.awayTeam }];
  });
  const playedLegs = allLegs.filter((leg) => Number.isFinite(leg.kickoffMs) && leg.kickoffMs <= Date.now());
  if (playedLegs.length === 0) return { settledCount };
  const dateTo = new Date().toISOString().slice(0, 10);
  const earliestKickoffMs = Math.min(...playedLegs.map((leg) => leg.kickoffMs));
  const earliestAllowedMs = Date.parse(`${dateTo}T00:00:00Z`) - 9 * 86_400_000;
  const dateFrom = new Date(Math.max(earliestKickoffMs, earliestAllowedMs)).toISOString().slice(0, 10);
  const fixturesPayload = await footballDataGet("matches", { dateFrom, dateTo });
  const fixtures = parseFootballDataMatches(fixturesPayload);
  const normalizeTeam = (name) => String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const betDocument of openBets.docs) {
    const bet = betDocument.data();
    const legs = Array.isArray(bet.legs) && bet.legs.length > 0
      ? bet.legs
      : [{
        fixtureId: bet.fixtureId,
        marketId: "match_winner",
        selectionId: bet.selection,
        oddsBps: bet.oddsBps,
      }];
    const results = await Promise.all(legs.map(async (leg) => {
      const fixture = fixtures.find((item) => item.fixtureId === leg.fixtureId)
        || fixtures.find((item) => normalizeTeam(item.homeTeam) === normalizeTeam(leg.homeTeam)
          && normalizeTeam(item.awayTeam) === normalizeTeam(leg.awayTeam)
          && Math.abs(item.kickoffMs - leg.kickoffMs) <= 36 * 60 * 60 * 1_000);
      return { leg, fixture, outcome: settleSportsSelection(fixture, leg) };
    }));
    const lost = results.some((item) => item.outcome === "lost");
    if (!lost && results.some((item) => item.outcome == null)) continue;
    const betRef = betDocument.ref;
    const userRef = database.collection("users").doc(uid);
    const rankRef = database.collection("leaderboard").doc(uid);
    const historyRef = userRef.collection("transactions").doc(`sports_settlement_${betDocument.id}`);
    await database.runTransaction(async (transaction) => {
      const [betSnapshot, userSnapshot, rankSnapshot] = await Promise.all([
        transaction.get(betRef),
        transaction.get(userRef),
        transaction.get(rankRef),
      ]);
      if (!betSnapshot.exists || betSnapshot.get("status") !== "open") return;
      if (!userSnapshot.exists || !rankSnapshot.exists) throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
      const currentBet = betSnapshot.data();
      const won = !lost && results.every((item) => item.outcome === "won" || item.outcome === "void");
      const activeLegs = results.filter((item) => item.outcome !== "void").map((item) => item.leg);
      const effectiveOddsBps = activeLegs.length > 0 ? combinedOddsBps(activeLegs) : 10_000;
      const payoutCents = won
        ? effectiveOddsBps === 10_000 ? currentBet.stakeCents : sportsPayoutCents(currentBet.stakeCents, effectiveOddsBps)
        : 0;
      const profitCents = payoutCents - currentBet.stakeCents;
      const profile = userSnapshot.data();
      const gamesPlayed = (profile.gamesPlayed || 0) + 1;
      const wins = (profile.wins || 0) + (profitCents > 0 ? 1 : 0);
      const progression = levelProgress(gamesPlayed);
      const missions = advanceMissionProgress(profile, Date.now());
      const sportsMission = legs.length >= 2
        ? advanceSportsMissionProgress(profile, Date.now())
        : { profileFields: {}, rewards: [], totalRewardCents: 0 };
      const balanceCents = (profile.balanceCents || 0) + payoutCents
        + progression.rewardCents + missions.totalRewardCents + sportsMission.totalRewardCents;
      if (!Number.isSafeInteger(balanceCents)) throw new HttpsError("failed-precondition", "Saldo resultante inválido.");
      transaction.update(userRef, {
        balanceCents,
        gamesPlayed,
        wins,
        level: progression.level,
        gamesTowardNextLevel: progression.gamesTowardNextLevel,
        ...missions.profileFields,
        ...sportsMission.profileFields,
        ...profitTotals(profitCents),
      });
      transaction.update(rankRef, { balanceCents, level: progression.level });
      transaction.update(betRef, {
        status: "settled",
        result: legs.length === 1 && legs[0].marketId === "match_winner"
          ? fixtureWinner(results[0].fixture)
          : won ? "won" : "lost",
        legResults: results.map(({ leg, outcome }) => ({
          fixtureId: leg.fixtureId,
          marketId: leg.marketId,
          selectionId: leg.selectionId,
          outcome,
        })),
        payoutCents,
        profitCents,
        settledAt: FieldValue.serverTimestamp(),
      });
      transaction.create(historyRef, {
        description: `Aposta esportiva · ${won ? "bilhete vencedor" : "bilhete perdido"}`,
        deltaCents: payoutCents,
        type: "sports_settlement",
        betId: betDocument.id,
        createdAt: FieldValue.serverTimestamp(),
      });
      registrarPremioNivel(transaction, userRef, betDocument.id, progression);
      registrarPremiosMissao(transaction, userRef, missions);
      registrarPremiosMissao(transaction, userRef, sportsMission);
    });
    settledCount += 1;
  }
  return { settledCount };
});

function minesStateResponse(game, resumed = false) {
  const safeCells = Array.isArray(game.safeCells) ? game.safeCells : [];
  const payout = safeCells.length > 0
    ? minesCashoutPayout(game.amountCents, game.mineCount, safeCells.length, game.rtpBps)
    : { payoutCents: 0, multiplierBps: 10_000 };
  return {
    gameId: game.gameId,
    status: game.status,
    amountCents: game.amountCents,
    mineCount: game.mineCount,
    safeCells,
    mineCells: game.status === "lost" ? game.mineCells : [],
    payoutCents: game.status === "active" ? payout.payoutCents : game.payoutCents || 0,
    multiplierBps: game.status === "active" ? payout.multiplierBps : game.multiplierBps || 10_000,
    resumed,
  };
}

exports.startMines = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const amountCents = request.data?.amountCents;
  const mineCount = request.data?.mineCount;
  const requestId = request.data?.requestId;
  if (!validateWager(amountCents, MAX_TRANSFER_CENTS)
      || !Number.isInteger(mineCount) || mineCount < 1 || mineCount > 24
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Aposta, quantidade de minas ou identificador inválido.");
  }

  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const gameRef = userRef.collection("games").doc("mines");
  const requestRef = userRef.collection("gameRequests").doc(requestId);
  const settingsRef = database.collection("systemSettings").doc("games");
  const historyRef = userRef.collection("transactions").doc(`${requestId}_mines_bet`);
  const gameId = randomUUID();
  const mineCells = createMinefield(mineCount);
  const startedAtMs = Date.now();
  let response;

  await database.runTransaction(async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) {
      response = previousRequest.data().response;
      return;
    }
    const [gameSnapshot, userSnapshot, rankSnapshot, settingsSnapshot] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(userRef),
      transaction.get(rankRef),
      transaction.get(settingsRef),
    ]);
    if (gameSnapshot.exists && gameSnapshot.get("status") === "active") {
      response = minesStateResponse(gameSnapshot.data(), true);
      transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
      return;
    }
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }
    const settings = settingsSnapshot.data() || {};
    const minimumMines = Number.isInteger(settings.minesMinCount) ? settings.minesMinCount : 1;
    const maximumMines = Number.isInteger(settings.minesMaxCount) ? settings.minesMaxCount : 24;
    const rtpBps = Number.isInteger(settings.minesRtpBps) ? settings.minesRtpBps : DEFAULT_MINES_RTP_BPS;
    if (mineCount < minimumMines || mineCount > maximumMines) {
      throw new HttpsError("failed-precondition", `Escolha entre ${minimumMines} e ${maximumMines} minas.`);
    }
    if (rtpBps < 9_000 || rtpBps > 10_000) {
      throw new HttpsError("failed-precondition", "Configuração de retorno de Minas inválida.");
    }
    const profile = userSnapshot.data();
    enforceGameCooldown(profile, startedAtMs);
    const balance = profile.balanceCents || 0;
    if (balance < amountCents) {
      throw new HttpsError("failed-precondition", "Saldo insuficiente.");
    }
    const balanceAfter = balance - amountCents;
    const game = {
      gameId,
      status: "active",
      amountCents,
      mineCount,
      mineCells,
      safeCells: [],
      rtpBps,
      startedAtMs,
      createdAt: FieldValue.serverTimestamp(),
    };
    transaction.update(userRef, { balanceCents: balanceAfter, lastGameActionAtMs: startedAtMs });
    transaction.update(rankRef, { balanceCents: balanceAfter });
    transaction.set(gameRef, game);
    transaction.create(historyRef, {
      description: `Minas · aposta (${mineCount} minas)`,
      deltaCents: -amountCents,
      createdAt: FieldValue.serverTimestamp(),
    });
    response = { ...minesStateResponse(game), resumed: false };
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });

  return response;
});

exports.getActiveMines = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const gameSnapshot = await database.collection("users").doc(uid).collection("games").doc("mines").get();
  if (!gameSnapshot.exists || gameSnapshot.get("status") !== "active") return { status: "none" };
  return minesStateResponse(gameSnapshot.data(), true);
});

exports.revealMinesCell = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const gameId = request.data?.gameId;
  const cell = request.data?.cell;
  const requestId = request.data?.requestId;
  if (typeof gameId !== "string" || !/^[a-f0-9-]{36}$/i.test(gameId)
      || !Number.isInteger(cell) || cell < 0 || cell >= 25
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Casa ou identificador da partida inválido.");
  }

  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const gameRef = userRef.collection("games").doc("mines");
  const requestRef = userRef.collection("gameRequests").doc(requestId);
  let response;

  await database.runTransaction(async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) {
      response = previousRequest.data().response;
      return;
    }
    const [gameSnapshot, userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    if (!gameSnapshot.exists || gameSnapshot.get("gameId") !== gameId
        || gameSnapshot.get("status") !== "active") {
      throw new HttpsError("failed-precondition", "Esta partida de Minas não está ativa.");
    }
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }
    const game = gameSnapshot.data();
    const safeCells = Array.isArray(game.safeCells) ? game.safeCells : [];
    if (safeCells.includes(cell)) {
      throw new HttpsError("failed-precondition", "Esta casa já foi revelada.");
    }
    const nowMs = Date.now();
    const profile = userSnapshot.data();
    if (game.mineCells.includes(cell)) {
      const gamesPlayed = (profile.gamesPlayed || 0) + 1;
      const progression = levelProgress(gamesPlayed);
      const missions = advanceMissionProgress(profile, nowMs);
      const balanceFinal = (profile.balanceCents || 0) + progression.rewardCents + missions.totalRewardCents;
      if (!Number.isSafeInteger(balanceFinal)) {
        throw new HttpsError("failed-precondition", "Saldo resultante inválido.");
      }
      const profitCents = -game.amountCents;
      transaction.update(userRef, {
        balanceCents: balanceFinal,
        gamesPlayed,
        wins: profile.wins || 0,
        level: progression.level,
        gamesTowardNextLevel: progression.gamesTowardNextLevel,
        lastGameActionAtMs: nowMs,
        ...missions.profileFields,
        ...profitTotals(profitCents),
      });
      transaction.update(rankRef, { balanceCents: balanceFinal, level: progression.level });
      transaction.update(gameRef, {
        status: "lost",
        safeCells,
        hitCell: cell,
        settledAt: FieldValue.serverTimestamp(),
        payoutCents: 0,
        profitCents,
      });
      recordMinigameSettlement(transaction, userRef, {
        gameId: "mines",
        gameName: "Minas",
        outcome: "lost",
        netCents: profitCents,
        summary: `Minas · mina na casa ${cell + 1}`,
        recordId: `mines_${gameId}`,
        atMs: nowMs,
        clanId: typeof profile.clanId === "string" ? profile.clanId : "",
      });
      registrarPremioNivel(transaction, userRef, requestId, progression);
      registrarPremiosMissao(transaction, userRef, missions);
      response = {
        ...minesStateResponse({ ...game, status: "lost", safeCells, payoutCents: 0, multiplierBps: 10_000 }),
        hitCell: cell,
        balanceCents: balanceFinal,
        profitCents,
        gamesPlayed,
        level: progression.level,
        levelRewardCents: progression.rewardCents,
        missionRewardCents: missions.totalRewardCents,
      };
    } else {
      const nextSafeCells = [...safeCells, cell];
      const payout = minesCashoutPayout(game.amountCents, game.mineCount, nextSafeCells.length, game.rtpBps);
      transaction.update(userRef, { lastGameActionAtMs: nowMs });
      transaction.update(gameRef, { safeCells: nextSafeCells, lastActionAtMs: nowMs });
      response = {
        ...minesStateResponse({ ...game, safeCells: nextSafeCells }),
        lastSafeCell: cell,
        status: "active",
      };
    }
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });

  return response;
});

exports.cashOutMines = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const gameId = request.data?.gameId;
  const requestId = request.data?.requestId;
  if (typeof gameId !== "string" || !/^[a-f0-9-]{36}$/i.test(gameId)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Identificador da partida inválido.");
  }

  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const gameRef = userRef.collection("games").doc("mines");
  const requestRef = userRef.collection("gameRequests").doc(requestId);
  const historyRef = userRef.collection("transactions").doc(`${requestId}_mines_payout`);
  let response;

  await database.runTransaction(async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) {
      response = previousRequest.data().response;
      return;
    }
    const [gameSnapshot, userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    if (!gameSnapshot.exists || gameSnapshot.get("gameId") !== gameId
        || gameSnapshot.get("status") !== "active") {
      throw new HttpsError("failed-precondition", "Esta partida de Minas não está ativa.");
    }
    const game = gameSnapshot.data();
    const safeCells = Array.isArray(game.safeCells) ? game.safeCells : [];
    if (safeCells.length === 0) {
      throw new HttpsError("failed-precondition", "Revele pelo menos uma casa antes de sacar.");
    }
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }
    const profile = userSnapshot.data();
    const payout = minesCashoutPayout(game.amountCents, game.mineCount, safeCells.length, game.rtpBps);
    const profitCents = payout.payoutCents - game.amountCents;
    const gamesPlayed = (profile.gamesPlayed || 0) + 1;
    const wins = (profile.wins || 0) + (profitCents > 0 ? 1 : 0);
    const progression = levelProgress(gamesPlayed);
    const actionAtMs = Date.now();
    const missions = advanceMissionProgress(profile, actionAtMs);
    const balanceAfterPayout = (profile.balanceCents || 0) + payout.payoutCents;
    const balanceFinal = balanceAfterPayout + progression.rewardCents + missions.totalRewardCents;
    if (!Number.isSafeInteger(balanceFinal)) {
      throw new HttpsError("failed-precondition", "Saldo resultante inválido.");
    }
    transaction.update(userRef, {
      balanceCents: balanceFinal,
      gamesPlayed,
      wins,
      level: progression.level,
      gamesTowardNextLevel: progression.gamesTowardNextLevel,
      lastGameActionAtMs: actionAtMs,
      ...missions.profileFields,
      ...profitTotals(profitCents),
    });
    transaction.update(rankRef, { balanceCents: balanceFinal, level: progression.level });
    transaction.update(gameRef, {
      status: "cashed_out",
      settledAt: FieldValue.serverTimestamp(),
      payoutCents: payout.payoutCents,
      profitCents,
      multiplierBps: payout.multiplierBps,
    });
    transaction.create(historyRef, {
      description: `Minas · saque (${(payout.multiplierBps / 10_000).toFixed(2)}x)`,
      deltaCents: payout.payoutCents,
      createdAt: FieldValue.serverTimestamp(),
    });
    recordMinigameSettlement(transaction, userRef, {
      gameId: "mines",
      gameName: "Minas",
      outcome: profitCents > 0 ? "won" : profitCents < 0 ? "lost" : "tied",
      netCents: profitCents,
      summary: `Minas · saque (${(payout.multiplierBps / 10_000).toFixed(2)}x)`,
      recordId: `mines_${gameId}`,
      atMs: actionAtMs,
      clanId: typeof profile.clanId === "string" ? profile.clanId : "",
    });
    registrarPremioNivel(transaction, userRef, requestId, progression);
    registrarPremiosMissao(transaction, userRef, missions);
    response = {
      gameId,
      status: "cashed_out",
      safeCells,
      payoutCents: payout.payoutCents,
      multiplierBps: payout.multiplierBps,
      profitCents,
      balanceCents: balanceFinal,
      gamesPlayed,
      wins,
      level: progression.level,
      levelRewardCents: progression.rewardCents,
      missionRewardCents: missions.totalRewardCents,
    };
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });

  return response;
});

function tugPlayers(room) {
  if (Array.isArray(room.players)) return room.players;
  return [
    { uid: room.creatorUid, name: room.creatorName || "Jogador", team: "A" },
    ...(room.opponentUid
      ? [{ uid: room.opponentUid, name: room.opponentName || "Jogador", team: "B" }]
      : []),
  ];
}

function tugPlayerLimit(room) {
  return room.mode === "2v2" ? 4 : 2;
}

function tugGameName(gameId) {
  return ({
    tug: "Cabo de guerra",
    teamRace: "Corrida em equipe",
    teamRelay: "Revezamento",
    teamBlitz: "Quiz relâmpago",
  })[gameId] || "Cabo de guerra";
}

const TUG_ROOM_IDLE_TTL_MS = 10 * 60 * 1_000;
const TUG_ROOM_CLEANUP_BATCH_SIZE = 100;

function publicTugRoom(room, includeInvites = false) {
  const players = tugPlayers(room);
  return {
    roomId: room.roomId,
    mode: room.mode || "1v1",
    gameId: room.gameId || "tug",
    creatorUid: room.creatorUid,
    creatorName: room.creatorName || "Jogador",
    opponentUid: room.opponentUid || "",
    opponentName: room.opponentName || "",
    invitedUids: includeInvites && Array.isArray(room.invitedUids) ? room.invitedUids : [],
    players,
    playerUids: players.map((player) => player.uid),
    stakeCents: room.stakeCents,
    passwordProtected: Boolean(room.passwordHash),
    status: room.status,
    creatorPulls: room.creatorPulls || 0,
    opponentPulls: room.opponentPulls || 0,
    teamAPulls: room.teamAPulls ?? room.creatorPulls ?? 0,
    teamBPulls: room.teamBPulls ?? room.opponentPulls ?? 0,
    acceptedPulls: room.acceptedPulls || 0,
    lastPlayerByTeam: room.lastPlayerByTeam || {},
    winnerUid: room.winnerUid || "",
    winnerTeam: room.winnerTeam || "",
    inviteVersion: room.inviteVersion || 0,
    lastUpdatedAtMs: room.lastUpdatedAtMs || 0,
    exitedUids: Array.isArray(room.exitedUids) ? room.exitedUids : [],
    cleanupAfterMs: room.cleanupAfterMs || 0,
    clanId: typeof room.clanId === "string" ? room.clanId : "",
  };
}

async function deleteExpiredCompletedTugRoom(roomRef, nowMs = Date.now()) {
  let deleted = false;
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists) return;
    const room = snapshot.data();
    if (room.status !== "settled" || !Number.isFinite(room.cleanupAfterMs)
        || room.cleanupAfterMs > nowMs) return;
    transaction.delete(roomRef);
    deleted = true;
  });
  return deleted;
}

async function startLegacyCompletedRoomCleanup(roomRef, nowMs = Date.now()) {
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists) return;
    const room = snapshot.data();
    if (room.status !== "settled" || Array.isArray(room.exitedUids)) return;
    transaction.update(roomRef, {
      exitedUids: tugPlayers(room).map((player) => player.uid),
      cleanupAfterMs: nowMs + COMPLETED_ROOM_RETENTION_MS,
      lastUpdatedAtMs: nowMs,
    });
  });
}

async function cleanupExpiredTugRooms(nowMs = Date.now()) {
  const expiredRooms = await database.collection("tugRooms")
    .where("cleanupAfterMs", "<=", nowMs)
    .limit(TUG_ROOM_CLEANUP_BATCH_SIZE)
    .get();
  await Promise.all(expiredRooms.docs.map((document) => deleteExpiredCompletedTugRoom(document.ref, nowMs)));
}

exports._cleanupExpiredTugRooms = cleanupExpiredTugRooms;

async function expireIdleTugRoom(roomRef) {
  let expired = false;
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists) return;
    const room = snapshot.data();
    if (!["waiting", "ready"].includes(room.status)
        || Date.now() - (room.lastUpdatedAtMs || 0) < TUG_ROOM_IDLE_TTL_MS) return;
    const players = tugPlayers(room);
    const snapshots = await Promise.all(players.flatMap((player) => [
      transaction.get(database.collection("users").doc(player.uid)),
      transaction.get(database.collection("leaderboard").doc(player.uid)),
    ]));
    if (snapshots.some((playerSnapshot) => !playerSnapshot.exists)) return;
    players.forEach((player, index) => {
      const userSnapshot = snapshots[index * 2];
      const rankSnapshot = snapshots[index * 2 + 1];
      const balanceCents = (userSnapshot.get("balanceCents") || 0) + room.stakeCents;
      transaction.update(userSnapshot.ref, { balanceCents });
      transaction.update(rankSnapshot.ref, { balanceCents });
      transaction.create(userSnapshot.ref.collection("transactions").doc(`tug_expire_${room.roomId}`), {
        description: `${tugGameName(room.gameId)} · sala inativa, aposta devolvida`,
        deltaCents: room.stakeCents,
        type: "tug_refund",
        roomId: room.roomId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    transaction.update(roomRef, {
      status: "cancelled",
      players: [],
      participantUids: [],
      invitedUids: [],
      inviteOnly: false,
      passwordHash: "",
      opponentUid: "",
      opponentName: "",
      lastUpdatedAtMs: Date.now(),
    });
    expired = true;
  });
  return expired;
}

exports.listTugRooms = onCall(async (request) => {
  const uid = authenticatedUid(request);
  await cleanupExpiredTugRooms();
  const [profileSnapshot, waitingSnapshot, participantSnapshot] = await Promise.all([
    database.collection("users").doc(uid).get(),
    database.collection("tugRooms").where("status", "==", "waiting").limit(25).get(),
    database.collection("tugRooms").where("participantUids", "array-contains", uid).limit(10).get(),
  ]);
  const userClanId = profileSnapshot.exists && typeof profileSnapshot.get("clanId") === "string"
    ? profileSnapshot.get("clanId")
    : "";
  const candidates = new Map([...waitingSnapshot.docs, ...participantSnapshot.docs].map((document) => [document.id, document]));
  const staleRooms = [...candidates.values()].filter((document) => {
    const room = document.data();
    return ["waiting", "ready"].includes(room.status)
      && Date.now() - (room.lastUpdatedAtMs || 0) >= TUG_ROOM_IDLE_TTL_MS;
  }).slice(0, 1);
  const expiredRoomIds = new Set();
  await Promise.all(staleRooms.map(async (document) => {
    if (await expireIdleTugRoom(document.ref)) expiredRoomIds.add(document.id);
  }));
  const visible = new Map();
  for (const document of waitingSnapshot.docs) {
    if (expiredRoomIds.has(document.id)) continue;
    const room = document.data();
    if (room.clanId && room.clanId !== userClanId && room.creatorUid !== uid) continue;
    if (room.creatorUid === uid || room.inviteOnly !== true || room.invitedUids?.includes(uid)) {
      visible.set(document.id, room);
    }
  }
  for (const document of participantSnapshot.docs) {
    if (expiredRoomIds.has(document.id)) continue;
    const room = document.data();
    if (room.status === "settled" && !Array.isArray(room.exitedUids)) {
      await startLegacyCompletedRoomCleanup(document.ref);
      continue;
    }
    if (Array.isArray(room.exitedUids) && room.exitedUids.includes(uid)) continue;
    visible.set(document.id, room);
  }
  const visibleRooms = [...visible.values()];
  const playerUids = [...new Set(visibleRooms.flatMap((room) => tugPlayers(room).map((player) => player.uid)))];
  const presenceSnapshots = playerUids.length
    ? await database.getAll(...playerUids.map((playerUid) => database.collection("userPresence").doc(playerUid)))
    : [];
  const nowMs = Date.now();
  const onlineByUid = new Map(presenceSnapshots.map((snapshot) => {
    const lastSeen = snapshot.get("lastSeenAt");
    const lastSeenMs = typeof lastSeen?.toMillis === "function" ? lastSeen.toMillis() : 0;
    return [snapshot.id, snapshot.get("online") === true && nowMs - lastSeenMs < 120_000];
  }));
  return {
    rooms: visibleRooms
      .map((room) => ({
        ...publicTugRoom(room, room.creatorUid === uid),
        isInvited: Array.isArray(room.invitedUids) && room.invitedUids.includes(uid),
        players: tugPlayers(room).map((player) => ({
          ...player,
          online: onlineByUid.get(player.uid) === true,
        })),
      }))
      .sort((left, right) => right.lastUpdatedAtMs - left.lastUpdatedAtMs),
  };
});

const TUG_QUICK_MESSAGES = Object.freeze({
  good_luck: "Boa sorte!",
  well_played: "Boa partida!",
  nice_move: "Boa jogada!",
  ready: "Estou pronto.",
  thanks: "Obrigado!",
  reaction_laugh: "😂",
  reaction_fire: "🔥",
  reaction_heart: "❤️",
  reaction_clap: "👏",
});

exports.getTugRoomPresets = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const snapshot = await database.collection("users").doc(uid)
    .collection("preferences").doc("roomPresets").get();
  return { presets: snapshot.exists && Array.isArray(snapshot.get("presets")) ? snapshot.get("presets") : [] };
});

exports.saveTugRoomPresets = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const presets = request.data?.presets;
  if (!Array.isArray(presets) || presets.length > 5) {
    throw new HttpsError("invalid-argument", "Salve no máximo cinco predefinições.");
  }
  const normalized = presets.map((preset) => {
    const name = typeof preset?.name === "string" ? preset.name.trim().replace(/\s+/g, " ") : "";
    const mode = preset?.mode;
    const gameId = preset?.gameId;
    const stakeCents = preset?.stakeCents;
    const passwordProtected = preset?.passwordProtected === true;
    if (name.length < 2 || name.length > 24
        || !["1v1", "2v2"].includes(mode)
        || !["tug", "teamRace", "teamRelay", "teamBlitz"].includes(gameId)
        || (gameId !== "tug" && mode !== "2v2")
        || !validateWager(stakeCents, MAX_TRANSFER_CENTS)) {
      throw new HttpsError("invalid-argument", "Uma das predefinições contém valores inválidos.");
    }
    return { name, mode, gameId, stakeCents, passwordProtected };
  });
  await database.collection("users").doc(uid)
    .collection("preferences").doc("roomPresets")
    .set({ presets: normalized, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true, presets: normalized };
});

exports.getTugRoomMessages = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const roomId = request.data?.roomId;
  if (typeof roomId !== "string" || !/^[a-f0-9-]{36}$/i.test(roomId)) {
    throw new HttpsError("invalid-argument", "Sala inválida.");
  }
  const roomSnapshot = await database.collection("tugRooms").doc(roomId).get();
  if (!roomSnapshot.exists || !tugPlayers(roomSnapshot.data()).some((player) => player.uid === uid)) {
    throw new HttpsError("permission-denied", "Somente participantes da sala podem ler o chat.");
  }
  const messages = await database.collection("tugRooms").doc(roomId)
    .collection("messages").orderBy("createdAtMs", "desc").limit(40).get();
  return {
    messages: messages.docs.reverse().map((document) => ({ id: document.id, ...document.data() })),
  };
});

exports.sendTugRoomMessage = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const roomId = request.data?.roomId;
  const requestId = request.data?.requestId;
  const quickMessageId = request.data?.quickMessageId;
  const text = typeof request.data?.text === "string" ? request.data.text.trim() : "";
  const quickText = TUG_QUICK_MESSAGES[quickMessageId] || "";
  if (typeof roomId !== "string" || !/^[a-f0-9-]{36}$/i.test(roomId)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || (!quickText && (text.length < 1 || text.length > 140))
      || (quickMessageId != null && !quickText)) {
    throw new HttpsError("invalid-argument", "Mensagem ou identificador inválido.");
  }
  const roomRef = database.collection("tugRooms").doc(roomId);
  const userRef = database.collection("users").doc(uid);
  const messageRef = roomRef.collection("messages").doc(requestId);
  await database.runTransaction(async (transaction) => {
    const [roomSnapshot, userSnapshot, existingMessage] = await Promise.all([
      transaction.get(roomRef), transaction.get(userRef), transaction.get(messageRef),
    ]);
    if (existingMessage.exists) return;
    if (!roomSnapshot.exists || !tugPlayers(roomSnapshot.data()).some((player) => player.uid === uid)) {
      throw new HttpsError("permission-denied", "Somente participantes da sala podem enviar mensagens.");
    }
    if (!userSnapshot.exists) throw new HttpsError("not-found", "Perfil não encontrado.");
    const body = quickText || text;
    transaction.create(messageRef, {
      senderUid: uid,
      senderName: safeName(userSnapshot.get("displayName"), "Jogador"),
      text: body,
      quickMessage: Boolean(quickText),
      createdAtMs: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

exports.createTugRoom = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const stakeCents = request.data?.stakeCents;
  const requestId = request.data?.requestId;
  const invitedUids = request.data?.invitedUids;
  const mode = request.data?.mode || "1v1";
  const gameId = request.data?.gameId || "tug";
  const clanId = request.data?.clanId || "";
  const password = typeof request.data?.password === "string" ? request.data.password : "";
  if (!validateWager(stakeCents, MAX_TRANSFER_CENTS)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || !["1v1", "2v2"].includes(mode)
      || !["tug", "teamRace", "teamRelay", "teamBlitz"].includes(gameId)
      || (gameId !== "tug" && mode !== "2v2")
      || (clanId !== "" && (typeof clanId !== "string" || !/^[a-f0-9-]{36}$/i.test(clanId)))
      || !Array.isArray(invitedUids) || invitedUids.some((targetUid) => typeof targetUid !== "string" || !targetUid || targetUid === uid)
      || invitedUids.length > 20 || new Set(invitedUids).size !== invitedUids.length
      || password.length > 24) {
    throw new HttpsError("invalid-argument", "Aposta, convites, senha ou identificador inválido.");
  }
  const roomRef = database.collection("tugRooms").doc(requestId);
  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const historyRef = userRef.collection("transactions").doc(`tug_host_${requestId}`);
  const clanRef = clanId ? database.collection("clans").doc(clanId) : null;
  const invitedRefs = invitedUids.map((targetUid) => database.collection("users").doc(targetUid));
  let response;
  await database.runTransaction(async (transaction) => {
    const [roomSnapshot, userSnapshot, rankSnapshot, clanSnapshot, ...inviteSnapshots] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(userRef),
      transaction.get(rankRef),
      clanRef ? transaction.get(clanRef) : Promise.resolve(null),
      ...invitedRefs.map((ref) => transaction.get(ref)),
    ]);
    if (roomSnapshot.exists) {
      if (roomSnapshot.get("creatorUid") !== uid) throw new HttpsError("already-exists", "Identificador de sala já utilizado.");
      response = publicTugRoom(roomSnapshot.data(), true);
      return;
    }
    if (!userSnapshot.exists || !rankSnapshot.exists) throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    if (clanId && (!clanSnapshot?.exists || userSnapshot.get("clanId") !== clanId
        || !(clanSnapshot.get("members") || []).some((member) => member.uid === uid))) {
      throw new HttpsError("permission-denied", "Você não pertence ao clã desta sala.");
    }
    if (inviteSnapshots.some((snapshot) => !snapshot.exists)) throw new HttpsError("not-found", "Um dos convidados não foi encontrado.");
    if (clanId && invitedUids.some((inviteUid) => (
      !(clanSnapshot.get("members") || []).some((member) => member.uid === inviteUid)
    ))) {
      throw new HttpsError("failed-precondition", "Todos os convidados da sala precisam ser membros do clã.");
    }
    const profile = userSnapshot.data();
    const balance = profile.balanceCents || 0;
    if (balance < stakeCents) throw new HttpsError("failed-precondition", "Saldo insuficiente para criar a sala.");
    transaction.update(userRef, { balanceCents: balance - stakeCents });
    transaction.update(rankRef, { balanceCents: balance - stakeCents });
    transaction.create(historyRef, {
      description: `${tugGameName(gameId)} · aposta na sala ${requestId.slice(0, 8)}`,
      deltaCents: -stakeCents,
      type: "tug_wager",
      roomId: requestId,
      createdAt: FieldValue.serverTimestamp(),
    });
    const nowMs = Date.now();
    const creatorName = profile.displayName || "Jogador";
    const room = {
      roomId: requestId,
      mode,
      gameId,
      clanId,
      creatorUid: uid,
      creatorName,
      opponentUid: "",
      opponentName: "",
      players: [{ uid, name: creatorName, team: "A", skill: Math.max(1, profile.level || 1) }],
      participantUids: [uid],
      invitedUids,
      inviteOnly: invitedUids.length > 0,
      inviteVersion: invitedUids.length > 0 ? 1 : 0,
      inviteCooldowns: Object.fromEntries(invitedUids.map((inviteUid) => [inviteUid, nowMs])),
      stakeCents,
      passwordHash: password ? hashTugPassword(password, requestId) : "",
      status: "waiting",
      creatorPulls: 0,
      opponentPulls: 0,
      teamAPulls: 0,
      teamBPulls: 0,
      lastPullAtMs: {},
      lastUpdatedAtMs: nowMs,
      createdAt: FieldValue.serverTimestamp(),
    };
    transaction.create(roomRef, room);
    response = publicTugRoom(room, true);
  });
  return response;
});

exports.joinTugRoom = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const roomId = request.data?.roomId;
  const password = typeof request.data?.password === "string" ? request.data.password : "";
  const requestId = request.data?.requestId;
  if (typeof roomId !== "string" || !/^[a-f0-9-]{36}$/i.test(roomId)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || password.length > 24) {
    throw new HttpsError("invalid-argument", "Sala, senha ou identificador inválido.");
  }
  const roomRef = database.collection("tugRooms").doc(roomId);
  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const requestRef = userRef.collection("gameRequests").doc(requestId);
  const historyRef = userRef.collection("transactions").doc(`tug_guest_${roomId}_${requestId}`);
  let response;
  await database.runTransaction(async (transaction) => {
    const [requestSnapshot, roomSnapshot, userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(roomRef),
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    if (requestSnapshot.exists) {
      response = requestSnapshot.get("response");
      return;
    }
    if (!roomSnapshot.exists) throw new HttpsError("not-found", "Sala não encontrada.");
    const room = roomSnapshot.data();
    const players = tugPlayers(room);
    if (players.some((player) => player.uid === uid) && ["waiting", "ready", "active"].includes(room.status)) {
      response = publicTugRoom(room);
      transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
      return;
    }
    if (room.status !== "waiting" || players.some((player) => player.uid === uid)) {
      throw new HttpsError("failed-precondition", "Esta sala não está disponível.");
    }
    if (players.length >= tugPlayerLimit(room)) throw new HttpsError("resource-exhausted", "A sala já está completa.");
    const invitedUids = Array.isArray(room.invitedUids) ? room.invitedUids : [];
    if ((room.inviteOnly === true || invitedUids.length > 0) && !invitedUids.includes(uid)) {
      throw new HttpsError("permission-denied", "Você não foi convidado para esta sala.");
    }
    if (room.passwordHash && hashTugPassword(password, roomId) !== room.passwordHash) throw new HttpsError("permission-denied", "Senha da sala incorreta.");
    if (!userSnapshot.exists || !rankSnapshot.exists) throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    if (room.clanId && userSnapshot.get("clanId") !== room.clanId) {
      throw new HttpsError("permission-denied", "Somente membros do clã podem entrar nesta sala.");
    }
    const balance = userSnapshot.get("balanceCents") || 0;
    if (balance < room.stakeCents) throw new HttpsError("failed-precondition", "Saldo insuficiente para entrar nesta sala.");
    const user = userSnapshot.data();
    const skill = Math.max(1, user.level || 1);
    const team = room.mode === "2v2" ? chooseBalancedTeam(players, skill) : "B";
    const updatedPlayers = [...players, { uid, name: user.displayName || "Jogador", team, skill }];
    const opponent = updatedPlayers.find((player) => player.team === "B");
    const updatedRoom = {
      status: updatedPlayers.length >= tugPlayerLimit(room) ? "ready" : "waiting",
      players: updatedPlayers,
      opponentUid: opponent?.uid || "",
      opponentName: opponent?.name || "",
      participantUids: updatedPlayers.map((player) => player.uid),
      invitedUids: invitedUids.filter((inviteUid) => inviteUid !== uid),
      lastUpdatedAtMs: Date.now(),
    };
    transaction.update(userRef, { balanceCents: balance - room.stakeCents });
    transaction.update(rankRef, { balanceCents: balance - room.stakeCents });
    transaction.update(roomRef, updatedRoom);
    transaction.create(historyRef, {
      description: `${tugGameName(room.gameId)} · entrada na sala ${roomId.slice(0, 8)}`,
      deltaCents: -room.stakeCents,
      type: "tug_wager",
      roomId,
      createdAt: FieldValue.serverTimestamp(),
    });
    response = publicTugRoom({ ...room, ...updatedRoom });
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });
  return response;
});

exports.manageTugRoom = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const roomId = request.data?.roomId;
  const action = request.data?.action;
  const requestId = request.data?.requestId;
  const targetUid = request.data?.targetUid || "";
  const newStakeCents = request.data?.stakeCents;
  const newPassword = typeof request.data?.password === "string" ? request.data.password : "";
    if (typeof roomId !== "string" || !/^[a-f0-9-]{36}$/i.test(roomId)
      || !["setStake", "setPassword", "addInvite", "removeInvite", "kick", "cancel", "dissolve", "leave", "leaveCompleted", "transferLeadership"].includes(action)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || (["addInvite", "removeInvite", "kick", "transferLeadership"].includes(action) && !targetUid)
      || (action === "setStake" && !validateWager(newStakeCents, MAX_TRANSFER_CENTS))
      || (action === "setPassword" && newPassword.length > 24)) {
    throw new HttpsError("invalid-argument", "Ação de sala ou parâmetros inválidos.");
  }
  const actorRef = database.collection("users").doc(uid);
  const actorRankRef = database.collection("leaderboard").doc(uid);
  const roomRef = database.collection("tugRooms").doc(roomId);
  const requestRef = actorRef.collection("gameRequests").doc(requestId);
  let response;
  await database.runTransaction(async (transaction) => {
    const [requestSnapshot, roomSnapshot, actorSnapshot, actorRankSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(roomRef),
      transaction.get(actorRef),
      transaction.get(actorRankRef),
    ]);
    if (requestSnapshot.exists) {
      response = requestSnapshot.get("response");
      return;
    }
    if (!roomSnapshot.exists) throw new HttpsError("not-found", "Sala não encontrada.");
    const room = roomSnapshot.data();
    const players = tugPlayers(room);
    const isCreator = room.creatorUid === uid;
    if (action === "leaveCompleted") {
      if (room.status !== "settled") {
        throw new HttpsError("failed-precondition", "Só é possível sair após o fim da partida.");
      }
      if (!players.some((player) => player.uid === uid)) {
        throw new HttpsError("permission-denied", "Você não participou desta partida.");
      }
    } else if (action === "leave") {
      if (isCreator) throw new HttpsError("failed-precondition", "O criador deve dissolver a sala para devolver todas as apostas.");
      if (!players.some((player) => player.uid === uid)) throw new HttpsError("permission-denied", "Você não está nesta sala.");
    } else if (action !== "transferLeadership" && !isCreator) {
      throw new HttpsError("permission-denied", "Somente o criador pode alterar esta sala.");
    }
    if (!actorSnapshot.exists || !actorRankSnapshot.exists) throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    let refundPlayers = [];
    let stakePlayers = [];
    if (["kick", "leave", "cancel", "dissolve"].includes(action)) {
      if (!["waiting", "ready"].includes(room.status)) {
        throw new HttpsError("failed-precondition", "A sala só pode ser encerrada antes de começar a partida.");
      }
      if (action === "kick") {
        if (targetUid === room.creatorUid || !players.some((player) => player.uid === targetUid)) {
          throw new HttpsError("failed-precondition", "Esse jogador não está nesta sala.");
        }
        refundPlayers = players.filter((player) => player.uid === targetUid);
      } else if (action === "leave") {
        refundPlayers = players.filter((player) => player.uid === uid);
      } else {
        refundPlayers = players;
      }
      const refundSnapshots = await Promise.all(refundPlayers.flatMap((player) => [
        transaction.get(database.collection("users").doc(player.uid)),
        transaction.get(database.collection("leaderboard").doc(player.uid)),
      ]));
      if (refundSnapshots.some((snapshot) => !snapshot.exists)) {
        throw new HttpsError("not-found", "Não foi possível localizar todas as contas para reembolso.");
      }
      refundPlayers = refundPlayers.map((player, index) => ({
        ...player,
        userSnapshot: refundSnapshots[index * 2],
        rankSnapshot: refundSnapshots[index * 2 + 1],
      }));
    }
    if (action === "setStake") {
      const stakeSnapshots = await Promise.all(players.flatMap((player) => [
        transaction.get(database.collection("users").doc(player.uid)),
        transaction.get(database.collection("leaderboard").doc(player.uid)),
      ]));
      if (stakeSnapshots.some((snapshot) => !snapshot.exists)) {
        throw new HttpsError("not-found", "Não foi possível localizar todas as contas para ajustar a aposta.");
      }
      const difference = newStakeCents - room.stakeCents;
      stakePlayers = players.map((player, index) => ({
        ...player,
        userSnapshot: stakeSnapshots[index * 2],
        rankSnapshot: stakeSnapshots[index * 2 + 1],
      }));
      if (difference > 0 && stakePlayers.some((player) => (player.userSnapshot.get("balanceCents") || 0) < difference)) {
        throw new HttpsError("failed-precondition", "Um dos jogadores não tem saldo suficiente para aumentar a aposta.");
      }
    }
    if (action === "setStake" || action === "setPassword" || action === "addInvite") {
      if (room.status !== "waiting") throw new HttpsError("failed-precondition", "A sala só pode ser configurada enquanto aguarda jogadores.");
    }
    const update = { lastUpdatedAtMs: Date.now() };
    if (action === "transferLeadership") {
      if (!isCreator || !["waiting", "ready"].includes(room.status)) {
        throw new HttpsError("failed-precondition", "A liderança só pode ser transferida pelo anfitrião antes da partida.");
      }
      const successor = players.find((player) => player.uid === targetUid);
      if (!successor || targetUid === uid) {
        throw new HttpsError("failed-precondition", "Escolha outro participante desta sala.");
      }
      update.creatorUid = successor.uid;
      update.creatorName = successor.name;
      update.leadershipTransferredAt = FieldValue.serverTimestamp();
    } else if (action === "setStake") {
      const difference = newStakeCents - room.stakeCents;
      for (const player of stakePlayers) {
        const balance = player.userSnapshot.get("balanceCents") || 0;
        const uidKey = createHash("sha256").update(player.uid).digest("hex").slice(0, 12);
        transaction.update(player.userSnapshot.ref, { balanceCents: balance - difference });
        transaction.update(player.rankSnapshot.ref, { balanceCents: balance - difference });
        transaction.create(player.userSnapshot.ref.collection("transactions").doc(`tug_adjust_${requestId}_${uidKey}`), {
          description: `${tugGameName(room.gameId)} · ajuste da aposta da sala`,
          deltaCents: -difference,
          type: "tug_wager_adjustment",
          roomId,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      update.stakeCents = newStakeCents;
    } else if (action === "setPassword") {
      update.passwordHash = hashTugPassword(newPassword, roomId);
    } else if (action === "addInvite") {
      if (targetUid === uid) throw new HttpsError("invalid-argument", "Você não pode convidar a si mesmo.");
      const target = await transaction.get(database.collection("users").doc(targetUid));
      if (!target.exists) throw new HttpsError("not-found", "Convidado não encontrado.");
      const invites = Array.isArray(room.invitedUids) ? [...room.invitedUids] : [];
      const nowMs = Date.now();
      const lastInviteAtMs = room.inviteCooldowns?.[targetUid] || 0;
      const cooldownRemainingMs = 30_000 - (nowMs - lastInviteAtMs);
      if (cooldownRemainingMs > 0) {
        throw new HttpsError("resource-exhausted", `Aguarde ${Math.ceil(cooldownRemainingMs / 1_000)} s para reenviar este convite.`);
      }
      if (!invites.includes(targetUid)) invites.push(targetUid);
      if (invites.length > 20) throw new HttpsError("resource-exhausted", "A sala pode ter até 20 convites.");
      update.invitedUids = invites;
      update.inviteOnly = true;
      update.inviteCooldowns = { ...(room.inviteCooldowns || {}), [targetUid]: nowMs };
      update.inviteVersion = (room.inviteVersion || 0) + 1;
    } else if (action === "removeInvite") {
      if (room.status !== "waiting") throw new HttpsError("failed-precondition", "Não é possível alterar convites depois que a partida começa.");
      update.invitedUids = (room.invitedUids || []).filter((inviteUid) => inviteUid !== targetUid);
    } else if (action === "leaveCompleted") {
      let exit;
      try {
        exit = recordCompletedRoomExit(room, uid, Date.now());
      } catch (error) {
        if (error.message === "not-a-player") {
          throw new HttpsError("permission-denied", "Você não participou desta partida.");
        }
        throw new HttpsError("failed-precondition", "A partida ainda não foi concluída.");
      }
      update.exitedUids = exit.exitedUids;
      if (exit.cleanupAfterMs > 0) update.cleanupAfterMs = exit.cleanupAfterMs;
    } else if (["cancel", "dissolve", "leave"].includes(action)) {
      if ((action === "cancel" || action === "dissolve") && !isCreator) {
        throw new HttpsError("permission-denied", "Somente o criador pode dissolver a sala.");
      }
      for (const player of refundPlayers) {
        const refundedBalance = (player.userSnapshot.get("balanceCents") || 0) + room.stakeCents;
        transaction.update(player.userSnapshot.ref, { balanceCents: refundedBalance });
        transaction.update(player.rankSnapshot.ref, { balanceCents: refundedBalance });
        const uidKey = createHash("sha256").update(player.uid).digest("hex").slice(0, 12);
        transaction.create(player.userSnapshot.ref.collection("transactions").doc(`tug_refund_${roomId}_${requestId}_${uidKey}`), {
          description: action === "leave"
            ? `${tugGameName(room.gameId)} · saída da sala, aposta devolvida`
            : `${tugGameName(room.gameId)} · sala dissolvida, aposta devolvida`,
          deltaCents: room.stakeCents,
          type: "tug_refund",
          roomId,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      if (action === "leave") {
        const remainingPlayers = players.filter((player) => player.uid !== uid);
        const opponent = remainingPlayers.find((player) => player.team === "B");
        update.players = remainingPlayers;
        update.participantUids = remainingPlayers.map((player) => player.uid);
        update.opponentUid = opponent?.uid || "";
        update.opponentName = opponent?.name || "";
        update.status = "waiting";
      } else {
        update.status = "cancelled";
        update.invitedUids = [];
        update.inviteOnly = false;
        update.participantUids = [];
        update.players = [];
        update.opponentUid = "";
        update.opponentName = "";
        update.passwordHash = "";
      }
    } else if (action === "kick") {
      const kicked = refundPlayers[0];
      const refundedBalance = (kicked.userSnapshot.get("balanceCents") || 0) + room.stakeCents;
      transaction.update(kicked.userSnapshot.ref, { balanceCents: refundedBalance });
      transaction.update(kicked.rankSnapshot.ref, { balanceCents: refundedBalance });
      const kickedUidKey = createHash("sha256").update(kicked.uid).digest("hex").slice(0, 12);
      transaction.create(kicked.userSnapshot.ref.collection("transactions").doc(`tug_refund_${roomId}_${requestId}_${kickedUidKey}`), {
        description: `${tugGameName(room.gameId)} · remoção da sala, aposta devolvida`,
        deltaCents: room.stakeCents,
        type: "tug_refund",
        roomId,
        createdAt: FieldValue.serverTimestamp(),
      });
      const remainingPlayers = players.filter((player) => player.uid !== targetUid);
      const opponent = remainingPlayers.find((player) => player.team === "B");
      update.status = "waiting";
      update.players = remainingPlayers;
      update.participantUids = remainingPlayers.map((player) => player.uid);
      update.opponentUid = opponent?.uid || "";
      update.opponentName = opponent?.name || "";
    }
    transaction.update(roomRef, update);
    response = { ok: true, room: publicTugRoom({ ...room, ...update }, true) };
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });
  return response;
});

exports.startTugRoom = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const roomId = request.data?.roomId;
  if (typeof roomId !== "string" || !/^[a-f0-9-]{36}$/i.test(roomId)) {
    throw new HttpsError("invalid-argument", "Identificador da sala inválido.");
  }
  const roomRef = database.collection("tugRooms").doc(roomId);
  let response;
  await database.runTransaction(async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists) throw new HttpsError("not-found", "Sala não encontrada.");
    const room = roomSnapshot.data();
    if (room.creatorUid !== uid) throw new HttpsError("permission-denied", "Somente o criador inicia a partida.");
    if (room.status === "active") {
      response = publicTugRoom(room);
      return;
    }
    const players = tugPlayers(room);
    if (room.status !== "ready" || players.length !== tugPlayerLimit(room)) {
      throw new HttpsError("failed-precondition", "A sala ainda não está completa.");
    }
    const startedAtMs = Date.now();
    const update = {
      status: "active",
      startedAt: FieldValue.serverTimestamp(),
      startedAtMs,
      lastPullAtMs: Object.fromEntries(players.map((player) => [player.uid, startedAtMs])),
      lastPlayerByTeam: {},
      lastUpdatedAtMs: startedAtMs,
    };
    transaction.update(roomRef, update);
    response = publicTugRoom({ ...room, ...update });
  });
  return response;
});

exports.pullTugRope = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const roomId = request.data?.roomId;
  const requestId = request.data?.requestId;
    const pullCount = request.data?.pullCount ?? 1;
  if (typeof roomId !== "string" || !/^[a-f0-9-]{36}$/i.test(roomId)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || !Number.isInteger(pullCount) || pullCount < 1 || pullCount > MAX_PULLS_PER_BATCH) {
    throw new HttpsError("invalid-argument", "Partida ou identificador inválido.");
  }
  const roomRef = database.collection("tugRooms").doc(roomId);
  const roomSnapshot = await roomRef.get();
  if (!roomSnapshot.exists) throw new HttpsError("not-found", "Sala não encontrada.");
  const roomBefore = roomSnapshot.data();
  const playersBefore = tugPlayers(roomBefore);
  const playerUids = playersBefore.map((player) => player.uid);
  if (!playerUids.includes(uid) || playerUids.length !== tugPlayerLimit(roomBefore)) {
    throw new HttpsError("permission-denied", "Você não está nesta partida completa.");
  }
  const userRefs = playerUids.map((playerUid) => database.collection("users").doc(playerUid));
  const rankRefs = playerUids.map((playerUid) => database.collection("leaderboard").doc(playerUid));
  const requestRef = database.collection("users").doc(uid).collection("gameRequests").doc(requestId);
  let response;
  await database.runTransaction(async (transaction) => {
    const [previousRequest, currentRoom, ...accountSnapshots] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(roomRef),
      ...userRefs.map((ref) => transaction.get(ref)),
      ...rankRefs.map((ref) => transaction.get(ref)),
    ]);
    if (previousRequest.exists) {
      response = previousRequest.get("response");
      return;
    }
    if (!currentRoom.exists) throw new HttpsError("not-found", "Sala não encontrada.");
    let pull;
    try {
      pull = applyTugPull(currentRoom.data(), uid, Date.now(), pullCount);
    } catch (error) {
      if (error.message === "pull-too-fast") throw new HttpsError("resource-exhausted", "Puxe novamente em um instante.");
      if (error.message === "relay-turn") throw new HttpsError("failed-precondition", "No revezamento, um colega precisa jogar antes de você novamente.");
      if (error.message === "not-a-player") throw new HttpsError("permission-denied", "Você não está nesta partida.");
      if (error.message === "invalid-pull-count") throw new HttpsError("invalid-argument", "Quantidade de toques inválida.");
      throw new HttpsError("failed-precondition", "A partida não está ativa.");
    }
    const room = currentRoom.data();
    if (!pull.winnerUid) {
      transaction.update(roomRef, { ...pull, lastUpdatedAtMs: Date.now() });
      response = publicTugRoom({ ...room, ...pull });
      transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
      return;
    }
    const playerCount = playerUids.length;
    const profiles = accountSnapshots.slice(0, playerCount);
    const ranks = accountSnapshots.slice(playerCount, playerCount * 2);
    if (profiles.some((snapshot) => !snapshot.exists) || ranks.some((snapshot) => !snapshot.exists)) {
      throw new HttpsError("failed-precondition", "Uma conta da partida não está disponível.");
    }
    const nowMs = Date.now();
    const players = tugPlayers({ ...room, ...pull });
    const payoutPerWinnerCents = room.stakeCents * 2;
    const winnerCount = players.filter((player) => player.team === pull.winnerTeam).length;
    const payoutCents = payoutPerWinnerCents * winnerCount;
    const settledProfiles = profiles.map((snapshot, index) => {
      const profile = snapshot.data();
      const won = players[index].team === pull.winnerTeam;
      const gamesPlayed = (profile.gamesPlayed || 0) + 1;
      const progression = levelProgress(gamesPlayed);
      const missions = advanceMissionProgress(profile, nowMs);
      const profitCents = won ? room.stakeCents : -room.stakeCents;
      const balanceCents = (profile.balanceCents || 0)
        + (won ? payoutPerWinnerCents : 0)
        + progression.rewardCents
        + missions.totalRewardCents;
      if (!Number.isSafeInteger(balanceCents)) throw new HttpsError("failed-precondition", "Saldo resultante inválido.");
      return { won, gamesPlayed, progression, missions, profitCents, balanceCents, wins: (profile.wins || 0) + (won ? 1 : 0) };
    });
    settledProfiles.forEach((settlement, index) => {
      transaction.update(userRefs[index], {
        balanceCents: settlement.balanceCents,
        gamesPlayed: settlement.gamesPlayed,
        wins: settlement.wins,
        level: settlement.progression.level,
        gamesTowardNextLevel: settlement.progression.gamesTowardNextLevel,
        ...settlement.missions.profileFields,
        ...profitTotals(settlement.profitCents),
      });
      transaction.update(rankRefs[index], { balanceCents: settlement.balanceCents, level: settlement.progression.level });
      transaction.create(userRefs[index].collection("transactions").doc(`tug_settlement_${roomId}`), {
        description: `${tugGameName(room.gameId)} · ${settlement.won ? "vitória" : "derrota"}`,
        deltaCents: settlement.won ? payoutPerWinnerCents : 0,
        type: "tug_settlement",
        roomId,
        createdAt: FieldValue.serverTimestamp(),
      });
      recordMinigameSettlement(transaction, userRefs[index], {
        gameId: room.gameId || "tug",
        gameName: tugGameName(room.gameId),
        outcome: settlement.won ? "won" : "lost",
        netCents: settlement.profitCents,
        summary: `${tugGameName(room.gameId)} · ${settlement.won ? "vitória" : "derrota"}`,
        recordId: `tug_${roomId}`,
        atMs: nowMs,
        clanId: typeof profiles[index].get("clanId") === "string" ? profiles[index].get("clanId") : "",
      });
      registrarPremioNivel(transaction, userRefs[index], `${roomId}_${playerUids[index]}`, settlement.progression);
      registrarPremiosMissao(transaction, userRefs[index], settlement.missions);
    });
    const finalRoom = {
      ...room,
      ...pull,
      status: "settled",
      winnerUid: pull.winnerUid,
      winnerTeam: pull.winnerTeam,
      payoutCents,
      payoutPerWinnerCents,
      settledAt: FieldValue.serverTimestamp(),
      lastUpdatedAtMs: nowMs,
    };
    transaction.update(roomRef, finalRoom);
    response = publicTugRoom(finalRoom);
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });
  return response;
});

exports.startCrash = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const amountCents = request.data?.amountCents;
  const requestId = request.data?.requestId;
  if (!validateWager(amountCents, MAX_TRANSFER_CENTS)
      || typeof requestId !== "string"
      || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Aposta ou identificador inválido.");
  }

  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const gameRef = userRef.collection("games").doc("crash");
  const requestRef = userRef.collection("gameRequests").doc(requestId);
  const historyRef = userRef.collection("transactions").doc(`${requestId}_crash_bet`);
  const gameId = randomUUID();
  const startedAtMs = Date.now();
  const crashAtBps = crashPointBasisPoints();
  let response;

  await database.runTransaction(async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) {
      response = previousRequest.data().response;
      return;
    }
    const [gameSnapshot, userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    if (gameSnapshot.exists && gameSnapshot.data().status === "active") {
      const active = gameSnapshot.data();
      response = {
        gameId: active.gameId,
        amountCents: active.amountCents,
        startedAtMs: active.startedAtMs,
        status: "active",
        resumed: true,
      };
      transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
      return;
    }
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }
    const profile = userSnapshot.data();
    enforceGameCooldown(profile, startedAtMs);
    const balance = profile.balanceCents || 0;
    if (balance < amountCents) {
      throw new HttpsError("failed-precondition", "Saldo insuficiente.");
    }
    const balanceAfter = balance - amountCents;
    transaction.update(userRef, { balanceCents: balanceAfter, lastGameActionAtMs: startedAtMs });
    transaction.update(rankRef, { balanceCents: balanceAfter });
    transaction.set(gameRef, {
      gameId,
      status: "active",
      amountCents,
      crashAtBps,
      startedAtMs,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(historyRef, {
      description: "Crash · aposta",
      deltaCents: -amountCents,
      createdAt: FieldValue.serverTimestamp(),
    });
    response = { gameId, amountCents, startedAtMs, status: "active", resumed: false };
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });

  return response;
});

exports.cashOutCrash = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const gameId = request.data?.gameId;
  const requestId = request.data?.requestId;
  if (typeof gameId !== "string" || !/^[a-f0-9-]{36}$/i.test(gameId)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Identificador da partida inválido.");
  }

  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const gameRef = userRef.collection("games").doc("crash");
  const requestRef = userRef.collection("gameRequests").doc(requestId);
  const historyRef = userRef.collection("transactions").doc(`${requestId}_crash_payout`);
  const nowMs = Date.now();
  let response;

  await database.runTransaction(async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) {
      response = previousRequest.data().response;
      return;
    }
    const [gameSnapshot, userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    if (!gameSnapshot.exists || gameSnapshot.data().gameId !== gameId
        || gameSnapshot.data().status !== "active") {
      throw new HttpsError("failed-precondition", "Esta partida não está ativa.");
    }
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }

    const game = gameSnapshot.data();
    const profile = userSnapshot.data();
    const elapsedMs = Math.max(0, nowMs - game.startedAtMs);
    const multiplierBps = crashMultiplierBasisPoints(elapsedMs);
    const crashed = multiplierBps >= game.crashAtBps;
    if (!crashed && multiplierBps <= 100) {
      throw new HttpsError("failed-precondition", "Aguarde o multiplicador passar de 1,00x.");
    }

    const payoutCents = crashed ? 0 : Math.floor(game.amountCents * multiplierBps / 100);
    const profitCents = payoutCents - game.amountCents;
    const balanceAfter = (profile.balanceCents || 0) + payoutCents;
    if (!Number.isSafeInteger(balanceAfter)) {
      throw new HttpsError("failed-precondition", "Saldo resultante inválido.");
    }
    const gamesPlayed = (profile.gamesPlayed || 0) + 1;
    const wins = (profile.wins || 0) + (profitCents > 0 ? 1 : 0);
    const progression = levelProgress(gamesPlayed);
    const missions = advanceMissionProgress(profile, nowMs);
    const balanceFinal = balanceAfter + progression.rewardCents + missions.totalRewardCents;
    if (!Number.isSafeInteger(balanceFinal)) {
      throw new HttpsError("failed-precondition", "Saldo resultante inválido.");
    }
    transaction.update(userRef, {
      balanceCents: balanceFinal,
      gamesPlayed,
      wins,
      level: progression.level,
      gamesTowardNextLevel: progression.gamesTowardNextLevel,
      lastGameActionAtMs: nowMs,
      ...missions.profileFields,
      ...profitTotals(profitCents),
    });
    transaction.update(rankRef, { balanceCents: balanceFinal, level: progression.level });
    transaction.update(gameRef, {
      status: "settled",
      crashed,
      settledAt: FieldValue.serverTimestamp(),
      settledMultiplierBps: multiplierBps,
      payoutCents,
    });
    if (payoutCents > 0) {
      transaction.create(historyRef, {
        description: crashed ? "Crash · encerrado" : "Crash · retirada",
        deltaCents: payoutCents,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    recordMinigameSettlement(transaction, userRef, {
      gameId: "crash",
      gameName: "Crash",
      outcome: profitCents > 0 ? "won" : profitCents < 0 ? "lost" : "tied",
      netCents: profitCents,
      summary: crashed ? "Crash · multiplicador estourou" : `Crash · saque em ${(multiplierBps / 100).toFixed(2)}x`,
      recordId: `crash_${gameId}`,
      atMs: nowMs,
      clanId: typeof profile.clanId === "string" ? profile.clanId : "",
    });
    registrarPremioNivel(transaction, userRef, requestId, progression);
    registrarPremiosMissao(transaction, userRef, missions);
    response = {
      crashed,
      multiplierBps,
      payoutCents,
      profitCents,
      balanceCents: balanceFinal,
      gamesPlayed,
      wins,
      level: progression.level,
      gamesTowardNextLevel: progression.gamesTowardNextLevel,
      levelRewardCents: progression.rewardCents,
      missionRewardCents: missions.totalRewardCents,
    };
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });

  return response;
});

function publicBlackjackState(game) {
  const active = game.status === "active";
  return {
    gameId: game.gameId,
    status: game.status,
    playerCards: game.playerCards,
    dealerCards: active ? game.dealerCards.slice(0, 1) : game.dealerCards,
    dealerHoleHidden: active,
    wagerCents: game.wagerCents,
    outcome: game.outcome || "",
    payoutCents: game.payoutCents || 0,
    profitCents: game.profitCents || 0,
    balanceCents: game.balanceCents,
    level: game.level || 1,
    gamesTowardNextLevel: game.gamesTowardNextLevel || 0,
    levelRewardCents: game.levelRewardCents || 0,
  };
}

exports.startBlackjack = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const amountCents = request.data?.amountCents;
  const requestId = request.data?.requestId;
  if (!validateWager(amountCents, MAX_TRANSFER_CENTS)
      || typeof requestId !== "string"
      || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Aposta ou identificador inválido.");
  }

  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const gameRef = userRef.collection("games").doc("blackjack");
  const requestRef = userRef.collection("gameRequests").doc(requestId);
  const betHistoryRef = userRef.collection("transactions").doc(`${requestId}_blackjack_bet`);
  const payoutHistoryRef = userRef.collection("transactions").doc(`${requestId}_blackjack_payout`);
  const gameId = randomUUID();
  const deck = createShuffledDeck();
  const playerCards = deck.slice(0, 2);
  const dealerCards = deck.slice(2, 4);
  const nextCardIndex = 4;
  let response;

  await database.runTransaction(async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) {
      response = previousRequest.data().response;
      return;
    }
    const [gameSnapshot, userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    if (gameSnapshot.exists && gameSnapshot.data().status === "active") {
      response = publicBlackjackState(gameSnapshot.data());
      response.resumed = true;
      transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
      return;
    }
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }
    const profile = userSnapshot.data();
    const startedAtMs = Date.now();
    enforceGameCooldown(profile, startedAtMs);
    const balance = profile.balanceCents || 0;
    if (balance < amountCents) {
      throw new HttpsError("failed-precondition", "Saldo insuficiente.");
    }

    const initialGame = {
      gameId,
      status: "active",
      playerCards,
      dealerCards,
      deck,
      nextCardIndex,
      wagerCents: amountCents,
      startedAt: FieldValue.serverTimestamp(),
    };
    let balanceAfter = balance - amountCents;
    let gamesPlayed = profile.gamesPlayed || 0;
    let wins = profile.wins || 0;
    let progression = levelProgress(gamesPlayed);
    const hasNatural = isBlackjack(playerCards) || isBlackjack(dealerCards);
    if (hasNatural) {
      const settlement = settleBlackjack(playerCards, dealerCards, amountCents);
      balanceAfter += settlement.payoutCents;
      gamesPlayed += 1;
      progression = levelProgress(gamesPlayed);
      balanceAfter += progression.rewardCents;
      if (settlement.payoutCents > amountCents) wins += 1;
      initialGame.status = "settled";
      initialGame.outcome = settlement.outcome;
      initialGame.payoutCents = settlement.payoutCents;
      initialGame.profitCents = settlement.payoutCents - amountCents;
      initialGame.balanceCents = balanceAfter;
      initialGame.level = progression.level;
      initialGame.gamesTowardNextLevel = progression.gamesTowardNextLevel;
      initialGame.levelRewardCents = progression.rewardCents;
    }
    if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
      throw new HttpsError("failed-precondition", "Saldo resultante inválido.");
    }

    transaction.update(userRef, {
      balanceCents: balanceAfter,
      gamesPlayed,
      wins,
      ...(initialGame.status === "settled" ? {
        level: progression.level,
        gamesTowardNextLevel: progression.gamesTowardNextLevel,
      } : {}),
      lastGameActionAtMs: startedAtMs,
      ...(initialGame.status === "settled" ? profitTotals(initialGame.profitCents) : {}),
    });
    transaction.update(rankRef, {
      balanceCents: balanceAfter,
      ...(initialGame.status === "settled" ? { level: progression.level } : {}),
    });
    transaction.set(gameRef, initialGame);
    transaction.create(betHistoryRef, {
      description: "Blackjack · aposta",
      deltaCents: -amountCents,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (initialGame.status === "settled" && settlementPayout(initialGame) > 0) {
      transaction.create(payoutHistoryRef, {
        description: `Blackjack · ${initialGame.outcome}`,
        deltaCents: initialGame.payoutCents,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    if (initialGame.status === "settled") {
      recordMinigameSettlement(transaction, userRef, {
        gameId: "blackjack",
        gameName: "Blackjack",
        outcome: initialGame.payoutCents > amountCents ? "won" : initialGame.payoutCents < amountCents ? "lost" : "tied",
        netCents: initialGame.profitCents,
        summary: `Blackjack · ${initialGame.outcome}`,
        recordId: `blackjack_${gameId}`,
        atMs: startedAtMs,
        clanId: typeof profile.clanId === "string" ? profile.clanId : "",
      });
      registrarPremioNivel(transaction, userRef, requestId, progression);
    }
    response = publicBlackjackState(initialGame);
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });

  return response;
});

function settlementPayout(game) {
  return Number.isSafeInteger(game.payoutCents) ? game.payoutCents : 0;
}

exports.blackjackAction = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const gameId = request.data?.gameId;
  const requestId = request.data?.requestId;
  const action = request.data?.action;
  if (typeof gameId !== "string" || !/^[a-f0-9-]{36}$/i.test(gameId)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || !["hit", "stand", "double"].includes(action)) {
    throw new HttpsError("invalid-argument", "Ação ou identificador inválido.");
  }

  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const gameRef = userRef.collection("games").doc("blackjack");
  const requestRef = userRef.collection("gameRequests").doc(requestId);
  const extraBetRef = userRef.collection("transactions").doc(`${requestId}_blackjack_double`);
  const payoutRef = userRef.collection("transactions").doc(`${requestId}_blackjack_payout`);
  let response;

  await database.runTransaction(async (transaction) => {
    const previousRequest = await transaction.get(requestRef);
    if (previousRequest.exists) {
      response = previousRequest.data().response;
      return;
    }
    const [gameSnapshot, userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    if (!gameSnapshot.exists || gameSnapshot.data().gameId !== gameId) {
      throw new HttpsError("failed-precondition", "Esta mão não está ativa.");
    }
    if (gameSnapshot.data().status === "settled") {
      response = publicBlackjackState(gameSnapshot.data());
      transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
      return;
    }
    if (gameSnapshot.data().status !== "active") {
      throw new HttpsError("failed-precondition", "Esta mão não está ativa.");
    }
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }

    const game = gameSnapshot.data();
    const profile = userSnapshot.data();
    const actionAtMs = Date.now();
    enforceGameCooldown(profile, actionAtMs);
    const playerCards = [...game.playerCards];
    const dealerCards = [...game.dealerCards];
    let nextCardIndex = game.nextCardIndex;
    let wagerCents = game.wagerCents;
    let extraWagerCents = 0;
    if (action === "double") {
      if (playerCards.length !== 2) {
        throw new HttpsError("failed-precondition", "Dobrar só é permitido nas duas primeiras cartas.");
      }
      if ((profile.balanceCents || 0) < wagerCents) {
        throw new HttpsError("failed-precondition", "Saldo insuficiente para dobrar.");
      }
      extraWagerCents = wagerCents;
      wagerCents *= 2;
    }

    let finished = action === "stand" || action === "double";
    if (action === "hit" || action === "double") {
      if (nextCardIndex >= game.deck.length) {
        throw new HttpsError("internal", "Não há cartas disponíveis nesta mão.");
      }
      playerCards.push(game.deck[nextCardIndex]);
      nextCardIndex += 1;
      if (blackjackHandValue(playerCards).total >= 21) finished = true;
    }

    if (!finished) {
      const updatedGame = { ...game, playerCards, nextCardIndex };
      transaction.update(gameRef, { playerCards, nextCardIndex });
      response = publicBlackjackState(updatedGame);
      transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
      return;
    }

    while (blackjackHandValue(dealerCards).total < 17) {
      if (nextCardIndex >= game.deck.length) {
        throw new HttpsError("internal", "Não há cartas disponíveis para o dealer.");
      }
      dealerCards.push(game.deck[nextCardIndex]);
      nextCardIndex += 1;
    }
    const playerBusted = blackjackHandValue(playerCards).total > 21;
    const settlement = settleBlackjack(playerCards, dealerCards, wagerCents, playerBusted);
    const balanceBeforePayout = (profile.balanceCents || 0) - extraWagerCents;
    const balanceAfter = balanceBeforePayout + settlement.payoutCents;
    if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
      throw new HttpsError("failed-precondition", "Saldo resultante inválido.");
    }
    const gamesPlayed = (profile.gamesPlayed || 0) + 1;
    const wins = (profile.wins || 0) + (settlement.payoutCents > wagerCents ? 1 : 0);
    const progression = levelProgress(gamesPlayed);
    const missions = advanceMissionProgress(profile, actionAtMs);
    const balanceFinal = balanceAfter + progression.rewardCents + missions.totalRewardCents;
    if (!Number.isSafeInteger(balanceFinal)) {
      throw new HttpsError("failed-precondition", "Saldo resultante inválido.");
    }
    const finalGame = {
      ...game,
      status: "settled",
      playerCards,
      dealerCards,
      nextCardIndex,
      wagerCents,
      outcome: settlement.outcome,
      payoutCents: settlement.payoutCents,
      profitCents: settlement.payoutCents - wagerCents,
      balanceCents: balanceFinal,
      level: progression.level,
      gamesTowardNextLevel: progression.gamesTowardNextLevel,
      levelRewardCents: progression.rewardCents,
    };

    transaction.update(userRef, {
      balanceCents: balanceFinal,
      gamesPlayed,
      wins,
      level: progression.level,
      gamesTowardNextLevel: progression.gamesTowardNextLevel,
      lastGameActionAtMs: actionAtMs,
      ...missions.profileFields,
      ...profitTotals(finalGame.profitCents),
    });
    transaction.update(rankRef, { balanceCents: balanceFinal, level: progression.level });
    transaction.update(gameRef, finalGame);
    if (extraWagerCents > 0) {
      transaction.create(extraBetRef, {
        description: "Blackjack · dobrar aposta",
        deltaCents: -extraWagerCents,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    if (settlement.payoutCents > 0) {
      transaction.create(payoutRef, {
        description: `Blackjack · ${settlement.outcome}`,
        deltaCents: settlement.payoutCents,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    recordMinigameSettlement(transaction, userRef, {
      gameId: "blackjack",
      gameName: "Blackjack",
      outcome: settlement.payoutCents > wagerCents ? "won" : settlement.payoutCents < wagerCents ? "lost" : "tied",
      netCents: finalGame.profitCents,
      summary: `Blackjack · ${settlement.outcome}`,
      recordId: `blackjack_${gameId}`,
      atMs: actionAtMs,
      clanId: typeof profile.clanId === "string" ? profile.clanId : "",
    });
    registrarPremioNivel(transaction, userRef, requestId, progression);
    registrarPremiosMissao(transaction, userRef, missions);
    response = publicBlackjackState(finalGame);
    transaction.create(requestRef, { response, createdAt: FieldValue.serverTimestamp() });
  });

  return response;
});

exports.buyCosmetic = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const itemId = request.data?.itemId;
  const product = COSMETICS[itemId];
  if (!product) {
    throw new HttpsError("invalid-argument", "Item não encontrado.");
  }

  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const transactionRef = userRef.collection("transactions").doc();
  let response;
  await database.runTransaction(async (transaction) => {
    const [userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }
    const profile = userSnapshot.data();
    const inventory = Array.isArray(profile.inventory) ? profile.inventory : [];
    if (inventory.includes(itemId)) {
      throw new HttpsError("already-exists", "Você já tem este item.");
    }
    const balance = profile.balanceCents || 0;
    if (balance < product.priceCents) {
      throw new HttpsError("failed-precondition", "Saldo insuficiente.");
    }
    const balanceAfter = balance - product.priceCents;
    transaction.update(userRef, {
      balanceCents: balanceAfter,
      inventory: [...inventory, itemId],
    });
    transaction.update(rankRef, { balanceCents: balanceAfter });
    transaction.create(transactionRef, {
      description: `Loja · ${product.name}`,
      deltaCents: -product.priceCents,
      createdAt: FieldValue.serverTimestamp(),
    });
    response = { itemId, balanceCents: balanceAfter };
  });
  return response;
});

exports.equipFrame = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const itemId = request.data?.itemId;
  if (typeof itemId !== "string" || itemId.length > 64) {
    throw new HttpsError("invalid-argument", "Item inválido.");
  }

  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  await database.runTransaction(async (transaction) => {
    const [userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }
    if (itemId !== "") {
      const inventory = Array.isArray(userSnapshot.data().inventory) ? userSnapshot.data().inventory : [];
      if (!itemId.startsWith("frame_") || !COSMETICS[itemId] || !inventory.includes(itemId)) {
        throw new HttpsError("failed-precondition", "Você não possui esta moldura.");
      }
    }
    transaction.update(userRef, { equippedFrame: itemId });
    transaction.update(rankRef, { equippedFrame: itemId });
  });

  return { ok: true, equippedFrame: itemId };
});

exports.equipTitle = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const itemId = request.data?.itemId || "";
  if (typeof itemId !== "string" || itemId.length > 64
      || (itemId && (!itemId.startsWith("title_") || !COSMETICS[itemId]))) {
    throw new HttpsError("invalid-argument", "Título inválido.");
  }

  const userRef = database.collection("users").doc(uid);
  await database.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }
    if (itemId) {
      const inventory = Array.isArray(userSnapshot.get("inventory")) ? userSnapshot.get("inventory") : [];
      if (!itemId.startsWith("title_") || !COSMETICS[itemId] || !inventory.includes(itemId)) {
        throw new HttpsError("failed-precondition", "Você não possui este título.");
      }
    }
    transaction.update(userRef, { equippedTitle: itemId });
  });

  return { ok: true, equippedTitle: itemId };
});

exports.equipAvatarItem = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const slot = request.data?.slot;
  const itemId = request.data?.itemId || "";
  if (!Object.values(AVATAR_ITEM_SLOTS).includes(slot)
      || (itemId && AVATAR_ITEM_SLOTS[itemId] !== slot)) {
    throw new HttpsError("invalid-argument", "Peça de avatar inválida para este espaço.");
  }
  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  let equippedAvatarItems;
  await database.runTransaction(async (transaction) => {
    const [userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    }
    const inventory = Array.isArray(userSnapshot.get("inventory")) ? userSnapshot.get("inventory") : [];
    const currentItems = Array.isArray(userSnapshot.get("equippedAvatarItems"))
      ? userSnapshot.get("equippedAvatarItems")
      : [];
    try {
      equippedAvatarItems = itemId
        ? equipAvatarItem(currentItems, inventory, itemId)
        : unequipAvatarSlot(currentItems, slot);
    } catch (error) {
      if (error.message === "avatar-item-not-owned") {
        throw new HttpsError("failed-precondition", "Você ainda não possui esta peça.");
      }
      throw new HttpsError("invalid-argument", "Peça de avatar inválida.");
    }
    transaction.update(userRef, { equippedAvatarItems });
    transaction.update(rankRef, { equippedAvatarItems });
  });
  return { ok: true, equippedAvatarItems };
});

exports.getPlayerProfile = onCall(async (request) => {
  const requesterUid = authenticatedUid(request);
  const targetUid = request.data?.uid;
  if (typeof targetUid !== "string" || targetUid.length < 1 || targetUid.length > 128) {
    throw new HttpsError("invalid-argument", "Jogador inválido.");
  }

  const [rankSnapshot, userSnapshot] = await Promise.all([
    database.collection("leaderboard").doc(targetUid).get(),
    database.collection("users").doc(targetUid).get(),
  ]);
  if (!rankSnapshot.exists || !userSnapshot.exists) {
    throw new HttpsError("not-found", "Jogador não encontrado.");
  }

  const rank = rankSnapshot.data();
  const profile = userSnapshot.data();
  if (requesterUid !== targetUid) {
    const [settingsSnapshot, requesterFriendship, targetFriendship] = await Promise.all([
      database.collection("users").doc(targetUid).collection("preferences").doc("appSettings").get(),
      database.collection("users").doc(requesterUid).collection("friends").doc(targetUid).get(),
      database.collection("users").doc(targetUid).collection("friends").doc(requesterUid).get(),
    ]);
    const privateProfile = settingsSnapshot.get("profileVisibility") === "private";
    const isFriend = requesterFriendship.exists && targetFriendship.exists
      && requesterFriendship.get("status") === "accepted"
      && targetFriendship.get("status") === "accepted";
    if (!canViewPlayerProfile(requesterUid, targetUid, privateProfile ? "private" : "public", isFriend)) {
      throw new HttpsError("permission-denied", "Este perfil está disponível apenas para amigos.");
    }
  }
  return {
    uid: targetUid,
    displayName: rank.displayName || "Jogador",
    username: rank.username || "",
    bio: typeof profile.bio === "string" ? profile.bio : "",
    level: rank.level || 1,
    avatarUrl: rank.avatarUrl || "",
    avatarAsProfilePhoto: rank.avatarAsProfilePhoto === true,
    equippedAvatarItems: Array.isArray(rank.equippedAvatarItems) ? rank.equippedAvatarItems : [],
    balanceCents: 0,
    gamesPlayed: Number.isSafeInteger(profile.gamesPlayed) ? profile.gamesPlayed : 0,
    wins: Number.isSafeInteger(profile.wins) ? profile.wins : 0,
    inventory: [],
    pixKey: "",
    pixKeyType: "",
    equippedFrame: typeof profile.equippedFrame === "string" ? profile.equippedFrame : "",
    equippedTitle: typeof profile.equippedTitle === "string" ? profile.equippedTitle : "",
  };
});

exports.getGameSettings = onCall(async (request) => {
  authenticatedUid(request);
  const snapshot = await database.collection("systemSettings").doc("games").get();
  const settings = snapshot.data() || {};
  return {
    minesRtpBps: Number.isInteger(settings.minesRtpBps) ? settings.minesRtpBps : DEFAULT_MINES_RTP_BPS,
    minesMinCount: Number.isInteger(settings.minesMinCount) ? settings.minesMinCount : 1,
    minesMaxCount: Number.isInteger(settings.minesMaxCount) ? settings.minesMaxCount : 24,
  };
});

exports.getMissions = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const profile = await database.collection("users").doc(uid).get();
  if (!profile.exists) throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
  return getMissionProgress(profile.data(), Date.now());
});

exports.adminUpdateGameSettings = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const minesRtpBps = request.data?.minesRtpBps;
  const minesMinCount = request.data?.minesMinCount;
  const minesMaxCount = request.data?.minesMaxCount;
  const requestId = request.data?.requestId;
  const reason = typeof request.data?.reason === "string" ? request.data.reason.trim() : "";
  if (!Number.isInteger(minesRtpBps) || minesRtpBps < 9_000 || minesRtpBps > 10_000
      || !Number.isInteger(minesMinCount) || minesMinCount < 1 || minesMinCount > 24
      || !Number.isInteger(minesMaxCount) || minesMaxCount < minesMinCount || minesMaxCount > 24
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || reason.length < 8 || reason.length > 200) {
    throw new HttpsError("invalid-argument", "Configuração, motivo ou identificador inválido.");
  }
  const settingsRef = database.collection("systemSettings").doc("games");
  const auditRef = database.collection("adminAuditLogs").doc(`${adminUid}_${requestId}`);
  const settings = { minesRtpBps, minesMinCount, minesMaxCount };
  let response;
  await database.runTransaction(async (transaction) => {
    const [auditSnapshot, settingsSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(settingsRef),
    ]);
    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (previous.action !== "update_game_settings" || previous.reason !== reason
          || previous.minesRtpBps !== minesRtpBps
          || previous.minesMinCount !== minesMinCount || previous.minesMaxCount !== minesMaxCount) {
        throw new HttpsError("already-exists", "Identificador de alteração já utilizado.");
      }
      response = previous.response;
      return;
    }
    transaction.set(settingsRef, {
      ...(settingsSnapshot.data() || {}),
      ...settings,
      updatedBy: adminUid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    response = { ok: true, ...settings };
    transaction.create(auditRef, {
      actorUid: adminUid,
      action: "update_game_settings",
      reason,
      ...settings,
      response,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return response;
});

exports.adminListUsers = onCall(async (request) => {
  requireAdmin(request);
  const cursor = request.data?.cursor;
  if (cursor != null && (typeof cursor !== "string" || cursor.length > 128)) {
    throw new HttpsError("invalid-argument", "Cursor inválido.");
  }
  let query = database.collection("users").orderBy(FieldPath.documentId()).limit(40);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  return {
    users: snapshot.docs.map((document) => {
      const user = document.data();
      return {
        uid: document.id,
        displayName: user.displayName || "Jogador",
        username: user.username || "",
        email: user.email || "",
        avatarUrl: user.avatarUrl || "",
        avatarAsProfilePhoto: user.avatarAsProfilePhoto === true,
        equippedAvatarItems: Array.isArray(user.equippedAvatarItems) ? user.equippedAvatarItems : [],
        equippedFrame: user.equippedFrame || "",
        balanceCents: user.balanceCents || 0,
        isBlocked: user.isBlocked === true,
      };
    }),
    nextCursor: snapshot.size === 40 ? snapshot.docs[snapshot.size - 1].id : "",
  };
});

exports.adminGetUserDetails = onCall(async (request) => {
  requireAdmin(request);
  const targetUid = request.data?.uid;
  if (typeof targetUid !== "string" || targetUid.length < 1 || targetUid.length > 128) {
    throw new HttpsError("invalid-argument", "Conta inválida.");
  }
  const userRef = database.collection("users").doc(targetUid);
  const [userSnapshot, transactionSnapshot] = await Promise.all([
    userRef.get(),
    userRef.collection("transactions").orderBy("createdAt", "desc").limit(50).get(),
  ]);
  if (!userSnapshot.exists) throw new HttpsError("not-found", "Conta não encontrada.");
  const user = userSnapshot.data();
  return {
    user: {
      uid: targetUid,
      displayName: user.displayName || "Jogador",
      username: user.username || "",
      email: user.email || "",
      avatarUrl: user.avatarUrl || "",
      avatarAsProfilePhoto: user.avatarAsProfilePhoto === true,
      equippedAvatarItems: Array.isArray(user.equippedAvatarItems) ? user.equippedAvatarItems : [],
      equippedFrame: user.equippedFrame || "",
      balanceCents: user.balanceCents || 0,
      isBlocked: user.isBlocked === true,
      gamesPlayed: user.gamesPlayed || 0,
      wins: user.wins || 0,
      inventory: Array.isArray(user.inventory)
        ? user.inventory.filter((itemId) => typeof itemId === "string" && Object.hasOwn(COSMETICS, itemId))
        : [],
    },
    transactions: transactionSnapshot.docs.map((document) => {
      const entry = document.data();
      return {
        id: document.id,
        description: entry.description || "Movimentação",
        deltaCents: entry.deltaCents || 0,
        type: entry.type || "",
        createdAtMs: timestampMillis(entry.createdAt) || 0,
      };
    }),
  };
});

exports.adminUpdateUserInventory = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const targetUid = request.data?.uid;
  const action = request.data?.action;
  const itemId = request.data?.itemId;
  const requestId = request.data?.requestId;
  const reason = typeof request.data?.reason === "string" ? request.data.reason.trim() : "";
  if (typeof targetUid !== "string" || targetUid.length < 1 || targetUid.length > 128
      || !["add", "remove"].includes(action)
      || typeof itemId !== "string" || !Object.hasOwn(COSMETICS, itemId)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || reason.length < 8 || reason.length > 200) {
    throw new HttpsError("invalid-argument", "Ação, item, motivo ou identificador inválido.");
  }

  const userRef = database.collection("users").doc(targetUid);
  const rankRef = database.collection("leaderboard").doc(targetUid);
  const auditRef = database.collection("adminAuditLogs").doc(`${adminUid}_${requestId}`);
  let response;
  await database.runTransaction(async (transaction) => {
    const [auditSnapshot, userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (previous.action !== "update_inventory" || previous.targetUid !== targetUid
          || previous.inventoryAction !== action || previous.itemId !== itemId || previous.reason !== reason) {
        throw new HttpsError("already-exists", "Identificador de inventário já utilizado.");
      }
      response = previous.response;
      return;
    }
    if (!userSnapshot.exists) throw new HttpsError("not-found", "Conta não encontrada.");
    const inventory = Array.isArray(userSnapshot.get("inventory")) ? userSnapshot.get("inventory") : [];
    if (action === "add" && inventory.includes(itemId)) {
      throw new HttpsError("already-exists", "O usuário já possui este item.");
    }
    if (action === "remove" && !inventory.includes(itemId)) {
      throw new HttpsError("failed-precondition", "O usuário não possui este item.");
    }

    const nextInventory = action === "add"
      ? [...inventory, itemId]
      : inventory.filter((ownedItemId) => ownedItemId !== itemId);
    const userUpdate = { inventory: nextInventory };
    let equippedAvatarItems;
    const rankUpdate = {};
    if (action === "remove") {
      if (userSnapshot.get("equippedFrame") === itemId) {
        userUpdate.equippedFrame = "";
        rankUpdate.equippedFrame = "";
      }
      if (userSnapshot.get("equippedTitle") === itemId) userUpdate.equippedTitle = "";
      const currentEquipped = Array.isArray(userSnapshot.get("equippedAvatarItems"))
        ? userSnapshot.get("equippedAvatarItems")
        : [];
      equippedAvatarItems = currentEquipped.filter((equippedItemId) => equippedItemId !== itemId);
      if (equippedAvatarItems.length !== currentEquipped.length) {
        userUpdate.equippedAvatarItems = equippedAvatarItems;
      }
    }
    transaction.update(userRef, userUpdate);
    if (equippedAvatarItems) rankUpdate.equippedAvatarItems = equippedAvatarItems;
    if (Object.keys(rankUpdate).length > 0 && rankSnapshot.exists) {
      transaction.update(rankRef, rankUpdate);
    }
    response = { ok: true, uid: targetUid, action, itemId, inventory: nextInventory };
    transaction.create(auditRef, {
      actorUid: adminUid,
      targetUid,
      action: "update_inventory",
      inventoryAction: action,
      itemId,
      reason,
      response,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return response;
});

exports.adminAdjustBalance = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const targetUid = request.data?.uid;
  const deltaCents = request.data?.deltaCents;
  const requestId = request.data?.requestId;
  const reason = typeof request.data?.reason === "string" ? request.data.reason.trim() : "";
  if (typeof targetUid !== "string" || targetUid.length < 1 || targetUid.length > 128
      || !Number.isSafeInteger(deltaCents) || deltaCents === 0 || Math.abs(deltaCents) > MAX_TRANSFER_CENTS
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || reason.length < 8 || reason.length > 200) {
    throw new HttpsError("invalid-argument", "Ajuste, motivo ou identificador inválido.");
  }
  const userRef = database.collection("users").doc(targetUid);
  const rankRef = database.collection("leaderboard").doc(targetUid);
  const historyRef = userRef.collection("transactions").doc(`admin_${requestId}`);
  const auditRef = database.collection("adminAuditLogs").doc(`${adminUid}_${requestId}`);
  let response;
  await database.runTransaction(async (transaction) => {
    const [auditSnapshot, userSnapshot, rankSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(userRef),
      transaction.get(rankRef),
    ]);
    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (previous.action !== "adjust_balance" || previous.targetUid !== targetUid
          || previous.deltaCents !== deltaCents || previous.reason !== reason) {
        throw new HttpsError("already-exists", "Identificador de ajuste já utilizado.");
      }
      response = previous.response;
      return;
    }
    if (!userSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError("not-found", "Conta ou ranking não encontrado.");
    }
    const balanceCents = (userSnapshot.get("balanceCents") || 0) + deltaCents;
    if (!Number.isSafeInteger(balanceCents) || balanceCents < 0) {
      throw new HttpsError("failed-precondition", "O ajuste deixaria o saldo negativo ou inválido.");
    }
    transaction.update(userRef, { balanceCents });
    transaction.update(rankRef, { balanceCents });
    transaction.create(historyRef, {
      description: `Ajuste administrativo · ${reason}`,
      deltaCents,
      type: "admin_adjustment",
      adminUid,
      reason,
      createdAt: FieldValue.serverTimestamp(),
    });
    response = { ok: true, uid: targetUid, balanceCents };
    transaction.create(auditRef, {
      actorUid: adminUid,
      targetUid,
      action: "adjust_balance",
      deltaCents,
      reason,
      response,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return response;
});

exports.adminSetUserBlocked = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const targetUid = request.data?.uid;
  const blocked = request.data?.blocked;
  const requestId = request.data?.requestId;
  const reason = typeof request.data?.reason === "string" ? request.data.reason.trim() : "";
  if (typeof targetUid !== "string" || targetUid.length < 1 || targetUid.length > 128
      || typeof blocked !== "boolean" || targetUid === adminUid
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || reason.length < 8 || reason.length > 200) {
    throw new HttpsError("invalid-argument", "Ação, motivo ou identificador inválido.");
  }
  const userRef = database.collection("users").doc(targetUid);
  const auditRef = database.collection("adminAuditLogs").doc(`${adminUid}_${requestId}`);
  const previousAudit = await auditRef.get();
  if (previousAudit.exists) {
    const previous = previousAudit.data();
    const expectedAction = blocked ? "block_user" : "unblock_user";
    if (previous.action !== expectedAction || previous.targetUid !== targetUid || previous.reason !== reason) {
      throw new HttpsError("already-exists", "Identificador de bloqueio já utilizado.");
    }
    try {
      await getAuth().updateUser(targetUid, { disabled: previous.blocked });
    } catch {
      throw new HttpsError("not-found", "Conta de autenticação não encontrada.");
    }
    return previous.response;
  }
  if (!blocked) {
    const profileSnapshot = await userRef.get();
    if (!profileSnapshot.exists) throw new HttpsError("not-found", "Conta não encontrada.");
    try {
      await getAuth().updateUser(targetUid, { disabled: false });
    } catch {
      throw new HttpsError("not-found", "Conta de autenticação não encontrada.");
    }
  }
  let response;
  await database.runTransaction(async (transaction) => {
    const [auditSnapshot, userSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(userRef),
    ]);
    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      const expectedAction = blocked ? "block_user" : "unblock_user";
      if (previous.action !== expectedAction || previous.targetUid !== targetUid || previous.reason !== reason) {
        throw new HttpsError("already-exists", "Identificador de bloqueio já utilizado.");
      }
      response = previous.response;
      return;
    }
    if (!userSnapshot.exists) throw new HttpsError("not-found", "Conta não encontrada.");
    transaction.update(userRef, {
      isBlocked: blocked,
      blockReason: blocked ? reason : "",
      blockedAt: blocked ? FieldValue.serverTimestamp() : FieldValue.delete(),
    });
    response = { ok: true, uid: targetUid, isBlocked: blocked };
    transaction.create(auditRef, {
      actorUid: adminUid,
      targetUid,
      action: blocked ? "block_user" : "unblock_user",
      blocked,
      reason,
      response,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  if (blocked) {
    try {
      await getAuth().updateUser(targetUid, { disabled: true });
    } catch {
      throw new HttpsError("failed-precondition", "A conta foi bloqueada no app, mas o Auth não confirmou a desativação.");
    }
  }
  return response;
});

exports.adminDeleteUser = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const targetUid = request.data?.uid;
  const confirmUid = request.data?.confirmUid;
  const requestId = request.data?.requestId;
  const reason = typeof request.data?.reason === "string" ? request.data.reason.trim() : "";
  if (typeof targetUid !== "string" || targetUid.length < 1 || targetUid.length > 128
      || confirmUid !== targetUid || targetUid === adminUid
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)
      || reason.length < 8 || reason.length > 200) {
    throw new HttpsError("invalid-argument", "Confirme o UID e informe o motivo da exclusão.");
  }
  const auditRef = database.collection("adminAuditLogs").doc(`${adminUid}_${requestId}`);
  const previous = await auditRef.get();
  const targetUidHash = createHash("sha256").update(targetUid).digest("hex");
  if (previous.exists) {
    if (previous.get("action") !== "delete_user" || previous.get("targetUidHash") !== targetUidHash) {
      throw new HttpsError("already-exists", "Identificador de exclusão já utilizado.");
    }
    return previous.get("response");
  }

  try {
    const targetAuth = await getAuth().getUser(targetUid);
    if (targetAuth.customClaims?.admin === true) {
      throw new HttpsError("failed-precondition", "Remova a permissão admin antes de excluir esta conta.");
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error.code !== "auth/user-not-found") throw error;
  }

  await deleteCloudinaryAvatarFolder(targetUid);

  const userRef = database.collection("users").doc(targetUid);
  const profileSnapshot = await userRef.get();
  const profile = profileSnapshot.data() || {};
  if (typeof profile.whatsappLink?.jid === "string") {
    const linkRef = database.collection("whatsappAccountLinks")
      .doc(createHash("sha256").update(profile.whatsappLink.jid).digest("hex"));
    const linkSnapshot = await linkRef.get();
    if (linkSnapshot.exists && linkSnapshot.get("uid") === targetUid) await linkRef.delete();
  }
  await database.collection("whatsappLinkCodes").doc(targetUid).delete();
  const chatSnapshot = await database.collection("chats")
    .where("participantUids", "array-contains", targetUid).get();
  for (const chatDocument of chatSnapshot.docs) {
    const chat = chatDocument.data();
    if (chat.type !== "group") {
      await database.recursiveDelete(chatDocument.ref);
      continue;
    }
    const participants = (Array.isArray(chat.participantUids) ? chat.participantUids : [])
      .filter((participantUid) => participantUid !== targetUid);
    if (participants.length === 0) {
      await database.recursiveDelete(chatDocument.ref);
      continue;
    }
    const admins = (Array.isArray(chat.adminUids) ? chat.adminUids : [])
      .filter((participantUid) => participantUid !== targetUid);
    const update = {
      participantUids: participants,
      adminUids: admins,
    };
    if (chat.createdBy === targetUid) {
      update.createdBy = participants[0];
      if (!admins.includes(participants[0])) update.adminUids.push(participants[0]);
    }
    if (chat.lastMessageSenderUid === targetUid) {
      update.lastMessage = "Mensagem removida";
      update.lastMessageId = "";
      update.lastMessageSenderUid = "";
      update.lastMessageAt = FieldValue.serverTimestamp();
    }
    if (Array.isArray(chat.streakParticipantsToday)) {
      update.streakParticipantsToday = chat.streakParticipantsToday.filter((participantUid) => participantUid !== targetUid);
    }
    await chatDocument.ref.update(update);
    await deleteMatchingDocuments(
      chatDocument.ref.collection("messages").where("senderUid", "==", targetUid),
    );
  }

  await deleteUserTransfers(targetUid);
  await Promise.all([
    deleteMatchingDocuments(database.collection("usernames").where("uid", "==", targetUid)),
    deleteMatchingDocuments(database.collection("pixKeys").where("uid", "==", targetUid)),
  ]);
  if (profile.username) await database.collection("usernames").doc(profile.username).delete();
  if (profile.pixKeyHash) await database.collection("pixKeys").doc(profile.pixKeyHash).delete();
  await database.collection("leaderboard").doc(targetUid).delete();
  await database.recursiveDelete(userRef);
  try {
    await getAuth().deleteUser(targetUid);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }
  const response = { ok: true, deleted: true };
  await auditRef.create({
    actorUid: adminUid,
    targetUidHash,
    action: "delete_user",
    reason,
    response,
    createdAt: FieldValue.serverTimestamp(),
  });
  return response;
});

exports.createChatGroup = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const name = typeof request.data?.name === "string" ? request.data.name.trim().replace(/\s+/g, " ") : "";
  const description = typeof request.data?.description === "string" ? request.data.description.trim().slice(0, 160) : "";
  const editPolicy = request.data?.editPolicy === "members" ? "members" : "creator";
  const sendPolicy = ["creator", "admins"].includes(request.data?.sendPolicy)
    ? request.data.sendPolicy
    : "everyone";
  const requestId = request.data?.requestId;
  const selectedUids = request.data?.memberUids;
  if (name.length < 2 || name.length > 32) {
    throw new HttpsError("invalid-argument", "O nome do grupo deve ter entre 2 e 32 caracteres.");
  }
  if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Identificador do grupo inválido.");
  }
  if (!Array.isArray(selectedUids) || selectedUids.some((memberUid) => typeof memberUid !== "string")) {
    throw new HttpsError("invalid-argument", "Selecione os participantes do grupo.");
  }
  const participantUids = [...new Set([uid, ...selectedUids])].sort();
  if (participantUids.length < 2 || participantUids.length > 20) {
    throw new HttpsError("invalid-argument", "Um grupo precisa ter de 2 a 20 pessoas.");
  }

  const chatRef = database.collection("chats").doc(requestId);
  const participantRefs = participantUids.map((memberUid) => database.collection("users").doc(memberUid));
  let response;
  await database.runTransaction(async (transaction) => {
    const existing = await transaction.get(chatRef);
    if (existing.exists) {
      if (existing.get("createdBy") !== uid) throw new HttpsError("already-exists", "Identificador do grupo já utilizado.");
      response = { chatId: requestId };
      return;
    }
    const profiles = await Promise.all(participantRefs.map((ref) => transaction.get(ref)));
    if (profiles.some((profile) => !profile.exists || profile.get("profileSetupComplete") !== true)) {
      throw new HttpsError("not-found", "Um dos participantes não tem perfil configurado.");
    }
    const now = FieldValue.serverTimestamp();
    transaction.create(chatRef, {
      type: "group",
      name,
      description,
      createdBy: uid,
      adminUids: [uid],
      photoUrl: "",
      editPolicy,
      sendPolicy,
      participantUids,
      lastMessage: "Grupo criado",
      lastMessageAt: now,
      lastMessageId: requestId,
      lastMessageSenderUid: uid,
      createdAt: now,
      streakDays: 0,
      streakLevel: 0,
      streakName: "Nosso foguinho",
      streakLastQualifiedDate: "",
      streakActivityDate: "",
      streakParticipantsToday: [],
    });
    response = { chatId: requestId };
  });
  return response;
});

exports.updateChatGroup = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const chatId = request.data?.chatId;
  const name = typeof request.data?.name === "string" ? request.data.name.trim().replace(/\s+/g, " ") : "";
  const description = typeof request.data?.description === "string" ? request.data.description.trim() : "";
  const editPolicy = request.data?.editPolicy;
  const sendPolicy = request.data?.sendPolicy;
  if (typeof chatId !== "string" || !/^[a-f0-9-]{36}$/i.test(chatId)
      || name.length < 2 || name.length > 32 || description.length > 160
      || !["creator", "members"].includes(editPolicy)
      || !["creator", "admins", "everyone"].includes(sendPolicy)) {
    throw new HttpsError("invalid-argument", "As configurações do grupo são inválidas.");
  }
  const chatRef = database.collection("chats").doc(chatId);
  await database.runTransaction(async (transaction) => {
    const chatSnapshot = await transaction.get(chatRef);
    if (!chatSnapshot.exists || chatSnapshot.get("type") !== "group"
        || !chatSnapshot.get("participantUids")?.includes(uid)) {
      throw new HttpsError("permission-denied", "Você não participa deste grupo.");
    }
    const group = chatSnapshot.data();
    const admins = Array.isArray(group.adminUids) ? group.adminUids : [group.createdBy];
    if (!admins.includes(uid) && group.editPolicy !== "members") {
      throw new HttpsError("permission-denied", "Somente admins podem alterar as configurações do grupo.");
    }
    transaction.update(chatRef, { name, description, editPolicy, sendPolicy });
  });
  return { ok: true };
});

exports.manageChatGroupMembers = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const chatId = request.data?.chatId;
  const action = request.data?.action;
  const targetUid = request.data?.targetUid;
  const requestedUids = request.data?.memberUids;
  if (typeof chatId !== "string" || !/^[a-f0-9-]{36}$/i.test(chatId)
      || !["add", "promote", "demote", "remove"].includes(action)) {
    throw new HttpsError("invalid-argument", "Ação de grupo inválida.");
  }
  if (["promote", "demote", "remove"].includes(action)
      && (typeof targetUid !== "string" || !targetUid)) {
    throw new HttpsError("invalid-argument", "Selecione um participante.");
  }
  if (action === "add"
      && (!Array.isArray(requestedUids) || requestedUids.some((memberUid) => typeof memberUid !== "string"))) {
    throw new HttpsError("invalid-argument", "Selecione participantes válidos.");
  }

  const chatRef = database.collection("chats").doc(chatId);
  await database.runTransaction(async (transaction) => {
    const chatSnapshot = await transaction.get(chatRef);
    if (!chatSnapshot.exists || chatSnapshot.get("type") !== "group") {
      throw new HttpsError("not-found", "Grupo não encontrado.");
    }
    const group = chatSnapshot.data();
    const participants = Array.isArray(group.participantUids) ? [...new Set(group.participantUids)] : [];
    const admins = Array.isArray(group.adminUids) ? [...new Set(group.adminUids)] : [group.createdBy];
    const isCreator = group.createdBy === uid;
    if (!isCreator && !admins.includes(uid)) {
      throw new HttpsError("permission-denied", "Somente admins podem gerenciar participantes.");
    }

    if (action === "add") {
      const additions = [...new Set(requestedUids)].filter((memberUid) => !participants.includes(memberUid));
      if (additions.length === 0) return;
      if (participants.length + additions.length > 100) {
        throw new HttpsError("resource-exhausted", "O grupo pode ter no máximo 100 participantes.");
      }
      const profiles = await Promise.all(
        additions.map((memberUid) => transaction.get(database.collection("users").doc(memberUid))),
      );
      if (profiles.some((profile) => !profile.exists || profile.get("profileSetupComplete") !== true)) {
        throw new HttpsError("not-found", "Um dos participantes não tem perfil configurado.");
      }
      transaction.update(chatRef, { participantUids: [...participants, ...additions].sort() });
      return;
    }

    if (!participants.includes(targetUid)) {
      throw new HttpsError("not-found", "Este usuário não participa do grupo.");
    }
    if (targetUid === group.createdBy) {
      throw new HttpsError("failed-precondition", "O criador deve continuar no grupo como admin.");
    }

    if (action === "promote") {
      if (!admins.includes(targetUid)) transaction.update(chatRef, { adminUids: [...admins, targetUid] });
      return;
    }
    if (action === "demote") {
      if (!isCreator) throw new HttpsError("permission-denied", "Somente o criador pode rebaixar outro admin.");
      transaction.update(chatRef, { adminUids: admins.filter((adminUid) => adminUid !== targetUid) });
      return;
    }

    if (admins.includes(targetUid) && !isCreator) {
      throw new HttpsError("permission-denied", "Somente o criador pode remover outro admin.");
    }
    transaction.update(chatRef, {
      participantUids: participants.filter((memberUid) => memberUid !== targetUid),
      adminUids: admins.filter((adminUid) => adminUid !== targetUid),
    });
  });
  return { ok: true };
});

exports.dissolveChatGroup = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const chatId = request.data?.chatId;
  if (typeof chatId !== "string" || !/^[a-f0-9-]{36}$/i.test(chatId)) {
    throw new HttpsError("invalid-argument", "Grupo inválido.");
  }

  const chatRef = database.collection("chats").doc(chatId);
  const chatSnapshot = await chatRef.get();
  if (!chatSnapshot.exists || chatSnapshot.get("type") !== "group") {
    throw new HttpsError("not-found", "Grupo não encontrado.");
  }
  if (chatSnapshot.get("createdBy") !== uid) {
    throw new HttpsError("permission-denied", "Somente o criador pode dissolver o grupo.");
  }

  await database.recursiveDelete(chatRef);
  return { ok: true };
});

exports.updateChatGroupPhoto = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const chatId = request.data?.chatId;
  const photoUrl = request.data?.photoUrl;
  const cloudinaryPrefix = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/`;
  if (typeof chatId !== "string" || !/^[a-f0-9-]{36}$/i.test(chatId)
      || typeof photoUrl !== "string" || photoUrl.length > 2048
      || !photoUrl.startsWith(cloudinaryPrefix)
      || !photoUrl.includes(`/zeca/groups/${chatId}/`)) {
    throw new HttpsError("invalid-argument", "Foto de grupo inválida.");
  }

  const chatRef = database.collection("chats").doc(chatId);
  await database.runTransaction(async (transaction) => {
    const chatSnapshot = await transaction.get(chatRef);
    if (!chatSnapshot.exists || chatSnapshot.get("type") !== "group") {
      throw new HttpsError("not-found", "Grupo não encontrado.");
    }
    const group = chatSnapshot.data();
    const admins = Array.isArray(group.adminUids) ? group.adminUids : [group.createdBy];
    if (!admins.includes(uid)) {
      throw new HttpsError("permission-denied", "Somente admins podem alterar a foto do grupo.");
    }
    transaction.update(chatRef, { photoUrl });
  });
  return { ok: true };
});

exports.renameChatFlame = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const chatId = request.data?.chatId;
  const name = typeof request.data?.name === "string" ? request.data.name.trim().replace(/\s+/g, " ") : "";
  if (typeof chatId !== "string" || !/^[a-z0-9_-]{3,160}$/i.test(chatId)
      || name.length < 1 || name.length > 24) {
    throw new HttpsError("invalid-argument", "Nome do foguinho inválido.");
  }
  const chatRef = database.collection("chats").doc(chatId);
  await database.runTransaction(async (transaction) => {
    const chatSnapshot = await transaction.get(chatRef);
    if (!chatSnapshot.exists || !chatSnapshot.data().participantUids?.includes(uid)) {
      throw new HttpsError("permission-denied", "Você não participa desta conversa.");
    }
    transaction.update(chatRef, { streakName: name });
  });
  return { ok: true, name };
});

exports.editChatMessage = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const chatId = request.data?.chatId;
  const messageId = request.data?.messageId;
  const text = typeof request.data?.text === "string" ? request.data.text.trim() : "";
  if (typeof chatId !== "string" || !/^[a-z0-9_-]{3,160}$/i.test(chatId)
      || typeof messageId !== "string" || !/^[a-f0-9-]{36}$/i.test(messageId)
      || text.length < 1 || text.length > 500) {
    throw new HttpsError("invalid-argument", "Mensagem ou identificador inválido.");
  }

  const chatRef = database.collection("chats").doc(chatId);
  const messageRef = chatRef.collection("messages").doc(messageId);
  await database.runTransaction(async (transaction) => {
    const [chatSnapshot, messageSnapshot] = await Promise.all([
      transaction.get(chatRef),
      transaction.get(messageRef),
    ]);
    if (!chatSnapshot.exists || !chatSnapshot.get("participantUids")?.includes(uid)
        || !messageSnapshot.exists || messageSnapshot.get("senderUid") !== uid) {
      throw new HttpsError("permission-denied", "Só é possível editar uma mensagem sua nesta conversa.");
    }
    if (messageSnapshot.get("deletedForAll") === true) {
      throw new HttpsError("failed-precondition", "Uma mensagem apagada não pode ser editada.");
    }

    const editedAt = FieldValue.serverTimestamp();
    transaction.update(messageRef, { text, editedAt });
    if (chatSnapshot.get("lastMessageId") === messageId) {
      transaction.update(chatRef, { lastMessage: text, lastMessageAt: editedAt });
    }
  });
  return { ok: true };
});

exports.signChatAudioUpload = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const chatId = request.data?.chatId;
  const recipientUid = request.data?.recipientUid || null;
  const requestId = request.data?.requestId;
  if (typeof chatId !== "string" || !/^[a-z0-9_-]{3,160}$/i.test(chatId)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Conversa ou identificador de áudio inválido.");
  }

  if (chatId !== "global") {
    const chatSnapshot = await database.collection("chats").doc(chatId).get();
    if (chatSnapshot.exists) {
      const chat = chatSnapshot.data();
      if (!Array.isArray(chat.participantUids) || !chat.participantUids.includes(uid)) {
        throw new HttpsError("permission-denied", "Você não participa desta conversa.");
      }
      if (chat.type === "group") {
        const admins = Array.isArray(chat.adminUids) ? chat.adminUids : [chat.createdBy];
        if (chat.sendPolicy === "creator" && chat.createdBy !== uid
            || chat.sendPolicy === "admins" && !admins.includes(uid)) {
          throw new HttpsError("permission-denied", "Você não pode enviar áudio neste grupo.");
        }
      }
    } else {
      if (typeof recipientUid !== "string" || recipientUid === uid
          || [uid, recipientUid].sort().join("_") !== chatId) {
        throw new HttpsError("permission-denied", "Conversa privada inválida.");
      }
    }
  }

  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new HttpsError("failed-precondition", "O envio de áudio ainda não está configurado no servidor.");
  }
  cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: apiKey, api_secret: apiSecret, secure: true });
  const folder = `zeca/chat-audio/${chatId}/${uid}`;
  const publicId = requestId;
  const timestamp = Math.floor(Date.now() / 1_000);
  const signature = cloudinary.utils.api_sign_request({ folder, public_id: publicId, timestamp }, apiSecret);
  return {
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey,
    folder,
    publicId,
    timestamp,
    signature,
    resourceType: "video",
  };
});

exports.sendChatMessage = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const text = typeof request.data?.text === "string" ? request.data.text.trim() : "";
  const audioUrl = typeof request.data?.audioUrl === "string" ? request.data.audioUrl.trim() : "";
  const audioPublicId = typeof request.data?.audioPublicId === "string" ? request.data.audioPublicId : "";
  const audioDurationMs = request.data?.audioDurationMs;
  const hasAudio = audioUrl.length > 0;
  const recipientUid = request.data?.recipientUid || null;
  const requestedChatId = request.data?.chatId || null;
  const requestId = request.data?.requestId;
  if (text.length > 500 || (text.length < 1 && !hasAudio)) {
    throw new HttpsError("invalid-argument", "A mensagem deve ter entre 1 e 500 caracteres.");
  }
  if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Identificador da mensagem inválido.");
  }
  if (hasAudio) {
    if (audioPublicId !== requestId) {
      throw new HttpsError("invalid-argument", "O identificador do arquivo de áudio não corresponde à mensagem.");
    }
    if (!Number.isSafeInteger(audioDurationMs) || audioDurationMs < 500 || audioDurationMs > 60_000) {
      throw new HttpsError("invalid-argument", "A gravação precisa ter entre 0,5 e 60 segundos. Tente gravar por mais tempo.");
    }
    if (!audioUrl.startsWith(`https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/`)) {
      throw new HttpsError("invalid-argument", "A URL do upload não corresponde ao formato de áudio esperado.");
    }
  } else if (audioPublicId || audioDurationMs != null) {
    throw new HttpsError("invalid-argument", "Dados de áudio foram enviados sem um arquivo.");
  }
  if (recipientUid !== null && (typeof recipientUid !== "string" || recipientUid === uid)) {
    throw new HttpsError("invalid-argument", "Destinatário inválido.");
  }
  if (recipientUid && requestedChatId) {
    throw new HttpsError("invalid-argument", "Escolha uma conversa privada ou um grupo.");
  }
  if (requestedChatId !== null && (typeof requestedChatId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestedChatId))) {
    throw new HttpsError("invalid-argument", "Grupo inválido.");
  }

  const senderRef = database.collection("users").doc(uid);
  const recipientRef = recipientUid ? database.collection("users").doc(recipientUid) : null;
  const participants = recipientUid ? [uid, recipientUid].sort() : [];
  const chatId = requestedChatId || (recipientUid ? participants.join("_") : "global");
  const hasConversation = Boolean(recipientRef || requestedChatId);
  const chatRef = database.collection("chats").doc(chatId);
  const messageRef = chatRef.collection("messages").doc(requestId);
  const sentAtMs = Date.now();
  let verifiedAudioDurationMs = audioDurationMs;
  if (hasAudio) {
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!apiKey || !apiSecret) {
      throw new HttpsError("failed-precondition", "O envio de áudio ainda não está configurado no servidor.");
    }
    cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: apiKey, api_secret: apiSecret, secure: true });
    try {
      const asset = await cloudinary.api.resource(audioPublicId, { resource_type: "video", type: "upload" });
      const expectedFolder = `zeca/chat-audio/${chatId}/${uid}`;
      const expectedFixedFolderPublicId = `${expectedFolder}/${audioPublicId}`;
      const storedInExpectedFolder = asset.asset_folder === expectedFolder
        || asset.folder === expectedFolder
        || asset.public_id === expectedFixedFolderPublicId;
      const actualDurationMs = Math.round((asset.duration || 0) * 1_000);
      if (asset.secure_url !== audioUrl || !storedInExpectedFolder
          || asset.format !== "m4a" || actualDurationMs < 500 || actualDurationMs > 60_000) {
        throw new HttpsError("invalid-argument", "O áudio não corresponde ao upload assinado para esta conversa.");
      }
      verifiedAudioDurationMs = actualDurationMs;
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("invalid-argument", "Não foi possível validar o áudio enviado.");
    }
  }
  let response;

  await database.runTransaction(async (transaction) => {
    const reads = [transaction.get(messageRef), transaction.get(senderRef)];
    if (recipientRef) reads.push(transaction.get(recipientRef), transaction.get(chatRef));
    else if (requestedChatId) reads.push(transaction.get(chatRef));
    const snapshots = await Promise.all(reads);
    const [existingMessage, senderSnapshot] = snapshots;
    if (existingMessage.exists) {
      const previous = existingMessage.data();
      if (previous.senderUid !== uid || previous.text !== text || (previous.audioPublicId || "") !== audioPublicId) {
        throw new HttpsError("already-exists", "Identificador da mensagem já utilizado.");
      }
      response = { chatId, messageId: requestId };
      return;
    }
    if (!senderSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Perfil do remetente não encontrado.");
    }
    const sender = senderSnapshot.data();
    if (Number.isSafeInteger(sender.lastChatAtMs)
        && sentAtMs - sender.lastChatAtMs < CHAT_COOLDOWN_MS) {
      throw new HttpsError("resource-exhausted", "Aguarde um instante antes de enviar outra mensagem.");
    }
    const senderName = safeName(sender.displayName, "Jogador");
    let chatSnapshot = null;
    if (recipientRef) {
      const recipientSnapshot = snapshots[2];
      chatSnapshot = snapshots[3];
      if (!recipientSnapshot.exists) {
        throw new HttpsError("not-found", "Destinatário não encontrado.");
      }
      if (chatSnapshot.exists) {
        const savedParticipants = chatSnapshot.data().participantUids;
        if (!Array.isArray(savedParticipants)
            || savedParticipants.length !== 2
            || savedParticipants[0] !== participants[0]
            || savedParticipants[1] !== participants[1]) {
          throw new HttpsError("permission-denied", "Conversa inválida.");
        }
      }
    } else if (requestedChatId) {
      chatSnapshot = snapshots[2];
      if (!chatSnapshot.exists || chatSnapshot.get("type") !== "group"
          || !chatSnapshot.get("participantUids")?.includes(uid)) {
        throw new HttpsError("permission-denied", "Você não participa deste grupo.");
      }
      const group = chatSnapshot.data();
      const groupAdmins = Array.isArray(group.adminUids) ? group.adminUids : [group.createdBy];
      if (group.sendPolicy === "creator" && group.createdBy !== uid) {
        throw new HttpsError("permission-denied", "Somente o criador pode enviar mensagens neste grupo.");
      }
      if (group.sendPolicy === "admins" && !groupAdmins.includes(uid)) {
        throw new HttpsError("permission-denied", "Somente admins podem enviar mensagens neste grupo.");
      }
    }

    const now = FieldValue.serverTimestamp();
    let progression = null;
    if (hasConversation) {
      const currentChat = chatSnapshot?.data() || {
        participantUids: participants,
        streakDays: 0,
        streakLastQualifiedDate: "",
        streakActivityDate: "",
        streakParticipantsToday: [],
      };
      progression = applyStreakMessage(currentChat, uid, dateUtc(sentAtMs));
      const chatData = {
        lastMessage: text || "Áudio",
        lastMessageAt: now,
        lastMessageId: requestId,
        lastMessageSenderUid: uid,
        ...progression,
      };
      if (!requestedChatId) Object.assign(chatData, { participantUids: participants, type: "direct" });
      if (chatSnapshot?.exists) transaction.update(chatRef, chatData);
      else transaction.create(chatRef, {
        ...chatData,
        streakName: "Nosso foguinho",
        createdAt: now,
      });
    }
    transaction.update(senderRef, { lastChatAtMs: sentAtMs });
    const messageData = {
      senderUid: uid,
      senderName,
      senderUsername: sender.username || "",
      senderAvatarUrl: sender.avatarUrl || "",
      senderAvatarItems: Array.isArray(sender.equippedAvatarItems) ? sender.equippedAvatarItems : [],
      senderAvatarAsProfilePhoto: sender.avatarAsProfilePhoto === true,
      senderEquippedFrame: typeof sender.equippedFrame === "string" ? sender.equippedFrame : "",
      text,
      createdAt: now,
    };
    if (hasAudio) {
      messageData.type = "audio";
      messageData.audioUrl = audioUrl;
      messageData.audioPublicId = audioPublicId;
      messageData.audioDurationMs = verifiedAudioDurationMs;
    }
    const reply = request.data?.reply;
    if (reply && typeof reply.id === "string" && typeof reply.name === "string" && typeof reply.text === "string") {
      messageData.replyToId = reply.id.slice(0, 128);
      messageData.replyToName = reply.name.slice(0, 40);
      messageData.replyToText = reply.text.slice(0, 200);
    }
    if (request.data?.forwarded === true) messageData.forwarded = true;
    transaction.create(messageRef, messageData);
    response = {
      chatId,
      messageId: requestId,
      streakDays: progression?.streakDays ?? null,
      streakLevel: progression?.streakLevel ?? null,
    };
  });

  return response;
});

exports.getSocialDashboard = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const userRef = database.collection("users").doc(uid);
  const userSnapshot = await userRef.get();
  if (!userSnapshot.exists) throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
  const profile = userSnapshot.data();
  const [historySnapshot, statsSnapshot, clansSnapshot, invitationsSnapshot, ownReportsSnapshot] = await Promise.all([
    userRef.collection("gameHistory").orderBy("atMs", "desc").limit(50).get(),
    userRef.collection("minigameStats").get(),
    database.collection("clans").limit(100).get(),
    userRef.collection("clanInvitations").get(),
    database.collection("playerReports").where("reporterUid", "==", uid).limit(50).get(),
  ]);
  const currentWeek = isoWeekKey(new Date());
  const eventIdentity = weeklyEventForDate(new Date());
  const eventSnapshot = eventIdentity
    ? await userRef.collection("weeklyEvents").doc(eventIdentity.id).get()
    : null;
  const stats = statsSnapshot.docs
    .filter((document) => document.id !== "all")
    .map((document) => ({ gameId: document.id, ...document.data() }));
  const allStats = statsSnapshot.docs.find((document) => document.id === "all")?.data() || {};
  const totalMetrics = {
    played: allStats.played || 0,
    won: allStats.wins || 0,
    lost: allStats.losses || 0,
    tied: allStats.ties || 0,
    netCents: allStats.netCents || 0,
  };
  const achievements = ACHIEVEMENT_DEFINITIONS.map(({ id, metric, target }) => ({
    id,
    progress: Math.min(target, totalMetrics[metric] || 0),
    target,
    unlocked: (totalMetrics[metric] || 0) >= target,
  }));
  const currentClanId = typeof profile.clanId === "string" ? profile.clanId : "";
  const currentClanSnapshot = currentClanId && !clansSnapshot.docs.some((document) => document.id === currentClanId)
    ? await database.collection("clans").doc(currentClanId).get()
    : null;
  const clanDocuments = currentClanSnapshot?.exists
    ? [...clansSnapshot.docs, currentClanSnapshot]
    : clansSnapshot.docs;
  const visibleClans = clanDocuments
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((clan) => clan.policy !== "private" || clan.id === currentClanId)
    .map((clan) => {
      const members = Array.isArray(clan.members) ? clan.members : [];
      const pending = Array.isArray(clan.pendingRequests) ? clan.pendingRequests : [];
      return {
        id: clan.id,
        name: clan.name || "",
        description: clan.description || "",
        policy: clan.policy,
        members: members.map((member) => ({
          userId: member.uid,
          name: member.displayName || "Jogador",
          isLeader: member.role === "owner",
          weeklyScore: member.weeklyScore || 0,
        })),
        leaderId: clan.ownerUid || "",
        inviteCode: clan.ownerUid === uid && clan.policy === "private" ? clan.inviteCode || "" : "",
        pendingRequests: clan.ownerUid === uid
          ? pending.map((pendingUid) => ({ userId: pendingUid, name: pendingUid }))
          : [],
        weeklyScore: currentWeek ? clan.weeklyScores?.[currentWeek] || 0 : 0,
      };
    });
  const rankedClans = visibleClans
    .map((clan) => ({ clanId: clan.id, name: clan.name, score: clan.weeklyScore }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 20)
    .map((clan, index) => ({ position: index + 1, clanId: clan.clanId, name: clan.name, score: clan.score }));
  const eventData = eventSnapshot?.exists ? eventSnapshot.data() : null;
  return {
    clans: visibleClans,
    currentClanId,
    clanInvitations: invitationsSnapshot.docs.map((document) => ({
      clanId: document.get("clanId"),
      clanName: document.get("clanName") || "Clã",
      invitedBy: document.get("invitedBy") || "",
    })),
    clanRanking: rankedClans,
    reportUpdates: ownReportsSnapshot.docs
      .map((document) => ({
        id: document.id,
        category: document.get("category"),
        status: document.get("status"),
        reviewReason: document.get("reviewReason") || "",
        createdAtMs: document.get("createdAtMs") || 0,
      }))
      .sort((left, right) => right.createdAtMs - left.createdAtMs)
      .slice(0, 20),
    event: eventIdentity ? {
      id: eventIdentity.id,
      title: eventData?.title || eventIdentity.title,
      description: eventData?.description || eventIdentity.description,
      progress: Math.min(eventIdentity.target, eventData?.progress || 0),
      target: eventIdentity.target,
      rewardCents: eventIdentity.rewardCents,
      claimed: Array.isArray(profile.claimedWeeklyEventIds)
        && profile.claimedWeeklyEventIds.includes(eventIdentity.id),
    } : null,
    achievements,
    history: historySnapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
    stats,
  };
});

const ACCOUNT_SETTING_DEFAULTS = Object.freeze({
  profileVisibility: "public",
  customStatus: "",
  theme: "dark",
  locale: "pt-BR",
  accessibilityFontScale: 1,
  highContrast: false,
  reduceMotion: false,
  confirmImportant: true,
  personalizedRecommendations: true,
  syncSettings: true,
});

exports.getAccountSettings = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const userRef = database.collection("users").doc(uid);
  const [settingsSnapshot, activitySnapshot, friendSnapshot, announcementSnapshot, statsSnapshot, userSnapshot] = await Promise.all([
    userRef.collection("preferences").doc("appSettings").get(),
    userRef.collection("accountActivity").orderBy("createdAtMs", "desc").limit(30).get(),
    userRef.collection("friends").get(),
    database.collection("systemSettings").doc("announcements").get(),
    userRef.collection("minigameStats").get(),
    userRef.get(),
  ]);
  const settings = { ...ACCOUNT_SETTING_DEFAULTS, ...(settingsSnapshot.data() || {}) };
  const acceptedFriends = friendSnapshot.docs.filter((document) => document.get("status") === "accepted");
  const friendDetails = await Promise.all(acceptedFriends.map(async (document) => {
    const [friendSettings, presence] = await Promise.all([
      database.collection("users").doc(document.id).collection("preferences").doc("appSettings").get(),
      database.collection("userPresence").doc(document.id).get(),
    ]);
    const lastSeen = presence.get("lastSeenAt");
    const lastSeenMs = typeof lastSeen?.toMillis === "function" ? lastSeen.toMillis() : 0;
    return {
      uid: document.id,
      displayName: document.get("displayName") || "Jogador",
      username: document.get("username") || "",
      status: friendSettings.get("customStatus") || "",
      online: presence.get("online") === true && Date.now() - lastSeenMs < 120_000,
    };
  }));
  const friends = friendDetails;
  const requests = friendSnapshot.docs.filter((document) => document.get("status") === "incoming")
    .map((document) => ({
      uid: document.id,
      displayName: document.get("displayName") || "Jogador",
      username: document.get("username") || "",
    }));
  const announcementsData = announcementSnapshot.data() || {};
  const nowMs = Date.now();
  const announcements = (Array.isArray(announcementsData.items) ? announcementsData.items : [])
    .filter((item) => item?.active === true && (!Number.isFinite(item.expiresAtMs) || item.expiresAtMs > nowMs))
    .slice(0, 10);
  const recommendations = statsSnapshot.docs
    .filter((document) => document.id !== "all" && Number(document.get("played") || 0) > 0)
    .map((document) => ({
      gameId: document.id,
      played: Number(document.get("played") || 0),
      wins: Number(document.get("wins") || 0),
    }))
    .sort((left, right) => (right.wins / right.played) - (left.wins / left.played)
      || left.played - right.played)
    .slice(0, 3);
  return {
    settings,
    whatsappLink: {
      linked: Boolean(userSnapshot.get("whatsappLink.jid")),
      linkedAtMs: userSnapshot.get("whatsappLink.linkedAtMs") || 0,
    },
    friends,
    friendRequests: requests,
    activity: activitySnapshot.docs.map((document) => ({
      id: document.id,
      fields: document.get("fields") || [],
      createdAtMs: document.get("createdAtMs") || 0,
    })),
    announcements,
    recommendations,
  };
});

exports.createWhatsAppLinkCode = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const userRef = database.collection("users").doc(uid);
  const codeRef = database.collection("whatsappLinkCodes").doc(uid);
  const code = randomBytes(6).toString("hex").toUpperCase();
  const codeHash = createHash("sha256").update(code).digest("hex");
  const nowMs = Date.now();
  const expiresAtMs = nowMs + 10 * 60_000;

  await database.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) throw new HttpsError("failed-precondition", "Configure sua conta antes de vincular o WhatsApp.");
    if (userSnapshot.get("whatsappLink.jid")) {
      throw new HttpsError("failed-precondition", "Já existe uma conta do WhatsApp vinculada.");
    }
    transaction.set(codeRef, { codeHash, expiresAtMs, createdAtMs: nowMs });
  });

  return { code, expiresAtMs };
});

exports.unlinkWhatsAppAccount = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const userRef = database.collection("users").doc(uid);

  await database.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const jid = userSnapshot.get("whatsappLink.jid");
    if (!jid) return;

    const linkRef = database.collection("whatsappAccountLinks")
      .doc(createHash("sha256").update(jid).digest("hex"));
    const linkSnapshot = await transaction.get(linkRef);
    if (linkSnapshot.exists && linkSnapshot.get("uid") === uid) transaction.delete(linkRef);
    transaction.update(userRef, { whatsappLink: FieldValue.delete() });
  });

  return { unlinked: true };
});

exports.getLinkedWhatsAppEconomy = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const profile = await database.collection("users").doc(uid).get();
  const jid = profile.get("whatsappLink.jid");
  if (typeof jid !== "string" || !/^\d+@s\.whatsapp\.net$/.test(jid)) {
    throw new HttpsError("failed-precondition", "Vincule sua conta do WhatsApp antes de consultar a economia.");
  }

  const secret = process.env.WHATSAPP_LINK_SECRET;
  const baseUrl = process.env.PIROQUINHAS_API_URL;
  if (!secret || secret.length < 32 || !baseUrl) {
    throw new HttpsError("failed-precondition", "A integração com o servidor do bot ainda não está configurada.");
  }
  let apiUrl;
  try {
    apiUrl = new URL(baseUrl);
  } catch {
    throw new HttpsError("failed-precondition", "O endereço do servidor do bot está inválido.");
  }
  if (apiUrl.protocol !== "https:" || apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash) {
    throw new HttpsError("failed-precondition", "O servidor do bot deve usar um endereço HTTPS válido.");
  }

  const timestamp = String(Date.now());
  const path = "/api/integration/economy";
  const payload = `${timestamp}\nGET\n${path}\n${jid}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  let response;
  try {
    response = await fetch(`${apiUrl.origin}${path}`, {
      method: "GET",
      headers: {
        "x-zeca-jid": jid,
        "x-zeca-timestamp": timestamp,
        "x-zeca-signature": signature,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("Falha ao consultar economia no servidor do WhatsApp:", error);
    throw new HttpsError("failed-precondition", "O servidor do WhatsApp está indisponível. Tente novamente mais tarde.");
  }
  if (!response.ok) {
    console.error(`Consulta da economia no bot retornou HTTP ${response.status}.`);
    throw new HttpsError("failed-precondition", "Não foi possível consultar a economia do WhatsApp agora.");
  }
  let economy;
  try {
    economy = await response.json();
  } catch (error) {
    console.error("Resposta inválida do endpoint de economia do bot:", error);
    throw new HttpsError("internal", "O servidor do WhatsApp retornou uma resposta inválida.");
  }
  if (!Number.isSafeInteger(economy.totalGold) || economy.totalGold < 0
      || !Number.isSafeInteger(economy.totalBankGold) || economy.totalBankGold < 0
      || !Array.isArray(economy.groups) || !Array.isArray(economy.history)) {
    throw new HttpsError("internal", "O servidor do WhatsApp retornou dados de economia inválidos.");
  }
  return economy;
});

exports._completeWhatsAppLink = async (request) => {
  const rawCode = request.data?.code;
  const rawJid = request.data?.jid;
  if (typeof rawCode !== "string" || !/^[a-f\d]{12}$/i.test(rawCode)) {
    throw new HttpsError("invalid-argument", "Código de vínculo inválido.");
  }
  if (typeof rawJid !== "string") throw new HttpsError("invalid-argument", "Conta do WhatsApp inválida.");

  const jid = rawJid.trim().toLowerCase().split(":")[0];
  if (!/^\d+@(s\.whatsapp\.net|lid)$/.test(jid)) {
    throw new HttpsError("invalid-argument", "Use o comando em uma conversa privada com o bot.");
  }
  const code = rawCode.toUpperCase();
  const codeHash = createHash("sha256").update(code).digest("hex");
  const matchingCodes = await database.collection("whatsappLinkCodes")
    .where("codeHash", "==", codeHash)
    .limit(1)
    .get();
  if (matchingCodes.empty) throw new HttpsError("not-found", "Código inválido ou expirado. Gere outro código no app.");

  const codeRef = matchingCodes.docs[0].ref;
  const uid = codeRef.id;
  const userRef = database.collection("users").doc(uid);
  const linkRef = database.collection("whatsappAccountLinks")
    .doc(createHash("sha256").update(jid).digest("hex"));
  const nowMs = Date.now();

  await database.runTransaction(async (transaction) => {
    const [codeSnapshot, userSnapshot, linkSnapshot] = await Promise.all([
      transaction.get(codeRef),
      transaction.get(userRef),
      transaction.get(linkRef),
    ]);
    if (!codeSnapshot.exists || codeSnapshot.get("codeHash") !== codeHash
        || codeSnapshot.get("expiresAtMs") <= nowMs) {
      throw new HttpsError("not-found", "Código inválido ou expirado. Gere outro código no app.");
    }
    if (!userSnapshot.exists) throw new HttpsError("not-found", "Conta do app não encontrada.");
    if (userSnapshot.get("isBlocked") === true) {
      throw new HttpsError("permission-denied", "Esta conta do app está desativada.");
    }
    if (userSnapshot.get("whatsappLink.jid")) {
      throw new HttpsError("failed-precondition", "Esta conta do app já tem um WhatsApp vinculado.");
    }
    if (linkSnapshot.exists && linkSnapshot.get("uid") !== uid) {
      throw new HttpsError("already-exists", "Esta conta do WhatsApp já está vinculada a outro perfil.");
    }

    transaction.set(linkRef, { uid, linkedAtMs: nowMs });
    transaction.update(userRef, { whatsappLink: { jid, linkedAtMs: nowMs } });
    transaction.delete(codeRef);
  });

  return { linked: true };
};

exports.saveAccountSettings = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const input = request.data?.settings;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpsError("invalid-argument", "Configurações inválidas.");
  }
  const allowed = Object.keys(ACCOUNT_SETTING_DEFAULTS);
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new HttpsError("invalid-argument", "Configuração desconhecida.");
  }
  const normalized = {};
  if (input.profileVisibility != null) {
    if (!["public", "private"].includes(input.profileVisibility)) throw new HttpsError("invalid-argument", "Privacidade inválida.");
    normalized.profileVisibility = input.profileVisibility;
  }
  if (input.customStatus != null) {
    if (typeof input.customStatus !== "string" || [...input.customStatus.trim()].length > 40) throw new HttpsError("invalid-argument", "Status deve ter até 40 caracteres.");
    normalized.customStatus = input.customStatus.trim();
  }
  if (input.theme != null) {
    if (!["dark", "amoled", "blue"].includes(input.theme)) throw new HttpsError("invalid-argument", "Tema inválido.");
    normalized.theme = input.theme;
  }
  if (input.locale != null) {
    if (!["pt-BR", "en-US", "es"].includes(input.locale)) throw new HttpsError("invalid-argument", "Idioma inválido.");
    normalized.locale = input.locale;
  }
  if (input.accessibilityFontScale != null) {
    if (typeof input.accessibilityFontScale !== "number" || input.accessibilityFontScale < 1 || input.accessibilityFontScale > 1.5) {
      throw new HttpsError("invalid-argument", "Escala de texto fora do intervalo.");
    }
    normalized.accessibilityFontScale = input.accessibilityFontScale;
  }
  for (const key of ["highContrast", "reduceMotion", "confirmImportant", "personalizedRecommendations", "syncSettings"]) {
    if (input[key] != null) {
      if (typeof input[key] !== "boolean") throw new HttpsError("invalid-argument", "Preferência inválida.");
      normalized[key] = input[key];
    }
  }
  const ref = database.collection("users").doc(uid).collection("preferences").doc("appSettings");
  let savedSettings = ACCOUNT_SETTING_DEFAULTS;
  await database.runTransaction(async (transaction) => {
    const oldSnapshot = await transaction.get(ref);
    const oldSettings = oldSnapshot.data() || {};
    const localOnlyKeys = [
      "theme",
      "locale",
      "accessibilityFontScale",
      "highContrast",
      "reduceMotion",
      "confirmImportant",
      "personalizedRecommendations",
    ];
    if (oldSettings.syncSettings === false && normalized.syncSettings === false) {
      for (const key of localOnlyKeys) delete normalized[key];
    }
    const changedFields = Object.keys(normalized).filter((key) => oldSettings[key] !== normalized[key]);
    savedSettings = { ...ACCOUNT_SETTING_DEFAULTS, ...oldSettings, ...normalized };
    transaction.set(ref, { ...savedSettings, updatedAt: FieldValue.serverTimestamp() });
    if (changedFields.length) {
      transaction.create(database.collection("users").doc(uid).collection("accountActivity").doc(randomUUID()), {
        fields: changedFields,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: Date.now(),
      });
    }
  });
  return { ok: true, settings: savedSettings };
});

exports.manageFriend = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const action = request.data?.action;
  if (!["request", "accept", "remove", "reject"].includes(action)) {
    throw new HttpsError("invalid-argument", "Ação de amizade inválida.");
  }
  const myUserRef = database.collection("users").doc(uid);
  let targetUid = request.data?.targetUid;
  if (action === "request") {
    const username = normalizeUsername(request.data?.username);
    if (!username) throw new HttpsError("invalid-argument", "Informe um nome de usuário válido.");
    const usernameSnapshot = await database.collection("usernames").doc(username).get();
    if (!usernameSnapshot.exists) throw new HttpsError("not-found", "Não encontramos esse nome de usuário.");
    targetUid = usernameSnapshot.get("uid");
  }
  if (typeof targetUid !== "string" || targetUid.length < 1 || targetUid.length > 128 || targetUid === uid) {
    throw new HttpsError("invalid-argument", "Jogador inválido.");
  }
  const targetUserRef = database.collection("users").doc(targetUid);
  const myFriendRef = myUserRef.collection("friends").doc(targetUid);
  const targetFriendRef = targetUserRef.collection("friends").doc(uid);
  await database.runTransaction(async (transaction) => {
    const [myUser, targetUser, myFriend, targetFriend] = await Promise.all([
      transaction.get(myUserRef), transaction.get(targetUserRef),
      transaction.get(myFriendRef), transaction.get(targetFriendRef),
    ]);
    if (!myUser.exists || !targetUser.exists) throw new HttpsError("not-found", "Perfil não encontrado.");
    const now = FieldValue.serverTimestamp();
    if (action === "request") {
      if (myFriend.get("status") === "accepted") throw new HttpsError("already-exists", "Este jogador já está na sua lista.");
      if (myFriend.get("status") === "outgoing") throw new HttpsError("already-exists", "O convite já foi enviado.");
      const senderData = {
        displayName: safeName(myUser.get("displayName"), "Jogador"),
        username: myUser.get("username") || "",
      };
      const targetData = {
        displayName: safeName(targetUser.get("displayName"), "Jogador"),
        username: targetUser.get("username") || "",
      };
      transaction.set(myFriendRef, { status: "outgoing", ...targetData, updatedAt: now });
      transaction.set(targetFriendRef, { status: "incoming", ...senderData, updatedAt: now });
    } else if (action === "accept") {
      if (myFriend.get("status") !== "incoming" || targetFriend.get("status") !== "outgoing") {
        throw new HttpsError("failed-precondition", "Não há convite pendente deste jogador.");
      }
      transaction.set(myFriendRef, {
        status: "accepted",
        displayName: safeName(targetUser.get("displayName"), "Jogador"),
        username: targetUser.get("username") || "",
        updatedAt: now,
      });
      transaction.set(targetFriendRef, {
        status: "accepted",
        displayName: safeName(myUser.get("displayName"), "Jogador"),
        username: myUser.get("username") || "",
        updatedAt: now,
      });
    } else {
      transaction.delete(myFriendRef);
      transaction.delete(targetFriendRef);
    }
  });
  return { ok: true };
});

exports.publishAppAnnouncement = onCall(async (request) => {
  requireAdmin(request);
  const title = typeof request.data?.title === "string" ? request.data.title.trim() : "";
  const details = typeof request.data?.details === "string" ? request.data.details.trim() : "";
  const type = request.data?.type;
  const expiresAtMs = request.data?.expiresAtMs;
  if (title.length < 3 || title.length > 80 || details.length < 3 || details.length > 500
      || !["maintenance", "news"].includes(type)
      || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new HttpsError("invalid-argument", "Aviso, categoria ou prazo inválido.");
  }
  const ref = database.collection("systemSettings").doc("announcements");
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const items = Array.isArray(snapshot.get("items")) ? snapshot.get("items") : [];
    transaction.set(ref, {
      items: [{ id: randomUUID(), title, details, type, active: true, createdAtMs: Date.now(), expiresAtMs }, ...items]
        .slice(0, 20),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

exports.createSupportTicket = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const title = typeof request.data?.title === "string" ? request.data.title.trim() : "";
  const details = typeof request.data?.details === "string" ? request.data.details.trim() : "";
  const category = request.data?.category;
  if (title.length < 3 || title.length > 80 || details.length < 10 || details.length > 2_000
      || !["help", "accessibility"].includes(category)) {
    throw new HttpsError("invalid-argument", "Informe um assunto e detalhes válidos.");
  }
  const uidRef = database.collection("users").doc(uid);
  const snapshot = await uidRef.get();
  if (!snapshot.exists) throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
  const ticketRef = database.collection("supportTickets").doc(randomUUID());
  await ticketRef.create({
    userUid: uid,
    username: snapshot.get("username") || "",
    category,
    title,
    details,
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: Date.now(),
  });
  return { ok: true, ticketId: ticketRef.id };
});

exports.adminListSupportTickets = onCall(async (request) => {
  requireAdmin(request);
  const snapshot = await database.collection("supportTickets").orderBy("createdAtMs", "desc").limit(50).get();
  return {
    tickets: snapshot.docs.map((document) => ({
      id: document.id,
      userUid: document.get("userUid") || "",
      username: document.get("username") || "",
      category: document.get("category") || "help",
      title: document.get("title") || "",
      details: document.get("details") || "",
      status: document.get("status") || "open",
      createdAtMs: document.get("createdAtMs") || 0,
    })),
  };
});

exports.createSocialClan = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const userRef = database.collection("users").doc(uid);
  const requestId = request.data?.requestId;
  if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Identificador de criação inválido.");
  }
  const validation = validateClan({
    name: request.data?.name,
    description: request.data?.description,
    policy: request.data?.policy,
  });
  if (!validation.valid) throw new HttpsError("invalid-argument", "Nome, descrição ou política do clã inválidos.");
  const clanId = requestId;
  const inviteCode = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const clanRef = database.collection("clans").doc(clanId);
  const inviteRef = database.collection("clanInviteCodes").doc(inviteCode);
  const actionRef = userRef.collection("socialRequests").doc(requestId);
  let response = { ok: true, clanId, inviteCode };
  await database.runTransaction(async (transaction) => {
    const [userSnapshot, inviteSnapshot, actionSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(inviteRef),
      transaction.get(actionRef),
    ]);
    if (actionSnapshot.exists) {
      if (actionSnapshot.get("name") !== validation.value.name
          || actionSnapshot.get("description") !== validation.value.description
          || actionSnapshot.get("policy") !== validation.value.policy) {
        throw new HttpsError("already-exists", "Identificador de criação já utilizado.");
      }
      response = actionSnapshot.get("response");
      return;
    }
    if (!userSnapshot.exists) throw new HttpsError("failed-precondition", "Perfil ainda não foi criado.");
    if (userSnapshot.get("clanId")) throw new HttpsError("failed-precondition", "Saia do clã atual antes de criar outro.");
    if (inviteSnapshot.exists) throw new HttpsError("already-exists", "Não foi possível gerar o convite. Tente novamente.");
    const user = userSnapshot.data();
    transaction.create(clanRef, {
      name: validation.value.name,
      description: validation.value.description,
      description: validation.value.description,
      policy: validation.value.policy,
      creatorUid: uid,
      ownerUid: uid,
      inviteCode,
      members: [{ uid, displayName: user.displayName || "Jogador", role: "owner", joinedAtMs: Date.now() }],
      pendingRequests: [],
      weeklyScores: {},
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(inviteRef, { clanId, createdAt: FieldValue.serverTimestamp() });
    transaction.create(actionRef, {
      response,
      name: validation.value.name,
      policy: validation.value.policy,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(userRef, { clanId });
  });
  return response;
});

async function addUserToClan(uid, clanId, requiredPolicy = "public") {
  if (typeof clanId !== "string" || !/^[a-f0-9-]{36}$/i.test(clanId)) {
    throw new HttpsError("invalid-argument", "Clã inválido.");
  }
  const userRef = database.collection("users").doc(uid);
  const clanRef = database.collection("clans").doc(clanId);
  await database.runTransaction(async (transaction) => {
    const [userSnapshot, clanSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(clanRef),
    ]);
    if (!userSnapshot.exists || !clanSnapshot.exists) throw new HttpsError("not-found", "Clã ou perfil não encontrado.");
    if (userSnapshot.get("clanId")) throw new HttpsError("failed-precondition", "Você já pertence a um clã.");
    const user = userSnapshot.data();
    const clan = clanSnapshot.data();
    if (requiredPolicy && clan.policy !== requiredPolicy) {
      throw new HttpsError("permission-denied", "Este clã exige outra forma de entrada.");
    }
    const members = Array.isArray(clan.members) ? clan.members : [];
    const capacity = canAddClanMember({ memberCount: members.length, capacity: 20 });
    if (!capacity.allowed) throw new HttpsError("resource-exhausted", "Este clã já tem 20 membros.");
    if (members.some((member) => member.uid === uid)) throw new HttpsError("already-exists", "Você já está neste clã.");
    transaction.update(clanRef, {
      members: [...members, { uid, displayName: user.displayName || "Jogador", role: "member", joinedAtMs: Date.now() }],
      pendingRequests: (clan.pendingRequests || []).filter((pendingUid) => pendingUid !== uid),
    });
    transaction.update(userRef, { clanId });
  });
  return { ok: true };
}

exports.joinSocialClan = onCall(async (request) => {
  return addUserToClan(authenticatedUid(request), request.data?.clanId, "public");
});

exports.joinSocialClanByInvite = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const code = typeof request.data?.code === "string" ? request.data.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{12}$/.test(code)) throw new HttpsError("invalid-argument", "Código de convite inválido.");
  const invite = await database.collection("clanInviteCodes").doc(code).get();
  if (!invite.exists) throw new HttpsError("not-found", "Código de convite não encontrado.");
  return addUserToClan(uid, invite.get("clanId"), "private");
});

exports.requestSocialClanJoin = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const clanId = request.data?.clanId;
  if (typeof clanId !== "string" || !/^[a-f0-9-]{36}$/i.test(clanId)) {
    throw new HttpsError("invalid-argument", "Clã inválido.");
  }
  const userRef = database.collection("users").doc(uid);
  const clanRef = database.collection("clans").doc(clanId);
  await database.runTransaction(async (transaction) => {
    const [userSnapshot, clanSnapshot] = await Promise.all([transaction.get(userRef), transaction.get(clanRef)]);
    if (!userSnapshot.exists || !clanSnapshot.exists) throw new HttpsError("not-found", "Clã ou perfil não encontrado.");
    if (userSnapshot.get("clanId")) throw new HttpsError("failed-precondition", "Você já pertence a um clã.");
    const clan = clanSnapshot.data();
    if (clan.policy !== "approval") throw new HttpsError("permission-denied", "Este clã não aceita solicitações.");
    const pending = Array.isArray(clan.pendingRequests) ? clan.pendingRequests : [];
    if (pending.includes(uid)) return;
    transaction.update(clanRef, { pendingRequests: [...pending, uid] });
  });
  return { ok: true };
});

exports.inviteSocialClanMember = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const clanId = request.data?.clanId;
  const targetUid = request.data?.targetUid;
  if (typeof clanId !== "string" || !/^[a-f0-9-]{36}$/i.test(clanId)
      || typeof targetUid !== "string" || targetUid.length > 128 || targetUid.includes("/")
      || targetUid === uid) {
    throw new HttpsError("invalid-argument", "Convite inválido.");
  }
  const clanRef = database.collection("clans").doc(clanId);
  const targetRef = database.collection("users").doc(targetUid);
  await database.runTransaction(async (transaction) => {
    const [clanSnapshot, targetSnapshot] = await Promise.all([transaction.get(clanRef), transaction.get(targetRef)]);
    if (!clanSnapshot.exists || !targetSnapshot.exists) throw new HttpsError("not-found", "Clã ou usuário não encontrado.");
    const clan = clanSnapshot.data();
    if (clan.ownerUid !== uid) throw new HttpsError("permission-denied", "Somente o líder pode convidar.");
    if (targetSnapshot.get("clanId")) throw new HttpsError("failed-precondition", "Este usuário já pertence a um clã.");
    const members = Array.isArray(clan.members) ? clan.members : [];
    const capacity = canAddClanMember({ memberCount: members.length, capacity: 20 });
    if (!capacity.allowed) throw new HttpsError("resource-exhausted", "Este clã já tem 20 membros.");
    if (members.some((member) => member.uid === targetUid)) {
      throw new HttpsError("already-exists", "Este usuário já está no clã.");
    }
    transaction.set(targetRef.collection("clanInvitations").doc(clanId), {
      clanId,
      clanName: clan.name,
      inviteCode: clan.inviteCode,
      invitedBy: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

exports.acceptSocialClanInvite = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const clanId = request.data?.clanId;
  if (typeof clanId !== "string" || !/^[a-f0-9-]{36}$/i.test(clanId)) {
    throw new HttpsError("invalid-argument", "Convite inválido.");
  }
  const userRef = database.collection("users").doc(uid);
  const clanRef = database.collection("clans").doc(clanId);
  const inviteRef = userRef.collection("clanInvitations").doc(clanId);
  await database.runTransaction(async (transaction) => {
    const [userSnapshot, clanSnapshot, inviteSnapshot] = await Promise.all([
      transaction.get(userRef), transaction.get(clanRef), transaction.get(inviteRef),
    ]);
    if (!userSnapshot.exists || !clanSnapshot.exists || !inviteSnapshot.exists) {
      throw new HttpsError("not-found", "Convite ou clã não encontrado.");
    }
    if (userSnapshot.get("clanId")) throw new HttpsError("failed-precondition", "Saia do clã atual antes de aceitar.");
    const clan = clanSnapshot.data();
    const members = Array.isArray(clan.members) ? clan.members : [];
    if (inviteSnapshot.get("inviteCode") !== clan.inviteCode) {
      throw new HttpsError("permission-denied", "Este convite não é mais válido.");
    }
    if (!canAddClanMember({ memberCount: members.length, capacity: 20 }).allowed) {
      throw new HttpsError("resource-exhausted", "Este clã já tem 20 membros.");
    }
    transaction.update(clanRef, {
      members: [...members, {
        uid,
        displayName: userSnapshot.get("displayName") || "Jogador",
        role: "member",
        joinedAtMs: Date.now(),
      }],
    });
    transaction.update(userRef, { clanId });
    transaction.delete(inviteRef);
  });
  return { ok: true };
});

exports.approveSocialClanRequest = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const clanId = request.data?.clanId;
  const targetUid = request.data?.targetUid;
  const approve = request.data?.approve !== false;
  if (typeof clanId !== "string" || !/^[a-f0-9-]{36}$/i.test(clanId)
      || typeof targetUid !== "string" || targetUid.length > 128 || targetUid.includes("/")) {
    throw new HttpsError("invalid-argument", "Solicitação inválida.");
  }
  const clanRef = database.collection("clans").doc(clanId);
  const userRef = database.collection("users").doc(targetUid);
  await database.runTransaction(async (transaction) => {
    const [clanSnapshot, userSnapshot] = await Promise.all([transaction.get(clanRef), transaction.get(userRef)]);
    if (!clanSnapshot.exists || !userSnapshot.exists) throw new HttpsError("not-found", "Clã ou usuário não encontrado.");
    const clan = clanSnapshot.data();
    if (clan.ownerUid !== uid) throw new HttpsError("permission-denied", "Somente o líder pode revisar solicitações.");
    const pending = Array.isArray(clan.pendingRequests) ? clan.pendingRequests : [];
    if (!pending.includes(targetUid)) throw new HttpsError("not-found", "Solicitação pendente não encontrada.");
    if (approve) {
      if (userSnapshot.get("clanId")) throw new HttpsError("failed-precondition", "O usuário já entrou em outro clã.");
      const members = Array.isArray(clan.members) ? clan.members : [];
      if (!canAddClanMember({ memberCount: members.length, capacity: 20 }).allowed) {
        throw new HttpsError("resource-exhausted", "Este clã já tem 20 membros.");
      }
      transaction.update(userRef, { clanId });
      transaction.update(clanRef, {
        members: [...members, {
          uid: targetUid,
          displayName: userSnapshot.get("displayName") || "Jogador",
          role: "member",
          joinedAtMs: Date.now(),
        }],
        pendingRequests: pending.filter((memberUid) => memberUid !== targetUid),
      });
    } else {
      transaction.update(clanRef, { pendingRequests: pending.filter((memberUid) => memberUid !== targetUid) });
    }
  });
  return { ok: true };
});

exports.removeSocialClanMember = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const clanId = request.data?.clanId;
  const targetUid = request.data?.targetUid;
  if (typeof clanId !== "string" || !/^[a-f0-9-]{36}$/i.test(clanId)
      || typeof targetUid !== "string" || targetUid.length > 128 || targetUid.includes("/")) {
    throw new HttpsError("invalid-argument", "Membro inválido.");
  }
  const clanRef = database.collection("clans").doc(clanId);
  const targetRef = database.collection("users").doc(targetUid);
  await database.runTransaction(async (transaction) => {
    const [clanSnapshot, targetSnapshot] = await Promise.all([transaction.get(clanRef), transaction.get(targetRef)]);
    if (!clanSnapshot.exists || !targetSnapshot.exists) throw new HttpsError("not-found", "Clã ou membro não encontrado.");
    const clan = clanSnapshot.data();
    if (clan.ownerUid !== uid || targetUid === uid) throw new HttpsError("permission-denied", "Ação não permitida.");
    const members = (clan.members || []).filter((member) => member.uid !== targetUid);
    if (members.length === (clan.members || []).length) throw new HttpsError("not-found", "Membro não encontrado.");
    transaction.update(clanRef, { members });
    if (targetSnapshot.get("clanId") === clanId) transaction.update(targetRef, { clanId: FieldValue.delete() });
  });
  return { ok: true };
});

exports.leaveSocialClan = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const clanId = request.data?.clanId;
  if (typeof clanId !== "string" || !/^[a-f0-9-]{36}$/i.test(clanId)) {
    throw new HttpsError("invalid-argument", "Clã inválido.");
  }
  const clanRef = database.collection("clans").doc(clanId);
  const userRef = database.collection("users").doc(uid);
  await database.runTransaction(async (transaction) => {
    const [clanSnapshot, userSnapshot] = await Promise.all([transaction.get(clanRef), transaction.get(userRef)]);
    if (!clanSnapshot.exists || !userSnapshot.exists || userSnapshot.get("clanId") !== clanId) {
      throw new HttpsError("failed-precondition", "Você não pertence a este clã.");
    }
    const clan = clanSnapshot.data();
    const members = (clan.members || []).filter((member) => member.uid !== uid);
    if (members.length === clan.members?.length) throw new HttpsError("failed-precondition", "Membro do clã inconsistente.");
    if (members.length === 0) {
      transaction.delete(clanRef);
      if (clan.inviteCode) transaction.delete(database.collection("clanInviteCodes").doc(clan.inviteCode));
    } else {
      let ownerUid = clan.ownerUid;
      if (ownerUid === uid) {
        members[0] = { ...members[0], role: "owner" };
        ownerUid = members[0].uid;
      }
      transaction.update(clanRef, { members, ownerUid });
    }
    transaction.update(userRef, { clanId: FieldValue.delete() });
  });
  return { ok: true };
});

exports.claimWeeklyEventReward = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const eventId = request.data?.eventId;
  const eventIdentity = weeklyEventForDate(new Date());
  if (!eventIdentity || eventId !== eventIdentity.id) throw new HttpsError("failed-precondition", "O evento semanal expirou.");
  const userRef = database.collection("users").doc(uid);
  const rankRef = database.collection("leaderboard").doc(uid);
  const eventRef = userRef.collection("weeklyEvents").doc(eventId);
  const transactionRef = userRef.collection("transactions").doc(`weekly_${eventId}`);
  let balanceCents = 0;
  await database.runTransaction(async (transaction) => {
    const [userSnapshot, rankSnapshot, eventSnapshot, transactionSnapshot] = await Promise.all([
      transaction.get(userRef), transaction.get(rankRef), transaction.get(eventRef), transaction.get(transactionRef),
    ]);
    if (!userSnapshot.exists || !rankSnapshot.exists || !eventSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Evento ou perfil não encontrado.");
    }
    const profile = userSnapshot.data();
    const event = eventSnapshot.data();
    const claimedIds = Array.isArray(profile.claimedWeeklyEventIds) ? profile.claimedWeeklyEventIds : [];
    if (claimedIds.includes(eventId) || transactionSnapshot.exists) {
      balanceCents = profile.balanceCents || 0;
      return;
    }
    if ((event.progress || 0) < eventIdentity.target) {
      throw new HttpsError("failed-precondition", "Conclua o desafio antes de resgatar a recompensa.");
    }
    const rewardCents = eventIdentity.rewardCents;
    balanceCents = (profile.balanceCents || 0) + rewardCents;
    if (!Number.isSafeInteger(balanceCents)) throw new HttpsError("failed-precondition", "Saldo resultante inválido.");
    transaction.update(userRef, {
      balanceCents,
      claimedWeeklyEventIds: [...claimedIds, eventId],
    });
    transaction.update(rankRef, { balanceCents });
    transaction.update(eventRef, { claimedAt: FieldValue.serverTimestamp() });
    transaction.create(transactionRef, {
      description: "Recompensa do evento semanal",
      deltaCents: rewardCents,
      type: "weekly_event_reward",
      eventId,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, balanceCents };
});

exports.submitPlayerReport = onCall(async (request) => {
  const uid = authenticatedUid(request);
  const requestId = request.data?.requestId;
  if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Identificador da denúncia inválido.");
  }
  const validated = validateReport({
    reporterUid: uid,
    targetUid: request.data?.targetUid,
    category: request.data?.category,
    details: request.data?.details,
  });
  if (!validated.valid) throw new HttpsError("invalid-argument", "Denúncia inválida ou incompleta.");
  const reportRef = database.collection("playerReports").doc(requestId);
  const userRef = database.collection("users").doc(uid);
  await database.runTransaction(async (transaction) => {
    const [existing, target, reporter] = await Promise.all([
      transaction.get(reportRef),
      transaction.get(database.collection("users").doc(validated.value.targetUid)),
      transaction.get(userRef),
    ]);
    if (existing.exists) {
      if (existing.get("reporterUid") === uid) return;
      throw new HttpsError("already-exists", "Identificador de denúncia já utilizado.");
    }
    if (!reporter.exists || !target.exists) throw new HttpsError("not-found", "Jogador não encontrado.");
    transaction.create(reportRef, {
      ...validated.value,
      status: "open",
      reporterName: reporter.get("displayName") || "Jogador",
      targetName: target.get("displayName") || "Jogador",
      createdAtMs: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

exports.adminListPlayerReports = onCall(async (request) => {
  requireAdmin(request);
  const reports = await database.collection("playerReports")
    .where("status", "in", ["open", "reviewing"])
    .orderBy("createdAtMs", "desc")
    .limit(100)
    .get();
  return {
    reports: reports.docs.map((document) => ({ id: document.id, ...document.data() })),
  };
});

exports.adminModeratePlayerReport = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const reportId = request.data?.reportId;
  const nextStatus = request.data?.status;
  const blockTarget = request.data?.blockTarget === true;
  const reason = typeof request.data?.reason === "string" ? request.data.reason.trim() : "";
  if (typeof reportId !== "string" || typeof nextStatus !== "string" || reason.length < 5 || reason.length > 500) {
    throw new HttpsError("invalid-argument", "Ação, denúncia ou justificativa inválida.");
  }
  if (blockTarget && nextStatus !== "resolved") {
    throw new HttpsError("invalid-argument", "Bloquear o usuário exige resolver a denúncia.");
  }
  const reportRef = database.collection("playerReports").doc(reportId);
  const auditRef = database.collection("adminAuditLogs").doc(`${adminUid}_report_${reportId}_${nextStatus}`);
  await database.runTransaction(async (transaction) => {
    const [reportSnapshot, auditSnapshot] = await Promise.all([transaction.get(reportRef), transaction.get(auditRef)]);
    if (!reportSnapshot.exists) throw new HttpsError("not-found", "Denúncia não encontrada.");
    const report = reportSnapshot.data();
    if (auditSnapshot.exists) return;
    if (!canTransitionReport(report.status, nextStatus)) {
      throw new HttpsError("failed-precondition", "Transição de denúncia não permitida.");
    }
    const targetRef = database.collection("users").doc(report.targetUid);
    if (blockTarget) {
      const targetSnapshot = await transaction.get(targetRef);
      if (!targetSnapshot.exists) throw new HttpsError("not-found", "Usuário denunciado não encontrado.");
      transaction.update(targetRef, { isBlocked: true, blockedBy: adminUid, blockedAt: FieldValue.serverTimestamp() });
    }
    transaction.update(reportRef, {
      status: nextStatus,
      reviewedBy: adminUid,
      reviewReason: reason,
      reviewedAt: FieldValue.serverTimestamp(),
      targetBlocked: blockTarget,
    });
    transaction.create(auditRef, {
      actorUid: adminUid,
      action: "moderate_player_report",
      reportId,
      targetUid: report.targetUid,
      status: nextStatus,
      targetBlocked: blockTarget,
      reason,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});