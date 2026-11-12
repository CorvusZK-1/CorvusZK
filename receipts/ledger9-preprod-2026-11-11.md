# CorvusZK on Midnight Preprod ledger 9 — receipts (11 Nov 2026, PT)

Network: Midnight Preprod (testnet), ledger 9. Stack: Wallet SDK 2.0.0, Midnight.js 5.0.0, Compact 0.36.0, compact-runtime 0.21.0, proof server 9.0.0.
Wallet: throwaway Preprod test wallet; free test NIGHT only. No real money. Tokens and seeds are not in this file.

- DUST re-registration of the wallet's test NIGHT: transaction identifier 00179da74eeb5bf22132adc1ac91b516942872c28cccbc9a64722d6bf493506f0a (6:47 PM PT)
- Deploys: blocks 3,384,635 / 3,384,638 / 3,384,641 (about 6:47 PM PT). Proof calls: blocks 3,384,697 / 3,384,701 / 3,384,705 (about 6:53–6:54 PM PT). Indexer status SUCCESS for every call.

- `condition` contract: https://preprod.midnightexplorer.com/contracts/b6f78efb34e84b8809267764f0f62eaab5f375c845cc57a64a63b700dde04df3
  - deploy tx: https://preprod.midnightexplorer.com/transactions/1c24472691745fea4b864140613a44be6f588fcda8ab6d1f20e6ae73873f437c
  - `attest` (ZK proof) tx: https://preprod.midnightexplorer.com/transactions/c974a56ea2e257d09701d55c9d82cc6a9dcb7231d565a6324dd0c5b6e343847f
- `age_over` contract: https://preprod.midnightexplorer.com/contracts/838bb8f23e4413da672fdae86d29c7918da2dab8ab6e32ff9c824357127ea16f
  - deploy tx: https://preprod.midnightexplorer.com/transactions/94a06463280aa11934e4659903d28e0e54afaf830ba728489b932890d99dfa82
  - `prove` (ZK proof) tx: https://preprod.midnightexplorer.com/transactions/fb86e2539597ce7934c10cfc528ea890c4ed2513af25756e2b27218ba59ada89
- `balance_above` contract: https://preprod.midnightexplorer.com/contracts/7eab336024024dfec2787023d0ee5af56818d9199425bb76f1b756570f04284b
  - deploy tx: https://preprod.midnightexplorer.com/transactions/1aab88403471888ef9ab5ab499ca3b3f07fa9e06eb4817f3ba09a12ed60cde80
  - `prove` (ZK proof) tx: https://preprod.midnightexplorer.com/transactions/e14168707c2f48a3edd0a5f7bdaaa0aef1cf51c13da456763da1f22b28fabd4f
Not re-run on ledger 9: the eligibility template deploy and the XRPL escrow release (their last live run was on ledger 8, 6 Nov 2026).
Full public data: midnight/deployments.preprod.json.
