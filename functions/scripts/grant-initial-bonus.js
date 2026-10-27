"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { cert, initializeApp } = require("firebase-admin/app");
const { FieldPath, FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");

const INITIAL_BONUS_CENTS = 50_000;
const DEFAULT_MIGRATION_ID = "retroactive-initial-bonus-20260930";
const BATCH_SIZE = 200;
const EXPECTED_PROJECT_ID = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../app/google-services.json"), "utf8"),
).project_info.project_id;

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] || null;
}

function getCreditConfig() {
  const amountCents = Number(readArgument("--amount-cents") ?? INITIAL_BONUS_CENTS);
  const migrationId = readArgument("--migration-id") ?? DEFAULT_MIGRATION_ID;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("--amount-cents deve ser um inteiro positivo.");
  }
  if (amountCents !== INITIAL_BONUS_CENTS && !readArgument("--migration-id")) {
    throw new Error("Informe um --migration-id único para este crédito.");
  }
  if (!/^[a-z0-9-]{8,120}$/i.test(migrationId)) {
    throw new Error("--migration-id deve conter de 8 a 120 letras, números ou hífens.");
  }
  const description = readArgument("--description")
    || (amountCents === INITIAL_BONUS_CENTS
      ? "Bônus retroativo de saldo inicial"
      : `Crédito administrativo de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amountCents / 100)}`);
  const type = amountCents === INITIAL_BONUS_CENTS && migrationId === DEFAULT_MIGRATION_ID
    ? "initial_balance_grant"
    : "admin_credit";
  return { amountCents, migrationId, description, type };
}

function initializeDatabase() {
  const serializedServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serializedServiceAccount) {
    throw new Error("Configure FIREBASE_SERVICE_ACCOUNT no ambiente antes de executar a migração.");
  }

  const serviceAccount = JSON.parse(serializedServiceAccount);
  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Projeto da credencial (${serviceAccount.project_id}) diferente do app (${EXPECTED_PROJECT_ID}).`,
    );
  }

  initializeApp({ credential: cert(serviceAccount), projectId: EXPECTED_PROJECT_ID });
  return getFirestore();
}

async function getMigration(database, apply, config) {
  const migrationRef = database.collection("systemMigrations").doc(config.migrationId);
  if (!apply) {
    const snapshot = await migrationRef.get();
    if (snapshot.exists) {
      const data = snapshot.data();
      if (data.amountCents !== config.amountCents) {
        throw new Error("Este migration-id já foi usado com outro valor.");
      }
      return { ref: migrationRef, ...data };
    }
    return { ref: migrationRef, state: "preview", amountCents: config.amountCents, cohortCutoff: Timestamp.now() };
  }

  const migration = await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(migrationRef);
    if (snapshot.exists) {
      const data = snapshot.data();
      if (data.amountCents !== config.amountCents) {
        throw new Error("Este migration-id já foi usado com outro valor.");
      }
      return data;
    }
    const data = {
      state: "running",
      amountCents: config.amountCents,
      cohortCutoff: Timestamp.now(),
      createdAt: FieldValue.serverTimestamp(),
    };
    transaction.create(migrationRef, data);
    return data;
  });
  return { ref: migrationRef, ...migration };
}

function createdAtMillis(profile) {
  const value = profile.createdAt;
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

function startingBalance(profile, amountCents) {
  const balance = profile.balanceCents === undefined ? 0 : profile.balanceCents;
  if (!Number.isSafeInteger(balance) || balance < 0) return null;
  const updatedBalance = balance + amountCents;
  return Number.isSafeInteger(updatedBalance) ? updatedBalance : null;
}

async function creditAccount(database, userId, cutoffMillis, config) {
  const userRef = database.collection("users").doc(userId);
  const rankRef = database.collection("leaderboard").doc(userId);
  const grantRef = userRef.collection("transactions").doc(config.migrationId);

  return database.runTransaction(async (transaction) => {
    const [userSnapshot, rankSnapshot, grantSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(rankRef),
      transaction.get(grantRef),
    ]);
    if (!userSnapshot.exists) return "missing";
    if (grantSnapshot.exists) return "already-credited";

    const profile = userSnapshot.data();
    const createdAt = createdAtMillis(profile);
    if (createdAt !== null && createdAt > cutoffMillis) return "created-after-cutoff";

    const balanceAfter = startingBalance(profile, config.amountCents);
    if (balanceAfter === null) return "invalid-balance";

    transaction.update(userRef, {
      balanceCents: balanceAfter,
      balanceInitialized: true,
    });
    if (rankSnapshot.exists) {
      transaction.update(rankRef, { balanceCents: balanceAfter });
    } else {
      transaction.create(rankRef, {
        displayName: profile.displayName || "Jogador",
        username: profile.username || "",
        balanceCents: balanceAfter,
        level: Number.isSafeInteger(profile.level) && profile.level > 0 ? profile.level : 1,
        avatarUrl: profile.avatarUrl || "",
        avatarAsProfilePhoto: profile.avatarAsProfilePhoto === true,
        equippedAvatarItems: Array.isArray(profile.equippedAvatarItems)
          ? profile.equippedAvatarItems
          : [],
      });
    }
    transaction.create(grantRef, {
      description: config.description,
      deltaCents: config.amountCents,
      type: config.type,
      migrationId: config.migrationId,
      createdAt: FieldValue.serverTimestamp(),
    });
    return "credited";
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const config = getCreditConfig();
  const database = initializeDatabase();
  const migration = await getMigration(database, apply, config);
  if (migration.state === "completed") {
    console.log(`Migração já concluída: ${migration.creditedCount} contas receberam ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(config.amountCents / 100)}.`);
    return;
  }

  const cutoffMillis = migration.cohortCutoff.toMillis();
  const counts = {
    eligible: 0,
    credited: 0,
    alreadyCredited: 0,
    skippedAfterCutoff: 0,
    skippedInvalidBalance: 0,
    skippedMissing: 0,
  };
  let cursor = null;

  while (true) {
    let query = database.collection("users")
      .orderBy(FieldPath.documentId())
      .limit(BATCH_SIZE);
    if (cursor) query = query.startAfter(cursor);

    const page = await query.get();
    if (page.empty) break;
    cursor = page.docs[page.docs.length - 1];

    for (const userDocument of page.docs) {
      const profile = userDocument.data();
      const createdAt = createdAtMillis(profile);
      if (createdAt !== null && createdAt > cutoffMillis) {
        counts.skippedAfterCutoff += 1;
        continue;
      }
      counts.eligible += 1;

      if (!apply) {
        const grant = await userDocument.ref.collection("transactions").doc(config.migrationId).get();
        if (grant.exists) counts.alreadyCredited += 1;
        else if (startingBalance(profile, config.amountCents) === null) counts.skippedInvalidBalance += 1;
        else counts.credited += 1;
        continue;
      }

      const result = await creditAccount(database, userDocument.id, cutoffMillis, config);
      if (result === "credited") counts.credited += 1;
      else if (result === "already-credited") counts.alreadyCredited += 1;
      else if (result === "created-after-cutoff") counts.skippedAfterCutoff += 1;
      else if (result === "invalid-balance") counts.skippedInvalidBalance += 1;
      else counts.skippedMissing += 1;
    }
  }

  console.log(`Projeto: ${EXPECTED_PROJECT_ID}`);
  console.log(`Crédito por conta: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(config.amountCents / 100)}`);
  console.log(`Coorte até: ${new Date(cutoffMillis).toISOString()}`);
  console.log(JSON.stringify(counts, null, 2));

  if (apply) {
    await migration.ref.update({
      state: "completed",
      creditedCount: counts.credited + counts.alreadyCredited,
      skippedAfterCutoff: counts.skippedAfterCutoff,
      skippedInvalidBalance: counts.skippedInvalidBalance,
      completedAt: FieldValue.serverTimestamp(),
    });
    console.log("Crédito concluído; cada conta recebeu no máximo um lançamento nesta migração.");
  } else {
    console.log("Simulação: nenhum saldo foi alterado. Use --apply para executar.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});