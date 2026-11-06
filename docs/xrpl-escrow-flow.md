# Proof-gated XRPL escrow, step by step

Goal: a buyer locks XRP so the seller gets it **only after** a private condition is proven on Midnight. Nobody, including CorvusZK, ever holds the funds.

```
Buyer wallet ──EscrowCreate(Condition)──▶ XRPL escrow (XRP locked, destination = seller)
                                               │
Attester ──attest() + ZK proof──▶ Midnight `condition` contract: released = true
                                               │
Releaser reads `released` from the Midnight indexer ──EscrowFinish(Fulfillment)──▶ XRP goes to seller
```

1. **Crypto-condition.** `createCryptoCondition()` makes a PREIMAGE-SHA-256 pair: the public `condition` and the secret `fulfillment`. Whoever holds the fulfillment can finish the escrow, so keep it with the releaser.
2. **Lock funds.** `createEscrow(client, buyer, { destination, amountXrp, condition, cancelAfterSec })`. XRPL itself enforces that the money can only go to `destination`, or back to the buyer after `CancelAfter`.
3. **Prove.** The attester calls `attest()` on the Midnight `condition` contract. Midnight only accepts the transaction if the zero-knowledge proof verifies, so `released` can only become `true` honestly.
4. **Check and release.** The releaser reads the contract's public state (`queryContractState`) and submits `EscrowFinish` with the fulfillment only if `released === true` (see `midnight/e2e-escrow.mjs`). With the simulation backend, `verifyAndReleaseEscrow()` does the same check against a signed attestation.
5. **Fallback.** If nothing is proven before `CancelAfter`, the buyer cancels and gets the XRP back.

## Trust model (honest)
- XRPL cannot read Midnight directly. The releaser (an app, the seller, or a small relayer) is trusted to check Midnight before using the fulfillment. It cannot send the money anywhere except the fixed destination, and it can't speed things up without a valid proof on Midnight being public for anyone to audit.
- Removing the releaser (e.g., XRPL-native proof verification or a multi-party relayer) is on the roadmap.

## Fees
- XRPL: a few drops per transaction plus the escrow reserve (returned when it closes).
- Midnight: paid in DUST, which a wallet generates from held NIGHT. No CorvusZK fee in this release.
