const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const officer = fs.readFileSync(path.join(root, 'src/routes/officer.js'), 'utf8');
const audit = fs.readFileSync(path.join(root, 'src/services/audit-log.js'), 'utf8');
const migrationPath = path.join(root, 'database/migrations-v2.5.1-audit-trail.sql');
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : fs.readFileSync(path.join(root, 'database/install-all.sql'), 'utf8');
const install = fs.readFileSync(path.join(root, 'database/install-all.sql'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('V2.9.0 version metadata is consistent', () => {
  assert.equal(pkg.version, '2.9.0');
  assert.match(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'), /"version": "2\.9\.0"/);
});

test('audit writes use an event allowlist and only minimal metadata', () => {
  assert.match(audit, /ALLOWED_EVENTS/);
  assert.match(audit, /createServiceClient\(\)/);
  assert.match(audit, /actor_role:/);
  assert.match(audit, /request_id:/);
  assert.match(audit, /safeDetails/);
  assert.doesNotMatch(audit, /req\.body/);
  assert.doesNotMatch(audit, /req\.ip/);
  assert.doesNotMatch(audit, /signedUrl/);
});

test('audit viewer requires admin and omits the details JSON', () => {
  assert.match(officer, /router\.get\('\/audit-logs'/);
  assert.match(officer, /result\.roleRow\.role_code !== 'admin'/);
  assert.match(officer, /select\('id,actor_id,actor_role,event_type,target_type,target_id,request_id,outcome,created_at'/);
  assert.doesNotMatch(officer, /select\('id,actor_id,actor_role,event_type,target_type,target_id,request_id,outcome,created_at,details'/);
  assert.match(officer, /Math\.min\(100, Math\.max\(1, limitRaw\)\)/);
});

test('sensitive staff access paths emit audit events', () => {
  for (const event of [
    'admin-citizen-directory-viewed', 'citizen-search-performed', 'officer-case-list-viewed',
    'recovery-document-titles-viewed', 'recovery-print-links-created', 'officer-qr-rendered',
    'audit-log-viewed', 'case-print-batch-completed-api'
  ]) assert.ok(officer.includes(`'${event}'`), `missing event ${event}`);
});

test('audit migration adds indexes and protects rows from mutation', () => {
  assert.match(migration, /add column if not exists request_id text/);
  assert.match(migration, /create index if not exists refugeeledger_audit_logs_created_at_idx/);
  assert.match(migration, /revoke all on public\.refugeeledger_audit_logs from anon, authenticated/);
  assert.match(migration, /before update or delete on public\.refugeeledger_audit_logs/);
  assert.match(migration, /Audit records are append-only/);
});

test('fresh-install SQL includes V2.5.1 migration', () => {
  assert.match(install, /Docura V2\.5\.1 — Audit Trail & Security Monitoring/);
  assert.match(install, /docura_audit_logs_append_only/);
});
