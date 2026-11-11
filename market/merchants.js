/* ============================================================
   SQUEEK MARKET — merchants.js
   Definisi 3 merchant + katalog item (DESIGN.md §2 & §3).
   File ini data murni: tanpa DOM, tanpa state — state (stok,
   demand, koin, bangkrut) hidup di market/near.js, bukan di sini.
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.SqueekMerchants = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- katalog item (DESIGN.md §2) ---------- */
  // yield = jumlah yang masuk inventaris saat gather.
  //   kayu 2/balok kayu, batu 2/balok batu, es 1/balok es,
  //   besi 1/TNT, telur emas 1/level bintang 3.
  // mighty-seed & squeek-coin TIDAK bisa di-gather (hanya beli / jual).
  var ITEMS = {
    wood:       { name: 'Kayu',       emoji: '🪵', base: 4,  gatherFrom: 'wood',  yield: 2 },
    stone:      { name: 'Batu',       emoji: '🪨', base: 6,  gatherFrom: 'stone', yield: 2 },
    ice:        { name: 'Es',         emoji: '🧊', base: 5,  gatherFrom: 'ice',   yield: 1 },
    iron:       { name: 'Besi',       emoji: '🔩', base: 10, gatherFrom: 'tnt',   yield: 1 },
    'golden-egg': { name: 'Telur Emas', emoji: '🥚', base: 60, gatherFrom: 'stars3', yield: 1 },
    'mighty-seed': { name: 'Benih Perkasa', emoji: '🌱', base: 40, gatherFrom: null, yield: 0 }
  };
  var TRADEABLE = ['wood', 'stone', 'ice', 'iron', 'golden-egg', 'mighty-seed'];
  var GATHERABLE = ['wood', 'stone', 'ice', 'iron', 'golden-egg'];

  /* ---------- 3 merchant (DESIGN.md §3) ---------- */
  var MERCHANTS = [
    {
      id: 'pak-kumis',
      name: 'Pak Kumis',
      emoji: '👨🏻',
      personality: 'Ramah, jujur — harga adil, stok besar.',
      specialty: ['wood', 'ice'],
      specialtyLabel: 'Kayu & barang umum',
      markup: 1.00,
      buyBonus: null,          // tidak ada bonus beli khusus
      accountHint: 'pak-kumis.<kontrak>'
    },
    {
      id: 'bu-sari',
      name: 'Bu Sari',
      emoji: '👩🏻',
      personality: 'Licik, hitung-hitungan — mahal jual, murah beli.',
      specialty: ['stone', 'iron'],
      specialtyLabel: 'Batu & besi',
      markup: 1.15,
      buyBonus: null,
      accountHint: 'bu-sari.<kontrak>'
    },
    {
      id: 'bang-jago',
      name: 'Bang Jago',
      emoji: '🧔🏻',
      personality: 'Nekat, suka barang langka — premium, bayar telur emas +20%.',
      specialty: ['golden-egg', 'mighty-seed'],
      specialtyLabel: 'Telur emas & benih perkasa',
      markup: 1.25,
      buyBonus: { token_id: 'golden-egg', multiplier: 1.2 }, // bayar telur emas +20%
      accountHint: 'bang-jago.<kontrak>'
    }
  ];

  /* ---------- state awal ---------- */
  var INITIAL_STOCK_PER_ITEM = 50; // stok awal tiap item per merchant
  var INITIAL_COINS = 200;         // saldo koin awal tiap merchant
  var BANKRUPT_THRESHOLD = 10;     // koin < 10 setelah penjualan -> bangkrut
  var STARTER_GRANT = 20;          // grant awal pemain (DESIGN.md §2)
  var INVEST_MIN = 50;             // invest min 50 koin (DESIGN.md §4)
  var INVEST_REOPEN_COINS = 100;   // merchant buka lagi dengan saldo 100 koin
  var INVEST_RESTOCK = 10;         // +10 unit tiap item spesialisasi saat invest

  // Bonus beli merchant untuk satu token (1 kalau tidak ada).
  function buyBonusFor(merchant, tokenId) {
    if (merchant.buyBonus && merchant.buyBonus.token_id === tokenId) {
      return merchant.buyBonus.multiplier;
    }
    return 1;
  }

  // Stok awal merchant: 50 untuk SEMUA item yang bisa diperdagangkan.
  function initialStock() {
    var stock = {};
    TRADEABLE.forEach(function (t) { stock[t] = INITIAL_STOCK_PER_ITEM; });
    return stock;
  }

  // Demand awal: 0 untuk semua item.
  function initialDemand() {
    var demand = {};
    TRADEABLE.forEach(function (t) { demand[t] = 0; });
    return demand;
  }

  function getMerchant(id) {
    for (var i = 0; i < MERCHANTS.length; i++) {
      if (MERCHANTS[i].id === id) return MERCHANTS[i];
    }
    return null;
  }

  return {
    ITEMS: ITEMS,
    TRADEABLE: TRADEABLE,
    GATHERABLE: GATHERABLE,
    MERCHANTS: MERCHANTS,
    INITIAL_STOCK_PER_ITEM: INITIAL_STOCK_PER_ITEM,
    INITIAL_COINS: INITIAL_COINS,
    BANKRUPT_THRESHOLD: BANKRUPT_THRESHOLD,
    STARTER_GRANT: STARTER_GRANT,
    INVEST_MIN: INVEST_MIN,
    INVEST_REOPEN_COINS: INVEST_REOPEN_COINS,
    INVEST_RESTOCK: INVEST_RESTOCK,
    buyBonusFor: buyBonusFor,
    initialStock: initialStock,
    initialDemand: initialDemand,
    getMerchant: getMerchant
  };
});
