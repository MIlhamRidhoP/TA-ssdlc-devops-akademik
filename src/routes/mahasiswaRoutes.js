const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const c = require('../controllers/mahasiswaController');

router.use(authenticate);

// /me harus didaftarkan sebelum /:id
router.get('/me', authorize('mahasiswa'), c.getMe);
router.put('/me', authorize('mahasiswa'), c.updateMe);

router.get('/', authorize('admin'), c.list);
router.post('/', authorize('admin'), c.create);
router.get('/:id', authorize('admin'), c.getById);
router.put('/:id', authorize('admin'), c.update);
router.delete('/:id', authorize('admin'), c.remove);

module.exports = router;
