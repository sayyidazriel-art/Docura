const express = require('express');
const crypto = require('crypto');
const { createAuthClient } = require('../config/supabase');
const { rateLimit } = require('../middleware/rate-limit');
const QRCode = require('qrcode');
const { createServiceClient } = require('../config/supabase');
const { recordAuditEvent } = require('../services/audit-log');
const { issueDemoProof, consumeDemoProof } = require('../services/biometric-demo-state');
const { expectedConfig, b64url, verifyRegistrationResponse, verifyAuthenticationResponse } = require('../services/webauthn');
const { canSearchCitizensForCase, normalizeCitizenSearchQuery } = require('../services/citizen-access');
const router = express.Router();

const OFFICER_ROLES = new Set(['admin', 'recovery_officer', 'document_printer', 'supervisor']);
const ROLE_LABELS = {
  admin: 'Administrator',
  recovery_officer: 'Petugas Pemulihan',
  document_printer: 'Pencetak Dokumen',
  supervisor: 'Pengawas',
};

function bearer(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function getOfficer(req) {
  const token = bearer(req);
  if (!token) return { error: 'Sesi tidak ditemukan. Silakan masuk melalui Portal Petugas.', status: 401 };
  const auth = createAuthClient(token);
  const { data: userData, error: userError } = await auth.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return { error: 'Sesi tidak valid atau telah berakhir. Silakan masuk kembali.', status: 401 };
  if (!user.email_confirmed_at) return { error: 'Email akun belum dikonfirmasi.', status: 403 };

  const { data: roleRow, error: roleError } = await auth
    .from('refugeeledger_user_roles')
    .select('user_id, role_code, display_name, is_active')
    .eq('user_id', user.id)
    .maybeSingle();

  if (roleError) {
    console.error('Officer role lookup failed:', roleError.message);
    return { error: 'Data peran belum tersedia. Pastikan SQL Stage 7B sudah dijalankan.', status: 503 };
  }
  if (!roleRow || !OFFICER_ROLES.has(roleRow.role_code) || !roleRow.is_active) {
    return { error: 'Akun ini tidak memiliki akses aktif ke Portal Petugas. Hubungi administrator.', status: 403 };
  }
  return { auth, user, roleRow };
}

router.get('/me', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const { user, roleRow } = result;
    return res.json({
      success: true,
      user: { id: user.id, email: user.email },
      role: roleRow.role_code,
      roleLabel: ROLE_LABELS[roleRow.role_code],
      displayName: roleRow.display_name || ROLE_LABELS[roleRow.role_code],
    });
  } catch (error) {
    console.error('Officer session validation failed:', error.message);
    return res.status(500).json({ success: false, message: 'Sesi petugas tidak dapat diperiksa saat ini.' });
  }
});

// V2.7.0 — Admin-only staff account management. Auth Admin API is used only server-side.
const STAFF_ROLES = new Set(['recovery_officer', 'document_printer', 'supervisor']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function notifyRoleUsers(service, roles, notification) {
  const { data: recipients, error: roleError } = await service
    .from('refugeeledger_user_roles').select('user_id')
    .in('role_code', roles).eq('is_active', true);
  if (roleError || !recipients?.length) return;
  const rows = [...new Set(recipients.map(row => row.user_id))].map(recipient_id => ({ recipient_id, ...notification }));
  const { error } = await service.from('docura_notifications').insert(rows);
  if (error) console.error('Docura notification could not be stored; apply V2.7.0 migration.');
}

router.get('/staff', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    if (result.roleRow.role_code !== 'admin') return res.status(403).json({ success: false, message: 'Manajemen akun petugas hanya dapat diakses Admin.' });
    const service = createServiceClient();
    const { data: roleRows, error: rolesError } = await service.from('refugeeledger_user_roles')
      .select('user_id,role_code,display_name,is_active,created_at')
      .in('role_code', [...STAFF_ROLES]).order('created_at', { ascending: false }).limit(500);
    if (rolesError) throw rolesError;
    const usersById = new Map();
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      for (const user of (data?.users || [])) usersById.set(user.id, user);
      if (!data?.users || data.users.length < 200) break;
    }
    const staff = (roleRows || []).map(row => {
      const user = usersById.get(row.user_id);
      return { userId: row.user_id, email: user?.email || '', displayName: row.display_name || ROLE_LABELS[row.role_code] || row.role_code,
        role: row.role_code, roleLabel: ROLE_LABELS[row.role_code] || row.role_code, active: Boolean(row.is_active), createdAt: row.created_at,
        emailConfirmed: Boolean(user?.email_confirmed_at) };
    });
    return res.json({ success: true, staff });
  } catch (error) {
    console.error('Staff directory request failed:', error.message);
    return res.status(500).json({ success: false, message: 'Daftar petugas belum dapat dimuat. Pastikan kunci service-role dan migrasi V2.7.0 tersedia di server.' });
  }
});

router.post('/staff', async (req, res) => {
  let createdUserId = null;
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    if (result.roleRow.role_code !== 'admin') return res.status(403).json({ success: false, message: 'Hanya Admin yang dapat membuat akun petugas.' });
    const name = String(req.body?.displayName || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.temporaryPassword || '');
    const role = String(req.body?.role || '');
    if (name.length < 2 || name.length > 100) return res.status(400).json({ success: false, message: 'Nama petugas harus terdiri dari 2–100 karakter.' });
    if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ success: false, message: 'Masukkan email petugas yang valid.' });
    if (password.length < 12 || password.length > 72) return res.status(400).json({ success: false, message: 'Kata sandi awal harus terdiri dari 12–72 karakter.' });
    if (!STAFF_ROLES.has(role)) return res.status(400).json({ success: false, message: 'Role petugas tidak valid.' });

    const service = createServiceClient();
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: name, account_type: 'staff', created_by_admin: result.user.id }
    });
    if (createError || !created?.user) {
      const message = String(createError?.message || 'Akun tidak dapat dibuat.');
      if (/already registered|already been registered/i.test(message)) return res.status(409).json({ success: false, message: 'Email tersebut sudah digunakan oleh akun Docura.' });
      console.error('Staff auth account creation failed:', message);
      return res.status(400).json({ success: false, message: 'Akun petugas tidak dapat dibuat. Periksa email dan konfigurasi Auth.' });
    }
    createdUserId = created.user.id;
    const { error: roleInsertError } = await service.from('refugeeledger_user_roles').insert({
      user_id: createdUserId, role_code: role, display_name: name, is_active: true
    });
    if (roleInsertError) {
      await service.auth.admin.deleteUser(createdUserId).catch(() => {});
      createdUserId = null;
      console.error('Staff role assignment failed:', roleInsertError.message);
      return res.status(500).json({ success: false, message: 'Akun tidak dapat diselesaikan karena role belum tersimpan. Tidak ada akun parsial yang dipertahankan.' });
    }
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'admin-staff-account-created', 'staff_account', createdUserId, { outcome: 'success' });
    return res.status(201).json({ success: true, message: 'Akun petugas berhasil dibuat. Sampaikan kata sandi awal secara aman kepada petugas.', staff: { userId: createdUserId, email, displayName: name, role, roleLabel: ROLE_LABELS[role] || role, active: true } });
  } catch (error) {
    if (createdUserId) { try { await createServiceClient().auth.admin.deleteUser(createdUserId); } catch (_) {} }
    console.error('Staff account creation failed:', error.message);
    return res.status(500).json({ success: false, message: 'Pembuatan akun petugas belum dapat diproses. Pastikan SUPABASE_SERVICE_ROLE_KEY dan migrasi V2.7.0 sudah dikonfigurasi.' });
  }
});

router.get('/notifications', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const service = createServiceClient();
    const { data, error } = await service.from('docura_notifications')
      .select('id,event_type,title,message,target_type,target_id,created_at,read_at')
      .eq('recipient_id', result.user.id).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return res.json({ success: true, notifications: data || [], unreadCount: (data || []).filter(n => !n.read_at).length });
  } catch (error) {
    console.error('Notification list failed:', error.message);
    return res.status(500).json({ success: false, message: 'Notifikasi belum tersedia. Jalankan migrasi Docura V2.7.0.' });
  }
});

router.patch('/notifications/:id/read', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const service = createServiceClient();
    const { error } = await service.from('docura_notifications').update({ read_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('recipient_id', result.user.id).is('read_at', null);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error('Notification update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Status notifikasi tidak dapat diperbarui.' });
  }
});

router.post('/notifications/read-all', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const service = createServiceClient();
    const { error } = await service.from('docura_notifications').update({ read_at: new Date().toISOString() })
      .eq('recipient_id', result.user.id).is('read_at', null);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error('Mark-all-read failed:', error.message);
    return res.status(500).json({ success: false, message: 'Notifikasi tidak dapat ditandai sudah dibaca.' });
  }
});

// Admin-only, read-only audit viewer. Return metadata only; never return details JSON,
// which may contain historical sensitive fields from earlier database versions.
router.get('/audit-logs', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    if (result.roleRow.role_code !== 'admin') {
      return res.status(403).json({ success: false, message: 'Log audit hanya dapat diakses Admin.' });
    }
    const limitRaw = Number.parseInt(String(req.query.limit || '50'), 10);
    const offsetRaw = Number.parseInt(String(req.query.offset || '0'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.min(100000, Math.max(0, offsetRaw)) : 0;
    const eventType = String(req.query.eventType || '').trim();
    if (eventType && !/^[a-z0-9-]{3,80}$/.test(eventType)) {
      return res.status(400).json({ success: false, message: 'Filter jenis peristiwa tidak valid.' });
    }
    const service = createServiceClient();
    let query = service.from('refugeeledger_audit_logs')
      .select('id,actor_id,actor_role,event_type,target_type,target_id,request_id,outcome,created_at', { count: 'exact' })
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    if (eventType) query = query.eq('event_type', eventType);
    const { data, error, count } = await query;
    if (error) throw error;
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'audit-log-viewed', 'audit_log', null, { count: (data || []).length });
    return res.json({
      success: true,
      logs: (data || []).map(row => ({
        id: row.id, actorId: row.actor_id, actorRole: row.actor_role || null,
        eventType: row.event_type, targetType: row.target_type || null,
        targetId: row.target_id || null, requestId: row.request_id || null,
        outcome: row.outcome || 'success', createdAt: row.created_at,
      })),
      pagination: { limit, offset, total: count || 0 },
    });
  } catch (error) {
    console.error('Audit log query failed; check V2.5.1 migration and server credentials.');
    return res.status(500).json({ success: false, message: 'Log audit belum dapat dimuat. Pastikan migrasi Docura V2.5.1 sudah dijalankan.' });
  }
});

// Permission check endpoint for UI affordances. Actual writes are independently validated by the Stage 7D SQL RPC.
const ACTION_ROLES = {
  'new-case': ['recovery_officer'],
  'face-scan': ['recovery_officer'],
  'move-review': ['recovery_officer'],
  'edit-note': ['recovery_officer', 'supervisor'],
  'cancel-case': ['recovery_officer', 'supervisor'],
  approve: ['supervisor'],
  reject: ['supervisor'],
  'print-pending': ['document_printer'],
  complete: ['document_printer', 'admin'],
  'emergency-toggle': ['admin'],
  'open-case': ['admin', 'recovery_officer', 'document_printer', 'supervisor'],
  'view-cases': ['admin', 'recovery_officer', 'document_printer', 'supervisor'],
  'view-qr': ['admin', 'recovery_officer', 'document_printer', 'supervisor'],
};

router.post('/authorize-action', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const action = String(req.body?.action || '');
    const allowedRoles = ACTION_ROLES[action];
    if (!allowedRoles) return res.status(400).json({ success: false, message: 'Aksi tidak dikenal.' });
    let emergencyMode = false;
    const { data: settings } = await result.auth.from('refugeeledger_officer_settings').select('emergency_mode').eq('id', 1).maybeSingle();
    emergencyMode = Boolean(settings?.emergency_mode);
    const role = result.roleRow.role_code;
    const emergencyOperationalAction = emergencyMode && action !== 'emergency-toggle'
      && ['admin', 'recovery_officer', 'document_printer', 'supervisor'].includes(role);
    const adminNormalAction = role === 'admin' && ['approve','reject','open-case','view-cases','emergency-toggle'].includes(action);
    const allowed = adminNormalAction || allowedRoles.includes(role) || emergencyOperationalAction;
    if (!allowed) return res.status(403).json({ success: false, message: 'Peran akun Anda tidak memiliki kewenangan untuk tindakan ini pada mode yang aktif.' });
    return res.json({ success: true, allowed: true, role, emergencyMode });
  } catch (error) {
    console.error('Officer action authorization failed:', error.message);
    return res.status(500).json({ success: false, message: 'Kewenangan tindakan tidak dapat diperiksa saat ini.' });
  }
});


// Case data is stored centrally in Supabase. Every write is delegated to a
// SECURITY DEFINER RPC that repeats role and state-transition checks in SQL.
// Admin-only citizen directory. Do not expose document contents or authentication secrets.
router.get('/citizens', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    if (result.roleRow.role_code !== 'admin') {
      return res.status(403).json({ success: false, message: 'Daftar seluruh akun warga hanya dapat diakses Admin.' });
    }
    const rawQuery = normalizeCitizenSearchQuery(req.query.q);
    let query = result.auth
      .from('docura_citizen_profiles')
      .select('user_id,citizen_code,full_name,email,is_active,passkey_enabled,created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (rawQuery) {
      const safe = rawQuery;
      if (safe.length < 2) return res.json({ success: true, citizens: [] });
      query = query.or(`citizen_code.ilike.%${safe}%,full_name.ilike.%${safe}%,email.ilike.%${safe}%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'admin-citizen-directory-viewed', 'citizen_directory', null, { count: (data || []).length });
    return res.json({ success: true, citizens: (data || []).map(row => ({
      userId: row.user_id, citizenCode: row.citizen_code, fullName: row.full_name,
      email: row.email || '', active: Boolean(row.is_active), passkeyEnabled: Boolean(row.passkey_enabled), createdAt: row.created_at
    })) });
  } catch (error) {
    console.error('Admin citizen directory failed:', error.message);
    return res.status(500).json({ success: false, message: 'Daftar warga belum dapat dimuat. Jalankan migrasi Docura V2.1 terlebih dahulu.' });
  }
});

// Search registered citizens for case creation. Admin/recovery officers can search in Normal Mode;
// other active staff can search only when Emergency Mode grants operational case-creation permission.
router.get('/citizens/search', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const role = result.roleRow.role_code;
    const { data: settings, error: settingsError } = await result.auth
      .from('refugeeledger_officer_settings').select('emergency_mode').eq('id', 1).maybeSingle();
    if (settingsError) throw settingsError;
    const emergencyMode = Boolean(settings?.emergency_mode);
    const canCreate = canSearchCitizensForCase(role, emergencyMode);
    if (!canCreate) return res.status(403).json({ success: false, message: 'Peran Anda tidak memiliki izin membuat kasus pada mode saat ini.' });
    const q = normalizeCitizenSearchQuery(req.query.q);
    if (q.length < 3) return res.json({ success: true, citizens: [] });
    const safe = q;
    const { data, error } = await result.auth
      .from('docura_citizen_profiles')
      .select('user_id,citizen_code,full_name,is_active')
      .eq('is_active', true)
      .ilike('citizen_code', `%${safe}%`)
      .order('citizen_code', { ascending: true })
      .limit(20);
    if (error) throw error;
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'citizen-search-performed', 'citizen_directory', null, { count: (data || []).length, queryLength: q.length });
    return res.json({ success: true, citizens: (data || []).map(row => ({
      userId: row.user_id, citizenCode: row.citizen_code, fullName: row.full_name, active: Boolean(row.is_active)
    })) });
  } catch (error) {
    console.error('Citizen search failed:', error.message);
    return res.status(500).json({ success: false, message: 'Pencarian warga belum dapat digunakan. Pastikan migrasi Docura V2.1 sudah dijalankan.' });
  }
});

router.get('/cases', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const { data: settings, error: settingsError } = await result.auth
      .from('refugeeledger_officer_settings')
      .select('emergency_mode')
      .eq('id', 1)
      .maybeSingle();
    if (settingsError) throw settingsError;
    const emergencyMode = Boolean(settings?.emergency_mode);

    const { data, error } = await result.auth
      .from('refugeeledger_recovery_cases')
      .select('id, citizen_code, citizen_name, location, disaster, documents, status, created_at, note, identity_checked, review_note, assigned_to, recovery_channel')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const terminalStatuses = new Set(['COMPLETED', 'CANCELLED', 'REJECTED']);
    // In Emergency Mode, an active case belongs to its assigned staff member.
    // Filter it on the server so it does not appear in another division's case log.
    // SQL RPC authorization still rejects direct attempts to mutate another staff member's case.
    const visibleRows = (data || []).filter((row) => {
      const active = !terminalStatuses.has(row.status);
      const assignedToAnotherStaff = row.assigned_to && row.assigned_to !== result.user.id;
      return !(emergencyMode && active && assignedToAnotherStaff);
    });
    const cases = visibleRows.map((row) => ({
      id: row.id, citizenCode: row.citizen_code, citizenName: row.citizen_name,
      location: row.location, disaster: row.disaster, documents: row.documents || [],
      status: row.status, createdAt: row.created_at, note: row.note || '',
      identityChecked: row.identity_checked, reviewNote: row.review_note || '', assignedTo: row.assigned_to || null, recoveryChannel: row.recovery_channel || 'OFFICE'
    }));
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'officer-case-list-viewed', 'recovery_case', null, { count: cases.length });
    return res.json({ success: true, cases });
  } catch (error) {
    console.error('List officer cases failed:', error.message);
    return res.status(500).json({ success: false, message: 'Data kasus belum dapat dimuat. Pastikan SQL Stage 7D sudah dijalankan.' });
  }
});

// V2.8.0 — Generate receipt data only for completed cases visible to this staff account.
router.get('/cases/:caseId/receipt', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const caseId = String(req.params.caseId || '').trim();
    if (!caseId || caseId.length > 80) return res.status(400).json({ success: false, message: 'Nomor kasus tidak valid.' });
    // Use the signed-in user's RLS-scoped client first; service-role reads happen only after access is confirmed.
    const { data: caseRow, error: caseError } = await result.auth.from('refugeeledger_recovery_cases')
      .select('id,citizen_code,citizen_name,location,disaster,status,created_at,updated_at,created_by,updated_by,citizen_user_id,recovery_channel,note,review_note')
      .eq('id', caseId).maybeSingle();
    if (caseError) throw caseError;
    if (!caseRow) return res.status(404).json({ success: false, message: 'Kasus tidak ditemukan atau tidak dapat diakses oleh akun ini.' });
    if (caseRow.status !== 'COMPLETED') return res.status(409).json({ success: false, message: 'Bukti pemulihan hanya tersedia setelah kasus berstatus selesai.' });
    const service = createServiceClient();
    const { data: batch, error: batchError } = await service.from('docura_case_print_batches')
      .select('id,actor_id,document_titles,printed_at').eq('case_id', caseId).order('printed_at', { ascending: false }).limit(1).maybeSingle();
    if (batchError) throw batchError;
    if (!batch) return res.status(404).json({ success: false, message: 'Catatan penyerahan dokumen belum tersedia untuk kasus ini.' });
    const { data: actorRole } = await service.from('refugeeledger_user_roles').select('display_name,role_code').eq('user_id', batch.actor_id).maybeSingle();
    const actorLabel = actorRole?.display_name || 'Petugas Docura';
    const roleLabel = ROLE_LABELS[actorRole?.role_code] || 'Petugas';
    const documentTitles = Array.isArray(batch.document_titles) ? batch.document_titles.map(item => String(item?.title || '')).filter(Boolean).slice(0, 30) : [];
    const receipt = {
      receiptNumber: `DCR-${String(batch.id).toUpperCase()}`,
      caseId: caseRow.id,
      citizenName: caseRow.citizen_name,
      citizenCode: caseRow.citizen_code,
      location: caseRow.location,
      disaster: caseRow.disaster,
      recoveryChannel: caseRow.recovery_channel || 'OFFICE',
      caseCreatedAt: caseRow.created_at,
      completedAt: batch.printed_at || caseRow.updated_at,
      staffName: actorLabel,
      staffRole: roleLabel,
      documentTitles,
      status: caseRow.status,
      note: caseRow.review_note || ''
    };
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'recovery-receipt-viewed', 'recovery_case', caseRow.id, { receipt_id: batch.id, document_count: documentTitles.length });
    return res.json({ success: true, receipt });
  } catch (error) {
    console.error('Recovery receipt request failed:', error.message);
    return res.status(500).json({ success: false, message: 'Bukti pemulihan belum dapat dibuat saat ini.' });
  }
});

router.get('/settings', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const { data, error } = await result.auth
      .from('refugeeledger_officer_settings')
      .select('emergency_mode')
      .eq('id', 1)
      .single();
    if (error) throw error;
    return res.json({ success: true, emergencyMode: Boolean(data.emergency_mode) });
  } catch (error) {
    console.error('Load officer settings failed:', error.message);
    return res.status(500).json({ success: false, message: 'Pengaturan petugas belum dapat dimuat. Pastikan SQL Stage 7D sudah dijalankan.' });
  }
});



// Officer-local WebAuthn: a real platform authenticator/passkey ceremony, but not a
// fingerprint-template capture or government/KTP-el biometric match.
const OFFICER_WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const officerWebAuthnRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, message: 'Terlalu banyak percobaan WebAuthn. Tunggu 15 menit lalu coba lagi.' });
async function saveOfficerChallenge(service, userId, purpose, challenge) {
  const { error } = await service.from('docura_passkey_challenges').upsert({
    user_id: userId, purpose, challenge,
    expires_at: new Date(Date.now() + OFFICER_WEBAUTHN_CHALLENGE_TTL_MS).toISOString(),
    consumed_at: null
  }, { onConflict: 'user_id,purpose' });
  if (error) throw error;
}
async function consumeOfficerChallenge(service, userId, purpose, challenge) {
  const { data, error } = await service.from('docura_passkey_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('user_id', userId).eq('purpose', purpose).eq('challenge', challenge)
    .is('consumed_at', null).gt('expires_at', new Date().toISOString())
    .select('challenge').maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
function officerPublicKeyOptions(config, challenge, user, credentials = []) {
  return {
    challenge,
    rp: { name: config.rpName, id: config.rpID },
    user: { id: b64url(Buffer.from(user.id.replace(/-/g, ''), 'hex')), name: user.email || user.id, displayName: String(user.user_metadata?.full_name || user.email || 'Petugas Docura').slice(0, 100) },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: credentials.map(row => ({ type: 'public-key', id: row.credential_id, transports: row.transports || [] }))
  };
}
async function officerCaseForFingerprint(result, caseId, flow = 'identity') {
  if (!caseId || typeof caseId !== 'string' || caseId.length > 100) return { error: 'ID kasus tidak valid.', status: 400 };
  const { data: row, error } = await result.auth.from('refugeeledger_recovery_cases')
    .select('id,status,assigned_to').eq('id', caseId).maybeSingle();
  if (error) throw error;
  if (!row) return { error: 'Kasus tidak ditemukan atau tidak dapat diakses.', status: 404 };
  const allowedStatuses = flow === 'print' ? ['APPROVED', 'PRINT_PENDING'] : ['OPEN', 'IDENTITY_CHECK'];
  if (!allowedStatuses.includes(row.status)) return { error: flow === 'print' ? 'Verifikasi perangkat hanya tersedia untuk kasus yang disetujui atau menunggu cetak.' : 'Verifikasi identitas hanya tersedia untuk kasus yang masih pada tahap pemeriksaan identitas.', status: 409 };
  if (row.assigned_to && row.assigned_to !== result.user.id) return { error: 'Kasus ini ditugaskan kepada petugas lain.', status: 403 };
  return { caseRow: row };
}

router.get('/webauthn/status', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const service = createServiceClient();
    const { data, error } = await service.from('docura_passkey_credentials').select('credential_id,device_label,created_at').eq('user_id', result.user.id).order('created_at', { ascending: true });
    if (error) throw error;
    return res.json({ success: true, registered: Boolean(data?.length), count: data?.length || 0, credentials: (data || []).map(row => ({ deviceLabel: row.device_label || 'Autentikator lokal', createdAt: row.created_at })) });
  } catch (error) {
    console.error('Officer WebAuthn status failed:', error.message);
    return res.status(500).json({ success: false, message: 'Status WebAuthn lokal belum dapat dimuat. Pastikan migrasi passkey V2.2 sudah diterapkan.' });
  }
});

router.post('/webauthn/registration/options', officerWebAuthnRateLimit, async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const service = createServiceClient();
    const { data: existing, error } = await service.from('docura_passkey_credentials').select('credential_id,transports').eq('user_id', result.user.id);
    if (error) throw error;
    const challenge = crypto.randomBytes(32).toString('base64url');
    await saveOfficerChallenge(service, result.user.id, 'registration', challenge);
    return res.json({ success: true, options: officerPublicKeyOptions(expectedConfig(), challenge, result.user, existing || []) });
  } catch (error) {
    console.error('Officer WebAuthn registration options failed:', error.message);
    return res.status(503).json({ success: false, message: 'Pendaftaran autentikator lokal tidak tersedia. Periksa konfigurasi WEBAUTHN_RP_ID dan WEBAUTHN_ORIGIN.' });
  }
});

router.post('/webauthn/registration/verify', officerWebAuthnRateLimit, async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const challenge = String(req.body?.challenge || '');
    if (!challenge || !req.body?.credential) return res.status(400).json({ success: false, message: 'Respons pendaftaran WebAuthn tidak lengkap.' });
    const service = createServiceClient();
    if (!await consumeOfficerChallenge(service, result.user.id, 'registration', challenge)) return res.status(403).json({ success: false, message: 'Challenge pendaftaran kedaluwarsa atau sudah digunakan. Ulangi proses.' });
    const credential = verifyRegistrationResponse(req.body.credential, challenge);
    const { error } = await service.from('docura_passkey_credentials').insert({
      credential_id: credential.credentialId, user_id: result.user.id,
      public_key_jwk: credential.publicKeyJwk, counter: credential.counter,
      transports: credential.transports, device_label: String(req.body?.deviceLabel || 'Autentikator lokal petugas').trim().slice(0, 80),
      created_at: new Date().toISOString(), last_used_at: null
    });
    if (error) throw error;
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'officer-webauthn-registered', 'officer_account', result.user.id, { provider: 'webauthn-platform', outcome: 'success' });
    return res.json({ success: true, message: 'Autentikator lokal berhasil didaftarkan. Data biometrik tetap berada pada perangkat.' });
  } catch (error) {
    console.error('Officer WebAuthn registration verification failed:', error.message);
    return res.status(400).json({ success: false, message: error.message || 'Pendaftaran autentikator lokal gagal diverifikasi.' });
  }
});

router.post('/webauthn/authentication/options', officerWebAuthnRateLimit, async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const allowed = await officerCaseForFingerprint(result, String(req.body?.caseId || ''), req.body?.flow === 'print' ? 'print' : 'identity');
    if (allowed.error) return res.status(allowed.status).json({ success: false, message: allowed.error });
    const service = createServiceClient();
    const { data: credentials, error } = await service.from('docura_passkey_credentials').select('credential_id,transports').eq('user_id', result.user.id);
    if (error) throw error;
    if (!credentials?.length) return res.status(409).json({ success: false, message: 'Belum ada autentikator lokal terdaftar. Daftarkan perangkat terlebih dahulu.' });
    const challenge = crypto.randomBytes(32).toString('base64url');
    await saveOfficerChallenge(service, result.user.id, 'authentication', challenge);
    return res.json({ success: true, options: { challenge, rpId: expectedConfig().rpID, timeout: 60000, userVerification: 'required', allowCredentials: credentials.map(row => ({ type: 'public-key', id: row.credential_id, transports: row.transports || [] })) } });
  } catch (error) {
    console.error('Officer WebAuthn authentication options failed:', error.message);
    return res.status(503).json({ success: false, message: 'Autentikasi WebAuthn lokal belum dapat dimulai. Periksa konfigurasi server.' });
  }
});

router.post('/webauthn/authentication/verify', officerWebAuthnRateLimit, async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const caseId = String(req.body?.caseId || '');
    const allowed = await officerCaseForFingerprint(result, caseId, req.body?.flow === 'print' ? 'print' : 'identity');
    if (allowed.error) return res.status(allowed.status).json({ success: false, message: allowed.error });
    const challenge = String(req.body?.challenge || '');
    const response = req.body?.credential;
    if (!challenge || !response?.id) return res.status(400).json({ success: false, message: 'Respons autentikasi WebAuthn tidak lengkap.' });
    const service = createServiceClient();
    if (!await consumeOfficerChallenge(service, result.user.id, 'authentication', challenge)) return res.status(403).json({ success: false, message: 'Challenge autentikasi kedaluwarsa atau sudah digunakan. Ulangi pemindaian.' });
    const { data: credential, error } = await service.from('docura_passkey_credentials').select('*').eq('user_id', result.user.id).eq('credential_id', response.id).maybeSingle();
    if (error) throw error;
    if (!credential) return res.status(403).json({ success: false, message: 'Autentikator ini tidak terdaftar untuk akun petugas.' });
    const verified = verifyAuthenticationResponse(response, challenge, credential);
    const { error: updateError } = await service.from('docura_passkey_credentials').update({ counter: verified.counter, last_used_at: new Date().toISOString() }).eq('user_id', result.user.id).eq('credential_id', credential.credential_id);
    if (updateError) throw updateError;
    const verificationToken = issueDemoProof({ userId: result.user.id, caseId });
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'officer-webauthn-verified', 'recovery_case', caseId, { provider: 'webauthn-platform', outcome: 'success' });
    return res.json({ success: true, verificationToken, expiresInSeconds: 120, message: 'Autentikator lokal berhasil memverifikasi pengguna perangkat. Ini bukan pencocokan sidik jari KTP-el.' });
  } catch (error) {
    console.error('Officer WebAuthn authentication verification failed:', error.message);
    return res.status(403).json({ success: false, message: error.message || 'Autentikasi WebAuthn gagal.' });
  }
});

// Recovery printing endpoints expose only document titles until an authorized printer
// explicitly requests short-lived signed URLs for selected documents.
function canOperatePrint(role, emergencyMode) {
  return role === 'admin' || role === 'document_printer' || (emergencyMode && ['recovery_officer', 'supervisor'].includes(role));
}
async function getPrintCase(result, caseId) {
  const { data: settings, error: settingsError } = await result.auth.from('refugeeledger_officer_settings').select('emergency_mode').eq('id', 1).maybeSingle();
  if (settingsError) throw settingsError;
  const emergencyMode = Boolean(settings?.emergency_mode);
  if (!canOperatePrint(result.roleRow.role_code, emergencyMode)) return { error: 'Peran Anda tidak memiliki izin memproses pencetakan dokumen.', status: 403 };
  const { data: caseRow, error } = await result.auth.from('refugeeledger_recovery_cases')
    .select('id,citizen_user_id,citizen_code,citizen_name,status,assigned_to')
    .eq('id', caseId).maybeSingle();
  if (error) throw error;
  if (!caseRow) return { error: 'Kasus tidak ditemukan.', status: 404 };
  if (caseRow.status !== 'PRINT_PENDING') return { error: 'Kasus harus berada dalam antrean cetak sebelum dokumen diproses.', status: 409 };
  if (!caseRow.citizen_user_id) return { error: 'Kasus ini belum terhubung dengan akun warga terdaftar; dokumen tidak dapat dimuat.', status: 409 };
  if (emergencyMode && caseRow.assigned_to && caseRow.assigned_to !== result.user.id && result.roleRow.role_code !== 'admin') return { error: 'Kasus darurat ini ditugaskan kepada petugas lain.', status: 403 };
  return { caseRow, emergencyMode };
}
function validDocumentIds(value) {
  return Array.isArray(value) && value.length >= 1 && value.length <= 30 && value.every(id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) && new Set(value.map(x => x.toLowerCase())).size === value.length;
}
router.get('/cases/:caseId/recovery-documents', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const allowed = await getPrintCase(result, req.params.caseId);
    if (allowed.error) return res.status(allowed.status).json({ success: false, message: allowed.error });
    const service = createServiceClient();
    const { data, error } = await service.from('documents').select('id,title,created_at')
      .eq('owner_id', allowed.caseRow.citizen_user_id).eq('status', 'ACTIVE').order('created_at', { ascending: false });
    if (error) throw error;
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'recovery-document-titles-viewed', 'recovery_case', allowed.caseRow.id, { count: (data || []).length });
    return res.json({ success: true, documents: (data || []).map(d => ({ id: d.id, title: d.title })) });
  } catch (error) {
    console.error('Recovery document titles lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Daftar judul dokumen warga belum dapat dimuat. Periksa konfigurasi service role dan tabel dokumen.' });
  }
});
router.post('/cases/:caseId/print-documents', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const allowed = await getPrintCase(result, req.params.caseId);
    if (allowed.error) return res.status(allowed.status).json({ success: false, message: allowed.error });
    const ids = req.body?.documentIds;
    if (!validDocumentIds(ids)) return res.status(400).json({ success: false, message: 'Pilih 1–30 dokumen berbeda untuk dicetak.' });
    const service = createServiceClient();
    const { data: docs, error } = await service.from('documents')
      .select('id,title,storage_path,mime_type,owner_id,status').in('id', ids)
      .eq('owner_id', allowed.caseRow.citizen_user_id).eq('status', 'ACTIVE');
    if (error) throw error;
    if (!docs || docs.length !== ids.length) return res.status(403).json({ success: false, message: 'Satu atau beberapa dokumen tidak aktif atau bukan milik warga pada kasus ini.' });
    const results = [];
    for (const id of ids) {
      const doc = docs.find(d => d.id.toLowerCase() === id.toLowerCase());
      const { data, error: signedError } = await service.storage.from('citizen-documents').createSignedUrl(doc.storage_path, 120, { download: false });
      if (signedError) throw signedError;
      results.push({ id: doc.id, title: doc.title, mimeType: doc.mime_type, url: data.signedUrl, expiresInSeconds: 120 });
    }
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'recovery-print-links-created', 'recovery_case', allowed.caseRow.id, { count: results.length });
    return res.json({ success: true, documents: results, message: 'Tautan privat berumur 2 menit dibuat untuk dokumen yang dipilih.' });
  } catch (error) {
    console.error('Recovery document print links failed:', error.message);
    return res.status(500).json({ success: false, message: 'Tautan cetak dokumen tidak dapat dibuat. Periksa bucket privat dan konfigurasi server.' });
  }
});
// V2.9.0: local WebAuthn verification only. No KTP-el / government biometric provider is simulated here.
router.post('/cases/:caseId/print-local-verification', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const allowed = await getPrintCase(result, req.params.caseId);
    if (allowed.error) return res.status(allowed.status).json({ success: false, message: allowed.error });
    if (!consumeDemoProof({ token: req.body?.webauthnVerificationToken, userId: result.user.id, caseId: allowed.caseRow.id })) {
      await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'print-webauthn-proof-rejected', 'recovery_case', allowed.caseRow.id, { outcome: 'missing-expired-replayed-or-mismatched' });
      return res.status(403).json({ success: false, message: 'Bukti WebAuthn lokal tidak ada, kedaluwarsa, sudah dipakai, atau tidak terikat ke kasus ini. Verifikasi perangkat ulang.' });
    }
    const verificationToken = issueDemoProof({ userId: result.user.id, caseId: allowed.caseRow.id });
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'print-local-webauthn-verified', 'recovery_case', allowed.caseRow.id, { outcome: 'success' });
    return res.json({ success: true, verificationToken, expiresInSeconds: 120, message: 'Autentikasi perangkat lokal berhasil. Anda dapat melanjutkan proses pencetakan.' });
  } catch (error) {
    console.error('Local print verification failed:', error.message);
    return res.status(500).json({ success: false, message: 'Verifikasi perangkat lokal belum dapat diproses.' });
  }
});

router.post('/cases/:caseId/complete-print-batch', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const allowed = await getPrintCase(result, req.params.caseId);
    if (allowed.error) return res.status(allowed.status).json({ success: false, message: allowed.error });
    const ids = req.body?.documentIds;
    if (!validDocumentIds(ids)) return res.status(400).json({ success: false, message: 'Pilih setidaknya satu dokumen yang sudah dicetak.' });
    if (req.body?.printConfirmed !== true) {
      return res.status(400).json({ success: false, message: 'Konfirmasi pencetakan diperlukan sebelum menutup kasus.' });
    }
    if (!consumeDemoProof({ token: req.body?.biometricVerificationToken, userId: result.user.id, caseId: allowed.caseRow.id })) {
      await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'biometric-demo-proof-rejected', 'recovery_case', allowed.caseRow.id, { outcome: 'missing-expired-replayed-or-mismatched' });
      return res.status(403).json({ success: false, message: 'Bukti simulasi tidak ada, kedaluwarsa, sudah dipakai, atau terikat ke kasus/petugas lain. Jalankan verifikasi ulang.' });
    }
    const { data, error } = await result.auth.rpc('officer_case_complete_print_batch', {
      p_case_id: req.params.caseId,
      p_payload: { documentIds: ids, printConfirmed: true, fingerprintSimulationCompleted: true }
    });
    if (error) {
      const msg = String(error.message || '');
      const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : error.code === '22023' ? 400 : 409;
      if (!['42501','P0002','22023'].includes(error.code)) console.error('Complete print batch RPC failed:', msg, error.code);
      return res.status(status).json({ success: false, message: msg.includes('DOCURA:') ? msg.split('DOCURA:').pop().trim() : 'Penyelesaian ditolak oleh aturan keamanan atau status kasus.' });
    }
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'case-print-batch-completed-api', 'recovery_case', req.params.caseId, { count: ids.length });
    try {
      const service = createServiceClient();
      const { data: completedCase } = await service.from('refugeeledger_recovery_cases').select('id,citizen_name,created_by').eq('id', req.params.caseId).maybeSingle();
      if (completedCase?.created_by && completedCase.created_by !== result.user.id) {
        await service.from('docura_notifications').insert({ recipient_id: completedCase.created_by, actor_id: result.user.id, event_type: 'case_completed', title: 'Pemulihan dokumen selesai', message: `Kasus ${completedCase.id} untuk ${completedCase.citizen_name} telah selesai diproses.`, target_type: 'recovery_case', target_id: completedCase.id });
      }
    } catch (_) { console.error('Completion notification routing failed; apply V2.7.0 migration.'); }
    return res.json({ success: true, result: data });
  } catch (error) {
    console.error('Complete print batch failed:', error.message);
    return res.status(500).json({ success: false, message: 'Penyelesaian antrean cetak belum dapat diproses.' });
  }
});

// QR payload is an opaque, short-lived token. It contains no citizen PII.
router.post('/qr/render', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const token = String(req.body?.token || '');
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ success: false, message: 'Token QR tidak valid.' });
    const dataUrl = await QRCode.toDataURL(token, { errorCorrectionLevel: 'M', margin: 2, width: 260 });
    await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'officer-qr-rendered', 'qr_code', null, { count: 1 });
    return res.json({ success: true, dataUrl });
  } catch (error) {
    console.error('QR render failed:', error.message);
    return res.status(500).json({ success: false, message: 'QR Code tidak dapat dibuat saat ini.' });
  }
});

router.post('/cases/actions', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const action = String(req.body?.action || '');
    const caseId = req.body?.caseId == null ? null : String(req.body.caseId);
    const payload = req.body?.payload && typeof req.body.payload === 'object' && !Array.isArray(req.body.payload) ? req.body.payload : {};
    const knownActions = new Set(['new-case', 'face-scan', 'move-review', 'edit-note', 'cancel-case', 'approve', 'reject', 'print-pending', 'complete', 'emergency-toggle']);
    if (!knownActions.has(action)) return res.status(400).json({ success: false, message: 'Aksi perubahan data tidak dikenal.' });
    if (action === 'complete') return res.status(400).json({ success: false, message: 'Gunakan alur pemilihan dan konfirmasi cetak dokumen untuk menyelesaikan kasus.' });
    if (action === 'face-scan') {
      if (!consumeDemoProof({ token: payload.biometricVerificationToken, userId: result.user.id, caseId })) {
        await recordAuditEvent(req, { id: result.user.id, roleRow: result.roleRow }, 'officer-webauthn-proof-rejected', 'recovery_case', caseId, { outcome: 'missing-expired-replayed-or-mismatched' });
        return res.status(403).json({ success: false, message: 'Bukti WebAuthn tidak ada, kedaluwarsa, sudah dipakai, atau tidak cocok dengan kasus. Jalankan verifikasi perangkat ulang.' });
      }
      delete payload.biometricVerificationToken;
    }
    const { data, error } = await result.auth.rpc('officer_case_action', {
      p_action: action,
      p_case_id: caseId,
      p_payload: payload
    });
    if (error) {
      const msg = String(error.message || '');
      const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : error.code === '22023' ? 400 : 409;
      if (![ '42501', 'P0002', '22023' ].includes(error.code)) console.error('Officer case mutation failed:', msg, error.code);
      return res.status(status).json({ success: false, message: msg.includes('RL:') ? msg.split('RL:').pop().trim() : 'Perubahan kasus ditolak oleh aturan keamanan atau status kasus.' });
    }
    try {
      const service = createServiceClient();
      const caseIdForNotice = String(data?.case?.id || data?.id || caseId || '');
      const noticeCase = caseIdForNotice ? await service.from('refugeeledger_recovery_cases').select('id,citizen_name,status').eq('id', caseIdForNotice).maybeSingle() : { data: null };
      const caseName = noticeCase.data?.citizen_name || 'Warga';
      if (action === 'move-review') await notifyRoleUsers(service, ['supervisor'], { actor_id: result.user.id, event_type: 'case_ready_for_review', title: 'Kasus siap ditinjau', message: `Kasus ${caseIdForNotice} untuk ${caseName} siap ditinjau Supervisor.`, target_type: 'recovery_case', target_id: caseIdForNotice });
      else if (action === 'approve') await notifyRoleUsers(service, ['document_printer'], { actor_id: result.user.id, event_type: 'case_approved_for_print', title: 'Kasus disetujui untuk pencetakan', message: `Kasus ${caseIdForNotice} untuk ${caseName} telah disetujui dan menunggu proses pencetakan.`, target_type: 'recovery_case', target_id: caseIdForNotice });
      else if (action === 'reject') await notifyRoleUsers(service, ['recovery_officer'], { actor_id: result.user.id, event_type: 'case_rejected', title: 'Kasus ditolak', message: `Kasus ${caseIdForNotice} untuk ${caseName} ditolak. Buka detail kasus untuk melihat status terbaru.`, target_type: 'recovery_case', target_id: caseIdForNotice });
      else if (action === 'print-pending') await notifyRoleUsers(service, ['document_printer'], { actor_id: result.user.id, event_type: 'case_approved_for_print', title: 'Kasus masuk antrean cetak', message: `Kasus ${caseIdForNotice} untuk ${caseName} masuk antrean pencetakan.`, target_type: 'recovery_case', target_id: caseIdForNotice });
    } catch (notificationError) { console.error('Case notification routing failed; apply V2.7.0 migration.'); }
    return res.json({ success: true, result: data });
  } catch (error) {
    console.error('Officer case mutation error:', error.message);
    return res.status(500).json({ success: false, message: 'Perubahan kasus tidak dapat diproses saat ini.' });
  }
});

module.exports = router;
