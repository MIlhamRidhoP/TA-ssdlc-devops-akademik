require('dotenv').config();

const SEMESTER_RE = /^\d{4}-(ganjil|genap)$/;

const SEMESTER_AKTIF = process.env.SEMESTER_AKTIF;
if (!SEMESTER_RE.test(SEMESTER_AKTIF || '')) {
  throw new Error('SEMESTER_AKTIF wajib diisi dengan format YYYY-ganjil atau YYYY-genap');
}

// Urutan: 2025-genap < 2026-ganjil < 2026-genap
const semesterKey = (s) => {
  const [tahun, periode] = s.split('-');
  return Number(tahun) * 2 + (periode === 'genap' ? 1 : 0);
};

const BOBOT = { A: 4, AB: 3.5, B: 3, BC: 2.5, C: 2, D: 1, E: 0 };

const kuotaDariIps = (ips) => {
  if (ips === null) return 19;
  if (ips >= 3) return 24;
  if (ips >= 2.5) return 21;
  if (ips >= 2) return 18;
  return 15;
};

// IPS dari semester terakhir sebelum `semester` yang punya nilai published
const ipsSebelum = (grades, semester) => {
  const batas = semesterKey(semester);
  const perSemester = new Map();

  for (const g of grades) {
    if (semesterKey(g.semester) >= batas) continue;
    const s = perSemester.get(g.semester) || { bobot: 0, sks: 0 };
    s.bobot += BOBOT[g.nilai_huruf] * g.sks;
    s.sks += g.sks;
    perSemester.set(g.semester, s);
  }

  if (perSemester.size === 0) return null;

  const terakhir = [...perSemester.keys()].sort((a, b) => semesterKey(b) - semesterKey(a))[0];
  const { bobot, sks } = perSemester.get(terakhir);
  return { semester: terakhir, ips: Math.round((bobot / sks) * 100) / 100 };
};

// IPS dari sekumpulan baris { nilai_huruf, sks }, dibulatkan 2 desimal
const hitungIps = (rows) => {
  const sks = rows.reduce((n, r) => n + r.sks, 0);
  if (sks === 0) return null;
  const bobot = rows.reduce((n, r) => n + BOBOT[r.nilai_huruf] * r.sks, 0);
  return Math.round((bobot / sks) * 100) / 100;
};

module.exports = { SEMESTER_RE, SEMESTER_AKTIF, semesterKey, BOBOT, kuotaDariIps, ipsSebelum, hitungIps };
