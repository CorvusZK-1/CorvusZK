# CorvusZK

Non-custodial TypeScript SDK and Compact templates for **proof-gated XRPL escrows** and **privacy claims** (balance above X, age over N, condition met), designed for Midnight + XRPL.

- Never holds or moves user funds. XRP sits in a native XRPL escrow created by the payer's own wallet, and it can only go to the escrow's fixed destination.
- Never stores keys or fulfillments.
- **Testnet only** in this release (Midnight Preprod + XRPL testnet).

**Buyer brief:** see [WHAT-YOU-GET.md](WHAT-YOU-GET.md) for an honest included / not-included checklist.

**For sale (open to offers):** this project is available for acquisition. Asking price and inquiries: [CorvusZK on SideProjectors](https://www.sideprojectors.com/project/108662). A private Agent Ledger add-on (AI agent permission proofs plus a kill switch) is available to buyers of the project as an optional bundle; it is not part of this public repository.

## For Buildathon judges

CorvusZK is a developer integration prototype. It is not a new settlement chain and it is not a trustless cross-chain bridge. It connects Compact predicates to a standard XRPL escrow. Current public chain examples for the original three templates are Midnight Preprod and XRPL testnet. The eligibility contract is compiled in this tree. A fresh Preprod deploy is `npm run live:eligibility` on a machine with Blockfrost credentials and a local proof server. The 3 Nov deployment manifest does not include it.

**Midnight Preprod ledger 9, Nov 11 2026:** after Midnight's 9 Nov Preprod upgrade, the three original templates were recompiled with Compact 0.36.0, redeployed, and each ran a zero-knowledge proof call on Preprod (testnet). Receipts and explorer links: [receipts/ledger9-preprod-2026-11-11.md](receipts/ledger9-preprod-2026-11-11.md). The eligibility template and the XRPL escrow release below were last run live on Nov 6, on ledger 8, and have not been re-run on ledger 9.

**Live testnet run, Nov 6 2026 (ledger 8):** [docs/live-run.md](docs/live-run.md) ([receipts](docs/live-run-receipts.json)). Destination-sampled preimage, Preprod deploy, prove, reveal, indexer read, and XRPL testnet `EscrowFinish` `tesSUCCESS`. Fees in that note are this run's receipts only.

### Why XRPL plus Midnight

XRPL contributes native escrow and a payments-focused settlement rail. Midnight contributes programmable private predicates. Value stays in the payer's native escrow. Sensitive witness inputs are not XRPL transaction fields. The amount, the accounts, and the settlement timing on XRPL stay visible. XRPL does not verify a Midnight proof. See [Security model](#security-model) for the two release paths and what each one actually enforces.

### Privacy

Witnesses (holder secret, subject commitment, expiry, Schnorr nonce and scalar, and the release preimage until `reveal`) stay off the Compact ledger. After `reveal`, the preimage is public. The public nullifier is a hash of the holder secret, credential type, escrow owner, offer sequence, destination, and preimage commitment. It is a one-time tag for that contract, not the holder's identity. XRPL still publishes the escrow amount, payer, destination, and finish time.

### Midnight integration

| Piece | What it is |
|---|---|
| `contracts/condition.compact`, `age_over.compact`, `balance_above.compact` | Predicates compiled with Compact 0.36.0 (ledger 9). Redeployed on Preprod ledger 9 on 11 Nov 2026 (ledger 8 deploy 3 Nov kept as history). Addresses in `midnight/deployments.preprod.json`. |
| `contracts/eligibility.compact` | Mock-issuer Schnorr check plus one-time escrow binding. Local tests plus the [Nov 6 live run](docs/live-run.md). |
| `MidnightBackend` | Runs the three original circuits. `local-circuits` executes them on this machine. `submitOnChain` posts a Preprod `callTx` for those three. `deployEligibility` / `callEligibility` / `readEligibilityState` cover eligibility. |
| `LocalSimulationBackend` | Ed25519 attestation. Not a zero-knowledge proof. |

The eligibility issuer is created in-process and labeled `MOCK ISSUER`. It is not a regulated KYC or accreditation provider. Field names follow XRPL Credentials (XLS-70) vocabulary. Subject is a commitment, not an account id. No `CredentialCreate` is submitted. Compact toolchain 0.31.1 has no in-circuit Ed25519 or ECDSA verify (`ed25519Verify` is not in that standard library). The circuit verifies Schnorr on the embedded curve exposed by `ecMul` / `ecMulGenerator`, with 96-bit scalars so `s = k + e*sk` does not wrap. That is a demonstration parameter.

Regulated KYC, credit, and compliance providers are still prospective. This prototype does not authenticate them.

### How to run and what counts as evidence

1. Read the status table and [Security model](#security-model). `LocalSimulationBackend` is not zero-knowledge. `npm run example:eligibility` is local circuit execution, not a Preprod transaction.
2. Reproduce compilation with compiler **0.36.0** (language 0.28.0, compact-runtime 0.21.0, ledger 9):

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
export PATH="$HOME/.local/bin:$PATH"
compact update 0.36.0
compact compile contracts/condition.compact midnight/managed/condition
compact compile contracts/age_over.compact midnight/managed/age_over
compact compile contracts/balance_above.compact midnight/managed/balance_above
compact compile contracts/eligibility.compact midnight/managed/eligibility
```

On 11 Nov 2026, `compact compile` 0.36.0 returned exit code 0 for all four (eligibility needed its `sigS` witness typed `JubjubScalar` to avoid a 0.36.0 zkir panic). On 6 Nov 2026, the earlier 0.31.1 compile returned exit code 0 for all four, including proving keys. Compiling the original three into the `midnight/managed/<template>` layout matched the committed artifacts byte for byte. Compiling them into an unrelated directory matched every file except `contract/index.js.map`, where `sourceRoot` follows the output path (`../../../../` in this layout, empty otherwise).

3. Run `npm run demo:offline`, `npm run example:offline`, and `cd midnight && npm ci && npm run simulate` from the repo root (`npm run simulate`). Local circuit execution is not a new on-chain proof transaction.
4. Run `npm run example:eligibility` after `cd midnight && npm ci`. It prints the mock credential, the public ledger, the refusal before `reveal`, and the fulfillment taken from revealed state. It does not submit XRPL or Midnight transactions.
5. Read `midnight/deployments.preprod.json` and [docs/on-chain-submit.md](docs/on-chain-submit.md). Match the recorded transaction hashes to public receipts if you want chain evidence. No new paid transaction is required. Those receipts are for the original three templates, not for `eligibility`.
6. A holder of a valid fulfillment can submit `EscrowFinish`. The bound path withholds that preimage from the releaser until the circuit reveals it. The party who created the preimage already has it. Details are in the security model.

### Wave 3 record

Public publication commit `035c80455fe5403e21bbd33cd21d5dfb5efe75f9` (5 Nov 2026, 16:44 PST). `midnight/deployments.preprod.json` records Compact deployments at 2026-11-04T01:02Z (3 Nov 2026 PST) and an SDK `age_over` submit at 2026-11-05T11:00:51Z (5 Nov 2026 PST). Those timestamps support investigation. They do not by themselves prove every feature-development date. The public git history starts with the 5 Nov 2026 commits. https://corvuszk.com returned HTTP 200 on 6 Nov 2026 (GitHub Pages). https://corvuszk-1.github.io/CorvusZK/ redirected there. See [docs/buildathon/wave3-progress.md](docs/buildathon/wave3-progress.md).

### Costs

No numeric savings claim. A 6 Nov 2026 preparation note did not obtain measured CorvusZK XRPL receipt fees or Midnight declared DUST proof-call fees. A read-only JSON-RPC request to the public XRPL testnet endpoint failed with SSL `UNEXPECTED_EOF_WHILE_READING`. No transaction was submitted for that measurement. Do not label the reference figures below as CorvusZK measurements.

Official XRPL reference values, from https://xrpl.org/docs/concepts/transactions/transaction-cost :

- Standard transaction fee: 10 drops = 0.000010 XRP, before load scaling.
- Conditional `EscrowFinish` with a 32-byte preimage: 350 drops = 0.000350 XRP.
- Illustrative two-transaction sum: 360 drops = 0.000360 XRP. This is not an observed CorvusZK total. Account and escrow reserves are separate.

Midnight, from https://docs.midnight.network/guides/manage-dust :

- The Preprod proof-call DUST fee was not obtained. The deployment manifest has transaction ids and balances, not a per-transaction fee. Balance differences are not fee measurements, because DUST keeps generating.
- Documented units: 1 DUST = 10^15 SPECK; 1 NIGHT = 10^6 STAR. A documented parameter example gives 1 NIGHT a capacity of 5 DUST, about one week to the cap, and 1,000 NIGHT generating 0.008267 DUST/second. Parameters are network-specific and can change.
- The manifest records generation of 2,480,100,000,000,000 SPECK/minute (2.4801 DUST/minute). That is a recorded generation rate, not a proof-call fee, and it was not re-measured here.
- DUST is a non-transferable fee resource. Registering eligible NIGHT outputs enables generation. Spending the backing NIGHT starts decay of the associated old DUST. Fees consume DUST. Holding NIGHT has a capital cost.
- There is no supported numeric savings comparison with Ethereum L1. That would need a comparable verifier gas receipt, contemporaneous base and priority fees, an exchange rate, a measured Midnight fee, proving compute, and reserve assumptions.

### Why CorvusZK vs alternatives

Choose CorvusZK when the integration target is an existing TypeScript XRPL application, settlement should remain in a standard native escrow, and the team wants to prototype Midnight-backed private predicates without operating a new settlement ledger. The concrete surface is three claim templates, one eligibility template, a TypeScript backend interface, and an application-side or circuit-revealed path into `EscrowFinish`. That is an integration choice. It is not evidence of stronger security, lower total cost, or production readiness.

- **XRPL Credentials (XLS-70), DID, and Permissioned Domains.** Prefer these for trusted-issuer status and protocol-supported access control when that meets the requirement. Credentials already keep underlying identity documents off-chain. A DID identifies a controller. It does not by itself prove an age or a balance. CorvusZK's eligibility circuit checks a mock Schnorr credential over a subject commitment. It does not yet check an issuer-backed XRPL Credential object. The approaches can be combined. [1–3]
- **Hooks on Xahau.** Prefer Hooks for custom on-ledger account policy and autonomous actions on Xahau. CorvusZK's demonstrated settlement is standard XRPL testnet escrow, with Midnight for the predicate. It does not provide equivalent ledger-enforced account policy. Hooks' WASM execution is not, by itself, a zero-knowledge privacy system. [4]
- **Boundless / RISC Zero Smart Escrows.** This is the closest technical alternative. Its starter embeds proof verification in an escrow finish function on a Smart Escrow devnet. That is a stronger ledger-enforced proof-to-release binding than CorvusZK's application-checked path and stronger than the eligibility path, because XRPL still does not verify the Compact proof. CorvusZK targets ordinary native escrow plus Compact and TypeScript, without that special network. Both need test-network qualifications. Neither source establishes a CorvusZK mainnet advantage. [5–6]
- **Other Midnight Buildathon work.** Mask is a private checkout and invoice product with a documented wallet and shielded-payment flow. Senyap is a private recommendation market with documented multi-party workflows. "Uses Midnight" or "has a demo" is not a difference in kind. CorvusZK's narrower proposition is reusable XRPL-escrow integration. Mask can hide more of the payment inside its Midnight design. CorvusZK's XRPL amount, accounts, and timing stay public. Those descriptions are author-reported. This note does not audit them. [7–9]

Do not choose the current prototype if you need XRPL-enforced Midnight proof checks, private XRP amounts or counterparties, a regulated KYC credential, audited production security, or a measured lower operating cost.

| Approach | Prefer it for | CorvusZK distinction |
|---|---|---|
| XRPL Credentials / DID / Domains | Issuer status and ledger access policy | Private witness predicates. Issuer truth is not an XRPL Credential object. |
| Xahau Hooks | Ledger-enforced custom account logic | Ordinary XRPL escrow plus Midnight. Release policy is not an XRPL rule. |
| Boundless Smart Escrows | Proof verification inside escrow finish on a special devnet | Compact and TypeScript on ordinary escrow. Weaker proof-to-release enforcement. |
| Mask / Senyap | Complete private-payment or recommendation applications | Reusable XRPL integration component, with public escrow fields. |

Sources: [1](https://xrpl.org/docs/concepts/decentralized-storage/credentials) [2](https://xrpl.org/docs/concepts/decentralized-storage/decentralized-identifiers) [3](https://xrpl.org/docs/concepts/tokens/decentralized-exchange/permissioned-domains) [4](https://xahau.network/docs/hooks/) [5](https://github.com/boundless-xyz/xrpl-boundless-starter/blob/main/README.md) [6](https://www.xrpl-commons.org/newsroom/xrpl-gets-on-chain-privacy-via-zkp-introducing-boundless-on-xrpl) [7](https://github.com/pratiikpy/mask-midnight/blob/main/README.md) [8](https://github.com/scientivan/senyap/blob/main/README.md) [9](https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG). Mask and Senyap appear in participant discussion. This note does not establish their current Wave 3 entry status.

## Security model

This section answers four questions as the code behaves today. There are two release paths. They do not give the same guarantee.

### 1. How are Midnight proofs connected to XRPL escrow conditions?

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

### 2. How is verification handled?

| Check | Who verifies it | Where |
|---|---|---|
| Mock Schnorr credential, expiry, and non-zero escrow accounts | Compact circuit `eligibility.prove` | In-circuit (written for toolchain 0.31.1, now compiled with 0.36.0). Locally this is `compact-runtime`. On Preprod, `MidnightBackend.callEligibility({ circuit: 'prove' })` asks the local proof server to prove it and the node accepts the tx only if that proof verifies. |
| Preimage matches the commitment | Compact circuit `eligibility.reveal` | Same split: local runtime, or `callEligibility({ circuit: 'reveal' })` on Preprod. |
| Owner, sequence, destination, condition | `fulfillmentFromRevealedLedger` | TypeScript, against the ledger object the circuit returned. |
| Original three predicates | `MidnightBackend` via compiled circuits, or `LocalSimulationBackend` via an Ed25519 signature | Application. `submitOnChain` can also post a Preprod call for those three. |
| EscrowFinish fulfillment | XRPL | The ledger checks the preimage against the condition. It does not read Midnight. |

The eligibility signature is Schnorr on Compact's embedded curve, 96-bit scalars, challenge = first 12 bytes of `persistentHash` over the credential type, subject commitment, expiry, nonce point, and issuer point. It is not an XRPL transaction signature and not an XLS-70 credential signature.

`LocalSimulationBackend` sets `zk: false`. Treat a local eligibility run the same way for evidence: the constraints ran, a zero-knowledge proof was not produced.

### 3. How are replay attacks prevented?

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

### 4. How are funds kept from release without the required proof?

On the bound path, a party who was not given the preimage cannot build a valid fulfillment until `reveal()` writes it, and `reveal()` requires a successful `prove()`. The helper will not return a fulfillment from an unrevealed ledger.

That is not XRPL-enforced proof verification. The sampler described in the table above already possesses a valid fulfillment and can submit `EscrowFinish` with no Midnight transaction. XRPL will accept a correct preimage. The XRP can still go only to the destination fixed in `EscrowCreate`, or back to the payer after `CancelAfter`.

`MidnightBackend.deployEligibility`, `callEligibility`, and `readEligibilityState` are the Preprod counterparts of the original templates' deploy and `callTx` path. `npm run live:eligibility` runs EscrowCreate, deploy, prove, reveal, an indexer read, and EscrowFinish. The checked-in tests do not execute that live flow. Prerequisites are in [docs/live-eligibility.md](docs/live-eligibility.md).

On the legacy path, the SDK's proof check is in the submitting application. It is not a rule of the XRPL escrow. Possession of the fulfillment is enough to finish.

No path in this repository hides the XRPL amount, the payer account, or the destination account. Those fields are native escrow fields. The eligibility contract stores owner, sequence, and destination in public ledger state as well.

### What stays private, and what does not

| Stays off the public ledger until noted | Public |
|---|---|
| Holder secret | Issuer curve point, credential type, `asOf` |
| Subject commitment | Escrow owner, offer sequence, destination |
| Expiry, Schnorr nonce, scalar `s` | Preimage commitment, `proven`, nullifier |
| Release preimage | Release preimage after `reveal` |
| | XRPL amount, payer, destination, condition, finish time |

The nullifier does not publish the holder secret. It is stable for the same secret, credential type, escrow, and preimage commitment, so repeats of those inputs are linkable.

## Who it is for

TypeScript builders shipping **small XRPL apps** that need a private yes/no before releasing escrowed XRP — age gates, proof-of-funds style checks, or “condition met” attestations — without becoming a custodial wallet or a bank. Not a bank product; not mainnet-ready yet.

Start here: [docs/getting-started.md](docs/getting-started.md) · buyer checklist: [WHAT-YOU-GET.md](WHAT-YOU-GET.md)


## Status (honest)
| Part | State |
|---|---|
| XRPL testnet escrow create/finish | Works (integration test) |
| `LocalSimulationBackend` | Works. **Not zero-knowledge**: a signed attestation for dev/testing |
| Compact templates (`condition`, `balance_above`, `age_over`) | Compile with Compact 0.36.0 (ledger 9), proving keys generated. Live on Preprod ledger 9 (redeployed 11 Nov 2026); ledger 8 deployments (3 Nov) kept as history. |
| `eligibility` (mock issuer + escrow nullifier) | Compiles with Compact 0.36.0. Local circuit tests pass. `MidnightBackend.deployEligibility` / `callEligibility` / `readEligibilityState` and `npm run live:eligibility` can deploy a fresh Preprod instance. Not in the 3 Nov manifest. Not an XRPL Credential. |
| Midnight Preprod deploy + proof-gated escrow (`midnight/`) | **Live on Preprod ledger 9 (11 Nov 2026)**: condition `b6f78efb…4df3` (attest tx `c974a56e…847f`), age_over `838bb8f2…a16f` (prove tx `fb86e253…da89`), balance_above `7eab3360…284b` (prove tx `e1416870…bd4f`); the XRPL escrow release was not re-run on ledger 9. Earlier ledger 8 run (3 Nov 2026): condition `45563d2e…52f5` (attest tx `311bfb85…7eda`), age_over `3458e155…2367`, balance_above `8606a637…6c0c`; XRPL testnet EscrowFinish `A289E64F…40AE` released after the proof. Scripts: `ensure-pipeline.sh` syncs a wallet, registers DUST, deploys the 3 templates, runs `attest`, then releases an XRPL escrow (`e2e-escrow.mjs`) |
| `MidnightBackend` class in the SDK | **Wired**: `prove` / `verify` run compiled Compact circuits via `midnight/sdk-bridge.mjs`. Default `mode: 'local-circuits'` needs no wallet sync. `mode: 'preprod'` attaches live contract addresses. **`submitOnChain`** posts a new Preprod `callTx` (attest/prove) through the same bridge (bounded sync, no redeploy). CLI: `midnight/submit-onchain.mjs`. See [docs/on-chain-submit.md](docs/on-chain-submit.md) |

## Quickstart (5 minutes, no money needed)
Requires Node 20+.
```bash
npm install && npm run build
npm run demo:offline   # no network: the 3 claims, passing and refused cases
npm run example:offline # same idea as a copy-pasteable examples/ script
npm run example:eligibility # local mock-issuer circuit and revealed fulfillment (needs: cd midnight && npm ci)
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
Judges: start at [For Buildathon judges](#for-buildathon-judges) and [Security model](#security-model). Pitch deck, demo script, and Wave 3 progress: [docs/buildathon/](docs/buildathon/).
