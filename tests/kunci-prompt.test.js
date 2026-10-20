// Gerbang isi folder prompt terkunci: prompts/v2 dan prompts/remediasi-v1.
//
// `sha256sum -c HASHES.txt` memeriksa berkas yang TERCANTUM. Ia tidak pernah mengeluh soal berkas
// yang TIDAK tercantum, jadi menambahkan satu varian prompt baru di folder itu lolos 8/8 OK dan
// tetap bisa dibaca kode. Tes ini menutup arah yang satu itu: daftar dan isi folder harus sama.
//
// Dua berkas dikecualikan, dan keduanya bukan masukan prompt:
//   HASHES.txt — tidak bisa mencantumkan dirinya sendiri.
//   README.md  — dokumentasi folder, tidak pernah dibaca kode sebagai prompt.
// Pengecualian ditulis tetap di sini, jadi menambah berkas non-prompt ketiga berarti menyunting
// tes ini dengan sadar, bukan lolos tanpa terlihat.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BUKAN_PROMPT = ['HASHES.txt', 'README.md'];
const FOLDER = ['prompts/v2', 'prompts/remediasi-v1'];

const bacaDaftar = (dir) => fs.readFileSync(path.join(dir, 'HASHES.txt'), 'utf8')
  .trim().split('\n').filter((b) => b.trim())
  .map((b) => {
    const [hash, ...nama] = b.trim().split(/\s+/);
    return { hash, nama: nama.join(' ') };
  });

for (const rel of FOLDER) {
  const dir = path.join(ROOT, rel);

  test(`${rel}: isi berkas cocok dengan HASHES.txt`, () => {
    const daftar = bacaDaftar(dir);
    assert.ok(daftar.length > 0, 'HASHES.txt kosong');
    for (const { hash, nama } of daftar) {
      const berkas = path.join(dir, nama);
      assert.ok(fs.existsSync(berkas), `${nama} tercantum di HASHES.txt tetapi tidak ada`);
      const isi = fs.readFileSync(berkas);
      assert.equal(crypto.createHash('sha256').update(isi).digest('hex'), hash, `hash ${nama}`);
    }
  });

  test(`${rel}: tidak ada berkas prompt di luar HASHES.txt`, () => {
    const tercantum = new Set(bacaDaftar(dir).map((d) => d.nama));
    const isiFolder = fs.readdirSync(dir, { withFileTypes: true });
    // Subfolder juga dilarang: hash tidak menjangkau isinya, jadi apa pun di dalamnya tak terkunci.
    const subfolder = isiFolder.filter((e) => e.isDirectory()).map((e) => e.name);
    assert.deepEqual(subfolder, [], `${rel} punya subfolder yang tidak terjangkau hash`);

    const asing = isiFolder.filter((e) => e.isFile()).map((e) => e.name)
      .filter((n) => !tercantum.has(n) && !BUKAN_PROMPT.includes(n));
    assert.deepEqual(asing, [], `berkas di ${rel} tidak tercantum di HASHES.txt`);
  });
}

test('perintah verifikasi di AGENTS.md menyebut kedua folder terkunci', () => {
  // Aturannya hanya berguna kalau tertulis di tempat orang mencarinya. Kalau folder terkunci
  // bertambah tetapi AGENTS.md tidak ikut, tes ini yang mengingatkan.
  const doc = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  for (const rel of FOLDER) {
    assert.ok(doc.includes(rel), `AGENTS.md tidak menyebut ${rel}`);
  }
});
