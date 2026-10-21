(() => {
  'use strict';
  if (document.getElementById('sharedAccessibilityTools')) return;
  const dictionary = {
    'Cara Kerja':'How It Works','Fitur':'Features','Keamanan':'Security','Masuk Warga':'Citizen Login','Portal Petugas':'Officer Portal','Mulai sebagai Warga':'Continue as Citizen','Pelajari cara kerja':'Learn how it works','Dokumen penting tetap terlindungi,':'Important documents stay protected,','bahkan setelah bencana.':'even after a disaster.','Persiapan dokumen untuk keadaan darurat':'Document readiness for emergencies','Akses berbasis kewenangan':'Authority-based access','Aktivitas penting tercatat':'Important actions are logged','Dokumen digital':'Digital documents','Proses terarah':'Guided process','Persiapan hari ini, perlindungan esok':'Prepare today, protect tomorrow','Dokumen penting Anda, lebih siap menghadapi keadaan darurat.':'Your important documents, better prepared for emergencies.','Portal Warga':'Citizen Portal','Pengaturan':'Settings','Keluar':'Log out','Memeriksa sesi akun…':'Checking account session…','DASHBOARD WARGA':'CITIZEN DASHBOARD','Simpan salinan digital dokumen penting Anda secara privat untuk membantu proses pemulihan setelah bencana.':'Privately store digital copies of important documents to support recovery after a disaster.','KODE WARGA DOCURA':'DOCURA CITIZEN CODE','Dokumen Saya':'My Documents','Kelola salinan digital yang Anda unggah ke penyimpanan privat.':'Manage digital copies uploaded to your private storage.','Keamanan Akun':'Account Security','Status email akun Anda.':'Your account email status.','Pemulihan Dokumen':'Document Recovery','Pilih cara pemulihan yang paling sesuai':'Choose the recovery option that suits you','Pemulihan mandiri dari rumah':'Self-recovery from home','Pemulihan langsung di kantor':'In-person recovery at an office','PANDUAN PEMULIHAN':'RECOVERY GUIDE','ARSIP PRIVAT':'PRIVATE ARCHIVE','Arsip dokumen pribadi':'Personal document archive','Unggah dokumen':'Upload document','Muat ulang':'Refresh','Pilih file':'Choose file','Nama dokumen':'Document name','Jenis dokumen':'Document type','Pilih file untuk diunggah':'Choose a file to upload','Tarik file ke sini atau pilih dari perangkat':'Drag a file here or choose from your device','Pengaturan akun':'Account settings','Informasi akun':'Account information','Simpan nama':'Save name','Ubah email':'Change email','Ubah kata sandi':'Change password','Kata sandi saat ini':'Current password','Kata sandi baru':'New password','Ulangi kata sandi baru':'Repeat new password','Perbarui kata sandi':'Update password','Passkey perangkat':'Device passkeys','Tambahkan passkey':'Add passkey','Selamat datang kembali':'Welcome back','Masuk menggunakan email dan kata sandi yang terhubung dengan akun Anda.':'Sign in with the email and password linked to your account.','Alamat email':'Email address','Kata sandi':'Password','Pastikan email Anda sudah diaktifkan.':'Make sure your email has been activated.','Lupa kata sandi?':'Forgot password?','Masuk ke Portal Warga →':'Sign in to Citizen Portal →','Belum memiliki akun?':'Do not have an account?','Daftar sebagai warga':'Register as a citizen','Kirim ulang email aktivasi':'Resend activation email','Perlindungan akun':'Account protection','Buat akun warga':'Create citizen account','Daftarkan akun dengan informasi dasar. Kami akan mengirimkan tautan aktivasi ke email Anda.':'Register with basic information. We will send an activation link to your email.','Nama lengkap':'Full name','Alamat email aktif':'Active email address','Buat kata sandi':'Create password','Konfirmasi kata sandi':'Confirm password','Buat Akun Warga →':'Create Citizen Account →','Sudah memiliki akun?':'Already have an account?','Masuk':'Sign in','Catatan privasi':'Privacy note','Aksesibilitas':'Accessibility','Bahasa antarmuka':'Interface language','Perkecil teks':'Decrease text size','Perbesar teks':'Increase text size','Kontras tinggi':'High contrast','Tema terang':'Light theme','Tema gelap':'Dark theme','Kembali ke beranda':'Back to home','Simpan salinan digital dokumen penting':'Store digital copies of important documents','Bukti pemulihan dokumen':'Document recovery receipt','Administrasi':'Administration','ID':'ID','EN':'EN'
  };
  const reverse = Object.fromEntries(Object.entries(dictionary).map(([id,en]) => [en,id]));
  let language = 'id';
  function applyText(root=document.body) {
    const map = language === 'en' ? dictionary : reverse;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const raw = node.nodeValue;
      const trimmed = raw.trim();
      if (map[trimmed]) node.nodeValue = raw.replace(trimmed, map[trimmed]);
    }
    root.querySelectorAll('[placeholder],[aria-label],[title]').forEach(el => {
      for (const attr of ['placeholder','aria-label','title']) {
        const val = el.getAttribute(attr);
        if (val && map[val]) el.setAttribute(attr, map[val]);
      }
    });
  }
  function preferences() {
    let scale=1, contrast=false;
    try { scale=Number(localStorage.getItem('docura-font-scale')||1); contrast=localStorage.getItem('docura-high-contrast')==='true'; language=localStorage.getItem('docura-language')==='en'?'en':'id'; } catch (_) {}
    scale=Math.max(.9,Math.min(1.25,scale||1));
    document.documentElement.style.setProperty('--access-scale',String(scale));
    document.documentElement.dataset.contrast=contrast?'high':'normal';
    document.documentElement.lang=language;
    const select=document.getElementById('sharedLanguageSelect'); if(select) select.value=language;
    const button=document.getElementById('sharedContrastToggle'); if(button) button.setAttribute('aria-pressed',String(contrast));
  }
  const tools=document.createElement('div');
  tools.id='sharedAccessibilityTools'; tools.className='shared-accessibility-tools'; tools.setAttribute('role','group'); tools.setAttribute('aria-label','Aksesibilitas');
  tools.innerHTML='<label class="shared-sr-only" for="sharedLanguageSelect">Bahasa antarmuka</label><select id="sharedLanguageSelect" aria-label="Bahasa antarmuka"><option value="id">ID</option><option value="en">EN</option></select><button id="sharedFontSmaller" type="button" aria-label="Perkecil teks" title="Perkecil teks">A−</button><button id="sharedFontLarger" type="button" aria-label="Perbesar teks" title="Perbesar teks">A+</button><button id="sharedContrastToggle" type="button" aria-label="Kontras tinggi" title="Kontras tinggi" aria-pressed="false">◐</button>';
  const target=document.querySelector('.portal-actions')||document.querySelector('.auth-topline')||document.querySelector('.main-nav')||document.querySelector('.nav-wrap');
  if (target) {
    const theme=target.querySelector('.theme-control');
    if (theme && theme.parentElement===target) target.insertBefore(tools,theme); else target.insertBefore(tools,target.firstChild);
  } else document.body.prepend(tools);
  document.getElementById('sharedLanguageSelect').addEventListener('change',e=>{language=e.target.value==='en'?'en':'id';try{localStorage.setItem('docura-language',language);}catch(_){}preferences();applyText();});
  function adjust(delta){let v=1;try{v=Number(localStorage.getItem('docura-font-scale')||1);}catch(_){}v=Math.max(.9,Math.min(1.25,Math.round((v+delta)*100)/100));try{localStorage.setItem('docura-font-scale',String(v));}catch(_){}preferences();}
  document.getElementById('sharedFontSmaller').addEventListener('click',()=>adjust(-.05));
  document.getElementById('sharedFontLarger').addEventListener('click',()=>adjust(.05));
  document.getElementById('sharedContrastToggle').addEventListener('click',()=>{const on=document.documentElement.dataset.contrast!=='high';try{localStorage.setItem('docura-high-contrast',String(on));}catch(_){}preferences();});
  preferences(); applyText();
  const observer=new MutationObserver(()=>applyText()); observer.observe(document.body,{childList:true,subtree:true});
})();
