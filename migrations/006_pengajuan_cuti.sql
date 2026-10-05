-- Pengajuan cuti akademik; kategori sama dengan daftar di src/config/cuti.js
CREATE TABLE pengajuan_cuti (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mahasiswa_id UUID NOT NULL REFERENCES mahasiswa(id) ON DELETE CASCADE,
    semester VARCHAR(20) NOT NULL CHECK (semester ~ '^\d{4}-(ganjil|genap)$'),
    kategori VARCHAR(20) NOT NULL
        CHECK (kategori IN ('kesehatan', 'ekonomi', 'keluarga', 'pekerjaan', 'lainnya')),
    alasan VARCHAR(1000) NOT NULL,
    alamat_cuti BYTEA NOT NULL,    -- dienkripsi
    nomor_telepon BYTEA NOT NULL,  -- dienkripsi
    -- Lampiran harus dokumen lampiran_cuti milik mahasiswa yang sama, dicek di aplikasi
    dokumen_id UUID REFERENCES dokumen_mahasiswa(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'diajukan'
        CHECK (status IN ('diajukan', 'disetujui', 'ditolak', 'dibatalkan')),
    catatan_admin VARCHAR(1000),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Satu pengajuan aktif per mahasiswa per semester
CREATE UNIQUE INDEX pengajuan_cuti_aktif_key
    ON pengajuan_cuti (mahasiswa_id, semester)
    WHERE status IN ('diajukan', 'disetujui');
