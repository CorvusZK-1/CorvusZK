# CorvusZK on Midnight Preprod ledger 9 — receipts (12 Nov 2026, PT)

Network: Midnight Preprod (testnet), ledger 9, plus XRPL testnet. Same stack as the [11 Nov receipts](ledger9-preprod-2026-11-11.md): Wallet SDK 2.0.0, Midnight.js 5.0.0, Compact 0.36.0, compact-runtime 0.21.0.
Wallets: throwaway test wallets with free test NIGHT / DUST and faucet test XRP. No real money. Seeds, tokens and preimages are not in this file.

## Run 1 — 2:51 AM PT: `age_over` proof on the 11 Nov ledger 9 contract (42 s)
Command: `cd midnight && node submit-onchain.mjs --template age_over`
- Contract: https://preprod.midnightexplorer.com/contracts/838bb8f23e4413da672fdae86d29c7918da2dab8ab6e32ff9c824357127ea16f
- `prove` tx (block 3,389,109): https://preprod.midnightexplorer.com/transactions/cdd140eefcb38622f05de9091fd75d39331ff1143d46893aa61bfdaa91b9e455 ([Subscan](https://midnight-preprod.subscan.io/extrinsic/0xcdd140eefcb38622f05de9091fd75d39331ff1143d46893aa61bfdaa91b9e455))

## Run 2 — 2:55 AM PT: full eligibility flow, XRPL escrow released after a Midnight proof (88 s)
Command: `npm run live:eligibility` (mock credential issuer, labeled MOCK; preimage mode: destination, so the payer never receives the preimage)

| Step | Network | Transaction | Block / ledger | Result |
|---|---|---|---|---|
| Lock 20 test XRP (`EscrowCreate`) | XRPL testnet | [593F1F56…FAB41](https://testnet.xrpl.org/transactions/593F1F56ED7AD8FB7C4C4DF7D78EF2DE41AC3DE085DC476BC30B348F350FAB41) | ledger 22,265,838 | `tesSUCCESS` |
| Deploy `eligibility` | Midnight Preprod | [9de06ad9…f54c3](https://preprod.midnightexplorer.com/transactions/9de06ad93e116ffc249a4665702a07c0b316809604a5ceb154f78671f94f54c3) | block 3,389,151 | Success |
| `prove` (zero-knowledge proof) | Midnight Preprod | [88a89d1d…a3859](https://preprod.midnightexplorer.com/transactions/88a89d1df54979f400b991cf4b7e152dccacd18950cef3539af7d7f1611a3859) | block 3,389,155 | Success |
| `reveal` | Midnight Preprod | [0cb52d18…2d586](https://preprod.midnightexplorer.com/transactions/0cb52d18a22d6c2dccc588f7668c732efa96eb18316e4425363a71a7e382d586) | block 3,389,158 | Success |
| Indexer read | Midnight Preprod | — | — | found, proven, preimage revealed |
| Release (`EscrowFinish`) | XRPL testnet | [194F5D8F…4354C](https://testnet.xrpl.org/transactions/194F5D8FD89AFF3E95ACC7A140D2ED2AB6129EA7E6A73A2C7A2A0BAE6634354C) | ledger 22,265,859 | `tesSUCCESS` |

Eligibility contract instance: https://preprod.midnightexplorer.com/contracts/b8a7935e586c31800fc0b424c4f7e83d274c62d8dab3b63b77708d569ba0c1f2

Note: public XRPL testnet servers prune old ledgers, so a direct `tx` lookup on some servers can return "not found" for these hashes; the explorer links keep full history.

Honest limits for this run: the issuer is a mock; XRPL does not verify the Midnight proof itself; the destination, who sampled the preimage, could have finished without Midnight. See [docs/security-model.md](../docs/security-model.md).
