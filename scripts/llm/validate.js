// Validasi output model sesuai prompts/v2/README.md bagian 7.
// "Lolos skema" = struktur (tipe, required, tanpa properti tambahan). Enum dicek terpisah tanpa membedakan
// huruf besar/kecil (baris "Enum" di README); nilai yang tetap tidak cocok ditandai, bukan membuat parse gagal.
// Temuan bertanda tidak dibuang.

const KUNCI_TEMUAN = ['file', 'baris', 'fungsi', 'jenis', 'cwe', 'kategori_owasp', 'penjelasan', 'sifat', 'keyakinan'];
const KUNCI_VERIFIKASI = ['id_alert', 'alasan', 'putusan', 'keyakinan'];
const OWASP = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10', 'Other'];
const SIFAT = ['vulnerability', 'hardening'];
const KEYAKINAN = ['high', 'medium', 'low'];
const PUTUSAN = ['true_positive', 'false_positive', 'uncertain'];
const TIPE_TEMUAN = {
  file: 'string', baris: 'integer', fungsi: 'string', jenis: 'string', cwe: 'string',
  kategori_owasp: 'string', penjelasan: 'string', sifat: 'string', keyakinan: 'string',
};
const TIPE_VERIFIKASI = { id_alert: 'string', alasan: 'string', putusan: 'string', keyakinan: 'string' };

const cocokTipe = (nilai, tipe) => (tipe === 'integer' ? Number.isInteger(nilai) : typeof nilai === tipe);

const strukturObjek = (obj, tipe) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const kunci = Object.keys(obj);
  if (kunci.some((k) => !(k in tipe))) return false;
  return Object.entries(tipe).every(([k, t]) => k in obj && cocokTipe(obj[k], t));
};

const parseJson = (teks) => {
  try {
    return { ok: true, nilai: JSON.parse(teks) };
  } catch {
    return { ok: false, nilai: null };
  }
};

// Kembalikan nilai kanonik enum, atau null kalau tidak cocok.
const normalEnum = (nilai, daftar) => daftar.find((d) => d.toLowerCase() === String(nilai).trim().toLowerCase()) ?? null;

const cekEnum = (entri, kunci, daftar, tanda) => {
  const kanonik = normalEnum(entri[kunci], daftar);
  if (kanonik === null) {
    if (!tanda.includes('nilai_tidak_valid')) tanda.push('nilai_tidak_valid');
    return entri[kunci];
  }
  return kanonik;
};

// infoFile: [{ path, jumlah_baris }] dari render.bentukKodeSumber.
const validasiTemuan = (t, infoFile) => {
  const tanda = [];
  const hasil = { ...t };
  hasil.kategori_owasp = cekEnum(t, 'kategori_owasp', OWASP, tanda);
  hasil.sifat = cekEnum(t, 'sifat', SIFAT, tanda);
  hasil.keyakinan = cekEnum(t, 'keyakinan', KEYAKINAN, tanda);

  const cwe = t.cwe.trim().toUpperCase();
  if (/^CWE-\d+$/.test(cwe)) hasil.cwe = cwe;
  else tanda.push('cwe_tidak_valid'); // nilai asli disimpan

  const file = infoFile.find((f) => f.path === t.file);
  if (!file) tanda.push('file_tidak_dikenal');
  const barisOk = Number.isInteger(t.baris) && (t.baris === 0 || (t.baris >= 1 && (!file || t.baris <= file.jumlah_baris)));
  if (!barisOk) tanda.push('baris_tidak_valid');
  return { ...hasil, tanda };
};

const validasiDeteksi = (teks, infoFile) => {
  const p = parseJson(teks);
  const v = p.nilai;
  const strukturOk = p.ok && v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).length === 1 && Array.isArray(v.temuan)
    && v.temuan.every((t) => strukturObjek(t, TIPE_TEMUAN));
  if (!strukturOk) return { parse_ok: false, temuan: [] };
  return { parse_ok: true, temuan: v.temuan.map((t) => validasiTemuan(t, infoFile)) };
};

const validasiVerifikasi = (teks, idDikirim) => {
  const p = parseJson(teks);
  if (!p.ok || !strukturObjek(p.nilai, TIPE_VERIFIKASI)) return { parse_ok: false, hasil: null };
  const v = p.nilai;
  const tanda = [];
  const hasil = { ...v };
  hasil.putusan = cekEnum(v, 'putusan', PUTUSAN, tanda);
  hasil.keyakinan = cekEnum(v, 'keyakinan', KEYAKINAN, tanda);
  if (v.id_alert !== idDikirim) tanda.push('id_tidak_cocok');
  return { parse_ok: true, hasil: { ...hasil, tanda } };
};

module.exports = {
  KUNCI_TEMUAN, KUNCI_VERIFIKASI, OWASP, SIFAT, KEYAKINAN, PUTUSAN, validasiDeteksi, validasiVerifikasi, validasiTemuan,
};
