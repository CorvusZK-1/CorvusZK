# Eligibility live run — SUCCESS, destination mode

Completed November 6, 2026, approximately 1:43 PM PST. Test networks only. No mainnet or real-money use.

## Evaluated version
PR https://github.com/CorvusZK-1/CorvusZK/pull/2 ; branch `cursor/buildathon-judges-eligibility-3679`; snapshot `4e7fb4fa9e9163e900754821fef8a18e41868207`. Isolated worktree `/workspace/dapps/eligibility-live-3679`. No merge, main push or repository source edit performed.

## Execution and reproducibility
Root and midnight dependencies installed with npm ci --ignore-scripts. Existing wallet copied privately, mode 0600; seeds never printed. Inherited Blockfrost key redacted from captured logs. Node 22.23.4; `npm run live:eligibility`; `MIDNIGHT_PROOF_SERVER=http://localhost:6300`; `PREIMAGE_MODE=destination`; `MN_SYNC_TIMEOUT_MS=600000`; `ELIGIBILITY_INDEXER_WAIT_MS=300000`.

Installed official static Docker 27.3.1 and started rootful dockerd with --iptables=false --bridge=none. Container `corvuszk-proof-813`, host network, proof-server 8.1.3, verbose logging disabled. /version = 8.1.3 and /ready status ok. Prover/daemon left running. Do not expose the prover externally or enable verbose witness/request logging.

Two attempts timed out after 600,000 ms in shielded/DUST wallet synchronization. They reached deployEligibility after XRPL escrow creation; partial testnet creates occurred but hashes were not emitted because script reports at the end. No zero-fee/no-transactions claim is justified for those attempts. Preserved sanitized logs in live-eligibility-attempt-1.txt and -2.txt.

Final retry restored the original saved wallet-state checkpoint from the existing toolkit setup and SUCCEEDED. The log's checkpoint timestamp was November 3, 2026, 4:57 PM PST. No wallet contents were inspected. It built the toolkit, created XRPL testnet escrow, deployed eligibility on Midnight Preprod, called prove and reveal using the local real proof server, read finalized indexer state, and finished XRPL escrow. Exit code 0; EscrowFinish tesSUCCESS; indexer found=true, proven=true, preimageRevealed=true. Original restore/Normal Closure messages did not prevent this attempt succeeding.

## Transaction evidence
- xrplCreate: https://testnet.xrpl.org/transactions/ED8DC76659E0933858F288F4EF7691C8AB026E36CFEF797DAE232E2FDC98B0E3
- midnightDeploy: https://preprod.midnightexplorer.com/transactions/be8e5f99f7c1b8c13467d7b533e351c1dc4f898198328cef5181213f528dc779
- midnightProve: https://preprod.midnightexplorer.com/transactions/f1d1935fb1960dc4d00ce773024056e495430cc478934be9fb38421693f9861f
- midnightReveal: https://preprod.midnightexplorer.com/transactions/ec4410ad604c60e8d8e7f1a9b13ed0fe1b423970cf297870cd8e602c071f62ba
- xrplFinish: https://testnet.xrpl.org/transactions/22D2F438E121F544B191DD94387ECF3AEC817669133A2B47E9A0D8B47DDD65FD

Contract: https://preprod.midnightexplorer.com/contracts/fd69a89c500708de630c22a4c4fd837fefdd870c2294eef0f1d21a182797feee

Midnight blocks: deploy 3,311,042; prove 3,311,048; reveal 3,311,052. Public explorer pages independently opened and showed Success with matching deploy/prove/reveal actions and 1 SPECK fee each. XRPL explorer links supplied by receipts; its fetched web page was JS-only, so XRPL results rely on actual script receipts, not independently rendered explorer contents.

## Measured fees — this run only
| Operation | Receipt fee | Unit/context |
|---|---:|---|
| XRPL EscrowCreate | 12 drops | 0.000012 testnet XRP |
| XRPL EscrowFinish | 423 drops | 0.000423 testnet XRP; tesSUCCESS |
| XRPL create + finish | 435 drops | 0.000435 testnet XRP; excludes reserves/funding |
| Midnight deploy | 1 SPECK | 0.000000000000001 tDUST |
| Midnight prove | 1 SPECK | 0.000000000000001 tDUST |
| Midnight reveal | 1 SPECK | 0.000000000000001 tDUST |
| Midnight three-operation total | 3 SPECK | 0.000000000000003 tDUST |

SDK paidFees and estimatedFees both return string "1" for each Midnight operation; explorer confirms the unit is SPECK, NOT one DUST. One tDUST = 10^15 SPECK. These unusually small observed Preprod fees are not a production tariff or evidence of Ethereum cost savings. DUST is generated from registered NIGHT; backing capital, proving compute, infrastructure and XRPL reserves remain separate economic costs. No balance-delta estimation was used.

## Security model and remaining gaps
- Default destination role samples/knows preimage, payer role receives condition/commitment only. Destination CAN finish early without Midnight. Optional payer mode reverses trust; this is not trustless cross-chain enforcement.
- XRPL verifies the native crypto-condition fulfillment, NOT the Midnight proof. Circuit prove→reveal guards a releaser relying on that route, not the original sampler or anyone already holding the preimage.
- Mock in-process Schnorr issuer, demonstration parameters, not regulated KYC or authenticated XRPL Credentials. Roles share one demonstration process; secret isolation is not production-hardened.
- Per-instance proven/revealed flags and escrow-bound nullifier; no global cross-contract registry. Fresh deployment resets state. Do not reuse a preimage/condition across escrows.
- Success-path network evidence is now real. Live invalid-credential, replay, early-destination-bypass and adversarial refusal tests were not executed in this run. Author reports 23 unit tests and four compiling Compact contracts; no independent security audit.
- Public repo topic midnightntwrk/homepage settings and pending README PR remain owner actions. This report is local; parent coding agent can add docs/live-run.md to PR branch only, after secret review. No branch push performed here.

## Files
`live-success-receipts.json`, `live-eligibility-output.txt`, `live-eligibility-attempt-3.txt` are sanitized real output; earlier failed attempt logs retained. Never publish wallet/cache files.
