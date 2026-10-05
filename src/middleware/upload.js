const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const AppError = require('../utils/AppError');
const { UPLOAD_DIR, MAKS_UKURAN, TIPE_FILE } = require('../config/upload');

const tipeCocok = (file) => {
  const tipe = TIPE_FILE[file.mimetype];
  return Boolean(tipe) && tipe.ekstensi.includes(path.extname(file.originalname).toLowerCase());
};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    // Nama file di disk dibuat server, nama asli hanya disimpan di database
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + TIPE_FILE[file.mimetype].simpanSebagai),
  }),
  limits: { fileSize: MAKS_UKURAN, files: 1, fields: 5, parts: 6 },
  fileFilter: (req, file, cb) => {
    if (!tipeCocok(file)) {
      return cb(new AppError(400, 'VALIDATION_ERROR', 'File harus berupa pdf, jpg, atau png'));
    }
    cb(null, true);
  },
});

const PESAN_MULTER = {
  LIMIT_FILE_SIZE: 'Ukuran file maksimal 2 MB',
  LIMIT_FILE_COUNT: 'Hanya satu file per unggahan',
  LIMIT_UNEXPECTED_FILE: 'File harus dikirim di field file',
};

const hapusFile = (file) => (file ? fs.unlink(file.path).catch(() => {}) : Promise.resolve());

// Isi file harus diawali byte yang sesuai dengan MIME-nya
const isiSesuaiTipe = async (file) => {
  const { signature } = TIPE_FILE[file.mimetype];
  const handle = await fs.open(file.path, 'r');
  try {
    const awal = Buffer.alloc(signature.length);
    await handle.read(awal, 0, signature.length, 0);
    return awal.equals(signature);
  } finally {
    await handle.close();
  }
};

const uploadDokumen = (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return next(new AppError(400, 'VALIDATION_ERROR', PESAN_MULTER[err.code] || 'Unggahan tidak valid'));
    }
    if (err) return next(err);
    if (!req.file) return next(new AppError(400, 'VALIDATION_ERROR', 'File wajib diunggah di field file'));

    try {
      if (!(await isiSesuaiTipe(req.file))) {
        await hapusFile(req.file);
        return next(new AppError(400, 'VALIDATION_ERROR', 'Isi file tidak sesuai dengan tipenya'));
      }
      next();
    } catch (e) {
      await hapusFile(req.file);
      next(e);
    }
  });
};

module.exports = { uploadDokumen, hapusFile };
