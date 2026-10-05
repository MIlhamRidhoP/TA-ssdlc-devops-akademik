require('dotenv').config();
const assert = require('node:assert/strict');

// Dipakai bersama oleh file test fitur. Butuh database yang sudah di-seed.

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

const parse = async (res) => {
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* bukan JSON */ }
  return { status: res.status, headers: res.headers, body: json, raw: text };
};

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return parse(res);
};

const upload = async (token, { jenis, nama, isi, mime }) => {
  const form = new FormData();
  form.append('jenis', jenis);
  form.append('file', new Blob([isi], { type: mime }), nama);
  const res = await fetch(`${BASE}/api/mahasiswa/me/dokumen`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return parse(res);
};

const download = async (path, token) => {
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
};

const waitForServer = async () => {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* server belum siap */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

const login = async (email, password) => {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `Login ${email} gagal`);
  return r.body.data.token;
};

// Token admin dan kelima mahasiswa seed
const loginSemua = async () => {
  await waitForServer();
  const tokens = { admin: await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD) };
  for (const nama of ['andi', 'budi', 'citra', 'dewi', 'eka']) {
    tokens[nama] = await login(`${nama}@mahasiswa.test`, process.env.SEED_USER_PASSWORD);
  }
  return tokens;
};

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

module.exports = { BASE, api, upload, download, loginSemua, PNG };
