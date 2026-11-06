# Security notes for CorvusZK

## Non-custodial by design

- CorvusZK never holds user funds. XRP locked for a deal sits in a **native XRPL escrow** created by the payer’s own wallet, with a fixed destination.
- The SDK never stores private keys, seed phrases, or crypto-condition fulfillments. Callers pass them in; nothing is persisted by the library.
- Private witnesses (birth year, balance, secrets) are passed into prove helpers and must not be placed on `Proof.claim`.

## Secrets that must never be committed

Do not put any of the following in git, buyer zips, landing pages, or screenshots:

- `.wallets*.json`, `.wallet-state*`, `.contract-secrets*`, `.keys*`, `.xrpl-e2e-keys*`
- Blockfrost / indexer project IDs or API tokens (use env vars such as `BLOCKFROST_MIDNIGHT_PREPROD`)
- `midnight/midnight-level-db/`, proof-server logs with credentials
- `.env` files

See `.gitignore`. If a secret is ever committed, rotate it immediately.

## Honest limits

- This release is **testnet / Midnight Preprod only**. Not audited. Not mainnet-ready.
- `LocalSimulationBackend` is **not** zero-knowledge; it is a signed local attestation for development.
- Compact `persistentHash` commitments and simulation SHA-256 commitments are not interchangeable.
- Issuer-linked age/balance (real KYC issuer signing a commitment) is not shipped yet.

## Reporting

If you find a vulnerability in CorvusZK, email the maintainer privately before public disclosure. Do not open a public issue that includes secrets or exploit payloads against live wallets.
