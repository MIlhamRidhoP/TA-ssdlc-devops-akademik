const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const requireConsent = require('../middleware/requireConsent');
const c = require('../controllers/nilaiController');

router.use(authenticate);

router.get('/me', authorize('mahasiswa'), requireConsent, c.me);
router.get('/me/khs', authorize('mahasiswa'), requireConsent, c.khs);

router.get('/', authorize('admin'), c.listAdmin);
router.post('/publish', authorize('admin'), c.publish);
router.put('/:krs_id', authorize('admin'), c.setNilai);

module.exports = router;
