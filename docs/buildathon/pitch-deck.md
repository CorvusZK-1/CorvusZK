# CorvusZK - Midnight Buildathon Wave 3 pitch deck

Use as speaker notes or paste into Google Slides / Pitch. One slide per `##`. Keep under 10 slides for judges.

---

## 1. Title
**CorvusZK**  
Privacy proofs that gate real XRPL escrows  
Midnight Preprod + XRPL testnet · Apache-2.0  
Owner: Cory Raven · https://corvuszk.com

## 2. Problem
Builders already lock XRP in native XRPL escrow.  
They need a private yes/no before `EscrowFinish` (age, funds, condition).  
Today they either leak the inputs, become a custodian, or wait for Smart Escrow / Boundless mainnet.

## 3. Solution (one sentence)
Lock XRP in a normal XRPL escrow. Prove age / funds / condition on Midnight without leaking private inputs. Finish the escrow only if the proof verifies. Non-custodial. TypeScript. Testnet-ready today.

## 4. How it works
1. Payer creates native XRPL escrow (their wallet; we never hold funds).  
2. Compact circuit proves a claim (`age_over`, `balance_above`, or `condition`).  
3. Verifier checks the proof.  
4. Seller finishes the escrow only when verification passes.  
Private witnesses stay off the XRPL ledger.

## 5. What shipped in Wave 3 (Nov 2026)
- 3 Compact templates compile; proving keys generated  
- Live Midnight Preprod deploy + attest + `submitOnChain`  
- XRPL testnet EscrowFinish released after a real proof  
- TypeScript SDK (`MidnightBackend` wired) + offline demo in minutes  
- Docs, SECURITY.md, Apache-2.0 LICENSE, buyer checklist  
- Domain corvuszk.com registered; public-safe tree ready to publish

## 6. Demo path for judges
```bash
npm install && npm run build
npm run demo:offline    # no network
npm test                # unit + live XRPL testnet escrow
# Preprod: see docs/on-chain-submit.md + midnight/ scripts
```
Contracts: `condition`, `age_over`, `balance_above` under `contracts/` / `midnight/`.

## 7. Who it is for (not banks first)
TypeScript indie builders and small XRPL product teams shipping P2P / marketplace flows.  
Prototype value band for a small team: roughly $5K-$25K.  
Banks later; Preprod product first.

## 8. Privacy design
- Dual-ledger: private witness on Midnight; public XRPL escrow stay standard  
- Selective disclosure: only the boolean claim reaches the finish path  
- Non-custody: no seeds, no fulfillments stored by CorvusZK  
- Honest limits: testnet only; no hosted relay; issuer-linked credentials are future work

## 9. Ask / next
- Public GitHub with `midnightntwrk` label  
- GitHub Pages + corvuszk.com DNS  
- Short demo video (script in `demo-script.md`)  
- Optional: XRPL Commons Glow after OSS is live  

## 10. Links
Repo: (add after push)  
Landing: https://corvuszk.com  
Buildathon hub: https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG  
Progress write-up: docs/buildathon/wave3-progress.md
