# CorvusZK security model

This section answers four questions as the code behaves today. There are two release paths. They do not give the same guarantee.

## 1. How are Midnight proofs connected to XRPL escrow conditions?

**Bound path.** `samplePreimage(role)` in `midnight/eligibility.mjs` samples 32 random bytes. The XRPL condition is the PREIMAGE-SHA-256 crypto-condition of those bytes (`five-bells-condition`). The Compact constructor stores `persistentHash("corvuszk:preimage:v1" || preimage)`, the escrow owner, the offer sequence, and the destination. It does not store the preimage. Owner and destination are the 20-byte XRPL account id in the first 20 bytes of a 32-byte value, with the rest zero. Sequence is a `Uint<32>`.

Who samples the preimage is a mode:

| Mode | Who may hold the preimage before `reveal()` | Who must be trusted not to finish early |
|---|---|---|
| `payer` (`createBoundPreimage()`, `samplePreimage('payer')`) | The payer. `publicTerms` still omits the preimage, but the payer's `holder` object has it. | The payer. The destination cannot finish until reveal, unless the payer shares the preimage. |
| `destination` (`samplePreimage('destination')`, the default of `npm run live:eligibility`) | The destination (policy party). `payerFacingTerms()` returns only the condition and the commitment. | The destination. The payer cannot finish early, because they never receive the preimage. |

In both modes the sampler can submit `EscrowFinish` before any Midnight proof. XRPL will accept a correct preimage. After `reveal()`, the preimage is public and anyone can finish; the destination is still the one fixed in `EscrowCreate`. The machine that submits `reveal()` also sees the preimage as a witness, which is after `prove()` has succeeded.

`prove()` checks the credential. `reveal()` then checks that hash and writes the preimage into `revealedPreimage`. `fulfillmentFromRevealedLedger` rebuilds the fulfillment from that field and checks that the caller names the same owner, sequence, destination, and condition. The fulfillment opens exactly one XRPL condition: SHA-256 of that preimage.

**Legacy path.** `createCryptoCondition()` returns both the condition and the fulfillment to the caller immediately. `verifyAndReleaseEscrow` submits that caller-supplied fulfillment after an application-side `backend.verify`. The deployed `condition` template stores an `escrowId` and a `released` flag. It does not hold or reveal the XRPL preimage. The Preprod end-to-end script used this shape: check Midnight, then submit a fulfillment the script already had.

XRPL links the two systems only through the crypto-condition. A Midnight contract address is not an XRPL condition.

## 2. How is verification handled?

| Check | Who verifies it | Where |
|---|---|---|
| Mock Schnorr credential, expiry, and non-zero escrow accounts | Compact circuit `eligibility.prove` | In-circuit (written for toolchain 0.31.1, now compiled with 0.36.0). Locally this is `compact-runtime`. On Preprod, `MidnightBackend.callEligibility({ circuit: 'prove' })` asks the local proof server to prove it and the node accepts the tx only if that proof verifies. |
| Preimage matches the commitment | Compact circuit `eligibility.reveal` | Same split: local runtime, or `callEligibility({ circuit: 'reveal' })` on Preprod. |
| Owner, sequence, destination, condition | `fulfillmentFromRevealedLedger` | TypeScript, against the ledger object the circuit returned. |
| Original three predicates | `MidnightBackend` via compiled circuits, or `LocalSimulationBackend` via an Ed25519 signature | Application. `submitOnChain` can also post a Preprod call for those three. |
| EscrowFinish fulfillment | XRPL | The ledger checks the preimage against the condition. It does not read Midnight. |

The eligibility signature is Schnorr on Compact's embedded curve, 96-bit scalars, challenge = first 12 bytes of `persistentHash` over the credential type, subject commitment, expiry, nonce point, and issuer point. It is not an XRPL transaction signature and not an XLS-70 credential signature.

`LocalSimulationBackend` sets `zk: false`. Treat a local eligibility run the same way for evidence: the constraints ran, a zero-knowledge proof was not produced.

## 3. How are replay attacks prevented?

On one eligibility contract instance:

- `prove()` requires `proven == false`, then sets `proven` and writes the nullifier. A second `prove()` on that state fails with `already proven`.
- `reveal()` requires `proven` and `preimageRevealed == false`. A second reveal fails.
- The nullifier is `persistentHash("corvuszk:escrow-null:v1", holderSecret, credentialType, owner, sequence, destination, preimageCommit)`. Changing the owner, sequence, destination, or preimage commitment changes the nullifier.
- `fulfillmentFromRevealedLedger` rejects a different owner, sequence, destination, or condition, including a blank nullifier.
- XRPL accepts `EscrowFinish` for a given owner and offer sequence once. The escrow is consumed.
- The revealed preimage satisfies only the condition created from that preimage.

What this does not do:

- There is no cross-contract nullifier set. A second deployment starts with `proven = false`. The same mock credential can be proved there. A different preimage commitment is a different XRPL condition, so that second proof does not finish the first escrow.
- Replaying a fulfillment against another escrow fails XRPL's condition check. Replaying it against the same escrow fails because the escrow is already finished or the sequence does not match.
- The legacy path has none of the eligibility nullifier. The caller already holds the fulfillment. `verifyAndReleaseEscrow` will not submit if its own backend rejects the proof, and any other submitter who has the fulfillment can finish the escrow anyway.

## 4. How are funds kept from release without the required proof?

On the bound path, a party who was not given the preimage cannot build a valid fulfillment until `reveal()` writes it, and `reveal()` requires a successful `prove()`. The helper will not return a fulfillment from an unrevealed ledger.

That is not XRPL-enforced proof verification. The sampler described in the table above already possesses a valid fulfillment and can submit `EscrowFinish` with no Midnight transaction. XRPL will accept a correct preimage. The XRP can still go only to the destination fixed in `EscrowCreate`, or back to the payer after `CancelAfter`.

`MidnightBackend.deployEligibility`, `callEligibility`, and `readEligibilityState` are the Preprod counterparts of the original templates' deploy and `callTx` path. `npm run live:eligibility` runs EscrowCreate, deploy, prove, reveal, an indexer read, and EscrowFinish. The checked-in tests do not execute that live flow. Prerequisites are in [docs/live-eligibility.md](live-eligibility.md).

On the legacy path, the SDK's proof check is in the submitting application. It is not a rule of the XRPL escrow. Possession of the fulfillment is enough to finish.

No path in this repository hides the XRPL amount, the payer account, or the destination account. Those fields are native escrow fields. The eligibility contract stores owner, sequence, and destination in public ledger state as well.

## What stays private, and what does not

| Stays off the public ledger until noted | Public |
|---|---|
| Holder secret | Issuer curve point, credential type, `asOf` |
| Subject commitment | Escrow owner, offer sequence, destination |
| Expiry, Schnorr nonce, scalar `s` | Preimage commitment, `proven`, nullifier |
| Release preimage | Release preimage after `reveal` |
| | XRPL amount, payer, destination, condition, finish time |

The nullifier does not publish the holder secret. It is stable for the same secret, credential type, escrow, and preimage commitment, so repeats of those inputs are linkable.


Back to the [README](../README.md).
