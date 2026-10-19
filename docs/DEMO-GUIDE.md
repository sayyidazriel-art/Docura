# Docura — Demo & Operator Guide

## Before the demonstration

- [ ] Use a dedicated Supabase demo project, not a production database.
- [ ] Run `database/install-all.sql` once on a fresh project and confirm there are no SQL errors.
- [ ] Configure `.env` locally; verify it is ignored by Git.
- [ ] Create separate Auth accounts for Citizen, Recovery Officer, Supervisor, Document Printer, and Admin as needed.
- [ ] Assign roles using the SQL examples in `database/README.md`.
- [ ] Run `npm test`, then `npm start`.
- [ ] Prepare only fictional names, case data, and sample documents.
- [ ] Test the demo from a clean browser session and verify logout/login between roles.

## Recommended live walkthrough

1. Introduce the problem Docura addresses and explain that this is a prototype.
2. Show the landing page and Citizen portal.
3. Demonstrate document upload with a synthetic PDF, JPG, or PNG. Maximum supported file size is 10 MiB.
4. Sign in as Recovery Officer and create a fictional recovery case.
5. Demonstrate the identity-check simulation. Explicitly state that it is not real biometric verification.
6. Sign in as Supervisor and approve or reject the case.
7. Display the QR receipt and validate it as Document Printer. Explain the one-time, time-limited token design.
8. Demonstrate Admin-controlled Emergency Mode and staff case assignment constraints.
9. Close with the roadmap: blockchain integrity records, ZKP, and real biometric authentication are planned, not implemented in this Stage 9 release.

## Test cases to rehearse

- Citizen cannot access another citizen's private document.
- Staff without an assigned staff role cannot open staff workflows.
- Non-admin staff cannot toggle Emergency Mode.
- An invalid, expired, or already-used QR token is rejected.
- In Emergency Mode, staff cannot read or mutate another staff member's active assigned case.
- Uploading an unsupported type or file larger than 10 MiB is rejected.
- Altering a file extension/MIME declaration without matching file signature is rejected by server validation.

The cases above are expected checks; mark them as passed only after you actually test them against your configured Supabase project.

## If a friend is running the project on their laptop

They need Node.js/npm and their own Supabase project, then follow the root README. Cloning the repository does not grant access to your Supabase project, and it does not automatically create database tables. They should configure their own `.env` and execute `database/install-all.sql` on their own fresh demo project. Never share your `.env` or service-role/secret keys.
