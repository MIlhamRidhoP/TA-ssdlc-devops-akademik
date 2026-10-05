const KARAKTER = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Semua nilai dinamis di halaman HTML wajib lewat fungsi ini
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => KARAKTER[c]);

module.exports = { escapeHtml };
