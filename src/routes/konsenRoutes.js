const router = require('express').Router({ mergeParams: true });
const { authenticate, authorize } = require('../middleware/auth');
const c = require('../controllers/konsenController');

router.use(authenticate, authorize('admin'));

router.get('/', c.list);
router.post('/', c.create);
router.put('/:konsenId', c.updateStatus);

module.exports = router;
