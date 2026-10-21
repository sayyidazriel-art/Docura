const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/routes/officer.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/officer.js'), 'utf8');
const access = fs.readFileSync(path.join(root, 'src/services/citizen-access.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'database/install-all.sql'), 'utf8');

test('recovery receipt is only issued for completed, RLS-visible cases', () => {
  assert.match(route, /router\.get\('\/cases\/:caseId\/receipt'/);
  assert.match(route, /caseRow\.status !== 'COMPLETED'/);
  assert.match(route, /result\.auth\.from\('refugeeledger_recovery_cases'\)/);
  assert.match(route, /docura_case_print_batches/);
  assert.match(route, /recovery-receipt-viewed/);
});

test('receipt UI offers print or Save as PDF and disclaims official-document status', () => {
  assert.match(ui, /data-recovery-receipt/);
  assert.match(ui, /Cetak \/ Simpan sebagai PDF/);
  assert.match(ui, /bukan pengganti KTP/);
  assert.match(ui, /simulasi/);
});

test('combined Representative role is excluded from supported role checks and citizen search', () => {
  assert.doesNotMatch(access, /representative/);
  assert.match(migration, /delete from public\.refugeeledger_user_roles where role_code = 'representative'/);
  assert.match(migration, /check \(role_code in \('citizen','admin','recovery_officer','document_printer','supervisor'\)\)/);
});
