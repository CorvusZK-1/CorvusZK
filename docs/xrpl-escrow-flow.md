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

## Bound path (eligibility)
`midnight/eligibility.mjs` is a second path, for one escrow per contract:

1. Setup samples the preimage, builds the XRPL PREIMAGE-SHA-256 condition, and keeps the fulfillment. The contract stores the hash of the preimage plus owner, offer sequence, and destination.
2. `prove()` checks the mock credential once and writes the escrow nullifier.
3. `reveal()` publishes the preimage only after that.
4. The releaser calls `fulfillmentFromRevealedLedger` with the same owner, sequence, destination, and condition. A mismatch throws.
5. A second `prove()` on the same contract state fails. XRPL still finishes that escrow only once.

The setup party already knows the preimage and can finish without step 3. XRPL does not check the Compact proof. A new contract instance starts unused. There is no global nullifier registry.

The diagram at the top of this page is the legacy path. Its `condition` template does not reveal the preimage and does not store this nullifier.

## Trust model (honest)
- XRPL cannot read Midnight. On the legacy path, whoever holds the fulfillment can finish the escrow. The application's `verify` call is not an XRPL rule. Funds can still go only to the fixed destination.
- On the bound path, a releaser who never received the preimage has to wait for `reveal()`. The setup party does not.
- Full write-up: the README [Security model](../README.md#security-model).

## Fees
- XRPL: a few drops per transaction plus the escrow reserve (returned when it closes).
- Midnight: paid in DUST, which a wallet generates from held NIGHT. No CorvusZK fee in this release.
