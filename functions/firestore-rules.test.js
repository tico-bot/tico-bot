"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } = require("firebase/firestore");

const PROJECT_ID = "demo-zeca-store-rules";
const RULES = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
const PRODUCTS = {
  frame_aurora: { name: "Moldura Aurora", priceCents: 1_299 },
  title_lucky: { name: "Título: Sorte Grande", priceCents: 799 },
  frame_neon: { name: "Moldura Neon", priceCents: 1_999 },
  avatar_hair_wave: { name: "Cabelo Ondulado", priceCents: 999 },
};

let environment;

test.before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: RULES,
    },
  });
});

test.after(async () => {
  await environment?.cleanup();
});

async function seedPlayer(uid, balanceCents = 50_000) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await database.doc(`users/${uid}`).set({
      uid,
      displayName: uid,
      email: `${uid}@example.com`,
      username: uid,
      profileSetupComplete: true,
      balanceCents,
      balanceInitialized: true,
      level: 1,
      avatarUrl: "",
      avatarAsProfilePhoto: false,
      equippedAvatarItems: [],
      pixKey: "",
      pixKeyType: "",
      pixKeyHash: "",
      gamesPlayed: 0,
      wins: 0,
      inventory: [],
    });
    await database.doc(`leaderboard/${uid}`).set({
      displayName: uid,
      username: uid,
      balanceCents,
      level: 1,
      avatarUrl: "",
      avatarAsProfilePhoto: false,
      equippedAvatarItems: [],
      equippedFrame: "",
    });
  });
}

test("blocked users cannot read their profile or the leaderboard", async () => {
  const uid = "blocked-player";
  await seedPlayer(uid);
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`users/${uid}`).update({ isBlocked: true });
  });
  const database = environment.authenticatedContext(uid).firestore();
  await assertFails(getDoc(doc(database, "users", uid)));
  await assertFails(getDoc(doc(database, "leaderboard", uid)));
});

test("presence is visible to active players but writable only by its owner", async () => {
  const uid = "presence-owner";
  await seedPlayer(uid);
  await seedPlayer("presence-reader");
  const ownerDb = environment.authenticatedContext(uid).firestore();
  const readerDb = environment.authenticatedContext("presence-reader").firestore();
  const presence = {
    uid,
    online: true,
    lastSeenAt: serverTimestamp(),
    activeGame: "Jogando",
    typingChatId: "global",
  };
  await assertSucceeds(setDoc(doc(ownerDb, "userPresence", uid), presence));
  await assertSucceeds(getDoc(doc(readerDb, "userPresence", uid)));
  await assertFails(setDoc(doc(readerDb, "userPresence", uid), { ...presence, online: false }));
  await assertFails(setDoc(doc(ownerDb, "userPresence", uid), { ...presence, admin: true }));
});

test("chat accepts an authenticated Cloudinary voice note but rejects arbitrary audio URLs", async () => {
  const uid = "audio-sender";
  await seedPlayer(uid);
  const database = environment.authenticatedContext(uid).firestore();
  const validMessage = {
    senderUid: uid,
    senderName: uid,
    senderUsername: uid,
    senderAvatarUrl: "",
    senderAvatarItems: [],
    senderAvatarAsProfilePhoto: false,
    senderEquippedFrame: "",
    text: "",
    createdAt: serverTimestamp(),
    type: "audio",
    audioUrl: "https://res.cloudinary.com/vwctfu9u/video/upload/voice-request-id.m4a",
    audioPublicId: "voice-request-id",
    audioDurationMs: 1_500,
  };
  await assertSucceeds(setDoc(doc(database, "chats", "global", "messages", "voice-request-id"), validMessage));
  await assertFails(setDoc(doc(database, "chats", "global", "messages", "voice-request-external"), {
    ...validMessage,
    audioPublicId: "voice-request-external",
    audioUrl: "https://audio.example.net/voice.m4a",
  }));
});

async function purchase(uid, itemId, purchaseId = "purchase-test-0001", amountOverride) {
  const product = PRODUCTS[itemId];
  const price = amountOverride ?? product?.priceCents ?? 0;
  const database = environment.authenticatedContext(uid).firestore();
  const userRef = doc(database, "users", uid);
  const rankRef = doc(database, "leaderboard", uid);
  const purchaseRef = doc(database, "users", uid, "purchases", purchaseId);
  const transactionRef = doc(database, "users", uid, "transactions", purchaseId);

  return runTransaction(database, async (transaction) => {
    const [profile, rank, receipt] = await Promise.all([
      transaction.get(userRef),
      transaction.get(rankRef),
      transaction.get(purchaseRef),
    ]);
    if (receipt.exists()) throw new Error("duplicate purchase");
    const balanceAfter = profile.data().balanceCents - price;
    const inventory = [...profile.data().inventory, itemId];
    transaction.update(userRef, {
      balanceCents: balanceAfter,
      inventory,
      lastPurchaseId: purchaseId,
    });
    transaction.update(rankRef, { balanceCents: balanceAfter });
    transaction.set(purchaseRef, {
      uid,
      itemId,
      amountCents: price,
      createdAt: serverTimestamp(),
    });
    transaction.set(transactionRef, {
      description: `Loja · ${product?.name || "Item inválido"}`,
      deltaCents: -price,
      itemId,
      createdAt: serverTimestamp(),
    });
    return balanceAfter;
  });
}

async function writePrivateMessage(senderUid, recipientUid, messageId, senderUidMetadata = senderUid) {
  const database = environment.authenticatedContext(senderUid).firestore();
  const participantUids = [senderUid, recipientUid].sort();
  const chatId = participantUids.join("_");
  const chatRef = doc(database, "chats", chatId);
  const messageRef = doc(database, "chats", chatId, "messages", messageId);

  return runTransaction(database, async (transaction) => {
    transaction.set(chatRef, {
      participantUids,
      lastMessage: "Olá",
      lastMessageAt: serverTimestamp(),
      lastMessageId: messageId,
      lastMessageSenderUid: senderUidMetadata,
      createdAt: serverTimestamp(),
    });
    transaction.set(messageRef, {
      senderUid,
      senderName: senderUid,
      senderUsername: senderUid,
      senderAvatarUrl: "",
      senderAvatarItems: [],
      senderAvatarAsProfilePhoto: false,
      senderEquippedFrame: "",
      text: "Olá",
      createdAt: serverTimestamp(),
    });
  });
}

test("allows purchase with fixed catalog price and atomically debits/inserts receipt", async () => {
  const uid = "player-valid";
  await seedPlayer(uid);
  const balanceAfter = await assertSucceeds(purchase(uid, "frame_aurora"));
  assert.equal(balanceAfter, 48_701);

  const database = environment.authenticatedContext(uid).firestore();
  const profile = await getDoc(doc(database, "users", uid));
  assert.equal(profile.data().balanceCents, 48_701);
  assert.deepEqual(profile.data().inventory, ["frame_aurora"]);
  assert.equal(profile.data().lastPurchaseId, "purchase-test-0001");
});

test("denies arbitrary balance changes", async () => {
  const uid = "player-balance-attack";
  await seedPlayer(uid);
  const database = environment.authenticatedContext(uid).firestore();
  await assertFails(updateDoc(doc(database, "users", uid), { balanceCents: 99_999_999 }));
});

test("denies altered cosmetic prices and unknown catalog items", async () => {
  const uid = "player-price-attack";
  await seedPlayer(uid);
  await assertFails(purchase(uid, "frame_aurora", "purchase-bad-price-01", 1));
  await assertFails(purchase(uid, "admin_item", "purchase-unknown-item", 1));
});

test("denies duplicate cosmetic ownership", async () => {
  const uid = "player-duplicate";
  await seedPlayer(uid);
  await assertSucceeds(purchase(uid, "title_lucky", "purchase-title-valid"));
  await assertFails(purchase(uid, "title_lucky", "purchase-title-again"));
});

test("allows a private message with the authenticated sender metadata", async () => {
  await seedPlayer("chat-sender");
  await seedPlayer("chat-recipient");
  await assertSucceeds(writePrivateMessage(
    "chat-sender",
    "chat-recipient",
    "12345678-1234-1234-1234-123456789012",
  ));
});

test("read receipts can only be written by their owner and read by chat participants", async () => {
  const senderUid = "receipt-sender";
  const recipientUid = "receipt-recipient";
  const outsiderUid = "receipt-outsider";
  const messageId = "12345678-1234-1234-1234-123456789012";
  await seedPlayer(senderUid);
  await seedPlayer(recipientUid);
  await seedPlayer(outsiderUid);
  await assertSucceeds(writePrivateMessage(senderUid, recipientUid, messageId));

  const chatId = [senderUid, recipientUid].sort().join("_");
  const sender = environment.authenticatedContext(senderUid).firestore();
  const recipient = environment.authenticatedContext(recipientUid).firestore();
  const outsider = environment.authenticatedContext(outsiderUid).firestore();
  const receipt = {
    lastReadMessageId: messageId,
    lastReadAt: serverTimestamp(),
  };

  await assertSucceeds(setDoc(doc(recipient, "chats", chatId, "readReceipts", recipientUid), receipt));
  await assertSucceeds(getDoc(doc(sender, "chats", chatId, "readReceipts", recipientUid)));
  await assertFails(setDoc(doc(sender, "chats", chatId, "readReceipts", recipientUid), receipt));
  await assertFails(setDoc(doc(outsider, "chats", chatId, "readReceipts", outsiderUid), receipt));
  await assertFails(setDoc(doc(recipient, "chats", chatId, "readReceipts", recipientUid), {
    ...receipt,
    isAdmin: true,
  }));
});

test("Jokenpô queues and matches are private and server-written", async () => {
  const playerOne = "jokenpo-player-one";
  const playerTwo = "jokenpo-player-two";
  const outsiderUid = "jokenpo-outsider";
  const matchId = "12345678-1234-1234-1234-123456789012";
  await seedPlayer(playerOne);
  await seedPlayer(playerTwo);
  await seedPlayer(outsiderUid);
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await database.doc(`jokenpoQueue/${playerOne}`).set({ uid: playerOne, status: "waiting" });
    await database.doc(`jokenpoMatches/${matchId}`).set({ playerUids: [playerOne, playerTwo], status: "playing" });
  });

  const playerOneDb = environment.authenticatedContext(playerOne).firestore();
  const playerTwoDb = environment.authenticatedContext(playerTwo).firestore();
  const outsiderDb = environment.authenticatedContext(outsiderUid).firestore();
  await assertSucceeds(getDoc(doc(playerOneDb, "jokenpoQueue", playerOne)));
  await assertFails(getDoc(doc(playerTwoDb, "jokenpoQueue", playerOne)));
  await assertSucceeds(getDoc(doc(playerTwoDb, "jokenpoMatches", matchId)));
  await assertFails(getDoc(doc(outsiderDb, "jokenpoMatches", matchId)));
  await assertFails(setDoc(doc(playerOneDb, "jokenpoQueue", playerOne), { uid: playerOne, status: "matched" }));
  await assertFails(setDoc(doc(playerOneDb, "jokenpoMatches", matchId), { playerUids: [playerOne, playerTwo], status: "completed" }));
  await assertFails(getDoc(doc(playerOneDb, "jokenpoMatches", matchId, "moves", playerOne)));
  await assertFails(setDoc(doc(playerOneDb, "jokenpoMatches", matchId, "moves", playerOne), { choice: "rock" }));
});

test("denies private-chat metadata that forges the last sender", async () => {
  await seedPlayer("chat-real-sender");
  await seedPlayer("chat-other-user");
  await seedPlayer("chat-forged-sender");
  await assertFails(writePrivateMessage(
    "chat-real-sender",
    "chat-other-user",
    "87654321-4321-4321-4321-210987654321",
    "chat-forged-sender",
  ));
});

test("allows an authenticated listener before a direct chat exists, then protects it", async () => {
  const participantUids = ["empty-chat-member", "empty-chat-other"].sort();
  const chatId = participantUids.join("_");
  const member = environment.authenticatedContext(participantUids[0]).firestore();
  const outsider = environment.authenticatedContext("empty-chat-outsider").firestore();
  const messagePath = (database) => doc(database, "chats", chatId, "messages", "first-message");

  await assertSucceeds(getDoc(messagePath(member)));
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`chats/${chatId}`).set({ participantUids });
  });
  await assertFails(getDoc(messagePath(outsider)));
  await assertSucceeds(getDoc(messagePath(member)));
});

test("allows only the message author to edit text within the chat limit", async () => {
  const authorUid = "edit-message-author";
  const otherUid = "edit-message-other";
  const outsiderUid = "edit-message-outsider";
  const participantUids = [authorUid, otherUid].sort();
  const chatId = participantUids.join("_");
  const messageId = "edit-message-0001";
  await seedPlayer(authorUid);
  await seedPlayer(otherUid);
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await database.doc(`chats/${chatId}`).set({ participantUids, type: "direct" });
    await database.doc(`chats/${chatId}/messages/${messageId}`).set({
      senderUid: authorUid,
      text: "Original",
      createdAt: new Date(),
    });
  });

  const author = environment.authenticatedContext(authorUid).firestore();
  const other = environment.authenticatedContext(otherUid).firestore();
  const outsider = environment.authenticatedContext(outsiderUid).firestore();
  const messageRef = (database) => doc(database, "chats", chatId, "messages", messageId);
  await assertSucceeds(updateDoc(messageRef(author), { text: "Corrigida", editedAt: serverTimestamp() }));
  await assertFails(updateDoc(messageRef(other), { text: "Alteração alheia", editedAt: serverTimestamp() }));
  await assertFails(updateDoc(messageRef(outsider), { text: "Invasão", editedAt: serverTimestamp() }));
  await assertFails(updateDoc(messageRef(author), { text: "x".repeat(501), editedAt: serverTimestamp() }));
});

test("allows a new account to create an incomplete profile before choosing its username", async () => {
  const uid = "new-profile-user";
  const database = environment.authenticatedContext(uid).firestore();
  await assertSucceeds(runTransaction(database, async (transaction) => {
    transaction.set(doc(database, "users", uid), {
      uid,
      displayName: "Jogador Novo",
      username: "",
      profileSetupComplete: false,
      email: "novo@example.com",
      balanceCents: 50_000,
      balanceInitialized: true,
      level: 1,
      avatarUrl: "",
      avatarAsProfilePhoto: false,
      equippedAvatarItems: [],
      pixKey: "",
      pixKeyType: "",
      pixKeyHash: "",
      gamesPlayed: 0,
      wins: 0,
      inventory: [],
      createdAt: serverTimestamp(),
    });
    transaction.set(doc(database, "leaderboard", uid), {
      displayName: "Jogador Novo",
      username: "",
      balanceCents: 50_000,
      level: 1,
      avatarUrl: "",
      avatarAsProfilePhoto: false,
      equippedAvatarItems: [],
      equippedFrame: "",
    });
  }));
});

test("denies direct client writes to username reservations", async () => {
  const database = environment.authenticatedContext("username-attacker").firestore();
  await assertFails(setDoc(doc(database, "usernames", "already_taken"), { uid: "username-attacker" }));
});

test("group members can read their group and its messages but outsiders cannot", async () => {
  const chatId = "group-chat-test-00000000000000000000";
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await database.doc(`chats/${chatId}`).set({
      type: "group",
      name: "Teste",
      participantUids: ["group-member-a", "group-member-b"],
      streakDays: 0,
    });
    await database.doc(`chats/${chatId}/messages/message-1`).set({ text: "Olá" });
  });

  const member = environment.authenticatedContext("group-member-a").firestore();
  const outsider = environment.authenticatedContext("group-outsider").firestore();
  await assertSucceeds(getDoc(doc(member, "chats", chatId)));
  await assertSucceeds(getDoc(doc(member, "chats", chatId, "messages", "message-1")));
  await assertFails(getDoc(doc(outsider, "chats", chatId)));
  await assertFails(getDoc(doc(outsider, "chats", chatId, "messages", "message-1")));
  await assertSucceeds(updateDoc(doc(member, "chats", chatId, "messages", "message-1"), {
    deletedFor: ["group-member-a"],
  }));
  await assertFails(updateDoc(doc(outsider, "chats", chatId, "messages", "message-1"), {
    deletedFor: ["group-outsider"],
  }));
});

test("group members cannot edit streak or last-message metadata directly", async () => {
  const chatId = "group-chat-locked-000000000000000000";
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`chats/${chatId}`).set({
      type: "group",
      participantUids: ["group-owner", "group-member"],
      streakDays: 3,
      lastMessage: "Antes",
      lastMessageAt: new Date(),
      lastMessageId: "old-message",
      lastMessageSenderUid: "group-owner",
    });
  });
  const member = environment.authenticatedContext("group-member").firestore();
  await assertFails(updateDoc(doc(member, "chats", chatId), {
    streakDays: 99,
    lastMessage: "Falso",
  }));
});

test("allows purchase of a priced avatar cosmetic", async () => {
  const uid = "avatar-buyer";
  await seedPlayer(uid);
  await assertSucceeds(purchase(uid, "avatar_hair_wave", "purchase-avatar-0001"));
  const database = environment.authenticatedContext(uid).firestore();
  const profile = await getDoc(doc(database, "users", uid));
  assert.equal(profile.data().balanceCents, 49_001);
  assert.deepEqual(profile.data().inventory, ["avatar_hair_wave"]);
});

test("allows legacy profiles to receive only safe default avatar fields once", async () => {
  const uid = "legacy-avatar-profile";
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`users/${uid}`).set({
      uid,
      displayName: "Jogador Legado",
      email: "legado@example.com",
      balanceCents: 10_000,
      balanceInitialized: true,
      level: 1,
      avatarUrl: "",
      username: "legado",
      profileSetupComplete: true,
      pixKey: "",
      pixKeyType: "",
      pixKeyHash: "",
      gamesPlayed: 2,
      wins: 1,
      inventory: [],
    });
  });
  const database = environment.authenticatedContext(uid).firestore();
  const userRef = doc(database, "users", uid);
  await assertSucceeds(updateDoc(userRef, { avatarAsProfilePhoto: false, equippedAvatarItems: [] }));
  await assertFails(updateDoc(userRef, { equippedAvatarItems: ["avatar_crown_neon"] }));
  await assertFails(updateDoc(userRef, { avatarAsProfilePhoto: true }));
});

test("allows legacy balance initialization and avatar defaults in one atomic update", async () => {
  const uid = "legacy-balance-avatar-profile";
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`users/${uid}`).set({
      uid,
      displayName: "Jogador Antigo",
      email: "antigo@example.com",
      balanceCents: 0,
      balanceInitialized: false,
      level: 1,
      avatarUrl: "",
      username: "antigo",
      profileSetupComplete: true,
      pixKey: "",
      pixKeyType: "",
      pixKeyHash: "",
      gamesPlayed: 0,
      wins: 0,
      inventory: [],
    });
  });
  const database = environment.authenticatedContext(uid).firestore();
  await assertSucceeds(updateDoc(doc(database, "users", uid), {
    balanceCents: 50_000,
    balanceInitialized: true,
    avatarAsProfilePhoto: false,
    equippedAvatarItems: [],
  }));
  await assertFails(updateDoc(doc(database, "users", uid), {
    balanceCents: 50_000,
    balanceInitialized: true,
    avatarAsProfilePhoto: false,
    equippedAvatarItems: ["avatar_crown_neon"],
  }));
});

test("allows profile reconciliation to synchronize avatar metadata to the leaderboard", async () => {
  const uid = "legacy-ranking-avatar-sync";
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await database.doc(`users/${uid}`).set({
      uid,
      displayName: "Perfil Antigo",
      email: "perfil@example.com",
      balanceCents: 19_010,
      balanceInitialized: true,
      level: 2,
      avatarUrl: "",
      username: "perfilantigo",
      profileSetupComplete: true,
      pixKey: "",
      pixKeyType: "",
      pixKeyHash: "",
      gamesPlayed: 10,
      wins: 3,
      inventory: [],
    });
    await database.doc(`leaderboard/${uid}`).set({
      displayName: "Perfil Antigo",
      balanceCents: 19_010,
      level: 2,
      avatarUrl: "",
      username: "perfilantigo",
    });
  });

  const database = environment.authenticatedContext(uid).firestore();
  const userRef = doc(database, "users", uid);
  const rankRef = doc(database, "leaderboard", uid);
  await assertSucceeds(runTransaction(database, async (transaction) => {
    transaction.update(userRef, {
      avatarAsProfilePhoto: false,
      equippedAvatarItems: [],
    });
    transaction.update(rankRef, {
      displayName: "Perfil Antigo",
      username: "perfilantigo",
      balanceCents: 19_010,
      level: 2,
      avatarUrl: "",
      avatarAsProfilePhoto: false,
      equippedAvatarItems: [],
    });
  }));

  await assertFails(updateDoc(rankRef, { equippedAvatarItems: ["avatar_crown_neon"] }));
});