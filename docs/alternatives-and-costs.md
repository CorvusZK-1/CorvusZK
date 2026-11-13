# Alternatives and costs

Moved from the README on 12 Nov 2026 so the README stays short. Content unchanged.

## Costs

No numeric savings claim. A 6 Nov 2026 preparation note did not obtain measured CorvusZK XRPL receipt fees or Midnight declared DUST proof-call fees. A read-only JSON-RPC request to the public XRPL testnet endpoint failed with SSL `UNEXPECTED_EOF_WHILE_READING`. No transaction was submitted for that measurement. Do not label the reference figures below as CorvusZK measurements.

Official XRPL reference values, from https://xrpl.org/docs/concepts/transactions/transaction-cost :

- Standard transaction fee: 10 drops = 0.000010 XRP, before load scaling.
- Conditional `EscrowFinish` with a 32-byte preimage: 350 drops = 0.000350 XRP.
- Illustrative two-transaction sum: 360 drops = 0.000360 XRP. This is not an observed CorvusZK total. Account and escrow reserves are separate.

Midnight, from https://docs.midnight.network/guides/manage-dust :

- The Preprod proof-call DUST fee was not obtained. The deployment manifest has transaction ids and balances, not a per-transaction fee. Balance differences are not fee measurements, because DUST keeps generating.
- Documented units: 1 DUST = 10^15 SPECK; 1 NIGHT = 10^6 STAR. A documented parameter example gives 1 NIGHT a capacity of 5 DUST, about one week to the cap, and 1,000 NIGHT generating 0.008267 DUST/second. Parameters are network-specific and can change.
- The manifest records generation of 2,480,100,000,000,000 SPECK/minute (2.4801 DUST/minute). That is a recorded generation rate, not a proof-call fee, and it was not re-measured here.
- DUST is a non-transferable fee resource. Registering eligible NIGHT outputs enables generation. Spending the backing NIGHT starts decay of the associated old DUST. Fees consume DUST. Holding NIGHT has a capital cost.
- There is no supported numeric savings comparison with Ethereum L1. That would need a comparable verifier gas receipt, contemporaneous base and priority fees, an exchange rate, a measured Midnight fee, proving compute, and reserve assumptions.

## Why CorvusZK vs alternatives

Choose CorvusZK when the integration target is an existing TypeScript XRPL application, settlement should remain in a standard native escrow, and the team wants to prototype Midnight-backed private predicates without operating a new settlement ledger. The concrete surface is three claim templates, one eligibility template, a TypeScript backend interface, and an application-side or circuit-revealed path into `EscrowFinish`. That is an integration choice. It is not evidence of stronger security, lower total cost, or production readiness.

- **XRPL Credentials (XLS-70), DID, and Permissioned Domains.** Prefer these for trusted-issuer status and protocol-supported access control when that meets the requirement. Credentials already keep underlying identity documents off-chain. A DID identifies a controller. It does not by itself prove an age or a balance. CorvusZK's eligibility circuit checks a mock Schnorr credential over a subject commitment. It does not yet check an issuer-backed XRPL Credential object. The approaches can be combined. [1–3]
- **Hooks on Xahau.** Prefer Hooks for custom on-ledger account policy and autonomous actions on Xahau. CorvusZK's demonstrated settlement is standard XRPL testnet escrow, with Midnight for the predicate. It does not provide equivalent ledger-enforced account policy. Hooks' WASM execution is not, by itself, a zero-knowledge privacy system. [4]
- **Boundless / RISC Zero Smart Escrows.** This is the closest technical alternative. Its starter embeds proof verification in an escrow finish function on a Smart Escrow devnet. That is a stronger ledger-enforced proof-to-release binding than CorvusZK's application-checked path and stronger than the eligibility path, because XRPL still does not verify the Compact proof. CorvusZK targets ordinary native escrow plus Compact and TypeScript, without that special network. Both need test-network qualifications. Neither source establishes a CorvusZK mainnet advantage. [5–6]
- **Other Midnight Buildathon work.** Mask is a private checkout and invoice product with a documented wallet and shielded-payment flow. Senyap is a private recommendation market with documented multi-party workflows. "Uses Midnight" or "has a demo" is not a difference in kind. CorvusZK's narrower proposition is reusable XRPL-escrow integration. Mask can hide more of the payment inside its Midnight design. CorvusZK's XRPL amount, accounts, and timing stay public. Those descriptions are author-reported. This note does not audit them. [7–9]

Do not choose the current prototype if you need XRPL-enforced Midnight proof checks, private XRP amounts or counterparties, a regulated KYC credential, audited production security, or a measured lower operating cost.

| Approach | Prefer it for | CorvusZK distinction |
|---|---|---|
| XRPL Credentials / DID / Domains | Issuer status and ledger access policy | Private witness predicates. Issuer truth is not an XRPL Credential object. |
| Xahau Hooks | Ledger-enforced custom account logic | Ordinary XRPL escrow plus Midnight. Release policy is not an XRPL rule. |
| Boundless Smart Escrows | Proof verification inside escrow finish on a special devnet | Compact and TypeScript on ordinary escrow. Weaker proof-to-release enforcement. |
| Mask / Senyap | Complete private-payment or recommendation applications | Reusable XRPL integration component, with public escrow fields. |

Sources: [1](https://xrpl.org/docs/concepts/decentralized-storage/credentials) [2](https://xrpl.org/docs/concepts/decentralized-storage/decentralized-identifiers) [3](https://xrpl.org/docs/concepts/tokens/decentralized-exchange/permissioned-domains) [4](https://xahau.network/docs/hooks/) [5](https://github.com/boundless-xyz/xrpl-boundless-starter/blob/main/README.md) [6](https://www.xrpl-commons.org/newsroom/xrpl-gets-on-chain-privacy-via-zkp-introducing-boundless-on-xrpl) [7](https://github.com/pratiikpy/mask-midnight/blob/main/README.md) [8](https://github.com/scientivan/senyap/blob/main/README.md) [9](https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG). Mask and Senyap appear in participant discussion. This note does not establish their current Wave 3 entry status.

Back to the [README](../README.md).
