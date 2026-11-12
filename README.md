# 🪙 Squeek Market — Squeek Bird + NEAR Economy

**NEAR Hackathon 2026, track `games`.** A slingshot physics game (Squeek Bird)
with a live merchant economy on NEAR: gather materials by knocking down
towers, then buy, sell, and invest with three NPC merchants whose prices move
with stock and demand. Items are **NEP-245 multi-tokens** on one NEAR contract;
the same pricing rules run in the browser (demo mode), in the fast-forward
simulation, and on-chain.

> **Play it in 30 seconds, no wallet, no setup:** `python3 -m http.server`
> in this folder, open `http://localhost:8000/index.html`, and you are in
> **demo mode** — the full game + market runs locally in your browser.
> Testnet mode is optional (see below).

## What it is

- **Game loop (every ~30 s):** aim → pull the slingshot → release → the bird
  flies and knocks down Grumblin's tower. Destroyed blocks become materials
  in your inventory (wood 2/block, stone 2/block, ice 1/block, iron 1/TNT).
- **Every 5 minutes (one level):** finish a level **WIN** → gathered materials
  are minted into your inventory (losing gives nothing, so retrying cannot
  farm). A 3-star level also grants 1 golden egg.
- **Then open Squeek Market:** check prices at 3 merchants, sell what piled
  up, buy what you lack or a Mighty Seed power-up (next launch ×1.5), or
  invest in a bankrupt merchant. Prices already moved from earlier trading.
- **Goal of a session:** clear 6 levels + become the richest squeek-coin
  trader in the market.

**One thing that must never break:** the original game loop
(slingshot → knock down → stars). The market is a layer on top, not a
replacement.

### Items (NEP-245 — one contract, all item types)

| token | Name | Source | Base price (coins) |
| --- | --- | --- | --- |
| `wood` | Wood | Destroy wood blocks (2/block) | 4 |
| `stone` | Stone | Destroy stone blocks (2/block) | 6 |
| `ice` | Ice | Destroy ice blocks (1/block) | 5 |
| `iron` | Iron | Destroy TNT (1/TNT — iron debris) | 10 |
| `golden-egg` | Golden Egg | 3-star level (1/level) | 60 |
| `mighty-seed` | Mighty Seed | Buy from Bang Jago — power-up, next launch ×1.5 | 40 |
| `squeek-coin` | Squeek Coin | Sell materials / starter grant 20 | currency |

### Merchants (3 NPCs, each with their own stock + coin balance)

| Merchant | Personality | Specialty | Markup | Price quirk |
| --- | --- | --- | --- | --- |
| **Pak Kumis** 👨🏻 | Friendly, honest | Wood & general goods | 1.00 | Fair prices, big stock |
| **Bu Sari** 👩🏻 | Sly, calculating | Stone & iron | 1.15 | Sells high, buys low |
| **Bang Jago** 🧔🏻 | Daring, loves rare goods | Golden eggs & Mighty Seeds | 1.25 | Premium; pays +20% for golden eggs |

### Pricing rules (one source of truth — `market/pricing.js` + contract views)

```
stockFactor  = clamp(2 - stock/50, 0.5, 2.0)   # stock 0 -> 2x, stock 50 -> 1x, stock 100 -> 0.5x
demandFactor = 1 + min(demand / 20, 1.0)        # demand up -> price up, max 2x
buyPrice     = round(base * stockFactor * demandFactor * markup), clamped to [1, 5*base]
sellPrice    = floor(buyPrice * 0.7)            # merchant buys from you at 70% (30% spread)
```

- **Demand rises ONLY on buy** (player buys from merchant). Selling does NOT
  raise demand — it only raises stock. (If selling also raised demand, the
  flood effect would cancel itself.)
- **Prices are per-unit:** every unit in one transaction is priced with the
  stock & demand at that moment. Verified example: buy 5 wood at starting
  price 4 → total **23 coins** (units 4, 4, 5, 5, 5), not 20.
- **Iron flood (must be demonstrable):** sell lots of iron → merchant iron
  stock rises → `stockFactor` falls → iron price drops **immediately**.
  Verified (Bu Sari, markup 1.15): sell 40 iron, stock 50→90 → buy price
  12→6, sell price 8→4, demand stays 0.
- **Bankruptcy:** the merchant pays you from its own coin balance.
  **Partial sale:** if it cannot afford the full amount, it buys as many
  units as it can afford (priced per-unit); the rest stays with you.
  A merchant goes bankrupt when its coins drop below **10** after a payment —
  the shop closes completely until someone invests. Remaining coins are
  recorded as-is.
- **Invest:** pay min **50 coins** → the merchant reopens with 100 coins +
  10 units of each of its specialty items. The investor gets a **+10% sell
  bonus** at that merchant (recorded per player).
- Hover any price to see the full reasoning: base, stock + stockFactor,
  demand + demandFactor, markup, final price.
- Demand decays −1 per 5 minutes of real time (and −1 per simulated day in
  fast-forward).

## Run locally — "do X, see Y"

Requirements: any static file server (Python 3 is enough). No build step,
no dependencies for demo mode.

```bash
git clone https://github.com/armandoalshahab/squeek-bird.git
cd squeek-bird
git checkout near-hackathon
python3 -m http.server 8000
```

Then open `http://localhost:8000/index.html` in a browser.

| Do X | See Y |
| --- | --- |
| Open the page | The game loads and is immediately playable — **no wallet, no login**. The panel below the arena says "🎮 Mode: Demo (tanpa wallet)" and your inventory shows **20 squeek-coins** (starter grant). |
| Pull the slingshot, release, knock down blocks | The gather line under the market panel grows, e.g. "🎒 Gather level ini: +4 🪵 Kayu, +1 🔩 Besi". |
| Finish the level (win) | Toast "🎒 Gather level: +4 🪵 Kayu, +1 🔩 Besi" and the materials appear in your inventory bar. Lose and you get nothing. |
| Finish a level with 3 stars | +1 🥚 Golden Egg in your inventory. |
| In the market, click **+5** on Wood at Pak Kumis | 5 wood enters your inventory, coins drop by **23** (units 4,4,5,5,5 — not 20), Pak Kumis wood stock drops 50→45 and wood demand rises 0→5, so the next wood price is higher. |
| Click **⏩ Simulasi Seminggu** | 7 simulated days run in ~1 minute: a trade log scrolls, the price table moves, and events appear (near-bankrupt / bankrupt / out of stock). A banner says "Simulasi — bukan perdagangan nyata": it runs on a **copy** of the market, your real market does not change. |
| Open the page again later | Your demo state (coins, inventory, merchant stocks) is still there — it lives in `localStorage`. |

> **Do NOT open `index.html` via `file://`** — the market scripts load as
> separate files and some browsers block that. Always use a local server
> (the `python3 -m http.server` command above).

## Demo mode vs testnet mode

### Demo mode (default)

- No wallet, no network calls to NEAR. Everything is computed locally by
  `market/pricing.js` and stored in `localStorage`.
- This is the mode judges/screeners use — zero setup.

### Testnet mode (optional — "⛓️ Main di NEAR testnet" button)

- The game creates an **implicit testnet account in the browser** (keypair in
  `localStorage`) and you fund it from the testnet faucet (free).
- Every gather/trade calls the deployed contract via near-api-js. You can
  switch back to demo mode at any time.
- **Contract:** [`squeek-market.testnet`](https://testnet.nearblocks.io/address/squeek-market.testnet)
  on NEAR testnet. Deployed 11 Nov 2026, deploy tx
  [`6UZM3qDoy3eHmB72f79ZTvWL6jw26E4L4J5usXuev1D2`](https://testnet.nearblocks.io/txns/6UZM3qDoy3eHmB72f79ZTvWL6jw26E4L4J5usXuev1D2).
- The key in your browser is a **dev testnet key only** — never a mainnet
  wallet. The seed phrase is never displayed. No private key is stored in
  this repo.
- **RPC used:** `https://rpc.testnet.fastnear.com`.
  `https://rpc.testnet.near.org` is deprecated and returns HTTP 429 — it is
  not used anywhere in this repo (only mentioned in docs as a warning).

| Do X | See Y |
| --- | --- |
| Click "⛓️ Main di NEAR testnet" | If no testnet account exists yet, a toast shows the new implicit account id and the faucet link (`https://near-faucet.io/`). Fund it (free testnet NEAR), then trade. |
| Buy/sell in testnet mode | A toast "⛓️ Transaksi buy terkirim ke testnet (N koin)." — the `max_price`/`min_price` sent is the **per-unit iterative total** computed from the merchant's latest on-chain state (see "Integration notes"). Verify the tx on the explorer link above. |

## Reproduce the economy (demo mode — exact numbers)

All of these are covered by the automated checklist
(`node market/test-checklist.js`, 24/24 PASS) and were also verified on-chain
on testnet (see `contract/verification-testnet.json`).

### 1. Gather → inventory

Do: destroy 2 wood blocks + 1 TNT, finish the level with 3 stars.
See: inventory +4 wood, +1 iron, +1 golden egg. Daily gather caps
(200/day per material, 3/day golden egg) prevent unlimited minting;
Mighty Seed and squeek-coin cannot be gathered.

### 2. Buy & sell move balances, stock, and price

Do: with 500 coins, buy 5 wood from Pak Kumis (starting price 4).
See: you pay **23 coins** (units 4,4,5,5,5), wood stock 50→45, wood demand
0→5, your coins 500→477. Then sell 2 stone to Bu Sari: you receive 8 coins
(units 4,4).

### 3. Iron flood: price falls immediately

Do: give yourself 100 iron (test script does this; in the UI, gather/sell
your way there), make sure Bu Sari has enough coins, then sell **40 iron**
to Bu Sari.
See: Bu Sari iron stock 50→**90**, demand stays **0**, you receive 202 coins,
and the iron price falls **immediately** — buy 12→**6**, sell 8→**4**.
No waiting for demand decay: selling does not raise demand, so the flood
is not cancelled out.

### 4. Bankruptcy → invest → reopen with bonus

Do: set Bu Sari coins to 10, then sell 2 iron to her.
See: only **1 unit** sells (8 coins, units priced 8 then 7 — she cannot
afford the second), her coins drop to **2 < 10 → bankrupt**, the shop
closes (buy & sell are refused), 1 iron stays with you. Then invest
**50 coins**: the shop reopens with **100 coins**, +10 stone and +10 iron
(her specialties), you are recorded as investor, and the reasoning tooltip
shows sell bonus ×1.10 (iron sell price 8 → 9 for you). Investing is
refused while the merchant is not bankrupt.

### 5. Fast-forward a week

Do: click "⏩ Simulasi Seminggu".
See: 7 days × ~8 s, NPC traders (buyers & sellers with random strategies)
trade with the merchants using the same §4 formulas, the log fills
(70+ entries), prices move (e.g. Pak Kumis iron 4→10), and your real market
state is unchanged afterwards.

### 6. Testnet parity (on-chain)

Verified 11 Nov 2026 with account `squeek-player.testnet` (a verification
account created for this purpose, not the user's account):

- `get_price` / `get_reasoning` views match `market/pricing.js` for all
  3 merchants × 6 items (18/18).
- Buy 5 wood @ Pak Kumis: quote total 27 (units 5,5,5,6,6 — demand had
  decayed to 3 since the earlier verification), tx
  [`xC3osCJ2Eahpzj9wXazwyqCAyA6GPPeCQ9paHJnBZgj`](https://testnet.nearblocks.io/txns/xC3osCJ2Eahpzj9wXazwyqCAyA6GPPeCQ9paHJnBZgj):
  wood 11→16, coins 172→145, stock 50→45, demand 3→8.
- Sell 1 iron @ Bu Sari (investor bonus): quote total 9, tx
  [`H5vnYaY5nrAd6gQSrnRQn5X8MH7guML6VmzCT5zpQUpJ`](https://testnet.nearblocks.io/txns/H5vnYaY5nrAd6gQSrnRQn5X8MH7guML6VmzCT5zpQUpJ):
  iron 1→0, coins 145→154, stock 50→51, demand 0→0.
- The OLD flat-price UI args were proven to fail on-chain: buy 5 wood with
  `max_price` 30 (flat) reverts with `Price 34 exceeds max_price 30`.
- Earlier full verification (gather, mt_transfer, flood, bankruptcy,
  invest, restore) is in `contract/verification-testnet.json` with tx hashes.

## File structure

```
index.html                  # game + market panel (meta tag kept; Squeekchain live feed removed for the NEAR submission)
market/pricing.js           # ONE pricing rules file — pure functions, Indonesian comments
market/merchants.js         # 3 merchant definitions (name, personality, markup, specialty)
market/near.js              # NEAR client: demo mode (localStorage) + testnet mode (near-api-js)
market/near-config.js       # testnet contract address (no secrets)
market/market-ui.js         # market panel, reasoning tooltips, buy/sell/invest buttons
market/fastforward.js       # one-week trading simulation (on a copy of the state)
market/test-checklist.js    # DESIGN.md §10 checklist, items 1-6 (demo, Node)
contract/                   # near-sdk-js: src/contract.ts, tests, deploy + verify scripts
DESIGN.md                   # design doc (written before coding — track requirement)
README.md                   # this file
```

## Run the tests

```bash
# Demo checklist (DESIGN.md §10 items 1-6 + pricing rules + mighty-seed): 24/24 PASS
node market/test-checklist.js

# Contract unit tests (21 contract logic + 8 pricing-parity): 29/29 PASS
cd contract && npm test

# DOM smoke test (panel renders, click-to-buy changes state, meta tag intact):
# needs jsdom — the harness used during development lives outside the repo
node /tmp/domtest/dom-test.js   # 19/19 PASS (if the harness is present)
```

## Contract methods (NEP-245 + game)

Core NEP-245: `mt_transfer`, `mt_batch_transfer`, `mt_balance_of`,
`mt_batch_balance_of`, `mt_token`, `mt_tokens`, `mt_tokens_for_owner`,
`mt_supply`. Game methods: `new`, `register_merchant`, `starter_grant`
(once per account: +20 squeek-coin), `gather` (daily caps),
`buy(merchant_id, token_id, amount, max_price)`,
`sell(merchant_id, token_id, amount, min_price)` (partial sale),
`invest(merchant_id, amount)` (min 50, bankrupt merchants only).
Views: `get_price`, `get_reasoning`, `get_merchant`, `get_merchants`,
`get_player`. Full spec: `DESIGN.md` §5.

## Integration notes (for reviewers)

- **Bug fix 1 — testnet trade args:** the UI used to send
  `max_price`/`min_price` = per-unit price × qty (flat). The contract
  prices iteratively per unit, so e.g. buy 5 wood needs 23, not 20, and
  sell 40 iron totals ~228, not 320. The UI now fetches the latest
  on-chain merchant state via `get_merchant` (+ `get_player` for investor
  status) and computes the total with `Pricing.quoteBuy`/`quoteSell`
  before calling `buy`/`sell`. Demo mode was already correct (it uses the
  same quote functions) and is unchanged.
- **Bug fix 2 — RPC:** `market/near.js` used the deprecated
  `https://rpc.testnet.near.org` (HTTP 429 during verification). It now
  uses `https://rpc.testnet.fastnear.com`, the same endpoint the contract
  deploy/verify scripts use. No other live code used the old endpoint.
- **Bug fix 3 — config not loaded:** `index.html` mentioned
  `market/near-config.js` in a comment but never loaded it, so in the
  browser `window.SQUEEK_NEAR_CONFIG` was undefined and testnet mode could
  never activate (always "kontrak belum ter-deploy"). The file is now
  loaded before `market/near.js`.
- **Subtlety — sell price view vs payout:** `get_price(..., "sell")` is the
  base sell price without the investor bonus (the view does not know the
  caller). The actual `sell` payout applies the +10% investor bonus (and
  Bang Jago's +20% golden-egg bonus) — the UI's `quoteSell` includes those
  bonuses, which is what matches the on-chain payout (verified: view 8,
  investor payout 9).

## Disclosure (hackathon rules)

- **Base game:** Squeek Bird was built **6 Nov 2026** — inside the hackathon
  window (19 Oct–14 Nov 2026). It is a standalone slingshot game with no
  contract; it was already submitted to the Squeekchain builder program
  (domain verification passed, `squeekchain-project` meta tag
  `0a2cba14-2cbc-46d4-9581-3ddc7bfce2bf` kept intact).
- **NEAR integration in this branch:** the Squeek Market economy, the
  NEP-245 contract, testnet deployment, and this README were built
  **11–13 Nov 2026** on branch [`near-hackathon`](https://github.com/armandoalshahab/squeek-bird/tree/near-hackathon).
  Base commit tagged `pre-hackathon` (`9a00cc6`); submission tagged
  `hackathon-submission`.
- **Diff (NEAR work only):**
  https://github.com/armandoalshahab/squeek-bird/compare/main...near-hackathon
- The Squeekchain live feed panel from the base game was removed in this
  branch for a clean NEAR submission (it still lives on `main`). The `main` branch and its Vercel deployment are
  untouched — all hackathon work is on `near-hackathon`.

## Future development: NEAR Intents

**Not part of this build.** As a next step, NEAR Intents could settle
cross-chain trades: a player on another chain could buy Squeek Market items
and the intent solver would settle into squeek-coin on NEAR. The market's
per-unit pricing and merchant balances are already the settlement inputs
such a solver would need. Deliberately left out of scope here — the focus
is NEP-245 + a merchant economy that works.

## Limits (honest notes)

- Demo mode is a local simulation: state lives in `localStorage`, there is
  no server and no anti-cheat — it is a game, not a financial product.
- `gather` has daily caps (200/material, 3 golden eggs) so testnet minting
  cannot run away; Mighty Seed and squeek-coin cannot be gathered.
- Testnet mode uses implicit accounts + faucet funds; never use a mainnet
  wallet or real funds with this demo. Nothing here touches NEAR mainnet.
- No external calls in demo mode: the Squeekchain live feed was removed
  from this branch, so the demo runs fully offline (testnet mode still
  needs internet for NEAR RPC).
