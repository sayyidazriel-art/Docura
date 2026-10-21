// Short-lived, one-time continuation proof state for local demo verification. Not biometric data.
const crypto = require('crypto');
const proofs = new Map();
const TTL_MS = 2 * 60 * 1000;
function issueDemoProof({ userId, caseId }) {
  const token = crypto.randomBytes(32).toString('base64url');
  proofs.set(token, { userId, caseId, expiresAt: Date.now() + TTL_MS });
  return token;
}
function consumeDemoProof({ token, userId, caseId }) {
  const row = proofs.get(String(token || ''));
  proofs.delete(String(token || ''));
  return Boolean(row && row.userId === userId && row.caseId === caseId && row.expiresAt >= Date.now());
}
module.exports = { issueDemoProof, consumeDemoProof, TTL_MS };
