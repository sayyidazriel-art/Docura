const express = require("express");
const { createAuthClient } = require("../config/supabase");

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicError(error) {
  const message = String(error?.message || "Permintaan tidak dapat diproses.");
  if (/invalid login credentials/i.test(message)) return "Email atau kata sandi tidak sesuai.";
  if (/email not confirmed/i.test(message)) return "Email belum dikonfirmasi. Buka tautan aktivasi yang dikirim ke email Anda.";
  if (/user already registered/i.test(message)) return "Email ini sudah terdaftar. Silakan masuk atau gunakan fitur kirim ulang aktivasi.";
  if (/password should be at least/i.test(message)) return "Kata sandi belum memenuhi ketentuan minimum.";
  if (/rate limit/i.test(message)) return "Terlalu banyak permintaan. Tunggu beberapa saat lalu coba lagi.";
  return message;
}

function getBearer(req) {
  const value = req.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

router.post("/register", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({ success: false, message: "Nama lengkap harus terdiri dari 2–100 karakter." });
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ success: false, message: "Masukkan alamat email yang valid." });
  }
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ success: false, message: "Kata sandi harus terdiri dari 8–72 karakter." });
  }

  try {
    const auth = createAuthClient();
    const { data, error } = await auth.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, account_type: "citizen" },
        emailRedirectTo: `${req.protocol}://${req.get("host")}/login.html?activated=1`,
      },
    });
    if (error) return res.status(400).json({ success: false, message: publicError(error) });

    // If email confirmation is enabled, Supabase normally returns a user without a session.
    // Never treat registration as official identity verification.
    const needsEmailConfirmation = !data.session;
    return res.status(201).json({
      success: true,
      needsEmailConfirmation,
      message: needsEmailConfirmation
        ? "Pendaftaran diterima. Periksa email Anda dan klik tautan aktivasi sebelum masuk."
        : "Akun berhasil dibuat. Anda dapat melanjutkan ke portal warga.",
      session: data.session || null,
      user: data.user ? { id: data.user.id, email: data.user.email, emailConfirmedAt: data.user.email_confirmed_at || null, userMetadata: data.user.user_metadata || {} } : null,
    });
  } catch (error) {
    console.error("Citizen registration error:", error.message);
    return res.status(500).json({ success: false, message: "Terjadi kendala saat membuat akun. Coba lagi nanti." });
  }
});

router.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!EMAIL_RE.test(email) || !password) {
    return res.status(400).json({ success: false, message: "Masukkan email dan kata sandi yang valid." });
  }
  try {
    const auth = createAuthClient();
    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ success: false, message: publicError(error) });
    if (!data.session || !data.user) {
      return res.status(401).json({ success: false, message: "Sesi masuk tidak tersedia. Pastikan email telah diaktifkan." });
    }
    return res.json({
      success: true,
      message: "Berhasil masuk.",
      session: data.session,
      user: { id: data.user.id, email: data.user.email, emailConfirmedAt: data.user.email_confirmed_at || null, userMetadata: data.user.user_metadata || {} },
    });
  } catch (error) {
    console.error("Citizen login error:", error.message);
    return res.status(500).json({ success: false, message: "Terjadi kendala saat masuk. Coba lagi nanti." });
  }
});

router.post("/resend-activation", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ success: false, message: "Masukkan alamat email yang valid." });
  try {
    const auth = createAuthClient();
    const { error } = await auth.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${req.protocol}://${req.get("host")}/login.html?activated=1` } });
    if (error) return res.status(400).json({ success: false, message: publicError(error) });
    return res.json({ success: true, message: "Jika akun tersebut belum aktif, instruksi aktivasi akan dikirim ke email terkait." });
  } catch (error) {
    console.error("Resend activation error:", error.message);
    return res.status(500).json({ success: false, message: "Permintaan belum dapat diproses. Coba lagi nanti." });
  }
});

router.post("/forgot-password", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ success: false, message: "Masukkan alamat email yang valid." });
  try {
    const auth = createAuthClient();
    const { error } = await auth.auth.resetPasswordForEmail(email, { redirectTo: `${req.protocol}://${req.get("host")}/login.html?reset=1` });
    if (error) return res.status(400).json({ success: false, message: publicError(error) });
    return res.json({ success: true, message: "Jika email terdaftar, instruksi pemulihan kata sandi akan dikirim." });
  } catch (error) {
    console.error("Password reset request error:", error.message);
    return res.status(500).json({ success: false, message: "Permintaan belum dapat diproses. Coba lagi nanti." });
  }
});

router.get("/me", async (req, res) => {
  const token = getBearer(req);
  if (!token) return res.status(401).json({ success: false, message: "Sesi tidak ditemukan. Silakan masuk kembali." });
  try {
    const auth = createAuthClient();
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ success: false, message: "Sesi sudah berakhir. Silakan masuk kembali." });
    if (!data.user.email_confirmed_at) return res.status(403).json({ success: false, message: "Email belum diaktifkan." });
    return res.json({ success: true, user: { id: data.user.id, email: data.user.email, emailConfirmedAt: data.user.email_confirmed_at, userMetadata: data.user.user_metadata || {} } });
  } catch (error) {
    console.error("Auth session check error:", error.message);
    return res.status(500).json({ success: false, message: "Sesi tidak dapat diperiksa saat ini." });
  }
});

router.post("/logout", async (_req, res) => {
  // The app keeps the access token in the current browser tab only. Removing it client-side ends this demo session.
  return res.json({ success: true, message: "Sesi lokal ditutup." });
});

module.exports = router;
