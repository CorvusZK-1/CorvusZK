# What you're buying (CorvusZK)

Honest inventory of this toolkit as of **5 Nov 2026** (v1.0.1 packaging refresh). Testnet only. Apache-2.0. Not affiliated with Ripple, the XRPL Foundation, or the Midnight Foundation.

## Included

| Item | Notes |
|---|---|
| TypeScript SDK (`src/`, builds to `dist/`) | Non-custodial. Never holds funds, keys, or fulfillments. |
| Three Compact templates | `condition`, `balance_above`, `age_over` under `contracts/` |
| Eligibility template | `contracts/eligibility.compact`: mock Schnorr issuer, one-time nullifier bound to XRPL owner, offer sequence, destination, and preimage commitment. Local circuit only. Not on Preprod. |
| Compiled circuit artifacts | `midnight/managed/` (needed for `npm run simulate` and `MidnightBackend`) |
| Live Midnight Preprod contracts (deployed 3 Nov 2026) | Public addresses in `midnight/deployments.preprod.json` and explorer links below |
| **On-chain submit from the SDK** | `MidnightBackend.submitOnChain` → `midnight/sdk-bridge.mjs` `submitCallTx` (bounded wallet sync; no redeploy) |
| XRPL escrow helpers | Create crypto-condition escrow; finish only after a proof verifies |
| Docs | `docs/getting-started.md`, `docs/templates.md`, `docs/xrpl-escrow-flow.md`, `docs/on-chain-submit.md`, `docs/proof-server.md`, `SECURITY.md`, this file, `README.md` |
| Offline example | `examples/escrow-offline.mjs` (`npm run example:offline`) |
| Offline demo | `npm run demo:offline` — no network, no money |
| Optional web demo | `npm run demo` — uses free XRPL testnet faucet |
| Midnight scripts | Deploy / attest / e2e / `submit-onchain.mjs` under `midnight/` for Preprod |

### Live explorer links (public)

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
- **`MidnightBackend`** — real Compact circuits (`mode: 'local-circuits'` by default). `mode: 'preprod'` attaches live contract addresses. **`submitOnChain`** posts a new Preprod `callTx` when a proof server + funded synced wallet with DUST are available (fails fast otherwise; default sync cap 90s).

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
