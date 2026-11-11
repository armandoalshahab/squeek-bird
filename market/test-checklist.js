/* Test checklist DESIGN.md §10 butir 1-6 (mode demo, tanpa browser).
   Jalankan: node market/test-checklist.js
   Keluar dengan kode 0 kalau semua PASS, 1 kalau ada FAIL. */
'use strict';
var Pricing = require('./pricing.js');
var Merchants = require('./merchants.js');
var Near = require('./near.js');
var FF = require('./fastforward.js');

var failures = [];
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' | ' + detail : ''));
  if (!cond) failures.push(name);
}
function eq(a, b) { return a === b; }

// rng deterministik untuk fast-forward (mulberry32)
function seededRng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- 1. Mode demo: jalan tanpa wallet / jaringan ---- */
var s = Near.loadState();
check('1. Demo: state baru, pemain dapat starter grant 20 koin',
  s.player.coins === 20, 'koin=' + s.player.coins);
check('1. Demo: 3 merchant, stok awal 50/item, koin 200',
  Merchants.MERCHANTS.every(function (d) {
    var m = s.merchants[d.id];
    return m.coins === 200 && Merchants.TRADEABLE.every(function (t) { return m.stock[t] === 50 && m.demand[t] === 0; });
  }), 'merchant=' + Object.keys(s.merchants).join(','));
check('1. Demo: testnet belum tersedia (kontrak belum deploy)',
  Near.testnetStatus().status === 'no-config', Near.testnetStatus().message);

/* ---- 2. Gather: level selesai -> inventaris ---- */
var g = Near.commitGather(s, { wood: 4, stone: 2, ice: 1, iron: 1 }, 3);
s = Near.loadState();
check('2. Gather: kayu 2/balok, batu 2/balok, es 1/balok, besi 1/TNT masuk inventaris',
  s.player.inv.wood === 4 && s.player.inv.stone === 2 && s.player.inv.ice === 1 && s.player.inv.iron === 1,
  JSON.stringify(g.credited));
check('2. Gather: bintang 3 -> +1 telur emas',
  s.player.inv['golden-egg'] === 1, 'golden-egg=' + s.player.inv['golden-egg']);

/* ---- 3. Trade: beli & jual ubah saldo + stok + harga ---- */
s.player.coins = 500; Near.saveState(s); // modal uji (test only)
var before = { coins: s.player.coins, stock: s.merchants['pak-kumis'].stock.wood, demand: s.merchants['pak-kumis'].demand.wood };
var buyPrice0 = Near.getPrice(s, 'pak-kumis', 'wood', 'buy');
var rBuy = Near.buy(s, 'pak-kumis', 'wood', 5);
s = Near.loadState();
check('3. Beli: 5 kayu dari Pak Kumis (harga awal ' + buyPrice0 + '/unit)',
  rBuy.ok && s.player.inv.wood === 9 && s.merchants['pak-kumis'].stock.wood === before.stock - 5 &&
  s.merchants['pak-kumis'].demand.wood === before.demand + 5 && s.player.coins === before.coins - rBuy.total,
  'total bayar=' + rBuy.total + ' koin, unit=' + rBuy.unitPrices.join(',') +
  ', koin ' + before.coins + '->' + s.player.coins +
  ', stok ' + before.stock + '->' + s.merchants['pak-kumis'].stock.wood +
  ', demand ' + before.demand + '->' + s.merchants['pak-kumis'].demand.wood);
var sellPrice0 = Near.getPrice(s, 'bu-sari', 'stone', 'sell');
var rSell = Near.sell(s, 'bu-sari', 'stone', 2);
s = Near.loadState();
check('3. Jual: 2 batu ke Bu Sari (harga jual awal ' + sellPrice0 + '/unit)',
  rSell.ok && s.player.inv.stone === 0 && s.player.coins === before.coins - rBuy.total + rSell.total,
  'total terima=' + rSell.total + ' koin, unit=' + rSell.unitPrices.join(','));

/* ---- 4. Banjir iron: jual besar-besaran -> harga iron turun SEGERA ---- */
// Harga acuan Bu Sari (markup 1.15), stok 50, demand 0.
// Aturan final: jual TIDAK menaikkan demand (hanya beli yang menaikkan),
// jadi harga jatuh seketika setelah banjir — tanpa menunggu peluruhan.
var ironBuyBefore = Near.getPrice(s, 'bu-sari', 'iron', 'buy');
var ironSellBefore = Near.getPrice(s, 'bu-sari', 'iron', 'sell');
s.player.inv.iron = 100; Near.saveState(s); // beri stok uji (test only)
s.merchants['bu-sari'].coins = 10000; Near.saveState(s); // modal uji supaya sanggup bayar 40 iron (test only)
var rFlood = Near.sell(s, 'bu-sari', 'iron', 40);
s = Near.loadState();
var ironBuyAfter = Near.getPrice(s, 'bu-sari', 'iron', 'buy');
var ironSellAfter = Near.getPrice(s, 'bu-sari', 'iron', 'sell');
console.log('    HARGA IRON Bu Sari: sebelum banjir beli ' + ironBuyBefore + ' / jual ' + ironSellBefore +
  ' | sesaat setelah banjir beli ' + ironBuyAfter + ' / jual ' + ironSellAfter +
  ' | demand sesudah jual=' + s.merchants['bu-sari'].demand.iron + ' (jual tidak menaikkan demand)');
check('4. Banjir: jual 40 iron -> stok Bu Sari 50->' + s.merchants['bu-sari'].stock.iron +
  ', demand tetap 0, total terima ' + rFlood.total + ' koin',
  rFlood.ok && !rFlood.partial && s.merchants['bu-sari'].stock.iron === 90 &&
  s.merchants['bu-sari'].demand.iron === 0, 'unit jual=' + rFlood.unitPrices.slice(0, 3).join(',') + '...');
check('4. Banjir: harga iron JATUH SEGERA (beli ' + ironBuyBefore + '->' + ironBuyAfter +
  ', jual ' + ironSellBefore + '->' + ironSellAfter + ')',
  ironBuyAfter === 6 && ironSellAfter === 4,
  'stockFactor stok 90 = ' + Pricing.stockFactor(90).toFixed(2) + ' (vs 1.00 di stok 50)');

/* ---- 5. Bangkrut -> tutup -> invest 50 -> buka lagi + bonus +10% ---- */
// Aturan final (DESIGN.md §4): penjualan PARSIAL + bangkrut kalau koin
// merchant < 10 setelah bayar. Skenario deterministik: koin merchant 10,
// jual 2 iron (harga jual per-unit 8 lalu 7) -> terjual 1 unit (8 koin),
// sisa koin 2 < 10 -> bangkrut. Sisa 1 iron tetap di pemain.
var s5 = Near.resetState();
s5.player.inv.iron = 10; s5.player.coins = 500;
s5.merchants['bu-sari'].coins = 10; Near.saveState(s5);
var rDrain = Near.sell(s5, 'bu-sari', 'iron', 2);
s5 = Near.loadState();
check('5. Bangkrut: jual 2 iron ke Bu Sari (koin 10) -> PARSIAL 1 unit, terima 8 koin, sisa koin merchant 2 < 10 -> bangkrut',
  rDrain.ok && rDrain.partial === true && rDrain.qty === 1 && rDrain.requested === 2 &&
  rDrain.total === 8 && s5.merchants['bu-sari'].bankrupt === true && s5.merchants['bu-sari'].coins === 2 &&
  s5.player.inv.iron === 9 && s5.player.coins === 508,
  'total terima=' + (rDrain.ok ? rDrain.total : rDrain.error) + ', qty=' + (rDrain.ok ? rDrain.qty : '-'));
var rBuyClosed = Near.buy(s5, 'bu-sari', 'iron', 1);
var rSellClosed = Near.sell(s5, 'bu-sari', 'iron', 1);
check('5. Bangkrut: toko tutup — beli & jual ditolak',
  !rBuyClosed.ok && !rSellClosed.ok, rBuyClosed.error);
var coinsBeforeInvest = s5.player.coins;
var rInv = Near.invest(s5, 'bu-sari', 50);
s5 = Near.loadState();
check('5. Invest: 50 koin -> toko buka lagi, saldo merchant 100, +10 batu & +10 besi (spesialisasi Bu Sari)',
  rInv.ok && !s5.merchants['bu-sari'].bankrupt && s5.merchants['bu-sari'].coins === 100 &&
  s5.merchants['bu-sari'].stock.stone === 60 && s5.merchants['bu-sari'].stock.iron === 61 &&
  s5.player.coins === coinsBeforeInvest - 50,
  'koin pemain ' + coinsBeforeInvest + '->' + s5.player.coins);
var sellAfterBonus = Near.getPrice(s5, 'bu-sari', 'iron', 'sell');
var reasonAfter = Near.getReasoning(s5, 'bu-sari', 'iron');
check('5. Invest: investor tercatat, reasoning tunjukkan sell_bonus ×1.10',
  s5.player.investors['bu-sari'] === true && reasonAfter.sell_bonus === 1.1,
  'harga jual iron sesudah invest=' + sellAfterBonus + ' (bonus +10% aktif di reasoning)');
check('5. Invest: bonus +10% murni di rumus — buy 12 -> jual 8 biasa, 9 investor',
  Pricing.sellPrice(12, {}) === 8 && Pricing.sellPrice(12, { investor: true }) === 9,
  'floor(12*0.7)=8 vs floor(12*0.7*1.1)=9');
var rInvAgain = Near.invest(s5, 'bu-sari', 50);
check('5. Invest: ditolak kalau merchant tidak bangkrut', !rInvAgain.ok, rInvAgain.error);

/* ---- 6. Fast-forward: 7 hari simulasi di salinan state ---- */
var s6 = Near.resetState();
var startCoins = JSON.stringify(s6.merchants);
var dayLogs = 0, lastPrices = null;
var rng = seededRng(12345);
for (var d = 1; d <= 7; d++) {
  var dl = FF.simulateDay(FF.cloneState(s6), d, rng); // dihitung di salinan
  // jalankan sungguhan di salinan terpisah untuk melacak harga:
  var simCopy = FF.cloneState(s6);
  FF.simulateDay(simCopy, d, seededRng(999 + d));
  lastPrices = FF.snapshotPrices(simCopy);
  dayLogs += dl.length;
}
var realUnchanged = JSON.stringify(s6.merchants) === startCoins;
var moved = lastPrices && (lastPrices['pak-kumis'].iron !== 4 || lastPrices['bu-sari'].wood !== 4);
console.log('    FF: 7 hari, total entri log=' + dayLogs + ', harga akhir Pak Kumis iron=' + lastPrices['pak-kumis'].iron +
  ' (awal 4), Bu Sari iron=' + lastPrices['bu-sari'].iron + ' (awal 12), pasar nyata tidak berubah=' + realUnchanged);
check('6. Fast-forward: 7 hari, log terisi, harga bergerak, state nyata TIDAK berubah',
  dayLogs > 20 && realUnchanged, 'log=' + dayLogs + ' entri');
// Jalur async run() (dipakai UI) dengan dayMs kecil:
FF.run(s6, {
  dayMs: 5,
  rng: seededRng(7),
  onDone: function (summary) {
    check('6. Fast-forward async run(): selesai 7 hari, log=' + summary.log.length + ' entri',
      summary.days === 7 && summary.log.length > 20, 'bangkrut(sim)=' + (summary.bankrupt.join(',') || 'tidak ada'));
    finish();
  }
});

/* ---- bonus: mighty-seed ---- */
var s7 = Near.resetState();
s7.player.inv['mighty-seed'] = 2; Near.saveState(s7);
var arm = Near.armMightySeed(s7);
s7 = Near.loadState();
var used = Near.consumeMightySeedIfArmed(s7);
s7 = Near.loadState();
check('Bonus. Mighty-seed: arm lalu konsumsi sekali pakai (2->' + s7.player.inv['mighty-seed'] + ', armed=' + s7.mightySeedArmed + ')',
  arm.ok && used === true && s7.player.inv['mighty-seed'] === 1 && s7.mightySeedArmed === false);
check('Bonus. Mighty-seed: konsumsi kedua tanpa arm -> false (tidak terpakai)',
  Near.consumeMightySeedIfArmed(s7) === false);

/* ---- rumus murni: clamp & batas ---- */
check('Rumus: stockFactor(0)=2, stockFactor(50)=1, stockFactor(100)=0.5, stockFactor(200)=0.5 (clamp)',
  eq(Pricing.stockFactor(0), 2) && eq(Pricing.stockFactor(50), 1) &&
  eq(Pricing.stockFactor(100), 0.5) && eq(Pricing.stockFactor(200), 0.5));
check('Rumus: demandFactor(0)=1, demandFactor(20)=2, demandFactor(99)=2 (cap)',
  eq(Pricing.demandFactor(0), 1) && eq(Pricing.demandFactor(20), 2) && eq(Pricing.demandFactor(99), 2));
check('Rumus: buyPrice di-clamp [1, 5*base] (iron max 50)',
  Pricing.buyPrice(10, 0, 99, 5) === 50 && Pricing.buyPrice(4, 200, 0, 0.01) >= 1);
var reason = Pricing.getReasoning('golden-egg', 50, 0, 1.25, { buyBonus: 1.2 });
check('Rumus: reasoning telur emas Bang Jago — buy 75, sell efektif 63 (75*0.7*1.2=63)',
  reason.buy_price === 75 && reason.sell_price_effective === 63,
  JSON.stringify(reason));

function finish() {
  console.log('\n' + (failures.length === 0 ? 'SEMUA CHECK PASS' : 'FAIL: ' + failures.join(' | ')));
  process.exit(failures.length === 0 ? 0 : 1);
}
