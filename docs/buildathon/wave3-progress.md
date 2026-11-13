# CorvusZK - progress during Midnight Buildathon Wave 3

Wave window: opened 2 Nov 2026; AKINDO submit deadline Mon 30 Nov 2026, 7:00 AM PT (15:00 UTC).  
This is a first Wave 3 submission (no prior Wave 1/2 CorvusZK entry).

## What we built in this Wave
1. **Compact + Preprod.** Deployed three templates (`condition`, `age_over`, `balance_above`) on Midnight Preprod with real ZK proofs. Attest and `submitOnChain` verified (example age_over tx `744ecf07…5952`, block 3290220).  
2. **XRPL escrow gate.** End-to-end testnet path: native escrow create → Midnight proof → `EscrowFinish` only after verify (EscrowFinish example `A289E64F…40AE`).  
3. **SDK.** `MidnightBackend` prove/verify via `midnight/sdk-bridge.mjs`; local-circuits and preprod modes; CLI `midnight/submit-onchain.mjs`.  
4. **Developer packaging.** Getting-started docs, offline example (`examples/escrow-offline.mjs`), SECURITY.md, Apache-2.0 LICENSE, included / not-included checklist (WHAT-YOU-GET.md).  
5. **Product positioning.** Explicit developer / small-project focus (not banks first). Public site https://corvuszk.com returned HTTP 200 on 6 Nov 2026 (GitHub Pages). https://corvuszk-1.github.io/CorvusZK/ redirected there.  
6. **Tests.** Full suite green (unit + live XRPL testnet escrow) after packaging.
7. **Eligibility contract (6 Nov, ledger 8).** Mock-issuer Schnorr credential checked in-circuit, one-time nullifier bound to one XRPL escrow, `prove` then `reveal` of the release preimage. Live run with XRPL testnet release on 6 Nov ([docs/live-run.md](../live-run.md)).
8. **Ledger 9 upgrade (11 Nov).** Moved to Compact 0.36.0, Midnight.js 5.0.0, Wallet SDK 2.0.0, proof server 9.0.0; redeployed the three templates with one proof call each ([receipts](../../receipts/ledger9-preprod-2026-11-11.md)).
9. **Full eligibility run on ledger 9 (12 Nov).** XRPL escrow locked → eligibility deployed → `prove` → `reveal` → XRPL escrow released in 88 s ([receipts](../../receipts/ledger9-preprod-2026-11-12.md)). Replay page at https://corvuszk.com/demo/ and a 72-second video.
10. **QA (12 Nov).** GitHub Actions CI recompiles all four contracts with Compact 0.36.0 and checks artifacts, simulator tests for every contract, typed `midnight/witnesses.ts`.

## Honest gaps (still out of scope for this Wave)
- No Midnight mainnet yet (deploy in progress; nothing claimed until it confirms)  
- No hosted proof relay  
- Fresh new-commitment deploys still via `midnight/deploy.mjs`  
- Issuer-linked real age/balance credentials are future work  
- The public repository and https://corvuszk.com are up. That does not prove feature dates earlier than the public git history (publication commit `035c804`, 5 Nov 2026 PST). The eligibility contract was added after that commit (PR #2, 6 Nov 2026) and has run live on Preprod (6 Nov on ledger 8, 12 Nov on ledger 9).

## Dates and public record

Public publication commit `035c80455fe5403e21bbd33cd21d5dfb5efe75f9` (5 Nov 2026, 16:44 PST). `midnight/deployments.preprod.json` records Compact deployments at 2026-11-04T01:02Z (3 Nov 2026 PST) and an SDK `age_over` submit at 2026-11-05T11:00:51Z (5 Nov 2026 PST). Those timestamps support investigation. They do not by themselves prove every feature-development date. The public git history starts with the 5 Nov 2026 commits. https://corvuszk.com returned HTTP 200 on 6 Nov 2026 (GitHub Pages). https://corvuszk-1.github.io/CorvusZK/ redirected there.

## How privacy shapes the design
Private witnesses stay in Midnight Compact circuits. XRPL only sees a standard escrow and a finish gated by verification. CorvusZK never custodies funds or stores seeds/fulfillments.

## How to evaluate
See root README quickstart, `docs/getting-started.md`, `docs/on-chain-submit.md`, and `docs/buildathon/demo-script.md`.
