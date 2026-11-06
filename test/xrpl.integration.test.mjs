import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs';
import * as xrpl from 'xrpl'; import * as k from '../dist/index.js';
test('XRPL testnet: escrow released only after valid proof', {timeout:180000}, async()=>{
  const c=new xrpl.Client(k.XRPL_TESTNET_WSS); await c.connect();
  const fw=()=>c.fundWallet(null,{faucetHost:'faucet.altnet.rippletest.net'});
  const {wallet:buyer}=await fw(); const {wallet:seller}=await fw();
  fs.writeFileSync(new URL('../.keys.testnet.json',import.meta.url),JSON.stringify({buyer:buyer.seed,seller:seller.seed}),{mode:0o600});
  const cond=k.createCryptoCondition(); const b=new k.LocalSimulationBackend();
  const esc=await k.createEscrow(c,buyer,{destination:seller.address,amountXrp:'25',condition:cond.condition});
  assert.equal(esc.result,'tesSUCCESS');
  // bad proof (from an untrusted prover) must NOT release
  const rogue=new k.LocalSimulationBackend(); const bad=await k.proveCondition(rogue,'delivered','salt',k.commit('delivered','salt'));
  const r1=await k.verifyAndReleaseEscrow(c,seller,{backend:b,proof:bad,owner:esc.owner,offerSequence:esc.offerSequence,...cond});
  assert.equal(r1.released,false);
  const good=await k.proveCondition(b,'delivered','salt',k.commit('delivered','salt'));
  const r2=await k.verifyAndReleaseEscrow(c,seller,{backend:b,proof:good,owner:esc.owner,offerSequence:esc.offerSequence,...cond});
  assert.equal(r2.released,true);
  fs.writeFileSync(new URL('../test-results.json',import.meta.url),JSON.stringify({create:esc.hash,finish:r2.hash,rejected:r1.reason},null,1));
  console.log('create',esc.hash,'finish',r2.hash); await c.disconnect();
});
