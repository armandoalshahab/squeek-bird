// SQUEEK MARKET — kontrak NEP-245 + ekonomi merchant (NEAR HACKATHON, track games)
// Bahasa: near-sdk-js (JS/TS). Satu kontrak, semua jenis item.
// Sumber kebenaran aturan pricing: DESIGN.md §4 (harus SAMA dengan market/pricing.js).
//
// Catatan deviasi dari NEP-245 murni (lihat README kontrak):
// - mt_token(token_id) di DESIGN.md §5 memakai SATU token_id (bukan array seperti
//   spek NEP-245) dan mengembalikan satu objek metadata (atau null).
// - mt_transfer_call / mt_batch_transfer_call / mt_resolve_transfer TIDAK
//   diimplementasikan: di luar daftar core DESIGN.md §5.
// Aturan §4 FINAL (koordinator, 11 Nov 2026 — DESIGN.md diperbarui):
// - Harga dihitung PER-UNIT: tiap unit dihitung satu per satu; beli 5 kayu
//   @ harga awal 4 -> total 23 (unit 4,4,5,5,5), bukan 20.
// - Demand HANYA naik saat BELI (pemain beli dari merchant). Jual TIDAK
//   mengubah demand sama sekali — supaya efek banjir kasat mata (jual 40
//   iron -> stok 90, demand tetap 0, harga beli 12->6 seketika).
// - Penjualan PARSIAL + ambang bangkrut BANKRUPT_THRESHOLD = 10: merchant
//   bayar sebanyak yang ia mampu (per-unit); kalau koin < 10 setelah bayar
//   -> bangkrut (toko tutup); sisa koin TETAP dicatat apa adanya; invest
//   me-reset koin ke 100.
// - buy/sell: max_price/min_price adalah TOTAL harga transaksi penuh;
//   di sell, batas bawah hanya ditegakkan bila seluruh qty terjual
//   (bila parsial, yang mengikat adalah dana merchant).
// - get_price(..., "sell") memakai buyBonus merchant; dengan account_id
//   investor, ditambah bonus investor +10% (== sell_price_effective).
// - Pak Kumis spesialisasi ["wood","ice"] sesuai market/merchants.js.

import { NearBindgen, near, call, view, initialize, LookupMap } from "near-sdk-js";

// ---------------------------------------------------------------------------
// Konstanta game (DESIGN.md §2, §3, §4)
// ---------------------------------------------------------------------------

export const TOKEN_IDS = [
  "wood",
  "stone",
  "iron",
  "ice",
  "golden-egg",
  "mighty-seed",
  "squeek-coin",
] as const;

export type TokenId = (typeof TOKEN_IDS)[number];

// Harga dasar (koin). squeek-coin adalah mata uang, bukan barang dagangan.
export const BASE_PRICE: Record<string, number> = {
  wood: 4,
  stone: 6,
  iron: 10,
  ice: 5,
  "golden-egg": 60,
  "mighty-seed": 40,
};

export const TOKEN_META: Record<string, { name: string; symbol: string }> = {
  wood: { name: "Kayu", symbol: "WOOD" },
  stone: { name: "Batu", symbol: "STONE" },
  iron: { name: "Besi", symbol: "IRON" },
  ice: { name: "Es", symbol: "ICE" },
  "golden-egg": { name: "Telur Emas", symbol: "GEGG" },
  "mighty-seed": { name: "Benih Perkasa", symbol: "MSEED" },
  "squeek-coin": { name: "Koin Squeek", symbol: "SQK" },
};

// Token yang bisa di-gather + cap harian per akun per token (DESIGN.md §5).
export const GATHER_CAP: Record<string, number> = {
  wood: 200,
  stone: 200,
  ice: 200,
  iron: 200,
  "golden-egg": 3,
};

export const STARTER_GRANT = 20; // squeek-coin, sekali per akun
export const INVEST_MIN = 50; // koin, minimum invest
export const INVEST_REOPEN_COINS = 100; // saldo merchant setelah invest
export const INVEST_RESTOCK = 10; // unit tiap item spesialisasi setelah invest
export const INVEST_SELL_BONUS = 0.1; // +10% harga jual untuk investor
export const BANKRUPT_THRESHOLD = 10; // koin merchant < 10 setelah jual -> bangkrut
export const INITIAL_STOCK = 50; // stok awal tiap item per merchant
export const INITIAL_COINS = 200; // koin awal tiap merchant
export const DEMAND_DECAY_SECONDS = 300; // demand -1 tiap 5 menit
export const SELL_SPREAD = 0.7; // merchant beli 70% dari harga jualnya

// Definisi 3 merchant awal (DESIGN.md §3).
export const MERCHANT_DEFS: Record<
  string,
  {
    name: string;
    markup: number;
    specialties: string[];
    buy_bonus_token: string | null;
    buy_bonus: number;
  }
> = {
  "pak-kumis": {
    name: "Pak Kumis",
    markup: 1.0,
    specialties: ["wood", "ice"],
    buy_bonus_token: null,
    buy_bonus: 1,
  },
  "bu-sari": {
    name: "Bu Sari",
    markup: 1.15,
    specialties: ["stone", "iron"],
    buy_bonus_token: null,
    buy_bonus: 1,
  },
  "bang-jago": {
    name: "Bang Jago",
    markup: 1.25,
    specialties: ["golden-egg", "mighty-seed"],
    buy_bonus_token: "golden-egg",
    buy_bonus: 1.2,
  },
};

// ---------------------------------------------------------------------------
// Rumus pricing (DESIGN.md §4) — HARUS identik dengan market/pricing.js
// ---------------------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function stockFactor(stock: number): number {
  return clamp(2 - stock / 50, 0.5, 2.0);
}

export function demandFactor(demand: number): number {
  return 1 + Math.min(demand / 20, 1.0);
}

export function calcBuyPrice(
  base: number,
  stock: number,
  demand: number,
  markup: number,
): number {
  const p = Math.round(base * stockFactor(stock) * demandFactor(demand) * markup);
  return clamp(p, 1, 5 * base);
}

export function calcSellPrice(
  buyPrice: number,
  isInvestor: boolean,
  buyBonus = 1,
): number {
  // Sama persis dengan Pricing.sellPrice di market/pricing.js:
  // floor(buy * 0.7 * buyBonus * investorBonus), minimal 1.
  const mult = SELL_SPREAD * buyBonus * (isInvestor ? 1 + INVEST_SELL_BONUS : 1);
  return Math.max(1, Math.floor(buyPrice * mult));
}

// Quote multi-unit per-unit (== Pricing.quoteBuy / quoteSell di pricing.js):
// tiap unit dihitung ulang karena tiap unit mengubah stok & demand.
// Buy: stok -1/unit, demand +1/unit. Sell: stok +1/unit, demand TIDAK
// berubah (demand HANYA naik saat beli — DESIGN.md §4 final; kalau jual
// juga menaikkan demand, efek banjir tertutup demandFactor 2x).
export function quoteBuy(
  base: number,
  stock: number,
  demand: number,
  markup: number,
  qty: number,
): { total: number; unitPrices: number[]; endStock: number; endDemand: number } {
  const unitPrices: number[] = [];
  let total = 0;
  let s = stock;
  let d = demand;
  for (let i = 0; i < qty; i++) {
    const p = calcBuyPrice(base, s, d, markup);
    unitPrices.push(p);
    total += p;
    s -= 1;
    d += 1;
  }
  return { total, unitPrices, endStock: s, endDemand: d };
}

export function quoteSell(
  base: number,
  stock: number,
  demand: number,
  markup: number,
  qty: number,
  isInvestor: boolean,
  buyBonus = 1,
): { total: number; unitPrices: number[]; endStock: number; endDemand: number } {
  const unitPrices: number[] = [];
  let total = 0;
  let s = stock;
  const d = demand; // demand TIDAK berubah saat jual
  for (let i = 0; i < qty; i++) {
    const buy = calcBuyPrice(base, s, d, markup);
    const p = calcSellPrice(buy, isInvestor, buyBonus);
    unitPrices.push(p);
    total += p;
    s += 1;
  }
  return { total, unitPrices, endStock: s, endDemand: d };
}

// ---------------------------------------------------------------------------
// Tipe state
// ---------------------------------------------------------------------------

export interface Merchant {
  merchant_id: string;
  account: string;
  name: string;
  markup: number;
  specialties: string[];
  buy_bonus_token: string | null;
  buy_bonus: number;
  stock: Record<string, number>;
  coins: number;
  bankrupt: boolean;
  demand: Record<string, number>;
  demand_ts: number; // epoch detik saat demand terakhir di-decay/disimpan
  invested_by: string[];
}

// ---------------------------------------------------------------------------
// Kontrak
// ---------------------------------------------------------------------------

@NearBindgen({ requireInit: true })
export class SqueekMarket {
  owner: string = "";
  tokenIds: string[] = [...TOKEN_IDS];
  merchantIds: string[] = [];

  balances = new LookupMap<string>("b"); // "akun:token" -> jumlah (string)
  supplies = new LookupMap<string>("s"); // token -> total supply (string)
  merchants = new LookupMap<Merchant>("m"); // merchant_id -> Merchant
  grants = new LookupMap<string>("g"); // akun -> "1" (starter grant sudah diambil)
  gathered = new LookupMap<string>("d"); // "akun:token:hari" -> jumlah hari itu
  investors = new LookupMap<string>("i"); // "akun:merchant" -> "1"

  // ---- util internal ------------------------------------------------------

  private balKey(account: string, token: string): string {
    return `${account}:${token}`;
  }

  private bal(account: string, token: string): number {
    return Number(this.balances.get(this.balKey(account, token)) ?? "0");
  }

  private setBal(account: string, token: string, amount: number): void {
    if (amount < 0) throw new Error("Balance cannot be negative");
    this.balances.set(this.balKey(account, token), String(amount));
  }

  private addBal(account: string, token: string, delta: number): void {
    this.setBal(account, token, this.bal(account, token) + delta);
  }

  private addSupply(token: string, delta: number): void {
    const cur = Number(this.supplies.get(token) ?? "0");
    const next = cur + delta;
    if (next < 0) throw new Error("Supply cannot be negative");
    this.supplies.set(token, String(next));
  }

  private mintTo(account: string, token: string, amount: number): void {
    if (amount <= 0) throw new Error("Mint amount must be positive");
    this.addBal(account, token, amount);
    this.addSupply(token, amount);
    this.emitMint(account, token, amount);
  }

  private getMerchantOrPanic(merchantId: string): Merchant {
    const m = this.merchants.get(merchantId);
    if (!m) throw new Error(`Merchant not found: ${merchantId}`);
    return m;
  }

  private saveMerchant(m: Merchant): void {
    this.merchants.set(m.merchant_id, m);
  }

  private requireToken(token: string): void {
    if (!TOKEN_IDS.includes(token as TokenId)) {
      throw new Error(`Unknown token: ${token}`);
    }
  }

  private requireTradable(token: string): void {
    this.requireToken(token);
    if (token === "squeek-coin") {
      throw new Error("squeek-coin is the market currency, not a tradable good");
    }
  }

  private nowSec(): number {
    return Number(near.blockTimestamp() / 1000000000n);
  }

  private todayDay(): number {
    return Math.floor(Number(near.blockTimestamp() / 86400000000000n));
  }

  // Demand efektif: luruh -1 tiap 5 menit sejak demand_ts (tanpa tulis state).
  private effectiveDemand(m: Merchant, token: string): number {
    const raw = m.demand[token] ?? 0;
    const elapsed = this.nowSec() - m.demand_ts;
    if (elapsed < DEMAND_DECAY_SECONDS) return raw;
    const decayed = raw - Math.floor(elapsed / DEMAND_DECAY_SECONDS);
    return Math.max(0, decayed);
  }

  // Terapkan peluruhan ke state merchant (dipakai method change).
  private applyDecay(m: Merchant): void {
    const now = this.nowSec();
    for (const t of this.tokenIds) {
      if (BASE_PRICE[t] === undefined) continue;
      m.demand[t] = this.effectiveDemand(m, t);
    }
    m.demand_ts = now;
  }

  private buyUnitPrice(m: Merchant, token: string): number {
    return calcBuyPrice(
      BASE_PRICE[token],
      m.stock[token] ?? 0,
      this.effectiveDemand(m, token),
      m.markup,
    );
  }

  private isInvestor(account: string, merchantId: string): boolean {
    return this.investors.get(`${account}:${merchantId}`) === "1";
  }

  private emitMint(owner: string, token: string, amount: number): void {
    near.log(
      `EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_mint","data":[{"owner_id":"${owner}","token_ids":["${token}"],"amounts":["${amount}"]}]}`,
    );
  }

  private emitTransfer(from: string, to: string, token: string, amount: number, memo?: string): void {
    const memoPart = memo ? `,"memo":"${memo}"` : "";
    near.log(
      `EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_transfer","data":[{"old_owner_id":"${from}","new_owner_id":"${to}","token_ids":["${token}"],"amounts":["${amount}"]${memoPart}}]}`,
    );
  }

  private transferInternal(from: string, to: string, token: string, amount: number): void {
    if (amount <= 0) throw new Error("Transfer amount must be positive");
    if (this.bal(from, token) < amount) {
      throw new Error(`Insufficient balance: ${from} has ${this.bal(from, token)} ${token}`);
    }
    this.addBal(from, token, -amount);
    this.addBal(to, token, amount);
  }

  // ---- init ---------------------------------------------------------------
  // DESIGN.md §5 menamai method ini `new(owner_id)`; di near-sdk-js method
  // init HARUS bernama `init` — SDK tidak bisa mengekspor method bernama
  // `new` (hasil generate `export function new(){}` adalah syntax error).
  // Perilaku sama: sekali saja, daftarkan 3 merchant awal.
  @initialize({})
  init({ owner_id }: { owner_id: string }): void {
    this.owner = owner_id;
    for (const id of Object.keys(MERCHANT_DEFS)) {
      this.registerMerchantInternal(id, {}, INITIAL_COINS);
    }
  }

  private registerMerchantInternal(
    merchantId: string,
    stock: Record<string, number>,
    coins: number,
  ): Merchant {
    const def = MERCHANT_DEFS[merchantId];
    const now = this.nowSec();
    const fullStock: Record<string, number> = {};
    const fullDemand: Record<string, number> = {};
    for (const t of this.tokenIds) {
      if (BASE_PRICE[t] === undefined) continue;
      fullStock[t] = stock[t] ?? INITIAL_STOCK;
      fullDemand[t] = 0;
    }
    const m: Merchant = {
      merchant_id: merchantId,
      account: `${merchantId}.${near.currentAccountId()}`,
      name: def?.name ?? merchantId,
      markup: def?.markup ?? 1.0,
      specialties: def?.specialties ?? [],
      buy_bonus_token: def?.buy_bonus_token ?? null,
      buy_bonus: def?.buy_bonus ?? 1,
      stock: fullStock,
      coins,
      bankrupt: false,
      demand: fullDemand,
      demand_ts: now,
      invested_by: [],
    };
    this.merchants.set(merchantId, m);
    if (!this.merchantIds.includes(merchantId)) this.merchantIds.push(merchantId);
    return m;
  }

  // ---- NEP-245 core: change ----------------------------------------------

  @call({ payableFunction: true })
  mt_transfer({
    receiver_id,
    token_id,
    amount,
    approval,
    memo,
  }: {
    receiver_id: string;
    token_id: string;
    amount: string;
    approval?: [string, number] | null;
    memo?: string | null;
  }): void {
    if (near.attachedDeposit() !== 1n) {
      throw new Error("mt_transfer requires exactly 1 yoctoNEAR attached");
    }
    if (approval) throw new Error("Approval Management extension is not supported");
    this.requireToken(token_id);
    const sender = near.predecessorAccountId();
    const amt = Number(amount);
    this.transferInternal(sender, receiver_id, token_id, amt);
    this.emitTransfer(sender, receiver_id, token_id, amt, memo ?? undefined);
  }

  @call({ payableFunction: true })
  mt_batch_transfer({
    receiver_id,
    token_ids,
    amounts,
    approvals,
    memo,
  }: {
    receiver_id: string;
    token_ids: string[];
    amounts: string[];
    approvals?: ([string, number] | null)[] | null;
    memo?: string | null;
  }): void {
    if (near.attachedDeposit() !== 1n) {
      throw new Error("mt_batch_transfer requires exactly 1 yoctoNEAR attached");
    }
    if (token_ids.length !== amounts.length) {
      throw new Error("token_ids and amounts length mismatch");
    }
    if (approvals && approvals.length !== token_ids.length) {
      throw new Error("approvals length mismatch");
    }
    if (approvals && approvals.some((a) => a !== null)) {
      throw new Error("Approval Management extension is not supported");
    }
    const sender = near.predecessorAccountId();
    for (let i = 0; i < token_ids.length; i++) {
      this.requireToken(token_ids[i]);
      const amt = Number(amounts[i]);
      this.transferInternal(sender, receiver_id, token_ids[i], amt);
      this.emitTransfer(sender, receiver_id, token_ids[i], amt, memo ?? undefined);
    }
  }

  // ---- NEP-245 core: view -------------------------------------------------

  @view({})
  mt_balance_of({
    account_id,
    token_id,
  }: {
    account_id: string;
    token_id: string;
  }): string {
    this.requireToken(token_id);
    return String(this.bal(account_id, token_id));
  }

  @view({})
  mt_batch_balance_of({
    account_id,
    token_ids,
  }: {
    account_id: string;
    token_ids: string[];
  }): string[] {
    return token_ids.map((t) => {
      this.requireToken(t);
      return String(this.bal(account_id, t));
    });
  }

  @view({})
  mt_token({ token_id }: { token_id: string }): object | null {
    if (!TOKEN_IDS.includes(token_id as TokenId)) return null;
    const meta = TOKEN_META[token_id];
    return {
      token_id,
      owner_id: null,
      name: meta.name,
      symbol: meta.symbol,
      decimals: 0,
      icon: null,
      uri: null,
      base_price: BASE_PRICE[token_id] ?? null,
    };
  }

  @view({})
  mt_tokens({
    from_index,
    limit,
  }: {
    from_index?: string;
    limit?: number;
  }): object[] {
    const start = Number(from_index ?? "0");
    const n = limit ?? this.tokenIds.length;
    return this.tokenIds.slice(start, start + n).map((t) => this.mt_token({ token_id: t })!);
  }

  @view({})
  mt_tokens_for_owner({
    account_id,
    from_index,
    limit,
  }: {
    account_id: string;
    from_index?: string;
    limit?: number;
  }): object[] {
    const start = Number(from_index ?? "0");
    const n = limit ?? this.tokenIds.length;
    return this.tokenIds.slice(start, start + n).map((t) => ({
      ...(this.mt_token({ token_id: t }) as object),
      owner_id: account_id,
      balance: String(this.bal(account_id, t)),
    }));
  }

  @view({})
  mt_supply({ token_id }: { token_id: string }): string | null {
    if (!TOKEN_IDS.includes(token_id as TokenId)) return null;
    return String(Number(this.supplies.get(token_id) ?? "0"));
  }

  // ---- Method game: admin -------------------------------------------------

  @call({})
  register_merchant({
    merchant_id,
    stock,
    coins,
    markup,
    specialties,
    name,
    buy_bonus_token,
    buy_bonus,
  }: {
    merchant_id: string;
    stock: Record<string, number>;
    coins: number;
    markup?: number;
    specialties?: string[];
    name?: string;
    buy_bonus_token?: string | null;
    buy_bonus?: number;
  }): object {
    if (near.predecessorAccountId() !== this.owner) {
      throw new Error("Only the contract owner can register merchants");
    }
    if (Number(coins) < 0) throw new Error("Coins cannot be negative");
    const existing = this.merchants.get(merchant_id);
    const m = this.registerMerchantInternal(merchant_id, stock ?? {}, Number(coins));
    if (existing) {
      // Pertahankan demand/investor/bankrupt yang sudah ada saat re-register.
      m.demand = existing.demand;
      m.demand_ts = existing.demand_ts;
      m.bankrupt = existing.bankrupt;
      m.invested_by = existing.invested_by;
    }
    if (markup !== undefined) m.markup = Number(markup);
    if (specialties !== undefined) m.specialties = specialties;
    if (name !== undefined) m.name = name;
    if (buy_bonus_token !== undefined) m.buy_bonus_token = buy_bonus_token;
    if (buy_bonus !== undefined) m.buy_bonus = Number(buy_bonus);
    this.saveMerchant(m);
    return m;
  }

  // ---- Method game: pemain ------------------------------------------------

  @call({})
  starter_grant(): void {
    const caller = near.predecessorAccountId();
    if (this.grants.get(caller) === "1") {
      throw new Error("Starter grant already claimed");
    }
    this.grants.set(caller, "1");
    this.mintTo(caller, "squeek-coin", STARTER_GRANT);
  }

  @call({})
  gather({ token_id, amount }: { token_id: string; amount: number | string }): void {
    this.requireToken(token_id);
    const cap = GATHER_CAP[token_id];
    if (cap === undefined) {
      throw new Error(`Token ${token_id} cannot be gathered`);
    }
    const qty = Number(amount);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error("Gather amount must be a positive integer");
    }
    const caller = near.predecessorAccountId();
    const key = `${caller}:${token_id}:${this.todayDay()}`;
    const soFar = Number(this.gathered.get(key) ?? "0");
    if (soFar + qty > cap) {
      throw new Error(
        `Daily gather cap exceeded for ${token_id}: ${soFar}/${cap} today, tried +${qty}`,
      );
    }
    this.gathered.set(key, String(soFar + qty));
    this.mintTo(caller, token_id, qty);
  }

  @call({})
  buy({
    merchant_id,
    token_id,
    amount,
    max_price,
  }: {
    merchant_id: string;
    token_id: string;
    amount: number | string;
    max_price: number | string;
  }): object {
    this.requireTradable(token_id);
    // near-api-js / UI mengirim angka sebagai string ("5") — koersi dulu.
    const qty = Number(amount);
    const maxTotal = Number(max_price);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error("Buy amount must be a positive integer");
    }
    if (!Number.isFinite(maxTotal)) {
      throw new Error("max_price is required");
    }
    const m = this.getMerchantOrPanic(merchant_id);
    if (m.bankrupt) throw new Error(`Merchant ${merchant_id} is bankrupt (closed)`);
    this.applyDecay(m);
    if ((m.stock[token_id] ?? 0) < qty) {
      throw new Error(`Merchant stock insufficient: ${m.stock[token_id] ?? 0} ${token_id}`);
    }
    // Harga per-unit iteratif (== Pricing.quoteBuy): tiap unit mengubah
    // stok & demand, jadi total BUKAN unit price x qty.
    const q = quoteBuy(
      BASE_PRICE[token_id],
      m.stock[token_id] ?? 0,
      m.demand[token_id] ?? 0,
      m.markup,
      qty,
    );
    if (q.total > maxTotal) {
      throw new Error(`Price ${q.total} exceeds max_price ${maxTotal}`);
    }
    const buyer = near.predecessorAccountId();
    if (this.bal(buyer, "squeek-coin") < q.total) {
      throw new Error(
        `Insufficient squeek-coin: have ${this.bal(buyer, "squeek-coin")}, need ${q.total}`,
      );
    }
    this.addBal(buyer, "squeek-coin", -q.total);
    m.coins += q.total;
    m.stock[token_id] -= qty;
    this.addBal(buyer, token_id, qty);
    m.demand[token_id] = (m.demand[token_id] ?? 0) + qty;
    this.saveMerchant(m);
    this.emitTransfer(m.account, buyer, token_id, qty, `buy from ${merchant_id}`);
    return {
      merchant_id,
      token_id,
      amount: qty,
      unit_prices: q.unitPrices,
      total_price: q.total,
    };
  }

  // Jual ke merchant — PENJUALAN PARSIAL (DESIGN.md §4 final):
  // kalau koin merchant tidak cukup membayar penuh, terjual sebanyak yang
  // ia mampu (dihitung per-unit, karena harga berubah tiap unit); sisanya
  // tetap di pemain. Bangkrut kalau koin merchant < BANKRUPT_THRESHOLD (10)
  // setelah bayar; sisa koin TETAP dicatat apa adanya (bukan di-nol-kan);
  // invest me-reset ke 100. Demand TIDAK berubah saat jual (hanya naik
  // saat beli).
  // min_price/max_price (batas bawah total): hanya ditegakkan bila SELURUH
  // qty terjual. Bila penjualan parsial, yang mengikat adalah dana merchant
  // — kalau batas total ikut ditegakkan, penjualan parsial tidak akan pernah
  // terjadi (total parsial selalu < ekspektasi qty penuh) dan merchant
  // nyangkut selamanya. Harga per-unit yang dieksekusi tetap dikembalikan
  // di respons supaya pemain/UI bisa memverifikasi.
  @call({})
  sell({
    merchant_id,
    token_id,
    amount,
    min_price,
    max_price,
  }: {
    merchant_id: string;
    token_id: string;
    amount: number | string;
    min_price?: number | string;
    max_price?: number | string;
  }): object {
    this.requireTradable(token_id);
    const qty = Number(amount);
    // Frontend (market-ui.js) mengirim max_price untuk buy MAUPUN sell;
    // di sell, nilai itu dipakai sebagai batas bawah (== min_price).
    const floor =
      min_price !== undefined && min_price !== null
        ? Number(min_price)
        : max_price !== undefined && max_price !== null
          ? Number(max_price)
          : NaN;
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error("Sell amount must be a positive integer");
    }
    if (!Number.isFinite(floor)) {
      throw new Error("min_price (or max_price) is required");
    }
    const m = this.getMerchantOrPanic(merchant_id);
    if (m.bankrupt) throw new Error(`Merchant ${merchant_id} is bankrupt (closed)`);
    this.applyDecay(m);
    const seller = near.predecessorAccountId();
    const investor = this.isInvestor(seller, merchant_id);
    const buyBonus = m.buy_bonus_token === token_id ? m.buy_bonus : 1;
    if (this.bal(seller, token_id) < qty) {
      throw new Error(`Insufficient ${token_id}: have ${this.bal(seller, token_id)}`);
    }
    const q = quoteSell(
      BASE_PRICE[token_id],
      m.stock[token_id] ?? 0,
      m.demand[token_id] ?? 0,
      m.markup,
      qty,
      investor,
      buyBonus,
    );
    // Berapa unit yang mampu dibayar merchant (harga per-unit berubah)?
    let affordable = 0;
    let total = 0;
    for (let i = 0; i < q.unitPrices.length; i++) {
      if (total + q.unitPrices[i] > m.coins) break;
      total += q.unitPrices[i];
      affordable++;
    }
    if (affordable <= 0) {
      throw new Error(
        `Merchant cannot afford even 1 unit: has ${m.coins} coins, 1 ${token_id} costs ${q.unitPrices[0]}`,
      );
    }
    // Batas bawah harga hanya berlaku bila seluruh qty terjual.
    if (affordable === qty && total < floor) {
      throw new Error(`Price ${total} below min_price ${floor}`);
    }
    this.addBal(seller, token_id, -affordable);
    m.stock[token_id] = (m.stock[token_id] ?? 0) + affordable;
    m.coins -= total;
    this.addBal(seller, "squeek-coin", total);
    // Demand TIDAK berubah saat jual.
    if (m.coins < BANKRUPT_THRESHOLD) m.bankrupt = true;
    this.saveMerchant(m);
    this.emitTransfer(seller, m.account, token_id, affordable, `sell to ${merchant_id}`);
    return {
      merchant_id,
      token_id,
      amount: affordable,
      requested: qty,
      partial: affordable < qty,
      unit_prices: q.unitPrices.slice(0, affordable),
      total_price: total,
      investor_bonus: investor,
      buy_bonus: buyBonus,
      merchant_coins: m.coins,
      merchant_bankrupt: m.bankrupt,
    };
  }

  @call({})
  invest({ merchant_id, amount }: { merchant_id: string; amount: number | string }): object {
    const qty = Number(amount);
    if (!Number.isInteger(qty) || qty < INVEST_MIN) {
      throw new Error(`Invest amount must be at least ${INVEST_MIN} squeek-coin`);
    }
    const m = this.getMerchantOrPanic(merchant_id);
    if (!m.bankrupt) throw new Error(`Merchant ${merchant_id} is not bankrupt`);
    const caller = near.predecessorAccountId();
    if (this.bal(caller, "squeek-coin") < qty) {
      throw new Error(
        `Insufficient squeek-coin: have ${this.bal(caller, "squeek-coin")}, need ${qty}`,
      );
    }
    this.addBal(caller, "squeek-coin", -qty);
    m.coins = INVEST_REOPEN_COINS;
    for (const t of m.specialties) {
      m.stock[t] = (m.stock[t] ?? 0) + INVEST_RESTOCK;
    }
    m.bankrupt = false;
    if (!m.invested_by.includes(caller)) m.invested_by.push(caller);
    this.investors.set(`${caller}:${merchant_id}`, "1");
    this.saveMerchant(m);
    return {
      merchant_id,
      amount: qty,
      coins: m.coins,
      stock: m.stock,
      bankrupt: false,
      investor_bonus: true,
    };
  }

  // ---- View game ----------------------------------------------------------

  @view({})
  get_price({
    merchant_id,
    token_id,
    side,
    account_id,
  }: {
    merchant_id: string;
    token_id: string;
    side: string;
    account_id?: string;
  }): number {
    this.requireTradable(token_id);
    const m = this.getMerchantOrPanic(merchant_id);
    const buyPrice = this.buyUnitPrice(m, token_id);
    if (side === "buy") return buyPrice;
    if (side === "sell") {
      // Harga jual efektif: termasuk buyBonus merchant (mis. Bang Jago
      // bayar telur emas +20%) dan bonus investor +10% kalau account_id
      // adalah investor di merchant ini (== Pricing.sell_price_effective).
      const buyBonus = m.buy_bonus_token === token_id ? m.buy_bonus : 1;
      const investor = account_id ? this.isInvestor(account_id, merchant_id) : false;
      return calcSellPrice(buyPrice, investor, buyBonus);
    }
    throw new Error(`side must be "buy" or "sell", got "${side}"`);
  }

  @view({})
  get_reasoning({
    merchant_id,
    token_id,
    account_id,
  }: {
    merchant_id: string;
    token_id: string;
    account_id?: string;
  }): object {
    this.requireTradable(token_id);
    const m = this.getMerchantOrPanic(merchant_id);
    const stock = m.stock[token_id] ?? 0;
    const demand = this.effectiveDemand(m, token_id);
    const buyPrice = calcBuyPrice(BASE_PRICE[token_id], stock, demand, m.markup);
    const buyBonus = m.buy_bonus_token === token_id ? m.buy_bonus : 1;
    const investor = account_id ? this.isInvestor(account_id, merchant_id) : false;
    const sellBonus = buyBonus * (investor ? 1 + INVEST_SELL_BONUS : 1);
    return {
      base: BASE_PRICE[token_id],
      stock,
      stock_factor: stockFactor(stock),
      demand,
      demand_factor: demandFactor(demand),
      markup: m.markup,
      buy_price: buyPrice,
      sell_price: calcSellPrice(buyPrice, false),
      buy_bonus: buyBonus,
      sell_bonus: sellBonus,
      sell_price_effective: calcSellPrice(buyPrice, investor, buyBonus),
    };
  }

  @view({})
  get_merchant({ merchant_id }: { merchant_id: string }): object {
    const m = this.getMerchantOrPanic(merchant_id);
    return this.publicMerchant(m);
  }

  @view({})
  get_merchants(): object[] {
    return this.merchantIds.map((id) => this.publicMerchant(this.getMerchantOrPanic(id)));
  }

  @view({})
  get_player({ account_id }: { account_id: string }): object {
    const balances: Record<string, string> = {};
    for (const t of this.tokenIds) balances[t] = String(this.bal(account_id, t));
    const invested_in: string[] = [];
    for (const id of this.merchantIds) {
      if (this.isInvestor(account_id, id)) invested_in.push(id);
    }
    return { account_id, balances, invested_in };
  }

  private publicMerchant(m: Merchant): object {
    // Demand yang ditampilkan sudah termasuk peluruhan waktu berjalan.
    const demand: Record<string, number> = {};
    for (const t of this.tokenIds) {
      if (BASE_PRICE[t] === undefined) continue;
      demand[t] = this.effectiveDemand(m, t);
    }
    return {
      merchant_id: m.merchant_id,
      account: m.account,
      name: m.name,
      markup: m.markup,
      specialties: m.specialties,
      buy_bonus_token: m.buy_bonus_token,
      buy_bonus: m.buy_bonus,
      stock: m.stock,
      coins: m.coins,
      bankrupt: m.bankrupt,
      demand,
      invested_by: m.invested_by,
    };
  }
}
