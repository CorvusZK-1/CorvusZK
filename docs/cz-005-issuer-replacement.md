# CZ-005: replacing the demo credential signature (plan and status)

**Status:** in progress on a draft branch. Not reviewed. Not deployed anywhere. Test networks only.
See [SECURITY-NOTICE.md](../SECURITY-NOTICE.md) for the problem: the demo eligibility issuer's signature lets a
holder of one credential recover the issuer key.

## Choice of signature scheme

Rule: no new cryptography. Use a primitive that Midnight ships in both the Compact standard library (in-circuit
verify) and `@midnight-ntwrk/compact-runtime` (off-chain sign).

| Option | In-circuit verify | Off-chain signer | Notes |
| --- | --- | --- | --- |
| **JubJub Schnorr** (chosen first) | `jubjubSchnorrVerify` (stdlib, ledger 9, toolchain 0.34+) | `jubjubSchnorrSign`, `sampleJubjubSchnorrSk`, `jubjubSchnorrVerifyingKey` (compact-runtime 0.21) | Native embedded curve, Poseidon challenge. Rejects the identity key. Measured: `prove` proving key 49 MB vs 99 MB for the demo v2 circuit. |
| Ed25519 | `ed25519Verify` (stdlib, toolchain 0.35+) | Node `crypto.sign` (OpenSSL) | Most standard off-chain tooling and HSM support. SHA-512 runs in-circuit, so proving cost is expected to be much higher; not yet measured. |
| ECDSA P-256 | `secp256r1EcdsaVerify` | WebAuthn / HSM / Node | Fits passkey or cloud-KMS issuers. Not measured. |

JubJub Schnorr is implemented first because both halves come from Midnight's own libraries and it is cheaper to
prove. Ed25519 remains the fallback if the outside review prefers it or a real issuer needs HSM keys.

## What is on this branch

- `contracts/eligibility_v3.compact`: same gate as `eligibility_v2` (intent hash, credential nullifier, one
  escrow, prove then reveal). The hand-rolled signature check is replaced by
  `jubjubSchnorrVerify<1>(credentialMessage(...), signature(), issuerKey)`. The message is
  `degradeToTransient(persistentHash("corvuszk:elig:v3", credentialType, subjectCommit, expiry))`, exported as a
  pure circuit so the issuer signs exactly what the circuit checks.
- `midnight/eligibility.mjs`: `createIssuerV3`, `issueCredentialV3`, `verifyCredentialV3`, `credentialMessageV3`,
  and `runEligibility({ contractVersion: 3 })`.
- `midnight/managed/eligibility_v3`: compiled artifacts (Compact 0.36.0), reproducible with
  `scripts/compile-contracts.sh --check`.
- `test/adversarial/cz005-v3-signature.test.mjs`: valid credential proves; refused when the issuer key, expiry,
  credential type, holder, response or announcement is changed, when the signature is missing, or when the issuer
  key is the identity point. The CZ-005 key-recovery attack against v3 finds nothing.
- v1 and v2 are unchanged so the recorded demo and receipts stay valid; they stay labelled insecure.

## Finding for the review

The stdlib verifier takes the response as a `Field` and accepts `s + n` (n = JubJub group order) as well as `s`.
This does not let anyone forge or reuse a credential here (nullifiers come from the holder secret, not the
signature bytes), but nothing should use signature bytes as an identifier. A test records this as `KNOWN`.

## Remaining work

1. Point the strict releaser (`releaseStrict`, intent `circuitArtifactId`) and the SDK deploy/call helpers at
   `eligibility_v3`, keeping v2 for the demo.
2. Lifecycle tests on v3, and a Preprod run (deploy, prove, reveal, XRPL testnet release).
3. Issuer key custody, rotation and revocation (separate decision; needed before any non-test issuer).
4. Fix CZ-007 (expiry checked against a deploy-time `asOf`) in the same contract version if possible.
5. Outside cryptographic review. Only after that: lift the SDK's mainnet refusal and redeploy on mainnet.
