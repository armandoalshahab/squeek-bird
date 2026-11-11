# Squeek Market — Kontrak (NEAR HACKATHON, track games)

Kontrak NEP-245 + ekonomi merchant untuk Squeek Bird. Bahasa: **near-sdk-js**
(JS/TS). Satu kontrak, semua jenis item. Testnet only — JANGAN deploy ke mainnet.

## Deploy live

- **Kontrak:** `squeek-market.testnet`
- **Explorer:** https://testnet.nearblocks.io/address/squeek-market.testnet
- **WASM:** `build/squeek-market.wasm` (564 KB)
- **Player verifikasi:** `squeek-player.testnet`
- **Bukti verifikasi on-chain:** [`verification-testnet.json`](verification-testnet.json)

## Perintah

```bash
npm install          # install deps (lihat catatan postinstall di bawah)
npm run build        # near-sdk-js build -> build/squeek-market.wasm
npm test             # unit test + parity pricing (29 test, mock env)
npm run deploy:testnet   # buat akun (faucet) + deploy + init + cek merchant
npm run verify:testnet   # skenario on-chain lengkap (butuh akun pemain)
```

Kredensial deployer/pemain disimpan di `~/.near-credentials/testnet/`
(lokasi standar near-cli), **tidak pernah** di repo.

## Method

### NEP-245 core

| Method | Keterangan |
| --- | --- |
| `mt_transfer(receiver_id, token_id, amount, approval, memo)` | 1 yocto wajib |
| `mt_batch_transfer(receiver_id, token_ids, amounts, approvals, memo)` | 1 yocto wajib |
| `mt_balance_of(account_id, token_id)` → string | |
| `mt_batch_balance_of(account_id, token_ids)` → string[] | |
| `mt_token(token_id)` → metadata \| null | satu token_id (lihat deviasi) |
| `mt_tokens(from_index, limit)` → metadata[] | |
| `mt_tokens_for_owner(account_id, from_index, limit)` → metadata[] + balance | |
| `mt_supply(token_id)` → string \| null | |

`mt_transfer_call` / `mt_batch_transfer_call` / `mt_resolve_transfer` TIDAK
diimplementasikan (di luar daftar core DESIGN.md §5). Approval Management
TIDAK didukung (transfer dengan approval ditolak). Event NEP-245
(`mt_mint`, `mt_transfer`) di-emit via `EVENT_JSON` log.

### Method game

| Method | Keterangan |
| --- | --- |
| `init(owner_id)` | sekali saja; daftarkan 3 merchant awal (lihat deviasi `new`) |
| `register_merchant(merchant_id, stock, coins, ...)` | owner-only |
| `starter_grant()` | sekali per akun: +20 squeek-coin |
| `gather(token_id, amount)` | cap harian: material 200, golden-egg 3; mighty-seed & squeek-coin tidak bisa |
| `buy(merchant_id, token_id, amount, max_price)` | harga per-unit iteratif; gagal kalau toko tutup / stok kurang / koin kurang / total > max_price |
| `sell(merchant_id, token_id, amount, min_price[, max_price])` | parsial + ambang bangkrut (lihat §4 final) |
| `invest(merchant_id, amount)` | min 50, hanya kalau bangkrut; buka lagi 100 koin + 10 spesialisasi; bonus jual +10% |
| `get_price(merchant_id, token_id, side[, account_id])` | `"buy"` \| `"sell"`; sell pakai buyBonus + bonus investor bila account_id investor |
| `get_reasoning(merchant_id, token_id[, account_id])` | `{base, stock, stock_factor, demand, demand_factor, markup, buy_price, sell_price, buy_bonus, sell_bonus, sell_price_effective}` |
| `get_merchant(merchant_id)` / `get_merchants()` | |
| `get_player(account_id)` | saldo 7 token + `invested_in` |

## Aturan §4 FINAL (sumber kebenaran: DESIGN.md §4 + `market/pricing.js`)

1. **Harga per-unit:** tiap unit dihitung satu per satu; beli 5 kayu @ harga
   awal 4 → total **23** (unit 4,4,5,5,5), bukan 20.
2. **Demand HANYA naik saat BELI.** Jual tidak mengubah demand sama sekali —
   supaya efek banjir kasat mata (jual 40 iron → stok 90, demand tetap 0,
   harga beli 12→6 seketika). Demand meluruh -1 tiap 5 menit.
3. **Penjualan parsial + ambang bangkrut 10 koin** (`BANKRUPT_THRESHOLD`):
   merchant bayar sebanyak yang ia mampu (per-unit); kalau koin < 10 setelah
   bayar → bangkrut (toko tutup); sisa koin TETAP dicatat apa adanya; invest
   me-reset ke 100.
4. `min_price`/`max_price` di `sell` adalah batas bawah **total** — hanya
   ditegakkan bila seluruh qty terjual. Bila penjualan parsial, yang mengikat
   adalah dana merchant (kalau batas total ikut ditegakkan, penjualan parsial
   tidak akan pernah terjadi dan merchant nyangkut selamanya). Frontend
   mengirim `max_price` untuk buy maupun sell; kontrak memakai nilai itu
   sebagai batas bawah di `sell`.
5. `buyBonus`: Bang Jago bayar telur emas +20% saat membeli dari pemain
   (jual telur emas: dasar 52, efektif 63).

## Deviasi dari DESIGN.md (tercatat, semua disengaja)

1. **`new` → `init`:** DESIGN §5 menamai init `new(owner_id)`. near-sdk-js
   tidak bisa mengekspor method bernama `new` (hasil generate
   `export function new(){}` adalah syntax error JS). Perilaku sama, hanya
   nama berbeda; frontend tidak memanggil init (deploy-time only). Siapa pun
   yang redeploy via near-cli harus pakai `--initFunction init`.
2. **`mt_token(token_id)` satu argumen**, bukan array seperti spek NEP-245 —
   sesuai DESIGN.md §5. Mengembalikan satu objek metadata (atau null).
3. **near-sdk-js 2.0.0 DEPRECATED/diarsipkan** upstream (README repo-nya:
   "DO NOT USE, use near-sdk-rs"). Tetap dipakai karena TERBUKTI bisa build +
   test + deploy di VM ini (lihat bawah) — sesuai instruksi "Rust hanya kalau
   JS terbukti tidak bisa". Kalau ada waktu luang sebelum submit, migrasi ke
   Rust adalah peningkatan yang aman (kontrak ini kecil).
4. **`sell` 0 unit** (koin merchant < harga 1 unit termurah): gagal dengan
   pesan jelas, TIDAK otomatis bangkrut. Keadaan ini tidak bisa muncul lewat
   jual normal (ambang 10 menangkapnya lebih dulu); hanya mungkin bila owner
   me-register merchant dengan koin < 10 secara manual.
5. **Argumen numerik diterima sebagai string juga** (`amount: "5"`), karena
   `market-ui.js` mengirim string. Nilai dikoersi dengan `Number()` di awal
   method.

## Catatan build: postinstall near-sdk-js gagal di VM ini

`npm install near-sdk-js` gagal di postinstall: `tar` mengekstrak binaryen
dengan owner uid 1001 (bukan root) → `tar: Cannot change ownership ...
Operation not permitted` → exit 2. Isi tarball sebenarnya terekstrak dengan
benar. Solusi yang dipakai: install dengan `--ignore-scripts`, lalu lengkapi
toolchain manual (`lib/cli/deps/`): binaryen (sudah terekstrak) + QuickJS
qjsc + wasi-sdk 11.0 (download dari GitHub releases, ekstrak dengan
`tar --no-same-owner`). Setelah itu `near-sdk-js build` berhasil dan
menghasilkan wasm yang valid (ter-deploy + terverifikasi on-chain).

Catatan test: `near-sdk-js` tidak bisa di-import langsung oleh Node ESM
(`export * from "./collections"` — directory import). Unit test memakai
`esbuild` untuk me-bundle kontrak terkompilasi
(`test-build/contract.bundle.mjs`).

## RPC

Script memakai `https://rpc.testnet.fastnear.com`. JANGAN pakai
`https://rpc.testnet.near.org` — endpoint itu deprecated dan mengembalikan
HTTP 429 di tengah verifikasi (11 Nov 2026).

## File

- `src/contract.ts` — kontrak (satu file)
- `test/mock-env.mjs` — mock host NEAR (`env`) untuk unit test di Node
- `test/contract.test.mjs` — 21 test logika kontrak (mock env)
- `test/pricing-parity.test.mjs` — 8 test: rumus kontrak == `market/pricing.js`
- `scripts/deploy-testnet.mjs` — deploy + init
- `scripts/verify-testnet.mjs` — verifikasi on-chain
- `verification-testnet.json` — bukti verifikasi (tx hash + angka)
- `build/squeek-market.wasm` — hasil build yang ter-deploy
