"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  MongoStore,
  FieldValue,
  FieldPath,
} = require("./mongo-store");

test("MongoStore mantém CRUD, consultas, subcoleções, transações e isolamento por pai", async (t) => {
  const uri = process.env.MONGO_TEST_URI;
  if (!uri) {
    t.skip("Defina MONGO_TEST_URI para executar os testes de integração MongoDB.");
    return;
  }

  const dbName = "tico_store_test_" + randomUUID().replace(/-/g, "");
  const store = new MongoStore({ uri, dbName });
  await store.connect();

  try {
    const users = store.collection("users");
    const alice = users.doc("alice");
    const bob = users.doc("bob");

    await t.test("set, get, timestamps e merge", async () => {
      await alice.set({
        displayName: "Alice",
        balanceCents: 1000,
        settings: { theme: "dark", alerts: true },
        createdAt: FieldValue.serverTimestamp(),
      });
      const initial = await alice.get();
      assert.equal(initial.exists, true);
      assert.equal(initial.get("displayName"), "Alice");
      assert.equal(initial.get("settings.theme"), "dark");
      assert.ok(initial.get("createdAt") instanceof Date);
      assert.equal(typeof initial.get("createdAt").toMillis, "function");

      await alice.set({ settings: { theme: "light" } }, { merge: true });
      const merged = await alice.get();
      assert.deepEqual(merged.get("settings"), { theme: "light", alerts: true });
    });

    await t.test("create, subcoleções e escopo de consultas", async () => {
      const aliceTransactions = alice.collection("transactions");
      const bobTransactions = bob.collection("transactions");
      await bob.set({ displayName: "Bob" });
      await aliceTransactions.doc("a1").create({
        type: "pix",
        amount: 10,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await aliceTransactions.doc("a2").create({
        type: "salary",
        amount: 20,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      });
      await bobTransactions.doc("b1").create({
        type: "pix",
        amount: 999,
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      });

      const pix = await aliceTransactions.where("type", "==", "pix").get();
      assert.equal(pix.size, 1);
      assert.equal(pix.docs[0].id, "a1");

      const all = await aliceTransactions.orderBy("createdAt", "desc").limit(5).get();
      assert.deepEqual(all.docs.map((item) => item.id), ["a2", "a1"]);
    });

    await t.test("paginação com FieldPath.documentId", async () => {
      await users.doc("charlie").set({ displayName: "Charlie" });
      const first = await users.orderBy(FieldPath.documentId()).limit(2).get();
      assert.equal(first.size, 2);
      const second = await users.orderBy(FieldPath.documentId()).startAfter(first.docs[1]).limit(2).get();
      assert.ok(second.size >= 1);
      assert.ok(second.docs[0].id > first.docs[1].id);
    });

    await t.test("transações aplicam incrementos e revertem em caso de erro", async () => {
      await store.runTransaction(async (transaction) => {
        const current = await transaction.get(alice);
        assert.equal(current.get("balanceCents"), 1000);
        transaction.update(alice, {
          balanceCents: FieldValue.increment(-125),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(alice.collection("transactions").doc("atomic"), {
          type: "transfer",
          amount: 125,
        });
      });
      assert.equal((await alice.get()).get("balanceCents"), 875);

      await assert.rejects(store.runTransaction(async (transaction) => {
        await transaction.get(alice);
        transaction.update(alice, { balanceCents: FieldValue.increment(-500) });
        throw new Error("rollback-test");
      }), /rollback-test/);
      assert.equal((await alice.get()).get("balanceCents"), 875);
    });

    await t.test("lotes confirmam as operações atomicamente", async () => {
      const batch = store.batch();
      batch.set(alice.collection("preferences").doc("app"), { language: "pt-BR" });
      batch.update(alice, { balanceCents: 900 });
      await batch.commit();
      assert.equal((await alice.get()).get("balanceCents"), 900);
      assert.equal((await alice.collection("preferences").doc("app").get()).get("language"), "pt-BR");
    });

    await t.test("FieldValue.delete remove apenas o campo indicado", async () => {
      await alice.update({ "settings.alerts": FieldValue.delete() });
      const data = (await alice.get()).data();
      assert.equal(data.settings.theme, "light");
      assert.equal(Object.hasOwn(data.settings, "alerts"), false);
    });

    await t.test("recursiveDelete remove apenas a árvore do documento seleccionado", async () => {
      await alice.collection("transactions").doc("a1").collection("messages").doc("m1")
        .set({ text: "nested" });
      await store.recursiveDelete(alice);
      assert.equal((await alice.get()).exists, false);
      assert.equal((await bob.get()).exists, true);
      assert.equal((await bob.collection("transactions").doc("b1").get()).exists, true);
      assert.equal((await users.doc("charlie").get()).exists, true);
    });

    await t.test("conflitos de criação preservam unicidade", async () => {
      const ref = users.doc("unique");
      await ref.create({ value: 1 });
      await assert.rejects(ref.create({ value: 2 }), (error) => error.code === "already-exists");
    });
  } finally {
    await store.close();
    const { MongoClient } = require("mongodb");
    const cleanup = new MongoClient(uri);
    await cleanup.connect();
    await cleanup.db(dbName).dropDatabase();
    await cleanup.close();
  }
});
