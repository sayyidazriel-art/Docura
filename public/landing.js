(() => {
  const root = document.documentElement;
  const themeButtons = [...document.querySelectorAll('[data-theme-choice]')];
  const navToggle = document.getElementById('navToggle');
  const mainNav = document.getElementById('mainNav');
  const notice = document.getElementById('portalNotice');
  const noticeClose = document.getElementById('noticeClose');

  function applyTheme(theme, persist = true) {
    const safeTheme = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = safeTheme;
    themeButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === safeTheme));
    });
    if (persist) {
      try { localStorage.setItem('refugeeledger-theme', safeTheme); } catch (_) {}
    }
  }

  let savedTheme = 'light';
  try {
    const storedTheme = localStorage.getItem('refugeeledger-theme');
    if (storedTheme === 'light' || storedTheme === 'dark') savedTheme = storedTheme;
  } catch (_) {}
  applyTheme(savedTheme, false);
  themeButtons.forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));

  if (navToggle && mainNav) {
    navToggle.addEventListener('click', () => {
      const isOpen = mainNav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
      navToggle.setAttribute('aria-label', isOpen ? 'Tutup navigasi' : 'Buka navigasi');
    });
    mainNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
      mainNav.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.setAttribute('aria-label', 'Buka navigasi');
    }));
  }

  // Capture phase makes navigation take priority over legacy click handlers
  // that used to display the "Portal Petugas disiapkan" notice.
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-portal]') : null;
    if (!button) return;
    const portal = button.dataset.portal;
    if (portal !== 'petugas' && portal !== 'warga') return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    if (notice) notice.hidden = true;
    window.location.assign(portal === 'petugas' ? '/officer-login.html' : '/login.html');
  }, true);

  if (noticeClose && notice) noticeClose.addEventListener('click', () => { notice.hidden = true; });
  const year = document.getElementById('currentYear');
  if (year) year.textContent = new Date().getFullYear();
})();
