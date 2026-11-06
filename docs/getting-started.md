# Getting started with CorvusZK

Five-minute path for a TypeScript developer who wants **proof-gated XRPL escrow** without touching mainnet money.

## What this is

CorvusZK is a **developer toolkit**, not a bank product and not a custodial wallet. Your app (or your user’s wallet) creates a normal XRPL crypto-condition escrow. CorvusZK proves a private claim on Midnight (age over N, balance above X, or a condition met), then your app finishes the escrow only if that proof verifies.

Funds never sit with CorvusZK. Secrets and fulfillments stay with the caller.

## Pick a backend

| Backend | ZK? | Needs | Use for |
|---|---|---|---|
| `LocalSimulationBackend` | No (signed attestation) | Just `npm install` | Learning the API, unit tests, offline demos |
| `MidnightBackend` `local-circuits` | Yes (Compact circuits) | `cd midnight && npm ci` | Real circuit prove/verify on your machine |
| `MidnightBackend` `preprod` + `submitOnChain` | Yes + on-chain callTx | Blockfrost Preprod token, proof server, funded synced wallet with DUST | Posting a new attest/prove against already-deployed Preprod contracts |

## Step 1 — install and prove offline (no money, no network)

```bash
npm install && npm run build
npm run demo:offline
```

Or copy [examples/escrow-offline.mjs](../examples/escrow-offline.mjs).

## Step 2 — unit + XRPL testnet escrow

```bash
npm test
```

One test creates and finishes a real XRPL **testnet** escrow after a simulation proof. No mainnet, no paid faucets.

## Step 3 — real Compact circuits locally

```bash
cd midnight && npm ci && cd ..
npm run simulate
```

Then in code:

```ts
import { MidnightBackend, proveAgeOver } from 'corvuszk';

const backend = new MidnightBackend({
  // Prefer env; never hard-code or commit Blockfrost tokens.
  blockfrostProjectId: process.env.BLOCKFROST_MIDNIGHT_PREPROD,
  mode: 'local-circuits',
});
const proof = await proveAgeOver(backend, 1990, 18, 2026, 'dev-salt');
```

## Step 4 — on-chain Preprod submit (optional)

See [on-chain-submit.md](on-chain-submit.md) and [proof-server.md](proof-server.md). Fresh **new** contract deploys still go through `midnight/deploy.mjs` / `ensure-pipeline.sh`, not the SDK.

## Commitment caveat (read once)

- Simulation `commit()` uses **SHA-256**.
- Compact templates use **`persistentHash`**.
- Those commitments are **not interchangeable**. `MidnightBackend` rewrites `Proof.claim.commitment` to the Compact commitment for circuit proofs.

`age_over` and `balance_above` still do not check an issuer. `npm run example:eligibility` runs a labeled mock issuer and a one-time escrow nullifier locally. It is not a regulated credential and not a Preprod deployment. The README security model states the remaining trust assumptions.

## Next docs

- [templates.md](templates.md) — the three Compact claims in plain words  
- [xrpl-escrow-flow.md](xrpl-escrow-flow.md) — lock → prove → release  
- [../WHAT-YOU-GET.md](../WHAT-YOU-GET.md) — honest included / not-included list  
