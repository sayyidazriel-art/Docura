'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canSearchCitizensForCase, normalizeCitizenSearchQuery } = require('../src/services/citizen-access');

test('admin can search registered citizens in Normal Mode', () => {
  assert.equal(canSearchCitizensForCase('admin', false), true);
});

test('recovery officer can search registered citizens in Normal Mode', () => {
  assert.equal(canSearchCitizensForCase('recovery_officer', false), true);
});

test('other staff cannot search for case creation in Normal Mode', () => {
  assert.equal(canSearchCitizensForCase('supervisor', false), false);
  assert.equal(canSearchCitizensForCase('document_printer', false), false);
  assert.equal(canSearchCitizensForCase('citizen', false), false);
});

test('Emergency Mode allows operational staff search, consistent with V1 emergency policy', () => {
  assert.equal(canSearchCitizensForCase('supervisor', true), true);
  assert.equal(canSearchCitizensForCase('document_printer', true), true);
});

test('citizen search query is trimmed and removes PostgREST filter delimiters', () => {
  assert.equal(normalizeCitizenSearchQuery('  DOC-AB12%,(x)  '), 'DOC-AB12 x');
  assert.equal(normalizeCitizenSearchQuery(null), '');
});
