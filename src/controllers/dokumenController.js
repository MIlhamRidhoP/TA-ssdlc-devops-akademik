const path = require('path');
const model = require('../models/dokumenModel');
const krsModel = require('../models/krsModel');
const konsenModel = require('../models/konsenModel');
const audit = require('../utils/audit');
const AppError = require('../utils/AppError');
const { requireUuid } = require('../utils/validators');
const { hapusFile } = require('../middleware/upload');
const { JENIS_DOKUMEN, STATUS_VERIFIKASI } = require('../config/profil');
const { UPLOAD_DIR } = require('../config/upload');

const getMahasiswaId = async (req) => {
  const id = await krsModel.mahasiswaIdByUserId(req.user.id);
  if (!id) throw new AppError(404, 'NOT_FOUND', 'Profil mahasiswa belum dibuat');
  return id;
};

const getMahasiswaOr404 = async (id) => {
  requireUuid(id);
  const mhs = await konsenModel.findMahasiswa(id);
  if (!mhs) throw new AppError(404, 'NOT_FOUND', 'Mahasiswa tidak ditemukan');
  return mhs.id;
};

// Nama asli hanya untuk ditampilkan: tanpa folder, tanpa karakter kontrol, maks 255
const namaTampilan = (originalname) =>
  path.basename(originalname.replaceAll('\\', '/')).replace(/\p{Cc}/gu, '').slice(-255) || 'dokumen';

const kirimFile = (req, res, next, dokumen) => {
  res.set('Cache-Control', 'no-store');
  res.attachment(dokumen.nama_file_asli);
  res.type(dokumen.mime);
  const lokasi = path.join(UPLOAD_DIR, dokumen.path_file);
  res.sendFile(lokasi, (err) => {
    if (err && !res.headersSent) next(new AppError(404, 'NOT_FOUND', 'File dokumen tidak ditemukan'));
  });
  audit(req, 'READ_DOKUMEN', 'dokumen_mahasiswa', dokumen.id);
};

exports.upload = async (req, res) => {
  try {
    const { jenis } = req.body || {};
    if (!JENIS_DOKUMEN.includes(jenis)) {
      throw new AppError(400, 'VALIDATION_ERROR', `Field jenis harus salah satu dari ${JENIS_DOKUMEN.join(', ')}`);
    }

    const mahasiswaId = await getMahasiswaId(req);
    if (jenis !== 'lampiran_cuti' && (await model.existsJenis(mahasiswaId, jenis))) {
      throw new AppError(409, 'CONFLICT', `Dokumen ${jenis} sudah diunggah`);
    }

    const row = await model.create({
      mahasiswa_id: mahasiswaId,
      jenis,
      nama_file_asli: namaTampilan(req.file.originalname),
      path_file: req.file.filename,
      mime: req.file.mimetype,
      ukuran: req.file.size,
    });
    res.status(201).json({ success: true, data: row });
    audit(req, 'UPLOAD_DOKUMEN', 'dokumen_mahasiswa', row.id);
  } catch (err) {
    // File yang sudah tersimpan dibuang kalau datanya gagal dicatat
    await hapusFile(req.file);
    throw err;
  }
};

exports.listMe = async (req, res) => {
  const rows = await model.listByMahasiswa(await getMahasiswaId(req));
  res.json({ success: true, data: rows });
};

exports.downloadMe = async (req, res, next) => {
  requireUuid(req.params.id);
  const dokumen = await model.findOwned(req.params.id, await getMahasiswaId(req));
  if (!dokumen) throw new AppError(404, 'NOT_FOUND', 'Dokumen tidak ditemukan');
  kirimFile(req, res, next, dokumen);
};

exports.listAdmin = async (req, res) => {
  const rows = await model.listByMahasiswa(await getMahasiswaOr404(req.params.id));
  res.json({ success: true, data: rows });
};

exports.downloadAdmin = async (req, res, next) => {
  const mahasiswaId = await getMahasiswaOr404(req.params.id);
  requireUuid(req.params.dokumenId);
  const dokumen = await model.findOwned(req.params.dokumenId, mahasiswaId);
  if (!dokumen) throw new AppError(404, 'NOT_FOUND', 'Dokumen tidak ditemukan');
  kirimFile(req, res, next, dokumen);
};

exports.verifikasi = async (req, res) => {
  const mahasiswaId = await getMahasiswaOr404(req.params.id);
  requireUuid(req.params.dokumenId);
  const { status_verifikasi: status } = req.body || {};
  if (!STATUS_VERIFIKASI.includes(status)) {
    throw new AppError(400, 'VALIDATION_ERROR',
      `Field status_verifikasi harus salah satu dari ${STATUS_VERIFIKASI.join(', ')}`);
  }

  const row = await model.updateStatus(req.params.dokumenId, mahasiswaId, status);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Dokumen tidak ditemukan');
  res.json({ success: true, data: row });
  audit(req, 'VERIFIKASI_DOKUMEN', 'dokumen_mahasiswa', row.id);
};
