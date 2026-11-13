# Changelog

All dates are Pacific time. Testnet only throughout.

## Unreleased — Midnight Buildathon Wave 3 (Nov 2026)

- **12 Nov:** GitHub Actions CI: installs Compact 0.36.0, compiles all four contracts and checks the committed `midnight/managed/` artifacts match, builds the SDK, type-checks witnesses, runs the offline tests and local circuit runs; live XRPL testnet test as a best-effort job.
- **12 Nov:** Contract simulator tests (`test/templates.test.mjs`) for `condition`, `age_over`, `balance_above` (pass and refuse cases) and eligibility `prove`/`reveal` through typed witnesses.
- **12 Nov:** `midnight/witnesses.ts`: typed witness implementations for all four contracts.
- **12 Nov:** Full eligibility flow ran live on Preprod ledger 9 with an XRPL testnet escrow release ([receipts](receipts/ledger9-preprod-2026-11-12.md)); corvuszk.com/demo replay page and 72-second video.
- **12 Nov:** README rebuilt for reviewers (quick-start, contract table, architecture diagram, private vs public state). Security model moved to [docs/security-model.md](docs/security-model.md); alternatives and costs to [docs/alternatives-and-costs.md](docs/alternatives-and-costs.md).
- **11 Nov:** Upgraded to Midnight Preprod ledger 9 (Compact 0.36.0, Midnight.js 5.0.0, Wallet SDK 2.0.0, proof server 9.0.0); redeployed the three templates with one proof call each ([receipts](receipts/ledger9-preprod-2026-11-11.md)).
- **6 Nov:** `eligibility` contract (mock-issuer Schnorr check, one-time escrow-bound nullifier, prove → reveal); first live run on ledger 8 ([docs/live-run.md](docs/live-run.md)).

## 1.0.1 — 5 Nov 2026

- First public release: TypeScript SDK, `condition` / `age_over` / `balance_above` Compact templates, XRPL escrow helpers, Preprod deployments, landing page.
