# Getting started with CorvusZK

Five-minute path for a TypeScript developer who wants **proof-gated XRPL escrow** without touching mainnet money. Node 22.18+ is required for the local Compact circuits and tests (Node 24 in CI). The SDK alone can run on Node 20+.

## What this is

CorvusZK is a **developer toolkit**, not a bank product and not a custodial wallet. Your app (or your user’s wallet) creates a normal XRPL crypto-condition escrow. CorvusZK proves a private claim on Midnight (age over N, balance above X, or a condition met), then your app finishes the escrow only if that proof verifies.

Funds never sit with CorvusZK. Secrets and fulfillments stay with the caller.

All four Compact contracts are live on Midnight mainnet (13 Nov 2026). Unaudited. Not for real value. The eligibility contract already deployed on Midnight mainnet uses the insecure demo issuer and must not be used with real value ([SECURITY-NOTICE.md](../SECURITY-NOTICE.md)). The full eligibility prove → reveal → XRPL EscrowFinish path has been proven on Midnight Preprod + XRPL testnet only. Addresses and explorer links are in the [README deployed-contracts table](../README.md#deployed-contracts).

## Before you use Midnight

- **You need NIGHT.** An XRPL builder who runs the Midnight half must hold some NIGHT so a wallet can generate DUST, which pays Midnight fees. There is no pay-with-XRP option. The offline backend needs none of this.
- **Network stage.** Per IO, Midnight mainnet is in a federated phase (checked 27 Nov 2026; re-check). Do not read it as a statement about how decentralized the network is.
- **XRPL privacy today.** XRPL Confidential Transfers exist but do not work with escrows and were not enabled on mainnet as of 27 Nov 2026.

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

This step needs the full repository, not the npm package. The npm package is lean (about 1.7 MB): it leaves out the Midnight proving keys (`*.prover`, about 200 MB) and `midnight/package.json`. The small verifier keys are included. To run real circuits or prove on Midnight:

```bash
git clone https://github.com/CorvusZK-1/CorvusZK && cd CorvusZK
npm ci && (cd midnight && npm ci)
npm run simulate
```

The proving keys are in `midnight/managed/*/keys/` in the repository. You can also regenerate them with `npm run compile:contracts` (needs the Compact toolchain).

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

- [templates.md](templates.md) — the four Compact contracts in plain words  
- [xrpl-escrow-flow.md](xrpl-escrow-flow.md) — lock → prove → release  
- [../WHAT-YOU-GET.md](../WHAT-YOU-GET.md) — honest included / not-included list  
