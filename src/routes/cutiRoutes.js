const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const requireConsent = require('../middleware/requireConsent');
const c = require('../controllers/cutiController');

const mahasiswa = [authorize('mahasiswa'), requireConsent];

router.use(authenticate);

router.post('/me', ...mahasiswa, c.create);
router.get('/me', ...mahasiswa, c.listMe);
router.get('/me/:id', ...mahasiswa, c.getMe);
router.post('/me/:id/batal', ...mahasiswa, c.batal);

router.get('/', authorize('admin'), c.listAdmin);
router.get('/:id', authorize('admin'), c.getById);
router.put('/:id/status', c.updateStatus);

module.exports = router;
