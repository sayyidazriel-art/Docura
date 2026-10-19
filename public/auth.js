(() => {
  const root = document.documentElement;
  const themeButtons = [...document.querySelectorAll('[data-theme-choice]')];
  const messageBox = document.getElementById('formMessage');
  const form = document.getElementById('loginForm') || document.getElementById('registerForm');
  const submitButton = document.getElementById('submitButton');
  const params = new URLSearchParams(window.location.search);

  function applyTheme(theme, persist = true) {
    const safe = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = safe;
    themeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === safe)));
    if (persist) { try { localStorage.setItem('refugeeledger-theme', safe); } catch (_) {} }
  }
  let theme = 'light';
  try { const stored = localStorage.getItem('refugeeledger-theme'); if (stored === 'dark' || stored === 'light') theme = stored; } catch (_) {}
  applyTheme(theme, false);
  themeButtons.forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));

  function showMessage(text, kind = 'error') {
    if (!messageBox) return;
    messageBox.textContent = text;
    messageBox.className = `form-message show ${kind}`;
  }
  function setBusy(busy, label) {
    if (!submitButton) return;
    submitButton.disabled = busy;
    submitButton.textContent = busy ? 'Memproses…' : label;
  }
  async function request(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.message || 'Permintaan gagal. Coba lagi.');
    return data;
  }
  function saveSession(session) {
    if (!session?.access_token) return;
    // Keep auth data in sessionStorage rather than long-lived localStorage for this prototype.
    sessionStorage.setItem('refugeeledger-session', JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at }));
  }

  if (params.get('activated') === '1') showMessage('Tautan email telah dibuka. Jika akun sudah aktif, silakan masuk.', 'success');
  if (params.get('reset') === '1') showMessage('Tautan pemulihan dibuka. Alur pengaturan kata sandi baru akan diaktifkan pada tahap berikutnya; jika belum selesai, kirim ulang permintaan pemulihan.', 'success');

  if (form?.id === 'registerForm') {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = form.elements.namedItem('name').value.trim();
      const email = form.elements.namedItem('email').value.trim();
      const password = form.elements.namedItem('password').value;
      const confirmPassword = form.elements.namedItem('confirmPassword').value;
      if (name.length < 2) return showMessage('Nama lengkap minimal 2 karakter.');
      if (password.length < 8) return showMessage('Kata sandi minimal 8 karakter.');
      if (password !== confirmPassword) return showMessage('Konfirmasi kata sandi tidak sama.');
      if (!document.getElementById('terms').checked) return showMessage('Centang pernyataan sebelum membuat akun.');
      setBusy(true, 'Buat Akun Warga →');
      try {
        const data = await request('/api/auth/register', { name, email, password });
        if (data.session) { saveSession(data.session); window.location.href = '/citizen.html'; return; }
        showMessage(data.message, 'success');
        form.reset();
      } catch (error) { showMessage(error.message); }
      finally { setBusy(false, 'Buat Akun Warga →'); }
    });
  }

  if (form?.id === 'loginForm') {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = form.elements.namedItem('email').value.trim();
      const password = form.elements.namedItem('password').value;
      if (!email || !password) return showMessage('Masukkan email dan kata sandi.');
      setBusy(true, 'Masuk ke Portal Warga →');
      try {
        const data = await request('/api/auth/login', { email, password });
        saveSession(data.session);
        window.location.href = '/citizen.html';
      } catch (error) { showMessage(error.message); }
      finally { setBusy(false, 'Masuk ke Portal Warga →'); }
    });
  }

  const forgot = document.getElementById('forgotLink');
  forgot?.addEventListener('click', async (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!email) { showMessage('Isi alamat email terlebih dahulu, lalu pilih Lupa kata sandi.'); return; }
    try { const data = await request('/api/auth/forgot-password', { email }); showMessage(data.message, 'success'); }
    catch (error) { showMessage(error.message); }
  });
  const resend = document.getElementById('resendLink');
  resend?.addEventListener('click', async (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!email) { showMessage('Isi alamat email terlebih dahulu untuk meminta ulang aktivasi.'); return; }
    try { const data = await request('/api/auth/resend-activation', { email }); showMessage(data.message, 'success'); }
    catch (error) { showMessage(error.message); }
  });
})();
