"use strict";

require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../.env"), quiet: true });
const { getAuth } = require("firebase-admin/auth");
const { cert, initializeApp } = require("firebase-admin/app");

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
  const expectedProjectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (!serviceAccount.project_id || serviceAccount.project_id !== expectedProjectId) {
    throw new Error("A credencial não corresponde a FIREBASE_PROJECT_ID.");
  }

  initializeApp({ credential: cert(serviceAccount), projectId: expectedProjectId });
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