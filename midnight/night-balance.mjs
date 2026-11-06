// Unshielded-only (fast) tNIGHT balance check. Prints public address + balance only.
import fs from 'node:fs'; import * as Rx from 'rxjs'; import { WebSocket } from 'ws';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { WalletEntrySchema } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { preprodConfig } from '../dist/midnight-config.js';
globalThis.WebSocket = WebSocket; setNetworkId('preprod'); const cfg = preprodConfig();
const seeds = JSON.parse(fs.readFileSync(new URL('./.wallets.preprod.json', import.meta.url))); const res = {};
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['deployer', 'user']) {
  const hd = HDWallet.fromSeed(Buffer.from(seeds[name], 'hex')); const k = hd.hdWallet.selectAccount(0).selectRoles([Roles.NightExternal]).deriveKeysAt(0).keys; hd.hdWallet.clear();
  const ks = createKeystore(k[Roles.NightExternal], 'preprod');
  const w = UnshieldedWallet({ networkId: 'preprod', indexerClientConnection: { indexerHttpUrl: cfg.indexerHttpUrl, indexerWsUrl: cfg.indexerWsUrl }, txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema) }).startWithPublicKey(PublicKey.fromKeyStore(ks));
  await w.start();
  const s = await Rx.firstValueFrom(w.state.pipe(Rx.filter(s => s.progress?.isStrictlyComplete?.() ?? s.isSynced ?? false), Rx.timeout(300_000)));
  res[name] = { address: ks.getBech32Address().asString(), tNIGHT_units: String(s.balances[unshieldedToken().raw] ?? 0n), utxos: s.availableCoins.length };
  await w.stop();
}
console.log(JSON.stringify(res, null, 1)); process.exit(0);
