# Laporan Uji Coba Skenario B — Sesi 3, 2026-10-10

**Status: BERHENTI di Langkah 3.** Analisis SonarCloud untuk `eksperimen/seeded` sukses berjalan, tetapi hasilnya tidak bisa diakses. SonarCloud menolak semua permintaan data branch non-main dengan HTTP 403 karena batasan paket organisasi. Sesuai aturan, saya tidak mengakalinya. Langkah 5 tidak dijalankan: tidak ada export prompt final, tidak ada run Flash, dan folder `manual-pro/` belum dibuat. Tidak ada commit baru, jadi HEAD tetap `6096301`.

Lanjutan dari `gemini-output/20261010-150155/LAPORAN_UJICOBA.md`.

## 1. Model, commit, hash prompt

| Item | Nilai |
|---|---|
| Model otomatis | `gemini-3.8-flash`, belum dijalankan |
| HEAD `eksperimen/seeded` (lokal = origin) | `6096301cf925423eccd444ba998792eae5976d1c` |
| Working tree | bersih kecuali `LAPORAN_SINKRON.md` (untracked) |
| Hash prompt final untuk uji Pro | **belum ada**, karena data Sonar branch ini tidak bisa diambil |

## 2. Perubahan di sesi ini

Tidak ada perubahan file dan tidak ada commit.

## 3. Data SonarCloud

### Verifikasi analisis

| Pemeriksaan | Hasil |
|---|---|
| Run GitHub Actions | SonarCloud, `workflow_dispatch`, branch `eksperimen/seeded`, commit `6096301`, 08:03:49 UTC, **success** |
| Task SonarCloud (`api/ce/activity`) | branch `eksperimen/seeded`, tipe **SHORT**, status SUCCESS, 08:04:43 UTC, analysisId `56ec3000-0551-4c67-a46e-18605fee0ee2` |
| Branch di SonarCloud | `main` (LONG, main) dan `eksperimen/seeded` (SHORT, mergeBranch `main`) |
| Commit yang dianalisis | **`6096301` = HEAD.** Bukti: `head_sha` run GitHub di atas. Revisi dari sisi SonarCloud tidak bisa dibaca karena 403 di bawah. |

### Penolakan akses

Pesan error persis dari setiap endpoint:

| Endpoint (parameter `branch=eksperimen/seeded`) | HTTP | Pesan |
|---|---|---|
| `api/issues/search` | 403 | `Organization is not allowed to access data from non main branches.` |
| `api/hotspots/search` | 403 | `Organization is not allowed to access data from non main branches.` |
| `api/measures/component` | 403 | `Organization is not allowed to access data from non main branches.` |
| `api/navigation/component` | 403 | `Organization is not allowed to access data from non main branches.` |
| `api/project_analyses/search` | 400 | `Branch 'eksperimen/seeded' is not of type LONG` |

| Status | Nilai |
|---|---|
| Repo GitHub | publik |
| Proyek SonarCloud | public |
| Organisasi | `milhamridhop` |

[S] Analisis branch tetap diproses, tetapi paket organisasi ini hanya mengizinkan akses data `main`. Laporan sesi 2 yang menyebut "belum ada indikasi penolakan karena batasan paket" ternyata keliru.

Jumlah issue dan hotspot untuk branch ini: tidak bisa diambil.

### Usulan alternatif: project terpisah `_seeded`

Kode tertanam dianalisis sebagai project SonarCloud tersendiri. Analisisnya tercatat di branch **utama** project itu, sehingga lolos dari batasan "non main branches".

Nilai yang dipakai:

| Item | Nilai |
|---|---|
| projectKey | `MIlhamRidhoP_TA-ssdlc-devops-akademik_seeded` |
| Organisasi | `milhamridhop` |
| Nama tampilan | misalnya `TA SIA seeded` |
| Branch utama project baru | `main` (bawaan SonarCloud), berisi kode `eksperimen/seeded` |

**A. Buat project di SonarCloud**

1. Di sonarcloud.io, pilih **+**, lalu **Analyze new project**, lalu **create a project manually**.
2. Isi organisasi `milhamridhop`, projectKey `MIlhamRidhoP_TA-ssdlc-devops-akademik_seeded`, dan visibility public.
3. Di Administration > Analysis Method, matikan **Automatic Analysis**, karena analisis berjalan dari CI atau CLI.
4. Pastikan `SONAR_TOKEN` yang ada punya hak Execute Analysis untuk project baru. Token pribadi pemilik organisasi biasanya sudah cukup.

**B. Jalankan analisis** (pilih salah satu)

- **B1. Lewat GitHub Actions (direkomendasikan, sesuai alur SSDLC).** Di branch `eksperimen/seeded`, ganti argumen step scan menjadi:

  ```yaml
          with:
            args: >
              -Dsonar.projectKey=MIlhamRidhoP_TA-ssdlc-devops-akademik_seeded
  ```

  Jangan kirim `sonar.branch.name`, supaya analisis masuk ke branch utama project baru. Opsi ini butuh satu commit di branch eksperimen, jadi HEAD berubah. `src/` tetap sama, dan SonarCloud harus dipicu ulang setelah commit itu. `main` tetap memakai project lama.

- **B2. Dari mesin lokal tanpa commit (HEAD tetap `6096301`).** Jalankan scanner dari root repo dengan working tree bersih:

  ```
  npx @sonar/scan -Dsonar.host.url=https://sonarcloud.io -Dsonar.organization=milhamridhop -Dsonar.projectKey=MIlhamRidhoP_TA-ssdlc-devops-akademik_seeded
  ```

  Scanner membaca token dari environment variable `SONAR_TOKEN`. Set variabel itu dari `.env` sebelum menjalankan perintah, jangan menulis token di command line. Kekurangannya, analisis tidak berjalan di pipeline GitHub Actions. Ini perlu dicatat di metodologi sebagai "SonarCloud scanner yang sama, dijalankan lokal".

**C. Penyesuaian skrip Gemini.** `scripts/gemini-scan.js` baris 19 mematok `SONAR_PROJECT` ke project lama. Skrip perlu membaca `SONAR_PROJECT` dari env dan boleh dijalankan tanpa parameter `branch`, misalnya dengan `SONAR_BRANCH=main` untuk project baru. Perubahan ini hanya menyentuh `scripts/`, tetapi tetap menjadi commit baru. Urutan yang aman:
1. Commit perubahan skrip, dan perubahan workflow jika memakai B1.
2. Push, lalu picu analisis.
3. Jalankan export prompt dan 3 run Flash pada HEAD yang sama dengan yang dianalisis.

## 4. Run Flash

Belum dijalankan.

| Run | Durasi | Prompt tokens | Output tokens | Thoughts tokens | finishReason | Parse OK | Jumlah temuan |
|---|---|---|---|---|---|---|---|
| 1 | – | – | – | – | – | – | – |
| 2 | – | – | – | – | – | – | – |
| 3 | – | – | – | – | – | – | – |

## 5. Tabel pencocokan

Belum ada data.

## 6. Temuan di luar ground truth

Belum ada data.

## 7. Konsistensi Flash

Belum ada data.

## 8. Hitungan sementara

Belum ada data.

## 9. Info uji manual Pro

Prompt final belum ada, jadi folder `manual-pro/` belum dibuat. Hasil cek akses Pro lewat API dari sesi 2 tetap berlaku: HTTP 429, kuota free tier `gemini-3.1-pro` bernilai 0, dan uji Pro harus manual.

## 10. Kendala dan catatan

1. **Batasan paket SonarCloud** menghalangi akses data branch non-main. Ini penghalang utama Skenario A dan B.
2. **DevSecOps Pipeline di branch eksperimen** tetap gagal. Ini wajar dan diabaikan.
3. **Branch `eksperimen/seeded` di SonarCloud** sekarang berisi analisis yang tidak bisa dibaca. Branch itu boleh dibiarkan, atau dihapus dari Administration > Branches setelah project `_seeded` dipakai.
4. **Argumen `-Dsonar.branch.name` di `main` (`fe97d23`)** tidak berbahaya dan analisis `main` tercatat benar. Jika memakai alternatif B1, argumen di branch eksperimen diganti dengan `sonar.projectKey`.
