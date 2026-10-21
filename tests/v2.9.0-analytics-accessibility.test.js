const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const officerUi = fs.readFileSync(path.join(root, 'public/officer.js'), 'utf8');
const officerHtml = fs.readFileSync(path.join(root, 'public/officer.html'), 'utf8');
const route = fs.readFileSync(path.join(root, 'src/routes/officer.js'), 'utf8');
const sharedA11y = fs.readFileSync(path.join(root, 'public/accessibility.js'), 'utf8');

test('Admin analytics is rendered only for Admin and summarizes case data', () => {
  assert.match(officerHtml, /data-view="analytics" id="navAnalytics" hidden/);
  assert.match(officerUi, /currentView==='analytics'&&officerProfile\?\.role==='admin'/);
  assert.match(officerUi, /function renderAdminAnalytics\(/);
  assert.match(officerUi, /Tren pembuatan kasus/);
  assert.match(officerUi, /Kasus berdasarkan status/);
});

test('Accessibility preferences provide language, text scaling, and contrast controls', () => {
  assert.match(officerHtml, /id="languageSelect"/);
  assert.match(officerHtml, /id="fontLarger"/);
  assert.match(officerHtml, /id="contrastToggle"/);
  assert.match(sharedA11y, /docura-language/);
  assert.match(sharedA11y, /docura-font-scale/);
  assert.match(sharedA11y, /docura-high-contrast/);
});

test('Print flow uses local WebAuthn and no longer exposes KTP-el match/mismatch scenarios', () => {
  assert.match(route, /print-local-verification/);
  assert.doesNotMatch(route, /router\.post\('\/cases\/:caseId\/biometric-demo'/);
  assert.doesNotMatch(officerUi, /biometricDemoScenario/);
  assert.match(officerUi, /print-local-verification/);
});
