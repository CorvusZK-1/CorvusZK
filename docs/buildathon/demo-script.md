# CorvusZK demo / video pitch script (~90-120 seconds)

Record screen + voice. Show terminal and optional localhost demo. No wallets with real funds. No secrets on screen.

## Shot list
1. Title card (5s): CorvusZK logo text + one-liner  
2. Problem (15s): talk over a simple diagram or README "Who it is for"  
3. Offline prove (25s): terminal `npm run demo:offline`  
4. XRPL gate (30s): show escrow create → proof → EscrowFinish (test from `npm test` log or `npm run demo`)  
5. Preprod proof (20s): flash explorer tx / README status table (age_over submitOnChain)  
6. Close (10s): GitHub URL + corvuszk.com + "Apache-2.0, non-custodial, testnet today"

## Voiceover (read naturally)
"Hi, I'm Cory. CorvusZK lets you gate a normal XRPL escrow with a Midnight privacy proof.

Builders already lock XRP in native escrow. They need a private yes or no before release: age over eighteen, balance above a threshold, or a condition met. Without leaking the inputs or becoming a custodian.

Here's the offline path. Install, build, run the demo. Three claims, pass and refuse cases, no network.

Same flow on XRPL testnet: create the escrow from the payer's own wallet, prove the claim with a Compact circuit, finish only if verification passes. We never hold the XRP.

On Midnight Preprod we deployed three Compact templates and posted live attest and submit-on-chain calls. Proofs are real, not mocked.

CorvusZK is TypeScript, Apache-2.0, aimed at indie XRPL builders first. Repo and docs at GitHub, site at corvuszk.com. Thanks for watching."

## B-roll / cutaways
- WHAT-YOU-GET.md included vs not-included checklist (2s)  
- contracts folder names (1s)  
- SECURITY.md "never commit these secrets" (1s)

## Do not say
- Mainnet ready  
- Bank or institutional sales as current customers  
- Any Blockfrost key, seed, or wallet address that is not a throwaway testnet one
