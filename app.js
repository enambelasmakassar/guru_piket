// =========================================================
// APP.JS — Absensi Guru oleh Guru Piket
// =========================================================

const DAY_NAMES = ["MINGGU","SENIN","SELASA","RABU","KAMIS","JUMAT","SABTU"];
const STATUS_LIST = ["Hadir","Izin","Sakit","Alpa","Tugas Luar"];
const TINGKAT_LIST = ["VII","VIII","IX"];
const KELAS_COUNT = { VII: 4, VIII: 5, IX: 5 };

let currentUser = null;
let currentProfile = null;
let laporanCharts = {}; // "kepsek"|"piket" -> instance Chart.js aktif, supaya bisa di-destroy sebelum digambar ulang
let pengaturanSekolahCache = null; // cache baris pengaturan_sekolah (kop surat), dimuat sekali lalu dipakai ulang saat cetak

let piketState = {
  tanggal: null,
  hari: null,
  tingkatActive: "VII",
  kelasActive: 1,
  jadwalHariIni: [],   // jadwal rows for the day, with mapel & guru joined
  existingMap: {},     // "TINGKAT|nomor" -> baris absensi_kelas tersimpan (dari server)
  kelasCache: {}        // "TINGKAT|nomor" -> { id, tingkat, nomor_kelas, items:[...], dirty }
};

// ---------------------------------------------------------
// HELPER: urutan tingkat (VII, VIII, IX) & flatten JSON absensi_kelas
// ---------------------------------------------------------
function tingkatRank(t) {
  const i = TINGKAT_LIST.indexOf(t);
  return i === -1 ? 99 : i;
}

// Mengubah baris-baris absensi_kelas (data = JSON array per jam) menjadi
// daftar flat per-jam, dipakai bersama oleh Rekap Kepsek & Rekap WA.
function flattenKelasRows(kelasRows) {
  const flat = [];
  (kelasRows || []).forEach(k => {
    const pencatatNama = k.pencatat ? k.pencatat.nama_lengkap : null;
    (k.data || []).forEach(item => {
      flat.push({
        tanggal: k.tanggal,
        tingkat: k.tingkat,
        nomor_kelas: k.nomor_kelas,
        jam_ke: item.jam_ke,
        waktu: item.waktu,
        kode_mapel: item.kode_mapel,
        nama_mapel: item.nama_mapel,
        kode_guru: item.kode_guru,
        nama_guru: item.nama_guru,
        status: item.status,
        catatan_tugas: item.catatan_tugas,
        pencatat: pencatatNama
      });
    });
  });
  return flat;
}

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------
window.addEventListener("DOMContentLoaded", init);

async function init() {
  bindStaticEvents();
  loadBrandingPublik(); // logo & nama sekolah untuk halaman login + footer (tidak perlu login)
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    await onLoggedIn(data.session.user);
  } else {
    showLogin();
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      showLogin();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    const dirty = Object.values(piketState.kelasCache || {}).some(k => k.dirty);
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });
}

function bindStaticEvents() {
  document.getElementById("form-login").addEventListener("submit", handleLogin);
  document.getElementById("btn-logout").addEventListener("click", handleLogout);
  document.getElementById("toggle-password").addEventListener("click", togglePasswordVisibility);
  document.getElementById("piket-tanggal").addEventListener("change", (e) => {
    setPiketTanggal(e.target.value);
  });

  document.querySelectorAll("#view-kepsek .tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchKepsekTab(btn.dataset.tab));
  });
  document.querySelectorAll("#view-piket .tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchPiketTab(btn.dataset.tab));
  });

  document.getElementById("kepsek-rekap-tanggal").addEventListener("change", () => loadRekap("kepsek"));
  document.getElementById("kepsek-rekap-guru-filter").addEventListener("change", () => loadRekap("kepsek"));
  document.getElementById("kepsek-rekap-status-filter").addEventListener("change", () => loadRekap("kepsek"));

  document.getElementById("piket-rekap-tanggal").addEventListener("change", () => loadRekap("piket"));
  document.getElementById("piket-rekap-guru-filter").addEventListener("change", () => loadRekap("piket"));
  document.getElementById("piket-rekap-status-filter").addEventListener("change", () => loadRekap("piket"));

  document.getElementById("jadwal-hari-filter").addEventListener("change", loadJadwalManage);
  document.getElementById("jadwal-tingkat-filter").addEventListener("change", loadJadwalManage);
  document.getElementById("btn-tambah-jadwal").addEventListener("click", tambahJadwalPrompt);

  document.getElementById("btn-tambah-guru").addEventListener("click", tambahGuru);
  document.getElementById("btn-tambah-mapel").addEventListener("click", tambahMapel);
  document.getElementById("btn-tambah-akun").addEventListener("click", tambahAkunPrompt);

  document.getElementById("btn-kirim-wa-piket").addEventListener("click", () => {
    openKirimRekapModal(piketState.tanggal);
  });
  document.getElementById("btn-kirim-wa-kepsek-rekap").addEventListener("click", () => {
    openKirimRekapModal(document.getElementById("kepsek-rekap-tanggal").value);
  });
  document.getElementById("btn-kirim-wa-piket-rekap").addEventListener("click", () => {
    openKirimRekapModal(document.getElementById("piket-rekap-tanggal").value);
  });

  document.getElementById("kepsek-rekap-btn-cetak").addEventListener("click", () => cetakRekapHarian("kepsek"));
  document.getElementById("piket-rekap-btn-cetak").addEventListener("click", () => cetakRekapHarian("piket"));
  document.getElementById("kepsek-lap-btn-cetak").addEventListener("click", () => cetakLaporanPeriode("kepsek"));
  document.getElementById("piket-lap-btn-cetak").addEventListener("click", () => cetakLaporanPeriode("piket"));
}

// ---------------------------------------------------------
// AUTH
// ---------------------------------------------------------
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errBox = document.getElementById("login-error");
  errBox.textContent = "";
  const btn = document.getElementById("btn-login");
  btn.disabled = true; btn.textContent = "Memproses...";

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  btn.disabled = false; btn.textContent = "Masuk";

  if (error) {
    errBox.textContent = "Email atau kata sandi salah.";
    return;
  }
  await onLoggedIn(data.user);
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  showLogin();
}

async function onLoggedIn(user) {
  currentUser = user;
  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    document.getElementById("login-error").textContent =
      "Akun ditemukan tapi profil belum diatur. Hubungi Admin.";
    await supabaseClient.auth.signOut();
    showLogin();
    return;
  }

  currentProfile = profile;
  document.getElementById("who-name").textContent = profile.nama_lengkap;
  document.getElementById("who-role").textContent =
    profile.role === "kepala_sekolah" ? "Kepala Sekolah" : "Guru Piket";

  document.getElementById("view-login").classList.add("hidden");
  document.getElementById("view-app").classList.remove("hidden");

  if (profile.role === "kepala_sekolah") {
    document.getElementById("view-kepsek").classList.remove("hidden");
    document.getElementById("view-piket").classList.add("hidden");
    initKepsekView();
  } else {
    document.getElementById("view-piket").classList.remove("hidden");
    document.getElementById("view-kepsek").classList.add("hidden");
    initPiketView();
  }
}

function showLogin() {
  document.getElementById("view-app").classList.add("hidden");
  document.getElementById("view-login").classList.remove("hidden");
  document.getElementById("login-email").value = "";
  document.getElementById("login-password").value = "";
  document.getElementById("login-error").textContent = "";
  resetPasswordVisibility();
}

function togglePasswordVisibility() {
  const input = document.getElementById("login-password");
  const btn = document.getElementById("toggle-password");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  btn.classList.toggle("is-visible", !showing);
  btn.setAttribute("aria-label", showing ? "Tampilkan kata sandi" : "Sembunyikan kata sandi");
}

function resetPasswordVisibility() {
  const input = document.getElementById("login-password");
  const btn = document.getElementById("toggle-password");
  if (!input || !btn) return;
  input.type = "password";
  btn.classList.remove("is-visible");
  btn.setAttribute("aria-label", "Tampilkan kata sandi");
}

// ---------------------------------------------------------
// BRANDING PUBLIK (logo & nama sekolah) — dimuat sebelum login,
// dipakai di halaman Login & footer aplikasi.
// Membutuhkan policy "pengaturan_sekolah_select" yang terbuka untuk
// publik (lihat 05_logo_publik.sql), karena halaman ini tampil
// SEBELUM user login.
// ---------------------------------------------------------
async function loadBrandingPublik() {
  const year = new Date().getFullYear();
  ["footer-year", "footer-year-login"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = year;
  });

  try {
    const { data, error } = await supabaseClient
      .from("pengaturan_sekolah")
      .select("sekolah, logo_kanan_url")
      .eq("id", 1)
      .single();

    if (error || !data) return;

    if (data.sekolah) {
      ["footer-sekolah-name", "footer-sekolah-name-login"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = data.sekolah;
      });
    }

    if (data.logo_kanan_url) {
      const logoEl = document.getElementById("login-logo");
      if (logoEl) {
        logoEl.src = data.logo_kanan_url;
        logoEl.classList.remove("hidden");
      }
    }
  } catch (e) {
    // diam saja — logo/nama sekolah bersifat dekoratif, halaman login tetap berfungsi tanpanya
    console.warn("Gagal memuat branding publik:", e);
  }
}

// =========================================================
// GURU PIKET VIEW
// =========================================================
function initPiketView() {
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  document.getElementById("piket-tanggal").value = iso;
  setPiketTanggal(iso);
}

function setPiketTanggal(tanggalStr) {
  piketState.tanggal = tanggalStr;
  const dObj = new Date(tanggalStr + "T00:00:00");
  const hari = DAY_NAMES[dObj.getDay()];
  piketState.hari = hari;

  const label = document.getElementById("piket-hari-label");
  const formatted = dObj.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  if (hari === "SABTU" || hari === "MINGGU") {
    label.textContent = formatted + " — Tidak ada jadwal pelajaran";
    document.getElementById("piket-content").innerHTML =
      `<div class="empty-note">Tidak ada jadwal PBM pada hari ${hari === "SABTU" ? "Sabtu" : "Minggu"}.</div>`;
    return;
  }
  label.textContent = formatted;
  loadPiketData();
}

async function loadPiketData() {
  document.getElementById("piket-content").innerHTML = `<div class="loading-note">Memuat jadwal...</div>`;

  const { data: jadwalRows, error: jErr } = await supabaseClient
    .from("jadwal")
    .select("*, guru:kode_guru(nama_lengkap), mapel:kode_mapel(nama_mapel)")
    .eq("hari", piketState.hari)
    .order("tingkat", { ascending: false })
    .order("nomor_kelas")
    .order("jam_ke");

  if (jErr) {
    document.getElementById("piket-content").innerHTML = `<div class="empty-note">Gagal memuat jadwal: ${jErr.message}</div>`;
    return;
  }

  const { data: kelasRows, error: aErr } = await supabaseClient
    .from("absensi_kelas")
    .select("*")
    .eq("tanggal", piketState.tanggal);

  if (aErr) {
    document.getElementById("piket-content").innerHTML = `<div class="empty-note">Gagal memuat data absensi: ${aErr.message}</div>`;
    return;
  }

  const existingMap = {};
  (kelasRows || []).forEach(k => { existingMap[`${k.tingkat}|${k.nomor_kelas}`] = k; });

  piketState.jadwalHariIni = jadwalRows || [];
  piketState.existingMap = existingMap;
  piketState.kelasCache = {}; // reset draft lokal setiap kali tanggal berganti / data dimuat ulang

  renderPiketTingkatTabs();
}

// Ambil (atau bangun) draft lokal untuk satu kelas. Draft ini yang diedit
// oleh tombol status & catatan sebelum tombol "Simpan" ditekan.
function getKelasEntry(tingkat, nomorKelas) {
  const key = `${tingkat}|${nomorKelas}`;
  if (piketState.kelasCache[key]) return piketState.kelasCache[key];

  const rowsJadwal = piketState.jadwalHariIni
    .filter(j => j.tingkat === tingkat && j.nomor_kelas === nomorKelas)
    .sort((a, b) => a.jam_ke - b.jam_ke);

  const existing = piketState.existingMap[key];
  const existingByJadwalId = {};
  (existing ? existing.data || [] : []).forEach(it => { existingByJadwalId[it.jadwal_id] = it; });

  const items = rowsJadwal.map(j => {
    const prev = existingByJadwalId[j.id];
    return {
      jadwal_id: j.id,
      jam_ke: j.jam_ke,
      waktu: j.waktu,
      kode_mapel: j.kode_mapel,
      nama_mapel: j.mapel ? j.mapel.nama_mapel : "-",
      kode_guru: j.kode_guru,
      nama_guru: j.guru ? j.guru.nama_lengkap : "-",
      status: prev ? prev.status : null,
      catatan_tugas: prev ? (prev.catatan_tugas || "") : ""
    };
  });

  const entry = { id: existing ? existing.id : null, tingkat, nomor_kelas: nomorKelas, items, dirty: false };
  piketState.kelasCache[key] = entry;
  return entry;
}

function renderPiketTingkatTabs() {
  const container = document.getElementById("piket-content");
  container.innerHTML = "";

  const tingkatWrap = document.createElement("div");
  tingkatWrap.className = "tingkat-tabs";
  TINGKAT_LIST.forEach(t => {
    const btn = document.createElement("button");
    btn.textContent = "Kelas " + t;
    if (t === piketState.tingkatActive) btn.classList.add("active");
    btn.addEventListener("click", () => {
      if (!confirmLeaveIfDirty()) return;
      piketState.tingkatActive = t;
      piketState.kelasActive = 1;
      renderPiketTingkatTabs();
    });
    tingkatWrap.appendChild(btn);
  });
  container.appendChild(tingkatWrap);

  const kelasWrap = document.createElement("div");
  kelasWrap.className = "kelas-pills";
  const jumlahKelas = KELAS_COUNT[piketState.tingkatActive];
  for (let i = 1; i <= jumlahKelas; i++) {
    const entry = getKelasEntry(piketState.tingkatActive, i);
    const total = entry.items.length;
    const terisi = entry.items.filter(it => it.status).length;
    const pill = document.createElement("button");
    pill.className = "kelas-pill"
      + (i === piketState.kelasActive ? " active" : "")
      + (terisi < total ? " incomplete" : "")
      + (entry.dirty ? " dirty" : "");
    pill.innerHTML = `${piketState.tingkatActive}.${i} <span class="badge-count">${terisi}/${total}</span>`
      + (entry.dirty ? ` <span class="dirty-dot" title="Ada perubahan belum disimpan">●</span>` : "");
    pill.addEventListener("click", () => {
      if (i === piketState.kelasActive) return;
      if (!confirmLeaveIfDirty()) return;
      piketState.kelasActive = i;
      renderPiketTingkatTabs();
    });
    kelasWrap.appendChild(pill);
  }
  container.appendChild(kelasWrap);

  const listWrap = document.createElement("div");
  listWrap.className = "card";
  const entry = getKelasEntry(piketState.tingkatActive, piketState.kelasActive);

  if (entry.items.length === 0) {
    listWrap.innerHTML = `<div class="empty-note">Tidak ada jadwal untuk kelas ini pada hari ${piketState.hari}.</div>`;
  } else {
    const title = document.createElement("div");
    title.className = "card-title";
    title.innerHTML = `<span>Kelas ${piketState.tingkatActive}.${piketState.kelasActive} — ${piketState.hari}</span>`;
    listWrap.appendChild(title);

    entry.items.forEach((item) => {
      listWrap.appendChild(buildJamRow(entry, item));
    });

    const saveBar = document.createElement("div");
    saveBar.className = "save-bar";
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary btn-save-kelas";
    saveBtn.textContent = "💾 Simpan Absensi Kelas Ini";
    saveBtn.disabled = !entry.dirty;
    saveBtn.addEventListener("click", () => saveKelasAbsensi(entry));
    saveBar.appendChild(saveBtn);

    const note = document.createElement("span");
    note.className = "unsaved-note";
    note.textContent = entry.dirty ? "Ada perubahan yang belum disimpan." : "Semua perubahan tersimpan.";
    saveBar.appendChild(note);

    listWrap.appendChild(saveBar);
  }
  container.appendChild(listWrap);
}

// Cegah pindah kelas/tingkat tanpa sengaja saat masih ada draft yang belum disimpan
function confirmLeaveIfDirty() {
  const entry = piketState.kelasCache[`${piketState.tingkatActive}|${piketState.kelasActive}`];
  if (!entry || !entry.dirty) return true;
  return window.confirm("Ada perubahan di kelas ini yang belum disimpan. Pindah tanpa menyimpan?");
}

function buildJamRow(entry, item) {
  const row = document.createElement("div");
  row.className = "jam-row";
  row.dataset.jadwalId = item.jadwal_id;

  const badge = document.createElement("div");
  badge.className = "jam-badge";
  badge.textContent = item.jam_ke;
  row.appendChild(badge);

  const info = document.createElement("div");
  info.className = "jam-info";
  info.innerHTML = `
    <div class="mapel-name">${item.nama_mapel}</div>
    <div class="meta-line">${item.waktu || ""} &middot; ${item.nama_guru}</div>
  `;
  row.appendChild(info);

  const statusGroup = document.createElement("div");
  statusGroup.className = "status-group";
  STATUS_LIST.forEach(status => {
    const btn = document.createElement("button");
    btn.className = "status-btn";
    btn.dataset.status = status;
    btn.textContent = status;
    if (item.status === status) btn.classList.add("active");
    btn.addEventListener("click", () => {
      item.status = status;
      entry.dirty = true;
      renderPiketTingkatTabs();
    });
    statusGroup.appendChild(btn);
  });
  row.appendChild(statusGroup);

  if (item.status && item.status !== "Hadir") {
    row.appendChild(buildCatatanBox(entry, item));
  }

  return row;
}

function buildCatatanBox(entry, item) {
  const box = document.createElement("div");
  box.className = "catatan-box";
  box.innerHTML = `<label>Catatan / Tugas untuk siswa</label>
    <textarea placeholder="Contoh: Kerjakan LKS halaman 24, dikumpul minggu depan">${item.catatan_tugas || ""}</textarea>`;
  const textarea = box.querySelector("textarea");
  textarea.addEventListener("input", () => {
    item.catatan_tugas = textarea.value;
    if (!entry.dirty) {
      entry.dirty = true;
      const saveBtn = document.querySelector(".btn-save-kelas");
      const note = document.querySelector(".unsaved-note");
      if (saveBtn) saveBtn.disabled = false;
      if (note) note.textContent = "Ada perubahan yang belum disimpan.";
    }
  });
  return box;
}

// Klik "Simpan Absensi Kelas Ini" -> upsert satu baris JSON untuk kelas & tanggal ini
async function saveKelasAbsensi(entry) {
  const saveBtn = document.querySelector(".btn-save-kelas");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Menyimpan..."; }

  const payload = {
    tanggal: piketState.tanggal,
    hari: piketState.hari,
    tingkat: entry.tingkat,
    nomor_kelas: entry.nomor_kelas,
    data: entry.items.map(it => ({
      jadwal_id: it.jadwal_id,
      jam_ke: it.jam_ke,
      waktu: it.waktu,
      kode_mapel: it.kode_mapel,
      nama_mapel: it.nama_mapel,
      kode_guru: it.kode_guru,
      nama_guru: it.nama_guru,
      status: it.status,
      catatan_tugas: it.status && it.status !== "Hadir" ? (it.catatan_tugas || null) : null
    })),
    dicatat_oleh: currentUser.id
  };

  const { data, error } = await supabaseClient
    .from("absensi_kelas")
    .upsert(payload, { onConflict: "tanggal,tingkat,nomor_kelas" })
    .select()
    .single();

  if (error) {
    Notify.toast("Gagal menyimpan: " + error.message, "error");
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💾 Simpan Absensi Kelas Ini"; }
    return;
  }

  entry.id = data.id;
  entry.dirty = false;
  piketState.existingMap[`${entry.tingkat}|${entry.nomor_kelas}`] = data;
  Notify.toast(`Absensi Kelas ${entry.tingkat}.${entry.nomor_kelas} berhasil disimpan.`, "success");
  renderPiketTingkatTabs();
}

// =========================================================
// KEPALA SEKOLAH VIEW
// =========================================================
function initKepsekView() {
  initRekapHarian("kepsek");
}

function switchKepsekTab(tabName) {
  document.querySelectorAll("#view-kepsek .tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll("#view-kepsek .tab-panel").forEach(p => p.classList.toggle("hidden", p.dataset.panel !== tabName));

  if (tabName === "rekap") initRekapHarian("kepsek");
  if (tabName === "laporan") initLaporanPeriode("kepsek");
  if (tabName === "jadwal") loadJadwalManage();
  if (tabName === "guru") loadGuruManage();
  if (tabName === "mapel") loadMapelManage();
  if (tabName === "akun") loadAkunManage();
  if (tabName === "pengaturan") loadPengaturanKop();
}

function switchPiketTab(tabName) {
  document.querySelectorAll("#view-piket .tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll("#view-piket .tab-panel").forEach(p => p.classList.toggle("hidden", p.dataset.panel !== tabName));

  if (tabName === "rekap") initRekapHarian("piket");
  if (tabName === "laporan") initLaporanPeriode("piket");
}

// ---------------- REKAP HARIAN — dipakai oleh Kepala Sekolah (edit peran/dll di tab lain)
// dan Guru Piket (hanya lihat). prefix: "kepsek" atau "piket" -> menentukan id elemen DOM.
async function initRekapHarian(prefix) {
  const tanggalInput = document.getElementById(`${prefix}-rekap-tanggal`);
  if (!tanggalInput) return;
  if (!tanggalInput.value) tanggalInput.value = new Date().toISOString().slice(0, 10);
  await populateGuruFilter(prefix);
  loadRekap(prefix);
}

async function populateGuruFilter(prefix) {
  const sel = document.getElementById(`${prefix}-rekap-guru-filter`);
  if (!sel || sel.dataset.loaded) return; // hindari duplikasi opsi saat tab dibuka berkali-kali
  const { data } = await supabaseClient.from("guru").select("*").order("nama_lengkap");
  (data || []).forEach(g => {
    const opt = document.createElement("option");
    opt.value = g.kode_guru;
    opt.textContent = g.nama_lengkap;
    sel.appendChild(opt);
  });
  sel.dataset.loaded = "1";
}

async function loadRekap(prefix) {
  const tanggal = document.getElementById(`${prefix}-rekap-tanggal`).value;
  const guruFilter = document.getElementById(`${prefix}-rekap-guru-filter`).value;
  const statusFilter = document.getElementById(`${prefix}-rekap-status-filter`).value;

  const wrap = document.getElementById(`${prefix}-rekap-table-wrap`);
  wrap.innerHTML = `<div class="loading-note">Memuat data...</div>`;

  const { data, error } = await supabaseClient
    .from("absensi_kelas")
    .select("*, pencatat:dicatat_oleh(nama_lengkap)")
    .eq("tanggal", tanggal);

  if (error) {
    wrap.innerHTML = `<div class="empty-note">Gagal memuat: ${error.message}</div>`;
    return;
  }

  // pecah JSON per kelas jadi baris per-jam, lalu buang baris yang belum diisi statusnya
  let rows = flattenKelasRows(data).filter(r => r.status);
  if (statusFilter) rows = rows.filter(r => r.status === statusFilter);
  if (guruFilter) rows = rows.filter(r => String(r.kode_guru) === guruFilter);
  rows.sort((a, b) => {
    if (a.tingkat !== b.tingkat) return tingkatRank(a.tingkat) - tingkatRank(b.tingkat);
    if (a.nomor_kelas !== b.nomor_kelas) return a.nomor_kelas - b.nomor_kelas;
    return a.jam_ke - b.jam_ke;
  });

  renderRekapSummary(prefix, rows);

  if (rows.length === 0) {
    wrap.innerHTML = `<div class="empty-note">Belum ada data absensi untuk tanggal ini.</div>`;
    return;
  }

  let html = `<table class="data-table"><thead><tr>
    <th>Jam</th><th>Kelas</th><th>Mapel</th><th>Guru</th><th>Status</th><th>Catatan</th><th>Dicatat oleh</th>
  </tr></thead><tbody>`;
  rows.forEach(r => {
    html += `<tr>
      <td>${r.jam_ke ?? "-"}<br><span style="color:var(--ink-soft);font-size:0.75rem;">${r.waktu || ""}</span></td>
      <td>${r.tingkat || ""}.${r.nomor_kelas ?? ""}</td>
      <td>${r.nama_mapel || "-"}</td>
      <td>${r.nama_guru || "-"}</td>
      <td><span class="pill-status ${r.status.replace(" ", "")}">${r.status}</span></td>
      <td>${r.catatan_tugas || "-"}</td>
      <td>${r.pencatat || "-"}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

function renderRekapSummary(prefix, rows) {
  const counts = { Hadir: 0, Izin: 0, Sakit: 0, Alpa: 0, "Tugas Luar": 0 };
  rows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

  const strip = document.getElementById(`${prefix}-rekap-summary`);
  strip.innerHTML = `
    <div class="summary-chip ok"><div class="num">${counts.Hadir}</div><div class="lbl">Hadir</div></div>
    <div class="summary-chip izin"><div class="num">${counts.Izin}</div><div class="lbl">Izin</div></div>
    <div class="summary-chip"><div class="num">${counts.Sakit}</div><div class="lbl">Sakit</div></div>
    <div class="summary-chip alpa"><div class="num">${counts.Alpa}</div><div class="lbl">Alpa</div></div>
    <div class="summary-chip"><div class="num">${counts["Tugas Luar"]}</div><div class="lbl">Tugas Luar</div></div>
  `;
}

// ---------------- JADWAL MANAGE ----------------
async function loadJadwalManage() {
  const hari = document.getElementById("jadwal-hari-filter").value;
  const tingkat = document.getElementById("jadwal-tingkat-filter").value;
  const wrap = document.getElementById("jadwal-table-wrap");
  wrap.innerHTML = `<div class="loading-note">Memuat data...</div>`;

  let query = supabaseClient
    .from("jadwal")
    .select("*, guru:kode_guru(nama_lengkap), mapel:kode_mapel(nama_mapel)")
    .eq("hari", hari)
    .order("tingkat").order("nomor_kelas").order("jam_ke");
  if (tingkat) query = query.eq("tingkat", tingkat);

  const { data, error } = await query;
  if (error) { wrap.innerHTML = `<div class="empty-note">Gagal memuat: ${error.message}</div>`; return; }

  const { data: guruList } = await supabaseClient.from("guru").select("*").order("kode_guru");
  const { data: mapelList } = await supabaseClient.from("mapel").select("*").order("kode_mapel");

  let html = `<table class="data-table"><thead><tr>
    <th>Jam</th><th>Waktu</th><th>Kelas</th><th>Mapel</th><th>Guru</th><th></th>
  </tr></thead><tbody>`;
  (data || []).forEach(j => {
    html += `<tr data-id="${j.id}">
      <td>${j.jam_ke}</td>
      <td>${j.waktu || ""}</td>
      <td>${j.tingkat}.${j.nomor_kelas}</td>
      <td>
        <select class="edit-mapel">${mapelList.map(m => `<option value="${m.kode_mapel}" ${m.kode_mapel===j.kode_mapel?"selected":""}>${m.nama_mapel}</option>`).join("")}</select>
      </td>
      <td>
        <select class="edit-guru">${guruList.map(g => `<option value="${g.kode_guru}" ${g.kode_guru===j.kode_guru?"selected":""}>${g.nama_lengkap}</option>`).join("")}</select>
      </td>
      <td>
        <button class="action-icon-btn btn-save-jadwal" title="Simpan">💾</button>
        <button class="action-icon-btn danger btn-del-jadwal" title="Hapus">🗑</button>
      </td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll(".btn-save-jadwal").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const tr = e.target.closest("tr");
      const id = tr.dataset.id;
      const kode_mapel = tr.querySelector(".edit-mapel").value;
      const kode_guru = parseInt(tr.querySelector(".edit-guru").value);
      const { error } = await supabaseClient.from("jadwal").update({ kode_mapel, kode_guru }).eq("id", id);
      if (error) Notify.toast("Gagal menyimpan: " + error.message, "error");
      else { btn.textContent = "✅"; Notify.toast("Jam jadwal diperbarui.", "success"); setTimeout(() => btn.textContent = "💾", 1200); }
    });
  });
  wrap.querySelectorAll(".btn-del-jadwal").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const ok = await Notify.confirm(
        "Data absensi yang sudah dicatat untuk jam ini juga akan ikut terhapus. Tindakan ini tidak bisa dibatalkan.",
        { title: "Hapus jam jadwal ini?", confirmText: "Ya, Hapus", danger: true }
      );
      if (!ok) return;
      const tr = e.target.closest("tr");
      const id = tr.dataset.id;
      const { error } = await supabaseClient.from("jadwal").delete().eq("id", id);
      if (error) Notify.toast("Gagal menghapus: " + error.message, "error");
      else { Notify.toast("Jam jadwal dihapus.", "success"); loadJadwalManage(); }
    });
  });
}

async function tambahJadwalPrompt() {
  const hariTerpilih = document.getElementById("jadwal-hari-filter").value;
  const { data: mapelList } = await supabaseClient.from("mapel").select("*").order("kode_mapel");
  const { data: guruList } = await supabaseClient.from("guru").select("*").order("kode_guru");

  const bodyHTML = `
    <div class="nx-form-grid">
      <div class="nx-form-row">
        <label>Hari</label>
        <select id="nf-hari">
          ${["SENIN","SELASA","RABU","KAMIS","JUMAT"].map(h => `<option ${h===hariTerpilih?"selected":""}>${h}</option>`).join("")}
        </select>
      </div>
      <div class="nx-form-row">
        <label>Jam Ke</label>
        <input type="number" id="nf-jam" min="1" placeholder="contoh: 1">
      </div>
      <div class="nx-form-row">
        <label>Tingkat</label>
        <select id="nf-tingkat">
          <option>VII</option><option>VIII</option><option>IX</option>
        </select>
      </div>
      <div class="nx-form-row">
        <label>Nomor Kelas</label>
        <input type="number" id="nf-kelas" min="1" placeholder="contoh: 1">
      </div>
      <div class="nx-form-row" style="grid-column:1/-1;">
        <label>Jam Pelajaran (opsional)</label>
        <input type="text" id="nf-waktu" placeholder="contoh: 07.30 - 08.10">
      </div>
      <div class="nx-form-row">
        <label>Mata Pelajaran</label>
        <select id="nf-mapel">${mapelList.map(m => `<option value="${m.kode_mapel}">${m.nama_mapel}</option>`).join("")}</select>
      </div>
      <div class="nx-form-row">
        <label>Guru Pengampu</label>
        <select id="nf-guru">${guruList.map(g => `<option value="${g.kode_guru}">${g.nama_lengkap}</option>`).join("")}</select>
      </div>
    </div>
  `;

  Notify.form({
    title: "Tambah Jam Jadwal",
    bodyHTML,
    wide: true,
    confirmText: "Simpan",
    onConfirm: async (container) => {
      const jam_ke = parseInt(container.querySelector("#nf-jam").value);
      const nomor_kelas = parseInt(container.querySelector("#nf-kelas").value);
      if (!jam_ke || !nomor_kelas) {
        Notify.toast("Jam ke dan nomor kelas wajib diisi.", "warning");
        return false;
      }
      const payload = {
        hari: container.querySelector("#nf-hari").value,
        jam_ke,
        tingkat: container.querySelector("#nf-tingkat").value,
        nomor_kelas,
        waktu: container.querySelector("#nf-waktu").value || null,
        kode_mapel: container.querySelector("#nf-mapel").value,
        kode_guru: parseInt(container.querySelector("#nf-guru").value)
      };
      const { error } = await supabaseClient.from("jadwal").insert(payload);
      if (error) {
        Notify.toast("Gagal menambah: " + error.message, "error");
        return false;
      }
      Notify.toast("Jam jadwal baru ditambahkan.", "success");
      loadJadwalManage();
    }
  });
}

// ---------------- GURU MANAGE ----------------
async function loadGuruManage() {
  const wrap = document.getElementById("guru-table-wrap");
  wrap.innerHTML = `<div class="loading-note">Memuat data...</div>`;
  const { data, error } = await supabaseClient.from("guru").select("*").order("kode_guru");
  if (error) { wrap.innerHTML = `<div class="empty-note">Gagal memuat: ${error.message}</div>`; return; }

  let html = `<table class="data-table"><thead><tr><th>Kode</th><th>Nama Lengkap</th><th>Aktif</th><th></th></tr></thead><tbody>`;
  data.forEach(g => {
    html += `<tr data-kode="${g.kode_guru}">
      <td>${g.kode_guru}</td>
      <td><input type="text" class="edit-nama-guru" value="${g.nama_lengkap.replace(/"/g,'&quot;')}" style="width:100%;border:1px solid var(--line-strong);border-radius:6px;padding:5px 8px;"></td>
      <td><input type="checkbox" class="edit-aktif-guru" ${g.aktif ? "checked" : ""}></td>
      <td><button class="action-icon-btn btn-save-guru" title="Simpan">💾</button></td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll(".btn-save-guru").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const tr = e.target.closest("tr");
      const kode = tr.dataset.kode;
      const nama_lengkap = tr.querySelector(".edit-nama-guru").value;
      const aktif = tr.querySelector(".edit-aktif-guru").checked;
      const { error } = await supabaseClient.from("guru").update({ nama_lengkap, aktif }).eq("kode_guru", kode);
      if (error) Notify.toast("Gagal menyimpan: " + error.message, "error");
      else { btn.textContent = "✅"; Notify.toast("Data guru diperbarui.", "success"); setTimeout(() => btn.textContent = "💾", 1200); }
    });
  });
}

async function tambahGuru() {
  const kode = document.getElementById("guru-kode-baru").value;
  const nama = document.getElementById("guru-nama-baru").value.trim();
  if (!kode || !nama) { Notify.toast("Isi kode dan nama guru.", "warning"); return; }
  const { error } = await supabaseClient.from("guru").insert({ kode_guru: parseInt(kode), nama_lengkap: nama });
  if (error) { Notify.toast("Gagal menambah: " + error.message, "error"); return; }
  Notify.toast("Guru baru ditambahkan.", "success");
  document.getElementById("guru-kode-baru").value = "";
  document.getElementById("guru-nama-baru").value = "";
  loadGuruManage();
}

// ---------------- MAPEL MANAGE ----------------
async function loadMapelManage() {
  const wrap = document.getElementById("mapel-table-wrap");
  wrap.innerHTML = `<div class="loading-note">Memuat data...</div>`;
  const { data, error } = await supabaseClient.from("mapel").select("*").order("kode_mapel");
  if (error) { wrap.innerHTML = `<div class="empty-note">Gagal memuat: ${error.message}</div>`; return; }

  let html = `<table class="data-table"><thead><tr><th>Kode</th><th>Nama Mapel</th><th></th></tr></thead><tbody>`;
  data.forEach(m => {
    html += `<tr data-kode="${m.kode_mapel}">
      <td>${m.kode_mapel}</td>
      <td><input type="text" class="edit-nama-mapel" value="${m.nama_mapel.replace(/"/g,'&quot;')}" style="width:100%;border:1px solid var(--line-strong);border-radius:6px;padding:5px 8px;"></td>
      <td><button class="action-icon-btn btn-save-mapel" title="Simpan">💾</button></td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll(".btn-save-mapel").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const tr = e.target.closest("tr");
      const kode = tr.dataset.kode;
      const nama_mapel = tr.querySelector(".edit-nama-mapel").value;
      const { error } = await supabaseClient.from("mapel").update({ nama_mapel }).eq("kode_mapel", kode);
      if (error) Notify.toast("Gagal menyimpan: " + error.message, "error");
      else { btn.textContent = "✅"; Notify.toast("Data mapel diperbarui.", "success"); setTimeout(() => btn.textContent = "💾", 1200); }
    });
  });
}

async function tambahMapel() {
  const kode = document.getElementById("mapel-kode-baru").value.trim().toUpperCase();
  const nama = document.getElementById("mapel-nama-baru").value.trim();
  if (!kode || !nama) { Notify.toast("Isi kode dan nama mapel.", "warning"); return; }
  const { error } = await supabaseClient.from("mapel").insert({ kode_mapel: kode, nama_mapel: nama });
  if (error) { Notify.toast("Gagal menambah: " + error.message, "error"); return; }
  Notify.toast("Mapel baru ditambahkan.", "success");
  document.getElementById("mapel-kode-baru").value = "";
  document.getElementById("mapel-nama-baru").value = "";
  loadMapelManage();
}

// ---------------- AKUN MANAGE ----------------
async function loadAkunManage() {
  const wrap = document.getElementById("akun-table-wrap");
  wrap.innerHTML = `<div class="loading-note">Memuat data...</div>`;
  const { data, error } = await supabaseClient.from("profiles").select("*").order("nama_lengkap");
  if (error) { wrap.innerHTML = `<div class="empty-note">Gagal memuat: ${error.message}</div>`; return; }

  let html = `<table class="data-table"><thead><tr><th>Nama Lengkap</th><th>Peran</th><th></th></tr></thead><tbody>`;
  data.forEach(p => {
    html += `<tr data-id="${p.id}">
      <td><input type="text" class="edit-nama-akun" value="${(p.nama_lengkap || "").replace(/"/g,'&quot;')}" style="width:100%;border:1px solid var(--line-strong);border-radius:6px;padding:5px 8px;"></td>
      <td>
        <select class="edit-role">
          <option value="guru_piket" ${p.role === "guru_piket" ? "selected" : ""}>Guru Piket</option>
          <option value="kepala_sekolah" ${p.role === "kepala_sekolah" ? "selected" : ""}>Kepala Sekolah</option>
        </select>
      </td>
      <td><button class="action-icon-btn btn-save-role" title="Simpan">💾</button></td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll(".btn-save-role").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const tr = e.target.closest("tr");
      const id = tr.dataset.id;
      const nama_lengkap = tr.querySelector(".edit-nama-akun").value.trim();
      const role = tr.querySelector(".edit-role").value;
      if (!nama_lengkap) { Notify.toast("Nama lengkap tidak boleh kosong.", "warning"); return; }
      const { error } = await supabaseClient.from("profiles").update({ nama_lengkap, role }).eq("id", id);
      if (error) Notify.toast("Gagal menyimpan: " + error.message, "error");
      else { btn.textContent = "✅"; Notify.toast("Data akun diperbarui.", "success"); setTimeout(() => btn.textContent = "💾", 1200); }
    });
  });
}

// Klien Supabase kedua yang TIDAK menyimpan sesi (persistSession:false) — dipakai
// khusus untuk auth.signUp() membuat akun baru, supaya sesi login Kepala Sekolah
// yang sedang aktif di klien utama tidak ikut tertimpa/ter-logout.
function getAuthCreateClient() {
  if (!window._authCreateClient) {
    window._authCreateClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }
  return window._authCreateClient;
}

async function tambahAkunPrompt() {
  const bodyHTML = `
    <div class="nx-form-row">
      <label>Nama Lengkap</label>
      <input type="text" id="nf-akun-nama" placeholder="Contoh: Siti Aminah, S.Pd.">
    </div>
    <div class="nx-form-row">
      <label>Email</label>
      <input type="email" id="nf-akun-email" placeholder="nama@sekolah.sch.id">
    </div>
    <div class="nx-form-row">
      <label>Kata Sandi Awal</label>
      <input type="text" id="nf-akun-password" placeholder="Minimal 6 karakter">
    </div>
    <div class="nx-form-row">
      <label>Peran</label>
      <select id="nf-akun-role">
        <option value="guru_piket">Guru Piket</option>
        <option value="kepala_sekolah">Kepala Sekolah</option>
      </select>
    </div>
    <p style="font-size:0.8rem;color:var(--ink-soft);margin-top:-4px;">
      Nama lengkap ini akan langsung terbaca di seluruh aplikasi (rekap, laporan, dicatat oleh, dsb).
      Jika verifikasi email masih aktif di pengaturan Supabase, guru tsb perlu membuka email konfirmasi dulu sebelum bisa masuk.
    </p>
  `;

  Notify.form({
    title: "Tambah Akun Baru",
    bodyHTML,
    wide: true,
    confirmText: "Buat Akun",
    onConfirm: async (container) => {
      const nama_lengkap = container.querySelector("#nf-akun-nama").value.trim();
      const email = container.querySelector("#nf-akun-email").value.trim();
      const password = container.querySelector("#nf-akun-password").value;
      const role = container.querySelector("#nf-akun-role").value;

      if (!nama_lengkap || !email || !password) {
        Notify.toast("Nama, email, dan kata sandi wajib diisi.", "warning");
        return false;
      }
      if (password.length < 6) {
        Notify.toast("Kata sandi minimal 6 karakter.", "warning");
        return false;
      }

      const authClient = getAuthCreateClient();
      const { data, error } = await authClient.auth.signUp({
        email,
        password,
        options: { data: { nama_lengkap } }
      });

      if (error) {
        Notify.toast("Gagal membuat akun: " + error.message, "error");
        return false;
      }

      const newUserId = data.user ? data.user.id : null;
      if (newUserId && role === "kepala_sekolah") {
        // beri jeda singkat supaya trigger handle_new_user selesai membuat baris profiles dulu
        await new Promise(resolve => setTimeout(resolve, 800));
        const { error: roleErr } = await supabaseClient.from("profiles").update({ role }).eq("id", newUserId);
        if (roleErr) {
          Notify.toast("Akun dibuat, tapi gagal mengatur peran Kepala Sekolah: " + roleErr.message, "warning");
        }
      }

      Notify.toast("Akun baru berhasil dibuat.", "success");
      loadAkunManage();
    }
  });
}

// =========================================================
// LAPORAN PERIODE (rentang tanggal) — dipakai oleh Kepala Sekolah & Guru Piket
// prefix: "kepsek" atau "piket" -> menentukan id elemen DOM yang dipakai
// =========================================================
function initLaporanPeriode(prefix) {
  const dariInput = document.getElementById(`${prefix}-lap-dari`);
  const sampaiInput = document.getElementById(`${prefix}-lap-sampai`);
  if (!dariInput || !sampaiInput) return;

  // default: dari awal bulan berjalan sampai hari ini (hanya diisi sekali)
  if (!dariInput.value || !sampaiInput.value) {
    const now = new Date();
    const awalBulan = new Date(now.getFullYear(), now.getMonth(), 1);
    dariInput.value = awalBulan.toISOString().slice(0, 10);
    sampaiInput.value = now.toISOString().slice(0, 10);
  }

  const btn = document.getElementById(`${prefix}-lap-btn-tampilkan`);
  btn.onclick = () => loadLaporanPeriode(prefix); // onclick (bukan addEventListener) supaya tidak dobel saat tab dibuka berkali-kali

  loadLaporanPeriode(prefix);
}

async function loadLaporanPeriode(prefix) {
  const dari = document.getElementById(`${prefix}-lap-dari`).value;
  const sampai = document.getElementById(`${prefix}-lap-sampai`).value;
  const summaryEl = document.getElementById(`${prefix}-lap-summary`);
  const guruTableEl = document.getElementById(`${prefix}-lap-guru-table`);
  const topAlpaEl = document.getElementById(`${prefix}-lap-top-alpa`);

  if (!dari || !sampai) { Notify.toast("Pilih rentang tanggal dulu.", "warning"); return; }
  if (dari > sampai) { Notify.toast("Tanggal \"Dari\" tidak boleh setelah tanggal \"Sampai\".", "warning"); return; }

  summaryEl.innerHTML = "";
  guruTableEl.innerHTML = `<div class="loading-note">Memuat data...</div>`;
  topAlpaEl.innerHTML = `<div class="loading-note">Memuat data...</div>`;

  const { data, error } = await supabaseClient
    .from("absensi_kelas")
    .select("*")
    .gte("tanggal", dari)
    .lte("tanggal", sampai);

  if (error) {
    guruTableEl.innerHTML = `<div class="empty-note">Gagal memuat: ${error.message}</div>`;
    topAlpaEl.innerHTML = "";
    return;
  }

  const rows = flattenKelasRows(data).filter(r => r.status);

  renderLaporanSummary(prefix, rows);
  renderLaporanChart(prefix, rows, dari, sampai);
  renderLaporanPerGuru(prefix, rows);
  renderLaporanTopTidakHadir(prefix, rows);
}

function renderLaporanSummary(prefix, rows) {
  const counts = { Hadir: 0, Izin: 0, Sakit: 0, Alpa: 0, "Tugas Luar": 0 };
  rows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

  const strip = document.getElementById(`${prefix}-lap-summary`);
  strip.innerHTML = `
    <div class="summary-chip ok"><div class="num">${counts.Hadir}</div><div class="lbl">Hadir</div></div>
    <div class="summary-chip izin"><div class="num">${counts.Izin}</div><div class="lbl">Izin</div></div>
    <div class="summary-chip"><div class="num">${counts.Sakit}</div><div class="lbl">Sakit</div></div>
    <div class="summary-chip alpa"><div class="num">${counts.Alpa}</div><div class="lbl">Alpa</div></div>
    <div class="summary-chip"><div class="num">${counts["Tugas Luar"]}</div><div class="lbl">Tugas Luar</div></div>
  `;
}

// Grafik garis: jumlah tiap status per hari (hanya hari SENIN-JUMAT) dalam rentang tanggal
function renderLaporanChart(prefix, rows, dari, sampai) {
  const canvas = document.getElementById(`${prefix}-lap-chart`);
  if (!canvas || typeof Chart === "undefined") return;

  const dateList = [];
  const byDate = {};
  let cursor = new Date(dari + "T00:00:00");
  const end = new Date(sampai + "T00:00:00");
  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow >= 1 && dow <= 5) { // Senin(1) s.d. Jumat(5) -- hari efektif PBM
      const iso = cursor.toISOString().slice(0, 10);
      dateList.push(iso);
      byDate[iso] = { Hadir: 0, Izin: 0, Sakit: 0, Alpa: 0, "Tugas Luar": 0 };
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  rows.forEach(r => {
    if (byDate[r.tanggal] && byDate[r.tanggal][r.status] !== undefined) {
      byDate[r.tanggal][r.status]++;
    }
  });

  const labels = dateList.map(d => {
    const dd = new Date(d + "T00:00:00");
    return dd.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  });

  const seriesDef = [
    { key: "Hadir", color: "#2F7355" },
    { key: "Izin", color: "#C9962C" },
    { key: "Sakit", color: "#3A6EA5" },
    { key: "Alpa", color: "#B23A2E" },
    { key: "Tugas Luar", color: "#1D3557" }
  ];
  const datasets = seriesDef.map(s => ({
    label: s.key,
    data: dateList.map(d => byDate[d][s.key]),
    borderColor: s.color,
    backgroundColor: s.color,
    tension: 0.25,
    pointRadius: dateList.length > 40 ? 0 : 3
  }));

  if (laporanCharts[prefix]) { laporanCharts[prefix].destroy(); }

  if (dateList.length === 0) {
    laporanCharts[prefix] = null;
    return;
  }

  laporanCharts[prefix] = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { position: "bottom" } }
    }
  });
}

// Rekap total per guru dalam rentang tanggal
function renderLaporanPerGuru(prefix, rows) {
  const el = document.getElementById(`${prefix}-lap-guru-table`);
  const byGuru = {};
  rows.forEach(r => {
    const key = r.kode_guru;
    if (!byGuru[key]) byGuru[key] = { nama: r.nama_guru || "-", Hadir: 0, Izin: 0, Sakit: 0, Alpa: 0, "Tugas Luar": 0, total: 0 };
    if (byGuru[key][r.status] !== undefined) byGuru[key][r.status]++;
    byGuru[key].total++;
  });

  const list = Object.values(byGuru).sort((a, b) => a.nama.localeCompare(b.nama));
  if (list.length === 0) {
    el.innerHTML = `<div class="empty-note">Belum ada data absensi pada rentang tanggal ini.</div>`;
    return;
  }

  let html = `<table class="data-table"><thead><tr>
    <th>Guru</th><th>Hadir</th><th>Izin</th><th>Sakit</th><th>Alpa</th><th>Tugas Luar</th><th>Total Jam</th>
  </tr></thead><tbody>`;
  list.forEach(g => {
    html += `<tr>
      <td>${g.nama}</td>
      <td>${g.Hadir}</td><td>${g.Izin}</td><td>${g.Sakit}</td><td>${g.Alpa}</td><td>${g["Tugas Luar"]}</td>
      <td><strong>${g.total}</strong></td>
    </tr>`;
  });
  html += `</tbody></table>`;
  el.innerHTML = html;
}

// "Guru langganan tidak hadir" — top 10 guru berdasarkan jumlah Izin+Sakit+Alpa
function renderLaporanTopTidakHadir(prefix, rows) {
  const el = document.getElementById(`${prefix}-lap-top-alpa`);
  const byGuru = {};
  rows.forEach(r => {
    if (!["Izin", "Sakit", "Alpa"].includes(r.status)) return;
    const key = r.kode_guru;
    if (!byGuru[key]) byGuru[key] = { nama: r.nama_guru || "-", Izin: 0, Sakit: 0, Alpa: 0, total: 0 };
    byGuru[key][r.status]++;
    byGuru[key].total++;
  });

  const list = Object.values(byGuru).filter(g => g.total > 0).sort((a, b) => b.total - a.total).slice(0, 10);
  if (list.length === 0) {
    el.innerHTML = `<div class="empty-note">Tidak ada guru izin/sakit/alpa pada rentang tanggal ini. 🎉</div>`;
    return;
  }

  const maxTotal = list[0].total;
  let html = `<div class="top-alpa-list">`;
  list.forEach((g, i) => {
    const pct = Math.max(6, Math.round((g.total / maxTotal) * 100));
    html += `
      <div class="top-alpa-row">
        <div class="top-alpa-rank">${i + 1}</div>
        <div class="top-alpa-info">
          <div class="top-alpa-nama">${g.nama}</div>
          <div class="top-alpa-bar-track"><div class="top-alpa-bar-fill" style="width:${pct}%"></div></div>
          <div class="top-alpa-detail">Izin ${g.Izin} &middot; Sakit ${g.Sakit} &middot; Alpa ${g.Alpa}</div>
        </div>
        <div class="top-alpa-total">${g.total}</div>
      </div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
}

// =========================================================
// PENGATURAN KOP SURAT (Kepala Sekolah) — dipakai untuk cetak laporan
// =========================================================
function escAttr(v) {
  return (v || "").toString().replace(/"/g, "&quot;");
}

async function loadPengaturanKop() {
  const wrap = document.getElementById("pengaturan-form-wrap");
  wrap.innerHTML = `<div class="loading-note">Memuat data...</div>`;
  const { data, error } = await supabaseClient.from("pengaturan_sekolah").select("*").eq("id", 1).single();
  if (error) {
    wrap.innerHTML = `<div class="empty-note">Gagal memuat: ${error.message}<br><span style="font-size:0.8rem;">Pastikan migrasi SQL 04_pengaturan_dan_akun.sql sudah dijalankan.</span></div>`;
    return;
  }
  pengaturanSekolahCache = data;
  renderPengaturanForm(data);
}

function renderPengaturanForm(p) {
  const wrap = document.getElementById("pengaturan-form-wrap");
  wrap.innerHTML = `
    <div class="nx-form-grid" style="margin-bottom:6px;">
      <div class="nx-form-row" style="grid-column:1/-1;">
        <label>Nama Pemerintah</label>
        <input type="text" id="ps-pemerintah" value="${escAttr(p.pemerintah)}" placeholder="Contoh: PEMERINTAH KOTA MAKASSAR">
      </div>
      <div class="nx-form-row" style="grid-column:1/-1;">
        <label>Nama Instansi / Dinas</label>
        <input type="text" id="ps-instansi" value="${escAttr(p.instansi)}" placeholder="Contoh: DINAS PENDIDIKAN">
      </div>
      <div class="nx-form-row" style="grid-column:1/-1;">
        <label>Nama Sekolah</label>
        <input type="text" id="ps-sekolah" value="${escAttr(p.sekolah)}" placeholder="Contoh: UPTD SPF SMP NEGERI 16 MAKASSAR">
      </div>
      <div class="nx-form-row" style="grid-column:1/-1;">
        <label>Alamat Sekolah</label>
        <input type="text" id="ps-alamat" value="${escAttr(p.alamat)}" placeholder="Contoh: Jl. Contoh No. 1, Kec. ..., Makassar">
      </div>
      <div class="nx-form-row">
        <label>Asal Kota (untuk tanggal di lembar cetak)</label>
        <input type="text" id="ps-asal-kota" value="${escAttr(p.asal_kota)}" placeholder="Contoh: Makassar">
      </div>
    </div>
    <div class="nx-form-grid" style="margin-top:2px;">
      <div class="nx-form-row" style="grid-column:1/-1;">
        <label style="margin-top:6px;">Tanda Tangan Kepala Sekolah (tampil di lembar cetak)</label>
      </div>
      <div class="nx-form-row">
        <label>Nama Kepala Sekolah</label>
        <input type="text" id="ps-nama-kepsek" value="${escAttr(p.nama_kepala_sekolah)}" placeholder="Contoh: Drs. Nama Lengkap, M.Pd.">
      </div>
      <div class="nx-form-row">
        <label>NIP Kepala Sekolah</label>
        <input type="text" id="ps-nip-kepsek" value="${escAttr(p.nip_kepala_sekolah)}" placeholder="Contoh: 19xxxxxx xxxxxx x xxx">
      </div>
    </div>
    <div class="nx-form-grid">
      <div class="nx-form-row">
        <label>Logo Kiri (contoh: logo Pemkot / Tut Wuri Handayani)</label>
        <div class="logo-upload-box">
          <img id="ps-logo-kiri-preview" src="${p.logo_kiri_url || ""}" class="${p.logo_kiri_url ? "" : "hidden"}">
          <input type="file" id="ps-logo-kiri-file" accept="image/*">
        </div>
      </div>
      <div class="nx-form-row">
        <label>Logo Kanan (contoh: logo sekolah)</label>
        <div class="logo-upload-box">
          <img id="ps-logo-kanan-preview" src="${p.logo_kanan_url || ""}" class="${p.logo_kanan_url ? "" : "hidden"}">
          <input type="file" id="ps-logo-kanan-file" accept="image/*">
        </div>
      </div>
    </div>
    <button class="btn btn-primary btn-small" id="btn-simpan-pengaturan" style="margin-top:16px;">💾 Simpan Pengaturan</button>
    <div class="error-msg" id="pengaturan-error"></div>
  `;

  ["kiri", "kanan"].forEach(sisi => {
    document.getElementById(`ps-logo-${sisi}-file`).addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const img = document.getElementById(`ps-logo-${sisi}-preview`);
      img.src = URL.createObjectURL(file);
      img.classList.remove("hidden");
    });
  });

  document.getElementById("btn-simpan-pengaturan").addEventListener("click", simpanPengaturanKop);
}

// Upload file logo (jika dipilih) ke Supabase Storage bucket "logo-sekolah".
// Mengembalikan undefined jika tidak ada file baru dipilih (=> kolom tidak diubah).
async function uploadLogoJikaAda(sisi) {
  const fileInput = document.getElementById(`ps-logo-${sisi}-file`);
  const file = fileInput.files[0];
  if (!file) return undefined;
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `logo-${sisi}-${Date.now()}.${ext}`;
  const { error } = await supabaseClient.storage.from("logo-sekolah").upload(path, file, { upsert: true });
  if (error) throw new Error(`Gagal mengunggah logo ${sisi}: ${error.message}`);
  const { data } = supabaseClient.storage.from("logo-sekolah").getPublicUrl(path);
  return data.publicUrl;
}

async function simpanPengaturanKop() {
  const btn = document.getElementById("btn-simpan-pengaturan");
  const errBox = document.getElementById("pengaturan-error");
  errBox.textContent = "";
  btn.disabled = true; btn.textContent = "Menyimpan...";

  try {
    const payload = {
      id: 1,
      pemerintah: document.getElementById("ps-pemerintah").value.trim(),
      instansi: document.getElementById("ps-instansi").value.trim(),
      sekolah: document.getElementById("ps-sekolah").value.trim(),
      alamat: document.getElementById("ps-alamat").value.trim(),
      asal_kota: document.getElementById("ps-asal-kota").value.trim(),
      nama_kepala_sekolah: document.getElementById("ps-nama-kepsek").value.trim(),
      nip_kepala_sekolah: document.getElementById("ps-nip-kepsek").value.trim(),
      updated_by: currentUser.id
    };
    const logoKiriUrl = await uploadLogoJikaAda("kiri");
    const logoKananUrl = await uploadLogoJikaAda("kanan");
    if (logoKiriUrl !== undefined) payload.logo_kiri_url = logoKiriUrl;
    if (logoKananUrl !== undefined) payload.logo_kanan_url = logoKananUrl;

    const { data, error } = await supabaseClient
      .from("pengaturan_sekolah")
      .upsert(payload, { onConflict: "id" })
      .select()
      .single();
    if (error) throw error;

    pengaturanSekolahCache = data;
    Notify.toast("Pengaturan kop surat tersimpan.", "success");
    renderPengaturanForm(data);
  } catch (e) {
    errBox.textContent = e.message;
    Notify.toast("Gagal menyimpan pengaturan.", "error");
    btn.disabled = false; btn.textContent = "💾 Simpan Pengaturan";
  }
}

// =========================================================
// CETAK LAPORAN (memakai kop surat dari Pengaturan)
// =========================================================
async function getPengaturanSekolah() {
  if (pengaturanSekolahCache) return pengaturanSekolahCache;
  const { data, error } = await supabaseClient.from("pengaturan_sekolah").select("*").eq("id", 1).single();
  if (error || !data) { pengaturanSekolahCache = {}; return {}; }
  pengaturanSekolahCache = data;
  return data;
}

function buildKopHTML(p) {
  return `
    <div class="cetak-kop">
      <div class="cetak-logo">${p.logo_kiri_url ? `<img src="${p.logo_kiri_url}">` : ""}</div>
      <div class="cetak-kop-text">
        <div class="cetak-pemerintah">${(p.pemerintah || "").toUpperCase()}</div>
        <div class="cetak-instansi">${(p.instansi || "").toUpperCase()}</div>
        <div class="cetak-sekolah">${(p.sekolah || "").toUpperCase()}</div>
        <div class="cetak-alamat">${p.alamat || ""}</div>
      </div>
      <div class="cetak-logo">${p.logo_kanan_url ? `<img src="${p.logo_kanan_url}">` : ""}</div>
    </div>
    <div class="cetak-garis"></div>
  `;
}

function bukaJendelaCetak(p, judul, subjudul, kontenHTML) {
  const win = window.open("", "_blank");
  if (!win) {
    Notify.toast("Popup diblokir browser. Izinkan popup untuk situs ini agar bisa mencetak.", "warning");
    return;
  }
  const tanggalCetak = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  win.document.write(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>${judul}</title>
    <style>
      body { font-family: 'Times New Roman', Georgia, serif; color:#111; margin:32px 40px; }
      .cetak-kop { display:flex; align-items:center; gap:14px; }
      .cetak-logo { width:70px; flex-shrink:0; text-align:center; }
      .cetak-logo img { max-width:70px; max-height:70px; }
      .cetak-kop-text { flex:1; text-align:center; }
      .cetak-pemerintah, .cetak-instansi { font-size:15px; font-weight:bold; line-height:1.3; }
      .cetak-sekolah { font-size:18px; font-weight:bold; line-height:1.3; }
      .cetak-alamat { font-size:12px; margin-top:2px; }
      .cetak-garis { border-bottom:3px solid #111; border-top:1px solid #111; height:4px; margin:8px 0 18px; }
      .cetak-judul { text-align:center; margin-bottom:4px; }
      .cetak-judul h2 { margin:0; font-size:16px; text-decoration:underline; }
      .cetak-judul .sub { text-align:center; font-size:13px; margin-bottom:20px; }
      table { width:100%; border-collapse:collapse; font-size:12px; margin-top:10px; }
      th, td { border:1px solid #333; padding:5px 8px; text-align:left; }
      th { background:#eee; }
      .pill-status { border:none !important; padding:0 !important; background:none !important; font-weight:normal !important; }
      .cetak-ttd { margin-top:50px; display:flex; justify-content:flex-end; }
      .cetak-ttd-box { text-align:center; font-size:13px; width:240px; }
      .cetak-ttd-box .spasi { height:70px; }
      .cetak-ttd-nama { font-weight:bold; text-decoration:underline; }
      .cetak-ttd-nip { margin-top:2px; }
      @media print { body { margin:14mm 16mm; } }
    </style>
    </head><body>
      ${buildKopHTML(p)}
      <div class="cetak-judul"><h2>${judul}</h2><div class="sub">${subjudul}</div></div>
      ${kontenHTML}
      <div class="cetak-ttd">
        <div class="cetak-ttd-box">
          <div>${p.asal_kota || "-"}, ${tanggalCetak}</div>
          <div>Kepala Sekolah</div>
          <div class="spasi"></div>
          <div class="cetak-ttd-nama">${p.nama_kepala_sekolah || "____________________________"}</div>
          <div class="cetak-ttd-nip">NIP. ${p.nip_kepala_sekolah || "-"}</div>
        </div>
      </div>
    </body></html>`);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 450);
}

async function cetakLaporanPeriode(prefix) {
  const dari = document.getElementById(`${prefix}-lap-dari`).value;
  const sampai = document.getElementById(`${prefix}-lap-sampai`).value;
  const tableEl = document.getElementById(`${prefix}-lap-guru-table`).querySelector("table");
  if (!dari || !sampai || !tableEl) {
    Notify.toast("Tampilkan laporan dulu (klik \"Tampilkan\") sebelum mencetak.", "warning");
    return;
  }
  const p = await getPengaturanSekolah();
  const fmt = (d) => new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  bukaJendelaCetak(p, "REKAP KEHADIRAN GURU PER PERIODE", `Periode ${fmt(dari)} s.d. ${fmt(sampai)}`, tableEl.outerHTML);
}

async function cetakRekapHarian(prefix) {
  const tanggal = document.getElementById(`${prefix}-rekap-tanggal`).value;
  const tableEl = document.getElementById(`${prefix}-rekap-table-wrap`).querySelector("table");
  if (!tanggal || !tableEl) {
    Notify.toast("Belum ada data untuk dicetak pada tanggal ini.", "warning");
    return;
  }
  const p = await getPengaturanSekolah();
  bukaJendelaCetak(p, "REKAP ABSENSI GURU HARIAN", formatTanggalIndo(tanggal), tableEl.outerHTML);
}