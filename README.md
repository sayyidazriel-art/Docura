# Docura V2.9.0

**Docura — Decentralized Object Credential Unification & Risk Audit** adalah prototipe web untuk membantu pengelolaan dan pemulihan dokumen warga terdampak bencana. Sistem menyediakan portal warga, portal petugas, alur pemulihan normal dan darurat, pengelolaan kasus, persetujuan, QR untuk proses penyerahan, dan pencatatan aktivitas.

> **Status proyek:** prototipe/demo. Jangan gunakan data pribadi, dokumen identitas asli, atau data biometrik sungguhan. Integrasi langsung ke sistem pemerintah, pembandingan sidik jari dengan referensi KTP-el, blockchain, dan Zero-Knowledge Proof (ZKP) belum diimplementasikan.

## Fitur utama

### Portal warga
- Registrasi dan autentikasi warga melalui Supabase Auth.
- Pengelolaan dokumen pribadi melalui Supabase Storage privat.
- Alur pemulihan mandiri yang tersedia pada aplikasi.
- Informasi proses pemulihan sesuai kemampuan portal yang sudah tersedia.

### Portal petugas
- **Petugas Pemulihan (`recovery_officer`)**: membuat dan memproses kasus pemulihan.
- **Supervisor (`supervisor`)**: meninjau, menyetujui, atau menolak kasus sesuai alur aplikasi.
- **Pencetak Dokumen (`document_printer`)**: melanjutkan proses QR, pencetakan, dan penyerahan dokumen yang disetujui.
- Autentikasi passkey/WebAuthn untuk alur yang didukung.
- Mode pemulihan Normal dan Emergency sesuai pengaturan aplikasi.
- Notifikasi operasional antarp etugas dan notifikasi administratif.
- Bukti pemulihan (*Recovery Receipt*) untuk kasus yang selesai, dapat dicetak atau disimpan sebagai PDF melalui browser.

### Portal Admin
- Manajemen akun petugas dan penetapan role petugas.
- Pengawasan aktivitas dan pengaturan Emergency Mode sesuai kewenangan aplikasi.
- Dashboard analitik operasional yang hanya tersedia bagi Admin.
- Notifikasi administratif, termasuk pendaftaran warga baru.
- Admin tidak membuat akun warga; warga mendaftar sendiri.

### Aksesibilitas dan antarmuka
- Antarmuka Bahasa Indonesia dan Inggris pada bagian aplikasi yang telah diterjemahkan.
- Kontrol ukuran teks dan mode kontras tinggi.
- UI responsif untuk desktop dan ponsel.
- Role gabungan **Perwakilan (`representative`) sudah dihapus**. Role petugas yang didukung adalah Petugas Pemulihan, Supervisor, dan Pencetak Dokumen.

### QR, passkey, dan biometrik
- Alur QR digunakan untuk proses penyerahan dokumen.
- Pilihan simulasi integrasi referensi KTP-el seperti **Cocok / Tidak cocok / Penyedia tidak tersedia** telah dihapus dari alur QR/pencetakan.
- WebAuthn/passkey menggunakan autentikator lokal yang didukung perangkat. Aplikasi tidak menerima atau membaca data sidik jari mentah dari sistem operasi.
- Simulasi pemeriksaan identitas pada bagian alur kasus, jika ditampilkan, tetap merupakan simulasi dan bukan verifikasi biometrik pemerintah.

## Teknologi
- **Backend:** Node.js, Express.
- **Frontend:** HTML, CSS, JavaScript.
- **Auth & database:** Supabase Auth dan PostgreSQL.
- **Penyimpanan dokumen:** Supabase Storage dengan bucket privat dan kebijakan akses.
- **Autentikasi perangkat:** WebAuthn/passkey pada alur yang didukung.
- **QR:** library `qrcode`.
- **Pengujian:** Node.js built-in test runner.

## Persyaratan
- Node.js 20 atau lebih baru (disarankan versi LTS).
- npm.
- Proyek Supabase untuk demo.
- Git jika ingin melakukan clone repository.

## Instalasi lokal

### 1. Dapatkan source code

```bash
git clone <URL-REPOSITORY-GITHUB-LO>
cd docura
```

Atau unduh ZIP repository dari GitHub, ekstrak, lalu jalankan perintah dari folder yang berisi `package.json`.

### 2. Siapkan database Supabase

1. Buat proyek Supabase khusus untuk demo Docura.
2. Buka **Supabase Dashboard → SQL Editor**.
3. Buka file [`database/install-all.sql`](database/install-all.sql), salin seluruh isinya, lalu jalankan **satu kali** pada proyek Supabase yang masih baru/kosong.
4. Periksa hasil eksekusi dan pastikan tidak ada error SQL.
5. Gunakan [`database/README.md`](database/README.md) untuk langkah setup database dan penetapan role.

> `database/install-all.sql` adalah satu-satunya file SQL yang disediakan untuk instalasi baru. Jangan menjalankan file ini pada database Docura yang sudah berisi data. Untuk database yang sudah ada, buat backup dan tinjau perbedaan skema terlebih dahulu; jangan menganggap skrip instalasi baru sebagai migrasi upgrade otomatis.

### 3. Konfigurasi environment

Salin `.env.example` menjadi `.env`.

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

**macOS/Linux:**

```bash
cp .env.example .env
```

Isi variabel berikut berdasarkan proyek Supabase milik sendiri:

```dotenv
PORT=3000
PUBLIC_APP_URL=http://localhost:3000
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
WEBAUTHN_ORIGIN=http://localhost:3000
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_NAME=Docura
```

`SUPABASE_SERVICE_ROLE_KEY` diperlukan untuk operasi server tertentu seperti pengelolaan akun petugas dan operasi WebAuthn yang membutuhkan hak server. Simpan hanya di `.env` server. **Jangan pernah memasukkan key tersebut ke JavaScript frontend, GitHub, screenshot, atau membagikannya.** File `.env` sudah diabaikan oleh `.gitignore`.

Jika konfigurasi Supabase Auth memerlukan URL redirect, tambahkan URL lokal yang digunakan aplikasi ke daftar redirect URL yang diizinkan.

### 4. Instal dependensi dan jalankan aplikasi

```bash
npm install
npm test
npm start
```

Buka `http://localhost:3000`. Untuk mode pengembangan dengan auto-reload:

```bash
npm run dev
```

Hentikan server dengan `Ctrl+C`.

## Akun dan role demo

Gunakan akun terpisah untuk setiap role. Pembuatan akun warga dilakukan melalui registrasi mandiri. Akun petugas dikelola oleh Admin melalui fitur Manajemen Petugas. Untuk akun Admin pertama pada proyek demo, buat pengguna melalui Supabase Auth lalu tetapkan role `admin` menggunakan SQL sesuai panduan [`database/README.md`](database/README.md).

| Role code | Fungsi |
|---|---|
| `citizen` | Portal warga dan dokumen milik sendiri |
| `recovery_officer` | Membuat dan memproses kasus pemulihan |
| `supervisor` | Meninjau dan memutuskan persetujuan kasus |
| `document_printer` | Proses QR, pencetakan, dan penyerahan dokumen |
| `admin` | Pengawasan, pengaturan administratif, manajemen petugas, dan analitik |

Jangan memberikan role istimewa melalui registrasi publik. Role ditetapkan melalui mekanisme administratif yang didukung aplikasi.

## Urutan demo yang disarankan

1. Jelaskan tujuan Docura dan tegaskan bahwa aplikasi adalah prototipe.
2. Tampilkan landing page dan registrasi/portal warga menggunakan data fiktif.
3. Peragakan unggah dokumen contoh sintetis (PDF/JPEG/PNG; maksimum 10 MiB jika batas ini diaktifkan pada konfigurasi saat ini).
4. Masuk sebagai Petugas Pemulihan dan buat kasus demo.
5. Tunjukkan alur pemeriksaan kasus dan jelaskan dengan jujur bagian mana yang masih berupa simulasi.
6. Masuk sebagai Supervisor untuk meninjau dan menyetujui/menolak kasus.
7. Masuk sebagai Pencetak Dokumen untuk meneruskan alur QR dan penyerahan.
8. Tunjukkan Recovery Receipt untuk kasus selesai.
9. Masuk sebagai Admin untuk melihat notifikasi, mengelola akun petugas, mengawasi Emergency Mode, dan membuka analitik.
10. Jelaskan bahwa Docura belum terhubung ke biometrik pemerintah, blockchain, atau ZKP.

## Struktur proyek

```text
 docura/
 ├── public/       # Halaman HTML, CSS, dan JavaScript frontend
 ├── src/
 │   ├── config/   # Konfigurasi Supabase
 │   ├── middleware/
 │   ├── routes/   # Endpoint aplikasi
 │   └── services/ # WebAuthn, audit, validasi, dan layanan pendukung
 ├── database/
 │   ├── install-all.sql  # Satu skrip SQL instalasi database baru
 │   └── README.md        # Panduan Supabase dan role
 ├── docs/         # Changelog dan panduan demo
 ├── tests/        # Pengujian otomatis
 ├── .env.example
 ├── .gitignore
 ├── package.json
 └── README.md
```

## Keamanan dan privasi

- Gunakan hanya nama, akun, dan dokumen fiktif untuk demo.
- Pertahankan bucket `citizen-documents` sebagai **private**.
- Jangan commit `.env`, kredensial, token, dokumen identitas asli, data biometrik, atau dump database.
- Pastikan kebijakan Row Level Security (RLS) tetap aktif dan tinjau hak akses untuk proyek Supabase yang digunakan.
- Kunci service-role hanya boleh tersedia di server. Key tersebut melewati RLS dan tidak boleh diekspos kepada browser atau pengguna.
- Gunakan HTTPS dan pengelolaan secret yang layak sebelum deployment publik.
- Repository ini merupakan prototipe dan belum menjalani audit keamanan independen atau penerimaan produksi secara menyeluruh.

## Batasan yang diketahui

- Belum ada integrasi langsung dengan layanan identitas atau biometrik pemerintah, termasuk pencocokan sidik jari dengan referensi KTP-el.
- Pilihan hasil simulasi pencocokan KTP-el telah dihapus dari alur QR/pencetakan.
- WebAuthn/passkey mengandalkan autentikator lokal pada perangkat; aplikasi tidak memperoleh data sidik jari mentah.
- Blockchain dan Zero-Knowledge Proof (ZKP) belum diimplementasikan.
- Dukungan terjemahan Bahasa Inggris belum mencakup setiap pesan khusus pada seluruh alur.
- Pengujian otomatis tidak menggantikan pengujian integrasi pada proyek Supabase dan perangkat demo milik pengguna.

## Dokumentasi tambahan

- [`database/README.md`](database/README.md) — setup database Supabase dan role.
- [`docs/DEMO-GUIDE.md`](docs/DEMO-GUIDE.md) — panduan persiapan dan urutan demo.

## Lisensi

Belum ada lisensi open-source yang ditetapkan secara eksplisit. Tambahkan file `LICENSE` sebelum menyatakan bahwa kode ini dapat digunakan ulang atau didistribusikan berdasarkan lisensi tertentu.
