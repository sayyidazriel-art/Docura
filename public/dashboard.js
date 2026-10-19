  // ==========================================
  // DEMO DATA
  // ==========================================

  const citizens = [
    {
      code: "RFL-2026-001",
      name: "Budi Santoso",
      birthDate: "1985-04-12",
      gender: "Laki-laki",
      location: "Desa Sukamaju",
      address: "Alamat sintetis 001",
      status: "verified",
      documents: 2
    },
    {
      code: "RFL-2026-002",
      name: "Siti Rahmawati",
      birthDate: "1992-08-21",
      gender: "Perempuan",
      location: "Desa Mekarsari",
      address: "Alamat sintetis 002",
      status: "registered",
      documents: 1
    },
    {
      code: "RFL-2026-003",
      name: "Ahmad Fauzi",
      birthDate: "1978-02-10",
      gender: "Laki-laki",
      location: "Desa Sukamaju",
      address: "Alamat sintetis 003",
      status: "verified",
      documents: 3
    },
    {
      code: "RFL-2026-004",
      name: "Dewi Lestari",
      birthDate: "2000-11-05",
      gender: "Perempuan",
      location: "Desa Harapan",
      address: "Alamat sintetis 004",
      status: "registered",
      documents: 0
    },
    {
      code: "RFL-2026-005",
      name: "Rudi Hartono",
      birthDate: "1969-06-30",
      gender: "Laki-laki",
      location: "Desa Mekarsari",
      address: "Alamat sintetis 005",
      status: "recovered",
      documents: 2
    }
  ];

  const documents = [
    {
      name: "Kartu Keluarga",
      citizen: "Budi Santoso",
      code: "RFL-2026-001",
      type: "PDF",
      status: "verified"
    },
    {
      name: "Kartu Identitas Demo",
      citizen: "Siti Rahmawati",
      code: "RFL-2026-002",
      type: "PDF",
      status: "registered"
    },
    {
      name: "Surat Keterangan",
      citizen: "Ahmad Fauzi",
      code: "RFL-2026-003",
      type: "PDF",
      status: "verified"
    }
  ];

  const auditLogs = [
    {
      action: "Data warga terdaftar",
      description: "RFL-2026-001 ditambahkan ke data demo.",
      time: "Data awal"
    },
    {
      action: "Verifikasi identitas demo",
      description: "Simulasi verifikasi berhasil.",
      time: "Data awal"
    },
    {
      action: "Dokumen dipulihkan",
      description: "Simulasi pemulihan dokumen selesai.",
      time: "Data awal"
    }
  ];

  let currentPage = "dashboard";
  let emergencyMode = false;
  let toastTimer;

  // ==========================================
  // HELPERS
  // ==========================================

  const pageContent = document.getElementById("pageContent");

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function showToast(message) {
    const toast = document.getElementById("toast");

    toast.textContent = message;
    toast.classList.add("visible");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      toast.classList.remove("visible");
    }, 3000);
  }

  function statusBadge(status) {
    const map = {
      verified: ["Terverifikasi", "badge-success"],
      registered: ["Terdaftar", "badge-warning"],
      recovered: ["Dipulihkan", "badge-neutral"],
      inactive: ["Nonaktif", "badge-danger"],
      uploaded: ["Terunggah", "badge-success"]
    };

    const [label, style] = map[status] || [
      "Tidak diketahui",
      "badge-neutral"
    ];

    return `
      <span class="badge ${style}">
        ${escapeHTML(label)}
      </span>
    `;
  }

  function pageHeading(title, description, action = "") {
    return `
      <div class="page-heading">
        <div>
          <h1 class="page-title">${title}</h1>
          <p class="page-description">${description}</p>
        </div>
        ${action}
      </div>
    `;
  }

  function getStats() {
    return {
      total: citizens.length,

      verified: citizens.filter(
        citizen => citizen.status === "verified"
      ).length,

      recovered: citizens.filter(
        citizen => citizen.status === "recovered"
      ).length,

      documents: documents.length
    };
  }

  function addAudit(action, description) {
    auditLogs.unshift({
      action,
      description,
      time: new Date().toLocaleString("id-ID")
    });
  }

  // ==========================================
  // NAVIGATION
  // ==========================================

  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
      navigate(button.dataset.page);
    });
  });

  document.getElementById("mobileMenu").addEventListener(
    "click",
    () => {
      document.getElementById("sidebar").classList.toggle("open");
    }
  );

  function navigate(page) {
    currentPage = page;

    document.querySelectorAll(".nav-item").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.page === page
      );
    });

    const titles = {
      dashboard: "Dashboard",
      citizens: "Data Warga",
      documents: "Dokumen",
      verification: "Verifikasi Identitas",
      audit: "Audit Log"
    };

    document.getElementById("breadcrumbTitle").textContent =
      titles[page] || "Dashboard";

    document.getElementById("sidebar").classList.remove("open");

    renderPage();
  }

  function renderPage() {
    const renderers = {
      dashboard: renderDashboard,
      citizens: renderCitizens,
      documents: renderDocuments,
      verification: renderVerification,
      audit: renderAudit
    };

    (renderers[currentPage] || renderDashboard)();
  }

  // ==========================================
  // DASHBOARD
  // ==========================================

  function renderDashboard() {
    const stats = getStats();

    pageContent.innerHTML = `
      ${pageHeading(
        "Dashboard",
        "Ringkasan data dan aktivitas pemulihan warga terdampak bencana.",
        `
          <button class="button button-primary" id="dashboardRegister">
            + Registrasi Warga
          </button>
        `
      )}

      <div class="grid stats-grid">

        <div class="card">
          <div class="stat-top">
            <div class="stat-label">Total Warga</div>
            <div class="stat-icon">♙</div>
          </div>
          <div class="stat-value">${stats.total}</div>
          <div class="stat-foot">Data sintetis demo</div>
        </div>

        <div class="card">
          <div class="stat-top">
            <div class="stat-label">Terverifikasi</div>
            <div class="stat-icon">✓</div>
          </div>
          <div class="stat-value">${stats.verified}</div>
          <div class="stat-foot">Status verifikasi demo</div>
        </div>

        <div class="card">
          <div class="stat-top">
            <div class="stat-label">Dokumen Dipulihkan</div>
            <div class="stat-icon">↗</div>
          </div>
          <div class="stat-value">${stats.recovered}</div>
          <div class="stat-foot">Status pemulihan demo</div>
        </div>

        <div class="card">
          <div class="stat-top">
            <div class="stat-label">Dokumen Terdaftar</div>
            <div class="stat-icon">▤</div>
          </div>
          <div class="stat-value">${stats.documents}</div>
          <div class="stat-foot">Metadata dokumen demo</div>
        </div>

      </div>

      <div class="grid dashboard-grid">

        <div class="card">
          <div class="card-heading">
            <div>
              <h2 class="card-title">Warga Terdaftar</h2>
              <div class="card-subtitle">
                Ringkasan registrasi terbaru
              </div>
            </div>

            <button class="button button-small" id="viewAllCitizens">
              Lihat Semua
            </button>
          </div>

          ${citizenTable(citizens.slice(0, 5))}
        </div>

        <div class="card">
          <div class="card-heading">
            <div>
              <h2 class="card-title">Aktivitas Terbaru</h2>
              <div class="card-subtitle">
                Catatan aktivitas demo
              </div>
            </div>
          </div>

          <div class="activity-list">
            ${auditLogs.slice(0, 5).map(log => `
              <div class="activity-item">
                <div class="activity-icon">◷</div>
                <div>
                  <div class="activity-text">
                    <strong>${escapeHTML(log.action)}</strong>
                    <br>
                    ${escapeHTML(log.description)}
                  </div>
                  <div class="activity-time">
                    ${escapeHTML(log.time)}
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>

      </div>
    `;

    document.getElementById("dashboardRegister").onclick =
      openRegistration;

    document.getElementById("viewAllCitizens").onclick =
      () => navigate("citizens");
  }

  // ==========================================
  // CITIZEN TABLE
  // ==========================================

  function citizenTable(list) {
    if (!list.length) {
      return `
        <div class="empty-state">
          Tidak ada data yang cocok.
        </div>
      `;
    }

    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nama Warga</th>
              <th>Kode</th>
              <th>Lokasi</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            ${list.map(citizen => `
              <tr>
                <td>
                  <div class="citizen-name">
                    ${escapeHTML(citizen.name)}
                  </div>
                  <div class="secondary-text">
                    ${escapeHTML(citizen.gender || "—")}
                  </div>
                </td>

                <td>${escapeHTML(citizen.code)}</td>

                <td>${escapeHTML(citizen.location)}</td>

                <td>${statusBadge(citizen.status)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // ==========================================
  // CITIZENS PAGE
  // ==========================================

  function renderCitizens() {
    pageContent.innerHTML = `
      ${pageHeading(
        "Data Warga",
        "Kelola registrasi dan status warga terdampak bencana.",
        `
          <button class="button button-primary" id="registerCitizen">
            + Registrasi Warga
          </button>
        `
      )}

      <div class="card">

        <div class="table-toolbar">
          <div>
            <h2 class="card-title">Daftar Warga</h2>
            <div class="card-subtitle">
              ${citizens.length} data demo
            </div>
          </div>

          <input
            class="search-input"
            id="citizenSearch"
            type="search"
            placeholder="Cari nama, kode, atau lokasi..."
            aria-label="Cari warga"
          >
        </div>

        <div id="citizenTable">
          ${citizenTable(citizens)}
        </div>

      </div>
    `;

    document.getElementById("registerCitizen").onclick =
      openRegistration;

    document.getElementById("citizenSearch").addEventListener(
      "input",
      event => {
        const query = event.target.value.toLowerCase();

        const filtered = citizens.filter(citizen =>
          [
            citizen.name,
            citizen.code,
            citizen.location
          ].some(value =>
            value.toLowerCase().includes(query)
          )
        );

        document.getElementById("citizenTable").innerHTML =
          citizenTable(filtered);
      }
    );
  }

  // ==========================================
  // DOCUMENTS PAGE
  // ==========================================

  function renderDocuments() {
    pageContent.innerHTML = `
      ${pageHeading(
        "Dokumen",
        "Kelola metadata dokumen dan demonstrasi alur pemulihan."
      )}

      <div class="card">

        <div class="card-heading">
          <div>
            <h2 class="card-title">Dokumen Warga</h2>
            <div class="card-subtitle">
              Dokumen berikut hanya contoh metadata.
            </div>
          </div>

          <button class="button button-primary" id="uploadDocument">
            + Pilih File
          </button>

          <input
            id="documentFile"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            hidden
          >
        </div>

        <div class="notice">
          Prototype ini belum mengunggah file ke Supabase Storage.
          File yang dipilih hanya diperiksa secara lokal dan tidak
          disimpan ke server.
        </div>

        <div class="table-wrap" style="margin-top:20px">
          <table>
            <thead>
              <tr>
                <th>Dokumen</th>
                <th>Pemilik</th>
                <th>Kode Warga</th>
                <th>Format</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>

            <tbody>
              ${documents.map((doc, index) => `
                <tr>
                  <td>
                    <div class="document-cell">
                      <div class="document-icon">▤</div>
                      <div>
                        <div class="citizen-name">
                          ${escapeHTML(doc.name)}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td>${escapeHTML(doc.citizen)}</td>
                  <td>${escapeHTML(doc.code)}</td>
                  <td>${escapeHTML(doc.type)}</td>
                  <td>${statusBadge(doc.status)}</td>

                  <td>
                    <button
                      class="button button-small recover-document"
                      data-index="${index}"
                    >
                      Simulasi Pulihkan
                    </button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

      </div>
    `;

    const fileInput = document.getElementById("documentFile");

    document.getElementById("uploadDocument").onclick = () => {
      fileInput.click();
    };

    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];

      if (!file) return;

      const allowedTypes = [
        "application/pdf",
        "image/jpeg",
        "image/png"
      ];

      if (!allowedTypes.includes(file.type)) {
        showToast("Format file tidak didukung.");
        fileInput.value = "";
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        showToast("Ukuran file maksimal 5 MB untuk demo.");
        fileInput.value = "";
        return;
      }

      showToast(
        "File terpilih. Belum diunggah atau disimpan ke server."
      );

      fileInput.value = "";
    });

    document.querySelectorAll(".recover-document").forEach(button => {
      button.addEventListener("click", () => {
        const doc = documents[Number(button.dataset.index)];

        if (doc.status !== "recovered") {
          doc.status = "recovered";

          addAudit(
            "Simulasi pemulihan dokumen",
            `${doc.name} — ${doc.code}`
          );

          renderDocuments();

          showToast(
            "Status demo diperbarui. File asli tidak dipulihkan."
          );
        } else {
          showToast("Dokumen ini sudah berstatus dipulihkan dalam demo.");
        }
      });
    });
  }

  // ==========================================
  // VERIFICATION PAGE
  // ==========================================

  function renderVerification() {
    pageContent.innerHTML = `
      ${pageHeading(
        "Verifikasi Identitas",
        "Demonstrasi alur pemeriksaan identitas warga."
      )}

      <div class="grid verification-grid">

        <div class="card verification-panel">
          <div class="verification-symbol">▦</div>

          <h3>Verifikasi QR</h3>

          <p>
            Masukkan kode warga demo untuk menyimulasikan
            pencarian identitas.
          </p>

          <form id="qrForm">
            <input
              class="form-control"
              id="qrCode"
              placeholder="Contoh: RFL-2026-001"
              required
              style="margin-bottom:12px"
            >

            <button
              class="button button-primary"
              type="submit"
              style="width:100%"
            >
              Simulasikan Verifikasi
            </button>
          </form>

          <div class="result-box" id="qrResult" aria-live="polite"></div>

          <div class="notice">
            Ini bukan pemindaian QR kamera dan bukan pemeriksaan
            kriptografis. Kode hanya dicocokkan dengan data demo.
          </div>
        </div>

        <div class="card verification-panel">
          <div class="verification-symbol">◎</div>

          <h3>Simulasi Sidik Jari</h3>

          <p>
            Jalankan simulasi alur verifikasi biometrik
            tanpa menggunakan perangkat atau data biometrik asli.
          </p>

          <button
            class="button button-primary"
            id="fingerprintButton"
            style="width:100%"
          >
            Jalankan Simulasi
          </button>

          <div
            class="result-box"
            id="fingerprintResult"
            aria-live="polite"
          ></div>

          <div class="notice">
            Tidak ada sidik jari yang dibaca atau dibandingkan.
            Hasilnya hanya simulasi untuk demonstrasi.
          </div>
        </div>

      </div>
    `;

    document.getElementById("qrForm").addEventListener(
      "submit",
      event => {
        event.preventDefault();

        const code = document.getElementById("qrCode")
          .value.trim().toUpperCase();

        const citizen = citizens.find(
          item => item.code.toUpperCase() === code
        );

        const result = document.getElementById("qrResult");

        result.classList.add("visible");

        if (citizen) {
          result.innerHTML = `
            <strong>Warga ditemukan dalam data demo.</strong><br>
            Nama: ${escapeHTML(citizen.name)}<br>
            Kode: ${escapeHTML(citizen.code)}<br>
            Status: ${escapeHTML(citizen.status)}<br>
            <br>
            <strong>Catatan:</strong> Hasil ini bukan bukti
            autentikasi identitas nyata.
          `;

          addAudit(
            "Simulasi pencarian kode warga",
            `Kode demo ${citizen.code}`
          );

          showToast("Data demo ditemukan.");
        } else {
          result.textContent =
            "Kode tidak ditemukan dalam dataset demo.";

          showToast("Data demo tidak ditemukan.");
        }
      }
    );

    document.getElementById("fingerprintButton").onclick = () => {
      const result = document.getElementById("fingerprintResult");

      result.classList.add("visible");

      result.innerHTML = `
        <strong>Simulasi selesai.</strong><br>
        Mode: Simulasi sidik jari<br>
        Status: Demonstrasi berhasil dijalankan<br>
        <br>
        Tidak ada data biometrik yang digunakan.
      `;

      addAudit(
        "Simulasi verifikasi sidik jari",
        "Simulasi UI dijalankan tanpa data biometrik"
      );

      showToast("Simulasi verifikasi selesai.");
    };
  }

  // ==========================================
  // AUDIT PAGE
  // ==========================================

  function renderAudit() {
    pageContent.innerHTML = `
      ${pageHeading(
        "Audit Log",
        "Riwayat aktivitas demonstrasi Docura."
      )}

      <div class="card">

        <div class="card-heading">
          <div>
            <h2 class="card-title">Aktivitas Sistem</h2>
            <div class="card-subtitle">
              ${auditLogs.length} aktivitas dalam sesi demo ini
            </div>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Aktivitas</th>
                <th>Detail</th>
                <th>Waktu</th>
              </tr>
            </thead>

            <tbody>
              ${auditLogs.map(log => `
                <tr>
                  <td>
                    <strong>${escapeHTML(log.action)}</strong>
                  </td>

                  <td>${escapeHTML(log.description)}</td>

                  <td>${escapeHTML(log.time)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        <div class="notice">
          Audit log ini hanya berada di memori browser dan bukan
          audit log persisten. Implementasi backend akan dibuat
          pada fase integrasi.
        </div>

      </div>
    `;
  }

  // ==========================================
  // REGISTRATION
  // ==========================================

  function openRegistration() {
    document.getElementById("registrationModal")
      .classList.add("open");

    document.getElementById("fullName").focus();
  }

  function closeRegistration() {
    document.getElementById("registrationModal")
      .classList.remove("open");
  }

  document.getElementById("closeModal").onclick =
    closeRegistration;

  document.getElementById("cancelRegistration").onclick =
    closeRegistration;

  document.getElementById("registrationModal").addEventListener(
    "click",
    event => {
      if (event.target.id === "registrationModal") {
        closeRegistration();
      }
    }
  );

  document.getElementById("registrationForm").addEventListener(
    "submit",
    event => {
      event.preventDefault();

      const name = document.getElementById("fullName")
        .value.trim();

      const birthDate = document.getElementById("birthDate")
        .value;

      const gender = document.getElementById("gender")
        .value;

      const location = document.getElementById("location")
        .value.trim();

      const address = document.getElementById("address")
        .value.trim();

      if (!name || !location) {
        showToast("Nama dan lokasi bencana wajib diisi.");
        return;
      }

      const nextNumber = citizens.length + 1;

      const code =
        "RFL-2026-" + String(nextNumber).padStart(3, "0");

      citizens.unshift({
        code,
        name,
        birthDate,
        gender,
        location,
        address,
        status: "registered",
        documents: 0
      });

      addAudit(
        "Registrasi warga demo",
        `${name} — ${code}`
      );

      event.target.reset();

      closeRegistration();

      renderPage();

      showToast(
        "Data ditambahkan ke sesi demo browser."
      );
    }
  );

  // ==========================================
  // EMERGENCY MODE
  // ==========================================

  document.getElementById("emergencyToggle").onclick = () => {
    emergencyMode = !emergencyMode;

    const banner = document.getElementById("emergencyBanner");
    const title = document.getElementById("emergencyTitle");
    const description = document.getElementById(
      "emergencyDescription"
    );

    banner.classList.toggle("active", emergencyMode);

    if (emergencyMode) {
      title.textContent = "🚨 Emergency Mode Aktif";

      description.textContent =
        "Mode darurat demo aktif. Ini hanya perubahan tampilan " +
        "dan tidak mengubah prioritas layanan backend.";

      document.getElementById("emergencyToggle").textContent =
        "Nonaktifkan Mode";
    } else {
      title.textContent = "⚠ Emergency Mode";

      description.textContent =
        "Mode darurat belum diaktifkan. Aktifkan untuk demonstrasi " +
        "alur prioritas pemulihan data.";

      document.getElementById("emergencyToggle").textContent =
        "Aktifkan Mode";
    }

    addAudit(
      emergencyMode
        ? "Emergency Mode diaktifkan"
        : "Emergency Mode dinonaktifkan",
      "Perubahan tampilan mode darurat demo"
    );

    showToast(
      emergencyMode
        ? "Emergency Mode demo aktif."
        : "Emergency Mode demo dinonaktifkan."
    );
  };

  // ==========================================
  // INITIALIZATION
  // ==========================================

  renderDashboard();

  // ==========================================
  // GLOBAL THEME: LIGHT / DARK
  // ==========================================
  (() => {
    const root = document.documentElement;
    const buttons = Array.from(document.querySelectorAll('[data-theme-choice]'));
    const key = 'refugeeledger-theme';

    function applyTheme(value, persist = true) {
      const theme = value === 'dark' ? 'dark' : 'light';
      root.dataset.theme = theme;
      buttons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
      });
      if (persist) {
        try { localStorage.setItem(key, theme); } catch (_) { /* Local storage may be unavailable. */ }
      }
    }

    let initialTheme = 'light';
    try {
      const stored = localStorage.getItem(key);
      if (stored === 'dark' || stored === 'light') initialTheme = stored;
    } catch (_) { /* Keep light mode as default. */ }
    applyTheme(initialTheme, false);
    buttons.forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));
  })();

