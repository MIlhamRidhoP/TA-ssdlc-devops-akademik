const AppError = require('./AppError');

const LIMIT_DEFAULT = 20;
const LIMIT_MAKS = 100;

const angka = (v, nama, bawaan, maks) => {
  if (v === undefined) return bawaan;
  if (typeof v !== 'string' || !/^\d{1,6}$/.test(v) || Number(v) < 1 || Number(v) > maks) {
    throw new AppError(400, 'VALIDATION_ERROR', `Parameter ${nama} harus bilangan bulat 1 sampai ${maks}`);
  }
  return Number(v);
};

// Parameter q, sort, order, page, limit untuk endpoint list admin.
// sortMap memetakan nama kolom di URL ke ekspresi SQL; kolom sort hanya dari daftar ini.
module.exports = (query, { sortMap, defaultSort, defaultOrder = 'asc' }) => {
  const { q, sort = defaultSort, order = defaultOrder } = query;

  if (q !== undefined && (typeof q !== 'string' || q.length > 100)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Parameter q tidak valid');
  }
  if (typeof sort !== 'string' || !Object.hasOwn(sortMap, sort)) {
    throw new AppError(400, 'VALIDATION_ERROR',
      `Parameter sort harus salah satu dari ${Object.keys(sortMap).join(', ')}`);
  }
  if (order !== 'asc' && order !== 'desc') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Parameter order harus asc atau desc');
  }

  const page = angka(query.page, 'page', 1, 100000);
  const limit = angka(query.limit, 'limit', LIMIT_DEFAULT, LIMIT_MAKS);
  const kata = q?.trim();

  return {
    // % dan _ dari input diperlakukan sebagai karakter biasa
    pola: kata ? `%${kata.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null,
    orderBy: `${sortMap[sort]} ${order === 'desc' ? 'DESC' : 'ASC'}`,
    limit,
    offset: (page - 1) * limit,
  };
};
