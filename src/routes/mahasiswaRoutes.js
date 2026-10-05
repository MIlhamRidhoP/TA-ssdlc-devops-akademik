const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { uploadDokumen } = require('../middleware/upload');
const c = require('../controllers/mahasiswaController');
const profil = require('../controllers/profilController');
const dokumen = require('../controllers/dokumenController');

router.use(authenticate);

// /me harus didaftarkan sebelum /:id
router.get('/me', authorize('mahasiswa'), c.getMe);
router.put('/me', authorize('mahasiswa'), c.updateMe);
router.post('/me/email', authorize('mahasiswa'), profil.addEmail);
router.delete('/me/email/:id', authorize('mahasiswa'), profil.removeEmail);
router.post('/me/akun-sosial', authorize('mahasiswa'), profil.addAkunSosial);
router.delete('/me/akun-sosial/:id', authorize('mahasiswa'), profil.removeAkunSosial);
router.post('/me/dokumen', authorize('mahasiswa'), uploadDokumen, dokumen.upload);
router.get('/me/dokumen', authorize('mahasiswa'), dokumen.listMe);
router.get('/me/dokumen/:id', authorize('mahasiswa'), dokumen.downloadMe);
router.get('/me/riwayat-login', authorize('mahasiswa'), profil.riwayatLogin);
router.get('/me/ekspor', authorize('mahasiswa'), profil.ekspor);

router.get('/', authorize('admin'), c.list);
router.post('/', authorize('admin'), c.create);
router.get('/:id', authorize('admin'), c.getById);
router.put('/:id', authorize('admin'), c.update);
router.delete('/:id', authorize('admin'), c.remove);
router.get('/:id/dokumen', authorize('admin'), dokumen.listAdmin);
router.get('/:id/dokumen/:dokumenId', authorize('admin'), dokumen.downloadAdmin);
router.put('/:id/dokumen/:dokumenId/verifikasi', authorize('admin'), dokumen.verifikasi);

module.exports = router;
