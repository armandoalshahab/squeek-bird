// Parity test: rumus pricing kontrak (src/contract.ts, fungsi murni yang
// diekspor) HARUS identik dengan market/pricing.js — SATU sumber kebenaran
// DESIGN.md §4. Kalau ada selisih, salah satu harus diperbaiki.
import "./mock-env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  clamp,
  stockFactor,
  demandFactor,
  calcBuyPrice,
  calcSellPrice,
  quoteBuy,
  quoteSell,
} from "../test-build/contract.bundle.mjs";

const require = createRequire(import.meta.url);
const Pricing = require("../../market/pricing.js");

const TOKENS = ["wood", "stone", "iron", "ice", "golden-egg", "mighty-seed"];
const STOCKS = [0, 1, 25, 49, 50, 51, 75, 90, 100, 150, 300];
const DEMANDS = [0, 1, 5, 19, 20, 21, 40, 99];
const MARKUPS = [1.0, 1.15, 1.25];
const QTYS = [1, 2, 5, 10, 40];

test("clamp / stockFactor / demandFactor identik", () => {
  for (const s of [...STOCKS, -5, 1000]) {
    assert.equal(stockFactor(s), Pricing.stockFactor(s), `stockFactor(${s})`);
  }
  for (const d of [...DEMANDS, -3, 1000]) {
    assert.equal(demandFactor(d), Pricing.demandFactor(d), `demandFactor(${d})`);
  }
  assert.equal(clamp(5, 1, 10), Pricing.clamp(5, 1, 10));
});

test("calcBuyPrice == Pricing.buyPrice (semua token x stok x demand x markup)", () => {
  let n = 0;
  for (const t of TOKENS) {
    for (const s of STOCKS) {
      for (const d of DEMANDS) {
        for (const m of MARKUPS) {
          assert.equal(
            calcBuyPrice(Pricing.BASE_PRICE[t], s, d, m),
            Pricing.buyPrice(Pricing.BASE_PRICE[t], s, d, m),
            `buyPrice ${t} stock=${s} demand=${d} markup=${m}`,
          );
          n++;
        }
      }
    }
  }
  assert.ok(n > 1000, `kombinasi diuji: ${n}`);
});

test("calcSellPrice == Pricing.sellPrice (biasa / investor / buyBonus / keduanya)", () => {
  for (let buy = 1; buy <= 80; buy++) {
    assert.equal(calcSellPrice(buy, false), Pricing.sellPrice(buy, {}), `sell ${buy}`);
    assert.equal(
      calcSellPrice(buy, true),
      Pricing.sellPrice(buy, { investor: true }),
      `sell investor ${buy}`,
    );
    assert.equal(
      calcSellPrice(buy, false, 1.2),
      Pricing.sellPrice(buy, { buyBonus: 1.2 }),
      `sell buyBonus ${buy}`,
    );
    assert.equal(
      calcSellPrice(buy, true, 1.2),
      Pricing.sellPrice(buy, { investor: true, buyBonus: 1.2 }),
      `sell investor+buyBonus ${buy}`,
    );
  }
  // Angka acuan dari test frontend: buy 12 -> jual 8 biasa, 9 investor.
  assert.equal(Pricing.sellPrice(12, {}), 8);
  assert.equal(calcSellPrice(12, false), 8);
  assert.equal(Pricing.sellPrice(12, { investor: true }), 9);
  assert.equal(calcSellPrice(12, true), 9);
});

test("quoteBuy == Pricing.quoteBuy (total, unitPrices, endStock, endDemand)", () => {
  for (const t of TOKENS) {
    for (const s of [0, 50, 90]) {
      for (const d of [0, 5, 20]) {
        for (const m of MARKUPS) {
          for (const q of QTYS) {
            if (q > s) continue; // stok tidak cukup untuk beli
            const a = quoteBuy(Pricing.BASE_PRICE[t], s, d, m, q);
            const b = Pricing.quoteBuy(t, s, d, m, q);
            assert.equal(a.total, b.total, `quoteBuy total ${t} s=${s} d=${d} m=${m} q=${q}`);
            assert.deepEqual(a.unitPrices, b.unitPrices, `quoteBuy units ${t} q=${q}`);
            assert.equal(a.endStock, b.endStock);
            assert.equal(a.endDemand, b.endDemand);
          }
        }
      }
    }
  }
});

test("quoteSell == Pricing.quoteSell (demand TIDAK berubah saat jual)", () => {
  for (const t of TOKENS) {
    for (const s of [0, 50, 90]) {
      for (const d of [0, 5, 20]) {
        for (const m of MARKUPS) {
          for (const q of QTYS) {
            const a = quoteSell(Pricing.BASE_PRICE[t], s, d, m, q, false, 1);
            const b = Pricing.quoteSell(t, s, d, m, q, {});
            assert.equal(a.total, b.total, `quoteSell total ${t} s=${s} d=${d} m=${m} q=${q}`);
            assert.deepEqual(a.unitPrices, b.unitPrices, `quoteSell units ${t} q=${q}`);
            assert.equal(a.endStock, b.endStock);
            assert.equal(a.endDemand, d, "demand tidak berubah saat jual");
            assert.equal(a.endDemand, b.endDemand);
          }
        }
      }
    }
  }
});

test("contoh koordinator: beli 5 kayu @ harga awal 4 -> total 23 (4,4,5,5,5)", () => {
  const q = quoteBuy(4, 50, 0, 1.0, 5);
  assert.deepEqual(q.unitPrices, [4, 4, 5, 5, 5]);
  assert.equal(q.total, 23);
  assert.deepEqual(Pricing.quoteBuy("wood", 50, 0, 1.0, 5).unitPrices, [4, 4, 5, 5, 5]);
});

test("contoh koordinator: jual 2 iron ke Bu Sari (koin 10) -> unit 8 lalu 7", () => {
  const q = quoteSell(10, 50, 0, 1.15, 2, false, 1);
  assert.deepEqual(q.unitPrices, [8, 7]);
  assert.equal(q.total, 15);
  assert.deepEqual(Pricing.quoteSell("iron", 50, 0, 1.15, 2, {}).unitPrices, [8, 7]);
});

test("banjir iron: stok 90 demand 0 -> buy 6, sell 4 (Bu Sari)", () => {
  assert.equal(calcBuyPrice(10, 90, 0, 1.15), 6);
  assert.equal(Pricing.buyPrice(10, 90, 0, 1.15), 6);
  assert.equal(calcSellPrice(6, false), 4);
});
