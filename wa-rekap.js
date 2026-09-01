// =========================================================
// WA-REKAP.JS — Generate rekap absensi & kirim ke WhatsApp
// Tidak menggunakan WhatsApp API — hanya membuka WhatsApp
// dengan teks yang sudah disiapkan (Anda pilih grup & kirim manual)
// =========================================================

const STATUS_EMOJI = {
  "Hadir": "✅",
  "Izin": "🟡",
  "Sakit": "🔵",
  "Alpa": "⛔",
  "Tugas Luar": "🟣"
};

async function fetchFullDayAbsensi(tanggal) {
  const { data, error } = await supabaseClient
    .from("absensi_kelas")
    .select("*, pencatat:dicatat_oleh(nama_lengkap)")
    .eq("tanggal", tanggal);

  if (error) throw error;

  // flattenKelasRows & tingkatRank didefinisikan di app.js (dipakai bersama dengan tab Rekap Kepsek)
  const rows = flattenKelasRows(data).filter(r => r.status);
  rows.sort((a, b) => {
    if (a.tingkat !== b.tingkat) return tingkatRank(a.tingkat) - tingkatRank(b.tingkat);
    if (a.nomor_kelas !== b.nomor_kelas) return a.nomor_kelas - b.nomor_kelas;
    return a.jam_ke - b.jam_ke;
  });
  return rows;
}

function formatTanggalIndo(tanggalStr) {
  const d = new Date(tanggalStr + "T00:00:00");
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// opts.mode: "semua" (default) = semua status; "tidak_hadir" = hanya Izin/Sakit/Alpa
function buildRekapText(tanggal, rows, opts = {}) {
  const sekolah = "UPTD SPF SMP Negeri 16 Makassar";
  const tanggalIndo = formatTanggalIndo(tanggal);
  const mode = opts.mode || "semua";
  const statusesToShow = mode === "tidak_hadir" ? ["Izin", "Sakit", "Alpa"] : STATUS_LIST;
  const judul = mode === "tidak_hadir" ? "📋 *REKAP GURU TIDAK HADIR*" : "📋 *REKAP ABSENSI GURU*";

  const filteredRows = rows.filter(r => statusesToShow.includes(r.status));

  if (filteredRows.length === 0) {
    const kosongMsg = mode === "tidak_hadir"
      ? "Semua guru hadir sesuai jadwal pada tanggal ini. Tidak ada guru izin/sakit/alpa."
      : "Belum ada data absensi yang dicatat pada tanggal ini.";
    return `${judul}\n${sekolah}\n🗓️ ${tanggalIndo}\n\n${kosongMsg}`;
  }

  const groups = {};
  statusesToShow.forEach(s => groups[s] = []);
  filteredRows.forEach(r => groups[r.status] && groups[r.status].push(r));

  let text = `${judul}\n${sekolah}\n🗓️ ${tanggalIndo}\n`;

  statusesToShow.forEach(status => {
    const list = groups[status];
    if (list.length === 0) return;
    text += `\n${STATUS_EMOJI[status]} *${status.toUpperCase()}* (${list.length})\n`;
    list.forEach((r, i) => {
      text += `${i + 1}. ${r.nama_guru || "-"} — Kelas ${r.tingkat}.${r.nomor_kelas}, jam ke-${r.jam_ke} (${r.nama_mapel || "-"})\n`;
      if (status !== "Hadir" && r.catatan_tugas) {
        text += `    📝 Tugas: ${r.catatan_tugas}\n`;
      }
    });
  });

  const totalTercatat = filteredRows.length;
  text += `\n_Total ${totalTercatat} jam pelajaran tercatat._`;
  if (opts.dicatatOleh) {
    text += `\n_Dicatat oleh: ${opts.dicatatOleh}_`;
  }
  return text;
}

async function openKirimRekapModal(tanggal) {
  let rows;
  try {
    rows = await fetchFullDayAbsensi(tanggal);
  } catch (e) {
    Notify.toast("Gagal memuat data rekap: " + e.message, "error");
    return;
  }

  const dicatatOleh = currentProfile ? currentProfile.nama_lengkap : "";
  const buatTeks = (mode) => buildRekapText(tanggal, rows, { mode, dicatatOleh });

  const bodyHTML = `
    <p style="font-size:0.85rem; color:var(--ink-soft); margin-top:-4px;">
      Pratinjau pesan untuk <strong>${formatTanggalIndo(tanggal)}</strong>. Pilih jenis rekap, lalu klik <em>Buka WhatsApp</em> untuk memilih grup sekolah dan mengirim, atau salin teksnya secara manual.
    </p>
    <div class="field" style="margin-bottom:12px;">
      <label>Jenis Rekap</label>
      <select id="wa-mode-select">
        <option value="semua">Semua Kehadiran (Hadir, Izin, Sakit, Alpa, Tugas Luar)</option>
        <option value="tidak_hadir">Hanya Tidak Hadir (Izin, Sakit, Alpa)</option>
      </select>
    </div>
    <div class="wa-preview" id="wa-preview-text">${escapeHtml(buatTeks("semua"))}</div>
    <div class="wa-actions">
      <button class="btn btn-wa" id="btn-open-wa">💬 Buka WhatsApp</button>
      <button class="btn btn-ghost" id="btn-copy-wa">📋 Salin Teks</button>
    </div>
  `;

  const modal = Notify.form({
    title: "Kirim Rekap ke WhatsApp",
    bodyHTML,
    wide: true,
    confirmText: "Tutup",
    onConfirm: () => true
  });

  const modeSelect = modal.container.querySelector("#wa-mode-select");
  const previewBox = modal.container.querySelector("#wa-preview-text");

  modeSelect.addEventListener("change", () => {
    previewBox.innerHTML = escapeHtml(buatTeks(modeSelect.value));
  });

  modal.container.querySelector("#btn-open-wa").addEventListener("click", () => {
    const url = "https://wa.me/?text=" + encodeURIComponent(buatTeks(modeSelect.value));
    window.open(url, "_blank");
  });
  modal.container.querySelector("#btn-copy-wa").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(buatTeks(modeSelect.value));
      Notify.toast("Teks rekap berhasil disalin.", "success");
    } catch {
      Notify.toast("Gagal menyalin otomatis. Silakan blok teks lalu salin manual.", "warning");
    }
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}