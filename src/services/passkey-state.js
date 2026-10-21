// Short-lived WebAuthn challenges and action proofs. Challenges are persisted in
// Supabase by the route; only action proofs stay in memory and expire quickly.
const crypto = require('crypto');
const actionProofs = new Map();
const ACTION_PROOF_TTL_MS = 2 * 60 * 1000;

function issueActionProof(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  actionProofs.set(token, { userId, expiresAt: Date.now() + ACTION_PROOF_TTL_MS });
  return token;
}
function consumeActionProof(userId, token) {
  if (!token) return false;
  const proof = actionProofs.get(token);
  actionProofs.delete(token);
  return Boolean(proof && proof.userId === userId && proof.expiresAt >= Date.now());
}
module.exports = { issueActionProof, consumeActionProof, ACTION_PROOF_TTL_MS };
