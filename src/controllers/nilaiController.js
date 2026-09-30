const model = require('../models/nilaiModel');
const krsModel = require('../models/krsModel');
const audit = require('../utils/audit');
const AppError = require('../utils/AppError');
const { UUID_RE, requireUuid } = require('../utils/validators');
const { SEMESTER_RE, BOBOT, semesterKey, hitungIps } = require('../config/akademik');

const HURUF = Object.keys(BOBOT);

const optionalSemester = (v) => {
  if (v === undefined) return null;
  if (typeof v !== 'string' || !SEMESTER_RE.test(v)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Parameter semester tidak valid');
  }
  return v;
};

const optionalUuid = (v, nama) => {
  if (v === undefined) return null;
  if (typeof v !== 'string' || !UUID_RE.test(v)) {
    throw new AppError(400, 'VALIDATION_ERROR', `Parameter ${nama} tidak valid`);
  }
  return v;
};

exports.setNilai = async (req, res) => {
  requireUuid(req.params.krs_id);
  const { nilai_huruf: huruf } = req.body || {};
  if (!HURUF.includes(huruf)) {
    throw new AppError(400, 'VALIDATION_ERROR',
      'Field nilai_huruf harus salah satu dari A, AB, B, BC, C, D, E');
  }

  const item = await model.findKrsItem(req.params.krs_id);
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Item KRS tidak ditemukan');
  if (item.krs_status !== 'locked') {
    throw new AppError(409, 'CONFLICT', 'Nilai hanya bisa diinput untuk KRS yang sudah dikunci');
  }

  const row = await model.upsertDraft(item.id, huruf, BOBOT[huruf]);
  if (!row) throw new AppError(409, 'CONFLICT', 'Nilai sudah dipublikasikan dan tidak bisa diubah');

  res.json({ success: true, data: row });
  audit(req, 'UPDATE_NILAI', 'nilai', row.id);
};

exports.publish = async (req, res) => {
  const { krs_semester_id: headerId, mata_kuliah_id: mataKuliahId, semester } = req.body || {};

  let published;
  let entitas;
  let entitasId;

  if (headerId !== undefined) {
    if (mataKuliahId !== undefined || semester !== undefined) {
      throw new AppError(400, 'VALIDATION_ERROR',
        'Pilih salah satu: krs_semester_id, atau mata_kuliah_id bersama semester');
    }
    requireUuid(headerId);
    published = await model.publishByHeader(headerId);
    entitas = 'krs_semester';
    entitasId = headerId;
  } else {
    if (typeof mataKuliahId !== 'string' || !UUID_RE.test(mataKuliahId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Field mata_kuliah_id tidak valid');
    }
    if (typeof semester !== 'string' || !SEMESTER_RE.test(semester)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Field semester tidak valid');
    }
    published = await model.publishByMataKuliah(mataKuliahId, semester);
    entitas = 'mata_kuliah';
    entitasId = mataKuliahId;
  }

  res.json({ success: true, data: { published } });
  audit(req, 'PUBLISH_NILAI', entitas, entitasId);
};

exports.listAdmin = async (req, res) => {
  const rows = await model.listAdmin({
    semester: optionalSemester(req.query.semester),
    mahasiswaId: optionalUuid(req.query.mahasiswa_id, 'mahasiswa_id'),
    mataKuliahId: optionalUuid(req.query.mata_kuliah_id, 'mata_kuliah_id'),
  });
  res.json({ success: true, data: rows });
};

exports.me = async (req, res) => {
  const filter = optionalSemester(req.query.semester);
  const mahasiswaId = await krsModel.mahasiswaIdByUserId(req.user.id);
  if (!mahasiswaId) throw new AppError(404, 'NOT_FOUND', 'Profil mahasiswa belum dibuat');

  const rows = await model.publishedForMahasiswa(mahasiswaId);
  const perSemester = new Map();
  for (const r of rows) {
    if (filter && r.semester !== filter) continue;
    if (!perSemester.has(r.semester)) perSemester.set(r.semester, []);
    perSemester.get(r.semester).push(r);
  }

  const data = [...perSemester.entries()]
    .sort(([a], [b]) => semesterKey(a) - semesterKey(b))
    .map(([semester, items]) => ({
      semester,
      ips: hitungIps(items),
      total_sks: items.reduce((n, i) => n + i.sks, 0),
      items: items.map(({ semester: _s, ...rest }) => rest),
    }));

  res.json({ success: true, data });
};
