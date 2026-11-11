// Verifikasi on-chain Squeek Market di NEAR TESTNET (DESIGN.md §10 butir 7).
// - Akun pemain dibuat GRATIS via faucet/helper testnet (squeek-player.testnet).
// - Skenario: starter_grant, gather, mt_transfer, buy 5 kayu (=23 koin),
//   banjir 40 iron (harga 12->6), bangkrut parsial + ambang 10, invest 50.
// - Setelah verifikasi, merchant kanonik di-restore ke stok/koin awal
//   (re-register); demand yang tersisa meluruh sendiri ±25 menit.
// - Hasil (termasuk tx hash) dicetak + disimpan ke verification-testnet.json.
//   Jalankan:  npm run verify:testnet
import * as nearApi from "near-api-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Pricing = require("../../market/pricing.js");

const CONTRACT_ID = process.env.CONTRACT_ID || "squeek-market.testnet";
const PLAYER_ID = process.env.PLAYER_ID || "squeek-player.testnet";
const CRED_DIR = path.join(os.homedir(), ".near-credentials", "testnet");
const HELPER_URL = "https://helper.testnet.near.org";
const RPC_URL = "https://rpc.testnet.fastnear.com";
const EXPLORER = "https://testnet.nearblocks.io";
const GAS = BigInt("30000000000000");

const results = { contractId: CONTRACT_ID, playerId: PLAYER_ID, steps: [] };
function step(name, data) {
  results.steps.push({ name, ...data });
  console.log(`[verify] ${name}:`, JSON.stringify(data));
}
function assertEq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`ASSERT GAGAL ${what}: dapat ${actual}, harap ${expected}`);
  }
}

async function getOrCreateAccount(near, accountId) {
  const credPath = path.join(CRED_DIR, `${accountId}.json`);
  let keyPair;
  if (fs.existsSync(credPath)) {
    keyPair = nearApi.KeyPair.fromString(JSON.parse(fs.readFileSync(credPath, "utf8")).private_key);
  } else {
    keyPair = nearApi.KeyPair.fromRandom("ed25519");
    const res = await fetch(`${HELPER_URL}/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: keyPair.getPublicKey().toString() }),
    });
    if (!res.ok) throw new Error(`helper ${res.status}: ${(await res.text()).slice(0, 200)}`);
    fs.mkdirSync(CRED_DIR, { recursive: true });
    fs.writeFileSync(
      credPath,
      JSON.stringify({ account_id: accountId, public_key: keyPair.getPublicKey().toString(), private_key: keyPair.toString() }, null, 2),
    );
    fs.chmodSync(credPath, 0o600);
  }
  await near.connection.signer.keyStore.setKey("testnet", accountId, keyPair);
  return near.account(accountId);
}

async function main() {
  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  const near = await nearApi.connect({
    networkId: "testnet",
    keyStore,
    nodeUrl: RPC_URL,
    walletUrl: "https://testnet.mynearwallet.com",
    helperUrl: HELPER_URL,
    headers: {},
  });

  const deployer = await getOrCreateAccount(near, CONTRACT_ID);
  const player = await getOrCreateAccount(near, PLAYER_ID);
  const view = (method, args) =>
    player.viewFunction({ contractId: CONTRACT_ID, methodName: method, args });
  const call = (account, method, args, deposit = 0n) =>
    account.functionCall({ contractId: CONTRACT_ID, methodName: method, args, gas: GAS, attachedDeposit: BigInt(deposit) });

  // 0. State awal.
  const merchants0 = await view("get_merchants", {});
  step("state awal: 3 merchant", {
    merchants: merchants0.map((m) => ({ id: m.merchant_id, coins: m.coins, stock_iron: m.stock.iron })),
  });
  assertEq(merchants0.length, 3, "jumlah merchant");

  // 1. starter_grant.
  let tx = await call(player, "starter_grant", {});
  step("starter_grant (+20 koin)", { tx: tx.transaction.hash, explorer: `${EXPLORER}/txns/${tx.transaction.hash}` });
  assertEq(await view("mt_balance_of", { account_id: PLAYER_ID, token_id: "squeek-coin" }), "20", "koin grant");

  // 2. gather.
  tx = await call(player, "gather", { token_id: "wood", amount: 10 });
  const gatherWoodTx = tx.transaction.hash;
  tx = await call(player, "gather", { token_id: "iron", amount: 44 });
  step("gather wood 10 + iron 44", { txWood: gatherWoodTx, txIron: tx.transaction.hash });
  assertEq(await view("mt_balance_of", { account_id: PLAYER_ID, token_id: "wood" }), "10", "wood");
  assertEq(await view("mt_balance_of", { account_id: PLAYER_ID, token_id: "iron" }), "44", "iron");

  // 3. mt_transfer (1 yocto).
  tx = await call(player, "mt_transfer", { receiver_id: CONTRACT_ID, token_id: "wood", amount: "4" }, 1n);
  step("mt_transfer 4 wood -> deployer (1 yocto)", { tx: tx.transaction.hash, explorer: `${EXPLORER}/txns/${tx.transaction.hash}` });
  assertEq(await view("mt_balance_of", { account_id: PLAYER_ID, token_id: "wood" }), "6", "wood pemain");
  assertEq(await view("mt_balance_of", { account_id: CONTRACT_ID, token_id: "wood" }), "4", "wood deployer");

  // 4. Harga view kontrak == pricing.js (sebelum trade).
  const priceBuyWood = await view("get_price", { merchant_id: "pak-kumis", token_id: "wood", side: "buy" });
  const reasonIron = await view("get_reasoning", { merchant_id: "bu-sari", token_id: "iron" });
  assertEq(priceBuyWood, Pricing.buyPrice(4, 50, 0, 1.0), "get_price wood pak-kumis");
  assertEq(reasonIron.buy_price, Pricing.buyPrice(10, 50, 0, 1.15), "reasoning iron buy");
  assertEq(reasonIron.sell_price, Pricing.sellPrice(reasonIron.buy_price, {}), "reasoning iron sell");
  step("harga view == pricing.js", { buyWood: priceBuyWood, ironBuy: reasonIron.buy_price, ironSell: reasonIron.sell_price });

  // 5. Buy 5 kayu @ Pak Kumis — total harus 23 (unit 4,4,5,5,5).
  //    Butuh koin: grant 20 + jual dulu? 20 < 23 — gather+grant tidak cukup.
  //    Jual 2 iron dulu ke Bu Sari (8+7=15 koin) supaya koin 35.
  tx = await call(player, "sell", { merchant_id: "bu-sari", token_id: "iron", amount: 2, min_price: 0 });
  const preSellTx = tx.transaction.hash;
  const coinsAfterPreSell = await view("mt_balance_of", { account_id: PLAYER_ID, token_id: "squeek-coin" });
  tx = await call(player, "buy", { merchant_id: "pak-kumis", token_id: "wood", amount: "5", max_price: "23" });
  step("buy 5 kayu @ pak-kumis (total 23)", {
    txPreSell: preSellTx,
    coinsAfterPreSell,
    txBuy: tx.transaction.hash,
    explorer: `${EXPLORER}/txns/${tx.transaction.hash}`,
  });
  const pakKumis = await view("get_merchant", { merchant_id: "pak-kumis" });
  assertEq(pakKumis.stock.wood, 45, "stok kayu pak-kumis");
  assertEq(pakKumis.demand.wood, 5, "demand kayu pak-kumis");
  assertEq(await view("mt_balance_of", { account_id: PLAYER_ID, token_id: "wood" }), "11", "wood pemain (6+5)");

  // 6. Banjir: jual 40 iron ke Bu Sari — stok 50->90, demand tetap 0,
  //    harga beli 12->6, jual 8->4. (Owner top-up koin dulu supaya sanggup
  //    bayar penuh, seperti test frontend; top-up me-reset stok ke 50.)
  tx = await call(deployer, "register_merchant", { merchant_id: "bu-sari", stock: {}, coins: 10000 });
  step("owner top-up bu-sari koin=10000 sebelum banjir", { tx: tx.transaction.hash });
  const ironBuyBefore = await view("get_price", { merchant_id: "bu-sari", token_id: "iron", side: "buy" });
  tx = await call(player, "sell", { merchant_id: "bu-sari", token_id: "iron", amount: 40, min_price: 0 });
  const buSari = await view("get_merchant", { merchant_id: "bu-sari" });
  const ironBuyAfter = await view("get_price", { merchant_id: "bu-sari", token_id: "iron", side: "buy" });
  const ironSellAfter = await view("get_price", { merchant_id: "bu-sari", token_id: "iron", side: "sell" });
  step("banjir: jual 40 iron ke bu-sari", {
    tx: tx.transaction.hash,
    explorer: `${EXPLORER}/txns/${tx.transaction.hash}`,
    ironBuyBefore,
    ironBuyAfter,
    ironSellAfter,
    stockIron: buSari.stock.iron,
    demandIron: buSari.demand.iron,
  });
  assertEq(buSari.stock.iron, 90, "stok iron bu-sari (50+40)");
  assertEq(buSari.demand.iron, 0, "demand iron tetap 0");
  assertEq(ironBuyAfter, 6, "harga beli iron setelah banjir");
  assertEq(ironSellAfter, 4, "harga jual iron setelah banjir");

  // 7. Bangkrut parsial + ambang 10 (di Bu Sari; owner set koin 10).
  tx = await call(deployer, "register_merchant", { merchant_id: "bu-sari", stock: {}, coins: 10 });
  step("owner set bu-sari koin=10 (stok reset 50)", { tx: tx.transaction.hash });
  const coinsBeforeDrain = await view("mt_balance_of", { account_id: PLAYER_ID, token_id: "squeek-coin" });
  const ironBeforeDrain = await view("mt_balance_of", { account_id: PLAYER_ID, token_id: "iron" });
  tx = await call(player, "sell", { merchant_id: "bu-sari", token_id: "iron", amount: 2, max_price: 16 });
  const buSariBroke = await view("get_merchant", { merchant_id: "bu-sari" });
  step("bangkrut: jual 2 iron (koin 10) -> parsial 1 unit", {
    tx: tx.transaction.hash,
    explorer: `${EXPLORER}/txns/${tx.transaction.hash}`,
    merchantCoins: buSariBroke.coins,
    bankrupt: buSariBroke.bankrupt,
    playerIronBefore: ironBeforeDrain,
    playerIronAfter: await view("mt_balance_of", { account_id: PLAYER_ID, token_id: "iron" }),
    playerCoinsBefore: coinsBeforeDrain,
    playerCoinsAfter: await view("mt_balance_of", { account_id: PLAYER_ID, token_id: "squeek-coin" }),
  });
  assertEq(buSariBroke.coins, 2, "sisa koin merchant 2");
  assertEq(buSariBroke.bankrupt, true, "merchant bangkrut");
  // Toko tutup: buy harus gagal.
  let buyFailed = false;
  try {
    await call(player, "buy", { merchant_id: "bu-sari", token_id: "iron", amount: 1, max_price: 100 });
  } catch {
    buyFailed = true;
  }
  assertEq(buyFailed, true, "buy di toko bangkrut ditolak");

  // 8. Invest 50 -> buka lagi (100 koin, +10 spesialisasi), bonus +10%.
  const coinsBeforeInvest = await view("mt_balance_of", { account_id: PLAYER_ID, token_id: "squeek-coin" });
  tx = await call(player, "invest", { merchant_id: "bu-sari", amount: "50" });
  const buSariOpen = await view("get_merchant", { merchant_id: "bu-sari" });
  const playerAfter = await view("get_player", { account_id: PLAYER_ID });
  const reasonInv = await view("get_reasoning", { merchant_id: "bu-sari", token_id: "iron", account_id: PLAYER_ID });
  step("invest 50 -> toko buka lagi + bonus", {
    tx: tx.transaction.hash,
    explorer: `${EXPLORER}/txns/${tx.transaction.hash}`,
    merchantCoins: buSariOpen.coins,
    bankrupt: buSariOpen.bankrupt,
    stockStone: buSariOpen.stock.stone,
    stockIron: buSariOpen.stock.iron,
    investedIn: playerAfter.invested_in,
    sellBonus: reasonInv.sell_bonus,
    playerCoinsBefore: coinsBeforeInvest,
    playerCoinsAfter: playerAfter.balances["squeek-coin"],
  });
  assertEq(buSariOpen.coins, 100, "koin merchant setelah invest");
  assertEq(buSariOpen.bankrupt, false, "tidak bangkrut lagi");
  assertEq(buSariOpen.stock.stone, 60, "stok stone +10");
  assertEq(buSariOpen.stock.iron, 61, "stok iron 51+10");
  assertEq(reasonInv.sell_bonus, 1.1, "sell_bonus investor 1.1");

  // 9. Restore merchant kanonik ke stok/koin awal (state bersih untuk juri).
  tx = await call(deployer, "register_merchant", { merchant_id: "bu-sari", stock: {}, coins: 200 });
  const restoreBuSariTx = tx.transaction.hash;
  tx = await call(deployer, "register_merchant", { merchant_id: "pak-kumis", stock: {}, coins: 200 });
  step("restore bu-sari + pak-kumis (stok 50, koin 200)", {
    txBuSari: restoreBuSariTx,
    txPakKumis: tx.transaction.hash,
  });
  const finalMerchants = await view("get_merchants", {});
  const finalPlayer = await view("get_player", { account_id: PLAYER_ID });
  step("state akhir", {
    merchants: finalMerchants.map((m) => ({
      id: m.merchant_id,
      coins: m.coins,
      bankrupt: m.bankrupt,
      stock_wood: m.stock.wood,
      stock_iron: m.stock.iron,
      demand_wood: m.demand.wood,
      demand_iron: m.demand.iron,
      invested_by: m.invested_by,
    })),
    player: finalPlayer,
    note: "demand kayu pak-kumis 5 meluruh sendiri -1/5 menit; invested_by bu-sari mencatat akun verifier (hanya berpengaruh untuk akun itu).",
  });

  results.explorer = `${EXPLORER}/address/${CONTRACT_ID}`;
  const outPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../verification-testnet.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log("[verify] SEMUA LANGKAH LULUS. Hasil:", outPath);
}

main().catch((e) => {
  console.error("[verify] GAGAL:", e);
  process.exit(1);
});
