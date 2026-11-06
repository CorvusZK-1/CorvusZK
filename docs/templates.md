# The three proof templates, in plain words

Each template is a small Midnight smart contract written in Compact (`contracts/*.compact`).
The pattern is always the same:

1. **Set up (public):** someone deploys the contract with a public rule (for example "18 or older as of 2026") and a *commitment*, a fingerprint of the private fact made with a random salt. The fingerprint reveals nothing by itself.
2. **Prove (private):** the person who knows the fact runs the circuit on their own machine. Their private data (birth year, balance, secret) is fed in as a *witness* and never leaves the machine. The local proof server turns it into a zero-knowledge proof.
3. **Check (public):** the Midnight network accepts the transaction only if the proof is valid. The contract then flips a public flag (`proven` or `released`) that anyone, including an XRPL app, can read.

| Template | Public on chain | Stays private | Fails when |
|---|---|---|---|
| `condition` | `attesterCommit`, `escrowId`, `released` | the attester's secret, the "delivered?" answer | wrong secret, condition not met, already released |
| `age_over` | `minAge`, `asOfYear`, `birthCommit`, `proven` | birth year, salt | birth year doesn't match the commitment, or under age |
| `balance_above` | `threshold`, `balanceCommit`, `proven` | balance, salt | balance doesn't match the commitment, or not above threshold |

## condition — "the agreed thing happened"
Use it to gate a payment on a private yes/no from a named attester (a courier, an inspector, an oracle).
- Constructor: `(commit = persistentHash(attesterSecret), escrowId)`. `escrowId` ties the contract to one XRPL escrow (Owner + OfferSequence).
- Circuit `attest()`: checks the caller knows the secret behind `commit`, checks `deliveryOk()` is true, sets `released = true`. It can only succeed once.

## age_over — "I'm at least N years old"
- Constructor: `(minAge, asOfYear, birthCommit = persistentHash([salt, birthYear]))`.
- Circuit `prove()`: checks the private birth year matches the commitment, then `birthYear + minAge <= asOfYear`. Sets `proven = true`.
- Use: age-gated sales, KYC-light onboarding, without storing dates of birth.

## balance_above — "I hold more than X"
- Constructor: `(threshold, balanceCommit = persistentHash([salt, balance]))`.
- Circuit `prove()`: checks the private balance matches the commitment and is `> threshold`. Sets `proven = true`.
- Use: proof of funds for a deal, allow-lists, credit-style checks, without showing the real number.

## Limits to know
- A commitment only proves the number is the one *committed to*. Someone trusted (a bank, an exchange, an ID issuer) must sign or publish the commitment for it to mean "real" balance/age. That issuer link is the next feature, not in this release.
- `asOfYear` is set at deploy time, not read from a clock.
- The JS `LocalSimulationBackend` uses SHA-256 commitments; the Compact templates use `persistentHash`. They are not interchangeable yet.
- Testnet (Preprod) only. Not audited.

## Try them with no chain and no money
```bash
cd midnight && npm ci && node simulate.mjs
```
This runs the real compiled circuits locally and shows a valid case passing and bad cases being rejected.
