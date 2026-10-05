// Daftar tetap untuk field pilihan. Nilai email, platform, dan jenis dokumen
// juga dibatasi CHECK constraint di migrasi 004 dan 005.
const BANK = ['BCA', 'BNI', 'BRI', 'Mandiri', 'BSI', 'BTN', 'CIMB Niaga', 'Permata'];
const TIPE_EMAIL = ['pribadi', 'kerja', 'alternatif'];
const PLATFORM_SOSIAL = ['linkedin', 'github', 'instagram', 'x', 'facebook'];
const JENIS_DOKUMEN = ['ktp', 'ijazah', 'kartu_keluarga', 'lampiran_cuti'];
const STATUS_VERIFIKASI = ['menunggu', 'terverifikasi', 'ditolak'];

const MAKS_EMAIL = 5;

module.exports = { BANK, TIPE_EMAIL, PLATFORM_SOSIAL, JENIS_DOKUMEN, STATUS_VERIFIKASI, MAKS_EMAIL };
