const { verify } = require('../config/jwt');
const AppError = require('../utils/AppError');

const authenticate = (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Token tidak ditemukan'));
  }
  try {
    const payload = verify(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    next(new AppError(401, 'UNAUTHORIZED', 'Token tidak valid atau kedaluwarsa'));
  }
};

const authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role)
    ? next()
    : next(new AppError(403, 'FORBIDDEN', 'Akses ditolak'));

module.exports = { authenticate, authorize };
