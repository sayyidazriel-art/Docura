# Database — Supabase

Docura V2.9.0 menggunakan Supabase Auth, PostgreSQL, dan Supabase Storage privat.

## Satu file SQL

Semua SQL yang diperlukan untuk instalasi baru sudah digabung menjadi satu file:

**[`install-all.sql`](install-all.sql)**

File tersebut menggabungkan skema dan kebijakan database dari tahap penyimpanan dokumen, role dan audit, pengelolaan kasus, hardening sebelumnya, notifikasi/manajemen petugas V2.7.0, serta penghapusan role Perwakilan V2.8.0. V2.9.0 tidak menambahkan migrasi SQL baru.

### Instalasi proyek baru

1. Buat proyek Supabase khusus untuk demo Docura.
2. Buka **Supabase Dashboard → SQL Editor**.
3. Salin seluruh isi `database/install-all.sql` dan jalankan **satu kali**.
4. Periksa hasilnya dan pastikan tidak ada error.
5. Lanjutkan konfigurasi `.env` dan aplikasi sesuai README utama.

Skrip ini ditujukan untuk proyek Supabase baru/kosong. Jangan jalankan ulang pada database yang sudah digunakan atau berisi data penting. Untuk database existing, backup dahulu dan tinjau migrasi yang sudah diterapkan; skrip all-in-one bukan alat upgrade otomatis.

## Membuat role awal

Untuk membuat akun Admin pertama pada proyek demo:

1. Buat pengguna melalui **Supabase Dashboard → Authentication → Users → Add user**.
2. Salin UUID pengguna tersebut.
3. Jalankan query berikut dengan UUID dan nama yang sesuai:

```sql
insert into public.refugeeledger_user_roles (user_id, role_code, display_name, is_active)
values ('REPLACE-WITH-AUTH-USER-UUID', 'admin', 'Docura Admin', true);
```

Akun warga sebaiknya menggunakan registrasi mandiri. Akun petugas selanjutnya dibuat melalui menu Manajemen Petugas oleh Admin. Jangan memberikan role istimewa melalui registrasi publik.

Role yang didukung:
- `admin`
- `citizen`
- `recovery_officer`
- `supervisor`
- `document_printer`

Role `representative` sudah dihentikan dan tidak termasuk dalam role yang didukung.

## Query pemeriksaan opsional

```sql
select user_id, role_code, display_name, is_active
from public.refugeeledger_user_roles
order by created_at;

select id, status, created_at, assigned_to
from public.refugeeledger_recovery_cases
order by created_at desc;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'citizen-documents';
```

## Catatan penting

- Bucket `citizen-documents` harus tetap privat.
- Pastikan RLS aktif dan jangan menambahkan policy publik yang membuka dokumen atau data kasus.
- `SUPABASE_SERVICE_ROLE_KEY` hanya untuk server dan tidak boleh ditaruh di frontend atau repository publik.
- Gunakan data sintetis untuk demo.
- Perubahan SQL yang digabung tidak membuktikan bahwa database sudah diterapkan pada proyek Supabase tertentu; verifikasi hasil eksekusi di proyek demo.
