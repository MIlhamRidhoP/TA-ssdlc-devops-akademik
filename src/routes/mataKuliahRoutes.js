const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const c = require('../controllers/mataKuliahController');

router.use(authenticate);

router.get('/', c.list);
router.post('/', authorize('admin'), c.create);
router.put('/:id', authorize('admin'), c.update);
router.delete('/:id', authorize('admin'), c.remove);

module.exports = router;
