-- Extension untuk enkripsi kolom sensitif (pgcrypto)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tabel autentikasi (terpisah dari data profil mahasiswa)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,  -- di-hash pakai bcrypt di aplikasi
    role VARCHAR(20) NOT NULL DEFAULT 'mahasiswa' CHECK (role IN ('mahasiswa', 'admin')),
    is_minor BOOLEAN NOT NULL DEFAULT false,  -- flag untuk subset < 18 tahun (Pasal 25)
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Data profil mahasiswa, kolom sensitif dienkripsi (pgcrypto pgp_sym_encrypt)
CREATE TABLE mahasiswa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nama VARCHAR(255) NOT NULL,
    nim VARCHAR(20) UNIQUE NOT NULL,
    nik BYTEA,              -- dienkripsi (Data Pribadi Umum, Pasal 3)
    tanggal_lahir BYTEA,    -- dienkripsi (Pasal 3, Pasal 25 kalau < 18)
    nik_orang_tua BYTEA,    -- dienkripsi, hanya diisi untuk subset < 18 tahun
    nomor_telepon BYTEA,    -- dienkripsi
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Bukti persetujuan wali, khusus mahasiswa < 18 tahun (Pasal 25)
CREATE TABLE konsen_orang_tua (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mahasiswa_id UUID NOT NULL REFERENCES mahasiswa(id) ON DELETE CASCADE,
    nama_wali VARCHAR(255) NOT NULL,
    bukti_persetujuan_url TEXT,  -- link/path dokumen persetujuan
    tanggal_persetujuan TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Master mata kuliah
CREATE TABLE mata_kuliah (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode VARCHAR(20) UNIQUE NOT NULL,
    nama VARCHAR(255) NOT NULL,
    sks INT NOT NULL CHECK (sks > 0)
);

-- KRS: pilihan mata kuliah per semester
CREATE TABLE krs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mahasiswa_id UUID NOT NULL REFERENCES mahasiswa(id) ON DELETE CASCADE,
    mata_kuliah_id UUID NOT NULL REFERENCES mata_kuliah(id),
    semester VARCHAR(20) NOT NULL,  -- misal '2026-ganjil'
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (mahasiswa_id, mata_kuliah_id, semester)
);

-- Nilai akademik per mata kuliah
CREATE TABLE nilai (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    krs_id UUID NOT NULL REFERENCES krs(id) ON DELETE CASCADE,
    nilai_huruf VARCHAR(2),   -- A, AB, B, dst
    nilai_angka DECIMAL(4,2),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Audit trail, wajib untuk akses data sensitif (Pasal 39)
CREATE TABLE audit_trail (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    aksi VARCHAR(50) NOT NULL,        -- 'READ_NIK', 'UPDATE_MAHASISWA', 'DELETE_REQUEST', dll
    entitas VARCHAR(50) NOT NULL,     -- nama tabel yang diakses
    entitas_id UUID,
    ip_address VARCHAR(45),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
