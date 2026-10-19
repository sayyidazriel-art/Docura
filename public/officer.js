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
  function emergencyDraftKey(){ const uid=officerProfile?.user?.id; return uid ? `refugeeledger-emergency-case-draft:${uid}` : null; }
  function readEmergencyDraft(){ const key=emergencyDraftKey(); if(!key)return null; try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;} }
  function saveEmergencyDraft(values){ const key=emergencyDraftKey(); if(!key)return; try{localStorage.setItem(key,JSON.stringify({...values,savedAt:new Date().toISOString()}));}catch(_){showToast('Draft tidak dapat disimpan di browser ini.');} }
  function clearEmergencyDraft(){ const key=emergencyDraftKey(); if(key){try{localStorage.removeItem(key);}catch(_){}} }
  const PERMISSIONS = {
    admin: ['new-case','face-scan','move-review','edit-note','cancel-case','approve','reject','print-pending','complete','open-case','view-cases','view-qr','emergency-toggle'],
    recovery_officer: ['new-case','face-scan','move-review','edit-note','cancel-case','open-case','view-cases','view-qr'],
    document_printer: ['print-pending','complete','open-case','view-cases','view-qr'],
    supervisor: ['approve','reject','edit-note','cancel-case','open-case','view-cases','view-qr']
  };
  const OPERATIONAL_ACTIONS = ['new-case','face-scan','move-review','edit-note','cancel-case','approve','reject','print-pending','complete','open-case','view-cases'];
  const ROLE_CONFIG = {
    admin: { title: 'Administrator Dashboard', subtitle: 'Pemantauan sistem dan seluruh alur petugas', navCases: 'Semua kasus', navWorkflow: 'Alur sistem', eyebrow: 'ADMINISTRATOR', description: 'Pantau gambaran alur pemulihan dan status kasus demonstrasi.' },
    recovery_officer: { title: 'Dashboard Pemulihan', subtitle: 'Workspace petugas pemulihan dokumen', navCases: 'Kasus pemulihan', navWorkflow: 'Alur verifikasi', eyebrow: 'PETUGAS PEMULIHAN', description: 'Daftarkan kasus demo, lakukan simulasi pemeriksaan identitas, dan teruskan untuk tinjauan.' },
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
      return `${head(cfg.eyebrow,cfg.title,cfg.description)}<div class="stat-grid">${statCard('Total kasus demo',cases.length,'Seluruh data contoh','▤')}${statCard('Kasus aktif',active.length,'Belum ditutup','◷')}${statCard('Menunggu keputusan',review.length,'Status tinjauan dokumen','✓')}${statCard('Selesai',completed.length,'Status selesai pada demo','✓')}</div><div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Pemantauan kasus terbaru</h2><p>Data kasus bersama yang tersimpan di Supabase.</p></div><button class="text-btn" data-action="view-cases">Lihat semua →</button></div>${roleQueue(active,'Tidak ada kasus aktif.')}</section><section class="panel"><div class="panel-head"><div><h2>Registry peran sistem</h2><p>Jenis role yang dikenali portal petugas.</p></div></div><div class="steps">${[['Administrator','Pengelolaan dan pemantauan sistem'],['Petugas Pemulihan','Registrasi kasus dan simulasi identitas'],['Pencetak Dokumen','Antrean cetak dan penyelesaian'],['Pengawas','Keputusan dan pengawasan kasus']].map((x,i)=>`<div class="step"><span class="step-num">${i+1}</span><div><strong>${x[0]}</strong><p>${x[1]}</p></div></div>`).join('')}</div><div class="face-demo-note">Registry ini menjelaskan jenis role yang tersedia; pengelolaan akun/role belum menjadi fitur CRUD pada tahap ini.</div></section></div>`;
    }
    if(role==='document_printer'){
      return `${head(cfg.eyebrow,cfg.title,cfg.description)}<div class="stat-grid">${statCard('Antrean siap diproses',printQueue.length,'Disetujui atau menunggu cetak','▤')}${statCard('Menunggu pencetakan',cases.filter(c=>c.status==='APPROVED').length,'Perlu ditandai masuk antrean cetak','◷')}${statCard('Dalam antrean cetak',cases.filter(c=>c.status==='PRINT_PENDING').length,'Siap ditandai selesai','✓')}${statCard('Selesai',completed.length,'Kasus yang ditutup','✓')}</div><section class="panel"><div class="panel-head"><div><h2>Antrean pencetakan</h2><p>Buka detail untuk memperbarui status cetak sesuai kewenangan.</p></div><button class="text-btn" data-action="view-cases">Lihat antrean →</button></div>${roleQueue(printQueue,'Belum ada kasus yang disetujui untuk pencetakan. Antrean akan muncul setelah pengawas menyetujui kasus.')}</section>`;
    }
    if(role==='supervisor'){
      return `${head(cfg.eyebrow,cfg.title,cfg.description)}<div class="stat-grid">${statCard('Menunggu keputusan',review.length,'Kasus tinjauan dokumen','◷')}${statCard('Kasus aktif',active.length,'Dalam proses','▤')}${statCard('Disetujui',cases.filter(c=>['APPROVED','PRINT_PENDING','COMPLETED'].includes(c.status)).length,'Lanjut ke proses berikutnya','✓')}${statCard('Emergency Mode',emergencyMode?'AKTIF':'NONAKTIF','Status simulasi','⚠')}</div><section class="panel"><div class="panel-head"><div><h2>Prioritas peninjauan</h2><p>Kasus berstatus tinjauan dokumen membutuhkan keputusan.</p></div><button class="text-btn" data-action="view-cases">Semua kasus →</button></div>${roleQueue(review,'Tidak ada kasus yang menunggu keputusan saat ini.')}</section>`;
    }
    return `${head(cfg.eyebrow,cfg.title,cfg.description,canCreateCase?`<button class="btn btn-primary" data-action="new-case">＋ Buat kasus</button>`:'')}<div class="stat-grid">${statCard('Kasus aktif',active.length,'Belum selesai','▤')}${statCard('Perlu diperiksa',cases.filter(c=>['OPEN','IDENTITY_CHECK'].includes(c.status)).length,'Pemeriksaan identitas','◷')}${statCard('Tinjauan dokumen',review.length,'Menunggu pengawas','✓')}${statCard('Emergency Mode',emergencyMode?'AKTIF':'NONAKTIF','Status simulasi','⚠')}</div><div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Kasus pemulihan terbaru</h2><p>Prioritaskan registrasi dan pemeriksaan identitas.</p></div><button class="text-btn" data-action="view-cases">Semua kasus →</button></div>${roleQueue(active,'Tidak ada kasus aktif.')}</section><section class="panel"><div class="panel-head"><div><h2>Tugas utama</h2></div></div><div class="steps"><div class="step"><span class="step-num">1</span><div><strong>Buat atau buka kasus</strong><p>Gunakan data sintetis untuk demonstrasi.</p></div></div><div class="step"><span class="step-num">2</span><div><strong>Simulasi pemeriksaan identitas</strong><p>Simulasi tidak menggunakan kamera atau memverifikasi identitas sungguhan.</p></div></div><div class="step"><span class="step-num">3</span><div><strong>Teruskan ke tinjauan dokumen</strong><p>Kasus berikutnya diproses oleh pengawas.</p></div></div></div></section></div>`;
  }
  function renderOverview(){const active=cases.filter(c=>!['COMPLETED','CANCELLED','REJECTED'].includes(c.status));const pending=cases.filter(c=>['OPEN','IDENTITY_CHECK','DOCUMENT_REVIEW'].includes(c.status));const approved=cases.filter(c=>['APPROVED','PRINT_PENDING','COMPLETED'].includes(c.status));return `${head('DASHBOARD PETUGAS','Ringkasan pemulihan','Pantau kasus dan lanjutkan pemeriksaan dokumen warga.',`<button class="btn btn-primary" data-action="new-case">＋ Buat kasus</button>`)}
    <div class="stat-grid"><article class="stat-card"><div class="stat-top">Kasus aktif <span class="stat-icon">▤</span></div><div class="stat-value">${active.length}</div><div class="stat-note">Belum selesai atau dibatalkan</div></article><article class="stat-card"><div class="stat-top">Perlu ditinjau <span class="stat-icon">◷</span></div><div class="stat-value">${pending.length}</div><div class="stat-note">Identitas atau dokumen</div></article><article class="stat-card"><div class="stat-top">Disetujui / proses lanjut <span class="stat-icon">✓</span></div><div class="stat-value">${approved.length}</div><div class="stat-note">Termasuk antrean cetak dan selesai</div></article><article class="stat-card"><div class="stat-top">Emergency Mode <span class="stat-icon">⚠</span></div><div class="stat-value" style="font-size:22px">${emergencyMode?'AKTIF':'NONAKTIF'}</div><div class="stat-note">Status bersama tersimpan di Supabase</div></article></div>
    <div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Kasus yang perlu perhatian</h2><p>Prioritaskan kasus yang belum selesai.</p></div><button class="text-btn" data-action="view-cases">Semua kasus →</button></div><div class="case-list">${active.length?active.slice(0,4).map(c=>caseRow(c)).join(''):'<div class="empty-state">Tidak ada kasus aktif.</div>'}</div></section><section class="panel"><div class="panel-head"><div><h2>Alur kerja petugas</h2><p>Urutan dasar dalam demonstrasi.</p></div></div><div class="steps"><div class="step"><span class="step-num">1</span><div><strong>Buka atau buat kasus</strong><p>Pastikan kasus berkaitan dengan pemulihan pascabencana.</p></div></div><div class="step"><span class="step-num">2</span><div><strong>Simulasi pemeriksaan identitas</strong><p>Animasi wajah hanya demonstrasi, bukan verifikasi nyata.</p></div></div><div class="step"><span class="step-num">3</span><div><strong>Tinjau dokumen pendukung</strong><p>Catat hasil pemeriksaan dan pilih keputusan.</p></div></div><div class="step"><span class="step-num">4</span><div><strong>Catat hasil kasus</strong><p>Perubahan status disimpan terpusat di Supabase dan dicatat pada audit log.</p></div></div></div></section></div>`;}
  function renderCases(){const search=(document.getElementById('caseSearch')?.value||'').toLowerCase();const filter=document.getElementById('statusFilter')?.value||'ALL';const role=officerProfile?.role||'recovery_officer';const cfg=roleConfig();const roleCases=role==='document_printer'?cases.filter(c=>['APPROVED','PRINT_PENDING'].includes(c.status)):role==='supervisor'?cases.filter(c=>['DOCUMENT_REVIEW','APPROVED','REJECTED'].includes(c.status)):cases;const filtered=roleCases.filter(c=>(filter==='ALL'||c.status===filter)&&[c.id,c.citizenName,c.citizenCode,c.location,c.disaster].some(v=>v.toLowerCase().includes(search)));const createButton=(role==='recovery_officer' || (emergencyMode && ['admin','document_printer','supervisor'].includes(role))) && !activeEmergencyAssignment()?`<button class="btn btn-primary" data-action="new-case">＋ Buat kasus</button>`:'';return `${head('WORKSPACE',cfg.navCases,cfg.description,createButton)}<div class="toolbar"><input id="caseSearch" class="field" placeholder="Cari nama, kode warga, lokasi…" value="${esc(search)}" aria-label="Cari kasus"><select id="statusFilter" class="field" aria-label="Filter status"><option value="ALL">Semua status</option>${Object.entries(statusInfo).map(([key,x])=>`<option value="${key}" ${filter===key?'selected':''}>${x.label}</option>`).join('')}</select></div><div class="table-wrap"><table class="data-table"><thead><tr><th>ID kasus / warga</th><th>Lokasi bencana</th><th>Tanggal dibuat</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${filtered.length?filtered.map(c=>`<tr><td><strong>${esc(c.id)}</strong><small>${esc(c.citizenName)} · ${esc(c.citizenCode)}</small></td><td>${esc(c.location)}<small>${esc(c.disaster)}</small></td><td>${dateText(c.createdAt)}</td><td>${badge(c.status)}</td><td><div class="table-actions"><button class="small-btn" data-action="open-case" data-id="${esc(c.id)}">Detail</button>${!['COMPLETED','CANCELLED','REJECTED'].includes(c.status)?`<button class="small-btn" data-action="cancel-case" data-id="${esc(c.id)}">Batalkan</button>`:''}</div></td></tr>`).join(''):`<tr><td colspan="5"><div class="empty-state">Tidak ada kasus yang cocok.</div></td></tr>`}</tbody></table></div>`;}
  function renderCaseDetail(c){const stepMap={OPEN:1,IDENTITY_CHECK:2,DOCUMENT_REVIEW:3,APPROVED:4,REJECTED:4,PRINT_PENDING:4,COMPLETED:5,CANCELLED:5};const progress=(stepMap[c.status]||1)*20;return `${head('DETAIL KASUS',esc(c.id),`Kasus pemulihan untuk ${esc(c.citizenName)}.`, `<button class="btn btn-secondary" data-action="view-cases">← Kembali ke kasus</button>`)}<div class="case-detail-grid"><section class="panel"><div class="detail-title"><div><h2>${esc(c.citizenName)}</h2><p>${esc(c.citizenCode)} · Dibuat ${dateText(c.createdAt)}</p></div>${badge(c.status)}</div><div class="progress-track"><span style="width:${progress}%"></span></div><div class="stat-note">Tahap alur demo: ${progress}%</div><div class="detail-fields"><div class="detail-field"><span>Lokasi terdampak</span><strong>${esc(c.location)}</strong></div><div class="detail-field"><span>Jenis bencana</span><strong>${esc(c.disaster)}</strong></div><div class="detail-field"><span>Pemeriksaan identitas</span><strong>${c.identityChecked?'Simulasi selesai':'Belum diselesaikan'}</strong></div><div class="detail-field"><span>Jumlah dokumen pendukung</span><strong>${c.documents.length} dokumen demo</strong></div></div><h3 class="section-title">Dokumen pendukung</h3>${c.documents.map((doc,i)=>`<div class="document-item"><span class="doc-icon">PDF</span><div class="doc-info"><strong>${esc(doc)}</strong><small>Dokumen sintetis · Item ${i+1}</small></div><span class="checkmark">✓</span></div>`).join('')}<h3 class="section-title">Catatan kasus</h3><p style="font-size:12px;color:var(--muted)">${esc(c.note||'Belum ada catatan awal.')}</p>${c.reviewNote?`<div class="detail-field"><span>Catatan keputusan</span><strong>${esc(c.reviewNote)}</strong></div>`:''}</section><aside class="panel"><div class="panel-head"><div><h2>Tindakan petugas</h2><p>Pilih langkah sesuai status kasus.</p></div></div><div class="action-stack">${!c.identityChecked&&!['REJECTED','CANCELLED','COMPLETED'].includes(c.status)?`<button class="btn btn-primary" data-action="face-scan" data-id="${esc(c.id)}">◎ Mulai simulasi pemindaian wajah</button>`:''}${c.identityChecked&&['IDENTITY_CHECK','OPEN'].includes(c.status)?`<button class="btn btn-primary" data-action="move-review" data-id="${esc(c.id)}">Lanjut ke tinjauan dokumen →</button>`:''}${c.status==='DOCUMENT_REVIEW'?`<button class="btn btn-success" data-action="approve" data-id="${esc(c.id)}">✓ Setujui kasus demo</button><button class="btn btn-danger" data-action="reject" data-id="${esc(c.id)}">Tolak kasus demo</button>`:''}${c.status==='APPROVED'?(readQrReceipt(c.id)?`<button class="btn btn-secondary" data-action="view-qr" data-id="${esc(c.id)}">▦ Lihat QR kembali</button>`:'')+`<button class="btn btn-primary" data-action="print-pending" data-id="${esc(c.id)}">Tandai menunggu cetak</button>`:''}${c.status==='PRINT_PENDING'?`<button class="btn btn-success" data-action="complete" data-id="${esc(c.id)}">Tandai selesai</button>`:''}${!['REJECTED','CANCELLED','COMPLETED'].includes(c.status)?`<button class="btn btn-secondary" data-action="cancel-case" data-id="${esc(c.id)}">Batalkan kasus</button>`:''}<button class="btn btn-secondary" data-action="edit-note" data-id="${esc(c.id)}">Edit catatan petugas</button></div><div class="face-demo-note">Pemindaian wajah pada halaman ini hanya animasi demo. Tidak menggunakan kamera, tidak menganalisis wajah, dan bukan bukti identitas.</div></aside></div>`;}
  function renderWorkflow(){return `${head('PANDUAN OPERASIONAL','Alur verifikasi','Gambaran status kasus yang dipakai dalam demo Stage 7.')}<div class="panel"><div class="steps">${[['OPEN','Kasus terbuka','Kasus dibuat dan menunggu pemeriksaan.'],['IDENTITY_CHECK','Pemeriksaan identitas','Petugas menjalankan simulasi pemindaian wajah.'],['DOCUMENT_REVIEW','Tinjauan dokumen','Petugas meninjau daftar dokumen demo dan mencatat keputusan.'],['APPROVED / REJECTED','Keputusan','Kasus disetujui atau ditolak pada simulasi.'],['PRINT_PENDING','Menunggu cetak','Tahap berikutnya untuk demonstrasi alur pencetakan.'],['COMPLETED / CANCELLED','Penutupan kasus','Kasus selesai atau dibatalkan.']].map((s,i)=>`<div class="step"><span class="step-num">${i+1}</span><div><strong>${s[1]} <span class="badge">${s[0]}</span></strong><p>${s[2]}</p></div></div>`).join('')}</div></div>`;}
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
  function render(){configureRoleShell();updateShell();const cfg=roleConfig();const names={overview:cfg.title,cases:cfg.navCases,workflow:cfg.navWorkflow,detail:'Detail kasus'};document.getElementById('crumbTitle').textContent=names[currentView]||cfg.title;document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===currentView));if(currentView==='overview')pageContent.innerHTML=renderRoleOverview();else if(currentView==='cases')pageContent.innerHTML=renderCases();else if(currentView==='workflow')pageContent.innerHTML=renderWorkflow();else {const c=cases.find(x=>x.id===selectedCaseId);if(c)pageContent.innerHTML=renderCaseDetail(c);else{currentView='cases';pageContent.innerHTML=renderCases();}}if(['overview','cases'].includes(currentView))pageContent.insertAdjacentHTML('afterbegin',emergencyAssignedPanel());applyRoleUI();}
  function openModal(html, options={}){clearInterval(scanTimer);activeModalLocked=Boolean(options.locked);modalBody.innerHTML=html;modalBackdrop.hidden=false;document.body.style.overflow='hidden';const closeButton=document.getElementById('modalClose');if(closeButton)closeButton.hidden=false;}
  function closeModal(force=false){if(activeModalLocked&&!force){showToast('Popup darurat dikunci agar tidak tertutup tanpa sengaja. Gunakan “Simpan draft & tutup” jika ingin melanjutkan nanti.');return false;}clearInterval(scanTimer);modalBackdrop.hidden=true;modalBody.innerHTML='';document.body.style.overflow='';activeModalLocked=false;return true;}
  function saveDraftFromForm(){const form=document.getElementById('newCaseForm');if(!form)return;const values={citizenName:form.elements.citizenName.value.trim(),citizenCode:form.elements.citizenCode.value.trim(),location:form.elements.location.value.trim(),disaster:form.elements.disaster.value,note:form.elements.caseNote.value.trim()};if(values.citizenName||values.citizenCode||values.location||values.note){saveEmergencyDraft(values);}else{clearEmergencyDraft();}}
  function newCaseModal(){
    if(emergencyMode && activeEmergencyAssignment()){showToast('Selesaikan kasus darurat yang sedang Anda tangani sebelum membuat kasus baru.');return;}
    const draft=emergencyMode?readEmergencyDraft():null;
    const locked=Boolean(emergencyMode);
    const html=`<div class="emergency-modal-heading"><span class="badge amber">${locked?'EMERGENCY MODE · POPUP TERKUNCI':'FORM KASUS'}</span><h2 id="modalTitle">Buat kasus pemulihan</h2></div><p>Masukkan data sintetis untuk alur demonstrasi. Jangan masukkan data pribadi sungguhan.</p>${locked?'<div class="face-demo-note">Popup darurat tidak tertutup karena klik di luar atau tombol Escape. Tombol × di pojok atas akan menyimpan draft sebelum menutup.</div>':''}<form id="newCaseForm" novalidate><label class="form-label" for="citizenName">Nama warga demo *</label><input class="form-input" id="citizenName" name="citizenName" required minlength="2" maxlength="100" placeholder="Contoh: Warga Demo 004"><label class="form-label" for="citizenCode">Kode warga *</label><input class="form-input" id="citizenCode" name="citizenCode" required maxlength="40" placeholder="RFL-DEMO-004"><label class="form-label" for="location">Lokasi terdampak *</label><input class="form-input" id="location" name="location" required maxlength="100" placeholder="Desa Contoh"><label class="form-label" for="disaster">Jenis bencana *</label><select class="form-input" id="disaster" name="disaster"><option>Banjir</option><option>Gempa bumi</option><option>Longsor</option><option>Kebakaran</option><option>Bencana lain</option></select><label class="form-label" for="caseNote">Catatan awal</label><textarea class="form-input" id="caseNote" name="caseNote" maxlength="500" rows="3" placeholder="Ringkasan kebutuhan pemulihan"></textarea><div class="modal-actions">${locked?'<button class="btn btn-secondary" type="button" id="saveDraftClose">Simpan draft & tutup</button>':'<button class="btn btn-secondary" type="button" data-action="close-modal">Batal</button>'}<button class="btn btn-primary" type="submit">Simpan dan buat kasus</button></div></form>`;
    openModal(html,{locked});
    const form=document.getElementById('newCaseForm');
    if(draft){form.elements.citizenName.value=draft.citizenName||'';form.elements.citizenCode.value=draft.citizenCode||'';form.elements.location.value=draft.location||'';form.elements.disaster.value=draft.disaster||'Banjir';form.elements.caseNote.value=draft.note||'';}
    if(locked){form.addEventListener('input',saveDraftFromForm);form.addEventListener('change',saveDraftFromForm);document.getElementById('saveDraftClose').addEventListener('click',()=>{saveDraftFromForm();const hasDraft=Boolean(readEmergencyDraft());closeModal(true);render();showToast(hasDraft?'Draft tersimpan. Gunakan tombol “Lanjutkan draft tersimpan” untuk meneruskan.':'Popup ditutup tanpa menyimpan draft kosong.');});}
  }
  function openFaceScan(id){const c=cases.find(x=>x.id===id);if(!c)return;selectedCaseId=id;openModal(`<h2 id="modalTitle">Simulasi pemindaian wajah</h2><p>Kasus ${esc(c.id)} · ${esc(c.citizenName)}</p><div class="face-visual" id="faceVisual"><div class="face-outline">◎</div><div class="face-scan-line"></div><div class="face-caption" id="faceCaption">SIAP MEMULAI SIMULASI</div></div><div class="progress-track"><span id="faceProgress" style="width:0%"></span></div><p id="faceStatus">Tekan mulai untuk menjalankan animasi simulasi.</p><label style="display:flex;gap:9px;align-items:center;font-size:12px"><input type="checkbox" id="forceFaceFail"> Uji skenario gagal (demo)</label><div class="face-demo-note">Tidak ada akses kamera atau analisis wajah. Hasil ini hanya mengubah status demo pada browser.</div><div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">Batal</button><button class="btn btn-primary" id="startFaceScan">Mulai simulasi</button></div>`);}
  async function continueAfterFaceScan(){
    if(!selectedCaseId)return;
    try { await mutateCase('face-scan', selectedCaseId); closeModal(); currentView='detail'; render(); showToast('Simulasi selesai; hasil tercatat di server.'); }
    catch(error){ showToast(error.message); }
  }
  function startFaceScan(){
    const btn=document.getElementById('startFaceScan');
    const visual=document.getElementById('faceVisual');
    const progress=document.getElementById('faceProgress');
    const status=document.getElementById('faceStatus');
    const caption=document.getElementById('faceCaption');
    const fail=document.getElementById('forceFaceFail')?.checked;
    if(!btn||!visual||!progress||!status||!caption)return;
    clearInterval(scanTimer);
    btn.disabled=true;
    btn.dataset.scanState='scanning';
    btn.textContent='Memindai…';
    progress.style.width='0%';
    visual.classList.add('scanning');
    caption.textContent='SIMULASI PEMINDAIAN BERJALAN';
    status.textContent='Menjalankan animasi pemindaian…';
    let n=0;
    scanTimer=setInterval(()=>{
      n+=10;
      progress.style.width=n+'%';
      if(n>=100){
        clearInterval(scanTimer);
        visual.classList.remove('scanning');
        btn.disabled=false;
        if(fail){
          caption.textContent='SIMULASI GAGAL';
          status.textContent='Skenario gagal demo dipilih. Coba lagi atau tutup modal.';
          btn.textContent='Coba lagi';
          btn.dataset.scanState='retry';
        }else{
          caption.textContent='SIMULASI SELESAI';
          status.textContent='Simulasi berhasil. Ini bukan verifikasi identitas nyata.';
          btn.textContent='Lanjutkan ke tinjauan';
          btn.dataset.scanState='continue';
        }
      }
    },180);
  }
  function qrStorageKey(caseId){ return `docura-active-qr:${caseId}`; }
  function readQrReceipt(caseId){
    try {
      const key=qrStorageKey(caseId); const receipt=JSON.parse(localStorage.getItem(key)||'null');
      if(!receipt || !receipt.token || !receipt.expiresAt || new Date(receipt.expiresAt).getTime()<=Date.now()) { localStorage.removeItem(key); return null; }
      return receipt;
    } catch (_) { return null; }
  }
  function clearQrReceipt(caseId){ try{sessionStorage.removeItem(qrStorageKey(caseId));}catch(_){} }
  async function showQrReceipt(caseId, citizenName, receipt, reopened=false){
    if(!receipt || new Date(receipt.expiresAt).getTime()<=Date.now()){clearQrReceipt(caseId);showToast('QR sudah kedaluwarsa. Minta petugas berwenang menerbitkan QR baru.');return;}
    const token=receipt.token; const expiresAt=receipt.expiresAt;
    let image = '';
    try { const data = await officerApi('/api/officer/qr/render', {method:'POST', body:JSON.stringify({token})}); image = `<img class="qr-image" src="${data.dataUrl}" alt="QR Code pemulihan ${esc(caseId)}">`; }
    catch (_) { image = '<p>QR visual gagal dibuat. Token tetap tersedia di bawah untuk pengujian.</p>'; }
    openModal(`<h2 id="modalTitle">QR pemulihan ${reopened?'tersimpan':'diterbitkan'}</h2><p>Kasus ${esc(caseId)} · ${esc(citizenName)}</p><div class="qr-display">${image}<p>QR berlaku sampai <strong>${new Date(expiresAt).toLocaleString('id-ID')}</strong>.</p><label class="form-label" for="qrTokenValue">Token demo (untuk simulasi pemindaian)</label><input id="qrTokenValue" class="form-input" readonly value="${esc(token)}"><button class="btn btn-secondary" id="copyQrToken" type="button">Salin token</button><div class="face-demo-note">QR dapat dibuka kembali dari detail kasus selama belum digunakan dan belum kedaluwarsa. Verifikasi yang gagal tidak menghapus QR. Jangan bagikan token kepada pihak lain.</div><div class="modal-actions"><button class="btn btn-primary" data-action="close-modal">Tutup</button></div></div>`);
    document.getElementById('copyQrToken')?.addEventListener('click', async()=>{try{await navigator.clipboard.writeText(token);showToast('Token disalin.');}catch(_){document.getElementById('qrTokenValue')?.select();showToast('Pilih dan salin token secara manual.');}});
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
    const scanBtn=e.target.closest('#startFaceScan');
    if(scanBtn){
      if(scanBtn.dataset.scanState==='continue')continueAfterFaceScan();
      else startFaceScan();
      return;
    }
    const actionBtn=e.target.closest('[data-action]');
    if(actionBtn){doAction(actionBtn.dataset.action,actionBtn.dataset.id);return;}
    const nav=e.target.closest('[data-view]');
    if(nav){currentView=nav.dataset.view;selectedCaseId=null;render();document.getElementById('sidebar').classList.remove('open');}
  });
  document.getElementById('emergencyToggle').addEventListener('click',async()=>{try{await authorizeAction('emergency-toggle');await setEmergency();}catch(error){showToast(error.message);}});
  document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>{const t=b.dataset.theme;document.documentElement.dataset.theme=t;document.querySelectorAll('[data-theme]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));try{localStorage.setItem('refugeeledger-theme',t);}catch(_){}}));
  document.getElementById('mobileMenu').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('modalClose').addEventListener('click',()=>{if(activeModalLocked && document.getElementById('newCaseForm')){saveDraftFromForm();const hasDraft=Boolean(readEmergencyDraft());closeModal(true);render();showToast(hasDraft?'Draft darurat disimpan. Anda dapat melanjutkannya kembali dari dashboard.':'Popup ditutup. Belum ada data yang perlu disimpan.');return;}closeModal();});modalBackdrop.addEventListener('click',e=>{if(e.target===modalBackdrop)closeModal();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modalBackdrop.hidden)closeModal();});window.addEventListener('beforeunload',e=>{if(activeModalLocked){const form=document.getElementById('newCaseForm');if(form)saveDraftFromForm();e.preventDefault();e.returnValue='';}});
  document.addEventListener('submit',async e=>{if(e.target.id!=='newCaseForm')return;e.preventDefault();if(isCreatingCase)return;const f=e.target;const name=f.elements.citizenName.value.trim();const code=f.elements.citizenCode.value.trim();const location=f.elements.location.value.trim();if(name.length<2||name.length>100){showToast('Nama warga wajib diisi minimal 2 karakter dan maksimal 100 karakter.');f.elements.citizenName.focus();return;}if(!code||code.length>40){showToast('Kode warga wajib diisi dan maksimal 40 karakter.');f.elements.citizenCode.focus();return;}if(!location||location.length>100){showToast('Lokasi terdampak wajib diisi dan maksimal 100 karakter.');f.elements.location.focus();return;}if(emergencyMode&&activeEmergencyAssignment()){showToast('Selesaikan kasus darurat yang sedang Anda tangani sebelum membuat kasus baru.');return;}isCreatingCase=true;const submitButton=f.querySelector('button[type="submit"]');if(submitButton){submitButton.disabled=true;submitButton.textContent='Menyimpan kasus…';}try{await authorizeAction('new-case');if(emergencyMode)saveDraftFromForm();const result=await mutateCase('new-case',null,{citizenName:name,citizenCode:code,location,disaster:f.elements.disaster.value,note:f.elements.caseNote.value.trim()});const id=result?.case?.id||result?.id;if(!id)throw new Error('Kasus tersimpan, tetapi ID kasus tidak diterima. Muat ulang daftar kasus.');clearEmergencyDraft();closeModal(true);currentView='detail';selectedCaseId=id;render();showToast('Kasus berhasil dibuat dan disimpan di Supabase.');}catch(error){showToast(error.message);}finally{isCreatingCase=false;}});
  document.addEventListener('input',e=>{if(e.target.id==='caseSearch'||e.target.id==='statusFilter'){const s=document.getElementById('caseSearch')?.value||'';const f=document.getElementById('statusFilter')?.value||'ALL';pageContent.innerHTML=renderCases();applyRoleUI();const search=document.getElementById('caseSearch');const filter=document.getElementById('statusFilter');search.value=s;filter.value=f;search.focus();search.setSelectionRange(s.length,s.length);}});
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
      sessionStorage.setItem('refugeeledger-officer-profile', JSON.stringify(data));
      await refreshCases();
      await refreshSettings();
      document.body.style.visibility = 'visible';
      render();
      if(emergencyMode && readEmergencyDraft() && !activeEmergencyAssignment()){restoringEmergencyDraft=true;newCaseModal();restoringEmergencyDraft=false;}
    } catch (_) {
      sessionStorage.removeItem('refugeeledger-session');
      sessionStorage.removeItem('refugeeledger-officer-profile');
      window.location.replace('/officer-login.html?denied=1');
    }
  })();
})();
