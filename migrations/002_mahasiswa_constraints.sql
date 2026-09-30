-- Log audit tetap ada saat user dihapus (right to erasure), user_id menjadi NULL
ALTER TABLE audit_trail DROP CONSTRAINT audit_trail_user_id_fkey;
ALTER TABLE audit_trail
    ADD CONSTRAINT audit_trail_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Satu user hanya boleh punya satu profil mahasiswa
ALTER TABLE mahasiswa
    ADD CONSTRAINT mahasiswa_user_id_key UNIQUE (user_id);
