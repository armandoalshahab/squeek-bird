/* ============================================================
   SQUEEK MARKET — near.js
   Dua mode (DESIGN.md §6), satu API yang sama untuk UI:
   (a) DEMO (default): semua state di localStorage, perdagangan
       dihitung lokal via pricing.js. TANPA jaringan ke NEAR.
   (b) TESTNET: memanggil kontrak NEP-245 via near-api-js.
       Alamat kontrak dibaca dari market/near-config.js
       (ditulis contract worker). Kalau file itu belum ada /
       kontrak belum deploy -> mode testnet menampilkan pesan
       "kontrak belum ter-deploy" dan mode demo TETAP jalan.
   Akun testnet: implicit account, keypair di localStorage,
   didanai faucet (gratis). Seed phrase TIDAK PERNAH ditampilkan;
   ini kunci dev testnet saja, bukan wallet utama.
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    // Node (untuk test): ambil dependency dari file sebelah.
    var P, M;
    try { P = require('./pricing.js'); } catch (e) { P = root.SqueekPricing; }
    try { M = require('./merchants.js'); } catch (e) { M = root.SqueekMerchants; }
    module.exports = factory(P, M);
  } else {
    root.SqueekNear = factory(root.SqueekPricing, root.SqueekMerchants);
  }
})(typeof self !== 'undefined' ? self : this, function (Pricing, Merchants) {
  'use strict';

  /* ---------- penyimpanan ---------- */
  // localStorage di browser; di Node pakai memori (untuk test).
  var LS_KEY = 'squeek-market-v1';
  var LS_TESTNET_KEY = 'squeek-market-testnet-key';
  var memStore = {};
  var store = {
    get: function (k) {
      try { if (typeof localStorage !== 'undefined') return localStorage.getItem(k); } catch (e) {}
      return memStore[k] !== undefined ? memStore[k] : null;
    },
    set: function (k, v) {
      try { if (typeof localStorage !== 'undefined') { localStorage.setItem(k, v); return; } } catch (e) {}
      memStore[k] = v;
    },
    remove: function (k) {
      try { if (typeof localStorage !== 'undefined') { localStorage.removeItem(k); return; } } catch (e) {}
      delete memStore[k];
    }
  };

  /* ---------- mode demo: state ---------- */
  var DECAY_INTERVAL_MS = 5 * 60 * 1000; // demand -1 tiap 5 menit (DESIGN.md §4)
  var GATHER_CAP = { wood: 200, stone: 200, ice: 200, iron: 200, 'golden-egg': 3 }; // cap harian

  function freshState() {
    var merchants = {};
    Merchants.MERCHANTS.forEach(function (m) {
      merchants[m.id] = {
        stock: Merchants.initialStock(),
        demand: Merchants.initialDemand(),
        coins: Merchants.INITIAL_COINS,
        bankrupt: false
      };
    });
    var inv = {};
    Merchants.TRADEABLE.forEach(function (t) { inv[t] = 0; });
    return {
      version: 1,
      mode: 'demo',
      player: {
        name: '',
        coins: Merchants.STARTER_GRANT, // starter grant 20 koin
        inv: inv,
        investors: {},   // merchantId -> true (bonus jual +10%)
        gatherDay: todayStr(),
        gatherUsed: {}   // token -> jumlah gather hari ini (cap harian)
      },
      merchants: merchants,
      lastDecay: Date.now(),
      mightySeedArmed: false
    };
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function loadState() {
    var raw = store.get(LS_KEY);
    if (!raw) { var s = freshState(); saveState(s); return s; }
    try {
      var s = JSON.parse(raw);
      if (!s || s.version !== 1 || !s.player || !s.merchants) throw new Error('state rusak');
      return s;
    } catch (e) {
      var s2 = freshState(); saveState(s2); return s2;
    }
  }

  function saveState(s) { store.set(LS_KEY, JSON.stringify(s)); }

  function resetState() {
    store.remove(LS_KEY);
    return loadState();
  }

  // Peluruhan demand waktu nyata: -1 per 5 menit sejak lastDecay.
  function applyDecay(s) {
    var now = Date.now();
    var steps = Math.floor((now - (s.lastDecay || now)) / DECAY_INTERVAL_MS);
    if (steps <= 0) return 0;
    Object.keys(s.merchants).forEach(function (mid) {
      var m = s.merchants[mid];
      Object.keys(m.demand).forEach(function (t) {
        m.demand[t] = Pricing.decayDemand(m.demand[t], steps);
      });
    });
    s.lastDecay = now;
    saveState(s);
    return steps;
  }

  /* ---------- harga (demo: baca dari state lokal) ---------- */
  function isInvestor(s, merchantId) { return !!s.player.investors[merchantId]; }

  function getReasoning(s, merchantId, tokenId) {
    var def = Merchants.getMerchant(merchantId);
    var m = s.merchants[merchantId];
    if (!def || !m) throw new Error('merchant tidak dikenal: ' + merchantId);
    return Pricing.getReasoning(tokenId, m.stock[tokenId], m.demand[tokenId], def.markup, {
      buyBonus: Merchants.buyBonusFor(def, tokenId),
      investor: isInvestor(s, merchantId)
    });
  }

  function getPrice(s, merchantId, tokenId, side) {
    var r = getReasoning(s, merchantId, tokenId);
    return side === 'sell' ? r.sell_price_effective : r.buy_price;
  }

  /* ---------- perdagangan demo ---------- */
  // Hasil: { ok:true, ... } atau { ok:false, error:'...' }.
  // Semua perdagangan memakai quote per-unit pricing.js supaya harga
  // bergerak di dalam satu transaksi besar (demand +1/unit).
  function buy(s, merchantId, tokenId, qty) {
    qty = Math.floor(qty);
    if (qty <= 0) return { ok: false, error: 'Jumlah harus >= 1.' };
    var def = Merchants.getMerchant(merchantId);
    var m = s.merchants[merchantId];
    if (!def || !m) return { ok: false, error: 'Merchant tidak dikenal.' };
    if (m.bankrupt) return { ok: false, error: def.name + ' sedang tutup (bangkrut). Invest dulu supaya buka lagi.' };
    if ((m.stock[tokenId] || 0) < qty) return { ok: false, error: 'Stok ' + def.name + ' kurang (tersedia ' + (m.stock[tokenId] || 0) + ').' };
    var q = Pricing.quoteBuy(tokenId, m.stock[tokenId], m.demand[tokenId], def.markup, qty);
    if (s.player.coins < q.total) return { ok: false, error: 'Koin kurang: butuh ' + q.total + ', kamu punya ' + s.player.coins + '.' };
    s.player.coins -= q.total;
    s.player.inv[tokenId] = (s.player.inv[tokenId] || 0) + qty;
    m.stock[tokenId] = q.endStock;
    m.demand[tokenId] = q.endDemand;
    m.coins += q.total;
    saveState(s);
    return { ok: true, total: q.total, unitPrices: q.unitPrices, qty: qty, tokenId: tokenId, merchantId: merchantId };
  }

  // Jual ke merchant. Penjualan PARSIAL (DESIGN.md §4): kalau koin merchant
  // tidak cukup membayar penuh, terjual sebanyak yang ia mampu (dihitung
  // per-unit, karena harga berubah tiap unit); sisanya tetap di pemain.
  // Bangkrut kalau koin merchant < BANKRUPT_THRESHOLD (10) setelah bayar.
  // Demand TIDAK berubah saat jual (hanya naik saat beli).
  function sell(s, merchantId, tokenId, qty) {
    qty = Math.floor(qty);
    if (qty <= 0) return { ok: false, error: 'Jumlah harus >= 1.' };
    var def = Merchants.getMerchant(merchantId);
    var m = s.merchants[merchantId];
    if (!def || !m) return { ok: false, error: 'Merchant tidak dikenal.' };
    if (m.bankrupt) return { ok: false, error: def.name + ' sedang tutup (bangkrut). Invest dulu supaya buka lagi.' };
    if ((s.player.inv[tokenId] || 0) < qty) return { ok: false, error: 'Kamu tidak punya ' + tokenId + ' sebanyak itu.' };
    var q = Pricing.quoteSell(tokenId, m.stock[tokenId], m.demand[tokenId], def.markup, qty, {
      buyBonus: Merchants.buyBonusFor(def, tokenId),
      investor: isInvestor(s, merchantId)
    });
    // Berapa unit yang mampu dibayar merchant (harga per-unit bisa berubah)?
    var affordable = 0, total = 0;
    for (var i = 0; i < q.unitPrices.length; i++) {
      if (total + q.unitPrices[i] > m.coins) break;
      total += q.unitPrices[i]; affordable++;
    }
    if (affordable <= 0) return { ok: false, error: def.name + ' tidak punya cukup koin (' + m.coins + ') untuk membayar 1 unit (' + q.unitPrices[0] + ' koin).' };
    s.player.inv[tokenId] -= affordable;
    s.player.coins += total;
    m.stock[tokenId] = m.stock[tokenId] + affordable;
    m.demand[tokenId] = q.endDemand; // tidak berubah saat jual
    m.coins -= total;
    // Bangkrut: koin merchant di bawah ambang setelah bayar -> toko tutup.
    if (m.coins < Merchants.BANKRUPT_THRESHOLD) { m.bankrupt = true; }
    saveState(s);
    return { ok: true, total: total, unitPrices: q.unitPrices.slice(0, affordable), qty: affordable, requested: qty, partial: affordable < qty, tokenId: tokenId, merchantId: merchantId, bankruptNow: m.bankrupt };
  }

  // Invest: min 50 koin, HANYA kalau merchant bangkrut.
  // Merchant buka lagi: saldo 100 koin + 10 unit tiap item spesialisasi.
  // Pemain tercatat sebagai investor (bonus jual +10% di merchant itu).
  function invest(s, merchantId, amount) {
    amount = Math.floor(amount);
    var def = Merchants.getMerchant(merchantId);
    var m = s.merchants[merchantId];
    if (!def || !m) return { ok: false, error: 'Merchant tidak dikenal.' };
    if (!m.bankrupt) return { ok: false, error: def.name + ' tidak bangkrut — invest hanya untuk merchant yang tutup.' };
    if (amount < Merchants.INVEST_MIN) return { ok: false, error: 'Invest minimal ' + Merchants.INVEST_MIN + ' koin.' };
    if (s.player.coins < amount) return { ok: false, error: 'Koin kurang: butuh ' + amount + ', kamu punya ' + s.player.coins + '.' };
    s.player.coins -= amount;
    m.coins = Merchants.INVEST_REOPEN_COINS;
    def.specialty.forEach(function (t) { m.stock[t] = (m.stock[t] || 0) + Merchants.INVEST_RESTOCK; });
    m.bankrupt = false;
    s.player.investors[merchantId] = true;
    saveState(s);
    return { ok: true, amount: amount, merchantId: merchantId, reopenCoins: m.coins };
  }

  /* ---------- gather (level selesai -> inventaris) ---------- */
  // pending: { wood:n, stone:n, ice:n, iron:n } hasil balok hancur.
  // stars: bintang level (3 -> +1 golden-egg).
  // Cap harian per akun per token (DESIGN.md §5): 200 material, 3 telur emas.
  // mighty-seed & squeek-coin TIDAK bisa di-gather.
  function commitGather(s, pending, stars) {
    var day = todayStr();
    if (s.player.gatherDay !== day) { s.player.gatherDay = day; s.player.gatherUsed = {}; }
    var credited = {}, capped = {};
    Object.keys(pending || {}).forEach(function (t) {
      var want = Math.floor(pending[t] || 0);
      if (want <= 0) return;
      var cap = GATHER_CAP[t];
      if (cap === undefined) return; // tidak bisa di-gather
      var used = s.player.gatherUsed[t] || 0;
      var allowed = Math.max(0, Math.min(want, cap - used));
      if (allowed > 0) {
        s.player.inv[t] = (s.player.inv[t] || 0) + allowed;
        s.player.gatherUsed[t] = used + allowed;
        credited[t] = allowed;
      }
      if (allowed < want) capped[t] = want - allowed;
    });
    if (stars >= 3) {
      var usedEgg = s.player.gatherUsed['golden-egg'] || 0;
      if (usedEgg < GATHER_CAP['golden-egg']) {
        s.player.inv['golden-egg'] = (s.player.inv['golden-egg'] || 0) + 1;
        s.player.gatherUsed['golden-egg'] = usedEgg + 1;
        credited['golden-egg'] = (credited['golden-egg'] || 0) + 1;
      } else capped['golden-egg'] = 1;
    }
    saveState(s);
    return { ok: true, credited: credited, capped: capped };
  }

  /* ---------- mighty-seed (power-up sekali pakai) ---------- */
  function armMightySeed(s) {
    if ((s.player.inv['mighty-seed'] || 0) <= 0) return { ok: false, error: 'Kamu tidak punya Benih Perkasa. Beli dulu di Bang Jago.' };
    s.mightySeedArmed = true;
    saveState(s);
    return { ok: true };
  }
  // Dipanggil launchBird: kalau armed, konsumsi 1 seed & kembalikan true.
  function consumeMightySeedIfArmed(s) {
    if (!s.mightySeedArmed) return false;
    if ((s.player.inv['mighty-seed'] || 0) <= 0) { s.mightySeedArmed = false; saveState(s); return false; }
    s.player.inv['mighty-seed'] -= 1;
    s.mightySeedArmed = false;
    saveState(s);
    return true;
  }

  function setPlayerName(s, name) {
    s.player.name = String(name || '').trim().slice(0, 20);
    saveState(s);
    return s.player.name;
  }

  /* ============================================================
     MODE TESTNET (opsional — kontrak ditulis contract worker)
     ============================================================ */
  var NEAR_CDN = 'https://cdn.jsdelivr.net/npm/near-api-js@5.1.1/lib/browser-index.min.js'; // UMD, terverifikasi 200
  var TESTNET = {
    networkId: 'testnet',
    nodeUrl: 'https://rpc.testnet.fastnear.com',
    walletUrl: 'https://testnet.mynearwallet.com',
    helperUrl: 'https://helper.testnet.near.org',
    explorerUrl: 'https://testnet.nearblocks.io',
    faucetUrl: 'https://near-faucet.io/'
  };

  // Konfigurasi kontrak dari market/near-config.js (kalau ada).
  // Bentuk: window.SQUEEK_NEAR_CONFIG = { contractId: 'squeek-market.testnet' }
  function getConfig() {
    if (typeof window !== 'undefined' && window.SQUEEK_NEAR_CONFIG) return window.SQUEEK_NEAR_CONFIG;
    if (typeof globalThis !== 'undefined' && globalThis.SQUEEK_NEAR_CONFIG) return globalThis.SQUEEK_NEAR_CONFIG;
    return null;
  }

  // Status testnet: 'no-config' | 'ready' | 'no-account'
  function testnetStatus() {
    var cfg = getConfig();
    if (!cfg || !cfg.contractId) return { status: 'no-config', message: 'Kontrak belum ter-deploy — mode testnet belum tersedia. Mode demo tetap jalan penuh.' };
    if (!store.get(LS_TESTNET_KEY)) return { status: 'no-account', contractId: cfg.contractId, message: 'Kontrak siap, tapi akun testnet belum dibuat. Buat akun implicit (gratis) lalu danai dari faucet.' };
    return { status: 'ready', contractId: cfg.contractId };
  }

  // AccountId testnet yang tersimpan (dari LS_TESTNET_KEY), atau null.
  // Dipakai UI untuk get_player (cek status investor) tanpa membuka
  // koneksi NEAR. TIDAK PERNAH mengembalikan secret key.
  function testnetAccountId() {
    var saved = store.get(LS_TESTNET_KEY);
    if (!saved) return null;
    try { return JSON.parse(saved).accountId || null; } catch (e) { return null; }
  }

  function loadNearApi() {
    return new Promise(function (resolve, reject) {
      if (typeof window !== 'undefined' && window.nearApi) return resolve(window.nearApi);
      if (typeof document === 'undefined') return reject(new Error('near-api-js hanya bisa dimuat di browser.'));
      var script = document.createElement('script');
      script.src = NEAR_CDN;
      script.onload = function () { resolve(window.nearApi); };
      script.onerror = function () { reject(new Error('Gagal memuat near-api-js dari CDN.')); };
      document.head.appendChild(script);
    });
  }

  // Buat akun implicit testnet: keypair acak disimpan di localStorage.
  // TIDAK PERNAH menampilkan seed phrase — ini kunci dev testnet saja.
  function ensureTestnetAccount() {
    return loadNearApi().then(function (nearApi) {
      var saved = store.get(LS_TESTNET_KEY);
      if (saved) {
        var parsed = JSON.parse(saved);
        return { accountId: parsed.accountId, existed: true };
      }
      var kp = nearApi.KeyPair.fromRandom('ed25519');
      var accountId = Buffer.from(nearApi.utils.serialize.base_decode(kp.getPublicKey().toString().split(':')[1])).toString('hex');
      var rec = { accountId: accountId, secretKey: kp.toString() };
      store.set(LS_TESTNET_KEY, JSON.stringify(rec));
      return { accountId: accountId, existed: false, faucetUrl: TESTNET.faucetUrl };
    });
  }

  function testnetConnection() {
    var cfg = getConfig();
    if (!cfg || !cfg.contractId) return Promise.reject(new Error('Kontrak belum ter-deploy.'));
    return loadNearApi().then(function (nearApi) {
      var saved = store.get(LS_TESTNET_KEY);
      if (!saved) throw new Error('Akun testnet belum dibuat.');
      var rec = JSON.parse(saved);
      var keyStore = new nearApi.keyStores.InMemoryKeyStore();
      return keyStore.setKey(TESTNET.networkId, rec.accountId, nearApi.KeyPair.fromString(rec.secretKey))
        .then(function () {
          return nearApi.connect({
            networkId: TESTNET.networkId,
            keyStore: keyStore,
            nodeUrl: TESTNET.nodeUrl,
            walletUrl: TESTNET.walletUrl,
            helperUrl: TESTNET.helperUrl,
            headers: {}
          });
        })
        .then(function (near) {
          return near.account(rec.accountId).then(function (account) {
            return { near: near, nearApi: nearApi, account: account, contractId: cfg.contractId };
          });
        });
    });
  }

  // View call (gratis, tanpa gas): get_price / get_reasoning / get_merchant
  // / get_merchants / get_player — sesuai DESIGN.md §5.
  function testnetView(method, args) {
    return testnetConnection().then(function (c) {
      return c.account.viewFunction({ contractId: c.contractId, methodName: method, args: args || {} });
    });
  }

  // Change call (butuh gas testnet): gather / buy / sell / invest / starter_grant.
  function testnetCall(method, args, gas, deposit) {
    return testnetConnection().then(function (c) {
      return c.account.functionCall({
        contractId: c.contractId,
        methodName: method,
        args: args || {},
        gas: gas || BigInt('30000000000000'),
        attachedDeposit: deposit || BigInt(0)
      });
    });
  }

  return {
    // demo
    LS_KEY: LS_KEY,
    DECAY_INTERVAL_MS: DECAY_INTERVAL_MS,
    GATHER_CAP: GATHER_CAP,
    freshState: freshState,
    loadState: loadState,
    saveState: saveState,
    resetState: resetState,
    applyDecay: applyDecay,
    getReasoning: getReasoning,
    getPrice: getPrice,
    buy: buy,
    sell: sell,
    invest: invest,
    commitGather: commitGather,
    armMightySeed: armMightySeed,
    consumeMightySeedIfArmed: consumeMightySeedIfArmed,
    setPlayerName: setPlayerName,
    isInvestor: isInvestor,
    // testnet
    NEAR_CDN: NEAR_CDN,
    TESTNET: TESTNET,
    getConfig: getConfig,
    testnetStatus: testnetStatus,
    testnetAccountId: testnetAccountId,
    loadNearApi: loadNearApi,
    ensureTestnetAccount: ensureTestnetAccount,
    testnetView: testnetView,
    testnetCall: testnetCall
  };
});
