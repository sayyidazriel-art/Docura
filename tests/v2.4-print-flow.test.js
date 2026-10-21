const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const officerUi = fs.readFileSync(path.join(root, 'public/officer.js'), 'utf8');
const citizenUi = fs.readFileSync(path.join(root, 'public/citizen.html'), 'utf8');
const officerHtml = fs.readFileSync(path.join(root, 'public/officer.html'), 'utf8');
const officerRoute = fs.readFileSync(path.join(root, 'src/routes/officer.js'), 'utf8');
const migrationPath = path.join(root, 'database/migrations-v2.4-recovery-print-batch.sql');
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : fs.readFileSync(path.join(root, 'database/install-all.sql'), 'utf8');

test('citizen dashboard does not duplicate passkey management panel', () => {
  assert.equal(citizenUi.includes('class="passkey-panel"'), false);
  assert.equal(citizenUi.includes('id="settingsPasskeyForm"'), true);
});

test('officer dashboard presents fingerprint as demo and not face scanning', () => {
  assert.match(officerUi, /Simulasi pemindaian sidik jari/);
  assert.match(officerUi, /bukan verifikasi identitas nyata/);
  assert.doesNotMatch(officerUi, /Simulasi pemindaian wajah/);
  assert.doesNotMatch(officerHtml, /Pemindaian wajah/);
  assert.match(officerUi, /id=\"printQrButton\"/);
});

test('recovery document list exposes titles and selected print links through protected endpoints', () => {
  assert.match(officerRoute, /\/cases\/:caseId\/recovery-documents/);
  assert.match(officerRoute, /\/cases\/:caseId\/print-documents/);
  assert.match(officerRoute, /\.select\('id,title,created_at'\)/);
  assert.match(officerRoute, /createSignedUrl\(doc\.storage_path, 120/);
});

test('completion requires selected document batch and server-side completion guard', () => {
  assert.match(officerRoute, /\/cases\/:caseId\/complete-print-batch/);
  assert.match(officerRoute, /officer_case_complete_print_batch/);
  assert.match(migration, /docura_guard_case_completion/);
  assert.match(migration, /document_ids uuid\[\]/);
  assert.match(migration, /status='COMPLETED'/);
  assert.match(migration, /owner_id = v_case\.citizen_user_id and d\.status = 'ACTIVE'/);
});
