// Sumbu `sast`: perkakas analisis statis mana yang memasok alert untuk satu run.
//
// Sumbu TERPISAH dari `skenario` dan dari `kondisi`, mengikuti pemisahan yang sudah ada di repo ini
// (AGENTS.md: skenario menentukan bentuk analisis, kondisi menentukan apa yang diberikan ke model).
// Tidak ada "skenario D": dua perkakas adalah nilai sumbu ini, bukan skenario baru, dan skenario A
// tetap berarti SonarCloud saja.
//
// Berkas ini juga memuat gerbang kombinasi yang tidak sah dan penggabung himpunan alert, karena
// ketiganya adalah definisi sumbu itu sendiri. Tidak memanggil API apa pun dan tidak menulis berkas.
const SAST_DIDUKUNG = ['sonar', 'codeql', 'keduanya'];
const SAST_BAWAAN = 'sonar';

// Perkakas yang ikut memasok alert untuk satu nilai sumbu.
const perkakasUntuk = (sast) => ({ sonar: ['sonar'], codeql: ['codeql'], keduanya: ['sonar', 'codeql'] }[sast]);

// Kombinasi yang ditolak, beserta sebabnya. Ditolak di alat, bukan hanya di workflow: dispatch yang
// tidak sah harus mati di workflow, dan pemanggilan CLI yang tidak sah harus mati di sini.
//
// Keduanya ditolak karena alasan yang berbeda:
//   skenario C         — tidak memakai alert sama sekali (scripts/llm-scan.js perluSonar), jadi
//                        meminta perkakas kedua di situ adalah permintaan yang tidak punya arti.
//   sonar_di_deteksi   — menyisipkan SELURUH laporan ke prompt deteksi lewat sonar-reference.txt.
//                        Laporan gabungan dua perkakas belum pernah dirancang bentuknya, jadi
//                        kombinasi ini DITUNDA, bukan tidak mungkin.
//   prompt v2          — prompt v2 menyebut SonarCloud, sehingga alert CodeQL akan dikirim dengan
//                        keterangan asal yang salah. Diperiksa terakhir, karena skenario dan
//                        kondisi adalah sebab yang lebih dekat ke permintaan pengguna.
const periksaKombinasi = ({ sast, skenario, kondisi, versiPrompt = 'v2' }) => {
  if (!SAST_DIDUKUNG.includes(sast)) {
    throw new Error(`--sast harus ${SAST_DIDUKUNG.join(', ')}; dapat ${JSON.stringify(sast)}`);
  }
  if (sast === 'sonar') return;
  if (skenario === 'C') {
    throw new Error(`Skenario C tidak memakai alert SAST sama sekali, jadi --sast=${sast} tidak punya arti di situ. `
      + 'Pakai --sast=sonar, atau pilih skenario A atau B.');
  }
  if (kondisi === 'sonar_di_deteksi') {
    throw new Error(`Kondisi sonar_di_deteksi dengan --sast=${sast} DITUNDA, bukan tidak mungkin: kondisi itu `
      + 'menyisipkan seluruh laporan ke prompt deteksi, dan bentuk laporan gabungan dua perkakas belum dirancang. '
      + 'Batch pertama hanya skenario A dan B pada kondisi utama.');
  }
  // Diperiksa TERAKHIR, dan urutannya disengaja: skenario dan kondisi adalah sebab yang lebih dekat
  // ke apa yang diminta pengguna, jadi keduanya disebut lebih dulu meski versi promptnya juga salah.
  //
  // Prompt v2 menyebut SonarCloud di dua tempat: judul blok referensi dan kalimat pembuka tugas
  // verifikasi. Mengirim alert CodeQL dengan prompt itu berarti MEMBERI INFORMASI PALSU ke model,
  // dan satu run seperti itu mencemari eksperimen tanpa meninggalkan tanda apa pun di angkanya.
  // Karena itu ditolak, bukan diperingatkan. Bawaannya v2 supaya pemanggil yang belum tahu sumbu
  // ini tidak bisa diam-diam melakukannya.
  if (versiPrompt === 'v2') {
    throw new Error(`--sast=${sast} tidak boleh dipakai dengan --prompt=v2: prompt v2 menyebut SonarCloud, `
      + 'sehingga alert CodeQL akan dikirim dengan keterangan asal yang salah. Pakai --prompt=v3.');
  }
};

// Alert dari dua perkakas disatukan menjadi SATU daftar berurutan. Id tidak pernah diubah, jadi
// tabrakan id adalah galat, bukan sesuatu yang diselesaikan diam-diam dengan penomoran ulang.
//
// Urutan: PERKAKAS lebih dulu, lalu berkas, lalu baris, lalu id.
//
// Mengelompokkan per perkakas disengaja: seluruh alert Sonar muncul lebih dulu dan dalam urutan yang
// persis sama dengan batch satu perkakas, sehingga lengan dua perkakas dapat dibandingkan baris demi
// baris dengan angka yang sudah terbit. Mengurutkan per berkas lebih dulu akan menyelipkan alert
// CodeQL di antara alert Sonar, dan perbandingan itu menjadi jauh lebih sulit dibaca.
//
// Id dipakai sebagai pemutus seri terakhir supaya urutannya tidak bergantung pada urutan masukan
// maupun pada perkakas mana yang dibaca lebih dulu.
const URUTAN_PERKAKAS = ['sonar', 'codeql'];
const urut = (a, b) => URUTAN_PERKAKAS.indexOf(a.sumber_sast) - URUTAN_PERKAKAS.indexOf(b.sumber_sast)
  || String(a.file ?? '').localeCompare(String(b.file ?? ''), 'en')
  || (a.baris ?? 0) - (b.baris ?? 0)
  || String(a.id).localeCompare(String(b.id), 'en');

// Pasangan kembar: dua alert dari perkakas BERBEDA yang menunjuk item ground truth yang sama.
//
// Keputusan K1: kembar TIDAK digabung. Keduanya tetap alert tersendiri dan tetap mendapat panggilan
// verifikasi masing-masing. `kembar_dengan` murni metadata untuk pelaporan, dan karena itu ia tidak
// boleh ikut ke prompt: enam medan yang dikirim ke model tidak memuatnya, dan tes menjaga bahwa
// teks alert yang terbentuk tidak pernah menyebut id ground truth.
//
// nilaiTemuan dipakai apa adanya dari scripts/gemini-scan.js supaya pasangannya ditentukan oleh
// aturan pencocokan yang sama dengan penilaian, bukan oleh perkiraan jarak baris.
//
// Tanpa ground truth, medan `kembar_dengan` TIDAK ditambahkan sama sekali, bukan diisi larik kosong.
// Itu disengaja: proses pemindaian tidak boleh memuat ground truth, karena satu kebocoran ke prompt
// merusak eksperimen. Medan ini diisi penilai, tempat ground truth memang hidup.
const tandaiKembar = (daftar, { gt, nilaiTemuan, keV1 }) => {
  if (!gt) return daftar;
  const idGt = new Map(daftar.map((a) => [a.id, nilaiTemuan(keV1(a), gt).id ?? []]));
  return daftar.map((a) => {
    const milikA = idGt.get(a.id) ?? [];
    const kembar = milikA.length === 0 ? [] : daftar
      .filter((b) => b.id !== a.id && b.sumber_sast !== a.sumber_sast
        && (idGt.get(b.id) ?? []).some((x) => milikA.includes(x)))
      .map((b) => b.id)
      .sort((x, y) => String(x).localeCompare(String(y), 'en'));
    return { ...a, kembar_dengan: kembar };
  });
};

// sonar dan codeql: larik alert yang SUDAH ber-id dari perkakasnya masing-masing.
// opsiKembar opsional; tanpa ground truth, kembar_dengan diisi larik kosong.
const gabungAlert = ({ sonar = [], codeql = [], opsiKembar = {} } = {}) => {
  const bersumber = [
    ...sonar.map((a) => ({ ...a, sumber_sast: 'sonar' })),
    ...codeql.map((a) => ({ ...a, sumber_sast: 'codeql' })),
  ];
  const id = bersumber.map((a) => a.id);
  const ganda = id.filter((x, i) => id.indexOf(x) !== i);
  if (ganda.length) throw new Error(`Id alert bertabrakan antar-perkakas: ${[...new Set(ganda)].join(', ')}`);
  const kosong = bersumber.filter((a) => !a.id);
  if (kosong.length) throw new Error(`${kosong.length} alert tanpa id; penggabungan tidak boleh menomori ulang`);
  return tandaiKembar([...bersumber].sort(urut), opsiKembar);
};

module.exports = { SAST_DIDUKUNG, SAST_BAWAAN, perkakasUntuk, periksaKombinasi, gabungAlert };
