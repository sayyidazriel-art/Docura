# Database / Supabase setup

Docura Stage 9 uses Supabase Auth, Postgres, and private Supabase Storage. SQL is required: cloning the repository alone does not create the database schema or Storage policies.

## Recommended for a fresh demo project

1. Create a dedicated Supabase project for Docura.
2. Open **SQL Editor** in that project.
3. Open `database/install-all.sql` from this repository, copy the entire file into SQL Editor, and run it once.
4. Review the output for errors. If any statement fails, stop and resolve it rather than assuming the installation completed.
5. The script creates the document metadata table, private `citizen-documents` bucket, role registry, audit table, case-management tables/functions, RLS policies, and Stage 9 hardening. It also seeds three synthetic sample cases only if the case table is empty.
6. Continue with the root `README.md` to configure `.env`, create demo accounts, assign roles, and start the app.

## Existing Supabase project

Do not blindly run the all-in-one file against a database that already contains Docura/RefugeeLedger tables or real data. Back up first, compare migration history, and apply only missing migrations in this order:

1. `stage5-document-storage.sql`
2. `stage7b-officer-roles.sql`
3. `stage7d-case-management.sql`
4. `stage8a-normal-multicase-popup-fix.sql`
5. `stage8b-citizen-recovery-guidance-qr-persistence.sql`
6. `stage9-security-hardening.sql`

Do not apply an earlier migration over a newer schema without reviewing the differences. The migrations are not a substitute for a database backup.

## Create a staff account

Create the user in **Supabase Dashboard → Authentication → Users → Add user**. Copy the user's UUID, then run a query like this in SQL Editor (replace the placeholders):

```sql
insert into public.refugeeledger_user_roles (user_id, role_code, display_name, is_active)
values ('REPLACE-WITH-AUTH-USER-UUID', 'recovery_officer', 'Demo Recovery Officer', true);
```

Valid `role_code` values: `admin`, `recovery_officer`, `document_printer`, `supervisor`, `citizen`. Assign privileged roles only to trusted accounts. Public registration must not grant staff privileges.

To see the account UUIDs, use Authentication → Users. Do not use an email address in place of the UUID.

## Useful verification queries

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

## Important notes

- Keep `citizen-documents` private. Do not switch it to a public bucket.
- Do not put Supabase secret/service-role keys in `.env` used by this app, browser code, GitHub, screenshots, or chat. The current server uses the publishable/anon key plus user access tokens; RLS must remain enabled.
- Use synthetic documents and accounts for public demos.
- Fingerprint/face checks are simulations in this version; blockchain and ZKP are not implemented in this version.
- The SQL is designed for the current Stage 9 prototype and has not been independently tested against every Supabase project configuration. Validate it in a new demo project first.
