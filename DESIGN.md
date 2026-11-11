# SQUEEK MARKET — Design Doc (NEAR HACKATHON, track `games`)

> Ditulis dulu di atas kertas, sebelum ada yang ngoding (syarat track 09-games).
> Proyek: adaptasi **Squeek Bird** (game ketapel, dibangun 6 Nov 2026 — masih dalam
> window hackathon 19 Okt–14 Nov 2026) + ekonomi NEAR. Yang dinilai: integrasi NEAR-nya.
> Deadline submit: 14 Nov 2026 23:59 UTC (= 15 Nov 06:59 WIB). Target build jalan 13 Nov.

## 1. Game loop di atas kertas

**Tiap 30 detik:** pemain membidik → tarik ketapel → lepas → burung terbang, robohkan
menara Grumblin. Balok hancur = material masuk inventaris (lihat §2). Skor naik.

**Tiap 5 menit (satu level):** level selesai MENANG → material hasil gather
di-mint ke inventaris (kalah tidak dapat material — supaya retry tidak bisa
farming) → pemain buka **Squeek Market**: cek harga 3 merchant, jual
material yang numpuk, beli material yang kurang / power-up, atau invest ke merchant
yang bangkrut. Harga sudah bergerak dari trading sebelumnya.

**Tiap sesi:** pemain naik level, kumpulkan golden-egg (hadiah level bintang 3),
bangun kekayaan squeek-coin, jaga hubungan dengan merchant (invest = bonus jual +10%).
Tujuan sesi: selesaikan 6 level + jadi pedagang terkaya di pasar.

**Satu hal yang TIDAK boleh rusak:** game loop asli (ketapel → robohkan → bintang).
Market adalah lapisan di atasnya, bukan pengganti.

## 2. Item (NEP-245 — satu kontrak, semua jenis item)

| token_id | Nama | Sumber | Keterangan |
| --- | --- | --- | --- |
| `wood` | Kayu | Hancurkan balok kayu (2 per balok) | Material dasar |
| `stone` | Batu | Hancurkan balok batu (2 per balok) | Material dasar |
| `ice` | Es | Hancurkan balok es (1 per balok) | Material dasar |
| `iron` | Besi | Hancurkan TNT (1 per TNT — puing besi) | Material menengah |
| `golden-egg` | Telur Emas | Level bintang 3 (1 per level) | Langka, mahal |
| `mighty-seed` | Benih Perkasa | Beli di Bang Jago | Power-up: sekali pakai, luncuran berikutnya ×1.5 |
| `squeek-coin` | Koin Squeek | Jual material ke merchant / starter grant 20 | Mata uang pasar |

Harga dasar (koin): wood 4, stone 6, iron 10, ice 5, golden-egg 60, mighty-seed 40.
`squeek-coin` adalah mata uangnya, bukan barang dagangan.

## 3. Merchant (3 NPC, masing-masing punya wallet + inventaris sendiri)

| Merchant | Kepribadian | Spesialisasi | Markup | Ciri harga |
| --- | --- | --- | --- | --- |
| **Pak Kumis** | Ramah, jujur | Kayu & barang umum | 1.00 | Harga adil, stok besar |
| **Bu Sari** | Licik, hitung-hitungan | Batu & besi | 1.15 | Mahal jual, murah beli |
| **Bang Jago** | Nekat, suka barang langka | Telur emas & benih perkasa | 1.25 | Premium; bayar telur emas +20% |

Tiap merchant punya: akun NEAR sendiri (testnet: sub-account `pak-kumis.<kontrak>`,
dst; mode demo: label simulasi), stok per item, saldo koin, demand per item, status
buka/bangkrut. Merchant TIDAK pernah jadi bot yang sign transaksi sendiri: semua
perdagangan dieksekusi on-chain lewat method kontrak (`buy`/`sell`/`invest`) yang
dipanggil pemain — inventaris & saldo merchant tersimpan di kontrak.

## 4. Aturan pricing (SATU sumber kebenaran — `market/pricing.js` + view kontrak)

Rumus (harus SAMA di `pricing.js`, di kontrak, dan di fast-forward):

```
stockFactor  = clamp(2 - stock/50, 0.5, 2.0)     # stok 0 -> 2x, stok 50 -> 1x, stok 100 -> 0.5x
demandFactor = 1 + min(demand / 20, 1.0)          # demand naik -> harga naik, maks 2x
buyPrice     = round(base * stockFactor * demandFactor * markup)   # harga merchant JUAL ke pemain
sellPrice    = floor(buyPrice * 0.7)              # harga merchant BELI dari pemain (spread 30%)
buyPrice di-clamp ke [1, 5*base]
```

- Setiap unit yang diperdagangkan menambah `demand` item itu +1 — TAPI HANYA
  SAAT BELI (pemain beli dari merchant). Jual TIDAK menaikkan demand; jual
  hanya menaikkan stok. (Alasan: kalau jual juga menaikkan demand, efek banjir
  tertutup — jual 40 iron menaikkan demandFactor 2x yang persis membatalkan
  stockFactor 0.5x, harga tidak jatuh. Demand = tekanan beli.)
- Harga dihitung PER-UNIT: tiap unit dalam satu transaksi dihitung dengan stok
  & demand saat itu. Contoh terverifikasi: beli 5 kayu @ harga awal 4 → total
  23 koin (unit 4,4,5,5,5), bukan 20.
- **Efek banjir (wajib bisa dibuktikan):** pemain jual iron dalam jumlah besar →
  stok iron merchant naik → `stockFactor` turun → harga iron jatuh SEKETIKA.
  Contoh terverifikasi (Bu Sari, markup 1.15): jual 40 iron, stok 50→90 →
  harga beli 12→6, harga jual 8→4, demand tetap 0.
- **Bangkrut:** merchant bayar pemain dari saldo koinnya sendiri. Penjualan
  PARSIAL: kalau merchant tidak mampu bayar penuh, terjual sebanyak yang ia
  mampu (dihitung per-unit), sisanya tetap di pemain. Merchant bangkrut kalau
  koinnya < 10 (BANKRUPT_THRESHOLD) setelah pembayaran — tokonya TUTUP total
  sampai ada yang invest. Koin sisa TETAP dicatat apa adanya.
- **Invest:** pemain bayar min 50 koin → merchant buka lagi dengan saldo 100 koin +
  10 unit tiap item spesialisasinya. Investor dapat bonus jual +10% di merchant itu
  (dicatat per pemain, berlaku selama sesi/riwayat on-chain).

Tooltip merchant menampilkan penalaran: base, stockFactor (dengan stok saat ini),
demandFactor (dengan demand saat ini), markup, dan harga akhir — dari
`get_reasoning(merchant_id, token_id)`.

## 5. Kontrak NEP-245 (NEAR TESTNET — bukan mainnet)

Akun kontrak: `squeek-market.testnet` (dibuat saat deploy; ganti nama kalau sudah
dipakai orang lain, catat nama final di README). Bahasa: **near-sdk-js** (JS/TS)
supaya cepat; Rust hanya kalau JS terbukti tidak bisa.

### Core NEP-245 (wajib, sesuai NEP-245)
- `mt_transfer(receiver_id, token_id, amount, approval, memo)` — deposit 1 yocto
- `mt_batch_transfer(receiver_id, token_ids, amounts, approvals, memo)` — 1 yocto
- `mt_balance_of(account_id, token_id)` → string
- `mt_batch_balance_of(account_id, token_ids)` → string[]
- `mt_token(token_id)` → metadata (name, symbol, decimals=0, icon/uri)
- `mt_tokens(from_index, limit)` → token metadata list
- `mt_tokens_for_owner(account_id, from_index, limit)` → token list + balance
- `mt_supply(token_id)` → string

### Method game (tambahan di kontrak yang sama)
- `new(owner_id)` — init; daftarkan metadata 6 token + 3 merchant awal.
- `register_merchant(merchant_id, stock, coins)` — owner-only; dipakai saat deploy.
- `starter_grant()` — sekali per akun: mint 20 `squeek-coin` ke pemanggil.
- `gather(token_id, amount)` — mint ke pemanggil; cap harian per akun per token:
  wood/stone/ice/iron max 200/hari, `golden-egg` max 3/hari, `mighty-seed` dan
  `squeek-coin` TIDAK bisa di-gather. (Demo-grade: UI yang memanggilnya setelah
  level selesai; cap mencegah mint tak terbatas. Tulis batasan ini di README.)
- `buy(merchant_id, token_id, amount, max_price)` — pemain bayar koin sesuai
  `get_price(..., "buy")`, terima item dari stok merchant. Harga dihitung
  PER-UNIT (demand naik +1 tiap unit). Gagal kalau: merchant tutup, stok
  kurang, koin pemain kurang, harga > max_price. Demand item +amount (hanya
  saat beli).
- `sell(merchant_id, token_id, amount, min_price)` — pemain kirim item ke stok
  merchant, terima koin dari saldo merchant. Penjualan PARSIAL: kalau koin
  merchant tidak cukup untuk jumlah penuh, terjual sebanyak yang ia mampu
  (per-unit); sisanya tetap di pemain. Gagal kalau: merchant tutup, item
  pemain kurang, atau merchant tidak mampu bayar 1 unit pun. Demand TIDAK
  berubah. Kalau koin merchant < 10 setelah bayar → merchant bangkrut
  (flag, toko tutup).
- `invest(merchant_id, amount)` — amount min 50 koin; hanya kalau merchant
  bangkrut. Merchant buka lagi: saldo 100 koin + 10 unit tiap item spesialisasi.
  Pemain dicatat sebagai investor (bonus jual +10% di merchant itu).

### View
- `get_price(merchant_id, token_id, side)` — `"buy"` | `"sell"`, per rumus §4.
- `get_reasoning(merchant_id, token_id)` — `{ base, stock, stock_factor,
  demand, demand_factor, markup, buy_price, sell_price }` (untuk tooltip).
- `get_merchant(merchant_id)` — `{ account, stock: {...}, coins, bankrupt,
  demand: {...}, invested_by: [...] }`.
- `get_merchants()` — ketiganya.
- `get_player(account_id)` — saldo 6 token + flag investor per merchant.

## 6. Mode & login (tanpa seed phrase / popup / gas prompt saat main)

- **Mode demo (DEFAULT — langsung jalan saat halaman dibuka):** pemain isi nama
  tampilan (contoh "Sob") → semua state di localStorage, ekonomi disimulasikan
  penuh di `market/pricing.js`. TIDAK ada wallet, TIDAK ada jaringan ke NEAR.
  Inilah yang dipakai juri/screener (Claude Code & Codex) tanpa setup.
- **Mode testnet (opsional, tombol "Main di NEAR testnet"):** game buat akun
  implicit testnet di browser (keypair di localStorage), danai dari faucet testnet
  (gratis). Semua gather/trade memanggil kontrak via near-api-js. Pemain bisa
  kembali ke mode demo kapan saja. JANGAN pernah tampilkan seed phrase; kunci ini
  kunci dev testnet saja — tulis di README.
- Feed Squeekchain yang sudah ada di halaman TETAP (degradasi graceful offline).
- Meta tag `squeekchain-project` HARUS tetap ada. JANGAN sentuh branch `main`
  repo dan JANGAN sentuh project Vercel-nya.

## 7. Fast-forward (simulasi seminggu trading dalam ~1 menit)

- Tombol "⏩ Simulasi Seminggu" di panel market.
- 7 "hari", tiap hari ~8 detik: trader NPC simulasi (pembeli & penjual dengan
  strategi acak: ada yang borong iron, ada yang jual kayu, dsb.) berdagang dengan
  merchant memakai rumus §4 yang sama.
- Tampilkan: log perdagangan yang berjalan, grafik/angka harga tiap item yang
  bergerak, dan event (merchant hampir bangkrut / bangkrut / stok kosong).
- Fast-forward berjalan di atas SALINAN state (simulasi murni — tidak mengubah
  state pasar nyata/testnet). Tulis jelas di UI: "Simulasi — bukan perdagangan nyata".

## 8. NEAR Intents

Disebut di README sebagai jalur pengembangan (cross-chain settlement untuk trading
antar-chain), BUKAN bagian dari build ini — jangan dipaksakan kalau waktu tidak
cukup. Fokus: NEP-245 + ekonomi merchant yang jalan.

## 9. Struktur file (branch `near-hackathon`, repo armandoalshahab/squeek-bird)

```
index.html                  # game + panel market (meta tag + feed Squeekchain tetap)
market/pricing.js           # SATU file aturan pricing — readable, komentar Bahasa Indonesia
market/merchants.js         # definisi 3 merchant (nama, kepribadian, markup, spesialisasi)
market/near.js              # klien NEAR: mode demo (localStorage) + mode testnet (near-api-js)
market/market-ui.js         # panel market, tooltip reasoning, tombol buy/sell/invest
market/fastforward.js       # simulasi seminggu trading
contract/                   # near-sdk-js: src/contract.ts, test, script deploy
DESIGN.md                   # file ini
README.md                   # README hackathon (reproducibility, demo vs testnet, disclosure)
```

Tag: `pre-hackathon` di commit base (9a00cc6), `hackathon-submission` di titik submit.

## 10. Checklist test (wajib PASS sebelum lapor selesai)

1. Mode demo: halaman dibuka → game langsung bisa dimainkan tanpa wallet/internet-chain.
2. Gather: selesaikan level → material masuk inventaris (jumlah sesuai §2).
3. Trade: beli & jual mengubah saldo pemain + stok merchant + harga (verifikasi angka).
4. Banjir iron: jual iron besar-besaran → harga iron turun (tunjukkan angka sebelum/sesudah).
5. Bangkrut: kuras koin merchant → toko tutup → invest 50 → toko buka lagi + bonus +10%.
6. Fast-forward: seminggu simulasi selesai ~1 menit, log + harga bergerak.
7. Testnet: kontrak ter-deploy; gather mint on-chain (cek explorer); buy/sell transfer
   on-chain; harga view kontrak == `pricing.js`.
8. README: orang baru bisa ulang semua langkah dari instruksi (do X - see Y).
