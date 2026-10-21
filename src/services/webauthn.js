const crypto = require('crypto');

function b64url(buffer) { return Buffer.from(buffer).toString('base64url'); }
function fromB64url(value) { return Buffer.from(String(value || ''), 'base64url'); }
function timingSafeTextEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

// Minimal definite-length CBOR decoder for WebAuthn's attestationObject and COSE key.
// Unsupported CBOR constructs are rejected rather than interpreted ambiguously.
function decodeCbor(buffer, offset = 0) {
  const start = offset;
  if (offset >= buffer.length) throw new Error('CBOR terpotong.');
  const first = buffer[offset++];
  const major = first >> 5;
  const ai = first & 31;
  let length;
  if (ai < 24) length = ai;
  else if (ai === 24) { length = buffer[offset++]; }
  else if (ai === 25) { length = buffer.readUInt16BE(offset); offset += 2; }
  else if (ai === 26) { length = buffer.readUInt32BE(offset); offset += 4; }
  else if (ai === 27) {
    const n = buffer.readBigUInt64BE(offset); offset += 8;
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CBOR terlalu besar.');
    length = Number(n);
  } else throw new Error('CBOR indefinite-length tidak didukung.');
  if (offset > buffer.length) throw new Error('CBOR terpotong.');
  let value;
  if (major === 0) value = length;
  else if (major === 1) value = -1 - length;
  else if (major === 2 || major === 3) {
    if (offset + length > buffer.length) throw new Error('CBOR byte string terpotong.');
    const bytes = buffer.subarray(offset, offset + length); offset += length;
    value = major === 2 ? Buffer.from(bytes) : bytes.toString('utf8');
  } else if (major === 4) {
    value = [];
    for (let i = 0; i < length; i++) { const item = decodeCbor(buffer, offset); value.push(item.value); offset = item.offset; }
  } else if (major === 5) {
    value = new Map();
    for (let i = 0; i < length; i++) {
      const key = decodeCbor(buffer, offset); offset = key.offset;
      const item = decodeCbor(buffer, offset); offset = item.offset;
      value.set(key.value, item.value);
    }
  } else if (major === 6) {
    const item = decodeCbor(buffer, offset); value = item.value; offset = item.offset;
  } else if (major === 7) {
    if (ai === 20) value = false;
    else if (ai === 21) value = true;
    else if (ai === 22) value = null;
    else throw new Error('Nilai CBOR sederhana tidak didukung.');
  } else throw new Error('Tipe CBOR tidak didukung.');
  return { value, offset, bytesRead: offset - start };
}

function expectedConfig() {
  const rpID = String(process.env.WEBAUTHN_RP_ID || '').trim().toLowerCase();
  const origin = String(process.env.WEBAUTHN_ORIGIN || '').trim().replace(/\/$/, '');
  if (!rpID || !origin) throw new Error('WEBAUTHN_RP_ID dan WEBAUTHN_ORIGIN wajib dikonfigurasi.');
  const parsed = new URL(origin);
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1' && parsed.protocol !== 'https:') {
    throw new Error('WebAuthn hanya boleh memakai HTTPS di luar localhost.');
  }
  if (parsed.hostname.toLowerCase() !== rpID && !(parsed.hostname === 'localhost' && rpID === 'localhost') && !(parsed.hostname === '127.0.0.1' && rpID === '127.0.0.1')) {
    throw new Error('WEBAUTHN_RP_ID harus cocok dengan hostname WEBAUTHN_ORIGIN.');
  }
  return { rpID, origin, rpName: process.env.WEBAUTHN_RP_NAME || 'Docura' };
}

function parseClientData(encoded, expectedType, challenge) {
  const raw = fromB64url(encoded);
  let data;
  try { data = JSON.parse(raw.toString('utf8')); } catch (_) { throw new Error('clientDataJSON tidak valid.'); }
  const { origin } = expectedConfig();
  if (data.type !== expectedType || !timingSafeTextEqual(data.challenge, challenge) || data.origin !== origin || data.crossOrigin === true) {
    throw new Error('Bukti WebAuthn tidak cocok dengan challenge, origin, atau jenis operasi.');
  }
  return raw;
}

function parseAuthenticatorData(authData, requireAttestedCredential = false) {
  const data = Buffer.from(authData);
  if (data.length < 37) throw new Error('authenticatorData terlalu pendek.');
  const { rpID } = expectedConfig();
  const expectedRpHash = crypto.createHash('sha256').update(rpID).digest();
  if (!crypto.timingSafeEqual(data.subarray(0, 32), expectedRpHash)) throw new Error('RP ID hash tidak cocok.');
  const flags = data[32];
  if (!(flags & 0x01)) throw new Error(`Autentikator tidak menyatakan user presence (UP). Flags authenticatorData: 0x${flags.toString(16).padStart(2, '0')}.`);
  if (!(flags & 0x04)) {
    // Do not weaken UV enforcement to accommodate a credential that did not
    // perform local user verification. The flag byte is safe diagnostic data.
    const flagHex = `0x${flags.toString(16).padStart(2, '0')}`;
    throw new Error(`Verifikasi pengguna (UV) tidak disertakan oleh autentikator (flags ${flagHex}; UP=${Boolean(flags & 0x01)}, UV=${Boolean(flags & 0x04)}). Docura menolak respons ini demi keamanan. Coba pilih passkey lain atau autentikator yang melakukan verifikasi lokal.`);
  }
  const counter = data.readUInt32BE(33);
  let credentialId = null;
  let publicKeyJwk = null;
  if (requireAttestedCredential) {
    if (!(flags & 0x40) || data.length < 55) throw new Error('Data kredensial WebAuthn tidak ditemukan.');
    let offset = 53; // RP ID hash + flags + counter + AAGUID
    const credentialIdLength = data.readUInt16BE(offset); offset += 2;
    if (!credentialIdLength || offset + credentialIdLength >= data.length) throw new Error('Credential ID tidak valid.');
    credentialId = data.subarray(offset, offset + credentialIdLength); offset += credentialIdLength;
    const decoded = decodeCbor(data, offset);
    const cose = decoded.value;
    if (!(cose instanceof Map)) throw new Error('COSE public key tidak valid.');
    const kty = cose.get(1); const alg = cose.get(3);
    if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
      publicKeyJwk = { kty: 'EC', crv: 'P-256', x: b64url(cose.get(-2)), y: b64url(cose.get(-3)), ext: true };
    } else if (kty === 3 && alg === -257) {
      publicKeyJwk = { kty: 'RSA', n: b64url(cose.get(-1)), e: b64url(cose.get(-2)), ext: true };
    } else {
      throw new Error('Algoritma passkey belum didukung. Gunakan autentikator ES256 atau RS256.');
    }
  }
  return { flags, counter, credentialId, publicKeyJwk };
}

function verifyRegistrationResponse(response, challenge) {
  if (!response || response.type !== 'public-key' || !response.response?.attestationObject || !response.response?.clientDataJSON) throw new Error('Respons pendaftaran passkey tidak lengkap.');
  parseClientData(response.response.clientDataJSON, 'webauthn.create', challenge);
  const attestation = decodeCbor(fromB64url(response.response.attestationObject)).value;
  if (!(attestation instanceof Map) || attestation.get('fmt') !== 'none' || !(attestation.get('authData') instanceof Buffer)) {
    throw new Error('Attestation harus berformat none. Coba ulangi pendaftaran dengan browser yang kompatibel.');
  }
  const parsed = parseAuthenticatorData(attestation.get('authData'), true);
  const credentialId = b64url(parsed.credentialId);
  if (!timingSafeTextEqual(response.id, credentialId) || !timingSafeTextEqual(response.rawId, credentialId)) throw new Error('Credential ID pada respons tidak cocok dengan data autentikator.');
  return { credentialId, publicKeyJwk: parsed.publicKeyJwk, counter: parsed.counter, transports: Array.isArray(response.response.transports) ? response.response.transports.filter(x => typeof x === 'string').slice(0, 8) : [] };
}

function verifyAuthenticationResponse(response, challenge, credential) {
  if (!response || response.type !== 'public-key' || !response.response?.authenticatorData || !response.response?.clientDataJSON || !response.response?.signature) throw new Error('Respons autentikasi passkey tidak lengkap.');
  if (!timingSafeTextEqual(response.id, credential.credential_id) || !timingSafeTextEqual(response.rawId, credential.credential_id)) throw new Error('Passkey tidak cocok dengan kredensial terdaftar.');
  const clientData = parseClientData(response.response.clientDataJSON, 'webauthn.get', challenge);
  const authData = fromB64url(response.response.authenticatorData);
  const parsed = parseAuthenticatorData(authData, false);
  if (credential.counter > 0 && parsed.counter > 0 && parsed.counter <= credential.counter) throw new Error('Counter autentikator tidak meningkat. Kredensial mungkin disalin atau diputar ulang.');
  const signedData = Buffer.concat([authData, crypto.createHash('sha256').update(clientData).digest()]);
  const publicKey = crypto.createPublicKey({ key: credential.public_key_jwk, format: 'jwk' });
  const alg = credential.public_key_jwk.kty === 'RSA' ? 'RSA-SHA256' : 'sha256';
  if (!crypto.verify(alg, signedData, publicKey, fromB64url(response.response.signature))) throw new Error('Tanda tangan passkey tidak valid.');
  return { counter: parsed.counter, credentialId: credential.credential_id };
}

module.exports = { b64url, fromB64url, decodeCbor, expectedConfig, verifyRegistrationResponse, verifyAuthenticationResponse };
