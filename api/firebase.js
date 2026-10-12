const INVALID_ID_TOKEN_CODES = new Set([
  "auth/argument-error",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/invalid-id-token",
  "auth/user-disabled",
]);

async function verifyIdToken(idToken) {
  const { cert, getApps, initializeApp } = require("firebase-admin/app");
  const { getAuth } = require("firebase-admin/auth");

  const app =
    getApps().find((registeredApp) => registeredApp.name === "[DEFAULT]") ||
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });

  return getAuth(app).verifyIdToken(idToken, true);
}

function isInvalidIdTokenError(error) {
  return Boolean(error && INVALID_ID_TOKEN_CODES.has(error.code));
}

module.exports = { isInvalidIdTokenError, verifyIdToken };
