"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getAuth } = require("firebase-admin/auth");
const { cert, initializeApp } = require("firebase-admin/app");

const EXPECTED_PROJECT_ID = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../app/google-services.json"), "utf8"),
).project_info.project_id;

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] || null;
}

async function main() {
  const email = readArgument("--email")?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Informe um e-mail válido com --email.");
  }
  const serializedServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serializedServiceAccount) {
    throw new Error("Configure FIREBASE_SERVICE_ACCOUNT no ambiente; não use a senha da conta.");
  }
  const serviceAccount = JSON.parse(serializedServiceAccount);
  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(`A credencial deve pertencer ao projeto ${EXPECTED_PROJECT_ID}.`);
  }

  initializeApp({ credential: cert(serviceAccount), projectId: EXPECTED_PROJECT_ID });
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { ...user.customClaims, admin: true });
  console.log(`Claim admin concedido para ${user.email} (${user.uid}).`);
  console.log("A conta precisa renovar o token do Firebase para receber o acesso.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});