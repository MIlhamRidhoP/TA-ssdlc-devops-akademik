const model = require('../models/mataKuliahModel');
const AppError = require('../utils/AppError');
const { requireUuid } = require('../utils/validators');

const RULES = {
  kode: (v) => typeof v === 'string' && /^[A-Z0-9]{3,20}$/.test(v),
  nama: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 255,
  sks: (v) => Number.isInteger(v) && v >= 1 && v <= 6,
};

const pick = (body, required) => {
  const out = {};
  for (const f of Object.keys(RULES)) {
    const v = body?.[f];
    if (v === undefined || v === null) {
      if (required) throw new AppError(400, 'VALIDATION_ERROR', `Field ${f} wajib diisi`);
      continue;
    }
    if (!RULES[f](v)) throw new AppError(400, 'VALIDATION_ERROR', `Field ${f} tidak valid`);
    out[f] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
};

exports.list = async (req, res) => {
  const { q } = req.query;
  if (q !== undefined && (typeof q !== 'string' || q.length > 100)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Parameter q tidak valid');
  }
  const rows = await model.list(q?.trim() || null);
  res.json({ success: true, data: rows });
};

exports.create = async (req, res) => {
  const row = await model.create(pick(req.body, true));
  res.status(201).json({ success: true, data: row });
};

exports.update = async (req, res) => {
  requireUuid(req.params.id);
  const data = pick(req.body, false);
  if (Object.keys(data).length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Tidak ada field yang diubah');
  }
  const row = await model.update(req.params.id, data);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Mata kuliah tidak ditemukan');
  res.json({ success: true, data: row });
};

exports.remove = async (req, res) => {
  requireUuid(req.params.id);
  const deleted = await model.remove(req.params.id);
  if (!deleted) throw new AppError(404, 'NOT_FOUND', 'Mata kuliah tidak ditemukan');
  res.json({ success: true, data: { id: req.params.id, deleted: true } });
};
