// CorvusZK — Midnight Preprod deploy: sync wallet, register tNIGHT for DUST, deploy templates, make one proof-backed call.
// Usage: node deploy.mjs            (status + register + deploy if DUST available)
// Never logs seeds or the Blockfrost project id. Secrets for contracts go to .contract-secrets.preprod.json (mode 600).
import fs from 'node:fs'; import crypto from 'node:crypto'; import path from 'node:path'; import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { deployContract } from '@midnight-ntwrk/midnight-js/contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { buildWallet, synced, summarize, cfg, redactErr, logProgress } from './wallet.mjs';
const here = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(here, 'deployments.preprod.json'), SEC = path.join(here, '.contract-secrets.preprod.json');
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {}; const save = () => fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const sec = fs.existsSync(SEC) ? JSON.parse(fs.readFileSync(SEC)) : {}; const saveSec = () => fs.writeFileSync(SEC, JSON.stringify(sec), { mode: 0o600 });
const log = (...a) => console.log(new Date().toISOString(), ...a);

function signIntents(tx, signFn, marker) { // workaround from example-counter (signRecipe hardcodes 'pre-proof')
  if (!tx?.intents || tx.intents.size === 0) return;
  for (const seg of tx.intents.keys()) { const it = tx.intents.get(seg); if (!it) continue;
    const c = ledger.Intent.deserialize('signature', marker, 'pre-binding', it.serialize()); const sig = signFn(c.signatureData(seg));
    for (const k of ['fallibleUnshieldedOffer', 'guaranteedUnshieldedOffer']) if (c[k]) c[k] = c[k].addSignatures(c[k].inputs.map((_, i) => c[k].signatures.at(i) ?? sig));
    tx.intents.set(seg, c); }
}
try {
  const ctx = await buildWallet('deployer'); const w = ctx.wallet; const prog = logProgress(w, 30_000, ctx.saveSnap);
  let s = await synced(w); out.deployerStatus = { ...summarize(s), at: new Date().toISOString() }; save(); log('status', out.deployerStatus);
  const unreg = s.unshielded.availableCoins.filter(c => c.meta?.registeredForDustGeneration !== true);
  if (s.dust.availableCoins.length === 0 && unreg.length > 0) {
    log('registering', unreg.length, 'NIGHT utxo(s) for DUST');
    const recipe = await w.registerNightUtxosForDustGeneration(unreg, ctx.unshieldedKeystore.getPublicKey(), p => ctx.unshieldedKeystore.signData(p));
    const fin = await w.finalizeRecipe(recipe); const txid = await w.submitTransaction(fin);
    out.dustRegistration = { txId: String(txid), at: new Date().toISOString() }; save(); log('dust registration tx', String(txid));
  }
  log('waiting for DUST > 0 (max 20 min)');
  s = await Rx.firstValueFrom(w.state().pipe(Rx.filter(x => x.isSynced && x.dust.balance(new Date()) > 0n), Rx.timeout(20 * 60_000)));
  const d1 = s.dust.balance(new Date()); await new Promise(r => setTimeout(r, 60_000)); const s2 = await synced(w); const d2 = s2.dust.balance(new Date());
  out.dustRate = { dustSpeckAt: String(d2), speckPerMinute: String(d2 - d1), at: new Date().toISOString() }; save(); log('dust', out.dustRate);

  const st = await synced(w);
  const wp = { getCoinPublicKey: () => st.shielded.coinPublicKey.toHexString(), getEncryptionPublicKey: () => st.shielded.encryptionPublicKey.toHexString(),
    async balanceTx(tx, ttl) { const r = await w.balanceUnboundTransaction(tx, { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey }, { ttl: ttl ?? new Date(Date.now() + 30 * 60_000) });
      const f = p => ctx.unshieldedKeystore.signData(p); signIntents(r.baseTransaction, f, 'proof'); if (r.balancingTransaction) signIntents(r.balancingTransaction, f, 'pre-proof'); return w.finalizeRecipe(r); },
    submitTx: tx => w.submitTransaction(tx) };
  const acct = wp.getCoinPublicKey(); const pw = Buffer.from(acct, 'hex').toString('base64') + '!';
  const providers = name => { const zk = new NodeZkConfigProvider(path.join(here, 'managed', name));
    return { privateStateProvider: levelPrivateStateProvider({ privateStateStoreName: 'corvuszk-' + name, accountId: acct, privateStoragePasswordProvider: () => pw }),
      publicDataProvider: indexerPublicDataProvider(cfg.indexerHttpUrl, cfg.indexerWsUrl), zkConfigProvider: zk, proofProvider: httpClientProofProvider(cfg.proofServerUrl, zk), walletProvider: wp, midnightProvider: wp }; };
  const B32 = new rt.CompactTypeBytes(32), V = new rt.CompactTypeVector(2, B32);
  sec.conditionSecret ??= crypto.randomBytes(32).toString('hex'); sec.ageSalt ??= crypto.randomBytes(32).toString('hex'); sec.balSalt ??= crypto.randomBytes(32).toString('hex'); saveSec();
  const cs = Buffer.from(sec.conditionSecret, 'hex'), as = Buffer.from(sec.ageSalt, 'hex'), bs = Buffer.from(sec.balSalt, 'hex');
  const enc = n => { const b = Buffer.alloc(32); b.writeUInt32LE(n, 0); return new Uint8Array(b); };
  const specs = {
    condition: { w: { attesterSecret: c => [c.privateState, new Uint8Array(cs)], deliveryOk: c => [c.privateState, true] }, args: [rt.persistentHash(B32, new Uint8Array(cs)), new Uint8Array(32)], call: 'attest' },
    age_over: { w: { birthYear: c => [c.privateState, 1990n], salt: c => [c.privateState, new Uint8Array(as)] }, args: [18n, 2026n, rt.persistentHash(V, [new Uint8Array(as), enc(1990)])] },
    balance_above: { w: { balance: c => [c.privateState, 5000n], salt: c => [c.privateState, new Uint8Array(bs)] }, args: [1000n, rt.persistentHash(V, [new Uint8Array(bs), enc(5000)])] },
  };
  out.deployments ??= {};
  for (const [name, sp] of Object.entries(specs)) {
    if (out.deployments[name]?.contractAddress) { log('already deployed', name); continue; }
    try { const m = await import(`./managed/${name}/contract/index.js`);
      const cc = CompiledContract.make(name, m.Contract).pipe(CompiledContract.withWitnesses(sp.w), CompiledContract.withCompiledFileAssets(path.join(here, 'managed', name)));
      log('deploying', name, '(proving via local proof server)');
      const dc = await deployContract(providers(name), { compiledContract: cc, privateStateId: name, initialPrivateState: {}, args: sp.args });
      const p = dc.deployTxData.public; out.deployments[name] = { contractAddress: p.contractAddress, txId: p.txId, txHash: p.txHash, blockHeight: p.blockHeight, at: new Date().toISOString() }; save(); log('deployed', name, out.deployments[name]);
      if (sp.call) { const r = await dc.callTx[sp.call](); out.deployments[name].call = { circuit: sp.call, txId: r.public.txId, txHash: r.public.txHash, blockHeight: r.public.blockHeight }; save(); log('called', name, out.deployments[name].call); }
    } catch (e) { out.deployments[name] = { error: redactErr(e).slice(0, 1500), at: new Date().toISOString() }; save(); log('FAILED', name, redactErr(e).slice(0, 600)); }
  }
  await w.stop(); process.exit(0);
} catch (e) { out.fatal = redactErr(e).slice(0, 1500); save(); console.error(redactErr(e)); process.exit(1); }
