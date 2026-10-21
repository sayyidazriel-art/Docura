'use strict';

const CASE_CREATION_ROLES = new Set(['admin', 'recovery_officer']);

function canSearchCitizensForCase(role, emergencyMode) {
  return CASE_CREATION_ROLES.has(String(role || '')) || Boolean(emergencyMode);
}

function normalizeCitizenSearchQuery(value) {
  return String(value || '').trim().replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { canSearchCitizensForCase, normalizeCitizenSearchQuery };
