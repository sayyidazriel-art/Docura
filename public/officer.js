(() => {
  'use strict';
  const pageContent = document.getElementById('pageContent');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalBody = document.getElementById('modalBody');
  const toast = document.getElementById('toast');
  let currentView = 'overview';
  let selectedCaseId = null;
  let toastTimer;
  let scanTimer;
  let officerProfile = null;
  let activeModalLocked = false;
  let restoringEmergencyDraft = false;
  let isCreatingCase = false;
  let citizenDirectory = [];
  let citizenDirectoryQuery = '';
  let selectedCitizen = null;
  let citizenSearchTimer = null;
  let staffDirectory = [];
  let notifications = [];
  let unreadNotificationCount = 0;
  function emergencyDraftKey(){ const uid=officerProfile?.user?.id; return uid ? `refugeeledger-emergency-case-draft:${uid}` : null; }
  function readEmergencyDraft(){ const key=emergencyDraftKey(); if(!key)return null; try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;} }
  function saveEmergencyDraft(values){ const key=emergencyDraftKey(); if(!key)return; try{localStorage.setItem(key,JSON.stringify({...values,savedAt:new Date().toISOString()}));}catch(_){showToast('Draft tidak dapat disimpan di browser ini.');} }
  function clearEmergencyDraft(){ const key=emergencyDraftKey(); if(key){try{localStorage.removeItem(key);}catch(_){}} }
  const PERMISSIONS = {
    admin: ['new-case','face-scan','move-review','edit-note','cancel-case','approve','reject','print-pending','complete','open-case','view-cases','view-qr','emergency-toggle'],
    recovery_officer: ['new-case','face-scan','move-review','edit-note','cancel-case','open-case','view-cases','view-qr'],
    document_printer: ['print-pending','complete','open-case','view-cases','view-qr'],
    supervisor: ['approve','reject','edit-note','cancel-case','open-case','view-cases','view-qr'],
  };
  const OPERATIONAL_ACTIONS = ['new-case','face-scan','move-review','edit-note','cancel-case','approve','reject','print-pending','complete','open-case','view-cases'];
  const ROLE_CONFIG = {
    admin: { title: 'Administrator Dashboard', subtitle: 'Pemantauan sistem dan seluruh alur petugas', navCases: 'Semua kasus', navWorkflow: 'Alur sistem', eyebrow: 'ADMINISTRATOR', description: 'Pantau gambaran alur pemulihan dan status kasus demonstrasi.' },
    recovery_officer: { title: 'Dashboard Pemulihan', subtitle: 'Workspace petugas pemulihan dokumen', navCases: 'Kasus pemulihan', navWorkflow: 'Alur verifikasi', eyebrow: 'PETUGAS PEMULIHAN', description: 'Daftarkan kasus demo, lakukan simulasi pemindaian sidik jari, dan teruskan untuk tinjauan.' },
    document_printer: { title: 'Dashboard Pencetakan', subtitle: 'Workspace antrean pencetakan dokumen', navCases: 'Antrean cetak', navWorkflow: 'Alur pencetakan', eyebrow: 'PENCETAK DOKUMEN', description: 'Tinjau kasus yang telah disetujui dan kelola status antrean cetak demo.' },
    supervisor: { title: 'Dashboard Pengawas', subtitle: 'Workspace peninjauan dan keputusan kasus', navCases: 'Kasus untuk ditinjau', navWorkflow: 'Alur persetujuan', eyebrow: 'PENGAWAS', description: 'Prioritaskan kasus yang menunggu keputusan dan pantau proses pemulihan.' },
  };
  function can(action) { if (!officerProfile) return false; if(action==='resume-draft') return Boolean(readEmergencyDraft()); const role=officerProfile.role; if (role==='admin') return action==='emergency-toggle' || (emergencyMode && OPERATIONAL_ACTIONS.includes(action)) || ['approve','reject','open-case','view-cases','view-qr'].includes(action); if (action==='emergency-toggle') return false; if (emergencyMode && OPERATIONAL_ACTIONS.includes(action)) return true; return (PERMISSIONS[role] || []).includes(action); }
  function getToken() { try { return JSON.parse(sessionStorage.getItem('refugeeledger-session') || '{}').access_token || ''; } catch (_) { return ''; } }
  async function authorizeAction(action) {
    const token = getToken();
    const response = await fetch('/api/officer/authorize-action', {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action})});
    const data = await response.json().catch(()=>({}));
    if (!response.ok || !data.success || !data.allowed) throw new Error(data.message || 'Aksi tidak diizinkan untuk peran Anda.');
    return true;
  }
  function applyRoleUI() {
    document.querySelectorAll('[data-action]').forEach((el) => { const action = el.dataset.action; if (action !== 'close-modal' && !can(action)) el.hidden = true; });
    const emergency = document.getElementById('emergencyToggle');
    if (emergency) emergency.hidden = !can('emergency-toggle');
    const profileName = document.getElementById('officerName');
    const profileRole = document.getElementById('officerRole');
    const avatar = document.getElementById('officerAvatar');
    if (profileName) profileName.textContent = officerProfile?.displayName || 'Petugas';
    if (profileRole) profileRole.textContent = officerProfile?.roleLabel || 'Akses terverifikasi';
    if (avatar) avatar.textContent = (officerProfile?.displayName || 'PT').split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
  }

  let cases = [];
  let emergencyMode = false;
  const statusInfo = {
    OPEN:{label:'Terbuka',tone:'blue'}, IDENTITY_CHECK:{label:'Pemeriksaan identitas',tone:'amber'}, DOCUMENT_REVIEW:{label:'Tinjauan dokumen',tone:'amber'}, APPROVED:{label:'Disetujui',tone:'green'}, REJECTED:{label:'Ditolak',tone:'red'}, PRINT_PENDING:{label:'Menunggu cetak',tone:'blue'}, COMPLETED:{label:'Selesai',tone:'green'}, CANCELLED:{label:'Dibatalkan',tone:'gray'}
  };
  async function officerApi(path, options={}) {
    const token = getToken();
    const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.message || 'Permintaan ke server gagal.');
    return data;
  }
  async function refreshCases() {
    const data = await officerApi('/api/officer/cases');
    cases = Array.isArray(data.cases) ? data.cases : [];
    return cases;
  }
  async function refreshSettings() {
    const data = await officerApi('/api/officer/settings');
    emergencyMode = Boolean(data.emergencyMode);
    return emergencyMode;
  }
  async function mutateCase(action, caseId=null, payload={}) {
    const data = await officerApi('/api/officer/cases/actions', { method: 'POST', body: JSON.stringify({ action, caseId, payload }) });
    await refreshCases();
    await refreshSettings();
    return data.result;
  }
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function badge(status){const x=statusInfo[status]||{label:status,tone:'gray'};return `<span class="badge ${x.tone}">${esc(x.label)}</span>`;}
  function dateText(iso){const d=new Date(iso);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric'}).format(d);}
  function showToast(msg){toast.textContent=msg;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),3100);}
  function activeCase(){return cases.find(c=>!['COMPLETED','CANCELLED','REJECTED'].includes(c.status));}
  function activeEmergencyAssignment(){return emergencyMode && cases.find(c=>c.assignedTo===officerProfile?.user?.id && !['COMPLETED','CANCELLED','REJECTED'].includes(c.status));}
  async function setEmergency(){try{await mutateCase('emergency-toggle');render();showToast(emergencyMode?'Emergency Mode diaktifkan.':'Emergency Mode dinonaktifkan.');}catch(error){showToast(error.message);}}
  function updateShell(){document.getElementById('emergencyText').textContent=emergencyMode?'Mode darurat aktif. Prioritas pemulihan berjalan.':'Mode darurat belum aktif.';const btn=document.getElementById('emergencyToggle');btn.textContent=emergencyMode?'Matikan mode':'Aktifkan mode';btn.style.background=emergencyMode?'#f3a2a7':'';btn.style.color=emergencyMode?'#4d1017':'';document.getElementById('navCaseCount').textContent=cases.filter(c=>!['COMPLETED','CANCELLED','REJECTED'].includes(c.status)).length;}
  function head(eyebrow,title,desc,action=''){return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${desc}</p></div>${action}</div>`;}
  function caseRow(c,withAction=true){return `<div class="case-row"><div class="case-symbol">${esc(c.citizenName.split(' ').map(x=>x[0]).slice(0,2).join(''))}</div><div class="case-row-main"><strong>${esc(c.citizenName)}</strong><small>${esc(c.id)} · ${esc(c.citizenCode)} · ${esc(c.location)}</small></div><div class="case-row-end">${badge(c.status)}${withAction?`<button class="small-btn" data-action="open-case" data-id="${esc(c.id)}">Buka kasus →</button>`:''}</div></div>`;}
  function roleConfig(){ return ROLE_CONFIG[officerProfile?.role] || ROLE_CONFIG.recovery_officer; }
  function configureRoleShell(){
    const cfg = roleConfig();
    document.title = `${cfg.title} — Docura`;
    const subtitle = document.getElementById('portalSubtitle');
    if (subtitle) subtitle.textContent = cfg.subtitle;
    const navOverview = document.querySelector('[data-view="overview"]');
    const navCases = document.querySelector('[data-view="cases"]');
    const navWorkflow = document.querySelector('[data-view="workflow"]');
    if (navOverview) navOverview.innerHTML = `<span>▦</span> ${esc(cfg.title)}`;
    if (navCases) { navCases.innerHTML = `<span>▤</span> ${esc(cfg.navCases)} <b id="navCaseCount">0</b>`; }
    if (navWorkflow) navWorkflow.innerHTML = `<span>✓</span> ${esc(cfg.navWorkflow)}`;
    if (navWorkflow) navWorkflow.hidden = officerProfile?.role === 'document_printer';
    const navCitizens = document.getElementById('navCitizens');
    if (navCitizens) navCitizens.hidden = officerProfile?.role !== 'admin';
    const navStaff = document.getElementById('navStaff');
    if (navStaff) navStaff.hidden = officerProfile?.role !== 'admin';
    const navAnalytics = document.getElementById('navAnalytics');
    if (navAnalytics) navAnalytics.hidden = officerProfile?.role !== 'admin';
    const emergencyCard = document.querySelector('.emergency-card');
    if (emergencyCard) emergencyCard.hidden = !can('emergency-toggle');
    const name = document.getElementById('officerName');
    const role = document.getElementById('officerRole');
    const avatar = document.getElementById('officerAvatar');
    if (name) name.textContent = officerProfile?.displayName || 'Petugas';
    if (role) role.textContent = officerProfile?.roleLabel || 'Akses terverifikasi';
    if (avatar) avatar.textContent = (officerProfile?.displayName || 'PT').split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
  }
  function statCard(label,value,note,icon='▤'){return `<article class="stat-card"><div class="stat-top">${esc(label)} <span class="stat-icon">${icon}</span></div><div class="stat-value">${esc(value)}</div><div class="stat-note">${esc(note)}</div></article>`;}
  function roleQueue(items,empty){return `<div class="case-list">${items.length?items.slice(0,5).map(c=>caseRow(c)).join(''):`<div class="empty-state">${esc(empty)}</div>`}</div>`;}
  function renderRoleOverview(){
    const role = officerProfile?.role || 'recovery_officer';
    const cfg = roleConfig();
    const active = cases.filter(c=>!['COMPLETED','CANCELLED','REJECTED'].includes(c.status));
    const review = cases.filter(c=>c.status==='DOCUMENT_REVIEW');
    const printQueue = cases.filter(c=>['APPROVED','PRINT_PENDING'].includes(c.status));
    const completed = cases.filter(c=>c.status==='COMPLETED');
    const canCreateCase = (role==='recovery_officer' || (emergencyMode && ['admin','document_printer','supervisor'].includes(role))) && !activeEmergencyAssignment();
    if(role==='admin'){
      return `${head(cfg.eyebrow,cfg.title,cfg.description,`<button class="btn btn-secondary" data-view="analytics" type="button">▥ Analitik operasional</button>`)}<div class="stat-grid">${statCard('Total kasus',cases.length,'Kasus yang tercatat di sistem','▤')}${statCard('Kasus aktif',active.length,'Belum ditutup','◷')}${statCard('Menunggu keputusan',review.length,'Status tinjauan dokumen','✓')}${statCard('Selesai',completed.length,'Kasus yang sudah ditutup','✓')}</div><div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Pemantauan kasus terbaru</h2><p>Data kasus bersama yang tersimpan di Supabase.</p></div><button class="text-btn" data-action="view-cases">Lihat semua →</button></div>${roleQueue(active,'Tidak ada kasus aktif.')}</section><section class="panel"><div class="panel-head"><div><h2>Daftar peran sistem</h2><p>Jenis role yang dikenali portal petugas.</p></div></div><div class="steps">${[['Administrator','Pengelolaan dan pemantauan sistem'],['Petugas Pemulihan','Pembuatan kasus dan simulasi sidik jari'],['Pencetak Dokumen','Antrean dan pencetakan dokumen warga'],['Pengawas','Peninjauan dan keputusan kasus']].map((x,i)=>`<div class="step"><span class="step-num">${i+1}</span><div><strong>${x[0]}</strong><p>${x[1]}</p></div></div>`).join('')}</div><div class="face-demo-note">Pengelolaan akun petugas tersedia melalui menu Manajemen Petugas. Admin mengawasi sistem dan tidak membuat akun warga.</div></section></div>`;
    }
    if(role==='document_printer'){
      return `${head(cfg.eyebrow,cfg.title,cfg.description)}<div class="stat-grid">${statCard('Antrean siap diproses',printQueue.length,'Disetujui atau menunggu cetak','▤')}${statCard('Menunggu pencetakan',cases.filter(c=>c.status==='APPROVED').length,'Perlu ditandai masuk antrean cetak','◷')}${statCard('Dalam antrean cetak',cases.filter(c=>c.status==='PRINT_PENDING').length,'Siap ditandai selesai','✓')}${statCard('Selesai',completed.length,'Kasus yang ditutup','✓')}</div><section class="panel"><div class="panel-head"><div><h2>Antrean pencetakan</h2><p>Buka detail untuk memperbarui status cetak sesuai kewenangan.</p></div><button class="text-btn" data-action="view-cases">Lihat antrean →</button></div>${roleQueue(printQueue,'Belum ada kasus yang disetujui untuk pencetakan. Antrean akan muncul setelah pengawas menyetujui kasus.')}</section>`;
    }
    if(role==='supervisor'){
      return `${head(cfg.eyebrow,cfg.title,cfg.description)}<div class="stat-grid">${statCard('Menunggu keputusan',review.length,'Kasus tinjauan dokumen','◷')}${statCard('Kasus aktif',active.length,'Dalam proses','▤')}${statCard('Disetujui',cases.filter(c=>['APPROVED','PRINT_PENDING','COMPLETED'].includes(c.status)).length,'Lanjut ke proses berikutnya','✓')}${statCard('Emergency Mode',emergencyMode?'AKTIF':'NONAKTIF','Status mode darurat','⚠')}</div><section class="panel"><div class="panel-head"><div><h2>Prioritas peninjauan</h2><p>Kasus berstatus tinjauan dokumen membutuhkan keputusan.</p></div><button class="text-btn" data-action="view-cases">Semua kasus →</button></div>${roleQueue(review,'Tidak ada kasus yang menunggu keputusan saat ini.')}</section>`;
    }
    return `${head(cfg.eyebrow,cfg.title,cfg.description,canCreateCase?`<button class="btn btn-primary" data-action="new-case">＋ Buat kasus</button>`:'')}<div class="stat-grid">${statCard('Kasus aktif',active.length,'Belum selesai','▤')}${statCard('Perlu diperiksa',cases.filter(c=>['OPEN','IDENTITY_CHECK'].includes(c.status)).length,'Pemeriksaan identitas','◷')}${statCard('Tinjauan dokumen',review.length,'Menunggu pengawas','✓')}${statCard('Emergency Mode',emergencyMode?'AKTIF':'NONAKTIF','Status mode darurat','⚠')}</div><div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Kasus pemulihan terbaru</h2><p>Prioritaskan registrasi dan pemeriksaan sidik jari (simulasi).</p></div><button class="text-btn" data-action="view-cases">Semua kasus →</button></div>${roleQueue(active,'Tidak ada kasus aktif.')}</section><section class="panel"><div class="panel-head"><div><h2>Tugas utama</h2></div></div><div class="steps"><div class="step"><span class="step-num">1</span><div><strong>Buat atau buka kasus</strong><p>Gunakan data sintetis untuk demonstrasi.</p></div></div><div class="step"><span class="step-num">2</span><div><strong>Simulasi pemindaian sidik jari</strong><p>Simulasi tidak menggunakan kamera atau memverifikasi identitas sungguhan.</p></div></div><div class="step"><span class="step-num">3</span><div><strong>Teruskan ke tinjauan dokumen</strong><p>Kasus berikutnya diproses oleh pengawas.</p></div></div></div></section></div>`;
  }
  function renderOverview(){const active=cases.filter(c=>!['COMPLETED','CANCELLED','REJECTED'].includes(c.status));const pending=cases.filter(c=>['OPEN','IDENTITY_CHECK','DOCUMENT_REVIEW'].includes(c.status));const approved=cases.filter(c=>['APPROVED','PRINT_PENDING','COMPLETED'].includes(c.status));return `${head('DASHBOARD PETUGAS','Ringkasan pemulihan','Pantau kasus dan lanjutkan pemeriksaan dokumen warga.',`<button class="btn btn-primary" data-action="new-case">＋ Buat kasus</button>`)}
    <div class="stat-grid"><article class="stat-card"><div class="stat-top">Kasus aktif <span class="stat-icon">▤</span></div><div class="stat-value">${active.length}</div><div class="stat-note">Belum selesai atau dibatalkan</div></article><article class="stat-card"><div class="stat-top">Perlu ditinjau <span class="stat-icon">◷</span></div><div class="stat-value">${pending.length}</div><div class="stat-note">Identitas atau dokumen</div></article><article class="stat-card"><div class="stat-top">Disetujui / proses lanjut <span class="stat-icon">✓</span></div><div class="stat-value">${approved.length}</div><div class="stat-note">Termasuk antrean cetak dan selesai</div></article><article class="stat-card"><div class="stat-top">Emergency Mode <span class="stat-icon">⚠</span></div><div class="stat-value" style="font-size:22px">${emergencyMode?'AKTIF':'NONAKTIF'}</div><div class="stat-note">Status bersama tersimpan di Supabase</div></article></div>
    <div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Kasus yang perlu perhatian</h2><p>Prioritaskan kasus yang belum selesai.</p></div><button class="text-btn" data-action="view-cases">Semua kasus →</button></div><div class="case-list">${active.length?active.slice(0,4).map(c=>caseRow(c)).join(''):'<div class="empty-state">Tidak ada kasus aktif.</div>'}</div></section><section class="panel"><div class="panel-head"><div><h2>Alur kerja petugas</h2><p>Urutan dasar dalam demonstrasi.</p></div></div><div class="steps"><div class="step"><span class="step-num">1</span><div><strong>Buka atau buat kasus</strong><p>Pastikan kasus berkaitan dengan pemulihan pascabencana.</p></div></div><div class="step"><span class="step-num">2</span><div><strong>Simulasi pemindaian sidik jari</strong><p>Animasi sidik jari hanya simulasi demonstrasi, bukan verifikasi biometrik nyata.</p></div></div><div class="step"><span class="step-num">3</span><div><strong>Tinjau dokumen pendukung</strong><p>Catat hasil pemeriksaan dan pilih keputusan.</p></div></div><div class="step"><span class="step-num">4</span><div><strong>Catat hasil kasus</strong><p>Perubahan status disimpan terpusat di Supabase dan dicatat pada audit log.</p></div></div></div></section></div>`;}
  function renderCases(){const search=(document.getElementById('caseSearch')?.value||'').toLowerCase();const filter=document.getElementById('statusFilter')?.value||'ALL';const role=officerProfile?.role||'recovery_officer';const cfg=roleConfig();const roleCases=role==='document_printer'?cases.filter(c=>['APPROVED','PRINT_PENDING'].includes(c.status)):role==='supervisor'?cases.filter(c=>['DOCUMENT_REVIEW','APPROVED','REJECTED'].includes(c.status)):cases;const filtered=roleCases.filter(c=>(filter==='ALL'||c.status===filter)&&[c.id,c.citizenName,c.citizenCode,c.location,c.disaster].some(v=>v.toLowerCase().includes(search)));const createButton=(role==='recovery_officer' || (emergencyMode && ['admin','document_printer','supervisor'].includes(role))) && !activeEmergencyAssignment()?`<button class="btn btn-primary" data-action="new-case">＋ Buat kasus</button>`:'';return `${head('WORKSPACE',cfg.navCases,cfg.description,createButton)}<div class="toolbar"><input id="caseSearch" class="field" placeholder="Cari nama, kode warga, lokasi…" value="${esc(search)}" aria-label="Cari kasus"><select id="statusFilter" class="field" aria-label="Filter status"><option value="ALL">Semua status</option>${Object.entries(statusInfo).map(([key,x])=>`<option value="${key}" ${filter===key?'selected':''}>${x.label}</option>`).join('')}</select></div><div class="table-wrap"><table class="data-table"><thead><tr><th>ID kasus / warga</th><th>Lokasi bencana</th><th>Tanggal dibuat</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${filtered.length?filtered.map(c=>`<tr><td><strong>${esc(c.id)}</strong><small>${esc(c.citizenName)} · ${esc(c.citizenCode)}</small></td><td>${esc(c.location)}<small>${esc(c.disaster)}</small></td><td>${dateText(c.createdAt)}</td><td>${badge(c.status)}</td><td><div class="table-actions"><button class="small-btn" data-action="open-case" data-id="${esc(c.id)}">Detail</button>${!['COMPLETED','CANCELLED','REJECTED'].includes(c.status)?`<button class="small-btn" data-action="cancel-case" data-id="${esc(c.id)}">Batalkan</button>`:''}</div></td></tr>`).join(''):`<tr><td colspan="5"><div class="empty-state">Tidak ada kasus yang cocok.</div></td></tr>`}</tbody></table></div>`;}
  function renderCaseDetail(c){const stepMap={OPEN:1,IDENTITY_CHECK:2,DOCUMENT_REVIEW:3,APPROVED:4,REJECTED:4,PRINT_PENDING:4,COMPLETED:5,CANCELLED:5};const progress=(stepMap[c.status]||1)*20;return `${head('DETAIL KASUS',esc(c.id),`Kasus pemulihan untuk ${esc(c.citizenName)}.`, `<button class="btn btn-secondary" data-action="view-cases">← Kembali ke kasus</button>`)}<div class="case-detail-grid"><section class="panel"><div class="detail-title"><div><h2>${esc(c.citizenName)}</h2><p>${esc(c.citizenCode)} · Dibuat ${dateText(c.createdAt)}</p></div>${badge(c.status)}</div><div class="progress-track"><span style="width:${progress}%"></span></div><div class="stat-note">Tahap alur demo: ${progress}%</div><div class="detail-fields"><div class="detail-field"><span>Lokasi terdampak</span><strong>${esc(c.location)}</strong></div><div class="detail-field"><span>Jenis bencana</span><strong>${esc(c.disaster)}</strong></div><div class="detail-field"><span>Pemeriksaan identitas</span><strong>${c.identityChecked?'Simulasi selesai':'Belum diselesaikan'}</strong></div><div class="detail-field"><span>Dokumen pemulihan</span><strong>Dipilih dari arsip akun warga saat pencetakan</strong></div></div><h3 class="section-title">Dokumen pemulihan</h3><p style="font-size:12px;color:var(--muted)">Judul dokumen akan dimuat dari arsip privat milik warga setelah QR diverifikasi dan simulasi sidik jari dijalankan. Isi dokumen tidak ditampilkan pada detail kasus.</p><h3 class="section-title">Catatan kasus</h3><p style="font-size:12px;color:var(--muted)">${esc(c.note||'Belum ada catatan awal.')}</p>${c.reviewNote?`<div class="detail-field"><span>Catatan keputusan</span><strong>${esc(c.reviewNote)}</strong></div>`:''}</section><aside class="panel"><div class="panel-head"><div><h2>Tindakan petugas</h2><p>Pilih langkah sesuai status kasus.</p></div></div><div class="action-stack">${c.status==='COMPLETED'?`<button class="btn btn-primary" type="button" data-recovery-receipt="${esc(c.id)}">▤ Buat bukti pemulihan / Simpan PDF</button>`:''}${!c.identityChecked&&!['REJECTED','CANCELLED','COMPLETED'].includes(c.status)?`<button class="btn btn-primary" data-action="face-scan" data-id="${esc(c.id)}">◎ Mulai simulasi pemindaian sidik jari</button>`:''}${c.identityChecked&&['IDENTITY_CHECK','OPEN'].includes(c.status)?`<button class="btn btn-primary" data-action="move-review" data-id="${esc(c.id)}">Lanjut ke tinjauan dokumen →</button>`:''}${c.status==='DOCUMENT_REVIEW'?`<button class="btn btn-success" data-action="approve" data-id="${esc(c.id)}">✓ Setujui kasus demo</button><button class="btn btn-danger" data-action="reject" data-id="${esc(c.id)}">Tolak kasus demo</button>`:''}${c.status==='APPROVED'?(readQrReceipt(c.id)?`<button class="btn btn-secondary" data-action="view-qr" data-id="${esc(c.id)}">▦ Lihat QR kembali</button>`:'')+`<button class="btn btn-primary" data-action="print-pending" data-id="${esc(c.id)}">Tandai menunggu cetak</button>`:''}${c.status==='PRINT_PENDING'?`<button class="btn btn-success" data-action="complete" data-id="${esc(c.id)}">Verifikasi sidik jari & pilih dokumen</button>`:''}${!['REJECTED','CANCELLED','COMPLETED'].includes(c.status)?`<button class="btn btn-secondary" data-action="cancel-case" data-id="${esc(c.id)}">Batalkan kasus</button>`:''}<button class="btn btn-secondary" data-action="edit-note" data-id="${esc(c.id)}">Edit catatan petugas</button></div><div class="face-demo-note">Pemindaian sidik jari di halaman ini hanya animasi demo. Browser tidak membaca sidik jari; hasilnya bukan bukti identitas nyata.</div></aside></div>`;}
  function renderWorkflow(){return `${head('PANDUAN OPERASIONAL','Alur verifikasi','Gambaran status kasus yang dipakai dalam demo Stage 7.')}<div class="panel"><div class="steps">${[['OPEN','Kasus terbuka','Kasus dibuat dan menunggu pemeriksaan.'],['IDENTITY_CHECK','Pemeriksaan identitas','Petugas menjalankan simulasi pemindaian sidik jari.'],['DOCUMENT_REVIEW','Tinjauan dokumen','Petugas meninjau daftar dokumen demo dan mencatat keputusan.'],['APPROVED / REJECTED','Keputusan','Kasus disetujui atau ditolak pada simulasi.'],['PRINT_PENDING','Menunggu cetak','Tahap berikutnya untuk demonstrasi alur pencetakan.'],['COMPLETED / CANCELLED','Penutupan kasus','Kasus selesai atau dibatalkan.']].map((s,i)=>`<div class="step"><span class="step-num">${i+1}</span><div><strong>${s[1]} <span class="badge">${s[0]}</span></strong><p>${s[2]}</p></div></div>`).join('')}</div></div>`;}
  function emergencyAssignedPanel(){
    if(!officerProfile || !['overview','cases'].includes(currentView)) return '';
    const uid=officerProfile.user?.id;
    const active=cases.filter(c=>c.assignedTo===uid && !['COMPLETED','CANCELLED','REJECTED'].includes(c.status));
    const draft=readEmergencyDraft();
    if(!emergencyMode && !active.length && !draft) return '';
    const rows=active.map(c=>caseRow(c,true)).join('');
    const createButton=emergencyMode && can('new-case') && !activeEmergencyAssignment() ? '<button class="btn btn-primary" data-action="new-case">＋ Buat kasus darurat</button>' : '';
    const draftButton=draft && !activeEmergencyAssignment() ? '<button class="btn btn-secondary" data-action="resume-draft">Lanjutkan draft tersimpan</button>' : '';
    return `<section class="panel emergency-work-panel"><div class="panel-head"><div><h2>Kasus yang terkunci pada dashboard Anda</h2><p>Kasus aktif yang ditugaskan kepada akun petugas ini tetap tampil di sini meskipun popup ditutup atau halaman dimuat ulang.</p></div><span class="badge amber">${emergencyMode?'EMERGENCY MODE':'KASUS AKTIF'}</span></div>${active.length?`<div class="case-list">${rows}</div>`:'<div class="empty-state">Belum ada kasus aktif yang ditugaskan ke akun ini.</div>'}<div class="modal-actions">${draftButton}${createButton}</div></section>`;
  }
  function citizenDirectoryRows(){return citizenDirectory.map(c=>`<tr><td><strong>${esc(c.fullName)}</strong><small>${esc(c.email||'')}</small></td><td><code>${esc(c.citizenCode)}</code></td><td>${c.active?'<span class="badge green">Aktif</span>':'<span class="badge red">Nonaktif</span>'}</td><td>${c.passkeyEnabled?'<span class="badge green">Terdaftar</span>':'<span class="badge gray">Belum terdaftar</span>'}</td><td>${dateText(c.createdAt)}</td></tr>`).join('')||'<tr><td colspan="5"><div class="empty-state">Tidak ada akun warga yang cocok.</div></td></tr>';}
  function renderCitizenDirectory(){
    return `${head('ADMINISTRASI','Akun warga terdaftar','Daftar akun warga Docura. Kode unik internal digunakan untuk pencarian kasus; bukan NIK.')}<div class="toolbar"><input id="citizenDirectorySearch" class="field" name="citizenDirectorySearch" placeholder="Cari kode, nama, atau email warga…" value="${esc(citizenDirectoryQuery)}" aria-label="Cari akun warga"><button class="btn btn-secondary" id="refreshCitizenDirectory" type="button">Muat ulang</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Warga</th><th>Kode unik Docura</th><th>Status akun</th><th>Passkey</th><th>Terdaftar</th></tr></thead><tbody id="citizenDirectoryRows">${citizenDirectoryRows()}</tbody></table></div><p class="face-demo-note">Halaman ini tidak menampilkan dokumen, kata sandi, kredensial passkey, atau data biometrik.</p>`;
  }
  async function loadCitizenDirectory(query=citizenDirectoryQuery){
    citizenDirectoryQuery=query;
    try{const data=await officerApi(`/api/officer/citizens${query?`?q=${encodeURIComponent(query)}`:''}`);citizenDirectory=Array.isArray(data.citizens)?data.citizens:[];if(currentView==='citizens'){const tbody=document.getElementById('citizenDirectoryRows');if(tbody)tbody.innerHTML=citizenDirectoryRows();applyTranslations();}}
    catch(error){citizenDirectory=[];if(currentView==='citizens'){const tbody=document.getElementById('citizenDirectoryRows');if(tbody)tbody.innerHTML=`<tr><td colspan="5"><div class="empty-state">${esc(error.message)}</div></td></tr>`;}}
  }
  function staffRows(){
    return staffDirectory.map(staff=>`<tr><td><strong>${esc(staff.displayName)}</strong><small>${esc(staff.email)}</small></td><td>${esc(staff.roleLabel)}</td><td>${staff.active?'<span class="badge green">Aktif</span>':'<span class="badge red">Nonaktif</span>'}</td><td>${staff.emailConfirmed?'<span class="badge green">Terkonfirmasi</span>':'<span class="badge amber">Belum aktif</span>'}</td><td>${dateText(staff.createdAt)}</td></tr>`).join('')||'<tr><td colspan="5"><div class="empty-state">Belum ada akun petugas.</div></td></tr>';
  }
  function renderStaff(){
    return `${head('ADMINISTRASI','Manajemen petugas','Buat dan tinjau akun petugas. Pembuatan akun warga tetap dilakukan melalui registrasi mandiri.')}<section class="panel staff-create-panel"><div class="panel-head"><div><h2>＋ Buat akun petugas</h2><p>Admin menetapkan role sesuai tanggung jawab operasional.</p></div></div><form id="createStaffForm" class="staff-form"><div class="form-grid"><div class="form-group"><label class="form-label" for="staffDisplayName">Nama lengkap *</label><input class="form-input" id="staffDisplayName" name="displayName" minlength="2" maxlength="100" required autocomplete="name" placeholder="Nama petugas"></div><div class="form-group"><label class="form-label" for="staffEmail">Email akun *</label><input class="form-input" id="staffEmail" name="email" type="email" maxlength="254" required autocomplete="off" placeholder="petugas@contoh.id"></div><div class="form-group"><label class="form-label" for="staffRole">Role petugas *</label><select class="form-input" id="staffRole" name="role" required><option value="recovery_officer">Petugas Pemulihan</option><option value="document_printer">Pencetak Dokumen</option><option value="supervisor">Supervisor / Pengawas</option></select></div><div class="form-group"><label class="form-label" for="staffTemporaryPassword">Kata sandi awal *</label><input class="form-input" id="staffTemporaryPassword" name="temporaryPassword" type="password" minlength="12" maxlength="72" required autocomplete="new-password" placeholder="Minimal 12 karakter"><small class="field-hint">Sampaikan kata sandi awal secara langsung melalui kanal yang aman. Jangan kirim melalui notifikasi.</small></div></div><div class="form-actions"><button class="btn btn-primary" type="submit" id="createStaffSubmit">Buat akun petugas</button></div></form><div class="face-demo-note">Akun dibuat di Supabase Auth dan langsung diberi role petugas. Kredensial tidak disimpan oleh Docura dalam tabel aplikasi.</div></section><section class="panel"><div class="panel-head"><div><h2>Daftar akun petugas</h2><p>Informasi akun dan role yang sudah tercatat.</p></div><button class="btn btn-secondary" id="refreshStaffDirectory" type="button">Muat ulang</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Petugas</th><th>Role</th><th>Status</th><th>Aktivasi email</th><th>Dibuat</th></tr></thead><tbody id="staffDirectoryRows">${staffRows()}</tbody></table></div></section>`;
  }
  async function loadStaffDirectory(){
    try{const data=await officerApi('/api/officer/staff');staffDirectory=Array.isArray(data.staff)?data.staff:[];const tbody=document.getElementById('staffDirectoryRows');if(tbody)tbody.innerHTML=staffRows();applyTranslations();}
    catch(error){const tbody=document.getElementById('staffDirectoryRows');if(tbody)tbody.innerHTML=`<tr><td colspan="5"><div class="empty-state">${esc(error.message)}</div></td></tr>`;}
  }
  function renderNotifications(){
    const items=notifications.map(n=>`<article class="notification-row ${n.read_at?'is-read':'is-unread'}"><span class="notification-mark">${n.read_at?'✓':'●'}</span><div class="notification-copy"><div class="notification-heading"><strong>${esc(n.title)}</strong><small>${dateText(n.created_at)} · ${new Date(n.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</small></div><p>${esc(n.message)}</p>${n.target_id?`<small>Referensi: ${esc(n.target_id)}</small>`:''}</div>${n.target_type==='recovery_case'&&n.target_id?`<button class="small-btn" data-notification-case="${esc(n.target_id)}" type="button">Buka kasus</button>`:''}${!n.read_at?`<button class="small-btn" data-notification-read="${esc(n.id)}" type="button">Tandai dibaca</button>`:''}</article>`).join('');
    return `${head('PUSAT INFORMASI','Notifikasi','Pemberitahuan sesuai aktivitas dan kewenangan akun Anda.',unreadNotificationCount?'<button class="btn btn-secondary" id="markAllNotificationsRead" type="button">Tandai semua dibaca</button>':'')}<section class="panel"><div class="notification-list">${items||'<div class="empty-state">Belum ada notifikasi. Pemberitahuan baru akan muncul ketika ada aktivitas yang relevan dengan role Anda.</div>'}</div></section>`;
  }
  async function loadNotifications(){
    try{const data=await officerApi('/api/officer/notifications');notifications=Array.isArray(data.notifications)?data.notifications:[];unreadNotificationCount=Number(data.unreadCount)||0;updateNotificationBadges();if(currentView==='notifications')pageContent.innerHTML=renderNotifications();applyTranslations();}
    catch(error){if(currentView==='notifications')pageContent.innerHTML=`<div class="empty-state">${esc(error.message)}</div>`;}
  }
  function updateNotificationBadges(){
    for(const id of ['notificationCount','navNotificationCount']){const el=document.getElementById(id);if(!el)continue;el.textContent=unreadNotificationCount>99?'99+':String(unreadNotificationCount);el.hidden=unreadNotificationCount===0;}
  }
  async function markNotificationRead(id){
    try{await officerApi(`/api/officer/notifications/${encodeURIComponent(id)}/read`,{method:'PATCH',body:'{}'});await loadNotifications();if(currentView==='notifications')pageContent.innerHTML=renderNotifications();applyTranslations();}
    catch(error){showToast(error.message);}
  }
  function renderAdminAnalytics(){
    const total=cases.length, active=cases.filter(c=>!['COMPLETED','CANCELLED','REJECTED'].includes(c.status)).length;
    const completed=cases.filter(c=>c.status==='COMPLETED').length, rejected=cases.filter(c=>c.status==='REJECTED').length, cancelled=cases.filter(c=>c.status==='CANCELLED').length;
    const pending=cases.filter(c=>['OPEN','IDENTITY_CHECK','DOCUMENT_REVIEW'].includes(c.status)).length;
    const office=cases.filter(c=>(c.recoveryChannel||'OFFICE')==='OFFICE').length, self=cases.filter(c=>c.recoveryChannel==='SELF').length;
    const statusLabels={OPEN:'Terbuka',IDENTITY_CHECK:'Pemeriksaan identitas',DOCUMENT_REVIEW:'Tinjauan dokumen',APPROVED:'Disetujui',PRINT_PENDING:'Menunggu cetak',COMPLETED:'Selesai',REJECTED:'Ditolak',CANCELLED:'Dibatalkan'};
    const statusRows=Object.entries(statusLabels).map(([key,label])=>({label,count:cases.filter(c=>c.status===key).length})).filter(x=>x.count>0);
    const maxStatus=Math.max(1,...statusRows.map(x=>x.count));
    const monthLabels=[];const monthCounts=[];const now=new Date();
    for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;monthLabels.push({key,label:new Intl.DateTimeFormat(language==='en'?'en-US':'id-ID',{month:'short'}).format(d)});monthCounts.push(cases.filter(c=>String(c.createdAt||'').slice(0,7)===key).length);}
    const maxMonth=Math.max(1,...monthCounts);
    const statusHtml=statusRows.map(x=>`<div class="analytics-bar-row"><div><span>${esc(x.label)}</span><strong>${x.count}</strong></div><div class="analytics-track"><span style="width:${Math.max(2,x.count/maxStatus*100)}%"></span></div></div>`).join('')||'<div class="empty-state">Belum ada data kasus.</div>';
    const monthHtml=monthLabels.map((m,i)=>`<div class="month-bar"><div class="month-bar-value">${monthCounts[i]}</div><div class="month-bar-track"><span style="height:${Math.max(3,monthCounts[i]/maxMonth*100)}%"></span></div><small>${esc(m.label)}</small></div>`).join('');
    return `${head('ADMINISTRASI','Analitik operasional','Ringkasan statistik kasus untuk pengawasan Admin. Data ditampilkan secara agregat; halaman ini hanya tersedia untuk Admin.')}<div class="analytics-toolbar"><span class="badge blue">${total} kasus tercatat</span><button class="btn btn-secondary" id="refreshAnalytics" type="button">↻ Muat ulang data</button></div><div class="stat-grid">${statCard('Total kasus',total,'Seluruh kasus yang dapat diakses Admin','▤')}${statCard('Kasus aktif',active,'Belum selesai, ditolak, atau dibatalkan','◷')}${statCard('Menunggu proses',pending,'Terbuka, identitas, atau tinjauan','⌛')}${statCard('Selesai',completed,'Penyerahan ditandai selesai','✓')}</div><div class="stat-grid analytics-secondary-grid">${statCard('Ditolak',rejected,'Kasus dengan keputusan penolakan','!')}${statCard('Dibatalkan',cancelled,'Kasus yang ditutup sebelum selesai','×')}${statCard('Pemulihan kantor',office,'Kanal kantor atau belum ditentukan','▣')}${statCard('Pemulihan mandiri',self,'Kanal pemulihan mandiri tercatat','⌂')}</div><div class="two-col analytics-grid"><section class="panel"><div class="panel-head"><div><h2>Kasus berdasarkan status</h2><p>Distribusi status pada data yang tersedia.</p></div></div><div class="analytics-bars">${statusHtml}</div></section><section class="panel"><div class="panel-head"><div><h2>Tren pembuatan kasus</h2><p>Jumlah kasus dibuat per bulan selama enam bulan terakhir.</p></div></div><div class="month-chart" role="img" aria-label="Grafik jumlah kasus per bulan">${monthHtml}</div></section></div><section class="panel"><div class="panel-head"><div><h2>Kasus terbaru</h2><p>Ringkasan operasional, bukan data identitas dokumen.</p></div><button class="text-btn" data-view="cases" type="button">Lihat daftar kasus →</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Nomor kasus</th><th>Jenis bencana</th><th>Tanggal dibuat</th><th>Status</th></tr></thead><tbody>${cases.slice(0,8).map(c=>`<tr><td><strong>${esc(c.id)}</strong></td><td>${esc(c.disaster||'—')}</td><td>${dateText(c.createdAt)}</td><td>${badge(c.status)}</td></tr>`).join('')||'<tr><td colspan="4"><div class="empty-state">Belum ada kasus.</div></td></tr>'}</tbody></table></div><p class="analytics-footnote">Angka dihitung dari kasus yang dikembalikan oleh sistem untuk akun Admin. Tren bulanan memakai tanggal pembuatan kasus; waktu penyelesaian rata-rata tidak ditampilkan karena data durasi belum tersedia pada daftar kasus.</p></section>`;
  }

  let language='id';
  const EN={
    'Ringkasan':'Overview','Kasus pemulihan':'Recovery cases','Alur verifikasi':'Verification workflow','Akun warga':'Citizen accounts','Manajemen petugas':'Staff management','Notifikasi':'Notifications','Analitik operasional':'Operational analytics','WORKSPACE':'WORKSPACE','SISTEM':'SYSTEM','Emergency Mode':'Emergency Mode','Mode darurat belum aktif.':'Emergency mode is inactive.','Aktifkan mode':'Enable mode','Lingkungan demo':'Demo environment','Data sintetis, bukan sistem operasional.':'Synthetic data, not an operational system.','Tema terang':'Light theme','Tema gelap':'Dark theme','Keluar':'Log out','Mode demonstrasi.':'Demonstration mode.','Portal petugas Docura':'Docura officer portal','Administrator Dashboard':'Administrator Dashboard','Pemantauan sistem dan seluruh alur petugas':'System monitoring and staff workflows','Pantau gambaran alur pemulihan dan status kasus demonstrasi.':'Monitor recovery workflows and demonstration case status.','Total kasus':'Total cases','Kasus aktif':'Active cases','Menunggu keputusan':'Awaiting decision','Selesai':'Completed','Kasus yang tercatat di sistem':'Cases recorded in the system','Belum ditutup':'Not closed','Status tinjauan dokumen':'Document review status','Kasus yang sudah ditutup':'Closed cases','Pemantauan kasus terbaru':'Latest case monitoring','Data kasus bersama yang tersimpan di Supabase.':'Shared case data stored in Supabase.','Lihat semua →':'View all →','Daftar peran sistem':'System roles','Jenis role yang dikenali portal petugas.':'Roles recognized by the officer portal.','Petugas Pemulihan':'Recovery Officer','Pencetak Dokumen':'Document Printer','Pengawas':'Supervisor','Buat kasus':'Create case','Semua kasus →':'All cases →','Muat ulang':'Refresh','Muat ulang data':'Refresh data','Buka kasus':'Open case','Tandai dibaca':'Mark as read','Tandai semua dibaca':'Mark all as read','Belum ada notifikasi. Pemberitahuan baru akan muncul ketika ada aktivitas yang relevan dengan role Anda.':'No notifications yet. New alerts appear when activity relevant to your role occurs.','ADMINISTRASI':'ADMINISTRATION','Ringkasan statistik kasus untuk pengawasan Admin. Data ditampilkan secara agregat; halaman ini hanya tersedia untuk Admin.':'Aggregated case statistics for Admin oversight. This page is available to Admins only.','Kasus berdasarkan status':'Cases by status','Distribusi status pada data yang tersedia.':'Status distribution in the available data.','Tren pembuatan kasus':'Case creation trend','Jumlah kasus dibuat per bulan selama enam bulan terakhir.':'Cases created per month over the last six months.','Kasus terbaru':'Latest cases','Ringkasan operasional, bukan data identitas dokumen.':'Operational summary, not document identity data.','Nomor kasus':'Case ID','Jenis bencana':'Disaster type','Tanggal dibuat':'Created date','Status':'Status','Terbuka':'Open','Pemeriksaan identitas':'Identity check','Tinjauan dokumen':'Document review','Disetujui':'Approved','Menunggu cetak':'Print pending','Ditolak':'Rejected','Dibatalkan':'Cancelled','Perkecil teks':'Decrease text size','Perbesar teks':'Increase text size','Kontras tinggi':'High contrast','Bahasa antarmuka':'Interface language','Pemulihan kantor':'Office recovery','Pemulihan mandiri':'Self-recovery','Kasus menunggu proses':'Cases awaiting processing','Ditolak':'Rejected','Dibatalkan':'Cancelled','Terdaftar':'Registered','Tidak ada kasus aktif.':'No active cases.','Tidak ada kasus.':'No cases.','Akses petugas':'Officer access','Buat akun petugas':'Create staff account','Daftar akun petugas':'Staff account list','Akun dibuat di Supabase Auth dan langsung diberi role petugas. Kredensial tidak disimpan oleh Docura dalam tabel aplikasi.':'Accounts are created in Supabase Auth and assigned a staff role. Credentials are not stored in application tables.'
  };
  function applyTranslations(root=document.body){
    const reverse=Object.fromEntries(Object.entries(EN).map(([id,en])=>[en,id]));
    const dictionary=language==='en'?EN:reverse;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    for(const node of nodes){const raw=node.nodeValue;const trimmed=raw.trim();if(dictionary[trimmed])node.nodeValue=raw.replace(trimmed,dictionary[trimmed]);}
    root.querySelectorAll('[placeholder],[aria-label],[title]').forEach(el=>{for(const attr of ['placeholder','aria-label','title']){const value=el.getAttribute(attr);if(value&&dictionary[value])el.setAttribute(attr,dictionary[value]);}});
  }
  function applyAccessibilityPreferences(){
    const root=document.documentElement;let scale=1,contrast=false;try{scale=Number(localStorage.getItem('docura-font-scale')||1);contrast=localStorage.getItem('docura-high-contrast')==='true';language=localStorage.getItem('docura-language')==='en'?'en':'id';}catch(_){}
    scale=Math.max(.9,Math.min(1.25,scale||1));root.style.setProperty('--access-scale',String(scale));root.dataset.contrast=contrast?'high':'normal';root.lang=language;
    const select=document.getElementById('languageSelect');if(select)select.value=language;
    const contrastBtn=document.getElementById('contrastToggle');if(contrastBtn)contrastBtn.setAttribute('aria-pressed',String(contrast));
  }
  function setLanguage(value){language=value==='en'?'en':'id';try{localStorage.setItem('docura-language',language);}catch(_){}document.documentElement.lang=language;render();}

  function render(){configureRoleShell();updateShell();const cfg=roleConfig();const names={overview:cfg.title,cases:cfg.navCases,workflow:cfg.navWorkflow,citizens:'Akun warga',staff:'Manajemen petugas',notifications:'Notifikasi',analytics:'Analitik operasional',detail:'Detail kasus'};document.getElementById('crumbTitle').textContent=names[currentView]||cfg.title;document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===currentView));if(currentView==='overview')pageContent.innerHTML=renderRoleOverview();else if(currentView==='cases')pageContent.innerHTML=renderCases();else if(currentView==='workflow')pageContent.innerHTML=renderWorkflow();else if(currentView==='citizens'&&officerProfile?.role==='admin'){pageContent.innerHTML=renderCitizenDirectory();loadCitizenDirectory();}else if(currentView==='staff'&&officerProfile?.role==='admin'){pageContent.innerHTML=renderStaff();loadStaffDirectory();}else if(currentView==='notifications'){pageContent.innerHTML=renderNotifications();loadNotifications();}else if(currentView==='analytics'&&officerProfile?.role==='admin'){pageContent.innerHTML=renderAdminAnalytics();}else {const c=cases.find(x=>x.id===selectedCaseId);if(c)pageContent.innerHTML=renderCaseDetail(c);else{currentView='cases';pageContent.innerHTML=renderCases();}}if(['overview','cases'].includes(currentView))pageContent.insertAdjacentHTML('afterbegin',emergencyAssignedPanel());applyRoleUI();applyAccessibilityPreferences();applyTranslations();}
  function openModal(html, options={}){clearInterval(scanTimer);activeModalLocked=Boolean(options.locked);modalBody.innerHTML=html;modalBackdrop.hidden=false;document.body.style.overflow='hidden';const closeButton=document.getElementById('modalClose');if(closeButton)closeButton.hidden=false;}
  function closeModal(force=false){if(activeModalLocked&&!force){showToast('Popup darurat dikunci agar tidak tertutup tanpa sengaja. Gunakan “Simpan draft & tutup” jika ingin melanjutkan nanti.');return false;}clearInterval(scanTimer);modalBackdrop.hidden=true;modalBody.innerHTML='';document.body.style.overflow='';activeModalLocked=false;return true;}
  function saveDraftFromForm(){const form=document.getElementById('newCaseForm');if(!form)return;const values={citizenName:form.elements.citizenName.value.trim(),citizenCode:form.elements.citizenSearch.value.trim(),location:form.elements.location.value.trim(),disaster:form.elements.disaster.value,note:form.elements.caseNote.value.trim()};if(values.citizenName||values.citizenCode||values.location||values.note){saveEmergencyDraft(values);}else{clearEmergencyDraft();}}
  function newCaseModal(){
    selectedCitizen=null;
    if(emergencyMode && activeEmergencyAssignment()){showToast('Selesaikan kasus darurat yang sedang Anda tangani sebelum membuat kasus baru.');return;}
    const draft=emergencyMode?readEmergencyDraft():null;
    const locked=Boolean(emergencyMode);
    const html=`<div class="emergency-modal-heading"><span class="badge amber">${locked?'EMERGENCY MODE · POPUP TERKUNCI':'FORM KASUS'}</span><h2 id="modalTitle">Buat kasus pemulihan</h2></div><p>Masukkan data sintetis untuk alur demonstrasi. Jangan masukkan data pribadi sungguhan.</p>${locked?'<div class="face-demo-note">Popup darurat tidak tertutup karena klik di luar atau tombol Escape. Tombol × di pojok atas akan menyimpan draft sebelum menutup.</div>':''}<form id="newCaseForm" novalidate><label class="form-label" for="citizenSearch">Cari warga terdaftar berdasarkan kode unik Docura *</label><input class="form-input" id="citizenSearch" name="citizenSearch" autocomplete="off" required maxlength="40" placeholder="Ketik kode unik, contoh DOC-1A2B3C4D5E6F"><input type="hidden" id="citizenName" name="citizenName"><input type="hidden" id="citizenCode" name="citizenCode"><input type="hidden" id="citizenUserId" name="citizenUserId"><div id="citizenSearchResults" class="case-list" aria-live="polite"><div class="empty-state">Cari minimal 3 karakter kode warga.</div></div><div id="selectedCitizenSummary" class="face-demo-note">Belum ada akun warga dipilih. Kasus hanya dapat dibuat untuk akun terdaftar.</div><label class="form-label" for="location">Lokasi terdampak *</label><input class="form-input" id="location" name="location" required maxlength="100" placeholder="Desa Contoh"><label class="form-label" for="disaster">Jenis bencana *</label><select class="form-input" id="disaster" name="disaster"><option>Banjir</option><option>Gempa bumi</option><option>Longsor</option><option>Kebakaran</option><option>Bencana lain</option></select><label class="form-label" for="caseNote">Catatan awal</label><textarea class="form-input" id="caseNote" name="caseNote" maxlength="500" rows="3" placeholder="Ringkasan kebutuhan pemulihan"></textarea><div class="modal-actions">${locked?'<button class="btn btn-secondary" type="button" id="saveDraftClose">Simpan draft & tutup</button>':'<button class="btn btn-secondary" type="button" data-action="close-modal">Batal</button>'}<button class="btn btn-primary" type="submit">Simpan dan buat kasus</button></div></form>`;
    openModal(html,{locked});
    const form=document.getElementById('newCaseForm');
    if(draft){form.elements.citizenSearch.value=draft.citizenCode||'';form.elements.location.value=draft.location||'';form.elements.disaster.value=draft.disaster||'Banjir';form.elements.caseNote.value=draft.note||'';if(draft.citizenCode)searchCitizenForCase(draft.citizenCode);}
    form.elements.citizenSearch.addEventListener('input',()=>{selectedCitizen=null;form.elements.citizenName.value='';form.elements.citizenCode.value='';form.elements.citizenUserId.value='';document.getElementById('selectedCitizenSummary').textContent='Belum ada akun warga dipilih. Kasus hanya dapat dibuat untuk akun terdaftar.';clearTimeout(citizenSearchTimer);const q=form.elements.citizenSearch.value.trim();citizenSearchTimer=setTimeout(()=>searchCitizenForCase(q),250);});
    if(locked){form.addEventListener('input',saveDraftFromForm);form.addEventListener('change',saveDraftFromForm);document.getElementById('saveDraftClose').addEventListener('click',()=>{saveDraftFromForm();const hasDraft=Boolean(readEmergencyDraft());closeModal(true);render();showToast(hasDraft?'Draft tersimpan. Gunakan tombol “Lanjutkan draft tersimpan” untuk meneruskan.':'Popup ditutup tanpa menyimpan draft kosong.');});}
  }
  async function searchCitizenForCase(q){
    const results=document.getElementById('citizenSearchResults');if(!results)return;
    if(String(q||'').trim().length<3){results.innerHTML='<div class="empty-state">Ketik minimal 3 karakter kode unik Docura.</div>';return;}
    results.innerHTML='<div class="empty-state">Mencari akun warga…</div>';
    try{
      const data=await officerApi(`/api/officer/citizens/search?q=${encodeURIComponent(String(q).trim())}`);
      const citizens=Array.isArray(data.citizens)?data.citizens:[];
      if(!citizens.length){results.innerHTML='<div class="empty-state">Akun warga tidak ditemukan. Warga harus terdaftar sebelum kasus dapat dibuat.</div>';return;}
      results.innerHTML=citizens.map(c=>`<div class="case-row"><div class="case-row-main"><strong>${esc(c.fullName)}</strong><small>${esc(c.citizenCode)}</small></div><div class="case-row-end"><button type="button" class="small-btn" data-select-citizen="${esc(c.userId)}" data-citizen-code="${esc(c.citizenCode)}" data-citizen-name="${esc(c.fullName)}">Pilih warga</button></div></div>`).join('');
    }catch(error){results.innerHTML=`<div class="empty-state">${esc(error.message)}</div>`;}
  }
  function webauthnDecode(value){
    const normalized=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
    const padded=normalized+'='.repeat((4-normalized.length%4)%4);
    const binary=atob(padded);
    return Uint8Array.from(binary,ch=>ch.charCodeAt(0));
  }
  function webauthnEncode(value){
    const bytes=new Uint8Array(value);let binary='';
    bytes.forEach(byte=>{binary+=String.fromCharCode(byte);});
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
  }
  function prepareOfficerCredentialOptions(options,registration=false){
    const prepared={...options,challenge:webauthnDecode(options.challenge)};
    if(registration){prepared.user={...options.user,id:webauthnDecode(options.user.id)};prepared.excludeCredentials=(options.excludeCredentials||[]).map(x=>({...x,id:webauthnDecode(x.id)}));}
    else prepared.allowCredentials=(options.allowCredentials||[]).map(x=>({...x,id:webauthnDecode(x.id)}));
    return prepared;
  }
  function serializeOfficerCredential(credential){
    const response=credential.response;
    const out={id:credential.id,rawId:webauthnEncode(credential.rawId),type:credential.type,response:{clientDataJSON:webauthnEncode(response.clientDataJSON)}};
    if(response.attestationObject){out.response.attestationObject=webauthnEncode(response.attestationObject);if(typeof response.getTransports==='function')out.response.transports=response.getTransports();}
    if(response.authenticatorData)out.response.authenticatorData=webauthnEncode(response.authenticatorData);
    if(response.signature)out.response.signature=webauthnEncode(response.signature);
    if(response.userHandle)out.response.userHandle=webauthnEncode(response.userHandle);
    return out;
  }
  async function openFaceScan(id){
    const c=cases.find(x=>x.id===id);if(!c)return;
    selectedCaseId=id;
    const supported=Boolean(window.PublicKeyCredential&&navigator.credentials?.create&&navigator.credentials?.get);
    openModal(`<div class="biometric-modal-head"><div class="biometric-icon">${fingerprintIcon()}</div><div><span class="biometric-kicker">VERIFIKASI PETUGAS · WEB AUTHN</span><h2 id="modalTitle">Verifikasi perangkat lokal</h2><p>Kasus ${esc(c.id)} · ${esc(c.citizenName)}</p></div></div><div class="biometric-card"><div class="face-visual fingerprint-scan-visual biometric-visual" id="faceVisual"><div class="fingerprint-orbit"></div>${fingerprintIcon()}<div class="face-scan-line"></div><div class="face-caption" id="faceCaption">SIAP MEMULAI VERIFIKASI</div></div><div class="biometric-status-row"><span class="biometric-status-dot" id="biometricStatusDot"></span><p id="faceStatus" aria-live="polite">Memeriksa dukungan WebAuthn dan autentikator yang terdaftar…</p></div><div class="progress-track biometric-progress"><span id="faceProgress" style="width:0%"></span></div></div><div class="biometric-explainer"><strong>Privasi perangkat</strong><p>Docura meminta autentikasi WebAuthn. Sidik jari atau PIN diproses oleh perangkat; Docura tidak menerima gambar atau template sidik jari. Animasi ini tidak membaca sidik jari secara langsung dan bukan verifikasi identitas nyata.</p></div><div class="face-demo-note"><strong>Representasi demo:</strong> keberhasilan WebAuthn membuktikan verifikasi lokal pada autentikator yang terdaftar, bukan pencocokan sidik jari warga dengan KTP-el atau database pemerintah.</div><div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">Batal</button><button class="btn btn-primary" id="startFaceScan" disabled>${supported?'Memeriksa perangkat…':'Browser tidak mendukung WebAuthn'}</button></div>`);
    const btn=document.getElementById('startFaceScan');
    if(!supported){document.getElementById('faceStatus').textContent='Gunakan browser yang mendukung WebAuthn pada localhost atau HTTPS.';document.getElementById('faceCaption').textContent='PERANGKAT TIDAK DIDUKUNG';return;}
    btn.disabled=true;
    try{
      const state=await officerApi('/api/officer/webauthn/status');
      if(!document.getElementById('startFaceScan'))return;
      btn.dataset.webauthnRegistered=state.registered?'yes':'no';
      btn.textContent=state.registered?'Mulai verifikasi perangkat':'Daftarkan perangkat lokal';
      btn.disabled=false;
      document.getElementById('faceStatus').textContent=state.registered?`Autentikator lokal tersedia (${state.count}). Tekan tombol untuk meminta verifikasi perangkat.`:'Perangkat ini belum terdaftar. Daftarkan passkey lokal sekali, lalu lakukan verifikasi kasus.';
      document.getElementById('faceCaption').textContent=state.registered?'SIAP UNTUK WEB AUTHN':'PENDAFTARAN DIPERLUKAN';
    }catch(error){if(btn){btn.disabled=true;btn.textContent='Tidak dapat memeriksa perangkat';}const status=document.getElementById('faceStatus');if(status)status.textContent=error.message;}
  }
  function fingerprintIcon(){return `<svg class="officer-fingerprint" viewBox="0 0 120 120" aria-hidden="true"><path d="M60 12C33 12 16 31 16 56M60 24C40 24 28 39 28 58M60 36C47 36 40 47 40 61M60 48C54 48 51 54 51 62M60 12C87 12 104 31 104 56M60 24C80 24 92 39 92 58M60 36C73 36 80 47 80 61M60 48C66 48 69 54 69 62M16 65C16 90 30 106 42 112M28 67C28 86 37 98 48 104M40 69C40 83 47 92 55 96M104 65C104 90 90 106 78 112M92 67C92 86 83 98 72 104M80 69C80 83 73 92 65 96M51 65C51 78 55 86 60 90C65 86 69 78 69 65" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>`;}
  async function registerOfficerLocalAuthenticator(){
    const data=await officerApi('/api/officer/webauthn/registration/options',{method:'POST',body:JSON.stringify({})});
    const credential=await navigator.credentials.create({publicKey:prepareOfficerCredentialOptions(data.options,true)});
    if(!credential)throw new Error('Pendaftaran autentikator dibatalkan.');
    const verified=await officerApi('/api/officer/webauthn/registration/verify',{method:'POST',body:JSON.stringify({challenge:data.options.challenge,credential:serializeOfficerCredential(credential),deviceLabel:'Autentikator lokal petugas'})});
    return verified.message;
  }
  async function authenticateOfficerForCase(caseId){
    const data=await officerApi('/api/officer/webauthn/authentication/options',{method:'POST',body:JSON.stringify({caseId})});
    const credential=await navigator.credentials.get({publicKey:prepareOfficerCredentialOptions(data.options,false)});
    if(!credential)throw new Error('Verifikasi perangkat dibatalkan.');
    return officerApi('/api/officer/webauthn/authentication/verify',{method:'POST',body:JSON.stringify({caseId,challenge:data.options.challenge,credential:serializeOfficerCredential(credential)})});
  }
  async function startFaceScan(){
    const btn=document.getElementById('startFaceScan');
    const visual=document.getElementById('faceVisual');
    const progress=document.getElementById('faceProgress');
    const status=document.getElementById('faceStatus');
    const caption=document.getElementById('faceCaption');
    const dot=document.getElementById('biometricStatusDot');
    if(!btn||!visual||!progress||!status||!caption||!selectedCaseId)return;
    btn.disabled=true;visual.classList.add('scanning');visual.classList.remove('is-success','is-failed');
    progress.style.width='28%';caption.textContent='MENUNGGU AUTENTIKATOR PERANGKAT';status.textContent='Ikuti dialog sistem. Gunakan sidik jari atau PIN yang tersedia pada perangkat.';if(dot)dot.className='biometric-status-dot is-pending';
    try{
      if(btn.dataset.webauthnRegistered!=='yes'){
        btn.textContent='Mendaftarkan…';
        await registerOfficerLocalAuthenticator();
        btn.dataset.webauthnRegistered='yes';
        visual.classList.remove('scanning');progress.style.width='100%';caption.textContent='PERANGKAT TERDAFTAR';status.textContent='Passkey lokal berhasil didaftarkan. Tekan tombol sekali lagi untuk memverifikasi kasus ini.';if(dot)dot.className='biometric-status-dot is-success';
        btn.textContent='Verifikasi kasus dengan perangkat';btn.disabled=false;return;
      }
      btn.textContent='Menunggu perangkat…';
      const proof=await authenticateOfficerForCase(selectedCaseId);
      progress.style.width='78%';caption.textContent='AUTENTIKATOR TERVERIFIKASI';status.textContent='Verifikasi perangkat berhasil. Mengikat bukti ke kasus…';
      await mutateCase('face-scan',selectedCaseId,{biometricVerificationToken:proof.verificationToken});
      visual.classList.remove('scanning');visual.classList.add('is-success');progress.style.width='100%';caption.textContent='VERIFIKASI BERHASIL';status.textContent='Autentikasi perangkat berhasil dan pemeriksaan identitas kasus tercatat.';if(dot)dot.className='biometric-status-dot is-success';
      btn.textContent='Selesai';btn.disabled=true;
      setTimeout(()=>{if(!modalBackdrop.hidden){closeModal();currentView='detail';render();showToast('WebAuthn lokal berhasil. Pemeriksaan identitas kasus tercatat.');}},700);
    }catch(error){
      visual.classList.remove('scanning');visual.classList.add('is-failed');progress.style.width='100%';caption.textContent='VERIFIKASI GAGAL';status.textContent=error.message||'Autentikasi perangkat gagal atau dibatalkan. Kasus tidak berubah.';if(dot)dot.className='biometric-status-dot is-failed';btn.disabled=false;btn.textContent='Coba lagi';
    }
  }
  function qrStorageKey(caseId){ return `docura-active-qr:${caseId}`; }
  function readQrReceipt(caseId){
    try {
      const key=qrStorageKey(caseId); const receipt=JSON.parse(localStorage.getItem(key)||'null');
      if(!receipt || !receipt.token || !receipt.expiresAt || new Date(receipt.expiresAt).getTime()<=Date.now()) { localStorage.removeItem(key); return null; }
      return receipt;
    } catch (_) { return null; }
  }
  function clearQrReceipt(caseId){ try{localStorage.removeItem(qrStorageKey(caseId));sessionStorage.removeItem(qrStorageKey(caseId));}catch(_){} }
  async function showQrReceipt(caseId, citizenName, receipt, reopened=false){
    if(!receipt || new Date(receipt.expiresAt).getTime()<=Date.now()){clearQrReceipt(caseId);showToast('QR sudah kedaluwarsa. Minta petugas berwenang menerbitkan QR baru.');return;}
    const token=receipt.token; const expiresAt=receipt.expiresAt;
    let image = ''; let qrDataUrl = '';
    try { const data = await officerApi('/api/officer/qr/render', {method:'POST', body:JSON.stringify({token})}); qrDataUrl = data.dataUrl; image = `<img class="qr-image" src="${data.dataUrl}" alt="QR Code pemulihan ${esc(caseId)}">`; }
    catch (_) { image = '<p>QR visual gagal dibuat. Token tetap tersedia di bawah untuk pengujian.</p>'; }
    openModal(`<h2 id="modalTitle">QR pemulihan ${reopened?'tersimpan':'diterbitkan'}</h2><p>Kasus ${esc(caseId)} · ${esc(citizenName)}</p><div class="qr-display">${image}<p>QR berlaku sampai <strong>${new Date(expiresAt).toLocaleString('id-ID')}</strong>.</p><label class="form-label" for="qrTokenValue">Token demo (untuk simulasi pemindaian)</label><input id="qrTokenValue" class="form-input" readonly value="${esc(token)}"><button class="btn btn-secondary" id="copyQrToken" type="button">Salin token</button>${qrDataUrl?'<button class="btn btn-secondary" id="printQrButton" type="button">Cetak QR</button>':''}<div class="face-demo-note">QR dapat dibuka kembali dari detail kasus selama belum digunakan dan belum kedaluwarsa. Verifikasi yang gagal tidak menghapus QR. Jangan bagikan token kepada pihak lain.</div><div class="modal-actions"><button class="btn btn-primary" data-action="close-modal">Tutup</button></div></div>`);
    document.getElementById('copyQrToken')?.addEventListener('click', async()=>{try{await navigator.clipboard.writeText(token);showToast('Token disalin.');}catch(_){document.getElementById('qrTokenValue')?.select();showToast('Pilih dan salin token secara manual.');}});
    document.getElementById('printQrButton')?.addEventListener('click',()=>{const w=window.open('','_blank');if(!w){showToast('Izinkan pop-up untuk mencetak QR.');return;}try{w.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>QR Pemulihan ${esc(caseId)}</title><style>body{font:16px Arial,sans-serif;text-align:center;padding:30px}img{width:260px;height:260px;object-fit:contain}small{display:block;margin-top:12px;color:#555}@media print{button{display:none}}</style></head><body><h2>QR Pemulihan Docura</h2><p>Kasus ${esc(caseId)}</p><img src="${qrDataUrl}" alt="QR pemulihan"><small>Berlaku sampai ${esc(new Date(expiresAt).toLocaleString('id-ID'))}</small></body></html>`);w.document.close();setTimeout(()=>{try{w.focus();w.print();}catch(_){}},300);}catch(_){try{w.close()}catch(__){}showToast('Jendela cetak QR tidak dapat dibuka.');}});
  }
  async function showQrToken(caseId, citizenName, token, expiresAt){
    const receipt={token,expiresAt:expiresAt||new Date(Date.now()+30*60*1000).toISOString()};
    try{localStorage.setItem(qrStorageKey(caseId),JSON.stringify(receipt));}catch(_){showToast('QR tampil sekarang, tetapi browser tidak dapat menyimpan salinan untuk dibuka kembali.');}
    render();
    return showQrReceipt(caseId,citizenName,receipt,false);
  }
  async function reopenQr(caseId){
    const c=cases.find(x=>x.id===caseId); const receipt=readQrReceipt(caseId);
    if(!c || c.status!=='APPROVED'){showToast('QR hanya tersedia untuk kasus yang disetujui dan belum masuk proses cetak.');return;}
    if(!receipt){showToast('QR tidak tersedia di tab ini atau sudah kedaluwarsa. Periksa tab tempat persetujuan dilakukan atau minta QR baru.');return;}
    return showQrReceipt(caseId,c.citizenName,receipt,true);
  }
  function askDecision(id,kind){
    const c=cases.find(x=>x.id===id);if(!c)return;const isApprove=kind==='approve';
    openModal(`<h2 id="modalTitle">${isApprove?'Setujui kasus':'Tolak kasus'}</h2><p>${esc(c.id)} · ${esc(c.citizenName)}</p><label class="form-label" for="decisionNote">Catatan keputusan ${isApprove?'(opsional)':'(wajib)'}</label><textarea id="decisionNote" class="form-input" rows="4" maxlength="500" placeholder="Tuliskan alasan atau ringkasan pemeriksaan"></textarea><div class="face-demo-note">Keputusan dicatat di server dan hanya dapat dilakukan role berwenang.</div><div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">Kembali</button><button class="btn ${isApprove?'btn-success':'btn-danger'}" id="confirmDecision">${isApprove?'Setujui':'Tolak'} kasus</button></div>`);
    document.getElementById('confirmDecision').onclick=async()=>{const note=document.getElementById('decisionNote').value.trim();if(!isApprove&&!note){showToast('Catatan wajib diisi saat menolak kasus.');return;}try{const result=await mutateCase(kind,id,{note});closeModal();render();if(isApprove&&result?.qrToken){await showQrToken(id,c.citizenName,result.qrToken,result.qrExpiresAt);showToast('Kasus disetujui dan QR diterbitkan.');}else{showToast(isApprove?'Kasus disetujui.':'Kasus ditolak.');}}catch(error){showToast(error.message);}};
  }
  function editNote(id){
    const c=cases.find(x=>x.id===id);if(!c)return;
    openModal(`<h2 id="modalTitle">Catatan petugas</h2><p>${esc(c.id)} · ${esc(c.citizenName)}</p><label class="form-label" for="noteEdit">Catatan</label><textarea class="form-input" id="noteEdit" rows="5" maxlength="500">${esc(c.reviewNote||c.note||'')}</textarea><div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">Batal</button><button class="btn btn-primary" id="saveNote">Simpan catatan</button></div>`);
    document.getElementById('saveNote').onclick=async()=>{try{await mutateCase('edit-note',id,{note:document.getElementById('noteEdit').value.trim()});closeModal();render();showToast('Catatan tersimpan di server.');}catch(error){showToast(error.message);}};
  }
  async function openRecoveryPrintFlow(caseId){
    const c=cases.find(x=>x.id===caseId);if(!c)return;
    const supported=Boolean(window.PublicKeyCredential&&navigator.credentials?.create&&navigator.credentials?.get);
    openModal(`<div class="biometric-modal-head"><div class="biometric-icon">${fingerprintIcon()}</div><div><span class="biometric-kicker">VERIFIKASI SEBELUM CETAK</span><h2 id="modalTitle">Autentikasi perangkat lokal</h2><p>${esc(c.id)} · ${esc(c.citizenName)}</p></div></div><div class="biometric-card"><div class="face-visual fingerprint-scan-visual biometric-visual" id="printFingerprintVisual"><div class="fingerprint-orbit"></div>${fingerprintIcon()}<div class="face-scan-line"></div><div class="face-caption" id="printFingerprintCaption">SIAP UNTUK WEB AUTHN</div></div><div class="biometric-status-row"><span class="biometric-status-dot" id="printBiometricStatusDot"></span><p id="printFingerprintStatus" aria-live="polite">Memeriksa autentikator lokal…</p></div><div class="progress-track biometric-progress"><span id="printFingerprintProgress" style="width:0%"></span></div></div><div class="biometric-explainer"><strong>Verifikasi perangkat lokal</strong><p>WebAuthn meminta autentikasi dari perangkat yang terdaftar. Ikuti permintaan verifikasi yang muncul pada perangkat atau browser Anda.</p></div><div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">Batal</button><button class="btn btn-primary" id="startPrintFingerprint" ${supported?'':'disabled'}>${supported?'Memeriksa perangkat…':'Browser tidak mendukung WebAuthn'}</button></div>`);
    const btn=document.getElementById('startPrintFingerprint');
    if(!supported){document.getElementById('printFingerprintStatus').textContent='Gunakan browser yang mendukung WebAuthn pada localhost atau HTTPS.';return;}
    try{const state=await officerApi('/api/officer/webauthn/status');if(!document.getElementById('startPrintFingerprint'))return;btn.dataset.webauthnRegistered=state.registered?'yes':'no';btn.textContent=state.registered?'Verifikasi perangkat & lanjutkan':'Daftarkan perangkat lokal';btn.disabled=false;document.getElementById('printFingerprintStatus').textContent=state.registered?'Autentikator lokal tersedia. Verifikasi perangkat akan diminta sebelum melanjutkan pencetakan.':'Daftarkan passkey lokal terlebih dahulu. Setelah itu, ulangi untuk memverifikasi sebelum pencetakan.';}catch(error){btn.disabled=true;document.getElementById('printFingerprintStatus').textContent=error.message;}
    btn.onclick=async()=>{
      if(!btn||btn.disabled)return;
      const visual=document.getElementById('printFingerprintVisual'),progress=document.getElementById('printFingerprintProgress'),status=document.getElementById('printFingerprintStatus'),caption=document.getElementById('printFingerprintCaption'),dot=document.getElementById('printBiometricStatusDot');
      btn.disabled=true;visual.classList.add('scanning');visual.classList.remove('is-success','is-failed');progress.style.width='25%';caption.textContent='MENUNGGU AUTENTIKATOR';status.textContent='Ikuti dialog sistem dan gunakan sidik jari atau PIN yang tersedia pada perangkat.';if(dot)dot.className='biometric-status-dot is-pending';
      try{
        if(btn.dataset.webauthnRegistered!=='yes'){
          btn.textContent='Mendaftarkan perangkat…';await registerOfficerLocalAuthenticator();btn.dataset.webauthnRegistered='yes';visual.classList.remove('scanning');visual.classList.add('is-success');progress.style.width='100%';caption.textContent='PERANGKAT TERDAFTAR';status.textContent='Passkey lokal berhasil didaftarkan. Tekan tombol lagi untuk autentikasi dan melanjutkan skenario.';if(dot)dot.className='biometric-status-dot is-success';btn.textContent='Verifikasi perangkat & lanjutkan';btn.disabled=false;return;
        }
        btn.textContent='Menunggu perangkat…';const webauthn=await officerApi('/api/officer/webauthn/authentication/options',{method:'POST',body:JSON.stringify({caseId,flow:'print'})});
        const credential=await navigator.credentials.get({publicKey:prepareOfficerCredentialOptions(webauthn.options,false)});if(!credential)throw new Error('Autentikasi perangkat dibatalkan.');
        const proof=await officerApi('/api/officer/webauthn/authentication/verify',{method:'POST',body:JSON.stringify({caseId,flow:'print',challenge:webauthn.options.challenge,credential:serializeOfficerCredential(credential)})});
        progress.style.width='70%';caption.textContent='WEB AUTHN BERHASIL';status.textContent='Autentikator lokal berhasil. Menyiapkan alur pencetakan…';
        const verification=await officerApi(`/api/officer/cases/${encodeURIComponent(caseId)}/print-local-verification`,{method:'POST',body:JSON.stringify({webauthnVerificationToken:proof.verificationToken})});
        if(!verification.success||!verification.verificationToken)throw new Error(verification.message||'Verifikasi referensi demo ditolak.');
        visual.classList.remove('scanning');visual.classList.add('is-success');progress.style.width='100%';caption.textContent='AUTENTIKASI LOKAL BERHASIL';status.textContent=verification.message;if(dot)dot.className='biometric-status-dot is-success';
        const data=await officerApi(`/api/officer/cases/${encodeURIComponent(caseId)}/recovery-documents`);renderRecoveryDocumentSelection(caseId,c,data.documents||[],verification.verificationToken);
      }catch(error){visual.classList.remove('scanning');visual.classList.add('is-failed');progress.style.width='100%';caption.textContent='VERIFIKASI DITOLAK';status.textContent=error.message||'Verifikasi gagal atau dibatalkan. Proses pencetakan tidak dilanjutkan.';if(dot)dot.className='biometric-status-dot is-failed';btn.disabled=false;btn.textContent='Coba lagi';}
    };
  }
  function renderRecoveryDocumentSelection(caseId,c,docs,biometricVerificationToken){
    if(!docs.length){openModal(`<h2 id="modalTitle">Tidak ada dokumen untuk dipulihkan</h2><p>${esc(c.id)} · ${esc(c.citizenName)}</p><div class="empty-state">Tidak ditemukan dokumen aktif pada akun warga ini. Kasus belum dapat ditandai selesai.</div><div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">Tutup</button></div>`);return;}
    openModal(`<h2 id="modalTitle">Pilih dokumen untuk dicetak</h2><p>${esc(c.id)} · ${esc(c.citizenName)}</p><p>Daftar ini hanya menampilkan judul dokumen. Isi dokumen tidak ditampilkan di dashboard.</p><div id="recoveryDocumentChoices" class="case-list">${docs.map(d=>`<label class="case-row recovery-document-choice"><input type="checkbox" value="${esc(d.id)}"><div class="case-row-main"><strong>${esc(d.title)}</strong></div></label>`).join('')}</div><div class="face-demo-note">Pilih satu atau beberapa dokumen. Tautan cetak bersifat privat dan kedaluwarsa setelah 2 menit. Buka tab setiap dokumen, lakukan pencetakan, lalu kembali untuk konfirmasi.</div><div id="printBatchMessage" role="status" class="face-demo-note" hidden></div><div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">Batal</button><button class="btn btn-primary" id="printSelectedDocuments">Cetak dokumen terpilih</button><button class="btn btn-success" id="confirmPrintBatch" disabled>Saya sudah mencetak — tandai selesai</button></div>`);
    let printInitiated=false;
    let printedDocumentIds=[];
    const printBtn=document.getElementById('printSelectedDocuments'); const completeBtn=document.getElementById('confirmPrintBatch'); const msg=document.getElementById('printBatchMessage');
    const selectedIds=()=>[...document.querySelectorAll('#recoveryDocumentChoices input[type="checkbox"]:checked')].map(x=>x.value);
    printBtn.onclick=async()=>{
      const ids=selectedIds();if(!ids.length){showToast('Pilih setidaknya satu dokumen.');return;}
      printBtn.disabled=true;printBtn.textContent='Menyiapkan tautan cetak…';
      const tabs=ids.map(()=>window.open('about:blank','_blank'));const opened=tabs.filter(Boolean).length;
      if(opened!==ids.length){tabs.filter(Boolean).forEach(tab=>{try{tab.close();}catch(_){}});msg.hidden=false;msg.textContent='Browser memblokir satu atau beberapa tab. Izinkan pop-up untuk localhost lalu tekan tombol cetak lagi.';printBtn.disabled=false;printBtn.textContent='Coba buka dokumen lagi';return;}
      tabs.forEach(tab=>{try{tab.opener=null;}catch(_){}});
      try{const result=await officerApi(`/api/officer/cases/${encodeURIComponent(caseId)}/print-documents`,{method:'POST',body:JSON.stringify({documentIds:ids})});
        (result.documents||[]).forEach((doc,index)=>{if(tabs[index])tabs[index].location.replace(doc.url);});
        printInitiated=true;printedDocumentIds=[...ids];document.querySelectorAll('#recoveryDocumentChoices input[type="checkbox"]').forEach(box=>box.disabled=true);completeBtn.disabled=false;msg.hidden=false;msg.textContent=`${(result.documents||[]).length} tab dokumen dibuka. Cetak dokumen pada tab tersebut terlebih dahulu, lalu konfirmasi di sini. Docura tidak dapat memastikan printer fisik benar-benar mencetak.`;printBtn.textContent='Tautan cetak dibuka';
      }catch(error){tabs.forEach(tab=>{try{tab.close();}catch(_){}});msg.hidden=false;msg.textContent=error.message;printBtn.disabled=false;printBtn.textContent='Coba lagi';}
    };
    completeBtn.onclick=async()=>{
      const ids=printedDocumentIds;if(!printInitiated){showToast('Buka dokumen untuk dicetak terlebih dahulu.');return;}if(!ids.length){showToast('Pilih setidaknya satu dokumen.');return;}
      if(!confirm(`Konfirmasi bahwa ${ids.length} dokumen sudah dicetak dan kasus ${caseId} boleh ditandai selesai?`))return;
      completeBtn.disabled=true;completeBtn.textContent='Menyimpan penyelesaian…';
      try{await officerApi(`/api/officer/cases/${encodeURIComponent(caseId)}/complete-print-batch`,{method:'POST',body:JSON.stringify({documentIds:ids,printConfirmed:true,biometricVerificationToken})});await refreshCases();await refreshSettings();closeModal();currentView='detail';selectedCaseId=caseId;render();showToast('Batch pencetakan tercatat dan kasus ditandai selesai.');}
      catch(error){msg.hidden=false;msg.textContent=error.message;completeBtn.disabled=false;completeBtn.textContent='Saya sudah mencetak — tandai selesai';}
    };
  }
  async function openRecoveryReceipt(caseId){
    const printWindow=window.open('', '_blank');
    if(!printWindow){showToast('Popup diblokir browser. Izinkan popup untuk Docura lalu coba lagi.');return;}
    printWindow.document.open();
    printWindow.document.write('<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Bukti Pemulihan — Docura</title></head><body style="font-family:Arial,sans-serif;padding:32px;color:#17233d">Memuat bukti pemulihan…</body></html>');
    printWindow.document.close();
    try{
      const data=await officerApi(`/api/officer/cases/${encodeURIComponent(caseId)}/receipt`);
      const r=data.receipt;
      const escPrint=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const fmt=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d)};
      const titles=(r.documentTitles||[]).map((title,i)=>`<li>${i+1}. ${escPrint(title)}</li>`).join('')||'<li>Daftar judul dokumen tidak tersedia</li>';
      printWindow.document.open();
      printWindow.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escPrint(r.receiptNumber)} — Docura</title><style>
        :root{font-family:Arial,Helvetica,sans-serif;color:#15233e}body{margin:0;background:#eef2f8;padding:28px}.sheet{max-width:820px;margin:0 auto;background:#fff;border:1px solid #d9e2ef;border-radius:16px;padding:38px;box-shadow:0 8px 30px #182b4812}.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:2px solid #dce7f6;padding-bottom:20px}.brand{font-size:24px;font-weight:800;letter-spacing:.04em;color:#1765d1}.sub{color:#66758e;font-size:12px;margin-top:5px}.pill{display:inline-block;border-radius:999px;background:#e3f8ec;color:#167345;padding:7px 12px;font-size:12px;font-weight:700}.ref{font-size:12px;color:#64738a;text-align:right;overflow-wrap:anywhere}.ref strong{display:block;color:#15233e;margin-top:5px}.title{font-size:25px;margin:28px 0 8px}.intro{color:#596982;line-height:1.55;font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:22px 0}.field{padding:13px;background:#f6f8fc;border:1px solid #e6ecf5;border-radius:9px;min-width:0}.label{font-size:11px;color:#6b7890;margin-bottom:6px}.value{font-size:14px;font-weight:700;overflow-wrap:anywhere}.section{font-size:15px;margin:24px 0 10px}.docs{padding-left:20px;line-height:1.8;font-size:13px}.foot{border-top:1px solid #dce4ef;margin-top:28px;padding-top:16px;font-size:11px;color:#65738b;line-height:1.6}.toolbar{max-width:820px;margin:0 auto 14px;display:flex;justify-content:flex-end}.toolbar button{border:0;border-radius:9px;background:#1765d1;color:#fff;font-weight:700;padding:11px 16px;cursor:pointer}@media(max-width:600px){body{padding:10px}.sheet{padding:20px}.grid{grid-template-columns:1fr}.top{flex-direction:column}.ref{text-align:left}}@media print{body{background:#fff;padding:0}.sheet{max-width:none;border:0;border-radius:0;box-shadow:none;padding:0}.toolbar{display:none}@page{size:A4;margin:16mm}}
        </style></head><body><div class="toolbar"><button id="printReceipt" type="button">Cetak / Simpan sebagai PDF</button></div><main class="sheet"><header class="top"><div><div class="brand">DOCURA</div><div class="sub">Secure Document Recovery System</div></div><div><span class="pill">PEMULIHAN SELESAI</span><div class="ref">Nomor bukti<strong>${escPrint(r.receiptNumber)}</strong></div></div></header><h1 class="title">Bukti Pemulihan Dokumen</h1><p class="intro">Bukti administratif bahwa proses pemulihan dokumen pada kasus di bawah telah ditandai selesai di Docura.</p><div class="grid"><div class="field"><div class="label">Nomor kasus</div><div class="value">${escPrint(r.caseId)}</div></div><div class="field"><div class="label">Tanggal penyelesaian</div><div class="value">${escPrint(fmt(r.completedAt))}</div></div><div class="field"><div class="label">Nama warga</div><div class="value">${escPrint(r.citizenName)}</div></div><div class="field"><div class="label">Kode warga Docura</div><div class="value">${escPrint(r.citizenCode)}</div></div><div class="field"><div class="label">Lokasi terdampak</div><div class="value">${escPrint(r.location)}</div></div><div class="field"><div class="label">Jenis bencana</div><div class="value">${escPrint(r.disaster)}</div></div><div class="field"><div class="label">Kanal pemulihan</div><div class="value">${r.recoveryChannel==='OFFICE'?'Dibantu petugas / kantor':escPrint(r.recoveryChannel)}</div></div><div class="field"><div class="label">Petugas yang menyelesaikan</div><div class="value">${escPrint(r.staffName)} · ${escPrint(r.staffRole)}</div></div></div><h2 class="section">Daftar dokumen yang dicatat dalam penyerahan</h2><ol class="docs">${titles}</ol>${r.note?`<h2 class="section">Catatan keputusan</h2><p class="intro">${escPrint(r.note)}</p>`:''}<footer class="foot"><strong>Catatan penting:</strong> Dokumen ini merupakan bukti administratif proses pemulihan di Docura, bukan pengganti KTP, KK, paspor, akta kelahiran, atau dokumen resmi lainnya. Verifikasi sidik jari yang tercatat dalam prototipe merupakan simulasi dan bukan validasi biometrik pemerintah. Bukti dibuat pada ${escPrint(fmt(new Date().toISOString()))}.</footer></main></body></html>`);
      printWindow.document.close();
      printWindow.document.getElementById('printReceipt')?.addEventListener('click',()=>printWindow.print());
      printWindow.focus();
    }catch(error){printWindow.close();showToast(error.message||'Bukti pemulihan belum dapat dimuat.');}
  }

  async function doAction(action,id){
    if(action==='close-modal')return closeModal();
    if(action==='resume-draft')return newCaseModal();
    try{await authorizeAction(action);}catch(error){showToast(error.message);return;}
    const c=cases.find(x=>x.id===id);
    if(action==='new-case')return newCaseModal();
    if(action==='view-cases'){currentView='cases';selectedCaseId=null;render();return;}
    if(action==='open-case'){selectedCaseId=id;currentView='detail';render();return;}
    if(action==='view-qr')return reopenQr(id);
    if(action==='face-scan')return openFaceScan(id);
    if(action==='approve'||action==='reject')return askDecision(id,action);
    if(action==='edit-note')return editNote(id);
    if(action==='complete'){if(!c)return;return openRecoveryPrintFlow(id);}
    if(action==='print-pending'){
      if(!c)return;
      openModal(`<h2 id="modalTitle">Verifikasi QR Code</h2><p>${esc(c.id)} · ${esc(c.citizenName)}</p><label class="form-label" for="qrInputToken">Pindai QR atau masukkan token hasil pemindaian</label><input id="qrInputToken" class="form-input" autocomplete="off" maxlength=64 placeholder="Token QR 64 karakter" required><div class="face-demo-note">Untuk demo ini, token dapat dimasukkan dari hasil pemindaian QR. Server memeriksa token, masa berlaku, dan penggunaan ulang.</div><div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">Batal</button><button class="btn btn-primary" id="verifyQrButton">Verifikasi QR</button></div>`);
      document.getElementById('verifyQrButton').onclick=async()=>{const qrToken=document.getElementById('qrInputToken').value.trim();try{await mutateCase('print-pending',id,{qrToken});clearQrReceipt(id);closeModal();render();showToast('QR valid. Kasus masuk antrean cetak.');}catch(error){showToast(error.message);}};
      return;
    }
    if(!c)return;
    if(action==='cancel-case'&&!confirm(`Batalkan kasus ${c.id}?`))return;
    try {
      await mutateCase(action,id);
      render();
      showToast('Perubahan kasus berhasil disimpan di server.');
    } catch(error) { showToast(error.message); }
  }
  document.addEventListener('click',e=>{
    const receiptButton=e.target.closest('[data-recovery-receipt]');if(receiptButton){openRecoveryReceipt(receiptButton.dataset.recoveryReceipt);return;}
    const notificationRead=e.target.closest('[data-notification-read]');if(notificationRead){markNotificationRead(notificationRead.dataset.notificationRead);return;}
    const notificationCase=e.target.closest('[data-notification-case]');if(notificationCase){const id=notificationCase.dataset.notificationCase;const open=async()=>{if(!cases.some(c=>c.id===id))await refreshCases();if(cases.some(c=>c.id===id)){selectedCaseId=id;currentView='detail';render();}else showToast('Kasus tidak tersedia untuk akun ini atau sudah tidak dapat diakses.');};open().catch(error=>showToast(error.message));return;}
    if(e.target.closest('#markAllNotificationsRead')){officerApi('/api/officer/notifications/read-all',{method:'POST',body:'{}'}).then(loadNotifications).then(()=>{if(currentView==='notifications')pageContent.innerHTML=renderNotifications();applyTranslations();}).catch(error=>showToast(error.message));return;}
    if(e.target.closest('#refreshStaffDirectory')){loadStaffDirectory();return;}
    if(e.target.closest('#refreshAnalytics')){refreshCases().then(()=>{render();showToast('Data analitik diperbarui.');}).catch(error=>showToast(error.message));return;}
    if(e.target.closest('#notificationTrigger')){currentView='notifications';selectedCaseId=null;render();return;}
    const scanBtn=e.target.closest('#startFaceScan');
    if(scanBtn){e.preventDefault();startFaceScan();return;}
    const citizenBtn=e.target.closest('[data-select-citizen]');
    if(citizenBtn){const form=document.getElementById('newCaseForm');if(!form)return;selectedCitizen={userId:citizenBtn.dataset.selectCitizen,citizenCode:citizenBtn.dataset.citizenCode,fullName:citizenBtn.dataset.citizenName};form.elements.citizenName.value=selectedCitizen.fullName;form.elements.citizenCode.value=selectedCitizen.citizenCode;form.elements.citizenUserId.value=selectedCitizen.userId;form.elements.citizenSearch.value=selectedCitizen.citizenCode;document.getElementById('selectedCitizenSummary').textContent=`Warga dipilih: ${selectedCitizen.fullName} · ${selectedCitizen.citizenCode}`;document.getElementById('citizenSearchResults').innerHTML='';return;}
    if(e.target.closest('#refreshCitizenDirectory')){loadCitizenDirectory();return;}
    const actionBtn=e.target.closest('[data-action]');
    if(actionBtn){doAction(actionBtn.dataset.action,actionBtn.dataset.id);return;}
    const nav=e.target.closest('[data-view]');
    if(nav){currentView=nav.dataset.view;selectedCaseId=null;render();document.getElementById('sidebar').classList.remove('open');}
  });
  document.getElementById('emergencyToggle').addEventListener('click',async()=>{try{await authorizeAction('emergency-toggle');await setEmergency();}catch(error){showToast(error.message);}});
  document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>{const t=b.dataset.theme;document.documentElement.dataset.theme=t;document.querySelectorAll('[data-theme]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));try{localStorage.setItem('refugeeledger-theme',t);}catch(_){}}));
  document.getElementById('languageSelect')?.addEventListener('change',e=>setLanguage(e.target.value));
  document.getElementById('fontSmaller')?.addEventListener('click',()=>{let v=1;try{v=Number(localStorage.getItem('docura-font-scale')||1);}catch(_){}v=Math.max(.9,Math.round((v-.05)*100)/100);try{localStorage.setItem('docura-font-scale',String(v));}catch(_){}applyAccessibilityPreferences();});
  document.getElementById('fontLarger')?.addEventListener('click',()=>{let v=1;try{v=Number(localStorage.getItem('docura-font-scale')||1);}catch(_){}v=Math.min(1.25,Math.round((v+.05)*100)/100);try{localStorage.setItem('docura-font-scale',String(v));}catch(_){}applyAccessibilityPreferences();});
  document.getElementById('contrastToggle')?.addEventListener('click',()=>{const on=document.documentElement.dataset.contrast!=='high';try{localStorage.setItem('docura-high-contrast',String(on));}catch(_){}applyAccessibilityPreferences();});
  document.getElementById('mobileMenu').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('modalClose').addEventListener('click',()=>{if(activeModalLocked && document.getElementById('newCaseForm')){saveDraftFromForm();const hasDraft=Boolean(readEmergencyDraft());closeModal(true);render();showToast(hasDraft?'Draft darurat disimpan. Anda dapat melanjutkannya kembali dari dashboard.':'Popup ditutup. Belum ada data yang perlu disimpan.');return;}closeModal();});modalBackdrop.addEventListener('click',e=>{if(e.target===modalBackdrop)closeModal();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modalBackdrop.hidden)closeModal();});window.addEventListener('beforeunload',e=>{if(activeModalLocked){const form=document.getElementById('newCaseForm');if(form)saveDraftFromForm();e.preventDefault();e.returnValue='';}});
  document.addEventListener('submit',async e=>{if(e.target.id==='createStaffForm'){e.preventDefault();const form=e.target;const submit=form.querySelector('[type=submit]');const payload={displayName:form.elements.displayName.value.trim(),email:form.elements.email.value.trim(),role:form.elements.role.value,temporaryPassword:form.elements.temporaryPassword.value};if(submit){submit.disabled=true;submit.textContent='Membuat akun…';}try{const result=await officerApi('/api/officer/staff',{method:'POST',body:JSON.stringify(payload)});form.reset();await loadStaffDirectory();showToast(result.message||'Akun petugas berhasil dibuat.');}catch(error){showToast(error.message);}finally{if(submit){submit.disabled=false;submit.textContent='Buat akun petugas';}}return;}if(e.target.id!=='newCaseForm')return;e.preventDefault();if(isCreatingCase)return;const f=e.target;const name=f.elements.citizenName.value.trim();const code=f.elements.citizenCode.value.trim();const userId=f.elements.citizenUserId.value.trim();const location=f.elements.location.value.trim();if(!selectedCitizen||!userId||!code||!name){showToast('Cari dan pilih akun warga terdaftar sebelum membuat kasus.');f.elements.citizenSearch.focus();return;}if(!location||location.length>100){showToast('Lokasi terdampak wajib diisi dan maksimal 100 karakter.');f.elements.location.focus();return;}if(emergencyMode&&activeEmergencyAssignment()){showToast('Selesaikan kasus darurat yang sedang Anda tangani sebelum membuat kasus baru.');return;}isCreatingCase=true;const submitButton=f.querySelector('button[type="submit"]');if(submitButton){submitButton.disabled=true;submitButton.textContent='Menyimpan kasus…';}try{await authorizeAction('new-case');if(emergencyMode)saveDraftFromForm();const result=await mutateCase('new-case',null,{citizenName:name,citizenCode:code,citizenUserId:userId,location,disaster:f.elements.disaster.value,note:f.elements.caseNote.value.trim()});const id=result?.case?.id||result?.id;if(!id)throw new Error('Kasus tersimpan, tetapi ID kasus tidak diterima. Muat ulang daftar kasus.');clearEmergencyDraft();closeModal(true);currentView='detail';selectedCaseId=id;render();showToast('Kasus berhasil dibuat untuk warga terdaftar.');}catch(error){showToast(error.message);}finally{isCreatingCase=false;}});
  document.addEventListener('input',e=>{if(e.target.id==='citizenDirectorySearch'){const value=e.target.value;clearTimeout(citizenSearchTimer);citizenSearchTimer=setTimeout(()=>loadCitizenDirectory(value),250);return;}if(e.target.id==='caseSearch'||e.target.id==='statusFilter'){const s=document.getElementById('caseSearch')?.value||'';const f=document.getElementById('statusFilter')?.value||'ALL';pageContent.innerHTML=renderCases();applyRoleUI();const search=document.getElementById('caseSearch');const filter=document.getElementById('statusFilter');search.value=s;filter.value=f;search.focus();search.setSelectionRange(s.length,s.length);}});
  const translationObserver=new MutationObserver(()=>applyTranslations());translationObserver.observe(document.getElementById('pageContent'),{childList:true,subtree:true});
  const savedTheme=(()=>{try{return localStorage.getItem('refugeeledger-theme')==='dark'?'dark':'light';}catch(_){return 'light';}})();document.documentElement.dataset.theme=savedTheme;document.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===savedTheme)));
  document.getElementById('officerLogout')?.addEventListener('click',()=>{sessionStorage.removeItem('refugeeledger-session');sessionStorage.removeItem('refugeeledger-officer-profile');window.location.replace('/officer-login.html');});
  (async function bootstrapOfficerPortal(){
    const token = getToken();
    if (!token) { window.location.replace('/officer-login.html'); return; }
    try {
      const response = await fetch('/api/officer/me', {headers:{Authorization:`Bearer ${token}`}});
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !data.success) throw new Error(data.message || 'Akses petugas ditolak.');
      officerProfile = data;
      applyAccessibilityPreferences();
      sessionStorage.setItem('refugeeledger-officer-profile', JSON.stringify(data));
      await refreshCases();
      await refreshSettings();
      document.body.style.visibility = 'visible';
      render();
      await loadNotifications();
      setInterval(loadNotifications, 30000);
      if(emergencyMode && readEmergencyDraft() && !activeEmergencyAssignment()){restoringEmergencyDraft=true;newCaseModal();restoringEmergencyDraft=false;}
    } catch (_) {
      sessionStorage.removeItem('refugeeledger-session');
      sessionStorage.removeItem('refugeeledger-officer-profile');
      window.location.replace('/officer-login.html?denied=1');
    }
  })();
})();
