# Changelog

All dates are Pacific time. Unaudited. Not for real value. The full eligibility + XRPL escrow release path has been proven on Midnight Preprod + XRPL testnet only.

## 1.1.0 — 27 Nov 2026

- Security fixes from the engineering review (CZ-001 to CZ-004, CZ-008): strict release in trusted policy party mode only, explicit evidence kinds, signed claims, strict Midnight verification, intent binding (IntentV2), one credential per escrow, payer-side default preimage holder. The SDK refuses mainnet release while the demo issuer is in use.
- [Security notice](SECURITY-NOTICE.md): the demo eligibility issuer is not secure (CZ-005); the mainnet `eligibility` instance must not be used with real value.
- End-to-end payment lifecycle tests (create, fund, prove, release, refund, timeout), run in CI.
- Unaudited. Not for real value.

## Earlier (Buildathon Wave 3) — Midnight Buildathon Wave 3 (Nov 2026)

- **27 Nov (draft, not reviewed, not deployed):** `eligibility_v3` replaces the demo credential signature with the Compact standard library's JubJub Schnorr verifier and compact-runtime's signer (CZ-005). v3 also fixes CZ-007 (expiry tied to block time through a one-day proof window), is wired into strict release and the SDK, and runs through the payment lifecycle tests. Plan: [docs/cz-005-issuer-replacement.md](docs/cz-005-issuer-replacement.md).
- **27 Nov:** End-to-end payment lifecycle tests (`test/lifecycle/`, `npm run test:lifecycle`, also part of `test:offline` and CI): create, fund, prove, release, refund and timeout paths. They use the real SDK, the compiled `eligibility_v2` circuit and real XRPL crypto-conditions against an in-memory XRPL ledger and a local Midnight read. No network and no real funds.
- **26 Nov:** [Security notice](SECURITY-NOTICE.md): the demo eligibility issuer's signature is not secure (a holder of one credential can recover the issuer key). The eligibility contract already deployed on Midnight mainnet (13 Nov 2026) uses that issuer and must not be used with real value. There is no known real-value use.
- **26 Nov:** P0 hardening for test networks: trusted policy party release mode, explicit evidence kinds (local runs no longer claim a zero-knowledge proof), signed claims, strict verification, intent binding, one credential per escrow, and a payer-side default preimage holder. The SDK refuses mainnet release while the demo issuer is in use.
- **13 Nov:** All four Compact contracts deployed on Midnight mainnet, each with one proof or attest call. The mainnet `eligibility` instance used the insecure demo issuer (placeholder XRPL accounts, no real escrow, no `reveal`) and must not be used with real value. Addresses and explorer links are in the README and in [`midnight/deployments.mainnet.json`](midnight/deployments.mainnet.json). Unaudited. Not for real value.
- **12 Nov:** GitHub Actions CI: installs Compact 0.36.0, compiles all four contracts and checks the committed `midnight/managed/` artifacts match, builds the SDK, type-checks witnesses, runs the offline tests and local circuit runs; live XRPL testnet test as a best-effort job.
- **12 Nov:** Contract simulator tests (`test/templates.test.mjs`) for `condition`, `age_over`, `balance_above` (pass and refuse cases) and eligibility `prove`/`reveal` through typed witnesses.
- **12 Nov:** `midnight/witnesses.ts`: typed witness implementations for all four contracts.
- **12 Nov:** Full eligibility flow ran live on Preprod ledger 9 with an XRPL testnet escrow release ([receipts](receipts/ledger9-preprod-2026-11-12.md)); corvuszk.com/demo replay page and 72-second video.
- **12 Nov:** README rebuilt for reviewers (quick-start, contract table, architecture diagram, private vs public state). Security model moved to [docs/security-model.md](docs/security-model.md); alternatives and costs to [docs/alternatives-and-costs.md](docs/alternatives-and-costs.md).
- **11 Nov:** Upgraded to Midnight Preprod ledger 9 (Compact 0.36.0, Midnight.js 5.0.0, Wallet SDK 2.0.0, proof server 9.0.0); redeployed the three templates with one proof call each ([receipts](receipts/ledger9-preprod-2026-11-11.md)).
- **6 Nov:** `eligibility` contract (mock-issuer Schnorr check, one-time escrow-bound nullifier, prove → reveal); first live run on ledger 8 ([docs/live-run.md](docs/live-run.md)).

## 1.0.1 — 5 Nov 2026

- First public release: TypeScript SDK, `condition` / `age_over` / `balance_above` Compact templates, XRPL escrow helpers, Preprod deployments, landing page.
