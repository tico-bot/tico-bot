"use strict";

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const STATUS = {
  "invalid-argument": 400,
  "failed-precondition": 400,
  unauthenticated: 401,
  "permission-denied": 403,
  "not-found": 404,
  "already-exists": 409,
  "resource-exhausted": 429,
  internal: 500,
};

function onCall(handler) {
  return handler;
}

module.exports = { HttpsError, onCall, STATUS };