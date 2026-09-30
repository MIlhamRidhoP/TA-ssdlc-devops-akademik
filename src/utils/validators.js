const AppError = require('./AppError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isValidDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v) && d < new Date();
};

const requireUuid = (id) => {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ID tidak valid');
  }
};

module.exports = { UUID_RE, isValidDate, requireUuid };
