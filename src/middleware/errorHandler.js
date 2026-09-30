const AppError = require('../utils/AppError');

module.exports = (err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Body JSON tidak valid' },
    });
  }

  // unique_violation dari PostgreSQL
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'Data sudah terdaftar' },
    });
  }

  // foreign_key_violation dari PostgreSQL
  if (err.code === '23503') {
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'Data masih dipakai atau terkait data lain' },
    });
  }

  console.error(err);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server' },
  });
};
