/* ============================================================
   SQUEEK MARKET — fastforward.js
   Simulasi seminggu trading dalam ~1 menit (DESIGN.md §7).
   - 7 "hari", tiap hari ~8 detik.
   - Trader NPC simulasi berdagang dengan merchant memakai rumus
     pricing.js yang SAMA dengan perdagangan nyata.
   - Berjalan di atas SALINAN state — simulasi MURNI, tidak
     mengubah pasar nyata / testnet. UI wajib menulis jelas:
     "Simulasi — bukan perdagangan nyata".
   - Menampilkan: log perdagangan berjalan, harga tiap item yang
     bergerak, dan event (hampir bangkrut / bangkrut / stok kosong).
   Fungsi murni simulateDay() bisa dites di Node tanpa DOM.
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    var P, M;
    try { P = require('./pricing.js'); } catch (e) { P = root.SqueekPricing; }
    try { M = require('./merchants.js'); } catch (e) { M = root.SqueekMerchants; }
    module.exports = factory(P, M);
  } else {
    root.SqueekFF = factory(root.SqueekPricing, root.SqueekMerchants);
  }
})(typeof self !== 'undefined' ? self : this, function (Pricing, Merchants) {
  'use strict';

  var DAYS = 7;
  var DAY_MS = 8000;          // tiap hari ~8 detik (total ~56 detik)
  var NEAR_BANKRUPT_COINS = 30; // di bawah ini = "hampir bangkrut"

  // Salinan dalam dari state (JSON cukup: state hanya data polos).
  function cloneState(s) { return JSON.parse(JSON.stringify(s)); }

  // Harga beli semua item di semua merchant — untuk grafik/angka per hari.
  function snapshotPrices(s) {
    var out = {};
    Merchants.MERCHANTS.forEach(function (def) {
      var m = s.merchants[def.id];
      out[def.id] = {};
      Merchants.TRADEABLE.forEach(function (t) {
        out[def.id][t] = Pricing.buyPrice(
          Pricing.BASE_PRICE[t], m.stock[t], m.demand[t], def.markup);
      });
    });
    return out;
  }

  // Satu NPC: dompet koin + inventaris acak, strategi sederhana.
  function makeNpc(rng) {
    var inv = {};
    Merchants.TRADEABLE.forEach(function (t) {
      inv[t] = Math.floor(rng() * 21); // 0-20 unit
    });
    var strategies = ['borong-iron', 'jual-kayu', 'acak'];
    return {
      coins: 300 + Math.floor(rng() * 400),
      inv: inv,
      strategy: strategies[Math.floor(rng() * strategies.length)]
    };
  }

  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

  // Satu hari simulasi di atas SALINAN state. Mengembalikan log hari itu.
  // rng: fungsi () -> [0,1) — Math.random di browser, seedable di test.
  function simulateDay(sim, day, rng) {
    rng = rng || Math.random;
    var log = [];
    // Demand meluruh -1 tiap hari (DESIGN.md §4).
    Object.keys(sim.merchants).forEach(function (mid) {
      var m = sim.merchants[mid];
      Object.keys(m.demand).forEach(function (t) {
        m.demand[t] = Pricing.decayDemand(m.demand[t], 1);
      });
    });
    log.push({ kind: 'day', day: day, text: '— Hari ' + day + ' dimulai (demand meluruh -1) —' });

    var npcs = [makeNpc(rng), makeNpc(rng), makeNpc(rng)];
    var trades = 8 + Math.floor(rng() * 7); // 8-14 trade per hari
    for (var i = 0; i < trades; i++) {
      var npc = pick(npcs, rng);
      var def = pick(Merchants.MERCHANTS, rng);
      var m = sim.merchants[def.id];
      if (m.bankrupt) continue; // toko tutup: NPC lewat
      var token = def.specialty.indexOf('iron') >= 0 && npc.strategy === 'borong-iron'
        ? 'iron'
        : npc.strategy === 'jual-kayu'
          ? 'wood'
          : pick(Merchants.TRADEABLE, rng);
      var side = npc.strategy === 'jual-kayu' ? 'sell' : (rng() < 0.55 ? 'buy' : 'sell');
      var qty = 1 + Math.floor(rng() * 10);

      if (side === 'buy') {
        qty = Math.min(qty, m.stock[token]);
        if (qty <= 0) { log.push({ kind: 'event', day: day, text: '⚠️ Stok ' + Merchants.ITEMS[token].name + ' di ' + def.name + ' KOSONG.' }); continue; }
        var q = Pricing.quoteBuy(token, m.stock[token], m.demand[token], def.markup, qty);
        if (npc.coins < q.total) { qty = 1; q = Pricing.quoteBuy(token, m.stock[token], m.demand[token], def.markup, 1); if (npc.coins < q.total) continue; }
        npc.coins -= q.total; npc.inv[token] = (npc.inv[token] || 0) + qty;
        m.stock[token] = q.endStock; m.demand[token] = q.endDemand; m.coins += q.total;
        log.push({ kind: 'trade', day: day, text: '🛒 NPC beli ' + qty + ' ' + Merchants.ITEMS[token].name + ' dari ' + def.name + ' — ' + q.total + ' koin (' + q.unitPrices[0] + '–' + q.unitPrices[q.unitPrices.length - 1] + '/unit).' });
      } else {
        qty = Math.min(qty, npc.inv[token] || 0);
        if (qty <= 0) continue;
        var qs = Pricing.quoteSell(token, m.stock[token], m.demand[token], def.markup, qty, {
          buyBonus: Merchants.buyBonusFor(def, token)
        });
        // Penjualan parsial (DESIGN.md §4): merchant bayar sebanyak yang ia mampu.
        var aff = 0, tot = 0;
        for (var u = 0; u < qs.unitPrices.length; u++) {
          if (tot + qs.unitPrices[u] > m.coins) break;
          tot += qs.unitPrices[u]; aff++;
        }
        if (aff <= 0) continue; // merchant tidak sanggup bayar 1 unit pun: trade batal
        npc.inv[token] -= aff; npc.coins += tot;
        m.stock[token] = m.stock[token] + aff; m.demand[token] = qs.endDemand; m.coins -= tot;
        log.push({ kind: 'trade', day: day, text: '💰 NPC jual ' + aff + ' ' + Merchants.ITEMS[token].name + ' ke ' + def.name + ' — terima ' + tot + ' koin.' + (aff < qty ? ' (parsial: merchant hanya mampu bayar ' + aff + ' dari ' + qty + ')' : '') });
        if (m.coins < Merchants.BANKRUPT_THRESHOLD) {
          m.bankrupt = true;
          log.push({ kind: 'event', day: day, text: '💥 ' + def.name + ' BANGKRUT! Koin di bawah ' + Merchants.BANKRUPT_THRESHOLD + ', toko tutup.' });
        } else if (m.coins < NEAR_BANKRUPT_COINS) {
          log.push({ kind: 'event', day: day, text: '⚠️ ' + def.name + ' HAMPIR BANGKRUT — sisa koin ' + m.coins + '.' });
        }
      }
    }
    return log;
  }

  // Jalankan 7 hari secara async (UI bisa render log per hari).
  // onDay(day, simCopy, dayLog, prices) dipanggil tiap hari selesai.
  // onDone(summary) dipanggil di akhir. TIDAK PERNAH menyentuh state asli.
  function run(realState, opts) {
    opts = opts || {};
    var sim = cloneState(realState);
    var onDay = opts.onDay || function () {};
    var onDone = opts.onDone || function () {};
    var dayMs = opts.dayMs || DAY_MS;
    var rng = opts.rng || Math.random;
    var startPrices = snapshotPrices(sim);
    var allLog = [];
    var day = 1;

    function step() {
      var dayLog = simulateDay(sim, day, rng);
      allLog = allLog.concat(dayLog);
      onDay(day, cloneState(sim), dayLog, snapshotPrices(sim));
      day += 1;
      if (day <= DAYS) {
        setTimeout(step, dayMs);
      } else {
        onDone({
          days: DAYS,
          finalState: cloneState(sim),
          startPrices: startPrices,
          endPrices: snapshotPrices(sim),
          log: allLog,
          bankrupt: Merchants.MERCHANTS.filter(function (d) { return sim.merchants[d.id].bankrupt; }).map(function (d) { return d.id; })
        });
      }
    }
    // Hari pertama langsung jalan supaya UI tidak diam 8 detik.
    step();
    return { cancel: function () { day = DAYS + 1; } };
  }

  return {
    DAYS: DAYS,
    DAY_MS: DAY_MS,
    NEAR_BANKRUPT_COINS: NEAR_BANKRUPT_COINS,
    cloneState: cloneState,
    snapshotPrices: snapshotPrices,
    simulateDay: simulateDay,
    run: run
  };
});
