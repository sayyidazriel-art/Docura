const express = require('express');
const crypto = require('crypto');
const { createAuthClient, createServiceClient } = require('../config/supabase');
const { expectedConfig, b64url, fromB64url, verifyRegistrationResponse, verifyAuthenticationResponse } = require('../services/webauthn');
const { issueActionProof } = require('../services/passkey-state');

const router = express.Router();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function bearer(req) {
  const value = req.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}
async function requireCitizen(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ success: false, message: 'Sesi tidak ditemukan. Silakan masuk kembali.' });
  try {
    const client = createAuthClient(token);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user || !data.user.email_confirmed_at) return res.status(401).json({ success: false, message: 'Sesi tidak valid atau email belum dikonfirmasi.' });
    const { data: profile, error: profileError } = await client.from('docura_citizen_profiles').select('user_id,citizen_code,full_name,email,is_active,passkey_enabled').eq('user_id', data.user.id).maybeSingle();
    if (profileError) return res.status(503).json({ success: false, message: 'Profil warga belum dapat diperiksa.' });
    if (!profile || !profile.is_active) return res.status(403).json({ success: false, message: 'Fitur passkey hanya tersedia untuk akun warga aktif.' });
    req.user = data.user;
    req.userClient = client;
    req.profile = profile;
    req.service = createServiceClient();
    next();
  } catch (error) {
    if (/SUPABASE_SERVICE_ROLE_KEY/.test(error.message)) return res.status(503).json({ success: false, message: 'Passkey belum dikonfigurasi di server. Administrator perlu menyiapkan kunci server Supabase.' });
    console.error('Passkey authentication setup error:', error.message);
    return res.status(500).json({ success: false, message: 'Layanan passkey belum dapat dijalankan.' });
  }
}
async function saveChallenge(req, purpose, challenge) {
  const now = new Date();
  const row = { user_id: req.user.id, purpose, challenge, expires_at: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(), consumed_at: null };
  const { error } = await req.service.from('docura_passkey_challenges').upsert(row, { onConflict: 'user_id,purpose' });
  if (error) throw error;
}
async function consumeChallenge(req, purpose, challenge) {
  const { data, error } = await req.service.from('docura_passkey_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('user_id', req.user.id).eq('purpose', purpose).eq('challenge', challenge)
    .is('consumed_at', null).gt('expires_at', new Date().toISOString())
    .select('challenge').maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
function publicKeyOptions(config, challenge, user, credentials = []) {
  return {
    challenge,
    rp: { name: config.rpName, id: config.rpID },
    user: { id: b64url(Buffer.from(user.id.replace(/-/g, ''), 'hex')), name: user.email, displayName: String(user.user_metadata?.full_name || user.email).slice(0, 100) },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: credentials.map((row) => ({ type: 'public-key', id: row.credential_id, transports: row.transports || [] }))
  };
}

router.use(requireCitizen);

router.get('/status', async (req, res) => {
  try {
    const { data, error } = await req.service.from('docura_passkey_credentials').select('credential_id,created_at,device_label').eq('user_id', req.user.id).order('created_at', { ascending: true });
    if (error) throw error;
    return res.json({ success: true, enabled: Boolean(data?.length), credentials: (data || []).map(({ credential_id, created_at, device_label }) => ({ id: credential_id, createdAt: created_at, deviceLabel: device_label || 'Passkey perangkat' })) });
  } catch (error) {
    console.error('Passkey status error:', error.message);
    return res.status(500).json({ success: false, message: 'Status passkey belum dapat dimuat. Pastikan migrasi V2.2 sudah dijalankan.' });
  }
});

router.post('/registration/options', async (req, res) => {
  const password = String(req.body?.currentPassword || '');
  if (!password) return res.status(400).json({ success: false, message: 'Masukkan kata sandi akun untuk mengonfirmasi pendaftaran passkey.' });
  try {
    const { error: passwordError } = await createAuthClient().auth.signInWithPassword({ email: req.user.email, password });
    if (passwordError) return res.status(401).json({ success: false, message: 'Kata sandi akun tidak sesuai. Pendaftaran passkey dibatalkan.' });
    const config = expectedConfig();
    const { data: existing, error } = await req.service.from('docura_passkey_credentials').select('credential_id,transports').eq('user_id', req.user.id);
    if (error) throw error;
    const challenge = b64url(crypto.randomBytes(32));
    await saveChallenge(req, 'registration', challenge);
    return res.json({ success: true, options: publicKeyOptions(config, challenge, req.user, existing || []) });
  } catch (error) {
    console.error('Passkey registration options error:', error.message);
    return res.status(500).json({ success: false, message: error.message.includes('WEBAUTHN_') || error.message.includes('hostname') ? error.message : 'Opsi pendaftaran passkey belum dapat dibuat.' });
  }
});

router.post('/registration/verify', async (req, res) => {
  try {
    const challenge = String(req.body?.challenge || '');
    const response = req.body?.credential;
    if (!challenge || !response) return res.status(400).json({ success: false, message: 'Respons pendaftaran passkey tidak lengkap.' });
    if (!await consumeChallenge(req, 'registration', challenge)) return res.status(403).json({ success: false, message: 'Challenge pendaftaran kedaluwarsa atau sudah digunakan. Mulai ulang pendaftaran.' });
    const credential = verifyRegistrationResponse(response, challenge);
    const { error } = await req.service.from('docura_passkey_credentials').insert({
      credential_id: credential.credentialId,
      user_id: req.user.id,
      public_key_jwk: credential.publicKeyJwk,
      counter: credential.counter,
      transports: credential.transports,
      device_label: String(req.body?.deviceLabel || 'Passkey perangkat').trim().slice(0, 80),
      created_at: new Date().toISOString(),
      last_used_at: null
    }, { onConflict: 'credential_id' });
    if (error) throw error;
    const { error: profileError } = await req.service.from('docura_citizen_profiles').update({ passkey_enabled: true, updated_at: new Date().toISOString() }).eq('user_id', req.user.id);
    if (profileError) throw profileError;
    return res.json({ success: true, message: 'Passkey berhasil didaftarkan. Verifikasi ini menggunakan autentikator perangkat, bukan data sidik jari yang dikirim ke Docura.' });
  } catch (error) {
    console.error('Passkey registration verification error:', error.message);
    return res.status(400).json({ success: false, message: error.message || 'Pendaftaran passkey gagal diverifikasi.' });
  }
});

router.post('/authentication/options', async (req, res) => {
  try {
    const { data: credentials, error } = await req.service.from('docura_passkey_credentials').select('credential_id,transports').eq('user_id', req.user.id);
    if (error) throw error;
    if (!credentials?.length) return res.status(409).json({ success: false, message: 'Belum ada passkey terdaftar. Daftarkan passkey terlebih dahulu.' });
    const config = expectedConfig();
    const challenge = b64url(crypto.randomBytes(32));
    await saveChallenge(req, 'authentication', challenge);
    return res.json({ success: true, options: { challenge, rpId: config.rpID, timeout: 60000, userVerification: 'required', allowCredentials: credentials.map((row) => ({ type: 'public-key', id: row.credential_id, transports: row.transports || [] })) } });
  } catch (error) {
    console.error('Passkey authentication options error:', error.message);
    return res.status(500).json({ success: false, message: error.message.includes('WEBAUTHN_') || error.message.includes('hostname') ? error.message : 'Opsi autentikasi passkey belum dapat dibuat.' });
  }
});

router.post('/authentication/verify', async (req, res) => {
  try {
    const challenge = String(req.body?.challenge || '');
    const response = req.body?.credential;
    if (!challenge || !response?.id) return res.status(400).json({ success: false, message: 'Respons autentikasi passkey tidak lengkap.' });
    if (!await consumeChallenge(req, 'authentication', challenge)) return res.status(403).json({ success: false, message: 'Challenge autentikasi kedaluwarsa atau sudah digunakan. Ulangi verifikasi.' });
    const { data: credential, error } = await req.service.from('docura_passkey_credentials').select('*').eq('user_id', req.user.id).eq('credential_id', response.id).maybeSingle();
    if (error) throw error;
    if (!credential) return res.status(403).json({ success: false, message: 'Passkey tidak terdaftar pada akun ini.' });
    const verified = verifyAuthenticationResponse(response, challenge, credential);
    const { error: updateError } = await req.service.from('docura_passkey_credentials').update({ counter: verified.counter, last_used_at: new Date().toISOString() }).eq('credential_id', credential.credential_id).eq('user_id', req.user.id);
    if (updateError) throw updateError;
    return res.json({ success: true, verificationToken: issueActionProof(req.user.id), expiresInSeconds: 120, message: 'Autentikasi passkey berhasil. Bukti berlaku singkat dan hanya untuk akun ini.' });
  } catch (error) {
    console.error('Passkey authentication verification error:', error.message); // Only safe verifier diagnostics; never log raw credentials or signatures.
    return res.status(403).json({ success: false, message: error.message || 'Autentikasi passkey gagal.' });
  }
});

router.delete('/:credentialId', async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    if (!currentPassword) return res.status(400).json({ success: false, message: 'Kata sandi akun diperlukan untuk menghapus passkey.' });
    const { error: passwordError } = await createAuthClient().auth.signInWithPassword({ email: req.user.email, password: currentPassword });
    if (passwordError) return res.status(401).json({ success: false, message: 'Kata sandi akun tidak sesuai. Passkey tidak dihapus.' });
    const credentialId = String(req.params.credentialId || '');
    const { data: rows, error } = await req.service.from('docura_passkey_credentials').select('credential_id').eq('user_id', req.user.id);
    if (error) throw error;
    const credentials = rows || [];
    if (!credentials.some((row) => row.credential_id === credentialId)) return res.status(404).json({ success: false, message: 'Passkey tidak ditemukan pada akun ini.' });
    if (credentials.length <= 1) return res.status(409).json({ success: false, message: 'Daftarkan passkey pengganti sebelum menghapus passkey terakhir.' });
    const { error: deleteError } = await req.service.from('docura_passkey_credentials').delete().eq('user_id', req.user.id).eq('credential_id', credentialId);
    if (deleteError) throw deleteError;
    return res.json({ success: true, message: 'Passkey dihapus dari akun Docura. Jika perlu, hapus juga salinannya dari pengelola passkey perangkat.' });
  } catch (error) {
    console.error('Passkey deletion error:', error.message);
    return res.status(500).json({ success: false, message: 'Passkey belum dapat dihapus.' });
  }
});

module.exports = router;
