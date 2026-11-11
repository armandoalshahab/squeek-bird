// Mock host NEAR (`env`) untuk unit test kontrak di Node.
// near-sdk-js memanggil fungsi host lewat global `env` (lihat
// node_modules/near-sdk-js/lib/api.js): storage_read/write/remove/has_key,
// read_register, predecessor/current_account_id, block_timestamp,
// attached_deposit, log. Mock ini memakai Map sebagai storage + register 0
// untuk nilai baca, dan memungkinkan kontrol waktu (untuk uji peluruhan
// demand) serta pemanggil (predecessor) per pemanggilan method.
//
// Pemakaian di test:
//   import "./mock-env.mjs";            // HARUS sebelum import kontrak
//   import { SqueekMarket } from "../test-build/contract.js";
//   const env = freshEnv();             // reset storage + waktu
//   const c = new SqueekMarket(); c.init({ owner_id: "owner.testnet" });

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const EVICTED_REGISTER = 2n ** 64n - 2n;

function toHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

class MockEnv {
  constructor() {
    this.reset();
  }

  reset() {
    this.storage = new Map(); // hex(key) -> Uint8Array
    this.registers = new Map(); // bigint -> Uint8Array
    this.predecessor = "alice.testnet";
    this.currentAccount = "squeek-market.testnet";
    this.signer = "alice.testnet";
    this.timestampNs = 1_769_000_000_000_000_000n; // ~2026-01-20, bebas
    this.deposit = 0n;
    this.logs = [];
  }

  // -- kontrol test --
  setCaller(accountId) {
    this.predecessor = accountId;
    this.signer = accountId;
  }
  setDeposit(yocto) {
    this.deposit = BigInt(yocto);
  }
  setTimeSec(sec) {
    this.timestampNs = BigInt(sec) * 1_000_000_000n;
  }
  advanceSec(sec) {
    this.timestampNs += BigInt(sec) * 1_000_000_000n;
  }
  nowSec() {
    return Number(this.timestampNs / 1_000_000_000n);
  }

  // -- konversi string/bytes (dipakai utils SDK) --
  latin1_string_to_uint8array(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
  uint8array_to_latin1_string(a) {
    let out = "";
    for (let i = 0; i < a.length; i++) out += String.fromCharCode(a[i]);
    return out;
  }
  utf8_string_to_uint8array(s) {
    return textEncoder.encode(s);
  }
  uint8array_to_utf8_string(a) {
    return textDecoder.decode(a);
  }

  // -- host functions --
  log(...args) {
    this.logs.push(args.map(String).join(" "));
  }
  predecessor_account_id(registerId) {
    this.registers.set(BigInt(registerId), textEncoder.encode(this.predecessor));
  }
  current_account_id(registerId) {
    this.registers.set(BigInt(registerId), textEncoder.encode(this.currentAccount));
  }
  signer_account_id(registerId) {
    this.registers.set(BigInt(registerId), textEncoder.encode(this.signer));
  }
  signer_account_pk(registerId) {
    this.registers.set(BigInt(registerId), new Uint8Array(32));
  }
  block_timestamp() {
    return this.timestampNs;
  }
  attached_deposit() {
    return this.deposit;
  }
  storage_read(key, registerId) {
    const v = this.storage.get(toHex(key));
    if (v === undefined) return 0n;
    this.registers.set(BigInt(registerId), v);
    return 1n;
  }
  storage_write(key, value, evictedRegister) {
    const k = toHex(key);
    const prev = this.storage.get(k);
    if (prev !== undefined) {
      this.registers.set(BigInt(evictedRegister), prev);
    }
    this.storage.set(k, value);
    return prev !== undefined ? 1n : 0n;
  }
  storage_remove(key, evictedRegister) {
    const k = toHex(key);
    const prev = this.storage.get(k);
    if (prev === undefined) return 0n;
    this.registers.set(BigInt(evictedRegister), prev);
    this.storage.delete(k);
    return 1n;
  }
  storage_has_key(key) {
    return this.storage.has(toHex(key)) ? 1n : 0n;
  }
  read_register(registerId) {
    return this.registers.get(BigInt(registerId)) ?? new Uint8Array(0);
  }
  // Stub lain yang mungkin dipanggil SDK tapi tidak dipakai kontrak ini.
  input(registerId) {
    this.registers.set(BigInt(registerId), textEncoder.encode("{}"));
  }
  storage_usage() {
    return 1000n;
  }
  account_balance() {
    return 1000000000000000000000000000n;
  }
}

export const mockEnv = new MockEnv();

// Pasang sebagai global `env` persis seperti runtime WASM NEAR.
globalThis.env = mockEnv;

export function freshEnv() {
  mockEnv.reset();
  return mockEnv;
}

export { textDecoder };
