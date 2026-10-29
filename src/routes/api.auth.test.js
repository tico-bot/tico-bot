'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'auth-api-test-secret-with-sufficient-length-2026';
process.env.ADMIN_KEY = 'admin-test-key-never-use-in-prod';
process.env.CONTAS_KEY = 'accounts-test-key-never-use-in-prod';
process.env.OTP_SECRET = 'otp-test-secret-with-sufficient-length';

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');
const LidMapping = require('../models/LidMapping');
const OtpCadastro = require('../models/OtpCadastro');
const { hashOtpCode } = require('../utils/otp');
const apiRouter = require('./api');

const loginJid = '5511999999999@s.whatsapp.net';
const signupJid = '5511888777666@s.whatsapp.net';
const legacyLidJid = '1234567890@lid';
let activeLidMapping = null;
const loginPassword = 'correct-horse-battery-9';
const loginUser = {
  idWhatsApp: loginJid,
  username: 'demo_user',
  email: 'demo@example.com',
  telefone: '5511999999999',
  passwordHash: bcrypt.hashSync(loginPassword, 4),
  tokenVersion: 0,
};
const signupUserOriginal = {
  idWhatsApp: signupJid,
  nome: 'Novo membro',
  telefone: '5511888777666',
  tokenVersion: 0,
};
let users;
let otpRecord;
let server;
let baseUrl;
let listAccountQueries = 0;

const originals = {
  usuarioFindOne: Usuario.findOne,
  usuarioFindOneAndUpdate: Usuario.findOneAndUpdate,
  usuarioExists: Usuario.exists,
  usuarioFind: Usuario.find,
  lidFindOne: LidMapping.findOne,
  otpFindOneAndUpdate: OtpCadastro.findOneAndUpdate,
  otpUpdateOne: OtpCadastro.updateOne,
};

function findUser(query) {
  for (const user of users.values()) {
    if (query?.$or) {
      if (query.$or.some(condition => {
        if (condition.username) return user.username === condition.username;
        if (condition.email) return user.email === condition.email;
        if (condition.telefone?.$in) return condition.telefone.$in.includes(user.telefone);
        if (condition.idWhatsApp?.$in) return condition.idWhatsApp.$in.includes(user.idWhatsApp);
        return false;
      })) return user;
      continue;
    }
    const idQuery = query?.idWhatsApp;
    if (typeof idQuery === 'string' && idQuery === user.idWhatsApp) return user;
    if (Array.isArray(idQuery?.$in) && idQuery.$in.includes(user.idWhatsApp)) return user;
  }
  return null;
}

Usuario.findOne = query => ({
  select() { return this; },
  async lean() { const user = findUser(query); return user ? { ...user } : null; },
});
Usuario.exists = async query => {
  const field = Object.keys(query || {})[0];
  return [...users.values()].some(user => field && query[field] === user[field]) ? { _id: 'existing' } : null;
};
Usuario.findOneAndUpdate = (filter, update) => {
  const id = filter?.idWhatsApp;
  let result = null;
  if (typeof id === 'string' && users.has(id)) {
    const current = users.get(id);
    // The registration route's atomic guard requires no existing username/password.
    const hasAccount = !!(current.username && current.passwordHash);
    const isRegistration = !!(update.$set?.username && update.$set?.passwordHash);
    if (!isRegistration || !hasAccount) {
      Object.assign(current, update.$set || {});
      if (update.$inc?.tokenVersion) current.tokenVersion = (current.tokenVersion || 0) + update.$inc.tokenVersion;
      users.set(id, current);
      result = { ...current };
    }
  }
  return {
    select() { return this; },
    async lean() { return result; },
  };
};
Usuario.find = query => {
  if (query?.username?.$exists) listAccountQueries++;
  return {
    select() { return this; },
    sort() { return this; },
    async lean() {
      let result = [...users.values()];
      if (Array.isArray(query?.idWhatsApp?.$in)) {
        result = result.filter(user => query.idWhatsApp.$in.includes(user.idWhatsApp));
      }
      if (query?.username?.$exists) result = result.filter(user => user.username);
      return result.map(user => ({ ...user, createdAt: new Date('2026-01-01T00:00:00Z') }));
    },
  };
};
LidMapping.findOne = query => ({
  select() { return this; },
  async lean() {
    if (!activeLidMapping) return null;
    const pns = query?.pn?.$in;
    if (Array.isArray(pns) && pns.includes(activeLidMapping.pn)) return { ...activeLidMapping };
    if (query?.lid === activeLidMapping.lid) return { ...activeLidMapping };
    return null;
  },
});
OtpCadastro.findOneAndUpdate = async (filter, update) => {
  if (!otpRecord || otpRecord.usado || otpRecord.expiresAt <= new Date()
      || otpRecord.tentativas >= 5 || filter.idWhatsApp !== otpRecord.idWhatsApp) return null;
  if (filter.finalidade && filter.finalidade !== otpRecord.finalidade) return null;
  if (filter.codigo && filter.codigo !== otpRecord.codigo) return null;
  if (update.$inc?.tentativas) otpRecord.tentativas += update.$inc.tentativas;
  if (update.$set?.usado === true) otpRecord.usado = true;
  return { ...otpRecord };
};
OtpCadastro.updateOne = async (filter, update) => {
  if (otpRecord && filter._id === otpRecord._id && update.$set?.usado === true) otpRecord.usado = true;
  return { modifiedCount: 1 };
};

function resetOtp(code = '123456', finalidade = 'cadastro') {
  otpRecord = {
    _id: 'otp-signup-1',
    idWhatsApp: signupJid,
    finalidade,
    codigo: hashOtpCode(code),
    usado: false,
    tentativas: 0,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    updatedAt: new Date(),
  };
}

test.before(async () => {
  users = new Map([
    [loginJid, { ...loginUser }],
    [signupJid, { ...signupUserOriginal }],
  ]);
  resetOtp();
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(async () => {
  Usuario.findOne = originals.usuarioFindOne;
  Usuario.findOneAndUpdate = originals.usuarioFindOneAndUpdate;
  Usuario.exists = originals.usuarioExists;
  Usuario.find = originals.usuarioFind;
  LidMapping.findOne = originals.lidFindOne;
  OtpCadastro.findOneAndUpdate = originals.otpFindOneAndUpdate;
  OtpCadastro.updateOne = originals.otpUpdateOne;
  if (server) await new Promise(resolve => server.close(resolve));
});

async function post(path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('login accepts the identifier field sent by the page and username, email, and phone', async () => {
  for (const identifier of ['demo_user', 'demo@example.com', '+55 11 99999-9999']) {
    const response = await post('/auth/login', { identifier, password: loginPassword });
    assert.equal(response.status, 200, `login should accept ${identifier}`);
    const data = await response.json();
    assert.equal(typeof data.jwt, 'string');
    const claims = jwt.verify(data.jwt, process.env.JWT_SECRET);
    assert.equal(claims.idWhatsApp, loginJid);
    assert.equal(claims.exp - claims.iat, 24 * 60 * 60);
  }
});

test('login rejects wrong credentials with the same generic response', async () => {
  const wrongPassword = await post('/auth/login', { identifier: 'demo_user', password: 'incorrect-password' });
  assert.equal(wrongPassword.status, 401);
  const wrongUser = await post('/auth/login', { identifier: 'no-such-user', password: 'incorrect-password' });
  assert.equal(wrongUser.status, 401);
  assert.deepEqual(await wrongUser.json(), { error: 'Email, telefone, nome de usuário ou senha incorretos.' });
});

test('login rate-limits repeated failures for the same identifier across requests', async () => {
  const identifier = 'identifier-limit-test-user';
  for (let i = 0; i < 10; i++) {
    const response = await post('/auth/login', { identifier, password: 'wrong-password-here' });
    assert.equal(response.status, 401, `failed attempt ${i + 1} should be evaluated normally`);
  }
  const limited = await post('/auth/login', { identifier, password: 'wrong-password-here' });
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /identificação/);
});

test('signup requires a six-digit OTP and enforces stronger passwords on the server', async () => {
  const base = { idWhatsApp: signupJid, email: 'new-member@example.com', username: 'new_member', password: 'strong-password-123' };
  const noOtp = await post('/auth/cadastrar', base);
  assert.equal(noOtp.status, 400);
  const shortPassword = await post('/auth/cadastrar', { ...base, password: 'short7', codigo: '123456' });
  assert.equal(shortPassword.status, 400);
  const over72Bytes = await post('/auth/cadastrar', { ...base, password: '😀'.repeat(19), codigo: '123456' });
  assert.equal(over72Bytes.status, 400, 'UTF-8 byte length must be capped before bcrypt truncates it');
  assert.equal(otpRecord.usado, false, 'invalid registration fields must not consume the OTP');
});

test('a recovery OTP cannot be reused to register an account', async () => {
  resetOtp('123456', 'recuperacao');
  const response = await post('/auth/cadastrar', {
    idWhatsApp: signupJid, email: 'new-member@example.com', username: 'new_member',
    password: 'strong-password-123', codigo: '123456',
  });
  assert.equal(response.status, 400);
  assert.equal(otpRecord.usado, false);
  assert.equal(otpRecord.tentativas, 0);
});

test('signup consumes a correct OTP once, hashes the password, and creates the account', async () => {
  resetOtp('123456');
  const response = await post('/auth/cadastrar', {
    idWhatsApp: signupJid,
    email: 'new-member@example.com',
    username: 'new_member',
    password: 'strong-password-123',
    codigo: '123456',
  });
  assert.equal(response.status, 200);
  assert.equal(otpRecord.usado, true);
  const created = users.get(signupJid);
  assert.equal(created.username, 'new_member');
  assert.equal(created.email, 'new-member@example.com');
  assert.notEqual(created.passwordHash, 'strong-password-123');
  assert.equal(await bcrypt.compare('strong-password-123', created.passwordHash), true);
});

test('a registration OTP cannot reset an existing account password', async () => {
  resetOtp('654321', 'cadastro');
  otpRecord.idWhatsApp = loginJid;
  const response = await post('/auth/recuperar', {
    idWhatsApp: loginJid, codigo: '654321', novaSenha: 'updated-password-987',
  });
  assert.equal(response.status, 400);
  assert.equal(otpRecord.usado, false);
  assert.equal(otpRecord.tentativas, 0);
  assert.equal(users.get(loginJid).tokenVersion, 0);
});

test('recovery uses a recovery-purpose OTP and invalidates previous user sessions', async () => {
  resetOtp('654321', 'recuperacao');
  otpRecord.idWhatsApp = loginJid;
  const oldSession = jwt.sign({ idWhatsApp: loginJid, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1m' });
  const response = await post('/auth/recuperar', {
    idWhatsApp: loginJid,
    codigo: '654321',
    novaSenha: 'updated-password-987',
  });
  assert.equal(response.status, 200);
  assert.equal(otpRecord.usado, true);
  assert.equal(users.get(loginJid).tokenVersion, 1);
  assert.equal(await bcrypt.compare('updated-password-987', users.get(loginJid).passwordHash), true);
  const stale = await fetch(`${baseUrl}/user/me`, { headers: { Authorization: `Bearer ${oldSession}` } });
  assert.equal(stale.status, 401, 'password recovery must invalidate existing user sessions');
});

test('phone lookup prefers an existing LID account over a blank duplicate PN profile', async () => {
  const previousUsers = new Map(users);
  try {
    const lidAccount = {
      ...loginUser,
      idWhatsApp: legacyLidJid,
      username: 'legacy_lid_user',
      passwordHash: bcrypt.hashSync('legacy-password-123', 4),
      tokenVersion: 0,
    };
    const blankPn = {
      ...loginUser,
      idWhatsApp: loginJid,
      username: undefined,
      passwordHash: null,
      tokenVersion: 0,
    };
    users = new Map([[loginJid, blankPn], [legacyLidJid, lidAccount]]);
    activeLidMapping = { lid: legacyLidJid, pn: loginJid };
    resetOtp('654321', 'recuperacao');
    otpRecord.idWhatsApp = legacyLidJid;

    const response = await post('/auth/recuperar', {
      idWhatsApp: loginJid,
      codigo: '654321',
      novaSenha: 'legacy-updated-password-123',
    });
    assert.equal(response.status, 200);
    assert.equal(users.get(legacyLidJid).tokenVersion, 1);
    assert.equal(await bcrypt.compare('legacy-updated-password-123', users.get(legacyLidJid).passwordHash), true);
    assert.equal(users.get(loginJid).username, undefined, 'must not create or modify an unrelated blank PN profile');
    assert.equal(users.get(loginJid).passwordHash, null);
  } finally {
    users = previousUsers;
    activeLidMapping = null;
  }
});

test('admin session is JWT-based and the private accounts endpoint requires a separate scoped token', async () => {
  const masterKey = process.env.ADMIN_KEY;
  const login = await post('/admin/login', { key: masterKey });
  assert.equal(login.status, 200);
  const { token: adminToken, expiresIn } = await login.json();
  assert.equal(expiresIn, 3600);
  const claims = jwt.verify(adminToken, process.env.JWT_SECRET);
  assert.equal(claims.tokenType, 'admin-session');

  const verified = await fetch(`${baseUrl}/admin/verify`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(verified.status, 200);
  const noLegacyKey = await fetch(`${baseUrl}/admin/verify`, { headers: { 'x-admin-key': masterKey } });
  assert.equal(noLegacyKey.status, 401, 'master key must not authorize every admin API call directly');

  listAccountQueries = 0;
  const noScope = await fetch(`${baseUrl}/admin/contas`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(noScope.status, 401);
  assert.equal(listAccountQueries, 0, 'the accounts query must not run without its second factor');

  const secondFactor = await fetch(`${baseUrl}/admin/verify-contas`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'x-contas-key': process.env.CONTAS_KEY },
  });
  assert.equal(secondFactor.status, 200);
  const scoped = await secondFactor.json();
  assert.equal(scoped.expiresIn, 900);

  const withScope = await fetch(`${baseUrl}/admin/contas`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'x-contas-token': scoped.token },
  });
  assert.equal(withScope.status, 200);
  assert.ok(Array.isArray((await withScope.json()).contas));
  assert.equal(listAccountQueries, 1);

  const secondLogin = await post('/admin/login', { key: masterKey });
  const { token: otherAdminToken } = await secondLogin.json();
  const crossSession = await fetch(`${baseUrl}/admin/contas`, {
    headers: { Authorization: `Bearer ${otherAdminToken}`, 'x-contas-token': scoped.token },
  });
  assert.equal(crossSession.status, 401, 'accounts token must be bound to the admin session that issued it');
});
