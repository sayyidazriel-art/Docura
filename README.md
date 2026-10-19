# Docura

**Decentralized Object Credential Unification & Risk Audit**

Docura is a prototype for document handling and verification workflows, with role-based access, a private Supabase Storage bucket, case management, Normal/Emergency Mode, and QR handover tokens. The current Stage 9 release is a demonstrable application foundation—not yet a blockchain/ZKP/real-biometric system.

> **Prototype notice:** fingerprint/face checks are simulations. Blockchain integration, Zero-Knowledge Proof generation/verification, and physical fingerprint hardware integration are not implemented. Do not use this version to process real refugee, identity, or other sensitive personal data.

## What is included

- Citizen registration/login through Supabase Auth.
- Role-based staff login and server-side authorization.
- Recovery case workflow, Supervisor review, QR token issuance/validation, and Normal/Emergency Mode.
- Private document upload for PDF/JPEG/PNG, up to 10 MiB, with server-side file signature checks.
- Supabase database and Storage RLS policies/migrations.
- Unit tests for supported file signatures.

## Requirements

- Node.js LTS (Node.js 20 or newer recommended).
- npm.
- A Supabase account/project.
- Git (optional if downloading the ZIP instead of cloning).

## Quick start (new demo installation)

### 1. Get the source

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd docura
```

Or download the repository ZIP from GitHub and extract it. Run commands from the folder containing `package.json`.

### 2. Prepare Supabase

1. Create a new Supabase project dedicated to the Docura demo.
2. Open its **SQL Editor**.
3. Open `database/install-all.sql` from the repository, copy its full contents into SQL Editor, and run it once.
4. Follow [`database/README.md`](database/README.md) to create staff accounts and assign roles.
5. In Supabase Authentication settings, add the local app URL to the allowed redirect URLs if required by your Auth configuration: `http://localhost:3000/**`.

**Do not run `install-all.sql` on an existing production database without a backup and migration review.** For an existing installation, see the ordered individual migrations in `database/README.md`.

### 3. Configure environment variables

Copy `.env.example` to `.env`, then fill in the project URL and publishable key (or legacy anon key) from the Supabase project settings.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

Example `.env` values:

```dotenv
PORT=3000
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
APP_ORIGIN=
```

Do not commit `.env`. Never place a Supabase secret/service-role key in this app's environment, frontend code, or a public repository.

### 4. Install dependencies and run checks

```bash
npm install
npm test
npm start
```

Open `http://localhost:3000`. Stop the server with `Ctrl+C`. For auto-reload during development, use `npm run dev`.

## Demo accounts and roles

Create accounts in **Supabase Dashboard → Authentication → Users → Add user**. Then assign roles by inserting each account UUID into `public.refugeeledger_user_roles` in SQL Editor. Examples and role codes are documented in [`database/README.md`](database/README.md).

| Role code | Purpose in prototype |
|---|---|
| `citizen` | Citizen portal and own document workflows |
| `recovery_officer` | Create/manage cases within workflow permissions |
| `supervisor` | Review and approve/reject cases |
| `document_printer` | Validate QR and complete handover workflow |
| `admin` | Administrative controls, including Emergency Mode |

Do not grant staff roles through public registration. Use separate accounts for testing different roles.

## Suggested demo sequence

1. Open the landing page and explain the use case.
2. Log in as Recovery Officer and create a case using fictional data.
3. Demonstrate the identity-check simulation and send the case for review.
4. Log in as Supervisor and approve/reject the case.
5. Show the QR receipt and validate the token as Document Printer. Demonstrate invalid/expired/reused token rejection where possible.
6. Demonstrate Admin-controlled Emergency Mode and case assignment restrictions.
7. Upload a synthetic PDF/JPEG/PNG as a citizen, then demonstrate the private document workflow.
8. Explain limitations honestly: no blockchain/ZKP/real fingerprint integration yet.

## SQL files

- [`database/install-all.sql`](database/install-all.sql) — ordered installation script for a fresh, dedicated demo Supabase project.
- [`database/stage5-document-storage.sql`](database/stage5-document-storage.sql) — document metadata, private bucket and Storage policies.
- [`database/stage7b-officer-roles.sql`](database/stage7b-officer-roles.sql) — role registry and audit log.
- [`database/stage7d-case-management.sql`](database/stage7d-case-management.sql) — case workflow and RPC.
- [`database/stage8a-normal-multicase-popup-fix.sql`](database/stage8a-normal-multicase-popup-fix.sql) — Normal Mode multi-case behavior.
- [`database/stage8b-citizen-recovery-guidance-qr-persistence.sql`](database/stage8b-citizen-recovery-guidance-qr-persistence.sql) — disables direct citizen office-case RPC.
- [`database/stage9-security-hardening.sql`](database/stage9-security-hardening.sql) — Stage 9 hardening.

Run the all-in-one script once on a fresh project; do not then run each individual migration on the same project unnecessarily.

## Security and privacy

- Use synthetic demo data only.
- Keep document storage private.
- Do not commit `.env`, tokens, passwords, real identity documents, biometric data, or production database dumps.
- Keep RLS and Storage policies enabled. A publishable/anon key is not a substitute for authorization policies.
- Use HTTPS and production-grade secrets management before any public deployment.
- This repository is a prototype and has not undergone a full independent security audit or production acceptance test.

## Current limitations

- Fingerprint/face verification is simulated.
- QR scanning UI uses a token entry workflow; dedicated camera/scanner integration is not included.
- Blockchain and ZKP are not implemented.
- The provided SQL and local tests do not prove the entire application is secure; test all role and RLS paths in your own Supabase demo project.

## Project documentation

- [`database/README.md`](database/README.md) — SQL setup and role assignment.
- [`docs/DEMO-GUIDE.md`](docs/DEMO-GUIDE.md) — presentation checklist.
- [`README-STAGE9-SECURITY-HARDENING.md`](README-STAGE9-SECURITY-HARDENING.md) — Stage 9 notes and known verification limits.

## License

No open-source license has been selected yet. Unless a license is added, do not assume that the repository grants broad permission to redistribute or reuse the code. Choose a license before publicly publishing the repository.
