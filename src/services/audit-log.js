const { createServiceClient } = require('../config/supabase');

// Audit metadata is intentionally allowlisted. Never pass request bodies, tokens,
// document contents, signed URLs, email addresses, or raw IP addresses here.
const ALLOWED_EVENTS = new Set([
  'officer-case-list-viewed',
  'admin-staff-account-created',
  'admin-citizen-directory-viewed',
  'citizen-search-performed',
  'recovery-document-titles-viewed',
  'recovery-print-links-created',
  'officer-qr-rendered',
  'audit-log-viewed',
  'case-print-batch-completed-api',
  'biometric-demo-proof-rejected',
  'officer-webauthn-registered',
  'officer-webauthn-verified',
  'officer-webauthn-proof-rejected',
  'print-webauthn-proof-rejected',
  'print-local-webauthn-verified',
]);

async function recordAuditEvent(req, actor, eventType, targetType = null, targetId = null, details = {}) {
  if (!ALLOWED_EVENTS.has(eventType)) return false;
  try {
    const service = createServiceClient();
    const safeDetails = {};
    if (Number.isInteger(details.count) && details.count >= 0) safeDetails.count = details.count;
    if (typeof details.queryLength === 'number' && details.queryLength >= 0) safeDetails.queryLength = Math.min(details.queryLength, 200);
    if (typeof details.outcome === 'string' && ['success', 'denied', 'failure', 'match', 'mismatch', 'unavailable', 'missing-expired-replayed-or-mismatched'].includes(details.outcome)) safeDetails.outcome = details.outcome;
    const { error } = await service.from('refugeeledger_audit_logs').insert({
      actor_id: actor?.id || null,
      actor_role: actor?.roleRow?.role_code || null,
      request_id: req?.requestId || null,
      event_type: eventType,
      target_type: targetType,
      target_id: targetId == null ? null : String(targetId).slice(0, 200),
      outcome: safeDetails.outcome || 'success',
      details: safeDetails,
    });
    if (error) {
      // Do not log provider messages or event metadata that may expose sensitive context.
      console.error('Audit event write failed; check audit migration and server credentials.');
      return false;
    }
    return true;
  } catch (_error) {
    console.error('Audit event write failed; check audit migration and server credentials.');
    return false;
  }
}

module.exports = { recordAuditEvent, ALLOWED_EVENTS };
