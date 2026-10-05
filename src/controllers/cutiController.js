const model = require('../models/cutiModel');
const krsModel = require('../models/krsModel');
const dokumenModel = require('../models/dokumenModel');
const audit = require('../utils/audit');
const AppError = require('../utils/AppError');
const listQuery = require('../utils/listQuery');
const { UUID_RE, requireUuid, teks } = require('../utils/validators');
const { SEMESTER_RE, SEMESTER_AKTIF, semesterKey } = require('../config/akademik');
const { KATEGORI_CUTI } = require('../config/cuti');

const KEPUTUSAN = ['disetujui', 'ditolak'];

const RULES = {
  semester: (v) => typeof v === 'string' && SEMESTER_RE.test(v) && semesterKey(v) >= semesterKey(SEMESTER_AKTIF),
  kategori: (v) => KATEGORI_CUTI.includes(v),
  alasan: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 1000,
  alamat_cuti: teks(500),
  nomor_telepon: (v) => typeof v === 'string' && /^\+?\d{9,15}$/.test(v),
};

const getMahasiswaId = async (req) => {
  const id = await krsModel.mahasiswaIdByUserId(req.user.id);
  if (!id) throw new AppError(404, 'NOT_FOUND', 'Profil mahasiswa belum dibuat');
  return id;
};

exports.create = async (req, res) => {
  // Hanya field berikut yang diambil dari body; status selalu dimulai dari diajukan
  const data = {};
  for (const [f, valid] of Object.entries(RULES)) {
    const v = req.body?.[f];
    if (v === undefined || v === null) throw new AppError(400, 'VALIDATION_ERROR', `Field ${f} wajib diisi`);
    if (!valid(v)) throw new AppError(400, 'VALIDATION_ERROR', `Field ${f} tidak valid`);
    data[f] = v.trim();
  }

  const mahasiswaId = await getMahasiswaId(req);
  const dokumenId = req.body?.dokumen_id;
  if (dokumenId !== undefined && dokumenId !== null) {
    if (typeof dokumenId !== 'string' || !UUID_RE.test(dokumenId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Field dokumen_id tidak valid');
    }
    const dokumen = await dokumenModel.findOwned(dokumenId, mahasiswaId);
    if (!dokumen || dokumen.jenis !== 'lampiran_cuti') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Field dokumen_id harus dokumen lampiran_cuti milik sendiri');
    }
    data.dokumen_id = dokumenId;
  }

  const id = await model.create({ ...data, mahasiswa_id: mahasiswaId });
  const row = await model.findById(id);
  res.status(201).json({ success: true, data: row });
  audit(req, 'CREATE_CUTI', 'pengajuan_cuti', id);
};

exports.listMe = async (req, res) => {
  const rows = await model.listByMahasiswa(await getMahasiswaId(req));
  res.json({ success: true, data: rows });
};

exports.getMe = async (req, res) => {
  requireUuid(req.params.id);
  const row = await model.findOwned(req.params.id, await getMahasiswaId(req));
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Pengajuan cuti tidak ditemukan');
  res.json({ success: true, data: row });
  audit(req, 'READ_CUTI', 'pengajuan_cuti', row.id);
};

exports.batal = async (req, res) => {
  requireUuid(req.params.id);
  const mahasiswaId = await getMahasiswaId(req);
  const found = await model.findOwned(req.params.id, mahasiswaId);
  if (!found) throw new AppError(404, 'NOT_FOUND', 'Pengajuan cuti tidak ditemukan');

  const id = await model.batal(found.id, mahasiswaId);
  if (!id) throw new AppError(409, 'CONFLICT', 'Hanya pengajuan berstatus diajukan yang bisa dibatalkan');
  res.json({ success: true, data: await model.findById(id) });
  audit(req, 'BATAL_CUTI', 'pengajuan_cuti', id);
};

exports.listAdmin = async (req, res) => {
  const paging = listQuery(req.query, { sortMap: model.SORT, defaultSort: 'created_at', defaultOrder: 'desc' });
  const { rows, total } = await model.listAdmin({
    ...paging,
    sort: req.query.sort || 'created_at',
    order: req.query.order || 'asc',
  });
  res.set('X-Total-Count', String(total));
  res.json({ success: true, data: rows });
};

exports.getById = async (req, res) => {
  requireUuid(req.params.id);
  const row = await model.findById(req.params.id);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Pengajuan cuti tidak ditemukan');
  res.json({ success: true, data: row });
  audit(req, 'READ_CUTI', 'pengajuan_cuti', row.id);
};

exports.updateStatus = async (req, res) => {
  requireUuid(req.params.id);
  const { status, catatan_admin: catatan } = req.body || {};
  if (!KEPUTUSAN.includes(status)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Field status harus disetujui atau ditolak');
  }
  if (catatan !== undefined && catatan !== null && !RULES.alasan(catatan)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Field catatan_admin tidak valid');
  }

  const found = await model.findById(req.params.id);
  if (!found) throw new AppError(404, 'NOT_FOUND', 'Pengajuan cuti tidak ditemukan');

  const id = await model.putuskan(found.id, status, catatan?.trim() || null);
  if (!id) throw new AppError(409, 'CONFLICT', 'Hanya pengajuan berstatus diajukan yang bisa diputuskan');
  res.json({ success: true, data: await model.findById(id) });
  audit(req, 'UPDATE_STATUS_CUTI', 'pengajuan_cuti', id);
};
