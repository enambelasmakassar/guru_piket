// =========================================================
// KONFIGURASI SUPABASE
// Ganti dua nilai di bawah ini dengan milik project Supabase Anda.
// Lokasi: Supabase Dashboard -> Project Settings -> API
// =========================================================
const SUPABASE_URL = "https://icblngbkdnceztjycrnm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_SDOtBdU-lYnJfLfKolGp0w_iNdHV-6o";

// Jangan ubah baris di bawah ini
// persistSession + autoRefreshToken: sesi login TETAP tersimpan (localStorage)
// meskipun tab/browser ditutup atau halaman di-refresh — user hanya keluar
// kalau menekan tombol "Keluar" secara eksplisit.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: window.localStorage
  }
});