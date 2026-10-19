(() => {
  const root = document.documentElement;
  const themeButtons = [...document.querySelectorAll('[data-theme-choice]')];
  const message = document.getElementById('pageMessage');
  const uploadForm = document.getElementById('uploadForm');
  const uploadMessage = document.getElementById('uploadMessage');
  const uploadButton = document.getElementById('uploadButton');
  const documentsList = document.getElementById('documentsList');
  const documentCount = document.getElementById('documentCount');

  const fingerprintDialog = document.getElementById('fingerprintDialog');
  const fingerprintVisual = document.getElementById('fingerprintVisual');
  const fingerprintStatus = document.getElementById('fingerprintStatus');
  const fingerprintProgress = document.querySelector('.fingerprint-progress');
  const fingerprintProgressFill = document.getElementById('fingerprintProgressFill');
  const fingerprintMessage = document.getElementById('fingerprintMessage');
  const startFingerprintButton = document.getElementById('startFingerprintButton');
  const continueFingerprintButton = document.getElementById('continueFingerprintButton');
  const retryFingerprintButton = document.getElementById('retryFingerprintButton');
  const cancelFingerprintButton = document.getElementById('cancelFingerprintButton');
  const closeFingerprintDialog = document.getElementById('closeFingerprintDialog');
  const simulateFailure = document.getElementById('simulateFailure');

  let session = null;
  let pendingAction = null;
  let scanTimer = null;
  let progressTimer = null;
  let verificationToken = null;
  let scanInProgress = false;

  function applyTheme(theme, persist = true) {
    const safe = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = safe;
    themeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === safe)));
    if (persist) { try { localStorage.setItem('refugeeledger-theme', safe); } catch (_) {} }
  }
  let theme = 'light';
  try { const stored = localStorage.getItem('refugeeledger-theme'); if (stored === 'light' || stored === 'dark') theme = stored; } catch (_) {}
  applyTheme(theme, false);
  themeButtons.forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));

  function endSession() { try { sessionStorage.removeItem('refugeeledger-session'); } catch (_) {} window.location.replace('/login.html'); }
  function showMessage(el, text, kind = 'error') {
    if (!el) return;
    el.textContent = text;
    el.className = `form-message show ${kind}`;
  }
  function clearMessage(el) { if (!el) return; el.textContent = ''; el.className = 'form-message'; }

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.message || `Permintaan gagal (${response.status}).`);
    return data;
  }

  function formatSize(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  const fileInput = document.getElementById('documentFileInput');
  const dropzone = document.getElementById('uploadDropzone');
  const uploadFileTitle = document.getElementById('uploadFileTitle');
  const uploadFileHint = document.getElementById('uploadFileHint');
  const filePreview = document.getElementById('filePreview');
  let filePreviewUrl = null;
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  function showSelectedFile(file) {
    if (!file) {
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
      filePreviewUrl = null;
      if (filePreview) { filePreview.hidden = true; filePreview.innerHTML = ''; }
      uploadFileTitle.textContent = 'Tarik file ke sini atau pilih dari perangkat';
      uploadFileHint.textContent = 'PDF, JPG, atau PNG · Maksimal 10 MB';
      dropzone?.classList.remove('has-file', 'file-error');
      return;
    }
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      showMessage(uploadMessage, 'Format file tidak didukung. Pilih PDF, JPG, atau PNG.', 'error');
      fileInput.value = '';
      showSelectedFile(null);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showMessage(uploadMessage, 'Ukuran file maksimal 10 MB.', 'error');
      fileInput.value = '';
      showSelectedFile(null);
      return;
    }
    clearMessage(uploadMessage);
    uploadFileTitle.textContent = file.name;
    uploadFileHint.textContent = `${formatSize(file.size)} · Siap diunggah`;
    dropzone?.classList.add('has-file');
    dropzone?.classList.remove('file-error');
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    filePreviewUrl = null;
    if (filePreview) {
      if (file.type === 'image/jpeg' || file.type === 'image/png') {
        filePreviewUrl = URL.createObjectURL(file);
        filePreview.innerHTML = `<img src="${filePreviewUrl}" alt="Pratinjau ${escapeHtml(file.name)}"><div><strong>${escapeHtml(file.name)}</strong><small>${formatSize(file.size)} · Pratinjau lokal, belum diunggah</small></div>`;
      } else {
        filePreview.innerHTML = `<span class="file-preview-icon" aria-hidden="true">PDF</span><div><strong>${escapeHtml(file.name)}</strong><small>${formatSize(file.size)} · PDF siap diunggah</small></div>`;
      }
      filePreview.hidden = false;
    }
  }
  fileInput?.addEventListener('change', () => showSelectedFile(fileInput.files?.[0] || null));
  if (dropzone && fileInput) {
    ['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove('dragging'); }));
    dropzone.addEventListener('drop', event => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      const transfer = new DataTransfer(); transfer.items.add(file); fileInput.files = transfer.files; showSelectedFile(file);
    });
  }

  async function loadDocuments() {
    documentsList.innerHTML = '<p class="muted-text">Memuat daftar dokumen…</p>';
    try {
      const data = await api('/api/documents');
      const docs = data.documents || [];
      const activeCount = docs.filter(doc => doc.status === 'ACTIVE').length;
      documentCount.textContent = `${activeCount} dokumen aktif`;
      if (!docs.length) {
        documentsList.innerHTML = '<p class="muted-text">Belum ada dokumen. Unggah dokumen pertama menggunakan formulir di atas.</p>';
        return;
      }
      documentsList.innerHTML = docs.map(doc => {
        const active = doc.status === 'ACTIVE';
        const statusLabel = active ? 'AKTIF' : 'MENUNGGU PENGHAPUSAN';
        const statusClass = active ? 'active' : 'pending';
        const date = doc.created_at ? new Date(doc.created_at).toLocaleString('id-ID') : 'Tanggal tidak tersedia';
        return `<article class="document-row"><div class="document-info"><h4>${escapeHtml(doc.title)}</h4><p>${escapeHtml(doc.document_type || 'Lainnya')} · ${escapeHtml(doc.original_filename)} · ${formatSize(Number(doc.file_size || 0))}<br>Disimpan: ${escapeHtml(date)}</p><span class="document-status ${statusClass}">${statusLabel}</span></div><div class="document-actions">${active ? `<button type="button" data-action="view" data-id="${escapeHtml(doc.id)}">Lihat</button><button type="button" data-action="download" data-id="${escapeHtml(doc.id)}">Unduh</button><button type="button" class="danger-action" data-action="delete" data-id="${escapeHtml(doc.id)}">Ajukan hapus</button>` : ''}</div></article>`;
      }).join('');
    } catch (error) {
      documentCount.textContent = 'Belum dapat dimuat';
      documentsList.innerHTML = `<p class="muted-text">${escapeHtml(error.message)} Pastikan SQL dan bucket Supabase pada README tahap ini sudah diterapkan.</p>`;
    }
  }

  function resetFingerprintDialog() {
    stopScanTimers();
    scanInProgress = false;
    verificationToken = null;
    fingerprintVisual.dataset.state = 'idle';
    fingerprintStatus.textContent = 'Siap memulai simulasi.';
    fingerprintProgressFill.style.width = '0%';
    fingerprintProgress.setAttribute('aria-valuenow', '0');
    startFingerprintButton.hidden = false;
    startFingerprintButton.disabled = false;
    continueFingerprintButton.hidden = true;
    continueFingerprintButton.disabled = false;
    retryFingerprintButton.hidden = true;
    cancelFingerprintButton.disabled = false;
    closeFingerprintDialog.disabled = false;
    simulateFailure.disabled = false;
    clearMessage(fingerprintMessage);
  }

  function stopScanTimers() {
    if (scanTimer) window.clearTimeout(scanTimer);
    if (progressTimer) window.clearInterval(progressTimer);
    scanTimer = null;
    progressTimer = null;
  }

  function closeVerification() {
    stopScanTimers();
    scanInProgress = false;
    pendingAction = null;
    verificationToken = null;
    if (fingerprintDialog.open) fingerprintDialog.close();
  }

  function openVerification(documentId, action) {
    pendingAction = { documentId, action };
    resetFingerprintDialog();
    const actionLabels = { view: 'melihat dokumen', download: 'mengunduh dokumen', delete: 'mengajukan penghapusan dokumen' };
    fingerprintStatus.textContent = `Simulasi diperlukan sebelum ${actionLabels[action] || 'melanjutkan'}.`;
    if (!fingerprintDialog.open) fingerprintDialog.showModal();
  }

  async function startScan() {
    if (scanInProgress || !pendingAction) return;
    stopScanTimers();
    clearMessage(fingerprintMessage);
    scanInProgress = true;
    verificationToken = null;
    startFingerprintButton.hidden = true;
    retryFingerprintButton.hidden = true;
    continueFingerprintButton.hidden = true;
    cancelFingerprintButton.disabled = false;
    closeFingerprintDialog.disabled = false;
    simulateFailure.disabled = true;
    fingerprintVisual.dataset.state = 'scanning';
    fingerprintStatus.textContent = 'Memindai… simulasi sedang berjalan.';
    let progress = 0;
    fingerprintProgressFill.style.width = '0%';
    fingerprintProgress.setAttribute('aria-valuenow', '0');
    progressTimer = window.setInterval(() => {
      progress = Math.min(94, progress + Math.floor(Math.random() * 12) + 5);
      fingerprintProgressFill.style.width = `${progress}%`;
      fingerprintProgress.setAttribute('aria-valuenow', String(progress));
    }, 220);

    scanTimer = window.setTimeout(async () => {
      stopScanTimers();
      scanInProgress = false;
      if (simulateFailure.checked) {
        fingerprintVisual.dataset.state = 'failed';
        fingerprintProgressFill.style.width = '100%';
        fingerprintProgress.setAttribute('aria-valuenow', '100');
        fingerprintStatus.textContent = 'Simulasi gagal.';
        showMessage(fingerprintMessage, 'Hasil gagal ini sengaja dipicu untuk menguji alur demo. Tidak ada sidik jari yang dibaca.', 'error');
        retryFingerprintButton.hidden = false;
        simulateFailure.disabled = false;
        return;
      }
      try {
        const result = await api(`/api/documents/${encodeURIComponent(pendingAction.documentId)}/verify`, { method: 'POST' });
        verificationToken = result.verificationToken;
        fingerprintVisual.dataset.state = 'success';
        fingerprintProgressFill.style.width = '100%';
        fingerprintProgress.setAttribute('aria-valuenow', '100');
        fingerprintStatus.textContent = 'Simulasi berhasil.';
        showMessage(fingerprintMessage, 'Alur demo berhasil. Ini bukan verifikasi biometrik sungguhan.', 'success');
        continueFingerprintButton.hidden = false;
      } catch (error) {
        fingerprintVisual.dataset.state = 'failed';
        fingerprintStatus.textContent = 'Simulasi tidak dapat diselesaikan.';
        showMessage(fingerprintMessage, error.message, 'error');
        retryFingerprintButton.hidden = false;
      } finally {
        simulateFailure.disabled = false;
      }
    }, 2400);
  }

  async function continuePendingAction() {
    if (!pendingAction || !verificationToken) return;
    const { documentId, action } = pendingAction;
    const token = verificationToken;
    continueFingerprintButton.disabled = true;
    cancelFingerprintButton.disabled = true;
    closeFingerprintDialog.disabled = true;
    fingerprintStatus.textContent = 'Menyelesaikan permintaan…';
    clearMessage(fingerprintMessage);
    let openedWindow = null;
    try {
      if (action === 'view' || action === 'download') {
        // Open the tab synchronously from the click to reduce popup-blocker issues.
        openedWindow = window.open('about:blank', '_blank');
        const result = await api(`/api/documents/${encodeURIComponent(documentId)}/access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Demo-Verification': token },
          body: JSON.stringify({ mode: action })
        });
        if (openedWindow) openedWindow.location.replace(result.url);
        else window.location.assign(result.url);
        closeVerification();
      } else if (action === 'delete') {
        const result = await api(`/api/documents/${encodeURIComponent(documentId)}`, {
          method: 'DELETE', headers: { 'X-Demo-Verification': token }
        });
        closeVerification();
        showMessage(message, result.message, 'success');
        await loadDocuments();
      }
    } catch (error) {
      if (openedWindow && !openedWindow.closed) openedWindow.close();
      showMessage(message, error.message, 'error');
      closeVerification();
    } finally {
      continueFingerprintButton.disabled = false;
      cancelFingerprintButton.disabled = false;
      closeFingerprintDialog.disabled = false;
    }
  }

  documentsList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { id, action } = button.dataset;
    button.disabled = true;
    try {
      if (action === 'delete') {
        if (!window.confirm('Hapus dokumen ini secara permanen dari penyimpanan privat dan daftar dokumen Anda? Tindakan ini tidak dapat dibatalkan.')) return;
      }
      openVerification(id, action);
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  startFingerprintButton.addEventListener('click', startScan);
  continueFingerprintButton.addEventListener('click', continuePendingAction);
  retryFingerprintButton.addEventListener('click', () => {
    simulateFailure.checked = false;
    resetFingerprintDialog();
  });
  cancelFingerprintButton.addEventListener('click', closeVerification);
  closeFingerprintDialog.addEventListener('click', closeVerification);
  fingerprintDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeVerification();
  });
  fingerprintDialog.addEventListener('click', (event) => {
    if (event.target === fingerprintDialog) closeVerification();
  });

  uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(uploadForm);
    const file = formData.get('file');
    if (!file || !file.size) return showMessage(uploadMessage, 'Pilih file terlebih dahulu.');
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return showMessage(uploadMessage, 'Format file tidak didukung. Pilih PDF, JPG, atau PNG.');
    if (file.size > MAX_FILE_SIZE) return showMessage(uploadMessage, 'Ukuran file maksimal 10 MB.');
    uploadButton.disabled = true;
    uploadButton.textContent = 'Mengunggah…';
    try {
      const data = await api('/api/documents', { method: 'POST', body: formData });
      showMessage(uploadMessage, data.message, 'success');
      uploadForm.reset();
      showSelectedFile(null);
      await loadDocuments();
    } catch (error) {
      showMessage(uploadMessage, error.message, 'error');
    } finally {
      uploadButton.disabled = false;
      uploadButton.innerHTML = '<span aria-hidden="true">↥</span> Unggah dokumen';
    }
  });
  document.getElementById('refreshDocuments').addEventListener('click', loadDocuments);

  document.getElementById('logoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    endSession();
  });

  async function init() {
    try { session = JSON.parse(sessionStorage.getItem('refugeeledger-session') || 'null'); } catch (_) { session = null; }
    if (!session?.access_token) return endSession();
    try {
      const data = await api('/api/auth/me');
      const user = data.user;
      const fullName = String(user.userMetadata?.full_name || '').trim();
      document.getElementById('citizenName').textContent = fullName || (user.email || 'Warga').split('@')[0];
      const id = String(user.id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
      document.getElementById('citizenCode').textContent = id ? `RL-WRG-${id}` : 'RL-WRG-DEMO';
      document.getElementById('emailStatus').textContent = user.emailConfirmedAt ? 'Email aktif' : 'Belum aktif';
      showMessage(message, `Anda masuk sebagai ${user.email}.`, 'success');
      await loadDocuments();
    } catch (error) {
      showMessage(message, error.message || 'Sesi tidak valid.', 'error');
      endSession();
    }
  }
  init();
})();
