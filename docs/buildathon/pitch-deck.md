# CorvusZK - Midnight Buildathon Wave 3 pitch deck

Use as speaker notes or paste into Google Slides / Pitch. One slide per `##`. Keep under 10 slides for judges.

---

## 1. Title
**CorvusZK**  
Privacy proofs that gate real XRPL escrows  
Four Compact contracts live on Midnight mainnet · full escrow release proven on Preprod + XRPL testnet · Apache-2.0  
Owner: Cory Raven · https://corvuszk.com · https://github.com/CorvusZK-1/CorvusZK

## 2. Problem
Builders already lock XRP in native XRPL escrow.  
They need a private yes/no before `EscrowFinish` (age, funds, condition, or a one-time credential check).  
Today they either leak the inputs, become a custodian, or wait for Smart Escrow / Boundless mainnet.

## 3. Solution (one sentence)
Lock XRP in a normal XRPL escrow. Prove age / funds / condition / eligibility on Midnight without leaking private inputs. Finish the escrow only if the proof verifies. Non-custodial. TypeScript.

## 4. How it works
1. Payer creates native XRPL escrow (their wallet; we never hold funds).  
2. Compact circuit proves a claim (`age_over`, `balance_above`, `condition`, or `eligibility`).  
3. Verifier checks the proof.  
4. Seller finishes the escrow only when verification passes.  
Private witnesses stay off the XRPL ledger.

## 5. What shipped in Wave 3 (Nov 2026)
- Four Compact contracts compile with Compact 0.36.0; proving keys generated; CI recompiles and checks artifacts  
- Live Midnight Preprod deploys + attest / prove + `submitOnChain`  
- Full eligibility path on 12 Nov: XRPL testnet escrow locked → `prove` → `reveal` → `EscrowFinish` in 88 seconds  
- All four contracts deployed on Midnight mainnet on 13 Nov (unaudited, not for real value; mainnet eligibility is a demonstration instance)  
- TypeScript SDK (`MidnightBackend`) + offline demo, replay page at https://corvuszk.com/demo/, 72-second video  
- Docs, SECURITY.md, Apache-2.0 LICENSE, included / not-included checklist

## 6. Demo path for judges
```bash
git clone https://github.com/CorvusZK-1/CorvusZK && cd CorvusZK
npm ci && (cd midnight && npm ci)
npm run test:offline
npm run simulate
npm run example:eligibility
```
See the 12 Nov run at https://corvuszk.com/demo/ (no install). Contracts: `condition`, `age_over`, `balance_above`, `eligibility` under `contracts/`.

## 7. Who it is for (not banks first)
TypeScript indie builders and small XRPL product teams shipping P2P / marketplace flows.  
Indie builders first; a hosted relay and issuer-linked credentials are later work.

## 8. Privacy design
- Dual-ledger: private witness on Midnight; public XRPL escrow stays standard  
- Selective disclosure: only the boolean claim reaches the finish path  
- Non-custody: no seeds, no fulfillments stored by CorvusZK  
- Honest limits: unaudited; not for real value; eligibility uses a labeled mock Schnorr issuer, not regulated KYC; XRPL does not verify the Midnight proof; the full prove → reveal → EscrowFinish path has been proven on Preprod + XRPL testnet only

## 9. Ask / next
- Public GitHub with the `midnightntwrk` topic: https://github.com/CorvusZK-1/CorvusZK  
- Public site https://corvuszk.com (demo replay at https://corvuszk.com/demo/)  
- Short demo video on the homepage  
- Optional: XRPL Commons Glow after OSS is live

## 10. Links
Repo: https://github.com/CorvusZK-1/CorvusZK  
Landing: https://corvuszk.com  
Demo: https://corvuszk.com/demo/  
Buildathon hub: https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG  
Progress write-up: docs/buildathon/wave3-progress.md
