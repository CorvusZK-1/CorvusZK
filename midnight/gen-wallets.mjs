// Generates throwaway Midnight PREPROD test wallets (Wallet SDK 2). Seeds go to midnight/.wallets.preprod.json (mode 600).
// Prints PUBLIC addresses only. Existing seeds are kept.
import crypto from 'node:crypto'; import fs from 'node:fs';
import { WalletSeeds } from '@midnight-ntwrk/testkit-js';
import { createKeystore, NetworkId, DustAddress } from '@midnightntwrk/wallet-sdk';
import { DustSecretKey } from '@midnightntwrk/ledger-v9';
const file = new URL('./.wallets.preprod.json', import.meta.url);
const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
const out = {};
for (const name of ['deployer', 'user']) {
  store[name] ??= crypto.randomBytes(32).toString('hex');
  const s = WalletSeeds.fromMasterSeed(store[name]);
  const night = createKeystore({ kind: 'schnorr', secret: s.unshielded }, NetworkId.NetworkId.PreProd).getBech32Address().asString();
  let dust = 'n/a';
  try { dust = DustAddress.encodePublicKey('preprod', DustSecretKey.fromSeed(s.dust).publicKey); } catch (e) { dust = 'derive error: ' + e.message; }
  out[name] = { night, dust };
}
fs.writeFileSync(file, JSON.stringify(store), { mode: 0o600 });
console.log(JSON.stringify(out, null, 1));
