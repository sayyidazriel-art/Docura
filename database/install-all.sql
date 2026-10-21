-- DOCURA — COMPLETE SUPABASE INSTALLATION
-- Intended for a NEW / DEDICATED Supabase project for the current Stage 9 prototype.
-- Review database/README.md and README.md before running.
-- Run this file ONCE in Supabase Dashboard > SQL Editor.
-- Do not run this combined file and then re-run the individual migrations on the same fresh database unless you know why.
-- Use synthetic demo data only. Back up existing projects before migrations.


-- =====================================================================
-- Stage 5 — Document Storage
-- Source migration: stage5-document-storage.sql
-- =====================================================================

-- RefugeeLedger Stage 5: private citizen document storage
-- Jalankan melalui Supabase Dashboard > SQL Editor pada project yang benar.
-- Jangan membuat bucket public. Dokumen demo sebaiknya memakai file sintetis.

create extension if not exists pgcrypto;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title varchar(120) not null check (char_length(title) between 2 and 120),
  document_type varchar(60) not null default 'Lainnya',
  storage_path text not null unique,
  original_filename varchar(100) not null,
  mime_type varchar(100) not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PENDING_DELETION')),
  created_at timestamptz not null default now(),
  deletion_requested_at timestamptz,
  constraint documents_owner_path check (storage_path like owner_id::text || '/%')
);

create index if not exists documents_owner_created_idx
  on public.documents (owner_id, created_at desc);

alter table public.documents enable row level security;

-- Hak SQL dasar untuk role authenticated; RLS tetap membatasi baris per pemilik.
grant select, insert, update, delete on public.documents to authenticated;

-- Hapus kebijakan bernama sama agar skrip aman dijalankan ulang.
drop policy if exists "Citizens can read own documents" on public.documents;
drop policy if exists "Citizens can insert own documents" on public.documents;
drop policy if exists "Citizens can update own documents" on public.documents;
drop policy if exists "Citizens can delete own documents" on public.documents;
create policy "Citizens can read own documents"
  on public.documents for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Citizens can insert own documents"
  on public.documents for insert to authenticated
  with check (owner_id = (select auth.uid()) and storage_path like (select auth.uid())::text || '/%');
create policy "Citizens can update own documents"
  on public.documents for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Citizens can delete own documents"
  on public.documents for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Private Storage bucket, batas ukuran 10 MiB, hanya PDF/JPEG/PNG.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('citizen-documents', 'citizen-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

drop policy if exists "Citizens can upload own private documents" on storage.objects;
drop policy if exists "Citizens can read own private documents" on storage.objects;
drop policy if exists "Citizens can delete own private documents" on storage.objects;
create policy "Citizens can upload own private documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'citizen-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Citizens can read own private documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'citizen-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Citizens can delete own private documents"
  on storage.objects for delete to authenticated
  using (bucket_id = 'citizen-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);


-- =====================================================================
-- Stage 7B — User Roles and Audit Logs
-- Source migration: stage7b-officer-roles.sql
-- =====================================================================

-- RefugeeLedger Stage 7B: officer role registry and protected audit log.
-- Run in Supabase SQL Editor after Stage 5 schema is installed.
-- Officer accounts must be created manually in Supabase Auth; public registration never grants officer privileges.

begin;

create table if not exists public.refugeeledger_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role_code text not null check (role_code in (
    'citizen', 'admin', 'recovery_officer', 'document_printer', 'supervisor'
  )),
  display_name text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.refugeeledger_user_roles enable row level security;
revoke all on public.refugeeledger_user_roles from anon;
grant select on public.refugeeledger_user_roles to authenticated;
drop policy if exists "Users can read own RefugeeLedger role" on public.refugeeledger_user_roles;
create policy "Users can read own RefugeeLedger role"
  on public.refugeeledger_user_roles for select to authenticated
  using (user_id = auth.uid());
-- Deliberately no client INSERT/UPDATE/DELETE policies. Role assignment is admin/operator-controlled in SQL.

create table if not exists public.refugeeledger_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.refugeeledger_audit_logs enable row level security;
revoke all on public.refugeeledger_audit_logs from anon, authenticated;
-- No direct client policies: audit log writes will be added with server-side DB integration in a later stage.

commit;

-- SETUP INSTRUCTIONS:
-- 1. Create each staff account in Supabase Dashboard > Authentication > Users > Add user.
-- 2. Copy the user's UUID and insert one role row per account using the template below.
-- 3. Never assign officer roles through public registration or client-side code.
--
-- insert into public.refugeeledger_user_roles (user_id, role_code, display_name)
-- values ('PASTE-AUTH-USER-UUID-HERE', 'recovery_officer', 'Petugas Pemulihan');
--
-- Role codes: recovery_officer, document_printer, supervisor, admin, citizen.


-- =====================================================================
-- Stage 7D — Server-side Case Management
-- Source migration: stage7d-case-management.sql
-- =====================================================================

-- RefugeeLedger Stage 7D: server-side case management and role enforcement
-- Run once in Supabase Dashboard > SQL Editor for the same project as the app.
-- Use synthetic demo data only. This migration does not require a service-role key.

begin;

create extension if not exists pgcrypto;

create table if not exists public.refugeeledger_recovery_cases (
  id text primary key,
  citizen_code varchar(40) not null,
  citizen_name varchar(100) not null,
  location varchar(100) not null,
  disaster varchar(40) not null,
  documents text[] not null default array['Dokumen pendukung demo.pdf']::text[],
  status text not null default 'OPEN' check (status in ('OPEN','IDENTITY_CHECK','DOCUMENT_REVIEW','APPROVED','REJECTED','PRINT_PENDING','COMPLETED','CANCELLED')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  note varchar(500) not null default '',
  identity_checked boolean not null default false,
  review_note varchar(500) not null default '',
  assigned_to uuid references auth.users(id) on delete set null,
  assignment_started_at timestamptz,
  qr_token_hash text,
  qr_issued_at timestamptz,
  qr_expires_at timestamptz,
  qr_used_at timestamptz,
  citizen_user_id uuid references auth.users(id) on delete set null,
  recovery_channel text not null default 'OFFICE' check (recovery_channel in ('OFFICE','STAFF_DEMO'))
);

-- Safe additions when upgrading from an earlier Stage 7D draft.
alter table public.refugeeledger_recovery_cases add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table public.refugeeledger_recovery_cases add column if not exists assignment_started_at timestamptz;
alter table public.refugeeledger_recovery_cases add column if not exists qr_token_hash text;
alter table public.refugeeledger_recovery_cases add column if not exists qr_issued_at timestamptz;
alter table public.refugeeledger_recovery_cases add column if not exists qr_expires_at timestamptz;
alter table public.refugeeledger_recovery_cases add column if not exists qr_used_at timestamptz;
alter table public.refugeeledger_recovery_cases add column if not exists citizen_user_id uuid references auth.users(id) on delete set null;
alter table public.refugeeledger_recovery_cases add column if not exists recovery_channel text not null default 'OFFICE';

create index if not exists refugeeledger_cases_status_created_idx
  on public.refugeeledger_recovery_cases(status, created_at desc);

-- At most one non-terminal case may be actively assigned to a staff member.
create unique index if not exists refugeeledger_one_active_case_per_staff_idx
  on public.refugeeledger_recovery_cases(assigned_to)
  where assigned_to is not null and status not in ('COMPLETED','CANCELLED','REJECTED');

create table if not exists public.refugeeledger_officer_settings (
  id integer primary key check (id = 1),
  emergency_mode boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.refugeeledger_officer_settings (id, emergency_mode)
values (1, false) on conflict (id) do nothing;

alter table public.refugeeledger_recovery_cases enable row level security;
alter table public.refugeeledger_officer_settings enable row level security;

-- The retired combined Representative role is not supported in V2.8.0.
delete from public.refugeeledger_user_roles where role_code = 'representative';
alter table public.refugeeledger_user_roles drop constraint if exists refugeeledger_user_roles_role_code_check;
alter table public.refugeeledger_user_roles add constraint refugeeledger_user_roles_role_code_check
  check (role_code in ('citizen','admin','recovery_officer','document_printer','supervisor'));

-- Staff can read shared case data. Direct writes are intentionally denied;
-- all writes must go through the validated RPC below.
grant select on public.refugeeledger_recovery_cases to authenticated;
grant select on public.refugeeledger_officer_settings to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.refugeeledger_recovery_cases from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.refugeeledger_officer_settings from anon, authenticated;

drop policy if exists "Active RefugeeLedger officers can read cases" on public.refugeeledger_recovery_cases;
create policy "Active RefugeeLedger officers can read cases"
  on public.refugeeledger_recovery_cases for select to authenticated
  using (
    exists (
      select 1 from public.refugeeledger_user_roles r
      where r.user_id = (select auth.uid())
        and r.is_active = true
        and r.role_code in ('admin','recovery_officer','document_printer','supervisor')
        and (
          r.role_code = 'admin'
          or not coalesce((select s.emergency_mode from public.refugeeledger_officer_settings s where s.id = 1), false)
          or status in ('COMPLETED','CANCELLED','REJECTED')
          or assigned_to = (select auth.uid())
        )
    )
  );

drop policy if exists "Citizens can read own recovery requests" on public.refugeeledger_recovery_cases;
create policy "Citizens can read own recovery requests"
  on public.refugeeledger_recovery_cases for select to authenticated
  using (citizen_user_id = (select auth.uid()));

drop policy if exists "Active RefugeeLedger officers can read settings" on public.refugeeledger_officer_settings;
create policy "Active RefugeeLedger officers can read settings"
  on public.refugeeledger_officer_settings for select to authenticated
  using (exists (
    select 1 from public.refugeeledger_user_roles r
    where r.user_id = (select auth.uid())
      and r.is_active = true
      and r.role_code in ('admin','recovery_officer','document_printer','supervisor')
  ));

-- Citizen office-based recovery request. Self-recovery/document storage remains separate.
create or replace function public.citizen_request_office_recovery(p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_role_active boolean;
  v_name text;
  v_email text;
  v_code text;
  v_location text := trim(coalesce(p_payload->>'location',''));
  v_disaster text := left(coalesce(nullif(trim(p_payload->>'disaster'),''),'Bencana lain'),40);
  v_note text := left(trim(coalesce(p_payload->>'note','')),500);
  v_case_id text;
begin
  if v_user_id is null then raise exception 'RL: Sesi warga tidak valid.' using errcode = '42501'; end if;
  select role_code, is_active into v_role, v_role_active from public.refugeeledger_user_roles where user_id=v_user_id;
  if found and not coalesce(v_role_active,false) then raise exception 'RL: Akun tidak aktif.' using errcode = '42501'; end if;
  if v_role is not null and v_role <> 'citizen' then raise exception 'RL: Akun petugas tidak dapat mengajukan permintaan sebagai warga.' using errcode = '42501'; end if;
  if length(v_location)<2 or length(v_location)>100 then raise exception 'RL: Lokasi terdampak harus berisi 2–100 karakter.' using errcode = '22023'; end if;
  if exists(select 1 from public.refugeeledger_recovery_cases c where c.citizen_user_id=v_user_id and c.status not in ('COMPLETED','CANCELLED','REJECTED')) then
    raise exception 'RL: Anda masih memiliki permintaan pemulihan kantor yang aktif.' using errcode = '22023';
  end if;
  select coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''), split_part(email,'@',1)), email
    into v_name, v_email from auth.users where id=v_user_id;
  v_name := left(coalesce(nullif(trim(v_name),''),'Warga'),100);
  v_code := 'RL-WRG-' || upper(substr(replace(v_user_id::text,'-',''),1,8));
  v_case_id := 'RFL-REC-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into public.refugeeledger_recovery_cases(
    id,citizen_code,citizen_name,location,disaster,documents,status,created_by,updated_by,note,citizen_user_id,recovery_channel
  ) values (
    v_case_id,v_code,v_name,v_location,v_disaster,array[]::text[],'OPEN',v_user_id,v_user_id,v_note,v_user_id,'OFFICE'
  );
  insert into public.refugeeledger_audit_logs(actor_id,event_type,target_type,target_id,details)
    values (v_user_id,'citizen-office-recovery-requested','recovery_case',v_case_id,jsonb_build_object('channel','OFFICE','location',v_location));
  return jsonb_build_object('caseId',v_case_id,'status','OPEN','citizenCode',v_code);
end;
$$;
revoke all on function public.citizen_request_office_recovery(jsonb) from public, anon, authenticated;

-- Server-side action dispatcher. The role and transition checks are repeated here,
-- so a caller cannot bypass them by editing browser JavaScript or calling the API directly.
create or replace function public.officer_case_action(
  p_action text,
  p_case_id text default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_case public.refugeeledger_recovery_cases%rowtype;
  v_new_id text;
  v_note text;
  v_emergency boolean;
  v_allowed boolean := false;
  v_from_status text;
  v_to_status text;
  v_qr_token text;
  v_emergency_case boolean := false;
begin
  if v_user_id is null then
    raise exception 'RL: Sesi tidak valid. Silakan login kembali.' using errcode = '42501';
  end if;

  select role_code into v_role
  from public.refugeeledger_user_roles
  where user_id = v_user_id and is_active = true
    and role_code in ('admin','recovery_officer','document_printer','supervisor');

  if v_role is null then
    raise exception 'RL: Akun tidak memiliki akses petugas aktif.' using errcode = '42501';
  end if;

  select emergency_mode into v_emergency from public.refugeeledger_officer_settings where id = 1;
  v_allowed := case p_action
    when 'new-case' then (v_role = 'recovery_officer' or (coalesce(v_emergency,false) and v_role in ('admin','recovery_officer','document_printer','supervisor')))
    when 'face-scan' then (v_role = 'recovery_officer' or (coalesce(v_emergency,false) and v_role in ('admin','recovery_officer','document_printer','supervisor')))
    when 'move-review' then (v_role = 'recovery_officer' or (coalesce(v_emergency,false) and v_role in ('admin','recovery_officer','document_printer','supervisor')))
    when 'edit-note' then (v_role in ('recovery_officer','supervisor') or (coalesce(v_emergency,false) and v_role in ('admin','recovery_officer','document_printer','supervisor')))
    when 'cancel-case' then (v_role in ('recovery_officer','supervisor') or (coalesce(v_emergency,false) and v_role in ('admin','recovery_officer','document_printer','supervisor')))
    when 'approve' then (v_role in ('admin','supervisor') or (coalesce(v_emergency,false) and v_role in ('recovery_officer','document_printer')))
    when 'reject' then (v_role in ('admin','supervisor') or (coalesce(v_emergency,false) and v_role in ('recovery_officer','document_printer')))
    when 'print-pending' then (v_role in ('admin','document_printer') or (coalesce(v_emergency,false) and v_role in ('recovery_officer','supervisor')))
    when 'complete' then (v_role in ('admin','document_printer') or (coalesce(v_emergency,false) and v_role in ('recovery_officer','supervisor')))
    when 'emergency-toggle' then v_role = 'admin'
    else false
  end;

  if not v_allowed then
    raise exception 'RL: Role Anda tidak memiliki kewenangan untuk tindakan ini.' using errcode = '42501';
  end if;

  if p_action = 'emergency-toggle' then
    select emergency_mode into v_emergency from public.refugeeledger_officer_settings where id = 1 for update;
    if v_emergency then
      if exists (select 1 from public.refugeeledger_recovery_cases where status not in ('COMPLETED','CANCELLED','REJECTED')) then
        raise exception 'RL: Selesaikan atau batalkan kasus aktif sebelum mematikan Emergency Mode.' using errcode = '22023';
      end if;
      v_emergency := false;
    else
      v_emergency := true;
    end if;
    update public.refugeeledger_officer_settings
      set emergency_mode = v_emergency, updated_at = now(), updated_by = v_user_id where id = 1;
    insert into public.refugeeledger_audit_logs(actor_id,event_type,target_type,target_id,details)
      values (v_user_id,'emergency-toggle','settings','1',jsonb_build_object('emergency_mode',v_emergency,'role',v_role));
    return jsonb_build_object('emergencyMode',v_emergency);
  end if;

  if p_action = 'new-case' then
    -- Serialize Emergency Mode claims. Normal Mode cases are not assigned exclusively
    -- to the creating officer, so officers can register multiple cases.
    select emergency_mode into v_emergency from public.refugeeledger_officer_settings where id = 1 for update;
    if coalesce(v_emergency,false) and exists (select 1 from public.refugeeledger_recovery_cases c where c.assigned_to = v_user_id and c.status not in ('COMPLETED','CANCELLED','REJECTED')) then
      raise exception 'RL: Selesaikan kasus darurat aktif Anda sebelum membuat kasus baru.' using errcode = '22023';
    end if;
    if length(trim(coalesce(p_payload->>'citizenName',''))) < 2 or length(trim(coalesce(p_payload->>'citizenName',''))) > 100
       or length(trim(coalesce(p_payload->>'citizenCode',''))) < 1 or length(trim(coalesce(p_payload->>'citizenCode',''))) > 40
       or length(trim(coalesce(p_payload->>'location',''))) < 1 or length(trim(coalesce(p_payload->>'location',''))) > 100 then
      raise exception 'RL: Nama warga, kode warga, atau lokasi tidak valid.' using errcode = '22023';
    end if;
    v_new_id := 'RFL-REC-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
    insert into public.refugeeledger_recovery_cases(
      id,citizen_code,citizen_name,location,disaster,documents,status,created_by,updated_by,note,assigned_to,assignment_started_at,recovery_channel
    ) values (
      v_new_id,
      trim(p_payload->>'citizenCode'),
      trim(p_payload->>'citizenName'),
      trim(p_payload->>'location'),
      left(coalesce(nullif(trim(p_payload->>'disaster'),''),'Bencana lain'),40),
      array['Dokumen pendukung demo.pdf']::text[],
      'OPEN',v_user_id,v_user_id,left(coalesce(p_payload->>'note',''),500),case when coalesce(v_emergency,false) then v_user_id else null end,case when coalesce(v_emergency,false) then now() else null end,'STAFF_DEMO'
    ) returning * into v_case;
    insert into public.refugeeledger_audit_logs(actor_id,event_type,target_type,target_id,details)
      values (v_user_id,'case-created','recovery_case',v_case.id,jsonb_build_object('role',v_role,'status',v_case.status));
    return jsonb_build_object('case',jsonb_build_object('id',v_case.id,'status',v_case.status));
  end if;

  select * into v_case from public.refugeeledger_recovery_cases where id = p_case_id for update;
  if not found then
    raise exception 'RL: Kasus tidak ditemukan.' using errcode = 'P0002';
  end if;
  v_from_status := v_case.status;
  v_to_status := v_case.status;
  v_emergency_case := coalesce(v_emergency,false);

  if v_case.status not in ('COMPLETED','CANCELLED','REJECTED') then
    if exists (select 1 from public.refugeeledger_recovery_cases c where c.assigned_to = v_user_id and c.id <> v_case.id and c.status not in ('COMPLETED','CANCELLED','REJECTED')) then
      raise exception 'RL: Anda masih memiliki satu kasus aktif. Selesaikan atau serahkan kasus tersebut terlebih dahulu.' using errcode = '22023';
    end if;
    if v_case.assigned_to is not null and v_case.assigned_to <> v_user_id then
      raise exception 'RL: Kasus sedang ditangani petugas lain.' using errcode = '42501';
    end if;
    if v_case.assigned_to is null and coalesce(v_emergency,false) then
      update public.refugeeledger_recovery_cases set assigned_to=v_user_id, assignment_started_at=now() where id=p_case_id returning * into v_case;
    end if;
  end if;

  if p_action = 'face-scan' then
    if v_case.status not in ('OPEN','IDENTITY_CHECK') then
      raise exception 'RL: Simulasi identitas hanya dapat dilakukan pada kasus terbuka atau pemeriksaan identitas.' using errcode = '22023';
    end if;
    update public.refugeeledger_recovery_cases set identity_checked = true, status = 'IDENTITY_CHECK', updated_at = now(), updated_by = v_user_id where id = p_case_id returning * into v_case;
  elsif p_action = 'move-review' then
    if not v_case.identity_checked or v_case.status not in ('OPEN','IDENTITY_CHECK') then
      raise exception 'RL: Selesaikan simulasi identitas sebelum meneruskan kasus ke tinjauan dokumen.' using errcode = '22023';
    end if;
    update public.refugeeledger_recovery_cases set status = 'DOCUMENT_REVIEW', assigned_to = case when v_emergency_case then v_user_id else null end, assignment_started_at = case when v_emergency_case then assignment_started_at else null end, updated_at = now(), updated_by = v_user_id where id = p_case_id returning * into v_case;
  elsif p_action = 'approve' then
    if v_case.status <> 'DOCUMENT_REVIEW' then raise exception 'RL: Hanya kasus dalam tinjauan dokumen yang dapat disetujui.' using errcode = '22023'; end if;
    v_note := left(trim(coalesce(p_payload->>'note','')),500);
    v_qr_token := encode(gen_random_bytes(32),'hex');
    update public.refugeeledger_recovery_cases set status='APPROVED', review_note=coalesce(nullif(v_note,''),'Disetujui oleh pengawas.'), qr_token_hash=encode(digest(v_qr_token,'sha256'),'hex'), qr_issued_at=now(), qr_expires_at=now()+interval '30 minutes', qr_used_at=null, assigned_to=case when v_emergency_case then v_user_id else null end, assignment_started_at=case when v_emergency_case then assignment_started_at else null end, updated_at=now(), updated_by=v_user_id where id=p_case_id returning * into v_case;
  elsif p_action = 'reject' then
    v_note := left(trim(coalesce(p_payload->>'note','')),500);
    if v_case.status <> 'DOCUMENT_REVIEW' then raise exception 'RL: Hanya kasus dalam tinjauan dokumen yang dapat ditolak.' using errcode = '22023'; end if;
    if v_note = '' then raise exception 'RL: Catatan wajib diisi saat menolak kasus.' using errcode = '22023'; end if;
    update public.refugeeledger_recovery_cases set status='REJECTED', review_note=v_note, assigned_to=null, assignment_started_at=null, updated_at=now(), updated_by=v_user_id where id=p_case_id returning * into v_case;
  elsif p_action = 'edit-note' then
    v_note := left(trim(coalesce(p_payload->>'note','')),500);
    update public.refugeeledger_recovery_cases set review_note=v_note, assigned_to=case when v_emergency_case then v_user_id else null end, assignment_started_at=case when v_emergency_case then assignment_started_at else null end, updated_at=now(), updated_by=v_user_id where id=p_case_id returning * into v_case;
  elsif p_action = 'cancel-case' then
    if v_case.status in ('COMPLETED','CANCELLED','REJECTED') then raise exception 'RL: Kasus sudah ditutup dan tidak dapat dibatalkan.' using errcode = '22023'; end if;
    update public.refugeeledger_recovery_cases set status='CANCELLED', assigned_to=null, assignment_started_at=null, updated_at=now(), updated_by=v_user_id where id=p_case_id returning * into v_case;
  elsif p_action = 'print-pending' then
    if v_case.status <> 'APPROVED' then raise exception 'RL: Hanya kasus yang disetujui yang dapat masuk antrean cetak.' using errcode = '22023'; end if;
    if coalesce(p_payload->>'qrToken','') = '' or v_case.qr_token_hash is null then raise exception 'RL: QR Code wajib dipindai sebelum dokumen diproses.' using errcode = '22023'; end if;
    if v_case.qr_used_at is not null then raise exception 'RL: QR Code sudah pernah digunakan.' using errcode = '22023'; end if;
    if v_case.qr_expires_at is null or v_case.qr_expires_at < now() then raise exception 'RL: QR Code sudah kedaluwarsa. Minta persetujuan dan QR baru.' using errcode = '22023'; end if;
    if encode(digest(p_payload->>'qrToken','sha256'),'hex') <> v_case.qr_token_hash then raise exception 'RL: QR Code tidak valid untuk kasus ini.' using errcode = '22023'; end if;
    update public.refugeeledger_recovery_cases set status='PRINT_PENDING', qr_used_at=now(), updated_at=now(), updated_by=v_user_id where id=p_case_id returning * into v_case;
  elsif p_action = 'complete' then
    if v_case.status <> 'PRINT_PENDING' then raise exception 'RL: Hanya kasus dalam antrean cetak yang dapat diselesaikan.' using errcode = '22023'; end if;
    update public.refugeeledger_recovery_cases set status='COMPLETED', assigned_to=null, assignment_started_at=null, updated_at=now(), updated_by=v_user_id where id=p_case_id returning * into v_case;
  else
    raise exception 'RL: Aksi tidak didukung.' using errcode = '22023';
  end if;

  v_to_status := v_case.status;
  insert into public.refugeeledger_audit_logs(actor_id,event_type,target_type,target_id,details)
    values (v_user_id,'case-' || p_action,'recovery_case',v_case.id,
      jsonb_build_object('role',v_role,'from_status',v_from_status,'to_status',v_to_status,
        'note',case when p_action in ('approve','reject','edit-note') then v_case.review_note else null end));
  return jsonb_build_object('case',jsonb_build_object('id',v_case.id,'status',v_case.status,'identityChecked',v_case.identity_checked), 'qrToken', case when p_action='approve' then v_qr_token else null end, 'qrExpiresAt', case when p_action='approve' then v_case.qr_expires_at else null end);
end;
$$;

revoke all on function public.officer_case_action(text,text,jsonb) from public, anon;
grant execute on function public.officer_case_action(text,text,jsonb) to authenticated;

-- Add three synthetic cases only when the table is empty; never import real personal data.
insert into public.refugeeledger_recovery_cases
  (id,citizen_code,citizen_name,location,disaster,documents,status,created_at,note,identity_checked,review_note)
select seed.id,seed.citizen_code,seed.citizen_name,seed.location,seed.disaster,seed.documents,seed.status,seed.created_at,seed.note,seed.identity_checked,seed.review_note
from (values
 ('RFL-REC-2601','RFL-2026-001','Budi Santoso','Desa Sukamaju','Banjir',array['Kartu Keluarga.pdf','Kartu Identitas Demo.pdf']::text[],'OPEN','2026-10-16 08:40:00+00'::timestamptz,'Dokumen keluarga terdampak banjir; perlu pemeriksaan petugas.',false,''),
 ('RFL-REC-2602','RFL-2026-002','Siti Rahmawati','Desa Mekarsari','Longsor',array['Surat Keterangan.pdf']::text[],'IDENTITY_CHECK','2026-10-17 10:15:00+00'::timestamptz,'Warga melaporkan dokumen identitas rusak.',false,''),
 ('RFL-REC-2603','RFL-2026-003','Ahmad Fauzi','Desa Sukamaju','Banjir',array['Surat Keterangan.pdf','Dokumen Keluarga.pdf','Bukti Kepemilikan.pdf']::text[],'DOCUMENT_REVIEW','2026-10-18 06:30:00+00'::timestamptz,'Menunggu peninjauan dokumen pendukung.',true,'')
) as seed(id,citizen_code,citizen_name,location,disaster,documents,status,created_at,note,identity_checked,review_note)
where not exists (select 1 from public.refugeeledger_recovery_cases);

commit;

-- After running this migration:
-- 1. Restart the Node server.
-- 2. Sign in with an active staff account.
-- 3. In Normal Mode, Recovery Officers can create cases; Emergency Mode grants all four staff roles the full operational workflow.
-- 4. Emergency Mode can only be toggled by Admin. Each staff member can hold one active case assignment at a time.
-- 5. Test role permissions with separate accounts. Case changes persist centrally in Supabase.


-- =====================================================================
-- Stage 8A — Normal Mode Multi-case Support
-- Source migration: stage8a-normal-multicase-popup-fix.sql
-- =====================================================================

-- Docura Stage 8A: Normal Mode multi-case support and Emergency Mode assignment guard.
-- Apply once in Supabase SQL Editor after Stage 7D.
-- In Normal Mode, active cases are not exclusively assigned to their creator.
-- In Emergency Mode, one active case per staff member remains enforced.
begin;

-- Clear legacy assignments created while the previous version was running in Normal Mode.
update public.refugeeledger_recovery_cases c
set assigned_to = null, assignment_started_at = null
where c.status not in ('COMPLETED','CANCELLED','REJECTED')
  and exists (select 1 from public.refugeeledger_officer_settings s where s.id = 1 and s.emergency_mode = false);

create or replace function public.officer_case_action(
  p_action text,
  p_case_id text default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_case public.refugeeledger_recovery_cases%rowtype;
  v_new_id text;
  v_note text;
  v_emergency boolean;
  v_allowed boolean := false;
  v_from_status text;
  v_to_status text;
  v_qr_token text;
  v_emergency_case boolean := false;
begin
  if v_user_id is null then
    raise exception 'RL: Sesi tidak valid. Silakan login kembali.' using errcode = '42501';
  end if;

  select role_code into v_role
  from public.refugeeledger_user_roles
  where user_id = v_user_id and is_active = true
    and role_code in ('admin','recovery_officer','document_printer','supervisor');

  if v_role is null then
    raise exception 'RL: Akun tidak memiliki akses petugas aktif.' using errcode = '42501';
  end if;

  select emergency_mode into v_emergency from public.refugeeledger_officer_settings where id = 1;
  v_allowed := case p_action
    when 'new-case' then (v_role = 'recovery_officer' or (coalesce(v_emergency,false) and v_role in ('admin','recovery_officer','document_printer','supervisor')))
    when 'face-scan' then (v_role = 'recovery_officer' or (coalesce(v_emergency,false) and v_role in ('admin','recovery_officer','document_printer','supervisor')))
    when 'move-review' then (v_role = 'recovery_officer' or (coalesce(v_emergency,false) and v_role in ('admin','recovery_officer','document_printer','supervisor')))
    when 'edit-note' then (v_role in ('recovery_officer','supervisor') or (coalesce(v_emergency,false) and v_role in ('admin','recovery_officer','document_printer','supervisor')))
    when 'cancel-case' then (v_role in ('recovery_officer','supervisor') or (coalesce(v_emergency,false) and v_role in ('admin','recovery_officer','document_printer','supervisor')))
    when 'approve' then (v_role in ('admin','supervisor') or (coalesce(v_emergency,false) and v_role in ('recovery_officer','document_printer')))
    when 'reject' then (v_role in ('admin','supervisor') or (coalesce(v_emergency,false) and v_role in ('recovery_officer','document_printer')))
    when 'print-pending' then (v_role in ('admin','document_printer') or (coalesce(v_emergency,false) and v_role in ('recovery_officer','supervisor')))
    when 'complete' then (v_role in ('admin','document_printer') or (coalesce(v_emergency,false) and v_role in ('recovery_officer','supervisor')))
    when 'emergency-toggle' then v_role = 'admin'
    else false
  end;

  if not v_allowed then
    raise exception 'RL: Role Anda tidak memiliki kewenangan untuk tindakan ini.' using errcode = '42501';
  end if;

  if p_action = 'emergency-toggle' then
    select emergency_mode into v_emergency from public.refugeeledger_officer_settings where id = 1 for update;
    if v_emergency then
      if exists (select 1 from public.refugeeledger_recovery_cases where status not in ('COMPLETED','CANCELLED','REJECTED')) then
        raise exception 'RL: Selesaikan atau batalkan kasus aktif sebelum mematikan Emergency Mode.' using errcode = '22023';
      end if;
      v_emergency := false;
    else
      v_emergency := true;
    end if;
    update public.refugeeledger_officer_settings
      set emergency_mode = v_emergency, updated_at = now(), updated_by = v_user_id where id = 1;
    insert into public.refugeeledger_audit_logs(actor_id,event_type,target_type,target_id,details)
      values (v_user_id,'emergency-toggle','settings','1',jsonb_build_object('emergency_mode',v_emergency,'role',v_role));
    return jsonb_build_object('emergencyMode',v_emergency);
  end if;

  if p_action = 'new-case' then
    -- Serialize Emergency Mode claims. Normal Mode cases are not assigned exclusively
    -- to the creating officer, so officers can register multiple cases.
    select emergency_mode into v_emergency from public.refugeeledger_officer_settings where id = 1 for update;
    if coalesce(v_emergency,false) and exists (select 1 from public.refugeeledger_recovery_cases c where c.assigned_to = v_user_id and c.status not in ('COMPLETED','CANCELLED','REJECTED')) then
      raise exception 'RL: Selesaikan kasus darurat aktif Anda sebelum membuat kasus baru.' using errcode = '22023';
    end if;
    if length(trim(coalesce(p_payload->>'citizenName',''))) < 2 or length(trim(coalesce(p_payload->>'citizenName',''))) > 100
       or length(trim(coalesce(p_payload->>'citizenCode',''))) < 1 or length(trim(coalesce(p_payload->>'citizenCode',''))) > 40
       or length(trim(coalesce(p_payload->>'location',''))) < 1 or length(trim(coalesce(p_payload->>'location',''))) > 100 then
      raise exception 'RL: Nama warga, kode warga, atau lokasi tidak valid.' using errcode = '22023';
    end if;
    v_new_id := 'RFL-REC-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
    insert into public.refugeeledger_recovery_cases(
      id,citizen_code,citizen_name,location,disaster,documents,status,created_by,updated_by,note,assigned_to,assignment_started_at,recovery_channel
    ) values (
      v_new_id,
      trim(p_payload->>'citizenCode'),
      trim(p_payload->>'citizenName'),
      trim(p_payload->>'location'),
      left(coalesce(nullif(trim(p_payload->>'disaster'),''),'Bencana lain'),40),
      array['Dokumen pendukung demo.pdf']::text[],
      'OPEN',v_user_id,v_user_id,left(coalesce(p_payload->>'note',''),500),case when coalesce(v_emergency,false) then v_user_id else null end,case when coalesce(v_emergency,false) then now() else null end,'STAFF_DEMO'
    ) returning * into v_case;
    insert into public.refugeeledger_audit_logs(actor_id,event_type,target_type,target_id,details)
      values (v_user_id,'case-created','recovery_case',v_case.id,jsonb_build_object('role',v_role,'status',v_case.status));
    return jsonb_build_object('case',jsonb_build_object('id',v_case.id,'status',v_case.status));
  end if;

  select * into v_case from public.refugeeledger_recovery_cases where id = p_case_id for update;
  if not found then
    raise exception 'RL: Kasus tidak ditemukan.' using errcode = 'P0002';
  end if;
  v_from_status := v_case.status;
  v_to_status := v_case.status;
  v_emergency_case := coalesce(v_emergency,false);

  if v_case.status not in ('COMPLETED','CANCELLED','REJECTED') then
    if exists (select 1 from public.refugeeledger_recovery_cases c where c.assigned_to = v_user_id and c.id <> v_case.id and c.status not in ('COMPLETED','CANCELLED','REJECTED')) then
      raise exception 'RL: Anda masih memiliki satu kasus aktif. Selesaikan atau serahkan kasus tersebut terlebih dahulu.' using errcode = '22023';
    end if;
    if v_case.assigned_to is not null and v_case.assigned_to <> v_user_id then
      raise exception 'RL: Kasus sedang ditangani petugas lain.' using errcode = '42501';
    end if;
    if v_case.assigned_to is null and coalesce(v_emergency,false) then
      update public.refugeeledger_recovery_cases set assigned_to=v_user_id, assignment_started_at=now() where id=p_case_id returning * into v_case;
    end if;
  end if;

  if p_action = 'face-scan' then
    if v_case.status not in ('OPEN','IDENTITY_CHECK') then
      raise exception 'RL: Simulasi identitas hanya dapat dilakukan pada kasus terbuka atau pemeriksaan identitas.' using errcode = '22023';
    end if;
    update public.refugeeledger_recovery_cases set identity_checked = true, status = 'IDENTITY_CHECK', updated_at = now(), updated_by = v_user_id where id = p_case_id returning * into v_case;
  elsif p_action = 'move-review' then
    if not v_case.identity_checked or v_case.status not in ('OPEN','IDENTITY_CHECK') then
      raise exception 'RL: Selesaikan simulasi identitas sebelum meneruskan kasus ke tinjauan dokumen.' using errcode = '22023';
    end if;
    update public.refugeeledger_recovery_cases set status = 'DOCUMENT_REVIEW', assigned_to = case when v_emergency_case then v_user_id else null end, assignment_started_at = case when v_emergency_case then assignment_started_at else null end, updated_at = now(), updated_by = v_user_id where id = p_case_id returning * into v_case;
  elsif p_action = 'approve' then
    if v_case.status <> 'DOCUMENT_REVIEW' then raise exception 'RL: Hanya kasus dalam tinjauan dokumen yang dapat disetujui.' using errcode = '22023'; end if;
    v_note := left(trim(coalesce(p_payload->>'note','')),500);
    v_qr_token := encode(gen_random_bytes(32),'hex');
    update public.refugeeledger_recovery_cases set status='APPROVED', review_note=coalesce(nullif(v_note,''),'Disetujui oleh pengawas.'), qr_token_hash=encode(digest(v_qr_token,'sha256'),'hex'), qr_issued_at=now(), qr_expires_at=now()+interval '30 minutes', qr_used_at=null, assigned_to=case when v_emergency_case then v_user_id else null end, assignment_started_at=case when v_emergency_case then assignment_started_at else null end, updated_at=now(), updated_by=v_user_id where id=p_case_id returning * into v_case;
  elsif p_action = 'reject' then
    v_note := left(trim(coalesce(p_payload->>'note','')),500);
    if v_case.status <> 'DOCUMENT_REVIEW' then raise exception 'RL: Hanya kasus dalam tinjauan dokumen yang dapat ditolak.' using errcode = '22023'; end if;
    if v_note = '' then raise exception 'RL: Catatan wajib diisi saat menolak kasus.' using errcode = '22023'; end if;
    update public.refugeeledger_recovery_cases set status='REJECTED', review_note=v_note, assigned_to=null, assignment_started_at=null, updated_at=now(), updated_by=v_user_id where id=p_case_id returning * into v_case;
  elsif p_action = 'edit-note' then
    v_note := left(trim(coalesce(p_payload->>'note','')),500);
    update public.refugeeledger_recovery_cases set review_note=v_note, assigned_to=case when v_emergency_case then v_user_id else null end, assignment_started_at=case when v_emergency_case then assignment_started_at else null end, updated_at=now(), updated_by=v_user_id where id=p_case_id returning * into v_case;
  elsif p_action = 'cancel-case' then
    if v_case.status in ('COMPLETED','CANCELLED','REJECTED') then raise exception 'RL: Kasus sudah ditutup dan tidak dapat dibatalkan.' using errcode = '22023'; end if;
    update public.refugeeledger_recovery_cases set status='CANCELLED', assigned_to=null, assignment_started_at=null, updated_at=now(), updated_by=v_user_id where id=p_case_id returning * into v_case;
  elsif p_action = 'print-pending' then
    if v_case.status <> 'APPROVED' then raise exception 'RL: Hanya kasus yang disetujui yang dapat masuk antrean cetak.' using errcode = '22023'; end if;
    if coalesce(p_payload->>'qrToken','') = '' or v_case.qr_token_hash is null then raise exception 'RL: QR Code wajib dipindai sebelum dokumen diproses.' using errcode = '22023'; end if;
    if v_case.qr_used_at is not null then raise exception 'RL: QR Code sudah pernah digunakan.' using errcode = '22023'; end if;
    if v_case.qr_expires_at is null or v_case.qr_expires_at < now() then raise exception 'RL: QR Code sudah kedaluwarsa. Minta persetujuan dan QR baru.' using errcode = '22023'; end if;
    if encode(digest(p_payload->>'qrToken','sha256'),'hex') <> v_case.qr_token_hash then raise exception 'RL: QR Code tidak valid untuk kasus ini.' using errcode = '22023'; end if;
    update public.refugeeledger_recovery_cases set status='PRINT_PENDING', qr_used_at=now(), updated_at=now(), updated_by=v_user_id where id=p_case_id returning * into v_case;
  elsif p_action = 'complete' then
    if v_case.status <> 'PRINT_PENDING' then raise exception 'RL: Hanya kasus dalam antrean cetak yang dapat diselesaikan.' using errcode = '22023'; end if;
    update public.refugeeledger_recovery_cases set status='COMPLETED', assigned_to=null, assignment_started_at=null, updated_at=now(), updated_by=v_user_id where id=p_case_id returning * into v_case;
  else
    raise exception 'RL: Aksi tidak didukung.' using errcode = '22023';
  end if;

  v_to_status := v_case.status;
  insert into public.refugeeledger_audit_logs(actor_id,event_type,target_type,target_id,details)
    values (v_user_id,'case-' || p_action,'recovery_case',v_case.id,
      jsonb_build_object('role',v_role,'from_status',v_from_status,'to_status',v_to_status,
        'note',case when p_action in ('approve','reject','edit-note') then v_case.review_note else null end));
  return jsonb_build_object('case',jsonb_build_object('id',v_case.id,'status',v_case.status,'identityChecked',v_case.identity_checked), 'qrToken', case when p_action='approve' then v_qr_token else null end, 'qrExpiresAt', case when p_action='approve' then v_case.qr_expires_at else null end);
end;
$$;


revoke all on function public.officer_case_action(text,text,jsonb) from public, anon;
grant execute on function public.officer_case_action(text,text,jsonb) to authenticated;

commit;


-- =====================================================================
-- Stage 8B — Disable Citizen Office Case RPC
-- Source migration: stage8b-citizen-recovery-guidance-qr-persistence.sql
-- =====================================================================

-- Docura Stage 8B: remove citizen self-submission for office recovery.
-- Citizens must visit the service office; authorized staff create the case.
-- Run after Stage 7D / Stage 8A migrations.

revoke all on function public.citizen_request_office_recovery(jsonb) from public, anon, authenticated;


-- =====================================================================
-- Stage 9 — Security Hardening
-- Source migration: stage9-security-hardening.sql
-- =====================================================================

-- Docura Stage 9: security hardening for an existing Stage 5/7D deployment.
-- Apply after Stage 5 document storage and Stage 7D case management.
-- Run in Supabase SQL Editor for the same project as the application.
begin;

-- In Emergency Mode, non-admin staff may only SELECT their own assigned active cases.
-- In Normal Mode, active staff can see shared workflow cases as designed.
drop policy if exists "Active RefugeeLedger officers can read cases" on public.refugeeledger_recovery_cases;
create policy "Active RefugeeLedger officers can read cases"
  on public.refugeeledger_recovery_cases for select to authenticated
  using (
    exists (
      select 1 from public.refugeeledger_user_roles r
      where r.user_id = (select auth.uid())
        and r.is_active = true
        and r.role_code in ('admin','recovery_officer','document_printer','supervisor')
        and (
          r.role_code = 'admin'
          or not coalesce((select s.emergency_mode from public.refugeeledger_officer_settings s where s.id = 1), false)
          or status in ('COMPLETED','CANCELLED','REJECTED')
          or assigned_to = (select auth.uid())
        )
    )
  );

-- Citizens must not create office cases directly through Supabase RPC either.
-- Office staff create these cases; citizens use the guidance shown in their dashboard.
revoke all on function public.citizen_request_office_recovery(jsonb) from public, anon, authenticated;

-- Permit a citizen to physically delete only their own document metadata after the
-- authenticated route has removed the corresponding private Storage object.
grant delete on public.documents to authenticated;
drop policy if exists "Citizens can delete own documents" on public.documents;
create policy "Citizens can delete own documents"
  on public.documents for delete to authenticated
  using (owner_id = (select auth.uid()));

commit;

-- Docura V2.1 — Citizen registry and account-bound recovery cases
-- Safe to run after the existing Docura install-all.sql on the same Supabase project.
-- Uses internal Docura citizen codes, never NIK. Synthetic/demo data only.

begin;
create extension if not exists pgcrypto;

create table if not exists public.docura_citizen_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  citizen_code varchar(40) not null unique,
  full_name varchar(100) not null check (char_length(full_name) between 2 and 100),
  email varchar(254),
  is_active boolean not null default true,
  passkey_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists docura_citizen_profiles_name_idx
  on public.docura_citizen_profiles (lower(full_name));

alter table public.docura_citizen_profiles enable row level security;
revoke all on public.docura_citizen_profiles from anon;
grant select on public.docura_citizen_profiles to authenticated;

drop policy if exists "Citizens read own Docura profile" on public.docura_citizen_profiles;
create policy "Citizens read own Docura profile"
  on public.docura_citizen_profiles for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Active officers can search Docura citizens" on public.docura_citizen_profiles;
create policy "Active officers can search Docura citizens"
  on public.docura_citizen_profiles for select to authenticated
  using (exists (
    select 1 from public.refugeeledger_user_roles r
    where r.user_id = (select auth.uid())
      and r.is_active = true
      and r.role_code in ('admin','recovery_officer','document_printer','supervisor')
  ));

-- Profile creation is tied to Supabase auth user metadata; names/emails are never supplied by staff forms.
create or replace function public.docura_create_citizen_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_name text;
  v_code text;
begin
  if coalesce(new.raw_user_meta_data->>'account_type', '') <> 'citizen' then
    return new;
  end if;
  v_name := left(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), 100);
  if char_length(v_name) < 2 then
    v_name := 'Warga Docura';
  end if;
  if exists (select 1 from public.refugeeledger_user_roles r where r.user_id = new.id) then
    return new;
  end if;
  v_code := 'DOC-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 12));
  insert into public.docura_citizen_profiles(user_id, citizen_code, full_name, email)
  values (new.id, v_code, v_name, lower(new.email))
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists docura_auth_user_citizen_profile on auth.users;
create trigger docura_auth_user_citizen_profile
after insert on auth.users
for each row execute function public.docura_create_citizen_profile();

-- Backfill existing citizen accounts that carry the explicit citizen account_type metadata.
insert into public.docura_citizen_profiles(user_id, citizen_code, full_name, email)
select u.id,
       'DOC-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 12)),
       left(coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'name'), ''), 'Warga Docura'), 100),
       lower(u.email)
from auth.users u
where u.raw_user_meta_data->>'account_type' = 'citizen'
  and not exists (select 1 from public.refugeeledger_user_roles r where r.user_id = u.id)
  and not exists (select 1 from public.docura_citizen_profiles p where p.user_id = u.id)
on conflict (user_id) do nothing;

-- Enforce citizen-account lookup at the database boundary, so direct RPC calls cannot bypass the UI.
create or replace function public.docura_bind_case_to_registered_citizen()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_profile public.docura_citizen_profiles%rowtype;
begin
  -- Seed/demo rows without an authenticated creator remain compatible with the original installer.
  if new.created_by is null then
    return new;
  end if;

  select * into v_profile
  from public.docura_citizen_profiles p
  where upper(p.citizen_code) = upper(trim(coalesce(new.citizen_code, '')))
    and p.is_active = true
  limit 1;

  if not found then
    raise exception 'RL: Warga tidak terdaftar atau akun warga tidak aktif. Pilih warga melalui pencarian kode unik Docura.'
      using errcode = '22023';
  end if;

  if new.citizen_user_id is not null and new.citizen_user_id <> v_profile.user_id then
    raise exception 'RL: Akun warga tidak cocok dengan kode unik yang dipilih.' using errcode = '22023';
  end if;

  new.citizen_user_id := v_profile.user_id;
  new.citizen_code := v_profile.citizen_code;
  new.citizen_name := v_profile.full_name;
  return new;
end;
$$;

drop trigger if exists docura_require_registered_citizen_for_case on public.refugeeledger_recovery_cases;
create trigger docura_require_registered_citizen_for_case
before insert on public.refugeeledger_recovery_cases
for each row execute function public.docura_bind_case_to_registered_citizen();

-- Link any existing cases whose citizen code already matches a registered profile.
update public.refugeeledger_recovery_cases c
set citizen_user_id = p.user_id,
    citizen_code = p.citizen_code,
    citizen_name = p.full_name
from public.docura_citizen_profiles p
where c.citizen_user_id is null
  and upper(c.citizen_code) = upper(p.citizen_code)
  and p.is_active = true;


-- If an account is assigned a staff role after signup, it must not remain in the citizen directory.
create or replace function public.docura_remove_staff_from_citizen_registry()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.role_code <> 'citizen' then
    delete from public.docura_citizen_profiles where user_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists docura_staff_role_removes_citizen_profile on public.refugeeledger_user_roles;
create trigger docura_staff_role_removes_citizen_profile
after insert or update of role_code on public.refugeeledger_user_roles
for each row execute function public.docura_remove_staff_from_citizen_registry();

commit;

-- Docura V2.2 — WebAuthn/passkey credentials and one-time challenges.
-- Run after the V2.1 citizen registry migration on the same Supabase project.
-- Requires SUPABASE_SERVICE_ROLE_KEY in the Node.js server environment; never expose it to the browser.

begin;

create table if not exists public.docura_passkey_credentials (
  credential_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  public_key_jwk jsonb not null,
  counter bigint not null default 0 check (counter >= 0),
  transports text[] not null default '{}',
  device_label varchar(80) not null default 'Passkey perangkat',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists docura_passkey_credentials_user_idx
  on public.docura_passkey_credentials(user_id);

create table if not exists public.docura_passkey_challenges (
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('registration','authentication')),
  challenge text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, purpose)
);

alter table public.docura_passkey_credentials enable row level security;
alter table public.docura_passkey_challenges enable row level security;
revoke all on public.docura_passkey_credentials from anon, authenticated;
revoke all on public.docura_passkey_challenges from anon, authenticated;
grant all on public.docura_passkey_credentials to service_role;
grant all on public.docura_passkey_challenges to service_role;

-- The server, after verifying WebAuthn, is the only writer of passkey status.
-- Keep the profile's boolean synchronized with actual credential rows.
create or replace function public.docura_sync_passkey_enabled()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
begin
  v_user_id := coalesce(new.user_id, old.user_id);
  update public.docura_citizen_profiles p
  set passkey_enabled = exists (
    select 1 from public.docura_passkey_credentials c where c.user_id = v_user_id
  ), updated_at = now()
  where p.user_id = v_user_id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists docura_passkey_profile_sync on public.docura_passkey_credentials;
create trigger docura_passkey_profile_sync
after insert or delete on public.docura_passkey_credentials
for each row execute function public.docura_sync_passkey_enabled();

commit;

-- Docura V2.4: print-batch completion guard for recovery cases.
-- Run in Supabase SQL Editor after the existing Docura/Stage 7D migrations.
-- The UI asks the operator to confirm printing; software cannot independently prove
-- that a physical printer produced paper. This migration records the selected batch
-- and prevents the legacy generic completion action from bypassing document selection.
begin;

create table if not exists public.docura_case_print_batches (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.refugeeledger_recovery_cases(id) on delete cascade,
  citizen_user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  document_ids uuid[] not null check (cardinality(document_ids) between 1 and 30),
  document_titles jsonb not null default '[]'::jsonb,
  printed_at timestamptz not null default now()
);
create index if not exists docura_case_print_batches_case_idx
  on public.docura_case_print_batches(case_id, printed_at desc);
alter table public.docura_case_print_batches enable row level security;
revoke all on public.docura_case_print_batches from anon, authenticated;

create or replace function public.docura_guard_case_completion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'COMPLETED' and old.status is distinct from new.status then
    if not exists (
      select 1 from public.docura_case_print_batches b
      where b.case_id = new.id
        and b.actor_id = new.updated_by
        and b.citizen_user_id = new.citizen_user_id
        and b.printed_at >= now() - interval '10 minutes'
    ) then
      raise exception 'DOCURA: Kasus tidak dapat diselesaikan sebelum batch dokumen dipilih dan dikonfirmasi cetak.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists docura_guard_case_completion_trigger on public.refugeeledger_recovery_cases;
create trigger docura_guard_case_completion_trigger
before update of status on public.refugeeledger_recovery_cases
for each row execute function public.docura_guard_case_completion();

create or replace function public.officer_case_complete_print_batch(p_case_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_emergency boolean := false;
  v_case public.refugeeledger_recovery_cases%rowtype;
  v_ids uuid[];
  v_titles jsonb;
  v_count integer;
begin
  if v_user_id is null then raise exception 'DOCURA: Sesi petugas tidak ditemukan.' using errcode = '42501'; end if;
  select role_code, is_active into v_role, v_active
  from public.refugeeledger_user_roles where user_id = v_user_id;
  if not coalesce(v_active, false) then raise exception 'DOCURA: Akun petugas tidak aktif atau tidak memiliki role.' using errcode = '42501'; end if;
  select coalesce(emergency_mode, false) into v_emergency
  from public.refugeeledger_officer_settings where id = 1;
  if not (v_role in ('admin','document_printer') or (coalesce(v_emergency,false) and v_role in ('recovery_officer','supervisor'))) then
    raise exception 'DOCURA: Role Anda tidak memiliki izin menyelesaikan batch cetak.' using errcode = '42501';
  end if;
  if coalesce((p_payload->>'printConfirmed')::boolean, false) is not true
     or coalesce((p_payload->>'fingerprintSimulationCompleted')::boolean, false) is not true then
    raise exception 'DOCURA: Simulasi sidik jari dan konfirmasi cetak wajib diselesaikan.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'documentIds') <> 'array' then
    raise exception 'DOCURA: Pilih dokumen yang akan dicetak.' using errcode = '22023';
  end if;
  select array_agg(x::uuid), count(*) into v_ids, v_count
  from jsonb_array_elements_text(p_payload->'documentIds') as e(x);
  if coalesce(v_count,0) < 1 or v_count > 30 or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) as u(x)) then
    raise exception 'DOCURA: Pilih antara 1 dan 30 dokumen yang berbeda.' using errcode = '22023';
  end if;
  select * into v_case from public.refugeeledger_recovery_cases where id = p_case_id for update;
  if not found then raise exception 'DOCURA: Kasus tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_case.status <> 'PRINT_PENDING' then raise exception 'DOCURA: Kasus harus berada dalam antrean cetak.' using errcode = '22023'; end if;
  if v_case.citizen_user_id is null then raise exception 'DOCURA: Kasus belum terhubung dengan akun warga.' using errcode = '22023'; end if;
  if coalesce(v_emergency,false) and v_case.assigned_to is not null and v_case.assigned_to <> v_user_id and v_role <> 'admin' then
    raise exception 'DOCURA: Kasus darurat ditugaskan kepada petugas lain.' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(v_ids) as chosen(id)
    where not exists (select 1 from public.documents d where d.id = chosen.id and d.owner_id = v_case.citizen_user_id and d.status = 'ACTIVE')
  ) then raise exception 'DOCURA: Ada dokumen yang bukan milik warga pada kasus ini atau sudah tidak aktif.' using errcode = '42501'; end if;
  select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title) order by d.title)
    into v_titles
  from public.documents d where d.id = any(v_ids) and d.owner_id = v_case.citizen_user_id and d.status = 'ACTIVE';
  insert into public.docura_case_print_batches(case_id,citizen_user_id,actor_id,document_ids,document_titles,printed_at)
  values (v_case.id,v_case.citizen_user_id,v_user_id,v_ids,coalesce(v_titles,'[]'::jsonb),now());
  update public.refugeeledger_recovery_cases
    set status='COMPLETED', assigned_to=null, assignment_started_at=null, updated_at=now(), updated_by=v_user_id
    where id=v_case.id returning * into v_case;
  insert into public.refugeeledger_audit_logs(actor_id,event_type,target_type,target_id,details)
  values (v_user_id,'case-print-batch-completed','recovery_case',v_case.id,
    jsonb_build_object('role',v_role,'status',v_case.status,'document_ids',v_ids,'document_titles',coalesce(v_titles,'[]'::jsonb),'operator_confirmed_print',true,'fingerprint_step','simulation'));
  return jsonb_build_object('case',jsonb_build_object('id',v_case.id,'status',v_case.status),'documentCount',v_count,'documentTitles',coalesce(v_titles,'[]'::jsonb));
end;
$$;

revoke all on function public.officer_case_complete_print_batch(text,jsonb) from public, anon;
grant execute on function public.officer_case_complete_print_batch(text,jsonb) to authenticated;
commit;

-- Docura V2.5.1 — Audit Trail & Security Monitoring
-- Run once on an existing Docura database after V2.4 migrations.
-- This migration does not store request bodies, IP addresses, tokens, document contents,
-- signed URLs, or biometrics. Existing historic audit details are left untouched.

begin;

alter table public.refugeeledger_audit_logs
  add column if not exists request_id text,
  add column if not exists actor_role text,
  add column if not exists outcome text not null default 'success';

create index if not exists refugeeledger_audit_logs_created_at_idx
  on public.refugeeledger_audit_logs(created_at desc, id desc);
create index if not exists refugeeledger_audit_logs_event_type_idx
  on public.refugeeledger_audit_logs(event_type, created_at desc);
create index if not exists refugeeledger_audit_logs_target_idx
  on public.refugeeledger_audit_logs(target_type, target_id, created_at desc);
create index if not exists refugeeledger_audit_logs_actor_idx
  on public.refugeeledger_audit_logs(actor_id, created_at desc);

-- The audit table remains inaccessible directly to anon/authenticated clients.
-- Only the trusted server service-role client writes and reads audit rows.
alter table public.refugeeledger_audit_logs enable row level security;
revoke all on public.refugeeledger_audit_logs from anon, authenticated;

create or replace function public.docura_audit_fill_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.actor_role is null and jsonb_typeof(new.details) = 'object' then
    new.actor_role := nullif(new.details->>'role', '');
  end if;
  return new;
end;
$$;
revoke all on function public.docura_audit_fill_metadata() from public, anon, authenticated;

drop trigger if exists docura_audit_logs_fill_metadata on public.refugeeledger_audit_logs;
create trigger docura_audit_logs_fill_metadata
before insert on public.refugeeledger_audit_logs
for each row execute function public.docura_audit_fill_metadata();

create or replace function public.docura_reject_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Permit the FK's ON DELETE SET NULL cleanup when an auth user is deleted;
  -- all other UPDATEs and all direct DELETEs are rejected.
  if tg_op = 'UPDATE'
     and old.actor_id is not null
     and new.actor_id is null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception 'DOCURA: Audit records are append-only.' using errcode = '42501';
end;
$$;
revoke all on function public.docura_reject_audit_mutation() from public, anon, authenticated;

drop trigger if exists docura_audit_logs_append_only on public.refugeeledger_audit_logs;
create trigger docura_audit_logs_append_only
before update or delete on public.refugeeledger_audit_logs
for each row execute function public.docura_reject_audit_mutation();

commit;


-- =====================================================================
-- Docura V2.7.0 — Notifications and Admin-managed staff accounts
-- Source migration: v2.7.0-notifications-staff.sql
-- =====================================================================

create table if not exists public.docura_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('citizen_registered','staff_account_created','case_ready_for_review','case_approved_for_print','case_completed','case_rejected')),
  title varchar(140) not null,
  message varchar(500) not null,
  target_type text,
  target_id text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists docura_notifications_recipient_created_idx on public.docura_notifications(recipient_id, created_at desc);
alter table public.docura_notifications enable row level security;
revoke all on public.docura_notifications from anon, authenticated;
alter table public.refugeeledger_user_roles drop constraint if exists refugeeledger_user_roles_role_code_check;
alter table public.refugeeledger_user_roles add constraint refugeeledger_user_roles_role_code_check check (role_code in ('citizen','admin','recovery_officer','document_printer','supervisor'));


grant all on public.docura_notifications to service_role;
grant all on public.refugeeledger_user_roles to service_role;
drop policy if exists "Active officers can search Docura citizens" on public.docura_citizen_profiles;
create policy "Active officers can search Docura citizens"
  on public.docura_citizen_profiles for select to authenticated
  using (exists (
    select 1 from public.refugeeledger_user_roles r
    where r.user_id = (select auth.uid()) and r.is_active = true
      and r.role_code in ('admin','recovery_officer','document_printer','supervisor')
  ));

-- =====================================================================
-- Docura V2.8.0 — Recovery Receipt + retire the combined Representative role.
-- Merged from v2.8.0-recovery-receipt.sql for fresh installations.
-- =====================================================================


-- Remove any existing combined-role assignments before tightening the role constraint.
delete from public.refugeeledger_user_roles where role_code = 'representative';
alter table public.refugeeledger_user_roles drop constraint if exists refugeeledger_user_roles_role_code_check;
alter table public.refugeeledger_user_roles add constraint refugeeledger_user_roles_role_code_check
  check (role_code in ('citizen','admin','recovery_officer','document_printer','supervisor'));

-- Revert any role-aware RPCs expanded by an earlier V2.7.0 build.
do $$
declare
  fn record;
  definition text;
begin
  for fn in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.prosrc like '%representative%'
      and p.prosrc like '%refugeeledger_user_roles%'
  loop
    definition := pg_get_functiondef(fn.oid);
    definition := replace(definition, $old$'admin','recovery_officer','document_printer','supervisor','representative'$old$, $new$'admin','recovery_officer','document_printer','supervisor'$new$);
    definition := replace(definition, $old$'admin','recovery_officer','document_printer','supervisor', 'representative'$old$, $new$'admin','recovery_officer','document_printer','supervisor'$new$);
    definition := replace(definition, $old$v_role in ('recovery_officer','representative')$old$, $new$v_role = 'recovery_officer'$new$);
    definition := replace(definition, $old$v_role in ('recovery_officer','supervisor','representative')$old$, $new$v_role in ('recovery_officer','supervisor')$new$);
    definition := replace(definition, $old$v_role in ('admin','document_printer','representative')$old$, $new$v_role in ('admin','document_printer')$new$);
    execute definition;
  end loop;
end $$;

-- Refresh role-scoped read policies without the retired combined role.
drop policy if exists "Active RefugeeLedger officers can read cases" on public.refugeeledger_recovery_cases;
create policy "Active RefugeeLedger officers can read cases"
  on public.refugeeledger_recovery_cases for select to authenticated
  using (exists (
    select 1 from public.refugeeledger_user_roles r
    where r.user_id = (select auth.uid()) and r.is_active = true
      and r.role_code in ('admin','recovery_officer','document_printer','supervisor')
      and (r.role_code = 'admin'
        or not coalesce((select s.emergency_mode from public.refugeeledger_officer_settings s where s.id = 1), false)
        or status in ('COMPLETED','CANCELLED','REJECTED')
        or assigned_to = (select auth.uid()))
  ));

drop policy if exists "Active RefugeeLedger officers can read settings" on public.refugeeledger_officer_settings;
create policy "Active RefugeeLedger officers can read settings"
  on public.refugeeledger_officer_settings for select to authenticated
  using (exists (
    select 1 from public.refugeeledger_user_roles r
    where r.user_id = (select auth.uid()) and r.is_active = true
      and r.role_code in ('admin','recovery_officer','document_printer','supervisor')
  ));

drop policy if exists "Active officers can search Docura citizens" on public.docura_citizen_profiles;
create policy "Active officers can search Docura citizens"
  on public.docura_citizen_profiles for select to authenticated
  using (exists (
    select 1 from public.refugeeledger_user_roles r
    where r.user_id = (select auth.uid()) and r.is_active = true
      and r.role_code in ('admin','recovery_officer','document_printer','supervisor')
  ));
