const express = require('express');
const { createAuthClient } = require('../config/supabase');
const QRCode = require('qrcode');
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
  complete: ['document_printer'],
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
    return res.json({ success: true, cases });
  } catch (error) {
    console.error('List officer cases failed:', error.message);
    return res.status(500).json({ success: false, message: 'Data kasus belum dapat dimuat. Pastikan SQL Stage 7D sudah dijalankan.' });
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

// QR payload is an opaque, short-lived token. It contains no citizen PII.
router.post('/qr/render', async (req, res) => {
  try {
    const result = await getOfficer(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const token = String(req.body?.token || '');
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ success: false, message: 'Token QR tidak valid.' });
    const dataUrl = await QRCode.toDataURL(token, { errorCorrectionLevel: 'M', margin: 2, width: 260 });
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
    return res.json({ success: true, result: data });
  } catch (error) {
    console.error('Officer case mutation error:', error.message);
    return res.status(500).json({ success: false, message: 'Perubahan kasus tidak dapat diproses saat ini.' });
  }
});

module.exports = router;
