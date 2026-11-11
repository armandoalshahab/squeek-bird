// Deploy Squeek Market ke NEAR TESTNET (bukan mainnet).
// - Akun kontrak: squeek-market.testnet (dicek dulu; kalau sudah dipakai,
//   ganti nama di CONTRACT_ID dan jalankan lagi).
// - Akun deployer dibuat GRATIS lewat faucet/helper testnet
//   (POST https://helper.testnet.near.org/account) — tanpa akun siapa pun.
// - Kredensial deployer disimpan di ~/.near-credentials/testnet/ (lokasi
//   standar near-cli), TIDAK PERNAH di repo / di-commit.
// - Setelah deploy: panggil new({owner_id}) lalu verifikasi get_mercants.
//   Jalankan:  npm run deploy:testnet
import * as nearApi from "near-api-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACT_ID = process.env.CONTRACT_ID || "squeek-market.testnet";
const WASM_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../build/squeek-market.wasm",
);
const CRED_DIR = path.join(os.homedir(), ".near-credentials", "testnet");
const CRED_PATH = path.join(CRED_DIR, `${CONTRACT_ID}.json`);
const HELPER_URL = "https://helper.testnet.near.org";
const RPC_URL = "https://rpc.testnet.fastnear.com";

function log(...a) {
  console.log("[deploy]", ...a);
}

async function accountExists(connection, accountId) {
  try {
    await connection.provider.query({
      request_type: "view_account",
      account_id: accountId,
      finality: "final",
    });
    return true;
  } catch (e) {
    if (e?.type === "AccountDoesNotExist" || String(e?.message ?? e).includes("does not exist")) {
      return false;
    }
    throw e;
  }
}

async function createAccountViaHelper(accountId, publicKey) {
  const res = await fetch(`${HELPER_URL}/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`helper ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

async function main() {
  const wasm = fs.readFileSync(WASM_PATH);
  log("wasm:", WASM_PATH, wasm.length, "bytes");

  let keyPair;
  let existed = false;
  if (fs.existsSync(CRED_PATH)) {
    const saved = JSON.parse(fs.readFileSync(CRED_PATH, "utf8"));
    keyPair = nearApi.KeyPair.fromString(saved.private_key);
    log("kredensial deployer sudah ada:", CRED_PATH);
  } else {
    keyPair = nearApi.KeyPair.fromRandom("ed25519");
    log("keypair deployer baru, public key:", keyPair.getPublicKey().toString());
  }

  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", CONTRACT_ID, keyPair);
  const near = await nearApi.connect({
    networkId: "testnet",
    keyStore,
    nodeUrl: RPC_URL,
    walletUrl: "https://testnet.mynearwallet.com",
    helperUrl: HELPER_URL,
    headers: {},
  });

  if (await accountExists(near.connection, CONTRACT_ID)) {
    log("akun", CONTRACT_ID, "SUDAH ADA (bukan dibuat script ini).");
    existed = true;
    if (!fs.existsSync(CRED_PATH)) {
      throw new Error(
        `Akun ${CONTRACT_ID} sudah dipakai orang lain dan kredensialnya tidak ada di ${CRED_PATH}. ` +
          `Set CONTRACT_ID lain, mis. CONTRACT_ID=squeek-market-1.testnet npm run deploy:testnet`,
      );
    }
  } else {
    log("akun belum ada — buat via faucet/helper testnet...");
    await createAccountViaHelper(CONTRACT_ID, keyPair.getPublicKey().toString());
    log("akun dibuat:", CONTRACT_ID);
    fs.mkdirSync(CRED_DIR, { recursive: true });
    fs.writeFileSync(
      CRED_PATH,
      JSON.stringify(
        {
          account_id: CONTRACT_ID,
          public_key: keyPair.getPublicKey().toString(),
          private_key: keyPair.toString(),
        },
        null,
        2,
      ),
    );
    fs.chmodSync(CRED_PATH, 0o600);
    log("kredensial disimpan:", CRED_PATH, "(chmod 600, DI LUAR repo)");
  }

  const account = await near.account(CONTRACT_ID);
  const state = await account.state();
  log("saldo akun:", nearApi.utils.format.formatNearAmount(state.amount), "NEAR");

  log("deploy kontrak...");
  const deployOutcome = await account.deployContract(wasm);
  log("deploy tx:", deployOutcome.transaction.hash);
  log("explorer:", `https://testnet.nearblocks.io/txns/${deployOutcome.transaction.hash}`);

  // Init — kalau sudah ter-init (redeploy), lewati dengan pesan.
  // NAMA METHOD: `init`, bukan `new` seperti DESIGN.md §5 — near-sdk-js
  // tidak bisa mengekspor method bernama `new` (hasil generate-nya
  // `export function new(){}` adalah syntax error JS). Init hanya dipakai
  // saat deploy, frontend tidak memanggilnya.
  try {
    log("init init({owner_id})...");
    const initOutcome = await account.functionCall({
      contractId: CONTRACT_ID,
      methodName: "init",
      args: { owner_id: CONTRACT_ID },
      gas: BigInt("30000000000000"),
    });
    log("init tx:", initOutcome.transaction.hash);
  } catch (e) {
    if (String(e?.message ?? e).includes("already initialized")) {
      log("kontrak sudah ter-init sebelumnya — lewati init.");
    } else {
      throw e;
    }
  }

  const merchants = await account.viewFunction({
    contractId: CONTRACT_ID,
    methodName: "get_merchants",
    args: {},
  });
  log("merchant terdaftar:", merchants.map((m) => m.merchant_id).join(", "));
  for (const m of merchants) {
    log(
      ` - ${m.merchant_id}: coins=${m.coins} bankrupt=${m.bankrupt} ` +
        `stock=${JSON.stringify(m.stock)} markup=${m.markup}`,
    );
  }
  console.log(
    JSON.stringify({ contractId: CONTRACT_ID, existed, explorer: `https://testnet.nearblocks.io/address/${CONTRACT_ID}` }),
  );
}

main().catch((e) => {
  console.error("[deploy] GAGAL:", e);
  process.exit(1);
});
