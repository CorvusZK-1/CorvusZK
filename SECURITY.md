# Security notes for CorvusZK

## Security notice (26 Nov 2026)

The eligibility demo issuer's signature is **not secure**. Anyone who holds one demo credential can recover the issuer's signing key. The eligibility contract already deployed on Midnight mainnet (13 Nov 2026) uses that insecure demo issuer and must not be used with real value. There is no known real-value use. Full notice: [SECURITY-NOTICE.md](SECURITY-NOTICE.md). Contact: cory.raven1@gmail.com.

## Non-custodial by design

- CorvusZK never holds user funds. XRP locked for a deal sits in a **native XRPL escrow** created by the payer’s own wallet, with a fixed destination.
- The SDK never stores private keys, seed phrases, or crypto-condition fulfillments. Callers pass them in; nothing is persisted by the library.
- Private witnesses (birth year, balance, secrets) are passed into prove helpers and must not be placed on `Proof.claim`.

## Secrets that must never be committed

Do not put any of the following in git, release zips, landing pages, or screenshots:

- `.wallets*.json`, `.wallet-state*`, `.contract-secrets*`, `.keys*`, `.xrpl-e2e-keys*`
- Blockfrost / indexer project IDs or API tokens (use env vars such as `BLOCKFROST_MIDNIGHT_PREPROD`)
- `midnight/midnight-level-db/`, proof-server logs with credentials
- `.env` files

See `.gitignore`. If a secret is ever committed, rotate it immediately.

## Honest limits

- The four Compact contracts are live on **Midnight mainnet** (13 Nov 2026). Unaudited. Not for real value. The full eligibility + XRPL escrow release path (prove, reveal, and EscrowFinish) has been proven on Midnight Preprod + XRPL testnet only. The mainnet `eligibility` contract uses the insecure demo issuer and must not be used with real value (no real XRPL escrow, no `reveal`). See [SECURITY-NOTICE.md](SECURITY-NOTICE.md).
- `LocalSimulationBackend` is **not** zero-knowledge; it is a signed local attestation for development.
- Compact `persistentHash` commitments and simulation SHA-256 commitments are not interchangeable.
- `contracts/eligibility.compact` checks a **mock** in-process credential signature and records a one-time nullifier bound to escrow owner, offer sequence, destination, and preimage commitment. That signature is not secure (see [SECURITY-NOTICE.md](SECURITY-NOTICE.md)). It is not a regulated KYC credential, and not an XRPL Credential (XLS-70) ledger object. A fresh instance is deployed per escrow on Preprod by `npm run live:eligibility` (last run 12 Nov 2026). See the README security model.
- The party who samples the XRPL preimage can still submit `EscrowFinish` without a Midnight proof. XRPL does not verify Compact proofs.
- `age_over` and `balance_above` still prove a committed number. They do not authenticate an issuer.
- There is no cross-contract nullifier registry. One-time use is the `proven` and `preimageRevealed` flags on that contract instance.

## Reporting

If you find a vulnerability in CorvusZK, report it privately through this repository's [Security Advisories](https://github.com/CorvusZK-1/CorvusZK/security/advisories/new) (Security → Report a vulnerability). Do not open a public issue that includes secrets or exploit payloads against live wallets.
