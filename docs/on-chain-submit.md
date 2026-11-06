# On-chain Midnight submit (Preprod)

How a staff engineer posts a **new** proof transaction (`callTx`: `attest` or `prove`) from the CorvusZK SDK.

**Testnet only.** Requires your own Blockfrost Preprod project, a local proof server, and a funded Preprod wallet with DUST. The SDK never stores seeds or fulfillments.

## What this does / does not do

| Does | Does not |
|---|---|
| `findDeployedContract` + `callTx` against an address in `midnight/deployments.preprod.json` | Redeploy the three templates |
| Fail fast if the wallet is not synced within `MN_SYNC_TIMEOUT_MS` (default 90s) | Multi-hour DUST wait / `ensure-pipeline.sh` |
| Fail fast if DUST is 0 or the proof server is down | Print seeds, Blockfrost ids, or contract secrets |
| Return public `txId` / `txHash` / `blockHeight` | Touch mainnet |

## Configure (env names only)

```bash
export BLOCKFROST_MIDNIGHT_PREPROD=…   # free Blockfrost "Midnight Preprod" project
export MIDNIGHT_PROOF_SERVER=http://localhost:6300
# optional:
export MN_SYNC_TIMEOUT_MS=90000
```

Wallet seeds live only in `midnight/.wallets.preprod.json` (gitignored). Contract demo salts for the Nov 3 Preprod deploy live in `midnight/.contract-secrets.preprod.json` (gitignored). Callers may pass their own witnesses instead.

## Proof server (self-hosted)

See [proof-server.md](proof-server.md). Short form:

```bash
docker run -p 6300:6300 midnightntwrk/proof-server:8.1.3 midnight-proof-server -v
```

## From the SDK

```ts
import { MidnightBackend, proveAgeOver } from 'corvuszk';

const backend = new MidnightBackend({
  blockfrostProjectId: process.env.BLOCKFROST_MIDNIGHT_PREPROD,
  mode: 'preprod',
});

// Local circuit prove/verify (no chain):
const proof = await proveAgeOver(backend, 1990, 18, 2026, 'my-salt');
await backend.verify(proof);

// On-chain callTx against the live Preprod contract (needs wallet + DUST + proof server):
const { txHash, proof: onChainProof } = await backend.submitOnChain({
  claim: proof.claim,
  witness: { kind: 'ageOver', birthYear: 1990, salt: 'my-salt' },
  // contractAddress optional — defaults to deployments.preprod.json
  syncTimeoutMs: 90_000,
});
```

**Note:** Witnesses for `submitOnChain` must match the commitment baked into that contract at deploy time. For a brand-new commitment, deploy a new contract with `midnight/deploy.mjs` first, then submit.

## CLI

```bash
cd midnight
# Dry run (no wallet open):
node submit-onchain.mjs --template age_over --dry-run

# Live submit (bounded sync):
node submit-onchain.mjs --template age_over
```

`condition` on the Nov 3 Preprod contract is already `released=true`, so a second `attest` will fail on-chain (by design). Prefer `age_over` or `balance_above` for a repeat demo call, or deploy a fresh contract.

## Errors you should expect

| Message | Meaning |
|---|---|
| missing blockfrostProjectId | Set `BLOCKFROST_MIDNIGHT_PREPROD` or pass `blockfrostProjectId` |
| proof server not reachable | Start Docker proof server on port 6300 |
| wallet did not sync within …ms | Raise `MN_SYNC_TIMEOUT_MS`, or restore/save `.wallet-state.*.preprod.json` |
| DUST balance is 0 | Register NIGHT for DUST via `deploy.mjs` / faucet path first |
| already released | Condition circuit already attested |
| commitment mismatch | Witness does not match the contract's public commitment |
