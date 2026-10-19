(() => {
  const form = document.getElementById('officerLoginForm');
  const message = document.getElementById('formMessage');
  const submit = document.getElementById('submitButton');
  function show(text, kind='error') { message.textContent = text; message.className = `form-message show ${kind}`; }
  async function post(url, body, token) {
    const headers = {'Content-Type':'application/json'};
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, {method:'POST', headers, body:JSON.stringify(body)});
    const data = await response.json().catch(()=>({}));
    if (!response.ok || !data.success) throw new Error(data.message || 'Permintaan gagal.');
    return data;
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    if (!email || !password) return show('Masukkan email dan kata sandi.');
    submit.disabled = true; submit.textContent = 'Memverifikasi akun dan peran…';
    try {
      const login = await post('/api/auth/login', {email, password});
      const token = login.session?.access_token;
      if (!token) throw new Error('Sesi tidak tersedia. Pastikan akun dan email sudah aktif.');
      const profileResponse = await fetch('/api/officer/me', {headers:{Authorization:`Bearer ${token}`} });
      const profile = await profileResponse.json().catch(()=>({}));
      if (!profileResponse.ok || !profile.success) throw new Error(profile.message || 'Akun tidak memiliki akses petugas.');
      sessionStorage.setItem('refugeeledger-session', JSON.stringify({access_token:login.session.access_token, refresh_token:login.session.refresh_token, expires_at:login.session.expires_at}));
      sessionStorage.setItem('refugeeledger-officer-profile', JSON.stringify(profile));
      window.location.replace('/officer.html');
    } catch (error) {
      sessionStorage.removeItem('refugeeledger-session');
      sessionStorage.removeItem('refugeeledger-officer-profile');
      show(error.message || 'Tidak dapat masuk. Coba lagi.');
    } finally { submit.disabled = false; submit.textContent = 'Masuk dan verifikasi peran →'; }
  });
})();
