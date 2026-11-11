// Unit test kontrak Squeek Market — jalan di Node dengan mock host NEAR
// (test/mock-env.mjs). Menguji LOGIKA KONTRAK ASLI (bukan reimplementasi):
// class SqueekMarket dari src/contract.ts dikompilasi ke test-build/.
//   npm test   (pretest otomatis mengkompilasi)
// Aturan §4 FINAL yang diuji: per-unit pricing, demand HANYA naik saat beli,
// penjualan parsial + ambang bangkrut 10 koin.
import "./mock-env.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SqueekMarket } from "../test-build/contract.bundle.mjs";
import { freshEnv } from "./mock-env.mjs";

let env;
let c;

const ALICE = "alice.testnet";
const BOB = "bob.testnet";
const OWNER = "owner.testnet";

function fresh() {
  env = freshEnv();
  env.setCaller(OWNER);
  c = new SqueekMarket();
  c.init({ owner_id: OWNER });
  env.setCaller(ALICE);
  return c;
}

// Daftarkan merchant "faucet" test-only (koin besar) supaya pemain bisa
// didanai lewat jalur jual yang sah, tanpa menyentuh saldo langsung.
function addFaucet(coins = 1_000_000) {
  env.setCaller(OWNER);
  c.register_merchant({ merchant_id: "faucet", stock: {}, coins });
  env.setCaller(ALICE);
}

// Danai pemain: gather satu token sampai cap lalu jual ke faucet.
function fundCoins(account, token = "iron") {
  env.setCaller(account);
  addFaucet();
  c.gather({ token_id: token, amount: 200 });
  const r = c.sell({ merchant_id: "faucet", token_id: token, amount: 200, min_price: 0 });
  env.setCaller(ALICE);
  return r.total_price;
}

function bal(account, token) {
  return Number(c.mt_balance_of({ account_id: account, token_id: token }));
}

function merchant(id) {
  return c.get_merchant({ merchant_id: id });
}

function throws(fn, pattern) {
  assert.throws(fn, (e) => {
    assert.match(String(e.message ?? e), pattern);
    return true;
  });
}

beforeEach(() => {
  fresh();
});

/* ---------- 1. init ---------- */
test("init: 3 merchant, stok 50, koin 200, demand 0, markup + spesialisasi benar", () => {
  const ms = c.get_merchants();
  assert.equal(ms.length, 3);
  const byId = Object.fromEntries(ms.map((m) => [m.merchant_id, m]));
  for (const id of ["pak-kumis", "bu-sari", "bang-jago"]) {
    assert.equal(byId[id].coins, 200);
    assert.equal(byId[id].bankrupt, false);
    for (const t of ["wood", "stone", "iron", "ice", "golden-egg", "mighty-seed"]) {
      assert.equal(byId[id].stock[t], 50, `${id} stock ${t}`);
      assert.equal(byId[id].demand[t], 0, `${id} demand ${t}`);
    }
    assert.deepEqual(byId[id].invested_by, []);
  }
  assert.equal(byId["pak-kumis"].markup, 1.0);
  assert.equal(byId["bu-sari"].markup, 1.15);
  assert.equal(byId["bang-jago"].markup, 1.25);
  assert.deepEqual(byId["pak-kumis"].specialties, ["wood", "ice"]);
  assert.deepEqual(byId["bu-sari"].specialties, ["stone", "iron"]);
  assert.deepEqual(byId["bang-jago"].specialties, ["golden-egg", "mighty-seed"]);
  assert.equal(byId["bang-jago"].buy_bonus_token, "golden-egg");
  assert.equal(byId["bang-jago"].buy_bonus, 1.2);
  assert.equal(byId["pak-kumis"].account, "pak-kumis.squeek-market.testnet");
});

/* ---------- 2. starter grant ---------- */
test("starter_grant: 20 koin sekali per akun; kedua kali gagal", () => {
  c.starter_grant();
  assert.equal(bal(ALICE, "squeek-coin"), 20);
  assert.equal(c.mt_supply({ token_id: "squeek-coin" }), "20");
  throws(() => c.starter_grant(), /already claimed/);
  env.setCaller(BOB);
  c.starter_grant();
  assert.equal(bal(BOB, "squeek-coin"), 20);
});

/* ---------- 3. gather + cap harian ---------- */
test("gather: mint sesuai jumlah; cap harian 200 material / 3 telur emas", () => {
  c.gather({ token_id: "wood", amount: 150 });
  assert.equal(bal(ALICE, "wood"), 150);
  assert.equal(c.mt_supply({ token_id: "wood" }), "150");
  c.gather({ token_id: "wood", amount: 50 });
  assert.equal(bal(ALICE, "wood"), 200);
  throws(() => c.gather({ token_id: "wood", amount: 1 }), /cap exceeded/);
  c.gather({ token_id: "golden-egg", amount: 3 });
  assert.equal(bal(ALICE, "golden-egg"), 3);
  throws(() => c.gather({ token_id: "golden-egg", amount: 1 }), /cap exceeded/);
  // Token yang tidak bisa di-gather.
  throws(() => c.gather({ token_id: "mighty-seed", amount: 1 }), /cannot be gathered/);
  throws(() => c.gather({ token_id: "squeek-coin", amount: 1 }), /cannot be gathered/);
  throws(() => c.gather({ token_id: "wood", amount: 0 }), /positive integer/);
});

test("gather: cap reset hari berikutnya", () => {
  c.gather({ token_id: "wood", amount: 200 });
  throws(() => c.gather({ token_id: "wood", amount: 1 }), /cap exceeded/);
  env.advanceSec(86400);
  c.gather({ token_id: "wood", amount: 200 });
  assert.equal(bal(ALICE, "wood"), 400);
});

/* ---------- 4. NEP-245 core ---------- */
test("mt_transfer: butuh 1 yocto; saldo pindah; kurang saldo gagal", () => {
  c.gather({ token_id: "wood", amount: 10 });
  env.setDeposit(0n);
  throws(() => c.mt_transfer({ receiver_id: BOB, token_id: "wood", amount: "4" }), /1 yocto/);
  env.setDeposit(1n);
  c.mt_transfer({ receiver_id: BOB, token_id: "wood", amount: "4" });
  assert.equal(bal(ALICE, "wood"), 6);
  assert.equal(bal(BOB, "wood"), 4);
  assert.equal(c.mt_balance_of({ account_id: BOB, token_id: "wood" }), "4");
  throws(
    () => c.mt_transfer({ receiver_id: BOB, token_id: "wood", amount: "7" }),
    /Insufficient balance/,
  );
  env.setDeposit(0n);
});

test("mt_batch_transfer: panjang harus sama; mt_batch_balance_of", () => {
  c.gather({ token_id: "wood", amount: 10 });
  c.gather({ token_id: "stone", amount: 5 });
  env.setDeposit(1n);
  throws(
    () =>
      c.mt_batch_transfer({
        receiver_id: BOB,
        token_ids: ["wood", "stone"],
        amounts: ["1"],
      }),
    /length mismatch/,
  );
  c.mt_batch_transfer({
    receiver_id: BOB,
    token_ids: ["wood", "stone"],
    amounts: ["3", "2"],
  });
  assert.deepEqual(
    c.mt_batch_balance_of({ account_id: BOB, token_ids: ["wood", "stone"] }),
    ["3", "2"],
  );
  env.setDeposit(0n);
});

test("mt_token / mt_tokens / mt_tokens_for_owner / mt_supply", () => {
  const wood = c.mt_token({ token_id: "wood" });
  assert.equal(wood.name, "Kayu");
  assert.equal(wood.symbol, "WOOD");
  assert.equal(wood.decimals, 0);
  assert.equal(wood.base_price, 4);
  assert.equal(c.mt_token({ token_id: "tidak-ada" }), null);
  assert.equal(c.mt_tokens({}).length, 7);
  assert.equal(c.mt_tokens({ from_index: "2", limit: 2 }).length, 2);
  c.gather({ token_id: "wood", amount: 7 });
  const owned = c.mt_tokens_for_owner({ account_id: ALICE });
  assert.equal(owned.find((t) => t.token_id === "wood").balance, "7");
  assert.equal(c.mt_supply({ token_id: "wood" }), "7");
  assert.equal(c.mt_supply({ token_id: "tidak-ada" }), null);
});

/* ---------- 5. buy per-unit ---------- */
test("buy 5 kayu @ harga awal 4 -> total 23 (unit 4,4,5,5,5), demand +5", () => {
  fundCoins(ALICE);
  const coinsBefore = bal(ALICE, "squeek-coin");
  const r = c.buy({ merchant_id: "pak-kumis", token_id: "wood", amount: 5, max_price: 23 });
  assert.deepEqual(r.unit_prices, [4, 4, 5, 5, 5]);
  assert.equal(r.total_price, 23);
  assert.equal(bal(ALICE, "wood"), 5);
  assert.equal(bal(ALICE, "squeek-coin"), coinsBefore - 23);
  assert.equal(merchant("pak-kumis").stock.wood, 45);
  assert.equal(merchant("pak-kumis").demand.wood, 5);
  assert.equal(merchant("pak-kumis").coins, 200 + 23);
});

test("buy: gagal kalau harga > max_price / koin kurang / stok kurang; arg string OK", () => {
  fundCoins(ALICE);
  throws(
    () => c.buy({ merchant_id: "pak-kumis", token_id: "wood", amount: 5, max_price: 22 }),
    /exceeds max_price/,
  );
  // Argumen string (cara UI memanggil) harus diterima.
  const r = c.buy({ merchant_id: "pak-kumis", token_id: "wood", amount: "1", max_price: "4" });
  assert.equal(r.total_price, 4);
  throws(
    () => c.buy({ merchant_id: "pak-kumis", token_id: "wood", amount: 100, max_price: 100000 }),
    /stock insufficient/,
  );
  env.setCaller(BOB); // bob tanpa koin
  throws(
    () => c.buy({ merchant_id: "pak-kumis", token_id: "wood", amount: 1, max_price: 100 }),
    /Insufficient squeek-coin/,
  );
  throws(
    () => c.buy({ merchant_id: "pak-kumis", token_id: "squeek-coin", amount: 1, max_price: 1 }),
    /not a tradable good/,
  );
});

/* ---------- 6. sell + banjir (demand TIDAK naik saat jual) ---------- */
test("banjir: jual 40 iron -> stok 90, demand TETAP 0, harga beli 12->6, jual 8->4", () => {
  // Modal merchant besar supaya sanggup bayar penuh (seperti test frontend).
  env.setCaller(OWNER);
  c.register_merchant({ merchant_id: "bu-sari", stock: {}, coins: 10000 });
  env.setCaller(ALICE);
  const buyBefore = c.get_price({ merchant_id: "bu-sari", token_id: "iron", side: "buy" });
  const sellBefore = c.get_price({ merchant_id: "bu-sari", token_id: "iron", side: "sell" });
  assert.equal(buyBefore, 12);
  assert.equal(sellBefore, 8);
  c.gather({ token_id: "iron", amount: 40 });
  const r = c.sell({ merchant_id: "bu-sari", token_id: "iron", amount: 40, min_price: 0 });
  assert.equal(r.partial, false);
  assert.equal(r.amount, 40);
  const m = merchant("bu-sari");
  assert.equal(m.stock.iron, 90);
  assert.equal(m.demand.iron, 0); // jual TIDAK menaikkan demand
  assert.equal(c.get_price({ merchant_id: "bu-sari", token_id: "iron", side: "buy" }), 6);
  assert.equal(c.get_price({ merchant_id: "bu-sari", token_id: "iron", side: "sell" }), 4);
  assert.equal(bal(ALICE, "iron"), 0);
  assert.equal(bal(ALICE, "squeek-coin"), r.total_price);
  // Reasoning konsisten: stock_factor jatuh 1.00 -> 0.50, demand_factor tetap 1.
  const reason = c.get_reasoning({ merchant_id: "bu-sari", token_id: "iron" });
  assert.equal(reason.stock_factor, 0.5);
  assert.equal(reason.demand_factor, 1);
  assert.equal(reason.buy_price, 6);
  assert.equal(reason.sell_price, 4);
});

test("sell: demand tetap 0 walau jual berkali-kali; buy menaikkan demand", () => {
  c.gather({ token_id: "stone", amount: 10 });
  c.sell({ merchant_id: "bu-sari", token_id: "stone", amount: 5, min_price: 0 });
  assert.equal(merchant("bu-sari").demand.stone, 0);
  fundCoins(ALICE);
  c.buy({ merchant_id: "bu-sari", token_id: "stone", amount: 3, max_price: 100 });
  assert.equal(merchant("bu-sari").demand.stone, 3);
});

/* ---------- 7. bangkrut parsial + ambang 10 ---------- */
test("bangkrut: koin 10, jual 2 iron -> parsial 1 unit (8 koin), sisa 2 < 10 -> bangkrut", () => {
  env.setCaller(OWNER);
  c.register_merchant({ merchant_id: "bu-sari", stock: {}, coins: 10 });
  env.setCaller(ALICE);
  c.gather({ token_id: "iron", amount: 10 });
  const coinsBefore = bal(ALICE, "squeek-coin");
  const r = c.sell({ merchant_id: "bu-sari", token_id: "iron", amount: 2, min_price: 0 });
  assert.equal(r.partial, true);
  assert.equal(r.amount, 1);
  assert.equal(r.requested, 2);
  assert.equal(r.total_price, 8);
  assert.deepEqual(r.unit_prices, [8]);
  assert.equal(r.merchant_bankrupt, true);
  assert.equal(r.merchant_coins, 2); // sisa koin TETAP dicatat, bukan di-nol-kan
  const m = merchant("bu-sari");
  assert.equal(m.bankrupt, true);
  assert.equal(m.coins, 2);
  assert.equal(bal(ALICE, "iron"), 9); // sisa 1 iron tetap di pemain
  assert.equal(bal(ALICE, "squeek-coin"), coinsBefore + 8);
  // Toko tutup: beli & jual ditolak.
  throws(() => c.buy({ merchant_id: "bu-sari", token_id: "iron", amount: 1, max_price: 100 }), /bankrupt/);
  throws(() => c.sell({ merchant_id: "bu-sari", token_id: "iron", amount: 1, min_price: 0 }), /bankrupt/);
});

test("bangkrut: koin 50, jual 10 iron -> terjual 7 unit (50 koin), koin 0 -> bangkrut", () => {
  env.setCaller(OWNER);
  c.register_merchant({ merchant_id: "bu-sari", stock: {}, coins: 50 });
  env.setCaller(ALICE);
  c.gather({ token_id: "iron", amount: 10 });
  const r = c.sell({ merchant_id: "bu-sari", token_id: "iron", amount: 10, min_price: 0 });
  assert.equal(r.partial, true);
  assert.equal(r.amount, 7);
  assert.deepEqual(r.unit_prices, [8, 7, 7, 7, 7, 7, 7]);
  assert.equal(r.total_price, 50);
  assert.equal(r.merchant_coins, 0);
  assert.equal(r.merchant_bankrupt, true);
  assert.equal(bal(ALICE, "iron"), 3);
});

test("bangkrut: koin 5 tidak cukup 1 unit (8 koin) -> sell gagal, TIDAK bangkrut sendiri", () => {
  env.setCaller(OWNER);
  c.register_merchant({ merchant_id: "bu-sari", stock: {}, coins: 5 });
  env.setCaller(ALICE);
  c.gather({ token_id: "iron", amount: 1 });
  throws(
    () => c.sell({ merchant_id: "bu-sari", token_id: "iron", amount: 1, min_price: 0 }),
    /cannot afford even 1 unit/,
  );
  assert.equal(merchant("bu-sari").bankrupt, false);
});

test("bangkrut: koin 15, jual penuh 1 iron (8) -> sisa 7 < 10 -> bangkrut walau penuh", () => {
  env.setCaller(OWNER);
  c.register_merchant({ merchant_id: "bu-sari", stock: {}, coins: 15 });
  env.setCaller(ALICE);
  c.gather({ token_id: "iron", amount: 1 });
  const r = c.sell({ merchant_id: "bu-sari", token_id: "iron", amount: 1, min_price: 0 });
  assert.equal(r.partial, false);
  assert.equal(r.total_price, 8);
  assert.equal(r.merchant_coins, 7);
  assert.equal(r.merchant_bankrupt, true);
});

/* ---------- 8. invest ---------- */
test("invest: 50 koin -> buka lagi (100 koin, +10 spesialisasi), bonus +10% tercatat", () => {
  env.setCaller(OWNER);
  c.register_merchant({ merchant_id: "bu-sari", stock: {}, coins: 10 });
  env.setCaller(ALICE);
  c.gather({ token_id: "iron", amount: 10 });
  fundCoins(ALICE, "wood");
  c.sell({ merchant_id: "bu-sari", token_id: "iron", amount: 2, min_price: 0 });
  assert.equal(merchant("bu-sari").bankrupt, true);
  const coinsBefore = bal(ALICE, "squeek-coin");
  const r = c.invest({ merchant_id: "bu-sari", amount: 50 });
  assert.equal(r.coins, 100);
  assert.equal(r.bankrupt, false);
  const m = merchant("bu-sari");
  assert.equal(m.coins, 100);
  assert.equal(m.bankrupt, false);
  assert.equal(m.stock.stone, 60); // 50 + 10 spesialisasi
  assert.equal(m.stock.iron, 61); // 50 + 1 terjual + 10 spesialisasi
  assert.equal(bal(ALICE, "squeek-coin"), coinsBefore - 50);
  assert.deepEqual(c.get_player({ account_id: ALICE }).invested_in, ["bu-sari"]);
  assert.deepEqual(m.invested_by, [ALICE]);
  // Reasoning: sell_bonus x1.10 untuk investor.
  const reason = c.get_reasoning({
    merchant_id: "bu-sari",
    token_id: "iron",
    account_id: ALICE,
  });
  assert.equal(reason.sell_bonus, 1.1);
  const reasonAnon = c.get_reasoning({ merchant_id: "bu-sari", token_id: "iron" });
  assert.equal(reasonAnon.sell_bonus, 1);
  // get_price sell investor vs bukan investor.
  const sellInv = c.get_price({
    merchant_id: "bu-sari",
    token_id: "iron",
    side: "sell",
    account_id: ALICE,
  });
  const sellPlain = c.get_price({ merchant_id: "bu-sari", token_id: "iron", side: "sell" });
  assert.ok(sellInv >= sellPlain);
});

test("invest: ditolak kalau tidak bangkrut / < 50 / koin kurang", () => {
  throws(() => c.invest({ merchant_id: "bu-sari", amount: 50 }), /not bankrupt/);
  env.setCaller(OWNER);
  c.register_merchant({ merchant_id: "bu-sari", stock: {}, coins: 10 });
  env.setCaller(ALICE);
  c.gather({ token_id: "iron", amount: 2 });
  c.sell({ merchant_id: "bu-sari", token_id: "iron", amount: 2, min_price: 0 });
  assert.equal(merchant("bu-sari").bankrupt, true);
  throws(() => c.invest({ merchant_id: "bu-sari", amount: 49 }), /at least 50/);
  env.setCaller(BOB); // bob tanpa koin
  throws(() => c.invest({ merchant_id: "bu-sari", amount: 50 }), /Insufficient squeek-coin/);
});

/* ---------- 9. buyBonus + investor di harga jual ---------- */
test("buyBonus: Bang Jago bayar telur emas +20% (jual 63 vs dasar 52)", () => {
  c.gather({ token_id: "golden-egg", amount: 1 });
  assert.equal(c.get_price({ merchant_id: "bang-jago", token_id: "golden-egg", side: "buy" }), 75);
  assert.equal(c.get_price({ merchant_id: "bang-jago", token_id: "golden-egg", side: "sell" }), 63);
  const reason = c.get_reasoning({ merchant_id: "bang-jago", token_id: "golden-egg" });
  assert.equal(reason.sell_price, 52);
  assert.equal(reason.sell_price_effective, 63);
  assert.equal(reason.buy_bonus, 1.2);
  const r = c.sell({ merchant_id: "bang-jago", token_id: "golden-egg", amount: 1, min_price: 0 });
  assert.equal(r.total_price, 63);
  assert.equal(r.buy_bonus, 1.2);
});

test("sell min_price: ditegakkan bila penjualan penuh; dilewati bila parsial", () => {
  c.gather({ token_id: "stone", amount: 2 });
  throws(
    () => c.sell({ merchant_id: "bu-sari", token_id: "stone", amount: 2, min_price: 999 }),
    /below min_price/,
  );
  // Parsial: batas total penuh (16) dilewati karena yang mengikat dana merchant.
  env.setCaller(OWNER);
  c.register_merchant({ merchant_id: "bu-sari", stock: {}, coins: 10 });
  env.setCaller(ALICE);
  c.gather({ token_id: "iron", amount: 2 });
  const r = c.sell({ merchant_id: "bu-sari", token_id: "iron", amount: 2, max_price: 16 });
  assert.equal(r.partial, true);
  assert.equal(r.total_price, 8);
});

/* ---------- 10. peluruhan demand ---------- */
test("demand meluruh -1 tiap 5 menit (view) dan diterapkan saat trade", () => {
  fundCoins(ALICE);
  c.buy({ merchant_id: "pak-kumis", token_id: "wood", amount: 5, max_price: 100 });
  assert.equal(merchant("pak-kumis").demand.wood, 5);
  env.advanceSec(300);
  assert.equal(
    c.get_reasoning({ merchant_id: "pak-kumis", token_id: "wood" }).demand,
    4,
  );
  env.advanceSec(1200);
  assert.equal(
    c.get_reasoning({ merchant_id: "pak-kumis", token_id: "wood" }).demand,
    0,
  );
  // Trade berikutnya menerapkan peluruhan ke state.
  c.buy({ merchant_id: "pak-kumis", token_id: "wood", amount: 1, max_price: 100 });
  assert.equal(merchant("pak-kumis").demand.wood, 1);
});

/* ---------- 11. get_player ---------- */
test("get_player: saldo 7 token + invested_in", () => {
  c.starter_grant();
  c.gather({ token_id: "wood", amount: 3 });
  const p = c.get_player({ account_id: ALICE });
  assert.equal(p.balances["squeek-coin"], "20");
  assert.equal(p.balances.wood, "3");
  assert.equal(p.balances.stone, "0");
  assert.deepEqual(p.invested_in, []);
});
