# Squeek Bird

Game puzzle fisika ketapel ala Angry Birds: tarik ketapel, luncurkan burung, robohkan menara musuh, dan kalahkan semua Grumblin.

## Main

Buka `index.html` di browser, atau mainkan versi live-nya di
https://squeek-bird-game-file.vercel.app/

- **Squeek** — ngebut saat diketuk di tengah terbang
- **Pip** — melesat super cepat
- **Bomba** — meledak saat diketuk
- **Gordo** — menghantam ke bawah

6 level, menara kayu / es / batu, TNT yang meledak berantai, skor dan
bintang 1–3, menu pilih level, jeda, ulangi, dan efek suara sintesis.

Feed live Squeekchain: panel di bawah arena menampilkan status roda
Squeektoshi (muter/istirahat), RPM, nomor blok Squeek terbaru, dan
progres ke blok berikut, langsung dari API publik Squeekchain
(`api.squeekchain.com/v1/status`, Sepolia testnet), diperbarui tiap
10 detik. Kalau API-nya tidak terjangkau, panel menampilkan status
offline dan nilai terakhir yang berhasil dibaca — tanpa data simulasi.

## Tentang

Game ini dibuat sebagai proyek builder untuk
[Squeekchain](https://squeekchain.com) — hamster-powered proof-of-work
toychain di Sepolia testnet. Game saja, tanpa kontrak.

Satu file HTML statis, tanpa build step dan tanpa dependensi server.

squeekchain-project: 0a2cba14-2cbc-46d4-9581-3ddc7bfce2bf
