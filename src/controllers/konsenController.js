const model = require('../models/konsenModel');
const audit = require('../utils/audit');
const AppError = require('../utils/AppError');
const { isValidDate, requireUuid } = require('../utils/validators');

const STATUSES = ['pending', 'approved', 'rejected'];

const isHttpsUrl = (v) => {
  if (typeof v !== 'string' || v.length > 2048) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

const getMahasiswaOr404 = async (id) => {
  requireUuid(id);
  const mhs = await model.findMahasiswa(id);
  if (!mhs) throw new AppError(404, 'NOT_FOUND', 'Mahasiswa tidak ditemukan');
  return mhs;
};

exports.list = async (req, res) => {
  const mhs = await getMahasiswaOr404(req.params.id);
  const rows = await model.listByMahasiswa(mhs.id);
  res.json({ success: true, data: rows });
  audit(req, 'READ_KONSEN', 'mahasiswa', mhs.id);
};

exports.create = async (req, res) => {
  const mhs = await getMahasiswaOr404(req.params.id);
  const { nama_wali, bukti_persetujuan_url, tanggal_persetujuan } = req.body || {};

  if (typeof nama_wali !== 'string' || !nama_wali.trim() || nama_wali.length > 255) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Field nama_wali tidak valid');
  }
  if (bukti_persetujuan_url != null && !isHttpsUrl(bukti_persetujuan_url)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Field bukti_persetujuan_url harus berupa URL https');
  }
  if (!isValidDate(tanggal_persetujuan)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Field tanggal_persetujuan tidak valid');
  }
  if (!mhs.is_minor) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Konsen hanya dicatat untuk mahasiswa di bawah 18 tahun');
  }

  // status selalu dimulai dari pending, tidak diambil dari body
  const row = await model.create({
    mahasiswa_id: mhs.id,
    nama_wali: nama_wali.trim(),
    bukti_persetujuan_url,
    tanggal_persetujuan,
  });
  res.status(201).json({ success: true, data: row });
  audit(req, 'CREATE_KONSEN', 'konsen_orang_tua', row.id);
};

exports.updateStatus = async (req, res) => {
  const mhs = await getMahasiswaOr404(req.params.id);
  requireUuid(req.params.konsenId);

  const { status } = req.body || {};
  if (!STATUSES.includes(status)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Field status harus pending, approved, atau rejected');
  }

  const row = await model.updateStatus(req.params.konsenId, mhs.id, status);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Data konsen tidak ditemukan');
  res.json({ success: true, data: row });
  audit(req, 'UPDATE_KONSEN', 'konsen_orang_tua', row.id);
};
