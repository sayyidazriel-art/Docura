const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeCbor, b64url, fromB64url } = require('../src/services/webauthn');

test('base64url round trip preserves bytes without padding', () => {
  const source = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const encoded = b64url(source);
  assert.equal(encoded.includes('='), false);
  assert.deepEqual(fromB64url(encoded), source);
});

test('CBOR decoder reads a map containing text and byte strings', () => {
  // { "fmt": "none", "authData": h'010203' }
  const cbor = Buffer.from('a263666d74646e6f6e6568617574684461746143010203', 'hex');
  const decoded = decodeCbor(cbor);
  assert.equal(decoded.offset, cbor.length);
  assert.equal(decoded.value.get('fmt'), 'none');
  assert.deepEqual(decoded.value.get('authData'), Buffer.from([1, 2, 3]));
});

test('CBOR decoder rejects truncated data', () => {
  assert.throws(() => decodeCbor(Buffer.from('43aabb', 'hex')), /terpotong/);
});

function encodeHead(major, value) {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  const out = Buffer.alloc(3); out[0] = (major << 5) | 25; out.writeUInt16BE(value, 1); return out;
}
function encodeCbor(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([encodeHead(2, value.length), value]);
  if (typeof value === 'string') { const bytes = Buffer.from(value); return Buffer.concat([encodeHead(3, bytes.length), bytes]); }
  if (typeof value === 'number') return value >= 0 ? encodeHead(0, value) : encodeHead(1, -1 - value);
  if (value instanceof Map) {
    const parts = [];
    for (const [key, item] of value) parts.push(encodeCbor(key), encodeCbor(item));
    return Buffer.concat([encodeHead(5, value.size), ...parts]);
  }
  throw new Error(`Unsupported CBOR test value: ${typeof value}`);
}

test('WebAuthn registration and assertion signatures verify with ES256', () => {
  const crypto = require('node:crypto');
  const { verifyRegistrationResponse, verifyAuthenticationResponse } = require('../src/services/webauthn');
  process.env.WEBAUTHN_RP_ID = 'localhost';
  process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = encodeCbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const credentialId = crypto.randomBytes(16);
  const rpHash = crypto.createHash('sha256').update('localhost').digest();
  const prefix = Buffer.alloc(37); rpHash.copy(prefix, 0); prefix[32] = 0x45; prefix.writeUInt32BE(0, 33);
  const attested = Buffer.concat([prefix, Buffer.alloc(16), Buffer.from([0, credentialId.length]), credentialId, cose]);
  const challenge = crypto.randomBytes(32).toString('base64url');
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: 'http://localhost:3000' }));
  const attestationObject = encodeCbor(new Map([['fmt', 'none'], ['authData', attested], ['attStmt', new Map()]]));
  const registration = verifyRegistrationResponse({
    id: credentialId.toString('base64url'), rawId: credentialId.toString('base64url'), type: 'public-key',
    response: { clientDataJSON: clientDataJSON.toString('base64url'), attestationObject: attestationObject.toString('base64url'), transports: ['internal'] }
  }, challenge);
  assert.equal(registration.credentialId, credentialId.toString('base64url'));

  const authChallenge = crypto.randomBytes(32).toString('base64url');
  const authClientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: authChallenge, origin: 'http://localhost:3000' }));
  const authData = Buffer.alloc(37); rpHash.copy(authData, 0); authData[32] = 0x05; authData.writeUInt32BE(1, 33);
  const signedData = Buffer.concat([authData, crypto.createHash('sha256').update(authClientData).digest()]);
  const signature = crypto.sign('sha256', signedData, privateKey);
  const assertion = verifyAuthenticationResponse({
    id: registration.credentialId, rawId: registration.credentialId, type: 'public-key',
    response: { clientDataJSON: authClientData.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: signature.toString('base64url') }
  }, authChallenge, { credential_id: registration.credentialId, public_key_jwk: registration.publicKeyJwk, counter: 0 });
  assert.equal(assertion.counter, 1);
});


test('WebAuthn authentication rejects missing UV and includes safe flag diagnostics', () => {
  const crypto = require('node:crypto');
  const { verifyAuthenticationResponse } = require('../src/services/webauthn');
  process.env.WEBAUTHN_RP_ID = 'localhost';
  process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
  const challenge = crypto.randomBytes(32).toString('base64url');
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: 'http://localhost:3000' }));
  const authData = Buffer.alloc(37);
  crypto.createHash('sha256').update('localhost').digest().copy(authData, 0);
  authData[32] = 0x01; // UP is set; UV is not.
  const credentialId = crypto.randomBytes(16).toString('base64url');
  assert.throws(() => verifyAuthenticationResponse({
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: clientDataJSON.toString('base64url'),
      authenticatorData: authData.toString('base64url'),
      signature: Buffer.alloc(64).toString('base64url')
    }
  }, challenge, { credential_id: credentialId, public_key_jwk: {}, counter: 0 }), /flags 0x01; UP=true, UV=false/);
});
