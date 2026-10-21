const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/routes/officer.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/officer.js'), 'utf8');
const service = require('../src/services/biometric-demo-state');

test('V2.9.0 removes synthetic KTP-el matching UI and keeps local WebAuthn verification', () => {
  assert.match(route, /router\.post\('\/cases\/:caseId\/print-local-verification'/);
  assert.doesNotMatch(route, /router\.post\('\/cases\/:caseId\/biometric-demo'/);
  assert.doesNotMatch(ui, /Hasil penyedia referensi KTP-el sintetis/);
  assert.doesNotMatch(ui, /biometricDemoScenario/);
  assert.match(ui, /print-local-verification/);
  assert.match(ui, /Ikuti permintaan verifikasi yang muncul pada perangkat atau browser Anda/);
});

test('print completion requires a one-time proof bound to staff and case', () => {
  assert.match(route, /consumeDemoProof\(\{ token: req\.body\?\.biometricVerificationToken, userId: result\.user\.id, caseId: allowed\.caseRow\.id \}\)/);
  assert.match(route, /biometric-demo-proof-rejected/);
  const token = service.issueDemoProof({ userId: 'staff-1', caseId: 'case-1' });
  assert.equal(service.consumeDemoProof({ token, userId: 'staff-2', caseId: 'case-1' }), false);
  const token2 = service.issueDemoProof({ userId: 'staff-1', caseId: 'case-1' });
  assert.equal(service.consumeDemoProof({ token: token2, userId: 'staff-1', caseId: 'case-2' }), false);
  const token3 = service.issueDemoProof({ userId: 'staff-1', caseId: 'case-1' });
  assert.equal(service.consumeDemoProof({ token: token3, userId: 'staff-1', caseId: 'case-1' }), true);
  assert.equal(service.consumeDemoProof({ token: token3, userId: 'staff-1', caseId: 'case-1' }), false);
});

test('operator UI clearly labels local WebAuthn and does not claim government biometric matching', () => {
  assert.match(ui, /tidak membaca sidik jari/);
  assert.match(ui, /biometricVerificationToken/);
  assert.match(ui, /print-local-verification/);
  assert.doesNotMatch(ui, /biometricDemoScenario/);
});


test('V2.6.1 adds officer WebAuthn enrollment and server-verified assertion routes', () => {
  assert.match(route, /router\.get\('\/webauthn\/status'/);
  assert.match(route, /router\.post\('\/webauthn\/registration\/options'/);
  assert.match(route, /router\.post\('\/webauthn\/registration\/verify'/);
  assert.match(route, /router\.post\('\/webauthn\/authentication\/options'/);
  assert.match(route, /router\.post\('\/webauthn\/authentication\/verify'/);
  assert.match(route, /verifyAuthenticationResponse\(response, challenge, credential\)/);
  assert.match(route, /officer-webauthn-verified/);
  assert.match(route, /print-webauthn-proof-rejected/);
});

test('case recording and print flow require local WebAuthn before proceeding', () => {
  assert.match(route, /if \(action === 'face-scan'\)[\s\S]*?consumeDemoProof\(\{ token: payload\.biometricVerificationToken/);
  assert.match(route, /webauthnVerificationToken, userId: result\.user\.id, caseId: allowed\.caseRow\.id/);
  assert.match(ui, /navigator\.credentials\.get/);
  assert.match(ui, /navigator\.credentials\.create/);
  assert.match(ui, /Verifikasi perangkat & lanjutkan/);
  assert.match(ui, /tidak menerima gambar atau template sidik jari/);
});


test('officer WebAuthn ceremonies are rate limited', () => {
  assert.match(route, /const officerWebAuthnRateLimit = rateLimit/);
  assert.match(route, /registration\/options', officerWebAuthnRateLimit/);
  assert.match(route, /registration\/verify', officerWebAuthnRateLimit/);
  assert.match(route, /authentication\/options', officerWebAuthnRateLimit/);
  assert.match(route, /authentication\/verify', officerWebAuthnRateLimit/);
});
