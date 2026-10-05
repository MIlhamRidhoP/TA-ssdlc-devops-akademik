const fs = require('fs');
const path = require('path');

// Di container menjadi /app/uploads, dipasang sebagai volume di docker-compose.yml
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAKS_UKURAN = 2 * 1024 * 1024;

// MIME yang diterima, ekstensi asal yang cocok, ekstensi file di disk,
// dan byte awal yang harus ada di isi file
const TIPE_FILE = {
  'application/pdf': {
    ekstensi: ['.pdf'], simpanSebagai: '.pdf', signature: Buffer.from('%PDF-'),
  },
  'image/jpeg': {
    ekstensi: ['.jpg', '.jpeg'], simpanSebagai: '.jpg', signature: Buffer.from([0xff, 0xd8, 0xff]),
  },
  'image/png': {
    ekstensi: ['.png'], simpanSebagai: '.png',
    signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
};

module.exports = { UPLOAD_DIR, MAKS_UKURAN, TIPE_FILE };
