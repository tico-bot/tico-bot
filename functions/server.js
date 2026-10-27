"use strict";

const crypto = require("node:crypto");
const express = require("express");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const handlers = require("./index");
const { HttpsError, STATUS } = require("./callable");

const app = express();
app.use(express.json({ limit: "20kb" }));

app.get("/", (_req, res) => res.send("zeca-server ok"));

app.post("/whatsapp/link/complete", async (req, res) => {
  const secret = process.env.WHATSAPP_LINK_SECRET;
  if (!secret || secret.length < 32) {
    console.error("WHATSAPP_LINK_SECRET está ausente ou curto demais.");
    return res.status(503).json({ error: { code: "unavailable", message: "Vínculo do WhatsApp indisponível." } });
  }

  const { code, jid } = req.body || {};
  const timestamp = req.get("x-link-timestamp") || "";
  const signature = req.get("x-link-signature") || "";
  if (typeof code !== "string" || typeof jid !== "string" || !/^\d{13}$/.test(timestamp)
      || !/^[a-f\d]{64}$/i.test(signature)) {
    return res.status(400).json({ error: { code: "invalid-argument", message: "Solicitação inválida." } });
  }
  if (Math.abs(Date.now() - Number(timestamp)) > 60_000) {
    return res.status(401).json({ error: { code: "unauthenticated", message: "Solicitação expirada." } });
  }

  const payload = `${timestamp}\n${jid}\n${code}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  const received = Buffer.from(signature, "hex");
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return res.status(401).json({ error: { code: "unauthenticated", message: "Assinatura inválida." } });
  }

  try {
    const result = await handlers._completeWhatsAppLink({ data: { code, jid } });
    return res.json({ result });
  } catch (error) {
    const known = error instanceof HttpsError;
    if (!known) console.error("Falha ao concluir vínculo do WhatsApp:", error);
    const code = known ? error.code : "internal";
    const message = known ? error.message : "Não foi possível concluir o vínculo.";
    return res.status(STATUS[code] || 500).json({ error: { code, message } });
  }
});

app.post("/call/:name", async (req, res) => {
  const { name } = req.params;
  if (name.startsWith("_") || !Object.hasOwn(handlers, name)) {
    return res.status(404).json({ error: { code: "not-found", message: "Função não encontrada." } });
  }
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    let auth = null;
    if (token) {
      try {
        const decoded = await getAuth().verifyIdToken(token);
        auth = { uid: decoded.uid, token: decoded };
      } catch {
        throw new HttpsError("unauthenticated", "Sessão inválida. Entre novamente.");
      }
      const profile = await getFirestore().collection("users").doc(auth.uid).get();
      if (profile.exists && profile.get("isBlocked") === true) {
        throw new HttpsError("permission-denied", "Esta conta está desativada.");
      }
    }
    const result = await handlers[name]({ auth, data: req.body?.data ?? {} });
    res.json({ result });
  } catch (error) {
    const known = error instanceof HttpsError;
    if (!known) console.error(error);
    const quotaExceeded = error.code === 8
      || error.code === "RESOURCE_EXHAUSTED"
      || error.code === "resource-exhausted";
    const code = known ? error.code : quotaExceeded ? "resource-exhausted" : "internal";
    const message = known
      ? error.message
      : quotaExceeded
        ? "A cota do Firestore foi excedida. Aguarde a renovação da cota ou habilite faturamento no Firebase."
        : "Erro interno.";
    res.status(STATUS[code] || 500).json({
      error: { code, message },
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`zeca-server na porta ${port}`);
  const sweepExpiredRooms = () => {
    handlers._cleanupExpiredTugRooms().catch((error) => {
      console.error("Falha ao remover salas concluídas expiradas:", error);
    });
  };
  sweepExpiredRooms();
  setInterval(sweepExpiredRooms, 30_000);
});