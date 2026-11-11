/* ============================================================
   SQUEEK MARKET — pricing.js
   SATU sumber kebenaran aturan harga (DESIGN.md §4).
   File ini fungsi MURNI: tanpa DOM, tanpa localStorage, tanpa
   jaringan — jadi bisa dipakai UI demo, fast-forward, DAN test
   (Node) dengan hasil yang sama persis.
   Rumus yang sama harus ada di kontrak NEAR (view get_price /
   get_reasoning) supaya harga on-chain == harga di sini.
   ============================================================ */
(function (root, factory) {
  // UMD mini: jalan di browser (window.SqueekPricing) & Node (require).
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.SqueekPricing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- konstanta ---------- */
  // Harga dasar tiap item dalam squeek-coin (DESIGN.md §2).
  // squeek-coin itu mata uangnya, bukan barang dagangan.
  var BASE_PRICE = {
    wood: 4,
    stone: 6,
    iron: 10,
    ice: 5,
    'golden-egg': 60,
    'mighty-seed': 40
  };
  var STOCK_REF = 50;      // stok acuan: di titik ini stockFactor = 1
  var DEMAND_REF = 20;     // demand acuan: di titik ini demandFactor = 2
  var SELL_SPREAD = 0.7;   // merchant beli dari pemain seharga 70% harga jualnya
  var INVESTOR_BONUS = 1.1; // investor merchant dapat +10% saat menjual

  /* ---------- util ---------- */
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------- rumus §4 ---------- */

  // stockFactor = clamp(2 - stock/50, 0.5, 2.0)
  // Stok 0 -> 2x (langka, mahal), stok 50 -> 1x, stok 100 -> 0.5x (banjir, murah).
  function stockFactor(stock) {
    return clamp(2 - stock / STOCK_REF, 0.5, 2.0);
  }

  // demandFactor = 1 + min(demand / 20, 1.0)
  // Demand naik -> harga naik, maksimal 2x (saat demand >= 20).
  function demandFactor(demand) {
    return 1 + Math.min(demand / DEMAND_REF, 1.0);
  }

  // Harga merchant JUAL ke pemain (harga beli dari sisi pemain).
  // buyPrice = round(base * stockFactor * demandFactor * markup),
  // lalu di-clamp ke [1, 5*base] supaya tidak pernah 0 atau gila.
  function buyPrice(base, stock, demand, markup) {
    var raw = Math.round(base * stockFactor(stock) * demandFactor(demand) * markup);
    return clamp(raw, 1, 5 * base);
  }

  // Harga merchant BELI dari pemain (harga jual dari sisi pemain).
  // Dasar: floor(buyPrice * 0.7) — spread 30% buat merchant.
  // Bonus (dikalikan SESUDAH spread, lalu di-floor lagi):
  //  - buyBonus merchant (mis. Bang Jago bayar telur emas +20% -> 1.2)
  //  - bonus investor +10% (1.1) kalau pemain investor di merchant itu.
  function sellPrice(buy, opts) {
    opts = opts || {};
    var mult = 1;
    if (opts.buyBonus) mult *= opts.buyBonus;
    if (opts.investor) mult *= INVESTOR_BONUS;
    return Math.max(1, Math.floor(buy * SELL_SPREAD * mult));
  }

  // Satu paket penalaran lengkap untuk tooltip (== get_reasoning kontrak).
  // reason(token) dipakai UI untuk menampilkan: base, stok, stockFactor,
  // demand, demandFactor, markup, harga beli & jual akhir.
  function getReasoning(tokenId, stock, demand, markup, opts) {
    opts = opts || {};
    var base = BASE_PRICE[tokenId];
    if (base === undefined) throw new Error('pricing: token tidak dikenal: ' + tokenId);
    var sf = stockFactor(stock);
    var df = demandFactor(demand);
    var buy = buyPrice(base, stock, demand, markup);
    return {
      token_id: tokenId,
      base: base,
      stock: stock,
      stock_factor: sf,
      demand: demand,
      demand_factor: df,
      markup: markup,
      buy_price: buy,
      // harga jual dasar (tanpa bonus) + harga jual efektif (dengan bonus)
      sell_price: sellPrice(buy),
      sell_price_effective: sellPrice(buy, opts),
      sell_bonus: (opts.buyBonus || 1) * (opts.investor ? INVESTOR_BONUS : 1)
    };
  }

  /* ---------- efek perdagangan ---------- */

  // Demand HANYA naik saat BELI (pemain beli dari merchant). Jual TIDAK
  // menaikkan demand — jual hanya menaikkan stok. (Keputusan desain:
  // kalau jual juga menaikkan demand, efek banjir tertutup — demand +40
  // menaikkan demandFactor 2x yang persis membatalkan stockFactor 0.5x.)
  // Dipakai per unit supaya harga bergerak di dalam satu transaksi besar.
  function demandAfterTrade(demand, qty) { return demand + qty; }

  // Demand meluruh -1 tiap 5 menit (waktu nyata) / tiap "hari" di fast-forward.
  // `steps` = jumlah interval 5 menit (atau jumlah hari) yang sudah lewat.
  function decayDemand(demand, steps) {
    return Math.max(0, demand - steps);
  }

  /* ---------- harga transaksi multi-unit ---------- */
  // Harga TIDAK dihitung sekali lalu dikali qty: tiap unit dihitung dengan
  // stok & demand saat itu, karena tiap unit mengubah keduanya.
  //  - Beli: stok merchant berkurang 1/unit, demand naik 1/unit.
  //  - Jual: stok merchant bertambah 1/unit, demand TIDAK berubah
  //    (demand hanya naik saat beli — lihat demandAfterTrade di atas).
  // Mengembalikan { total, unitPrices[], endStock, endDemand }.
  function quoteBuy(tokenId, stock, demand, markup, qty) {
    var base = BASE_PRICE[tokenId];
    var unitPrices = [], total = 0, s = stock, d = demand;
    for (var i = 0; i < qty; i++) {
      var p = buyPrice(base, s, d, markup);
      unitPrices.push(p); total += p;
      s -= 1; d += 1;
    }
    return { total: total, unitPrices: unitPrices, endStock: s, endDemand: d };
  }

  function quoteSell(tokenId, stock, demand, markup, qty, opts) {
    var base = BASE_PRICE[tokenId];
    var unitPrices = [], total = 0, s = stock, d = demand;
    for (var i = 0; i < qty; i++) {
      var buy = buyPrice(base, s, d, markup);
      var p = sellPrice(buy, opts);
      unitPrices.push(p); total += p;
      s += 1; // stok naik; demand TIDAK berubah saat jual (hanya saat beli)
    }
    return { total: total, unitPrices: unitPrices, endStock: s, endDemand: d };
  }

  return {
    BASE_PRICE: BASE_PRICE,
    STOCK_REF: STOCK_REF,
    DEMAND_REF: DEMAND_REF,
    SELL_SPREAD: SELL_SPREAD,
    INVESTOR_BONUS: INVESTOR_BONUS,
    clamp: clamp,
    stockFactor: stockFactor,
    demandFactor: demandFactor,
    buyPrice: buyPrice,
    sellPrice: sellPrice,
    getReasoning: getReasoning,
    demandAfterTrade: demandAfterTrade,
    decayDemand: decayDemand,
    quoteBuy: quoteBuy,
    quoteSell: quoteSell
  };
});
