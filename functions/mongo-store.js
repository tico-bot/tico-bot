"use strict";

const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");
const { MongoClient } = require("mongodb");

try {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
} catch {}

const COLLECTION_MAP = "__tico_collection_paths";
const COLLECTION_PREFIX = "tico_";
const TRANSFORM = Symbol("mongo-store-transform");
const DOCUMENT_ID = Symbol("mongo-store-document-id");
const OMIT = Symbol("mongo-store-omit");

function makeTransform(operation, value) {
  return Object.freeze({ [TRANSFORM]: operation, value });
}

const FieldValue = Object.freeze({
  serverTimestamp: () => makeTransform("serverTimestamp"),
  increment: (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError("FieldValue.increment espera um número finito.");
    }
    return makeTransform("increment", value);
  },
  delete: () => makeTransform("delete"),
});

const FieldPath = Object.freeze({
  documentId: () => Object.freeze({ [DOCUMENT_ID]: true }),
});

class MongoTimestamp extends Date {
  toMillis() { return this.getTime(); }
  toDate() { return new Date(this.getTime()); }
  static now() { return new MongoTimestamp(); }
  static fromMillis(value) { return new MongoTimestamp(value); }
}

class MongoStoreError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "MongoStoreError";
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (value instanceof Date) return new MongoTimestamp(value.getTime());
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const [key, nested] of Object.entries(value)) output[key] = cloneValue(nested);
    return output;
  }
  return value;
}

function hydrateValue(value) {
  if (value instanceof Date) return new MongoTimestamp(value.getTime());
  if (Array.isArray(value)) return value.map(hydrateValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const [key, nested] of Object.entries(value)) output[key] = hydrateValue(nested);
    return output;
  }
  return value;
}

function getField(data, field) {
  if (!data || typeof data !== "object") return undefined;
  return String(field).split(".").reduce((current, part) => current?.[part], data);
}

function mongoField(field) {
  return field && field[DOCUMENT_ID] === true ? "__documentId" : String(field);
}

function safeDocumentId(id) {
  const value = String(id || "");
  if (!value || value.includes("/") || value.includes("\0")) {
    throw new TypeError("O identificador do documento é inválido.");
  }
  return value;
}

function resolveLiteral(value) {
  if (value && value[TRANSFORM]) {
    if (value[TRANSFORM] === "serverTimestamp") return new Date();
    if (value[TRANSFORM] === "increment") return value.value;
    if (value[TRANSFORM] === "delete") return OMIT;
  }
  if (Array.isArray(value)) {
    return value.map(resolveLiteral).filter((item) => item !== OMIT);
  }
  if (isPlainObject(value)) {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      const resolved = resolveLiteral(nested);
      if (resolved !== OMIT) output[key] = resolved;
    }
    return output;
  }
  if (value instanceof Date) return new Date(value.getTime());
  return value;
}

function containsTransform(value) {
  if (value && value[TRANSFORM]) return true;
  if (Array.isArray(value)) return value.some(containsTransform);
  if (isPlainObject(value)) return Object.values(value).some(containsTransform);
  return false;
}

function buildUpdateParts(data, { merge = false } = {}) {
  if (!isPlainObject(data)) throw new TypeError("Os dados do documento devem ser um objecto.");
  const set = {};
  const inc = {};
  const unset = {};

  function assign(field, value, flattenObjects) {
    if (value && value[TRANSFORM]) {
      switch (value[TRANSFORM]) {
        case "serverTimestamp": set[field] = new Date(); break;
        case "increment": inc[field] = value.value; break;
        case "delete": unset[field] = ""; break;
        default: throw new TypeError("Transformação MongoDB desconhecida.");
      }
      return;
    }
    if (flattenObjects && isPlainObject(value) && Object.keys(value).length > 0) {
      for (const [key, nested] of Object.entries(value)) assign(field + "." + key, nested, true);
      return;
    }
    const resolved = resolveLiteral(value);
    if (resolved !== OMIT) set[field] = resolved;
    else unset[field] = "";
  }

  for (const [field, value] of Object.entries(data)) {
    if (["_id", "__parentPath", "__documentId"].includes(field)) {
      throw new TypeError("O documento contém um campo reservado pelo MongoStore.");
    }
    assign(field, value, merge || containsTransform(value));
  }
  return { set, inc, unset };
}

function makeUpdateDocument(parts) {
  const update = {};
  if (Object.keys(parts.set).length) update.$set = parts.set;
  if (Object.keys(parts.inc).length) update.$inc = parts.inc;
  if (Object.keys(parts.unset).length) update.$unset = parts.unset;
  return update;
}

function mapMongoError(error) {
  if (error?.code === 11000) return new MongoStoreError("already-exists", "O documento já existe.", error);
  if (error?.code === 112 || error?.codeName === "WriteConflict") {
    return new MongoStoreError("aborted", "A operação foi interrompida por um conflito. Tente novamente.", error);
  }
  return error;
}

class DocumentSnapshot {
  constructor(ref, raw) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = Boolean(raw);
    this._data = raw ? hydrateValue(Object.fromEntries(
      Object.entries(raw).filter(([key]) => key !== "_id"),
    )) : undefined;
  }
  data() { return this.exists ? cloneValue(this._data) : undefined; }
  get(field) { return this.exists ? cloneValue(getField(this._data, field)) : undefined; }
}

class QuerySnapshot {
  constructor(docs = []) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
  forEach(callback) { this.docs.forEach(callback); }
}

class Query {
  constructor(store, pathName, filters = [], orders = [], maxResults = null, cursor = null) {
    this.store = store;
    this.pathName = pathName;
    this.parentPath = pathName.split("/").slice(0, -1).join("/");
    this.filters = filters;
    this.orders = orders;
    this.maxResults = maxResults;
    this.cursor = cursor;
  }

  where(field, operator, value) {
    const supported = new Set(["==", "!=", ">", ">=", "<", "<=", "in", "not-in", "array-contains", "array-contains-any"]);
    if (!supported.has(operator)) throw new TypeError("Operador de consulta não suportado: " + operator);
    if ((operator === "in" || operator === "not-in" || operator === "array-contains-any")
        && (!Array.isArray(value) || value.length === 0)) {
      throw new TypeError("O operador " + operator + " exige uma lista não vazia.");
    }
    return new Query(this.store, this.pathName, [...this.filters, { field, operator, value }],
      this.orders, this.maxResults, this.cursor);
  }

  orderBy(field, direction = "asc") {
    const normalized = String(direction).toLowerCase();
    if (!["asc", "desc"].includes(normalized)) throw new TypeError("A ordenação deve ser asc ou desc.");
    return new Query(this.store, this.pathName, this.filters,
      [...this.orders, { field: mongoField(field), direction: normalized }],
      this.maxResults, this.cursor);
  }

  limit(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new TypeError("O limite da consulta deve ser um inteiro positivo.");
    return new Query(this.store, this.pathName, this.filters, this.orders, number, this.cursor);
  }

  startAfter(cursor) {
    return new Query(this.store, this.pathName, this.filters, this.orders, this.maxResults, cursor);
  }

  _filter() {
    const conditions = [{ __parentPath: this.parentPath }, ...this.filters.map(({ field, operator, value }) => {
      const key = mongoField(field);
      switch (operator) {
        case "==": return { [key]: resolveLiteral(value) };
        case "!=": return { [key]: { $ne: resolveLiteral(value) } };
        case ">": return { [key]: { $gt: resolveLiteral(value) } };
        case ">=": return { [key]: { $gte: resolveLiteral(value) } };
        case "<": return { [key]: { $lt: resolveLiteral(value) } };
        case "<=": return { [key]: { $lte: resolveLiteral(value) } };
        case "in": return { [key]: { $in: resolveLiteral(value) } };
        case "not-in": return { [key]: { $nin: resolveLiteral(value), $exists: true } };
        case "array-contains": return { [key]: resolveLiteral(value) };
        case "array-contains-any": return { [key]: { $in: resolveLiteral(value) } };
        default: throw new TypeError("Operador de consulta inválido.");
      }
    })];

    if (this.cursor !== null && this.cursor !== undefined) {
      const order = this.orders[0] || { field: "__documentId", direction: "asc" };
      const field = order.field;
      const cursorValue = this.cursor instanceof DocumentSnapshot
        ? (field === "_id" || field === "__documentId" ? this.cursor.id : this.cursor.get(field))
        : this.cursor;
      conditions.push({ [field]: { [order.direction === "desc" ? "$lt" : "$gt"]: cursorValue } });
    }
    if (conditions.length === 0) return {};
    return conditions.length === 1 ? conditions[0] : { $and: conditions };
  }

  async get(options = {}) {
    const collection = await this.store._nativeCollection(this.pathName, options.session);
    const sort = {};
    for (const order of this.orders) sort[order.field] = order.direction === "desc" ? -1 : 1;
    if (!Object.keys(sort).length) sort.__documentId = 1;
    else if (!Object.hasOwn(sort, "__documentId")) sort.__documentId = 1;

    let cursor = collection.find(this._filter(), { session: options.session || undefined }).sort(sort);
    if (this.maxResults !== null) cursor = cursor.limit(this.maxResults);
    const rows = await cursor.toArray();
    return new QuerySnapshot(rows.map((row) =>
      new DocumentSnapshot(new DocumentReference(this.store, this.pathName, row.__documentId), row)
    ));
  }
}

class CollectionReference extends Query {
  constructor(store, pathName) {
    super(store, pathName);
    this.id = pathName.split("/").pop();
    this.path = pathName;
  }
  doc(id = randomUUID()) { return new DocumentReference(this.store, this.pathName, safeDocumentId(id)); }
  async add(data) {
    const reference = this.doc();
    await reference.create(data);
    return reference;
  }
}

class DocumentReference {
  constructor(store, collectionPath, id) {
    this.store = store;
    this.collectionPath = collectionPath;
    this.id = safeDocumentId(id);
    this.parentPath = collectionPath.split("/").slice(0, -1).join("/");
    this.path = collectionPath + "/" + this.id;
  }
  collection(name) { return this.store.collection(this.path + "/" + String(name)); }
  async get(options = {}) {
    const collection = await this.store._nativeCollection(this.collectionPath, options.session);
    const raw = await collection.findOne(
      { __parentPath: this.parentPath, __documentId: this.id },
      { session: options.session || undefined },
    );
    return new DocumentSnapshot(this, raw);
  }
  async create(data, options = {}) {
    const collection = await this.store._nativeCollection(this.collectionPath, options.session);
    const resolved = resolveLiteral(data);
    try {
      await collection.insertOne({
        ...resolved,
        _id: this.store._storageId(this.parentPath, this.id),
        __parentPath: this.parentPath,
        __documentId: this.id,
      }, { session: options.session || undefined });
    } catch (error) {
      throw mapMongoError(error);
    }
  }
  async set(data, options = {}) { return this.store._set(this, data, options, null); }
  async update(data) { return this.store._update(this, data, null); }
  async delete() { return this.store._delete(this, null); }
}

class MongoTransaction {
  constructor(store, session) {
    this.store = store;
    this.session = session;
    this.queue = Promise.resolve();
  }
  _schedule(operation, returnOperation = true) {
    const next = this.queue.then(operation);
    this.queue = next.catch((error) => {
      this.error ||= error;
    });
    return returnOperation ? next : this.queue;
  }
  get(reference) {
    return this._schedule(async () => {
      if (reference instanceof Query) return reference.get({ session: this.session });
      if (!(reference instanceof DocumentReference)) throw new TypeError("A transacção recebeu uma referência inválida.");
      return reference.get({ session: this.session });
    });
  }
  create(reference, data) {
    return this._schedule(() => reference.create(data, { session: this.session }), false);
  }
  set(reference, data, options = {}) {
    return this._schedule(() => this.store._set(reference, data, options, this.session), false);
  }
  update(reference, data) {
    return this._schedule(() => this.store._update(reference, data, this.session), false);
  }
  delete(reference) {
    return this._schedule(() => this.store._delete(reference, this.session), false);
  }
}

class WriteBatch {
  constructor(store) {
    this.store = store;
    this.operations = [];
    this.committed = false;
  }
  _push(type, ref, data, options) {
    if (this.committed) throw new Error("Este lote já foi confirmado.");
    if (this.operations.length >= 500) throw new RangeError("Um lote pode conter no máximo 500 operações.");
    this.operations.push({ type, ref, data, options });
    return this;
  }
  create(ref, data) { return this._push("create", ref, data); }
  set(ref, data, options = {}) { return this._push("set", ref, data, options); }
  update(ref, data) { return this._push("update", ref, data); }
  delete(ref) { return this._push("delete", ref); }
  async commit() {
    if (this.committed) throw new Error("Este lote já foi confirmado.");
    this.committed = true;
    await this.store.runTransaction(async (transaction) => {
      for (const operation of this.operations) {
        if (operation.type === "create") await transaction.create(operation.ref, operation.data);
        else if (operation.type === "set") await transaction.set(operation.ref, operation.data, operation.options);
        else if (operation.type === "update") await transaction.update(operation.ref, operation.data);
        else await transaction.delete(operation.ref);
      }
    });
    return this.operations.map(() => ({ acknowledged: true }));
  }
}

class MongoStore {
  constructor(options = {}) {
    this.uri = options.uri || process.env.MONGO_URI || process.env.MONGODB_URI || "";
    this.dbName = options.dbName || process.env.MONGO_DB_NAME || this._databaseNameFromUri() || "tico_cloud";
    this.client = options.client || null;
    this.db = options.database || null;
    this.connectPromise = null;
    this.collectionNames = new Map();
  }

  _databaseNameFromUri() {
    if (!this.uri) return null;
    try {
      const pathname = new URL(this.uri).pathname.replace(/^\/+/, "");
      return pathname ? decodeURIComponent(pathname.split("/")[0]) : null;
    } catch {
      return null;
    }
  }

  async connect() {
    if (this.db) return this.db;
    if (this.connectPromise) return this.connectPromise;
    if (!this.uri && !this.client) {
      throw new Error("MONGO_URI não está definida. Configure a mesma ligação MongoDB utilizada pelo Tico.");
    }

    this.connectPromise = (async () => {
      if (!this.client) {
        this.client = new MongoClient(this.uri, {
          appName: "tico-auxiliary-api",
          maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 30,
          minPoolSize: 0,
          serverSelectionTimeoutMS: 10_000,
          retryWrites: true,
        });
        await this.client.connect();
      }
      const database = this.client.db(this.dbName);
      const hello = await database.admin().command({ hello: 1 });
      if (!hello.setName && hello.msg !== "isdbgrid") {
        throw new Error(
          "O banco MongoDB do zeca-server precisa usar replica set ou cluster sharded para suportar transações."
        );
      }
      await database.collection(COLLECTION_MAP).createIndex({ path: 1 }, { unique: true });
      this.db = database;
      return this.db;
    })().catch((error) => {
      this.db = null;
      this.connectPromise = null;
      throw error;
    });
    return this.connectPromise;
  }

  collection(pathName) {
    const normalized = String(pathName || "").replace(/^\/+|\/+$/g, "");
    const segments = normalized.split("/");
    if (!normalized || segments.some((segment) => !segment) || segments.length % 2 !== 1) {
      throw new TypeError("O caminho da colecção é inválido.");
    }
    return new CollectionReference(this, normalized);
  }

  batch() { return new WriteBatch(this); }
  async getAll(...references) { return Promise.all(references.map((reference) => reference.get())); }

  async runTransaction(callback, options = {}) {
    await this.connect();
    const session = this.client.startSession();
    try {
      let output;
      await session.withTransaction(async () => {
        const transaction = new MongoTransaction(this, session);
        let callbackError = null;
        try {
          output = await callback(transaction);
        } catch (error) {
          callbackError = error;
        }
        await transaction.queue;
        if (callbackError) throw callbackError;
        if (transaction.error) throw transaction.error;
        return output;
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        maxCommitTimeMS: options.maxCommitTimeMS || 15_000,
      });
      return output;
    } catch (error) {
      throw mapMongoError(error);
    } finally {
      await session.endSession();
    }
  }

  _storageId(parentPath, documentId) {
    return createHash("sha256").update(parentPath + "/" + documentId).digest("hex");
  }

  _collectionTemplate(pathName) {
    return pathName.split("/").map((segment, index) => index % 2 === 1 ? "{}" : segment).join("/");
  }

  _escapeRegex(value) {
    const special = "\\^$.*+?()[]{}|";
    return [...value].map((character) =>
      special.includes(character) ? "\\" + character : character
    ).join("");
  }

  async recursiveDelete(reference) {
    if (!(reference instanceof DocumentReference)) {
      throw new TypeError("recursiveDelete espera uma referência de documento.");
    }
    const db = await this.connect();
    const prefix = reference.path + "/";
    const paths = await db.collection(COLLECTION_MAP)
      .find({ path: { $regex: "^" + this._escapeRegex(prefix) } })
      .toArray();
    const collectionNames = new Set(paths.map((entry) => entry.collectionName));
    const parentPattern = "^" + this._escapeRegex(reference.path) + "(?:/|$)";
    for (const name of collectionNames) {
      await db.collection(name).deleteMany({
        __parentPath: { $regex: parentPattern },
      });
    }
    await reference.delete();
  }

  async _nativeCollection(pathName, session) {
    const db = await this.connect();
    const template = this._collectionTemplate(pathName);
    let collectionName = this.collectionNames.get(template);
    if (!collectionName) {
      collectionName = COLLECTION_PREFIX + createHash("sha256")
        .update(template).digest("hex").slice(0, 48);
      this.collectionNames.set(template, collectionName);
    }

    const pathId = createHash("sha256").update(pathName).digest("hex");
    await db.collection(COLLECTION_MAP).updateOne(
      { _id: pathId },
      {
        $setOnInsert: {
          path: pathName,
          pathTemplate: template,
          parentPath: pathName.split("/").slice(0, -1).join("/"),
          collectionName,
        },
      },
      { upsert: true, session: session || undefined },
    );
    return db.collection(collectionName);
  }

  async _set(reference, data, options = {}, session) {
    const collection = await this._nativeCollection(reference.collectionPath, session);
    const filter = {
      __parentPath: reference.parentPath,
      __documentId: reference.id,
    };

    if (options.merge === true) {
      const parts = buildUpdateParts(data, { merge: true });
      const update = makeUpdateDocument(parts);
      update.$set = {
        ...(update.$set || {}),
        __parentPath: reference.parentPath,
        __documentId: reference.id,
      };
      update.$setOnInsert = {
        _id: this._storageId(reference.parentPath, reference.id),
      };
      await collection.updateOne(filter, update, {
        upsert: true,
        session: session || undefined,
      });
      return;
    }

    const parts = buildUpdateParts(data, { merge: false });
    await collection.replaceOne(filter, {
      ...parts.set,
      _id: this._storageId(reference.parentPath, reference.id),
      __parentPath: reference.parentPath,
      __documentId: reference.id,
    }, {
      upsert: true,
      session: session || undefined,
    });

    const update = makeUpdateDocument({
      set: {},
      inc: parts.inc,
      unset: parts.unset,
    });
    if (Object.keys(update).length) {
      await collection.updateOne(filter, update, {
        session: session || undefined,
      });
    }
  }

  async _update(reference, data, session) {
    const collection = await this._nativeCollection(reference.collectionPath, session);
    const update = makeUpdateDocument(buildUpdateParts(data, { merge: false }));
    if (!Object.keys(update).length) return;
    const result = await collection.updateOne(
      {
        __parentPath: reference.parentPath,
        __documentId: reference.id,
      },
      update,
      { session: session || undefined },
    );
    if (result.matchedCount === 0) {
      throw new MongoStoreError("not-found", "O documento que seria actualizado não existe.");
    }
  }

  async _delete(reference, session) {
    const collection = await this._nativeCollection(reference.collectionPath, session);
    await collection.deleteOne(
      {
        __parentPath: reference.parentPath,
        __documentId: reference.id,
      },
      { session: session || undefined },
    );
  }

  async close() {
    if (this.client) await this.client.close();
    this.client = null;
    this.db = null;
    this.connectPromise = null;
    this.collectionNames.clear();
  }
}

let defaultStore;
function getDatabase() {
  if (!defaultStore) defaultStore = new MongoStore();
  return defaultStore;
}
async function connectDatabase() {
  return getDatabase().connect();
}
async function closeDatabase() {
  if (defaultStore) await defaultStore.close();
}

module.exports = {
  FieldPath,
  FieldValue,
  Timestamp: MongoTimestamp,
  MongoStore,
  MongoStoreError,
  getDatabase,
  connectDatabase,
  closeDatabase,
};
