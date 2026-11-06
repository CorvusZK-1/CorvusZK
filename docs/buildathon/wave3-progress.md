# CorvusZK - progress during Midnight Buildathon Wave 3

Wave window: 1 Nov 2026 - 30 Nov 2026 (AKINDO submit deadline 30 Nov 2026 ~10:00).  
This is a first Wave 3 submission (no prior Wave 1/2 CorvusZK entry).

## What we built in this Wave
1. **Compact + Preprod.** Deployed three templates (`condition`, `age_over`, `balance_above`) on Midnight Preprod with real ZK proofs. Attest and `submitOnChain` verified (example age_over tx `744ecf07…5952`, block 3290220).  
2. **XRPL escrow gate.** End-to-end testnet path: native escrow create → Midnight proof → `EscrowFinish` only after verify (EscrowFinish example `A289E64F…40AE`).  
3. **SDK.** `MidnightBackend` prove/verify via `midnight/sdk-bridge.mjs`; local-circuits and preprod modes; CLI `midnight/submit-onchain.mjs`.  
4. **Developer packaging.** Getting-started docs, offline example (`examples/escrow-offline.mjs`), SECURITY.md, Apache-2.0 LICENSE, WHAT-YOU-GET checklist, buyer zip without secrets.  
5. **Product positioning.** Explicit developer / small-project focus (not banks first). Public site https://corvuszk.com returned HTTP 200 on 6 Nov 2026 (GitHub Pages). https://corvuszk-1.github.io/CorvusZK/ redirected there.  
6. **Tests.** Full suite green (unit + live XRPL testnet escrow) after packaging.

## Honest gaps (still out of scope for this Wave)
- No Midnight mainnet  
- No hosted proof relay  
- Fresh new-commitment deploys still via `midnight/deploy.mjs`  
- Issuer-linked real age/balance credentials are future work  
- The public repository and https://corvuszk.com are up. That does not prove feature dates earlier than the public git history (publication commit `035c804`, 5 Nov 2026 PST). The eligibility contract added after that commit is local-only and is not in the 3 Nov Preprod deployment manifest.

## How privacy shapes the design
Private witnesses stay in Midnight Compact circuits. XRPL only sees a standard escrow and a finish gated by verification. CorvusZK never custodies funds or stores seeds/fulfillments.

## How to evaluate
See root README quickstart, `docs/getting-started.md`, `docs/on-chain-submit.md`, and `docs/buildathon/demo-script.md`.
