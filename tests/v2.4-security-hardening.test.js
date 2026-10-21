const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/routes/officer.js'), 'utf8');
const supabaseConfig = fs.readFileSync(path.join(root, 'src/config/supabase.js'), 'utf8');
const migrationPath = path.join(root, 'database/migrations-v2.4-recovery-print-batch.sql');
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : fs.readFileSync(path.join(root, 'database/install-all.sql'), 'utf8');
const install = fs.readFileSync(path.join(root, 'database/install-all.sql'), 'utf8');
const publicDir = path.join(root, 'public');

function allPublicSource() {
  return fs.readdirSync(publicDir).filter(name => /\.(js|html|css)$/.test(name))
    .map(name => fs.readFileSync(path.join(publicDir, name), 'utf8')).join('\n');
}

test('print endpoints restrict operations by role and emergency assignment', () => {
  assert.match(route, /function canOperatePrint\(role, emergencyMode\)/);
  assert.match(route, /role === 'admin' \|\| role === 'document_printer'/);
  assert.match(route, /caseRow\.assigned_to !== result\.user\.id/);
  assert.match(migration, /v_role in \('admin','document_printer'\)/);
  assert.match(migration, /v_case\.assigned_to <> v_user_id and v_role <> 'admin'/);
});

test('document title endpoint does not select file contents or storage secrets', () => {
  assert.match(route, /\.select\('id,title,created_at'\)/);
  assert.match(route, /map\(d => \(\{ id: d\.id, title: d\.title \}\)\)/);
  assert.doesNotMatch(route, /\.select\([^\n]*(file_content|document_content|original_filename)[^\n]*\)/i);
});

test('signed document URLs are temporary and only for active documents owned by linked citizen', () => {
  assert.match(route, /\.eq\('owner_id', allowed\.caseRow\.citizen_user_id\)\.eq\('status', 'ACTIVE'\)/);
  assert.match(route, /createSignedUrl\(doc\.storage_path, 120/);
  assert.match(route, /docs\.length !== ids\.length/);
});

test('service role key is server-only and absent from browser source', () => {
  assert.match(supabaseConfig, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(supabaseConfig, /function createServiceClient\(\)/);
  assert.doesNotMatch(allPublicSource(), /SUPABASE_SERVICE_ROLE_KEY/);
});

test('database completion is atomic, audited, and blocks legacy completion without a batch', () => {
  assert.match(migration, /before update of status on public\.refugeeledger_recovery_cases/);
  assert.match(migration, /b\.actor_id = new\.updated_by/);
  assert.match(migration, /b\.printed_at >= now\(\) - interval '10 minutes'/);
  assert.match(migration, /insert into public\.docura_case_print_batches/);
  assert.match(migration, /insert into public\.refugeeledger_audit_logs/);
  assert.match(install, /create or replace function public\.officer_case_complete_print_batch/);
});
