const mahasiswaModel = require('../models/mahasiswaModel');
const krsModel = require('../models/krsModel');
const profilModel = require('../models/profilModel');
const dokumenModel = require('../models/dokumenModel');
const riwayatLogin = require('../models/riwayatLoginModel');
const audit = require('../utils/audit');
const AppError = require('../utils/AppError');
const { isEmail, isHttpsUrl, requireUuid } = require('../utils/validators');
const { TIPE_EMAIL, PLATFORM_SOSIAL, MAKS_EMAIL } = require('../config/profil');

const getMahasiswaId = async (req) => {
  const id = await krsModel.mahasiswaIdByUserId(req.user.id);
  if (!id) throw new AppError(404, 'NOT_FOUND', 'Profil mahasiswa belum dibuat');
  return id;
};

exports.addEmail = async (req, res) => {
  const { tipe } = req.body || {};
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!TIPE_EMAIL.includes(tipe)) {
    throw new AppError(400, 'VALIDATION_ERROR', `Field tipe harus salah satu dari ${TIPE_EMAIL.join(', ')}`);
  }
  if (!isEmail(email)) throw new AppError(400, 'VALIDATION_ERROR', 'Field email tidak valid');

  const mahasiswaId = await getMahasiswaId(req);
  const row = await profilModel.createEmail(mahasiswaId, tipe, email, MAKS_EMAIL);
  if (!row) throw new AppError(409, 'CONFLICT', `Maksimal ${MAKS_EMAIL} email tambahan`);
  res.status(201).json({ success: true, data: row });
  audit(req, 'CREATE_EMAIL', 'email_mahasiswa', row.id);
};

exports.removeEmail = async (req, res) => {
  requireUuid(req.params.id);
  const mahasiswaId = await getMahasiswaId(req);
  if (!(await profilModel.removeEmail(req.params.id, mahasiswaId))) {
    throw new AppError(404, 'NOT_FOUND', 'Email tidak ditemukan');
  }
  res.json({ success: true, data: { id: req.params.id, deleted: true } });
  audit(req, 'DELETE_EMAIL', 'email_mahasiswa', req.params.id);
};

exports.addAkunSosial = async (req, res) => {
  const { platform, id_akun: idAkun, url } = req.body || {};
  if (!PLATFORM_SOSIAL.includes(platform)) {
    throw new AppError(400, 'VALIDATION_ERROR', `Field platform harus salah satu dari ${PLATFORM_SOSIAL.join(', ')}`);
  }
  if (typeof idAkun !== 'string' || !/^@?[\w.-]{1,100}$/.test(idAkun)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Field id_akun tidak valid');
  }
  if (!isHttpsUrl(url)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Field url harus berupa URL https');
  }

  const mahasiswaId = await getMahasiswaId(req);
  const row = await profilModel.createAkunSosial(mahasiswaId, {
    platform, id_akun: idAkun, url: new URL(url).href,
  });
  res.status(201).json({ success: true, data: row });
  audit(req, 'CREATE_AKUN_SOSIAL', 'akun_sosial_mahasiswa', row.id);
};

exports.removeAkunSosial = async (req, res) => {
  requireUuid(req.params.id);
  const mahasiswaId = await getMahasiswaId(req);
  if (!(await profilModel.removeAkunSosial(req.params.id, mahasiswaId))) {
    throw new AppError(404, 'NOT_FOUND', 'Akun sosial tidak ditemukan');
  }
  res.json({ success: true, data: { id: req.params.id, deleted: true } });
  audit(req, 'DELETE_AKUN_SOSIAL', 'akun_sosial_mahasiswa', req.params.id);
};

exports.riwayatLogin = async (req, res) => {
  const rows = await riwayatLogin.listByUser(req.user.id, 50);
  res.json({ success: true, data: rows });
};

// Semua data pribadi milik sendiri, nomor rekening tidak disamarkan
exports.ekspor = async (req, res) => {
  const profil = await mahasiswaModel.findByUserId(req.user.id);
  if (!profil) throw new AppError(404, 'NOT_FOUND', 'Profil mahasiswa belum dibuat');

  const [rekening, emailTambahan, akunSosial, dokumen, login, konsen, riwayatStudi] = await Promise.all([
    profilModel.findRekening(profil.id),
    profilModel.listEmail(profil.id),
    profilModel.listAkunSosial(profil.id),
    dokumenModel.listByMahasiswa(profil.id),
    riwayatLogin.listByUser(req.user.id, null),
    profilModel.listKonsen(profil.id),
    profilModel.listRiwayatStudi(profil.id),
  ]);

  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: {
      diekspor_pada: new Date().toISOString(),
      profil,
      rekening,
      email_tambahan: emailTambahan,
      akun_sosial: akunSosial,
      dokumen,
      riwayat_login: login,
      konsen_orang_tua: konsen,
      riwayat_studi: riwayatStudi,
    },
  });
  audit(req, 'EXPORT_DATA_PRIBADI', 'mahasiswa', profil.id);
};
