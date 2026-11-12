// CorvusZK — Midnight Preprod (ledger 9) deploy: sync the throwaway test wallet, register its free test NIGHT for DUST
// if needed, deploy the 3 templates compiled with Compact 0.36.0, and make one proof-backed call on each.
// Usage: MIDNIGHT_PROOF_SERVER=http://localhost:6300 node deploy.mjs [--redeploy]
// Never logs seeds or the Blockfrost project id. Demo witnesses go to .contract-secrets.preprod.json (mode 600).
import fs from 'node:fs'; import crypto from 'node:crypto'; import path from 'node:path';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { openWallet9, providersFor, assertProofServer, receipt, redactErr } from './wallet9.mjs';
const here = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(here, 'deployments.preprod.json'), SEC = path.join(here, '.contract-secrets.preprod.json');
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {}; const save = () => fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const sec = fs.existsSync(SEC) ? JSON.parse(fs.readFileSync(SEC)) : {}; const saveSec = () => fs.writeFileSync(SEC, JSON.stringify(sec), { mode: 0o600 });
const log = (...a) => console.log(new Date().toISOString(), ...a);
// Keep the 3-4 Nov 2026 ledger 8 records as history; new ledger 9 deployments go under `deployments`.
if (out.deployments && !out.ledger8History && Object.values(out.deployments).some((d) => d?.at && d.at < '2026-11-09')) {
  out.ledger8History = { note: 'Ledger 8 era (before the 9 Nov 2026 Preprod upgrade). Contracts compiled with Compact 0.31.1. Kept as historical receipts.',
    deployerStatus: out.deployerStatus, dustRegistration: out.dustRegistration, dustRate: out.dustRate, deployments: out.deployments, e2e: out.e2e, sdkSubmit: out.sdkSubmit };
  for (const k of ['deployerStatus', 'dustRegistration', 'dustRate', 'deployments', 'e2e', 'sdkSubmit']) delete out[k];
  save();
}
let w;
const errChain = (e) => { const parts = []; for (let x = e, i = 0; x && i < 8; x = x.cause, i++) parts.push(`${x?._tag ?? x?.name ?? ''}: ${x?.message ?? String(x)}`); return redactErr(parts.join(' <- ')); };
delete out.fatal;
try {
  out.ledger = { network: 'preprod', ledger: 9, walletSdk: '2.0.0', midnightJs: '5.0.0', compact: '0.36.0', compactRuntime: '0.21.0', proofServer: await assertProofServer() };
  w = await openWallet9({ syncTimeoutMs: Number(process.env.MN_SYNC_TIMEOUT_MS ?? 3_600_000), log });
  out.deployerStatus = { ...w.status, at: new Date().toISOString() }; delete out.deployerStatus.dustRegistrationTxId;
  if (w.status.dustRegistrationTxId) out.dustRegistration = { txId: w.status.dustRegistrationTxId, at: new Date().toISOString(), note: 'free test NIGHT re-registered for DUST after the ledger 9 upgrade' };
  save(); log('status', JSON.stringify(out.deployerStatus));
  const B32 = new rt.CompactTypeBytes(32), V = new rt.CompactTypeVector(2, B32);
  sec.l9 ??= {}; sec.l9.conditionSecret ??= crypto.randomBytes(32).toString('hex'); sec.l9.ageSalt ??= crypto.randomBytes(32).toString('hex'); sec.l9.balSalt ??= crypto.randomBytes(32).toString('hex'); saveSec();
  const cs = Buffer.from(sec.l9.conditionSecret, 'hex'), as = Buffer.from(sec.l9.ageSalt, 'hex'), bs = Buffer.from(sec.l9.balSalt, 'hex');
  const enc = (n) => { const b = Buffer.alloc(32); b.writeUInt32LE(n, 0); return new Uint8Array(b); };
  const specs = {
    condition: { w: { attesterSecret: (c) => [c.privateState, new Uint8Array(cs)], deliveryOk: (c) => [c.privateState, true] }, args: [rt.persistentHash(B32, new Uint8Array(cs)), new Uint8Array(32)], call: 'attest' },
    age_over: { w: { birthYear: (c) => [c.privateState, 1990n], salt: (c) => [c.privateState, new Uint8Array(as)] }, args: [18n, 2026n, rt.persistentHash(V, [new Uint8Array(as), enc(1990)])], call: 'prove' },
    balance_above: { w: { balance: (c) => [c.privateState, 5000n], salt: (c) => [c.privateState, new Uint8Array(bs)] }, args: [1000n, rt.persistentHash(V, [new Uint8Array(bs), enc(5000)])], call: 'prove' },
  };
  out.deployments ??= {};
  for (const [name, sp] of Object.entries(specs)) {
    if (out.deployments[name]?.call?.txHash && !process.argv.includes('--redeploy')) { log('already deployed and called', name); continue; }
    const existing = !process.argv.includes('--redeploy') && out.deployments[name]?.contractAddress;
    try {
      const m = await import(`./managed/${name}/contract/index.js`);
      const cc = CompiledContract.make(name, m.Contract).pipe(CompiledContract.withWitnesses(sp.w), CompiledContract.withCompiledFileAssets(path.join(here, 'managed', name)));
      const prov = providersFor(w, { zkConfigPath: path.join(here, 'managed', name), storeName: 'corvuszk-' + name });
      let dc, addr;
      if (existing) {
        addr = existing; log('reusing ledger 9 deployment', name, addr);
        dc = await findDeployedContract(prov, { compiledContract: cc, contractAddress: addr, privateStateId: name, initialPrivateState: {} });
      } else {
        log('deploying', name, '(ZK proof from the local proof server)');
        dc = await deployContract(prov, { compiledContract: cc, privateStateId: name, initialPrivateState: {}, args: sp.args });
        const p = dc.deployTxData.public; addr = p.contractAddress;
        out.deployments[name] = { ...receipt(p, { circuit: 'deploy' }), at: new Date().toISOString() }; save(); log('deployed', name, addr);
      }
      try {
        const r = await dc.callTx[sp.call]();
        delete out.deployments[name].callError;
        out.deployments[name].call = { ...receipt(r.public, { circuit: sp.call, contractAddress: addr }), at: new Date().toISOString() }; save(); log('called', name, sp.call, r.public.txHash);
      } catch (e) { out.deployments[name].callError = { error: errChain(e).slice(0, 2000), at: new Date().toISOString() }; save(); log('CALL FAILED', name, errChain(e).slice(0, 1500)); }
    } catch (e) { out.deployments[name] = { ...(out.deployments[name] ?? {}), deployError: errChain(e).slice(0, 2000), at: new Date().toISOString() }; save(); log('FAILED', name, errChain(e).slice(0, 1500)); }
  }
  await w.stop(); process.exit(0);
} catch (e) { out.fatal = redactErr(e).slice(0, 1500); save(); console.error(redactErr(e).slice(0, 2000)); try { await w?.stop(); } catch {} process.exit(1); }
