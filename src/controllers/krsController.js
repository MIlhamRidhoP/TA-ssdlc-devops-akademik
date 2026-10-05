const model = require('../models/krsModel');
const mataKuliahModel = require('../models/mataKuliahModel');
const audit = require('../utils/audit');
const AppError = require('../utils/AppError');
const listQuery = require('../utils/listQuery');
const { UUID_RE, requireUuid } = require('../utils/validators');
const { SEMESTER_RE, SEMESTER_AKTIF, ipsSebelum, kuotaDariIps } = require('../config/akademik');

const getMahasiswaId = async (req) => {
  const id = await model.mahasiswaIdByUserId(req.user.id);
  if (!id) throw new AppError(404, 'NOT_FOUND', 'Profil mahasiswa belum dibuat');
  return id;
};

const hitungKuota = async (mahasiswaId, semester) => {
  const prev = ipsSebelum(await model.publishedGrades(mahasiswaId), semester);
  return {
    ips_sebelumnya: prev ? prev.ips : null,
    semester_acuan: prev ? prev.semester : null,
    kuota: kuotaDariIps(prev ? prev.ips : null),
  };
};

const totalSks = (items) => items.reduce((n, i) => n + i.sks, 0);

const readSemester = (value) => {
  const semester = value ?? SEMESTER_AKTIF;
  if (typeof semester !== 'string' || !SEMESTER_RE.test(semester)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Parameter semester tidak valid');
  }
  return semester;
};

exports.getMe = async (req, res) => {
  const semester = readSemester(req.query.semester);
  const mahasiswaId = await getMahasiswaId(req);
  const header = await model.findHeader(mahasiswaId, semester);
  const items = header ? await model.listItems(header.id) : [];
  const kuota = await hitungKuota(mahasiswaId, semester);

  res.json({
    success: true,
    data: {
      semester,
      id: header ? header.id : null,
      status: header ? header.status : 'belum_ada',
      items,
      total_sks: totalSks(items),
      ...kuota,
    },
  });
};

exports.addItem = async (req, res) => {
  const mataKuliahId = req.body?.mata_kuliah_id;
  if (typeof mataKuliahId !== 'string' || !UUID_RE.test(mataKuliahId)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Field mata_kuliah_id tidak valid');
  }

  const mahasiswaId = await getMahasiswaId(req);
  if (!(await mataKuliahModel.findById(mataKuliahId))) {
    throw new AppError(404, 'NOT_FOUND', 'Mata kuliah tidak ditemukan');
  }

  const header = await model.getOrCreateHeader(mahasiswaId, SEMESTER_AKTIF);
  if (header.status !== 'draft') {
    throw new AppError(409, 'CONFLICT', 'KRS tidak dalam status draft');
  }

  const id = await model.addItem(header.id, mataKuliahId);
  res.status(201).json({
    success: true,
    data: { id, krs_semester_id: header.id, mata_kuliah_id: mataKuliahId },
  });
};

exports.removeItem = async (req, res) => {
  requireUuid(req.params.itemId);
  const mahasiswaId = await getMahasiswaId(req);

  const item = await model.findItemOwned(req.params.itemId, mahasiswaId);
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Item KRS tidak ditemukan');
  if (item.status !== 'draft') {
    throw new AppError(409, 'CONFLICT', 'KRS tidak dalam status draft');
  }

  await model.removeItem(item.id);
  res.json({ success: true, data: { id: item.id, deleted: true } });
};

exports.submit = async (req, res) => {
  const mahasiswaId = await getMahasiswaId(req);
  const header = await model.findHeader(mahasiswaId, SEMESTER_AKTIF);
  const items = header ? await model.listItems(header.id) : [];

  if (items.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'KRS masih kosong, pilih minimal satu mata kuliah');
  }
  if (header.status !== 'draft') {
    throw new AppError(409, 'CONFLICT', 'KRS tidak dalam status draft');
  }

  const total = totalSks(items);
  const { kuota } = await hitungKuota(mahasiswaId, SEMESTER_AKTIF);
  if (total > kuota) {
    throw new AppError(400, 'SKS_QUOTA_EXCEEDED', 'SKS yang diajukan melebihi kuota maksimal',
      { kuota, diajukan: total });
  }

  const updated = await model.transition(header.id, 'draft', 'submitted');
  if (!updated) throw new AppError(409, 'CONFLICT', 'KRS tidak dalam status draft');

  res.json({ success: true, data: updated });
  audit(req, 'SUBMIT_KRS', 'krs_semester', header.id);
};

exports.unsubmit = async (req, res) => {
  const mahasiswaId = await getMahasiswaId(req);
  const header = await model.findHeader(mahasiswaId, SEMESTER_AKTIF);
  if (!header) throw new AppError(404, 'NOT_FOUND', 'KRS belum ada');

  const updated = await model.transition(header.id, 'submitted', 'draft');
  if (!updated) {
    throw new AppError(409, 'CONFLICT', 'Hanya KRS berstatus submitted yang bisa dikembalikan ke draft');
  }

  res.json({ success: true, data: updated });
  audit(req, 'UNSUBMIT_KRS', 'krs_semester', header.id);
};

exports.listAdmin = async (req, res) => {
  const semester = readSemester(req.query.semester);
  const { mahasiswa_id: mahasiswaId } = req.query;
  if (mahasiswaId !== undefined && (typeof mahasiswaId !== 'string' || !UUID_RE.test(mahasiswaId))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Parameter mahasiswa_id tidak valid');
  }

  const { rows, total } = await model.listHeaders(semester, mahasiswaId ?? null,
    listQuery(req.query, { sortMap: model.SORT, defaultSort: 'nim' }));
  res.set('X-Total-Count', String(total));
  res.json({ success: true, data: rows });
};

exports.lock = async (req, res) => {
  requireUuid(req.params.id);
  const header = await model.findHeaderById(req.params.id);
  if (!header) throw new AppError(404, 'NOT_FOUND', 'KRS tidak ditemukan');

  const updated = await model.transition(header.id, 'submitted', 'locked');
  if (!updated) {
    const message = header.status === 'locked'
      ? 'KRS sudah dikunci'
      : 'Hanya KRS berstatus submitted yang bisa dikunci';
    throw new AppError(409, 'CONFLICT', message);
  }

  res.json({ success: true, data: updated });
  audit(req, 'LOCK_KRS', 'krs_semester', header.id);
};
