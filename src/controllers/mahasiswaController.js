const model = require('../models/mahasiswaModel');
const audit = require('../utils/audit');
const AppError = require('../utils/AppError');
const { UUID_RE, isValidDate, requireUuid } = require('../utils/validators');

const RULES = {
  nama: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 255,
  nim: (v) => typeof v === 'string' && /^\d{8,20}$/.test(v),
  nik: (v) => typeof v === 'string' && /^\d{16}$/.test(v),
  nik_orang_tua: (v) => typeof v === 'string' && /^\d{16}$/.test(v),
  nomor_telepon: (v) => typeof v === 'string' && /^\+?\d{9,15}$/.test(v),
  tanggal_lahir: isValidDate,
};

// Hanya field di daftar yang diambil dari body, sisanya diabaikan
const pick = (body, fields, required = false) => {
  const out = {};
  for (const f of fields) {
    const v = body?.[f];
    if (v === undefined || v === null) {
      if (required) throw new AppError(400, 'VALIDATION_ERROR', `Field ${f} wajib diisi`);
      continue;
    }
    if (!RULES[f](v)) throw new AppError(400, 'VALIDATION_ERROR', `Field ${f} tidak valid`);
    out[f] = v.trim();
  }
  return out;
};

const ageFrom = (dateStr) => {
  const b = new Date(`${dateStr}T00:00:00Z`);
  const n = new Date();
  let age = n.getUTCFullYear() - b.getUTCFullYear();
  const m = n.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && n.getUTCDate() < b.getUTCDate())) age--;
  return age;
};

const ALL_FIELDS = ['nama', 'nim', 'nik', 'tanggal_lahir', 'nik_orang_tua', 'nomor_telepon'];

exports.getMe = async (req, res) => {
  const profile = await model.findByUserId(req.user.id);
  if (!profile) throw new AppError(404, 'NOT_FOUND', 'Profil mahasiswa belum dibuat');
  res.json({ success: true, data: profile });
  audit(req, 'READ_MAHASISWA', 'mahasiswa', profile.id);
};

exports.updateMe = async (req, res) => {
  const { nomor_telepon } = pick(req.body, ['nomor_telepon'], true);
  const id = await model.updatePhoneByUserId(req.user.id, nomor_telepon);
  if (!id) throw new AppError(404, 'NOT_FOUND', 'Profil mahasiswa belum dibuat');
  const profile = await model.findById(id);
  res.json({ success: true, data: profile });
  audit(req, 'UPDATE_MAHASISWA', 'mahasiswa', id);
};

exports.list = async (req, res) => {
  const rows = await model.list();
  res.json({ success: true, data: rows });
};

exports.getById = async (req, res) => {
  requireUuid(req.params.id);
  const profile = await model.findById(req.params.id);
  if (!profile) throw new AppError(404, 'NOT_FOUND', 'Mahasiswa tidak ditemukan');
  res.json({ success: true, data: profile });
  audit(req, 'READ_MAHASISWA', 'mahasiswa', profile.id);
};

exports.create = async (req, res) => {
  const userId = req.body?.user_id;
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Field user_id tidak valid');
  }

  const data = {
    ...pick(req.body, ['nama', 'nim', 'nik', 'tanggal_lahir', 'nomor_telepon'], true),
    ...pick(req.body, ['nik_orang_tua']),
  };
  data.user_id = userId;
  data.is_minor = ageFrom(data.tanggal_lahir) < 18;

  if (data.is_minor && !data.nik_orang_tua) {
    throw new AppError(400, 'VALIDATION_ERROR',
      'Field nik_orang_tua wajib diisi untuk mahasiswa di bawah 18 tahun');
  }

  const role = await model.findUserRole(userId);
  if (!role) throw new AppError(404, 'NOT_FOUND', 'User tidak ditemukan');
  if (role !== 'mahasiswa') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Profil hanya bisa dibuat untuk user dengan role mahasiswa');
  }

  const id = await model.create(data);
  const profile = await model.findById(id);
  res.status(201).json({ success: true, data: profile });
  audit(req, 'CREATE_MAHASISWA', 'mahasiswa', id);
};

exports.update = async (req, res) => {
  requireUuid(req.params.id);
  const data = pick(req.body, ALL_FIELDS);
  if (Object.keys(data).length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Tidak ada field yang diubah');
  }
  if (data.tanggal_lahir) data.is_minor = ageFrom(data.tanggal_lahir) < 18;

  const found = await model.update(req.params.id, data);
  if (!found) throw new AppError(404, 'NOT_FOUND', 'Mahasiswa tidak ditemukan');

  const profile = await model.findById(req.params.id);
  res.json({ success: true, data: profile });
  audit(req, 'UPDATE_MAHASISWA', 'mahasiswa', req.params.id);
};

exports.remove = async (req, res) => {
  requireUuid(req.params.id);
  const deleted = await model.remove(req.params.id);
  if (!deleted) throw new AppError(404, 'NOT_FOUND', 'Mahasiswa tidak ditemukan');
  res.json({ success: true, data: { id: req.params.id, deleted: true } });
  audit(req, 'DELETE_MAHASISWA', 'mahasiswa', req.params.id);
};
