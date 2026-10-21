const express = require('express');
const { createAuthClient } = require('../config/supabase');
const router = express.Router();

function bearer(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}
async function getCitizen(req) {
  const token = bearer(req);
  if (!token) return { error: 'Sesi tidak ditemukan. Silakan masuk kembali.', status: 401 };
  const auth = createAuthClient(token);
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data?.user || !data.user.email_confirmed_at) return { error: 'Sesi tidak valid atau email belum dikonfirmasi.', status: 401 };
  const { data: roleRow, error: roleError } = await auth.from('refugeeledger_user_roles').select('role_code,is_active').eq('user_id',data.user.id).maybeSingle();
  if (roleError) return { error: 'Role akun belum dapat diperiksa.', status: 503 };
  if (roleRow && !roleRow.is_active) return { error: 'Akun tidak aktif.', status: 403 };
  if (roleRow && roleRow.role_code !== 'citizen') return { error: 'Portal ini hanya untuk akun warga.', status: 403 };
  return { auth, user: data.user };
}
router.get('/profile', async (req, res) => {
  try {
    const result = await getCitizen(req);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    const { data, error } = await result.auth
      .from('docura_citizen_profiles')
      .select('user_id,citizen_code,full_name,email,is_active,passkey_enabled,created_at')
      .eq('user_id', result.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Profil warga belum tersedia. Pastikan migrasi Docura V2.1 sudah dijalankan dan akun warga terdaftar.' });
    return res.json({ success: true, profile: {
      userId: data.user_id, citizenCode: data.citizen_code, fullName: data.full_name,
      email: data.email || result.user.email || '', active: Boolean(data.is_active),
      passkeyEnabled: Boolean(data.passkey_enabled), createdAt: data.created_at
    } });
  } catch (error) {
    console.error('Citizen profile lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Profil warga belum dapat dimuat.' });
  }
});

router.get('/office-recovery', async (req,res) => {
  try {
    const result = await getCitizen(req);
    if (result.error) return res.status(result.status).json({success:false,message:result.error});
    const {data,error}=await result.auth.from('refugeeledger_recovery_cases').select('id,citizen_code,location,disaster,status,created_at,note,review_note').eq('citizen_user_id',result.user.id).order('created_at',{ascending:false});
    if(error) throw error;
    return res.json({success:true,requests:data||[]});
  } catch(error) {
    console.error('Citizen recovery request list failed:',error.message);
    return res.status(500).json({success:false,message:'Permintaan pemulihan belum dapat dimuat. Pastikan migrasi Stage 7D sudah dijalankan.'});
  }
});
router.post('/office-recovery', async (_req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Pengajuan pemulihan kantor melalui Portal Warga telah dinonaktifkan. Silakan datang langsung ke kantor layanan; petugas akan membuat kasus untuk Anda.'
  });
});
module.exports=router;
