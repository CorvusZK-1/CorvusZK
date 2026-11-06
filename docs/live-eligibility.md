# Live eligibility flow (Preprod + XRPL testnet)

`npm run live:eligibility` does one fresh run:

1. The destination samples the XRPL preimage (`PREIMAGE_MODE=payer` selects the payer instead).
2. The payer submits XRPL testnet `EscrowCreate` with that condition. The payer is not given the preimage.
3. `MidnightBackend.deployEligibility` deploys `contracts/eligibility.compact` on Midnight Preprod.
4. `callEligibility({ circuit: 'prove' })` then `callEligibility({ circuit: 'reveal' })`.
5. `readEligibilityState` waits until the indexer shows `preimageRevealed`.
6. The destination submits `EscrowFinish` using the preimage read from that state.

The script prints transaction hashes, explorer links, and fee fields copied from the XRPL and Midnight receipts. It does not print seeds, the Blockfrost project id, the preimage, or the holder secret. It does not write wallets or `deployments.preprod.json`.

This command is for a machine you control. It is not run by the unit tests.

## Prerequisites

1. Node 20+.
2. From the repo root: `npm ci`. From `midnight/`: `npm ci`.
3. A local proof server on port 6300:

```bash
docker run --rm -p 6300:6300 midnightntwrk/proof-server:8.1.3 midnight-proof-server -v
```

Health check: `curl -s http://localhost:6300/` should return JSON with `"status":"ok"`. See [proof-server.md](proof-server.md). Whoever runs this server sees the prove and reveal witnesses, including the preimage at reveal time. That is after `prove()` has succeeded.

4. `BLOCKFROST_MIDNIGHT_PREPROD` set to your Blockfrost Midnight Preprod project id. It is sent as a query parameter and is never printed.
5. `midnight/.wallets.preprod.json` (gitignored), the same deployer wallet `midnight/deploy.mjs` uses, with NIGHT registered for DUST. This script does not register DUST and does not wait for a faucet. If DUST is 0 it stops.
6. Outbound access to the XRPL testnet faucet (`faucet.altnet.rippletest.net`) and `wss://s.altnet.rippletest.net` or `XRPL_TESTNET_WSS`. The script funds two throwaway testnet accounts in memory and discards the seeds.

## Command

```bash
export BLOCKFROST_MIDNIGHT_PREPROD=…   # do not commit this
export MIDNIGHT_PROOF_SERVER=http://localhost:6300   # optional; this is the default
# optional:
# export PREIMAGE_MODE=destination     # default. Use payer to sample as the payer.
# export MN_SYNC_TIMEOUT_MS=90000
# export ELIGIBILITY_INDEXER_WAIT_MS=180000
# export XRPL_ESCROW_XRP=20
npm run live:eligibility
```

`npm run live:eligibility` builds `dist/` and then runs `midnight/live-eligibility.mjs`.

## What the fees mean

XRPL `feeDrops` / `feeXrp` are the `Fee` field on that submit receipt, when the receipt includes it. Midnight `fees.paidFees` and `fees.estimatedFees` are the strings on the Midnight finalization receipt, when that object includes `fees`. A null field means the receipt did not carry it. These are not a savings comparison.

## Trust for this command

`PREIMAGE_MODE=destination` (default): trust the destination not to finish the escrow before the proof. The payer cannot. `PREIMAGE_MODE=payer`: trust the payer not to finish before the proof. The destination cannot, unless the payer shares the preimage. Details are in the README security model.
