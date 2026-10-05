-- path_file hanya nama file buatan server, relatif terhadap folder upload
CREATE TABLE dokumen_mahasiswa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mahasiswa_id UUID NOT NULL REFERENCES mahasiswa(id) ON DELETE CASCADE,
    jenis VARCHAR(20) NOT NULL
        CHECK (jenis IN ('ktp', 'ijazah', 'kartu_keluarga', 'lampiran_cuti')),
    nama_file_asli VARCHAR(255) NOT NULL,
    path_file VARCHAR(100) NOT NULL UNIQUE,
    mime VARCHAR(50) NOT NULL,
    ukuran INT NOT NULL CHECK (ukuran > 0),
    status_verifikasi VARCHAR(20) NOT NULL DEFAULT 'menunggu'
        CHECK (status_verifikasi IN ('menunggu', 'terverifikasi', 'ditolak')),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Satu dokumen per jenis, kecuali lampiran cuti yang boleh lebih dari satu
CREATE UNIQUE INDEX dokumen_mahasiswa_jenis_key
    ON dokumen_mahasiswa (mahasiswa_id, jenis)
    WHERE jenis <> 'lampiran_cuti';

-- Hanya dicatat untuk email yang terdaftar
CREATE TABLE riwayat_login (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    waktu TIMESTAMP NOT NULL DEFAULT now(),
    ip VARCHAR(45),
    user_agent VARCHAR(255),
    status VARCHAR(10) NOT NULL CHECK (status IN ('berhasil', 'gagal'))
);
CREATE INDEX riwayat_login_user_waktu_idx ON riwayat_login (user_id, waktu DESC);
