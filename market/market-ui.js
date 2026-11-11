/* ============================================================
   SQUEEK MARKET — market-ui.js
   Panel "Squeek Market" di bawah arena (DESIGN.md §3, §4, §6).
   - Kartu tiap merchant: nama, kepribadian, status buka/tutup,
     saldo koin, daftar item + harga beli & jual live.
   - Tooltip di tiap harga: penalaran lengkap dari get_reasoning
     (base, stok, stockFactor, demand, demandFactor, markup).
   - Tombol Beli/Jual (+1/+5/+10), tombol Invest (kalau bangkrut).
   - Inventaris pemain + nama tampilan + tombol Benih Perkasa.
   - Tombol "⏩ Simulasi Seminggu" (fastforward.js).
   Mode demo default; mode testnet hanya aktif kalau kontrak
   sudah ter-deploy (market/near-config.js) — kalau belum, tampilkan
   pesan "kontrak belum ter-deploy" dan demo tetap jalan.
   ============================================================ */
(function () {
  'use strict';
  var Pricing = window.SqueekPricing;
  var Merchants = window.SqueekMerchants;
  var Near = window.SqueekNear;
  var FF = window.SqueekFF;

  var state = Near.loadState();
  Near.applyDecay(state);
  state = Near.loadState();

  /* ---------- gather: balok hancur selama level ---------- */
  // Dipanggil dari killBody() di index.html. Material BELUM masuk
  // inventaris — baru di-commit saat level selesai (commitGather).
  var gatherPending = {};
  function resetGather() { gatherPending = {}; renderGatherLine(); }
  function noteBlockDestroyed(mat) {
    // mat di sini material balok game: wood/stone/ice/tnt.
    var token = mat === 'tnt' ? 'iron' : mat;
    var item = Merchants.ITEMS[token];
    if (!item) return;
    gatherPending[token] = (gatherPending[token] || 0) + item.yield;
    renderGatherLine();
  }
  function commitLevelGather(stars) {
    var res = Near.commitGather(state, gatherPending, stars);
    state = Near.loadState();
    var parts = [];
    Object.keys(res.credited).forEach(function (t) {
      parts.push('+' + res.credited[t] + ' ' + Merchants.ITEMS[t].emoji + ' ' + Merchants.ITEMS[t].name);
    });
    if (parts.length) toast('🎒 Gather level: ' + parts.join(', '));
    if (res.capped && Object.keys(res.capped).length) {
      toast('⚠️ Cap harian tercapai untuk: ' + Object.keys(res.capped).join(', '));
    }
    gatherPending = {};
    renderAll();
    return res;
  }

  /* ---------- mighty-seed ---------- */
  function isMightySeedArmed() { return !!state.mightySeedArmed; }
  function consumeMightySeedIfArmed() {
    var used = Near.consumeMightySeedIfArmed(state);
    if (used) { state = Near.loadState(); renderAll(); toast('🌱 Benih Perkasa aktif! Luncuran ini ×1.5'); }
    return used;
  }

  // API untuk hook game di index.html.
  window.SqueekMarket = {
    noteBlockDestroyed: noteBlockDestroyed,
    commitLevelGather: commitLevelGather,
    resetGather: resetGather,
    isMightySeedArmed: isMightySeedArmed,
    consumeMightySeedIfArmed: consumeMightySeedIfArmed,
    getState: function () { return state; }
  };

  /* ---------- toast ---------- */
  var toastEl = null;
  function toast(msg) {
    if (!toastEl) return;
    var div = document.createElement('div');
    div.className = 'mk-toast';
    div.textContent = msg;
    toastEl.appendChild(div);
    setTimeout(function () { div.classList.add('fade'); }, 2600);
    setTimeout(function () { div.remove(); }, 3200);
  }

  /* ---------- render ---------- */
  var panelEl = null;

  function fmt(n) { return Number(n).toLocaleString('id-ID'); }

  // Tooltip penalaran (DESIGN.md §4): base, stok+stockFactor,
  // demand+demandFactor, markup, harga akhir.
  function reasoningTip(r) {
    return 'Base: ' + r.base + ' koin\n' +
      'Stok merchant: ' + r.stock + ' → stockFactor ' + r.stock_factor.toFixed(2) + '\n' +
      'Demand: ' + r.demand + ' → demandFactor ' + r.demand_factor.toFixed(2) + '\n' +
      'Markup: ×' + r.markup.toFixed(2) + '\n' +
      'Harga beli: ' + r.buy_price + ' koin\n' +
      'Harga jual: ' + r.sell_price_effective + ' koin' +
      (r.sell_bonus > 1 ? ' (bonus ×' + r.sell_bonus.toFixed(2) + ')' : '');
  }

  function itemRow(def, m, tokenId) {
    var item = Merchants.ITEMS[tokenId];
    var r = Near.getReasoning(state, def.id, tokenId);
    var stock = m.stock[tokenId];
    var row = document.createElement('div');
    row.className = 'mk-item';
    var buyDisabled = m.bankrupt || stock <= 0 || state.player.coins < r.buy_price;
    var sellDisabled = m.bankrupt || (state.player.inv[tokenId] || 0) <= 0;
    row.innerHTML =
      '<span class="mk-item-name" title="' + item.name + '">' + item.emoji + ' ' + item.name + '</span>' +
      '<span class="mk-stock" title="Stok merchant">📦 ' + stock + '</span>' +
      '<span class="mk-price" title="' + reasoningTip(r).replace(/"/g, '&quot;') + '">Beli <b>' + r.buy_price + '</b> 🪙</span>' +
      '<span class="mk-price" title="' + reasoningTip(r).replace(/"/g, '&quot;') + '">Jual <b>' + r.sell_price_effective + '</b> 🪙</span>' +
      '<span class="mk-actions"></span>';
    var actions = row.querySelector('.mk-actions');
    [1, 5, 10].forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn mk-mini'; b.textContent = '+' + q;
      b.disabled = buyDisabled;
      b.title = 'Beli ' + q + ' ' + item.name;
      b.addEventListener('click', function () { doTrade('buy', def.id, tokenId, q); });
      actions.appendChild(b);
    });
    [1, 5, 10].forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn mk-mini sell'; b.textContent = '−' + q;
      b.disabled = sellDisabled;
      b.title = 'Jual ' + q + ' ' + item.name;
      b.addEventListener('click', function () { doTrade('sell', def.id, tokenId, q); });
      actions.appendChild(b);
    });
    return row;
  }

  function merchantCard(def) {
    var m = state.merchants[def.id];
    var card = document.createElement('div');
    card.className = 'mk-merchant' + (m.bankrupt ? ' bankrupt' : '');
    var status = m.bankrupt
      ? '<span class="mk-badge closed">⛔ TUTUP — bangkrut</span>'
      : '<span class="mk-badge open">🟢 Buka</span>';
    var investor = state.player.investors[def.id]
      ? '<span class="mk-badge investor">⭐ Investor — bonus jual +10%</span>' : '';
    var head = document.createElement('div');
    head.className = 'mk-mhead';
    head.innerHTML = '<div><div class="mk-mname">' + def.emoji + ' ' + def.name + ' ' + status + ' ' + investor + '</div>' +
      '<div class="mk-mpers">' + def.personality + ' Spesialisasi: ' + def.specialtyLabel + ' · Markup ×' + def.markup.toFixed(2) + '</div></div>' +
      '<div class="mk-mcoins">🪙 <b>' + fmt(m.coins) + '</b><small>koin merchant</small></div>';
    card.appendChild(head);
    var list = document.createElement('div');
    list.className = 'mk-items';
    Merchants.TRADEABLE.forEach(function (t) { list.appendChild(itemRow(def, m, t)); });
    card.appendChild(list);
    if (m.bankrupt) {
      var inv = document.createElement('button');
      inv.type = 'button'; inv.className = 'btn primary mk-invest';
      inv.textContent = '💸 Invest ' + Merchants.INVEST_MIN + ' koin — buka lagi toko ini';
      inv.title = 'Merchant buka lagi dengan 100 koin + 10 unit tiap item spesialisasi. Kamu jadi investor (bonus jual +10%).';
      inv.addEventListener('click', function () { doInvest(def.id); });
      card.appendChild(inv);
    }
    return card;
  }

  function renderInventory() {
    var bar = document.getElementById('mkInvBar');
    if (!bar) return;
    var p = state.player;
    var html = '<span class="mk-player">👤 <b>' + (p.name || 'Sob') + '</b></span>' +
      '<span class="mk-coins">🪙 <b>' + fmt(p.coins) + '</b> koin</span>';
    Merchants.TRADEABLE.forEach(function (t) {
      var item = Merchants.ITEMS[t];
      html += '<span class="mk-inv" title="' + item.name + '">' + item.emoji + ' ' + fmt(p.inv[t] || 0) + '</span>';
    });
    if ((p.inv['mighty-seed'] || 0) > 0) {
      html += state.mightySeedArmed
        ? '<span class="mk-badge armed">🌱 Benih Perkasa AKTIF — luncuran berikutnya ×1.5</span>'
        : '<button class="btn green mk-mini" id="mkArmSeed" type="button">🌱 Pakai Benih Perkasa (×1.5)</button>';
    }
    bar.innerHTML = html;
    var arm = document.getElementById('mkArmSeed');
    if (arm) arm.addEventListener('click', function () {
      var r = Near.armMightySeed(state);
      state = Near.loadState();
      if (r.ok) toast('🌱 Benih Perkasa dipasang — luncuran berikutnya ×1.5!');
      else toast('⚠️ ' + r.error);
      renderAll();
    });
  }

  function renderGatherLine() {
    var el = document.getElementById('mkGatherLine');
    if (!el) return;
    var parts = [];
    Object.keys(gatherPending).forEach(function (t) {
      if (gatherPending[t] > 0) parts.push('+' + gatherPending[t] + ' ' + Merchants.ITEMS[t].emoji + ' ' + Merchants.ITEMS[t].name);
    });
    el.textContent = parts.length
      ? '🎒 Gather level ini (masuk inventaris saat level selesai): ' + parts.join(', ')
      : '🎒 Gather level ini: belum ada balok hancur.';
  }

  function renderMerchants() {
    var wrap = document.getElementById('mkMerchants');
    if (!wrap) return;
    wrap.innerHTML = '';
    Merchants.MERCHANTS.forEach(function (def) { wrap.appendChild(merchantCard(def)); });
  }

  function renderMode() {
    var badge = document.getElementById('mkModeBadge');
    if (!badge) return;
    badge.textContent = state.mode === 'testnet' ? '⛓️ Mode: NEAR testnet' : '🎮 Mode: Demo (tanpa wallet)';
    badge.className = 'mk-badge ' + (state.mode === 'testnet' ? 'testnet' : 'demo');
    var note = document.getElementById('mkModeNote');
    if (note) {
      if (state.mode === 'testnet') {
        var st = Near.testnetStatus();
        note.textContent = st.status === 'ready'
          ? 'Kontrak: ' + st.contractId
          : st.message;
      } else {
        note.textContent = 'Demo: semua perdagangan dihitung lokal, tanpa jaringan ke NEAR.';
      }
    }
  }

  function renderAll() {
    renderMode();
    renderInventory();
    renderGatherLine();
    renderMerchants();
  }

  /* ---------- aksi ---------- */
  function doTrade(side, merchantId, tokenId, qty) {
    if (state.mode === 'testnet') {
      var st = Near.testnetStatus();
      if (st.status !== 'ready') {
        toast('⛓️ ' + st.message);
        return;
      }
      // Kontrak sudah ada: panggil method buy/sell (async).
      // buy pakai max_price (batas atas TOTAL), sell pakai min_price
      // (batas bawah TOTAL). Keduanya dihitung PER-UNIT dari state
      // merchant on-chain TERBARU (DESIGN.md §4) — harga flat
      // (harga per-unit x qty) SALAH: tiap unit mengubah stok &
      // demand, jadi total != unit x qty (contoh: buy 5 kayu total
      // 23, bukan 20; sell 40 iron total ~228, bukan 320).
      var method = side === 'buy' ? 'buy' : 'sell';
      var def = Merchants.getMerchant(merchantId);
      var accountId = Near.testnetAccountId();
      var merchantP = Near.testnetView('get_merchant', { merchant_id: merchantId });
      var playerP = accountId
        ? Near.testnetView('get_player', { account_id: accountId })
        : Promise.resolve(null);
      Promise.all([merchantP, playerP]).then(function (res) {
        var m = res[0];
        var investor = !!(res[1] && res[1].invested_in && res[1].invested_in.indexOf(merchantId) !== -1);
        var markup = (m && typeof m.markup === 'number') ? m.markup : def.markup;
        var q = side === 'buy'
          ? Pricing.quoteBuy(tokenId, m.stock[tokenId], m.demand[tokenId], markup, qty)
          : Pricing.quoteSell(tokenId, m.stock[tokenId], m.demand[tokenId], markup, qty, {
              buyBonus: Merchants.buyBonusFor(def, tokenId),
              investor: investor
            });
        var args = { merchant_id: merchantId, token_id: tokenId, amount: String(qty) };
        if (side === 'buy') args.max_price = String(q.total);
        else args.min_price = String(q.total);
        return Near.testnetCall(method, args).then(function () { return q; });
      })
        .then(function (q) { toast('⛓️ Transaksi ' + method + ' terkirim ke testnet (' + q.total + ' koin).'); })
        .catch(function (e) { toast('⚠️ Testnet gagal: ' + e.message); });
      return;
    }
    var res = side === 'buy' ? Near.buy(state, merchantId, tokenId, qty) : Near.sell(state, merchantId, tokenId, qty);
    state = Near.loadState();
    if (!res.ok) { toast('⚠️ ' + res.error); return; }
    var item = Merchants.ITEMS[tokenId];
    var verb = side === 'buy' ? 'Beli' : 'Jual';
    toast((side === 'buy' ? '🛒 ' : '💰 ') + verb + ' ' + res.qty + ' ' + item.name + ' — ' + res.total + ' koin.' +
      (res.partial ? ' (parsial: merchant hanya mampu bayar ' + res.qty + ' dari ' + res.requested + ')' : ''));
    if (res.bankruptNow) toast('💥 Merchant bangkrut! Toko tutup — invest ' + Merchants.INVEST_MIN + ' koin untuk buka lagi.');
    renderAll();
  }

  function doInvest(merchantId) {
    if (state.mode === 'testnet') {
      var st = Near.testnetStatus();
      if (st.status !== 'ready') { toast('⛓️ ' + st.message); return; }
      Near.testnetCall('invest', { merchant_id: merchantId, amount: String(Merchants.INVEST_MIN) })
        .then(function () { toast('⛓️ Invest terkirim ke testnet.'); })
        .catch(function (e) { toast('⚠️ Testnet gagal: ' + e.message); });
      return;
    }
    var def = Merchants.getMerchant(merchantId);
    var res = Near.invest(state, merchantId, Merchants.INVEST_MIN);
    state = Near.loadState();
    if (!res.ok) { toast('⚠️ ' + res.error); return; }
    toast('💸 Invest ' + res.amount + ' koin ke ' + def.name + ' — toko buka lagi (100 koin + 10 unit spesialisasi). Bonus jual +10% aktif!');
    renderAll();
  }

  /* ---------- fast-forward ---------- */
  var ffRunning = false;
  function runFastForward() {
    if (ffRunning) return;
    var logEl = document.getElementById('mkFfLog');
    var priceEl = document.getElementById('mkFfPrices');
    var btn = document.getElementById('mkFfBtn');
    if (!logEl || !priceEl) return;
    ffRunning = true;
    btn.disabled = true;
    btn.textContent = '⏳ Simulasi berjalan…';
    logEl.innerHTML = '';
    logEl.classList.add('show');
    priceEl.classList.add('show');
    var startPrices = FF.snapshotPrices(state);
    renderFfPrices(priceEl, startPrices, startPrices, 0);
    FF.run(state, {
      onDay: function (day, sim, dayLog, prices) {
        dayLog.forEach(function (e) {
          var div = document.createElement('div');
          div.className = 'mk-ff-' + e.kind;
          div.textContent = e.text;
          logEl.appendChild(div);
        });
        logEl.scrollTop = logEl.scrollHeight;
        renderFfPrices(priceEl, startPrices, prices, day);
      },
      onDone: function (summary) {
        ffRunning = false;
        btn.disabled = false;
        btn.textContent = '⏩ Simulasi Seminggu';
        var div = document.createElement('div');
        div.className = 'mk-ff-day';
        div.textContent = '✅ Simulasi selesai — 7 hari, ' + summary.log.length + ' entri log. ' +
          (summary.bankrupt.length ? 'Bangkrut (simulasi): ' + summary.bankrupt.join(', ') + '. ' : 'Tidak ada merchant bangkrut. ') +
          'Simulasi — bukan perdagangan nyata.';
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
        toast('✅ Simulasi seminggu selesai. Pasar nyata tidak berubah.');
      }
    });
  }

  function renderFfPrices(el, start, cur, day) {
    var html = '<div class="mk-ff-title">📈 Harga beli (Pak Kumis) — Hari ' + day + ' / 7 · Simulasi, bukan harga nyata</div><table class="mk-ff-table"><tr><th>Item</th><th>Awal</th><th>Sekarang</th><th>Δ</th></tr>';
    Merchants.TRADEABLE.forEach(function (t) {
      var a = start['pak-kumis'][t], b = cur['pak-kumis'][t];
      var d = b - a;
      html += '<tr><td>' + Merchants.ITEMS[t].emoji + ' ' + Merchants.ITEMS[t].name + '</td><td>' + a + '</td><td>' + b + '</td><td class="' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + (d > 0 ? '+' : '') + d + '</td></tr>';
    });
    el.innerHTML = html + '</table>';
  }

  /* ---------- mode testnet ---------- */
  function toggleMode() {
    if (state.mode === 'demo') {
      var st = Near.testnetStatus();
      if (st.status === 'no-config') {
        toast('⛓️ Kontrak belum ter-deploy — mode testnet belum tersedia. Tetap di mode demo.');
        return;
      }
      state.mode = 'testnet';
      Near.saveState(state);
      if (st.status === 'no-account') {
        toast('⛓️ ' + st.message);
        Near.ensureTestnetAccount().then(function (acc) {
          toast(acc.existed ? '⛓️ Akun testnet: ' + acc.accountId : '⛓️ Akun testnet dibuat: ' + acc.accountId + ' — danai dari faucet: ' + (acc.faucetUrl || ''));
          renderAll();
        }).catch(function (e) { toast('⚠️ ' + e.message); });
      }
    } else {
      state.mode = 'demo';
      Near.saveState(state);
      toast('🎮 Kembali ke mode demo.');
    }
    renderAll();
  }

  /* ---------- bangun panel ---------- */
  function buildPanel() {
    var anchor = document.querySelector('.legend');
    panelEl = document.createElement('div');
    panelEl.className = 'market-panel';
    panelEl.id = 'squeekMarket';
    panelEl.innerHTML =
      '<div class="mk-head">' +
        '<div><h2>🪙 Squeek Market</h2>' +
        '<div class="mk-sub">Jual hasil gather, beli material &amp; Benih Perkasa, atau invest ke merchant yang bangkrut. Harga bergerak mengikuti stok &amp; demand — arahkan kursor ke harga untuk melihat penalarannya.</div></div>' +
        '<div class="mk-head-right">' +
          '<span class="mk-badge demo" id="mkModeBadge">🎮 Mode: Demo</span>' +
          '<button class="btn" id="mkModeBtn" type="button">⛓️ Main di NEAR testnet</button>' +
        '</div>' +
      '</div>' +
      '<div class="mk-mode-note" id="mkModeNote"></div>' +
      '<div class="mk-name-row"><label>Nama pemain: <input id="mkName" type="text" maxlength="20" placeholder="Sob" /></label>' +
      '<span class="mk-hint">Nama tampilan saja — tanpa wallet di mode demo.</span></div>' +
      '<div class="mk-invbar" id="mkInvBar"></div>' +
      '<div class="mk-gather" id="mkGatherLine"></div>' +
      '<div class="mk-merchants" id="mkMerchants"></div>' +
      '<div class="mk-ff">' +
        '<button class="btn primary" id="mkFfBtn" type="button">⏩ Simulasi Seminggu</button>' +
        '<span class="mk-ff-note">Simulasi — bukan perdagangan nyata. 7 hari × ~8 detik, trader NPC berdagang di atas <b>salinan</b> pasar.</span>' +
      '</div>' +
      '<div class="mk-ff-prices" id="mkFfPrices"></div>' +
      '<div class="mk-ff-log" id="mkFfLog"></div>' +
      '<div class="mk-toasts" id="mkToasts"></div>';
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panelEl, anchor.nextSibling);
    else document.querySelector('.wrap').appendChild(panelEl);
    toastEl = document.getElementById('mkToasts');

    var nameInput = document.getElementById('mkName');
    nameInput.value = state.player.name || '';
    nameInput.addEventListener('change', function () {
      Near.setPlayerName(state, nameInput.value);
      state = Near.loadState();
      renderInventory();
      toast('👋 Halo, ' + (state.player.name || 'Sob') + '!');
    });
    document.getElementById('mkModeBtn').addEventListener('click', toggleMode);
    document.getElementById('mkFfBtn').addEventListener('click', runFastForward);
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildPanel);
  } else {
    buildPanel();
  }
})();
