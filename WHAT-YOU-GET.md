# What's included (CorvusZK)

Honest inventory of this toolkit as of **11 Nov 2026** (ledger 9 code upgrade; v1.0.1 packaging was 5 Nov 2026). Testnet only. Apache-2.0. Not affiliated with Ripple, the XRPL Foundation, or the Midnight Foundation.

## Included

| Item | Notes |
|---|---|
| TypeScript SDK (`src/`, builds to `dist/`) | Non-custodial. Never holds funds, keys, or fulfillments. |
| Three Compact templates | `condition`, `balance_above`, `age_over` under `contracts/` |
| Eligibility template | `contracts/eligibility.compact`: mock Schnorr issuer, one-time nullifier bound to XRPL owner, offer sequence, destination, and preimage commitment. Run live on Preprod ledger 9 with an XRPL testnet escrow release on 12 Nov 2026 ([receipts/ledger9-preprod-2026-11-12.md](receipts/ledger9-preprod-2026-11-12.md)); first live run on ledger 8, 6 Nov 2026 ([docs/live-run.md](docs/live-run.md)). |
| Compiled circuit artifacts | `midnight/managed/` (needed for `npm run simulate` and `MidnightBackend`) |
| Live Midnight Preprod contracts (ledger 9, deployed 11 Nov 2026) | Addresses and tx hashes in `midnight/deployments.preprod.json` and the links below; ledger 8 history (3 Nov) under `ledger8History` |
| **On-chain submit from the SDK** | `MidnightBackend.submitOnChain` → `midnight/sdk-bridge.mjs` `submitCallTx` (bounded wallet sync; no redeploy) |
| XRPL escrow helpers | Create crypto-condition escrow; finish only after a proof verifies |
| Docs | `docs/getting-started.md`, `docs/templates.md`, `docs/xrpl-escrow-flow.md`, `docs/on-chain-submit.md`, `docs/proof-server.md`, `SECURITY.md`, this file, `README.md` |
| Offline example | `examples/escrow-offline.mjs` (`npm run example:offline`) |
| Offline demo | `npm run demo:offline` — no network, no money |
| Optional web demo | `npm run demo` — uses free XRPL testnet faucet |
| Midnight scripts | Deploy / attest / e2e / `submit-onchain.mjs` under `midnight/` for Preprod |

### Ledger 9 status

**Live on Midnight Preprod ledger 9 since 11 Nov 2026 (about 6:47–6:55 PM PT).** Code upgraded the same day to Wallet SDK 2.0.0, Midnight.js 5.0.0, Compact 0.36.0 and proof server 9.0.0. The throwaway test wallet's free test NIGHT was re-registered for DUST, the three templates were redeployed, and one ZK proof call was submitted to each; the Preprod indexer reports all three calls as SUCCESS. On **12 Nov 2026** (2:55 AM PT) the eligibility template and the XRPL escrow release were also run live on ledger 9 ([receipts](receipts/ledger9-preprod-2026-11-12.md)). The older ledger 8 records (3–6 Nov 2026) are kept under `ledger8History` in `midnight/deployments.preprod.json`.

- `condition` contract: https://preprod.midnightexplorer.com/contracts/b6f78efb34e84b8809267764f0f62eaab5f375c845cc57a64a63b700dde04df3
  - deploy tx: https://preprod.midnightexplorer.com/transactions/1c24472691745fea4b864140613a44be6f588fcda8ab6d1f20e6ae73873f437c
  - `attest` (ZK proof) tx: https://preprod.midnightexplorer.com/transactions/c974a56ea2e257d09701d55c9d82cc6a9dcb7231d565a6324dd0c5b6e343847f
- `age_over` contract: https://preprod.midnightexplorer.com/contracts/838bb8f23e4413da672fdae86d29c7918da2dab8ab6e32ff9c824357127ea16f
  - deploy tx: https://preprod.midnightexplorer.com/transactions/94a06463280aa11934e4659903d28e0e54afaf830ba728489b932890d99dfa82
  - `prove` (ZK proof) tx: https://preprod.midnightexplorer.com/transactions/fb86e2539597ce7934c10cfc528ea890c4ed2513af25756e2b27218ba59ada89
- `balance_above` contract: https://preprod.midnightexplorer.com/contracts/7eab336024024dfec2787023d0ee5af56818d9199425bb76f1b756570f04284b
  - deploy tx: https://preprod.midnightexplorer.com/transactions/1aab88403471888ef9ab5ab499ca3b3f07fa9e06eb4817f3ba09a12ed60cde80
  - `prove` (ZK proof) tx: https://preprod.midnightexplorer.com/transactions/e14168707c2f48a3edd0a5f7bdaaa0aef1cf51c13da456763da1f22b28fabd4f

### Explorer links from the ledger 8 run (3–6 Nov 2026, before the 9 Nov network upgrade)

- Condition contract: https://preprod.midnightexplorer.com/contracts/45563d2ede4887717968e51405bc4d9993dd7082959c59cda72755c500cd52f5
- Attest (ZK) tx: https://preprod.midnightexplorer.com/transactions/311bfb859032f9fa5c1391eaf7055ff5e3956d418fbbdfd9fcd0e564dee17eda
- XRPL escrow released after that proof: https://testnet.xrpl.org/transactions/A289E64FA9FCB6F6CBD70AD6F86F2D3556B0444726A3425087423DF3315D40AE

## Not included

| Item | Status |
|---|---|
| Midnight **mainnet** | Not shipped. This release is Preprod / XRPL testnet only. |
| Hosted proof relay / monitoring SaaS | Not built. Self-host the proof server (see `docs/proof-server.md`). |
| Registered domain | **corvuszk.com** registered (Porkbun, paid through 5 Nov 2027). Trademark not filed. |
| Wallet seeds, Blockfrost project IDs, or other secrets | Never ship in this package. Set `BLOCKFROST_MIDNIGHT_PREPROD` yourself. |
| Custodial service or money movement | Deliberately out of scope. XRP stays in the payer's own XRPL escrow. |
| Regulated KYC / XRPL Credential object | Not shipped. The eligibility example is a labeled mock. |
| XRPL-enforced Midnight proof | Not shipped. XRPL checks the crypto-condition preimage only. |

## Two backends (know the difference)

- **`LocalSimulationBackend`** — signed attestation for local/dev. **Not zero-knowledge.** Fine for learning the escrow flow.
- **`MidnightBackend`** — real Compact circuits (`mode: 'local-circuits'` by default). `mode: 'preprod'` attaches live contract addresses. **`submitOnChain`** posts a new Preprod `callTx` against the 11 Nov ledger 9 deployments when a proof server + funded synced wallet with DUST are available (fails fast otherwise; default sync cap 90s).

## Try it in 5 minutes (no money)

Requires Node 20+.

```bash
npm install && npm run build
npm run demo:offline
```

Optional next steps:

```bash
npm test                 # unit tests + one live XRPL testnet escrow test
cd midnight && npm ci && cd .. && npm run simulate   # real Compact circuits locally
```

On-chain submit (needs your Blockfrost token, Docker proof server, funded Preprod wallet — see `docs/on-chain-submit.md`):

```bash
cd midnight && node submit-onchain.mjs --template age_over --dry-run
```

## Licence

Apache-2.0. See `README.md` for dependency licences.
