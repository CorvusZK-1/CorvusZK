# CorvusZK

Non-custodial TypeScript SDK and Compact templates for **proof-gated XRPL escrows** and **privacy claims** (balance above X, age over N, condition met), designed for Midnight + XRPL.

- Never holds or moves user funds. XRP sits in a native XRPL escrow created by the payer's own wallet, and it can only go to the escrow's fixed destination.
- Never stores keys or fulfillments.
- **Testnet only** in this release (Midnight Preprod + XRPL testnet).

**Buyer brief:** see [WHAT-YOU-GET.md](WHAT-YOU-GET.md) for an honest included / not-included checklist.

## Who it is for

TypeScript builders shipping **small XRPL apps** that need a private yes/no before releasing escrowed XRP — age gates, proof-of-funds style checks, or “condition met” attestations — without becoming a custodial wallet or a bank. Not a bank product; not mainnet-ready yet.

Start here: [docs/getting-started.md](docs/getting-started.md) · buyer checklist: [WHAT-YOU-GET.md](WHAT-YOU-GET.md)


## Status (honest)
| Part | State |
|---|---|
| XRPL testnet escrow create/finish | Works (integration test) |
| `LocalSimulationBackend` | Works. **Not zero-knowledge**: a signed attestation for dev/testing |
| Compact templates (`condition`, `balance_above`, `age_over`) | Compile with Compact 0.31.1, proving keys generated |
| Midnight Preprod deploy + proof-gated escrow (`midnight/`) | **Live on Preprod (3 Nov 2026)**: condition `45563d2e…52f5` (attest tx `311bfb85…7eda`), age_over `3458e155…2367`, balance_above `8606a637…6c0c`; XRPL testnet EscrowFinish `A289E64F…40AE` released after the proof. Scripts: `ensure-pipeline.sh` syncs a wallet, registers DUST, deploys the 3 templates, runs `attest`, then releases an XRPL escrow (`e2e-escrow.mjs`) |
| `MidnightBackend` class in the SDK | **Wired**: `prove` / `verify` run compiled Compact circuits via `midnight/sdk-bridge.mjs`. Default `mode: 'local-circuits'` needs no wallet sync. `mode: 'preprod'` attaches live contract addresses. **`submitOnChain`** posts a new Preprod `callTx` (attest/prove) through the same bridge (bounded sync, no redeploy). CLI: `midnight/submit-onchain.mjs`. See [docs/on-chain-submit.md](docs/on-chain-submit.md) |

## Quickstart (5 minutes, no money needed)
Requires Node 20+.
```bash
npm install && npm run build
npm run demo:offline   # no network: the 3 claims, passing and refused cases
npm run example:offline # same idea as a copy-pasteable examples/ script
npm run simulate       # runs the real compiled Compact circuits locally (needs: cd midnight && npm ci)
npm test               # unit tests + 1 live XRPL testnet escrow test
npm run demo           # web demo at http://localhost:8787: funds throwaway XRPL testnet wallets, locks 20 XRP, proves 18+, releases
```

Docs: [getting started](docs/getting-started.md) · [what you're buying](WHAT-YOU-GET.md) · [the 3 proof templates](docs/templates.md) · [proof-gated XRPL escrow flow](docs/xrpl-escrow-flow.md) · [security](SECURITY.md)

### Which backend to use
| Backend | What it is | Use when |
|---|---|---|
| `LocalSimulationBackend` | Ed25519-signed attestation. **Not ZK.** | Learning the escrow API offline / in unit tests |
| `MidnightBackend` | Real Compact circuits via `midnight/sdk-bridge.mjs`; `submitOnChain` for Preprod callTx | Circuit prove/verify locally, or post a new on-chain attest/prove when wallet + proof server + DUST are ready |

Use it in your app (simulation backend):
```ts
import * as xrpl from 'xrpl';
import { LocalSimulationBackend, createCryptoCondition, createEscrow, proveAgeOver, verifyAndReleaseEscrow, XRPL_TESTNET_WSS } from 'corvuszk';
const client = new xrpl.Client(XRPL_TESTNET_WSS); await client.connect();
const cond = createCryptoCondition();                       // buyer keeps cond.fulfillment
const esc = await createEscrow(client, buyer, { destination: seller.address, amountXrp: '20', condition: cond.condition });
const backend = new LocalSimulationBackend();
const proof = await proveAgeOver(backend, 1990, 18, 2026, salt);
await verifyAndReleaseEscrow(client, seller, { backend, proof, owner: esc.owner, offerSequence: esc.offerSequence, ...cond });
```

Real Compact circuits via `MidnightBackend` (local circuits; no redeploy):
```ts
import { MidnightBackend, proveAgeOver, proveBalanceAbove, proveCondition } from 'corvuszk';
// Token from env only — never hard-code or log it.
const backend = new MidnightBackend({
  blockfrostProjectId: process.env.BLOCKFROST_MIDNIGHT_PREPROD,
  mode: 'local-circuits', // or 'preprod' to attach deployments.preprod.json addresses
});
// Needs: cd midnight && npm ci  (Compact runtime + managed circuits)
const age = await proveAgeOver(backend, 1990, 18, 2026, 'dev-salt');
const bal = await proveBalanceAbove(backend, 5000, 1000, 'dev-salt');
const ok = await backend.verify(age); // true when the circuit accepted the witness

// Optional: post a new on-chain callTx (needs proof server + synced wallet with DUST)
// const { txHash, proof } = await backend.submitOnChain({
//   claim: age.claim,
//   witness: { kind: 'ageOver', birthYear: 1990, salt: 'dev-salt' },
//   syncTimeoutMs: 90_000,
// });
```

Docs for chain submit: [on-chain submit](docs/on-chain-submit.md) · [proof server runbook](docs/proof-server.md)

## API
- `proveCondition(backend, secret, salt, commitment)`, `proveBalanceAbove(backend, balance, threshold, salt)`, `proveAgeOver(backend, birthYear, minAge, asOfYear, salt)` return a `Proof`, or throw if the predicate is false. Helpers pass private witnesses into `MidnightBackend` without putting them on `Proof.claim`.
- `createCryptoCondition()` returns a PREIMAGE-SHA-256 `{condition, fulfillment}`.
- `createEscrow(client, payerWallet, {destination, amountXrp, condition, cancelAfterSec})`
- `verifyAndReleaseEscrow(client, submitter, {backend, proof, owner, offerSequence, condition, fulfillment})` verifies the proof first, then submits EscrowFinish.
- `commit(value, salt)` creates a hiding commitment. The simulation uses SHA-256; the Compact templates use `persistentHash`. `MidnightBackend` rewrites `Proof.claim.commitment` to the Compact commitment.
- `MidnightBackend.submitOnChain({ claim, witness, contractAddress?, syncTimeoutMs? })` submits a Preprod `callTx` and returns `{ txId, txHash, blockHeight, contractAddress, proof }`. Callers pass witnesses; the SDK persists nothing. Fails fast if Blockfrost, proof server, sync, or DUST are missing.

## To enable real Midnight Preprod proofs
1. Create a free Blockfrost account and a "Midnight Preprod" project. Its token starts with `nightpreprod`. Export it as `BLOCKFROST_MIDNIGHT_PREPROD` (never commit or log it).
2. `cd midnight && npm ci` so `MidnightBackend` can load `sdk-bridge.mjs` and the managed circuits.
3. For **local circuit proofs** (SDK default): nothing else — `new MidnightBackend({ blockfrostProjectId: process.env.BLOCKFROST_MIDNIGHT_PREPROD })` then `proveAgeOver` / etc.
4. For **on-chain submit** against contracts already in `midnight/deployments.preprod.json`: start the proof server (see [docs/proof-server.md](docs/proof-server.md)), ensure the deployer wallet has DUST, then `backend.submitOnChain(...)` or `cd midnight && node submit-onchain.mjs --template age_over`. For a **fresh deploy**, use `midnight/deploy.mjs` / `ensure-pipeline.sh` (longer; registers DUST if needed). Faucet: https://midnight-tmnight-preprod.nethermind.dev/

## Licence
Apache-2.0. Dependencies: xrpl.js (ISC), five-bells-condition (Apache-2.0), Compact/Midnight.js (Apache-2.0, optional under `midnight/`). Not affiliated with Ripple, the XRPL Foundation or the Midnight Foundation.

## Buildathon Wave 3 materials
Pitch deck, demo script, and Wave 3 progress write-up: [docs/buildathon/](docs/buildathon/).
