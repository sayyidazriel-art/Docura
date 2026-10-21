const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const { createAuthClient } = require("../config/supabase");
const { validateFileSignature } = require("../services/file-validation");
const { consumeActionProof } = require("../services/passkey-state");

const router = express.Router();
const BUCKET = "citizen-documents";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new Error("Format file harus PDF, JPG, atau PNG."));
    cb(null, true);
  },
});

// Token verifikasi ini hanya simulasi alur sidik jari untuk demo, bukan biometrik nyata.
// Token singkat, sekali pakai, terkait user dan dokumen; hilang saat server restart.
const verificationTokens = new Map();
const TOKEN_TTL_MS = 2 * 60 * 1000;

function bearer(req) {
  const value = req.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function requireCitizen(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ success: false, message: "Sesi tidak ditemukan. Silakan masuk kembali." });
  try {
    const auth = createAuthClient();
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ success: false, message: "Sesi tidak valid. Silakan masuk kembali." });
    if (!data.user.email_confirmed_at) return res.status(403).json({ success: false, message: "Aktifkan email sebelum mengelola dokumen." });
    req.user = data.user;
    req.accessToken = token;
    req.userSupabase = createAuthClient(token);
    next();
  } catch (error) {
    console.error("Document auth error:", error.message);
    return res.status(500).json({ success: false, message: "Sesi tidak dapat diperiksa saat ini." });
  }
}

function safeName(name) {
  const base = path.basename(String(name || "dokumen")).normalize("NFKC");
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "dokumen";
}

async function ownedDocument(req, id) {
  const { data, error } = await req.userSupabase
    .from("documents")
    .select("id, owner_id, title, document_type, storage_path, original_filename, mime_type, file_size, status, created_at")
    .eq("id", id)
    .eq("owner_id", req.user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function consumeVerification(req, documentId) {
  const token = req.get("x-demo-verification") || "";
  const item = verificationTokens.get(token);
  if (!item || item.userId !== req.user.id || item.documentId !== documentId || item.expiresAt < Date.now()) {
    if (token) verificationTokens.delete(token);
    return false;
  }
  verificationTokens.delete(token);
  return true;
}

router.use(requireCitizen);

router.get("/", async (req, res) => {
  try {
    const { data, error } = await req.userSupabase
      .from("documents")
      .select("id, title, document_type, original_filename, mime_type, file_size, status, created_at")
      .eq("owner_id", req.user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return res.json({ success: true, documents: data || [] });
  } catch (error) {
    console.error("List documents error:", error.message);
    return res.status(500).json({ success: false, message: "Daftar dokumen belum dapat dimuat. Pastikan SQL tahap penyimpanan sudah dijalankan." });
  }
});

router.post("/", (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (error) {
      const message = error.code === "LIMIT_FILE_SIZE" ? "Ukuran file maksimal 10 MB." : error.message || "File tidak dapat diproses.";
      return res.status(400).json({ success: false, message });
    }
    next();
  });
}, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const documentType = String(req.body?.documentType || "Lainnya").trim();
  const file = req.file;
  if (title.length < 2 || title.length > 120) return res.status(400).json({ success: false, message: "Judul dokumen harus terdiri dari 2–120 karakter." });
  if (!file) return res.status(400).json({ success: false, message: "Pilih file PDF, JPG, atau PNG terlebih dahulu." });
  if (!ALLOWED.has(file.mimetype)) return res.status(400).json({ success: false, message: "Format file tidak didukung." });
  if (!validateFileSignature(file.buffer, file.mimetype)) return res.status(400).json({ success: false, message: "Isi file tidak sesuai dengan format PDF, JPG, atau PNG yang dipilih." });
  const ext = ALLOWED.get(file.mimetype);
  const storagePath = `${req.user.id}/${crypto.randomUUID()}${ext}`;
  try {
    const { error: storageError } = await req.userSupabase.storage.from(BUCKET).upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      cacheControl: "60",
      upsert: false,
    });
    if (storageError) throw storageError;

    const { data, error: dbError } = await req.userSupabase.from("documents").insert({
      owner_id: req.user.id,
      title,
      document_type: documentType.slice(0, 60),
      storage_path: storagePath,
      original_filename: safeName(file.originalname),
      mime_type: file.mimetype,
      file_size: file.size,
      status: "ACTIVE",
    }).select("id, title, document_type, original_filename, mime_type, file_size, status, created_at").single();

    if (dbError) {
      await req.userSupabase.storage.from(BUCKET).remove([storagePath]);
      throw dbError;
    }
    return res.status(201).json({ success: true, message: "Dokumen berhasil disimpan secara privat.", document: data });
  } catch (error) {
    console.error("Upload document error:", error.message);
    return res.status(500).json({ success: false, message: "Dokumen belum dapat disimpan. Periksa tabel, bucket, dan kebijakan RLS Supabase." });
  }
});

router.post("/:id/verify", async (req, res) => {
  try {
    const doc = await ownedDocument(req, req.params.id);
    if (!doc || doc.status !== "ACTIVE") return res.status(404).json({ success: false, message: "Dokumen tidak ditemukan atau tidak aktif." });
    const { data: profile, error: profileError } = await req.userSupabase
      .from("docura_citizen_profiles").select("passkey_enabled").eq("user_id", req.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.passkey_enabled) {
      const passkeyProof = req.get("x-passkey-verification") || "";
      if (!consumeActionProof(req.user.id, passkeyProof)) {
        return res.status(403).json({ success: false, requiresPasskey: true, message: "Passkey diperlukan sebelum mengakses dokumen. Lakukan autentikasi passkey dan coba lagi." });
      }
    }
    const token = crypto.randomBytes(32).toString("hex");
    verificationTokens.set(token, { userId: req.user.id, documentId: doc.id, expiresAt: Date.now() + TOKEN_TTL_MS });
    return res.json({ success: true, verificationToken: token, expiresInSeconds: TOKEN_TTL_MS / 1000, message: profile?.passkey_enabled ? "Passkey berhasil diverifikasi. Token akses dokumen berlaku 2 menit dan hanya dapat digunakan sekali." : "Simulasi verifikasi berhasil. Token berlaku 2 menit dan hanya dapat digunakan sekali." });
  } catch (error) {
    console.error("Document verification error:", error.message);
    return res.status(500).json({ success: false, message: "Verifikasi dokumen tidak dapat diproses." });
  }
});

router.post("/:id/access", async (req, res) => {
  const mode = req.body?.mode === "download" ? "download" : "view";
  if (!consumeVerification(req, req.params.id)) return res.status(403).json({ success: false, message: "Verifikasi simulasi diperlukan atau token sudah kedaluwarsa. Ulangi verifikasi." });
  try {
    const doc = await ownedDocument(req, req.params.id);
    if (!doc || doc.status !== "ACTIVE") return res.status(404).json({ success: false, message: "Dokumen tidak ditemukan atau tidak aktif." });
    const { data, error } = await req.userSupabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60, { download: mode === "download" ? doc.original_filename : false });
    if (error) throw error;
    return res.json({ success: true, url: data.signedUrl, expiresInSeconds: 60 });
  } catch (error) {
    console.error("Document access error:", error.message);
    return res.status(500).json({ success: false, message: "Tautan dokumen tidak dapat dibuat." });
  }
});

router.delete("/:id", async (req, res) => {
  if (!consumeVerification(req, req.params.id)) return res.status(403).json({ success: false, message: "Konfirmasi dan simulasi verifikasi diperlukan. Ulangi proses penghapusan." });
  try {
    const doc = await ownedDocument(req, req.params.id);
    if (!doc || doc.status !== "ACTIVE") return res.status(404).json({ success: false, message: "Dokumen tidak ditemukan atau sudah tidak aktif." });

    // Remove the private object first. If the storage operation fails, preserve metadata
    // so the user can retry instead of reporting a false successful deletion.
    const { error: storageError } = await req.userSupabase.storage.from(BUCKET).remove([doc.storage_path]);
    if (storageError) throw storageError;

    const { data, error: deleteError } = await req.userSupabase.from("documents")
      .delete().eq("id", doc.id).eq("owner_id", req.user.id).eq("status", "ACTIVE")
      .select("id").maybeSingle();
    if (deleteError || !data) {
      // The object is already gone; mark metadata pending cleanup rather than leave it
      // looking like an accessible active document.
      await req.userSupabase.from("documents")
        .update({ status: "PENDING_DELETION", deletion_requested_at: new Date().toISOString() })
        .eq("id", doc.id).eq("owner_id", req.user.id);
      if (deleteError) throw deleteError;
      return res.status(409).json({ success: false, message: "File sudah dihapus, tetapi metadata perlu pembersihan ulang. Status dokumen ditandai untuk penghapusan." });
    }
    return res.json({ success: true, message: "Dokumen dan file privat berhasil dihapus." });
  } catch (error) {
    console.error("Document deletion request error:", error.message);
    return res.status(500).json({ success: false, message: "Penghapusan dokumen belum dapat diselesaikan. Periksa Storage dan kebijakan RLS Supabase." });
  }
});

module.exports = router;
