const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const auth = fs.readFileSync(path.join(root, 'src/routes/auth.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const limiter = fs.readFileSync(path.join(root, 'src/middleware/rate-limit.js'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

test('sensitive auth endpoints are rate limited', () => {
  assert.match(auth, /rateLimit\(\{ windowMs: 15 \* 60 \* 1000, max: 10 \}\)/);
  assert.match(auth, /router\.use\(\['\/register', '\/login', '\/resend-activation', '\/forgot-password'\], authRateLimit\)/);
  assert.match(limiter, /Retry-After/);
  assert.match(limiter, /status\(429\)/);
});

test('auth redirects use configured canonical origin, not request Host', () => {
  assert.match(auth, /function publicAppUrl\(\)/);
  assert.match(auth, /process\.env\.PUBLIC_APP_URL \|\| process\.env\.APP_ORIGIN/);
  assert.doesNotMatch(auth, /req\.get\(["']host["']\)/);
  assert.doesNotMatch(auth, /req\.protocol\}?:\/\//);
  assert.match(envExample, /PUBLIC_APP_URL=http:\/\/localhost:3000/);
});

test('provider error fallback does not expose arbitrary raw messages', () => {
  assert.match(auth, /Never return raw provider errors to clients/);
  assert.match(auth, /Permintaan tidak dapat diproses saat ini/);
});

test('responses include request correlation ID and disable cache and Express signature', () => {
  assert.match(app, /app\.disable\("x-powered-by"\)/);
  assert.match(app, /res\.setHeader\("X-Request-ID", requestId\)/);
  assert.match(app, /res\.setHeader\("Cache-Control", "no-store"\)/);
});

test('rate limiter avoids trusting forwarded-for directly', () => {
  assert.match(limiter, /Do not trust arbitrary X-Forwarded-For values/);
  assert.match(limiter, /req\.ip \|\| req\.socket\?\.remoteAddress/);
});
