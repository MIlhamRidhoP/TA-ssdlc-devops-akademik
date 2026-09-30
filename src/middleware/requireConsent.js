const { consentStateByUserId } = require('../models/konsenModel');
const AppError = require('../utils/AppError');

// Dipasang SETELAH authenticate. Admin selalu lolos.
// Mahasiswa di bawah 18 tahun ditolak kalau konsen terbarunya belum approved.
module.exports = async (req, res, next) => {
  if (req.user?.role !== 'mahasiswa') return next();

  const state = await consentStateByUserId(req.user.id);
  if (state?.is_minor && state.status !== 'approved') {
    throw new AppError(403, 'CONSENT_REQUIRED',
      'Akses ditolak: persetujuan orang tua/wali belum disetujui');
  }
  next();
};
