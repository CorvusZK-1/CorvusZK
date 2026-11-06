import test from 'node:test'; import assert from 'node:assert';
import * as k from '../dist/index.js';

test('balanceAbove: true predicate proves and verifies', async()=>{const b=new k.LocalSimulationBackend();const p=await k.proveBalanceAbove(b,500,100,'s');assert.equal(p.zk,false);assert.ok(await b.verify(p));});
test('balanceAbove: false predicate refuses', async()=>{const b=new k.LocalSimulationBackend();await assert.rejects(k.proveBalanceAbove(b,50,100,'s'));});
test('ageOver works and rejects underage', async()=>{const b=new k.LocalSimulationBackend();assert.ok(await b.verify(await k.proveAgeOver(b,1990,18,2026,'s')));await assert.rejects(k.proveAgeOver(b,2012,18,2026,'s'));});
test('tampered proof rejected', async()=>{const b=new k.LocalSimulationBackend();const p=await k.proveAgeOver(b,1990,18,2026,'s');p.claim.minAge=21;assert.equal(await b.verify(p),false);});
test('proof from another prover rejected', async()=>{const a=new k.LocalSimulationBackend(),b=new k.LocalSimulationBackend();assert.equal(await b.verify(await k.proveAgeOver(a,1990,18,2026,'s')),false);});
test('MidnightBackend explains what is missing', async()=>{await assert.rejects(new k.MidnightBackend({}).prove(),/blockfrostProjectId/);});
test('condition encoding', ()=>{const c=k.createCryptoCondition();assert.match(c.condition,/^A0258020[0-9A-F]{64}810120$/);assert.match(c.fulfillment,/^A0228020/);});

/** Stub bridge: proves without midnight/node_modules so unit tests stay offline. */
function stubBridge() {
  return {
    proveLocal: async ({ template, publicInputs, witness }) => {
      if (template === 'age_over') {
        const by = Number(witness.birthYear), min = Number(publicInputs.minAge), y = Number(publicInputs.asOfYear);
        if (y - by < min) throw new Error('under age');
        return { template, circuit: 'prove', commitmentHex: 'aa'.repeat(32), ledger: { proven: true, minAge: min, asOfYear: y }, transcriptHex: 'bb'.repeat(32) };
      }
      if (template === 'balance_above') {
        if (!(Number(witness.balance) > Number(publicInputs.threshold))) throw new Error('balance not above threshold');
        return { template, circuit: 'prove', commitmentHex: 'cc'.repeat(32), ledger: { proven: true, threshold: Number(publicInputs.threshold) }, transcriptHex: 'dd'.repeat(32) };
      }
      if (template === 'condition') {
        if (witness.deliveryOk === false) throw new Error('condition not met');
        return { template, circuit: 'attest', commitmentHex: 'ee'.repeat(32), ledger: { released: true, escrowId: '00'.repeat(32) }, transcriptHex: 'ff'.repeat(32) };
      }
      throw new Error('unknown template');
    },
    loadDeployments: () => ({ deployments: { condition: { contractAddress: '45563d2ede4887717968e51405bc4d9993dd7082959c59cda72755c500cd52f5' }, age_over: { contractAddress: '3458e15536314cd6ed68d20aecec14c66f3d786ad09a871cf057949170ec2367' }, balance_above: { contractAddress: '8606a6370f7eabd1b3ecda9303c5ceadc42bb55aff7e009d1a3b23c640fd6c0c' } } }),
    submitCallTx: async ({ template, contractAddress, witness }) => {
      if (!contractAddress) throw new Error('missing contractAddress');
      if (!witness) throw new Error('missing witness');
      return {
        template,
        circuit: template === 'condition' ? 'attest' : 'prove',
        contractAddress,
        txId: '00deadbeef',
        txHash: 'aabb'.repeat(16),
        blockHeight: 3269999,
      };
    },
  };
}

test('MidnightBackend local-circuits prove/verify (stub bridge, no network)', async () => {
  const b = new k.MidnightBackend({ blockfrostProjectId: 'nightpreprod-test-token', mode: 'local-circuits', bridge: stubBridge() });
  const p = await k.proveAgeOver(b, 1990, 18, 2026, 'salt');
  assert.equal(p.backend, 'midnight');
  assert.equal(p.zk, true);
  assert.ok(await b.verify(p));
  await assert.rejects(k.proveAgeOver(b, 2012, 18, 2026, 'salt'));
});

test('MidnightBackend no longer throws deploy-wiring stub once configured', async () => {
  const b = new k.MidnightBackend({ blockfrostProjectId: 'nightpreprod-test-token', bridge: stubBridge() });
  const p = await k.proveBalanceAbove(b, 5000, 1000, 'salt');
  assert.equal(p.zk, true);
  assert.doesNotMatch(p.attestation ?? '', /run midnight\/deploy\.mjs/);
  assert.ok(await b.verify(p));
});

test('MidnightBackend preprod mode attaches contract address from deployments', async () => {
  const b = new k.MidnightBackend({ blockfrostProjectId: 'nightpreprod-test-token', mode: 'preprod', bridge: stubBridge() });
  const p = await k.proveCondition(b, 'delivered', 'salt', k.commit('delivered', 'salt'));
  assert.equal(p.zk, true);
  const att = JSON.parse(Buffer.from(p.attestation, 'base64url').toString('utf8'));
  assert.equal(att.contractAddress, '45563d2ede4887717968e51405bc4d9993dd7082959c59cda72755c500cd52f5');
  assert.ok(await b.verify(p));
});

test('MidnightBackend.submitOnChain uses bridge submitCallTx (mocked, no network)', async () => {
  const b = new k.MidnightBackend({ blockfrostProjectId: 'nightpreprod-test-token', mode: 'preprod', bridge: stubBridge() });
  const claim = { kind: 'ageOver', minAge: 18, asOfYear: 2026, commitment: k.commit(1990, 'salt') };
  const out = await b.submitOnChain({
    claim,
    witness: { kind: 'ageOver', birthYear: 1990, salt: 'salt' },
  });
  assert.equal(out.template, 'age_over');
  assert.equal(out.circuit, 'prove');
  assert.equal(out.contractAddress, '3458e15536314cd6ed68d20aecec14c66f3d786ad09a871cf057949170ec2367');
  assert.equal(out.txHash, 'aabb'.repeat(16));
  assert.equal(out.proof.zk, true);
  const att = JSON.parse(Buffer.from(out.proof.attestation, 'base64url').toString('utf8'));
  assert.equal(att.onChainTxHash, out.txHash);
  assert.ok(await b.verify(out.proof));
});

test('MidnightBackend.submitOnChain requires config and witness', async () => {
  await assert.rejects(new k.MidnightBackend({}).submitOnChain({ claim: { kind: 'ageOver', minAge: 18, asOfYear: 2026, commitment: 'x' }, witness: { kind: 'ageOver', birthYear: 1990, salt: 's' } }), /blockfrostProjectId/);
  const b = new k.MidnightBackend({ blockfrostProjectId: 'nightpreprod-test-token', bridge: stubBridge() });
  await assert.rejects(b.submitOnChain({ claim: { kind: 'ageOver', minAge: 18, asOfYear: 2026, commitment: 'x' } }), /witness/);
});
