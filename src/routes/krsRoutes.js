const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const requireConsent = require('../middleware/requireConsent');
const c = require('../controllers/krsController');

const mahasiswa = [authorize('mahasiswa'), requireConsent];

router.use(authenticate);

router.get('/me', ...mahasiswa, c.getMe);
router.post('/me/items', ...mahasiswa, c.addItem);
router.delete('/me/items/:itemId', ...mahasiswa, c.removeItem);
router.post('/me/submit', ...mahasiswa, c.submit);
router.post('/me/unsubmit', ...mahasiswa, c.unsubmit);

router.get('/', authorize('admin'), c.listAdmin);
router.put('/:id/lock', authorize('admin'), c.lock);

module.exports = router;
