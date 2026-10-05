-- Identitas dan asal (diubah admin saja)
ALTER TABLE mahasiswa
    ADD COLUMN tempat_lahir VARCHAR(100),
    ADD COLUMN nisn VARCHAR(10) UNIQUE,
    ADD COLUMN alamat_asal VARCHAR(500),
    ADD COLUMN kab_kota_asal VARCHAR(100),
    ADD COLUMN kode_pos_asal VARCHAR(5);

-- Keluarga (diubah admin saja)
ALTER TABLE mahasiswa
    ADD COLUMN nama_ayah VARCHAR(255),
    ADD COLUMN nama_ibu VARCHAR(255),
    ADD COLUMN nomor_hp_orang_tua BYTEA;  -- dienkripsi

-- Domisili (diubah mahasiswa sendiri)
ALTER TABLE mahasiswa
    ADD COLUMN alamat_domisili VARCHAR(500),
    ADD COLUMN kab_kota_domisili VARCHAR(100),
    ADD COLUMN kode_pos_domisili VARCHAR(5);

-- Satu rekening per mahasiswa; daftar bank ada di src/config/profil.js
CREATE TABLE rekening_mahasiswa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mahasiswa_id UUID NOT NULL UNIQUE REFERENCES mahasiswa(id) ON DELETE CASCADE,
    nama_bank VARCHAR(50) NOT NULL,
    nomor_rekening BYTEA NOT NULL,  -- dienkripsi
    nama_pemilik VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE email_mahasiswa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mahasiswa_id UUID NOT NULL REFERENCES mahasiswa(id) ON DELETE CASCADE,
    tipe VARCHAR(20) NOT NULL CHECK (tipe IN ('pribadi', 'kerja', 'alternatif')),
    email VARCHAR(254) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (mahasiswa_id, email)
);

CREATE TABLE akun_sosial_mahasiswa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mahasiswa_id UUID NOT NULL REFERENCES mahasiswa(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL
        CHECK (platform IN ('linkedin', 'github', 'instagram', 'x', 'facebook')),
    id_akun VARCHAR(100) NOT NULL,
    url VARCHAR(2048) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (mahasiswa_id, platform)
);
