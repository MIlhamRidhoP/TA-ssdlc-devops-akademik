-- Header KRS: satu baris per mahasiswa per semester, status berlaku di sini
CREATE TABLE krs_semester (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mahasiswa_id UUID NOT NULL REFERENCES mahasiswa(id) ON DELETE CASCADE,
    semester VARCHAR(20) NOT NULL CHECK (semester ~ '^\d{4}-(ganjil|genap)$'),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'locked')),
    submitted_at TIMESTAMP,
    locked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (mahasiswa_id, semester)
);

-- Tabel krs menjadi baris detail (satu baris = satu mata kuliah)
ALTER TABLE krs DROP CONSTRAINT IF EXISTS krs_mahasiswa_id_mata_kuliah_id_semester_key;
ALTER TABLE krs DROP COLUMN mahasiswa_id;
ALTER TABLE krs DROP COLUMN semester;
ALTER TABLE krs
    ADD COLUMN krs_semester_id UUID NOT NULL
    REFERENCES krs_semester(id) ON DELETE CASCADE;
ALTER TABLE krs
    ADD CONSTRAINT krs_semester_mata_kuliah_key UNIQUE (krs_semester_id, mata_kuliah_id);

-- Batas SKS sesuai PRD §9
ALTER TABLE mata_kuliah DROP CONSTRAINT IF EXISTS mata_kuliah_sks_check;
ALTER TABLE mata_kuliah ADD CONSTRAINT mata_kuliah_sks_check CHECK (sks BETWEEN 1 AND 6);

-- Nilai: status, satu nilai per baris krs, huruf dibatasi
ALTER TABLE nilai
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published'));
ALTER TABLE nilai ADD CONSTRAINT nilai_krs_id_key UNIQUE (krs_id);
ALTER TABLE nilai
    ADD CONSTRAINT nilai_huruf_check
    CHECK (nilai_huruf IN ('A', 'AB', 'B', 'BC', 'C', 'D', 'E'));
