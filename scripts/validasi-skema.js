// Validator JSON Schema subset, secukupnya untuk docs/design/results*.schema.json.
//
// Dibuat sendiri, bukan memakai pustaka, supaya repo tidak bertambah dependensi dan supaya satu-satunya
// sumber kebenaran tetap berkas skema (validator membaca skema, bukan menyalin aturannya ke kode).
//
// Keyword yang didukung: $ref (hanya "#/$defs/<nama>"), $defs, type (string atau array, termasuk "null"),
// required, properties, additionalProperties (false atau skema), items, enum (boleh memuat null), const,
// pattern, minimum, maximum, minItems, maxItems.
// Keyword lain ($schema, $id, title, description, format) sengaja diabaikan: dokumentatif, bukan batasan.
// Kalau skema kelak memakai keyword di luar daftar ini, validasiSkema melempar supaya tidak diam-diam lolos.

const DIDUKUNG = new Set([
  '$schema', '$id', '$ref', '$defs', 'title', 'description', 'format',
  'type', 'required', 'properties', 'additionalProperties', 'items',
  'enum', 'const', 'pattern', 'minimum', 'maximum', 'minItems', 'maxItems',
]);

const jenis = (n) => {
  if (n === null) return 'null';
  if (Array.isArray(n)) return 'array';
  if (Number.isInteger(n)) return 'integer';
  return typeof n; // object | string | number | boolean
};

// "integer" juga sah untuk type "number".
const cocokTipe = (n, t) => {
  const j = jenis(n);
  if (t === 'number') return j === 'integer' || j === 'number';
  return j === t;
};

const sama = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const periksaKeyword = (skema, jalur) => {
  for (const k of Object.keys(skema)) {
    if (!DIDUKUNG.has(k)) throw new Error(`Keyword skema "${k}" di ${jalur || '<akar>'} tidak didukung validasi-skema.js`);
  }
};

const telusuri = (skema, data, jalur, akar, galat) => {
  if (skema.$ref) {
    // Keyword tetap diperiksa walau ada $ref, supaya jaminan "keyword tak didukung ditolak" tidak bocor.
    periksaKeyword(skema, jalur);
    const nama = skema.$ref.replace('#/$defs/', '');
    const tujuan = akar.$defs && akar.$defs[nama];
    if (!tujuan) throw new Error(`$ref tidak ditemukan: ${skema.$ref}`);
    telusuri(tujuan, data, jalur, akar, galat);
    return;
  }
  periksaKeyword(skema, jalur);

  if ('const' in skema && !sama(data, skema.const)) {
    galat.push(`${jalur}: harus ${JSON.stringify(skema.const)}, dapat ${JSON.stringify(data)}`);
    return;
  }
  if (skema.enum && !skema.enum.some((v) => sama(v, data))) {
    galat.push(`${jalur}: harus salah satu ${JSON.stringify(skema.enum)}, dapat ${JSON.stringify(data)}`);
    return;
  }
  if (skema.type) {
    const daftar = [].concat(skema.type);
    if (!daftar.some((t) => cocokTipe(data, t))) {
      galat.push(`${jalur}: tipe harus ${daftar.join('|')}, dapat ${jenis(data)}`);
      return; // tipe salah: pemeriksaan lanjutan tidak bermakna
    }
  }
  if (data === null) return;

  if (typeof data === 'string') {
    if (skema.pattern && !new RegExp(skema.pattern).test(data)) {
      galat.push(`${jalur}: tidak cocok pola ${skema.pattern} (${JSON.stringify(data.slice(0, 40))})`);
    }
  }
  if (typeof data === 'number' && skema.minimum !== undefined && data < skema.minimum) {
    galat.push(`${jalur}: minimum ${skema.minimum}, dapat ${data}`);
  }
  if (typeof data === 'number' && skema.maximum !== undefined && data > skema.maximum) {
    galat.push(`${jalur}: maximum ${skema.maximum}, dapat ${data}`);
  }

  if (Array.isArray(data)) {
    if (skema.minItems !== undefined && data.length < skema.minItems) galat.push(`${jalur}: minItems ${skema.minItems}, dapat ${data.length}`);
    if (skema.maxItems !== undefined && data.length > skema.maxItems) galat.push(`${jalur}: maxItems ${skema.maxItems}, dapat ${data.length}`);
    if (skema.items) data.forEach((v, i) => telusuri(skema.items, v, `${jalur}[${i}]`, akar, galat));
    return;
  }

  if (jenis(data) === 'object') {
    for (const k of skema.required || []) {
      if (!(k in data)) galat.push(`${jalur}: field wajib "${k}" tidak ada`);
    }
    const props = skema.properties || {};
    for (const [k, v] of Object.entries(data)) {
      const sub = `${jalur}.${k}`;
      if (props[k]) telusuri(props[k], v, sub, akar, galat);
      else if (skema.additionalProperties === false) galat.push(`${sub}: field tidak dikenal skema`);
      else if (skema.additionalProperties && typeof skema.additionalProperties === 'object') {
        telusuri(skema.additionalProperties, v, sub, akar, galat);
      }
    }
  }
};

// Mengembalikan daftar pesan galat; kosong berarti sah.
const validasiSkema = (skema, data) => {
  const galat = [];
  telusuri(skema, data, '', skema, galat);
  return galat;
};

module.exports = { validasiSkema };
