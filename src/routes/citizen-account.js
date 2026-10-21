const express = require('express');
const { createAuthClient, createServiceClient } = require('../config/supabase');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bearer(req) {
  const value = req.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

async function requireCitizen(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ success: false, message: 'Sesi tidak ditemukan. Silakan masuk kembali.' });
  try {
    const auth = createAuthClient(token);
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data?.user || !data.user.email_confirmed_at) return res.status(401).json({ success: false, message: 'Sesi tidak valid atau email belum dikonfirmasi.' });
    const { data: profile, error: profileError } = await auth.from('docura_citizen_profiles')
      .select('user_id,is_active,full_name,email').eq('user_id', data.user.id).maybeSingle();
    if (profileError) return res.status(503).json({ success: false, message: 'Profil warga belum dapat diperiksa.' });
    if (!profile || !profile.is_active) return res.status(403).json({ success: false, message: 'Pengaturan hanya tersedia untuk akun warga aktif.' });
    req.user = data.user;
    req.token = token;
    req.auth = auth;
    req.profile = profile;
    req.service = createServiceClient();
    next();
  } catch (error) {
    console.error('Citizen account setup error:', error.message);
    return res.status(503).json({ success: false, message: 'Pengaturan akun belum tersedia. Periksa konfigurasi server.' });
  }
}

async function verifyCurrentPassword(req, password) {
  if (!password) return false;
  const auth = createAuthClient();
  const { error } = await auth.auth.signInWithPassword({ email: req.user.email, password });
  return !error;
}

router.use(requireCitizen);

router.patch('/name', async (req, res) => {
  const fullName = String(req.body?.fullName || '').trim();
  const currentPassword = String(req.body?.currentPassword || '');
  if (fullName.length < 2 || fullName.length > 100) return res.status(400).json({ success: false, message: 'Nama harus terdiri dari 2–100 karakter.' });
  try {
    if (!await verifyCurrentPassword(req, currentPassword)) return res.status(401).json({ success: false, message: 'Kata sandi saat ini tidak sesuai. Nama tidak diubah.' });
    const { error: profileError } = await req.service.from('docura_citizen_profiles')
      .update({ full_name: fullName, updated_at: new Date().toISOString() }).eq('user_id', req.user.id);
    if (profileError) throw profileError;
    const { error: userError } = await req.service.auth.admin.updateUserById(req.user.id, { user_metadata: { ...(req.user.user_metadata || {}), full_name: fullName } });
    if (userError) throw userError;
    return res.json({ success: true, message: 'Nama akun berhasil diperbarui.', fullName });
  } catch (error) {
    console.error('Citizen name update error:', error.message);
    return res.status(500).json({ success: false, message: 'Nama akun belum dapat diperbarui.' });
  }
});

router.patch('/email', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const currentPassword = String(req.body?.currentPassword || '');
  const refreshToken = String(req.body?.refreshToken || '');
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ success: false, message: 'Masukkan alamat email yang valid.' });
  if (email === String(req.user.email || '').toLowerCase()) return res.status(400).json({ success: false, message: 'Email baru sama dengan email saat ini.' });
  try {
    if (!await verifyCurrentPassword(req, currentPassword)) return res.status(401).json({ success: false, message: 'Kata sandi saat ini tidak sesuai. Email tidak diubah.' });
    if (!refreshToken) return res.status(400).json({ success: false, message: 'Sesi perlu diperbarui. Keluar lalu masuk kembali sebelum mengubah email.' });
    // Use the user's authenticated Supabase session so the normal email-change
    // confirmation workflow remains in effect; do not bypass confirmation via admin API.
    const { error: sessionError } = await req.auth.auth.setSession({ access_token: req.token, refresh_token: refreshToken });
    if (sessionError) return res.status(401).json({ success: false, message: 'Sesi tidak dapat diperbarui. Silakan masuk kembali.' });
    const { data, error } = await req.auth.auth.updateUser({ email });
    if (error) {
      const text = /already|registered/i.test(error.message || '') ? 'Email tersebut sudah digunakan.' : 'Permintaan perubahan email gagal. Periksa pengaturan konfirmasi email Supabase.';
      return res.status(400).json({ success: false, message: text });
    }
    return res.json({ success: true, message: 'Permintaan perubahan email dikirim. Buka email konfirmasi dari Supabase untuk menyelesaikan perubahan.', pendingEmail: data?.user?.new_email || email });
  } catch (error) {
    console.error('Citizen email update error:', error.message);
    return res.status(500).json({ success: false, message: 'Email belum dapat diperbarui.' });
  }
});

router.patch('/password', async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 8 || newPassword.length > 72) return res.status(400).json({ success: false, message: 'Kata sandi baru harus terdiri dari 8–72 karakter.' });
  if (newPassword === currentPassword) return res.status(400).json({ success: false, message: 'Kata sandi baru harus berbeda dari kata sandi saat ini.' });
  try {
    if (!await verifyCurrentPassword(req, currentPassword)) return res.status(401).json({ success: false, message: 'Kata sandi saat ini tidak sesuai. Kata sandi tidak diubah.' });
    const { error } = await req.service.auth.admin.updateUserById(req.user.id, { password: newPassword });
    if (error) {
      const message = /password should be at least/i.test(error.message || '') ? 'Kata sandi baru belum memenuhi kebijakan keamanan.' : 'Kata sandi belum dapat diperbarui.';
      return res.status(400).json({ success: false, message });
    }
    return res.json({ success: true, message: 'Kata sandi berhasil diperbarui. Gunakan kata sandi baru pada login berikutnya.' });
  } catch (error) {
    console.error('Citizen password update error:', error.message);
    return res.status(500).json({ success: false, message: 'Kata sandi belum dapat diperbarui.' });
  }
});

module.exports = router;
