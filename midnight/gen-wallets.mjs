// Generates throwaway Midnight PREPROD wallets. Seeds go to midnight/.wallets.preprod.json (mode 600). Prints PUBLIC addresses only.
import crypto from 'node:crypto'; import fs from 'node:fs';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
const file = new URL('./.wallets.preprod.json', import.meta.url);
const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
const out = {};
for (const name of ['deployer', 'user']) {
  store[name] ??= crypto.randomBytes(32).toString('hex');
  const hd = HDWallet.fromSeed(Buffer.from(store[name], 'hex')); if (hd.type !== 'seedOk') throw hd.error;
  const r = hd.hdWallet.selectAccount(0).selectRoles([Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (r.type !== 'keysDerived') throw new Error('derive failed');
  const night = createKeystore(r.keys[Roles.NightExternal], 'preprod').getBech32Address().asString();
  let dust = 'n/a';
  try { const dsk = ledger.DustSecretKey.fromSeed(r.keys[Roles.Dust]); dust = DustAddress.encodePublicKey('preprod', dsk.publicKey); } catch (e) { dust = 'derive error: ' + e.message; }
  out[name] = { night, dust };
}
fs.writeFileSync(file, JSON.stringify(store), { mode: 0o600 });
console.log(JSON.stringify(out, null, 1));
