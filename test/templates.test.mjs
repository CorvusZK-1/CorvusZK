// Contract simulator tests for the three claim templates (condition, age_over,
// balance_above), plus the eligibility contract driven through the typed
// witnesses in midnight/witnesses.ts.
//
// These run the compiled Compact 0.36.0 circuits locally with compact-runtime
// 0.21.0 (the same JavaScript the proof server and Preprod use). They check
// constraints and ledger updates. They do not produce a zero-knowledge proof
// and they do not touch any network or wallet.
//
// Needs: cd midnight && npm ci, and Node >= 22.18 (runs midnight/witnesses.ts
// with built-in type stripping). On older setups the suite is skipped, unless
// CORVUSZK_REQUIRE_MIDNIGHT=1 (set in CI), which turns a skip into a failure.
import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

let rt, W, elig;
const managed = (name) => import(`../midnight/managed/${name}/contract/index.js`);
try {
  rt = await import('../midnight/node_modules/@midnight-ntwrk/compact-runtime/dist/index.js');
  W = await import('../midnight/witnesses.ts');
  elig = await import('../midnight/eligibility.mjs');
} catch (err) {
  if (process.env.CORVUSZK_REQUIRE_MIDNIGHT) throw err;
  test('contract simulator tests', { skip: `midnight runtime or .ts support missing (${err.message}). Run: cd midnight && npm ci (Node >= 22.18)` }, () => {});
}

const ZERO_KEY = '0'.repeat(64);

/** Deploy locally: run the contract constructor with an initial private state. */
async function deploy(m, witnesses, privateState, ...args) {
  const C = new m.Contract(witnesses);
  const r = await C.initialState(rt.createConstructorContext(privateState, ZERO_KEY), ...args);
  return { C, state: r.currentContractState, privateState: r.currentPrivateState };
}

/** Call one circuit against a contract state with a given private state. Returns the new public ledger. */
async function call(m, C, contractState, privateState, circuit) {
  const addr = rt.dummyContractAddress();
  const ctx = rt.createCircuitContext({ circuitId: circuit, contractAddress: addr, coinPublicKeyOrZswapState: ZERO_KEY, contractState, privateState });
  const r = await C.circuits[circuit](ctx);
  const state = r.context.queryContexts[addr].state;
  return { state, ledger: m.ledger(state) };
}

const salt = () => new Uint8Array(crypto.randomBytes(32));
// Field -> Bytes<32> cast in Compact is little-endian; this matches `x as Field as Bytes<32>`.
const fieldBytes = (n) => { const b = Buffer.alloc(32); b.writeBigUInt64LE(BigInt(n)); return new Uint8Array(b); };
const commit2 = (s, n) => rt.persistentHash(new rt.CompactTypeVector(2, new rt.CompactTypeBytes(32)), [s, fieldBytes(n)]);
const hex = (u8) => Buffer.from(u8).toString('hex');

if (rt) {
  // ------------------------------------------------------------- condition
  test('condition: the attester with the right secret releases once', async () => {
    const m = await managed('condition');
    const secret = salt();
    const ps = W.createConditionPrivateState(secret, true);
    const commit = rt.persistentHash(new rt.CompactTypeBytes(32), secret);
    const escrowId = salt();
    const d = await deploy(m, W.conditionWitnesses, ps, commit, escrowId);
    assert.equal(m.ledger(d.state.data).released, false);
    const r = await call(m, d.C, d.state, ps, 'attest');
    assert.equal(r.ledger.released, true);
    assert.equal(hex(r.ledger.escrowId), hex(escrowId));
    // Second attest on the released state is refused.
    await assert.rejects(call(m, d.C, r.state, ps, 'attest'), /already released/);
    // The attester secret never appears in public state; only its hash does.
    assert.notEqual(hex(r.ledger.attesterCommit), hex(secret));
  });

  test('condition: a wrong secret is refused', async () => {
    const m = await managed('condition');
    const secret = salt();
    const commit = rt.persistentHash(new rt.CompactTypeBytes(32), secret);
    const d = await deploy(m, W.conditionWitnesses, W.createConditionPrivateState(secret), commit, salt());
    await assert.rejects(call(m, d.C, d.state, W.createConditionPrivateState(salt(), true), 'attest'), /not the attester/);
  });

  test('condition: the right attester saying "not delivered" is refused', async () => {
    const m = await managed('condition');
    const secret = salt();
    const commit = rt.persistentHash(new rt.CompactTypeBytes(32), secret);
    const d = await deploy(m, W.conditionWitnesses, W.createConditionPrivateState(secret), commit, salt());
    await assert.rejects(call(m, d.C, d.state, W.createConditionPrivateState(secret, false), 'attest'), /condition not met/);
  });

  // ------------------------------------------------------------- age_over
  test('age_over: born 1990, 18+ as of 2026 is proven without the birth year on the ledger', async () => {
    const m = await managed('age_over');
    const s = salt();
    const ps = W.createAgeOverPrivateState(1990, s);
    const d = await deploy(m, W.ageOverWitnesses, ps, 18n, 2026n, commit2(s, 1990));
    const r = await call(m, d.C, d.state, ps, 'prove');
    assert.equal(r.ledger.proven, true);
    assert.equal(r.ledger.minAge, 18n);
    assert.equal(r.ledger.asOfYear, 2026n);
    assert.deepEqual(Object.keys(r.ledger).sort(), ['asOfYear', 'birthCommit', 'minAge', 'proven']);
  });

  test('age_over: exactly the minimum age passes (boundary)', async () => {
    const m = await managed('age_over');
    const s = salt();
    const ps = W.createAgeOverPrivateState(2008, s);
    const d = await deploy(m, W.ageOverWitnesses, ps, 18n, 2026n, commit2(s, 2008));
    assert.equal((await call(m, d.C, d.state, ps, 'prove')).ledger.proven, true);
  });

  test('age_over: under age is refused', async () => {
    const m = await managed('age_over');
    const s = salt();
    const ps = W.createAgeOverPrivateState(2012, s);
    const d = await deploy(m, W.ageOverWitnesses, ps, 18n, 2026n, commit2(s, 2012));
    await assert.rejects(call(m, d.C, d.state, ps, 'prove'), /under age/);
  });

  test('age_over: lying about the birth year (commitment mismatch) is refused', async () => {
    const m = await managed('age_over');
    const s = salt();
    const d = await deploy(m, W.ageOverWitnesses, W.createAgeOverPrivateState(2012, s), 18n, 2026n, commit2(s, 2012));
    await assert.rejects(call(m, d.C, d.state, W.createAgeOverPrivateState(1980, s), 'prove'), /commitment mismatch/);
  });

  // ------------------------------------------------------------- balance_above
  test('balance_above: 5000 > 1000 is proven without the balance on the ledger', async () => {
    const m = await managed('balance_above');
    const s = salt();
    const ps = W.createBalanceAbovePrivateState(5000, s);
    const d = await deploy(m, W.balanceAboveWitnesses, ps, 1000n, commit2(s, 5000));
    const r = await call(m, d.C, d.state, ps, 'prove');
    assert.equal(r.ledger.proven, true);
    assert.equal(r.ledger.threshold, 1000n);
    assert.deepEqual(Object.keys(r.ledger).sort(), ['balanceCommit', 'proven', 'threshold']);
  });

  test('balance_above: equal to the threshold is refused (strictly above)', async () => {
    const m = await managed('balance_above');
    const s = salt();
    const ps = W.createBalanceAbovePrivateState(1000, s);
    const d = await deploy(m, W.balanceAboveWitnesses, ps, 1000n, commit2(s, 1000));
    await assert.rejects(call(m, d.C, d.state, ps, 'prove'), /balance not above threshold/);
  });

  test('balance_above: lying about the balance (commitment mismatch) is refused', async () => {
    const m = await managed('balance_above');
    const s = salt();
    const d = await deploy(m, W.balanceAboveWitnesses, W.createBalanceAbovePrivateState(10, s), 1000n, commit2(s, 10));
    await assert.rejects(call(m, d.C, d.state, W.createBalanceAbovePrivateState(999999, s), 'prove'), /commitment mismatch/);
  });

  // ------------------------------------------------------------- eligibility via typed witnesses
  test('eligibility: typed witnesses drive prove then reveal; reveal before prove is refused', async () => {
    const m = await managed('eligibility');
    const issuer = elig.createMockIssuer();
    const holderSecret = salt();
    const expiry = 1_800_000_000n;
    const credential = elig.issueMockCredential(issuer, { holderSecret, credentialType: 'kyc-pass', expiry });
    const bound = elig.createBoundPreimage();
    const escrow = { owner: Buffer.alloc(20, 0x11), offerSequence: 17, destination: Buffer.alloc(20, 0x22) };
    const args = elig.eligibilityDeployArgs({ issuer, credentialType: 'kyc-pass', asOf: 1_700_000_000n, preimageCommit: bound.preimageCommit, escrow });

    const proverState = W.createEligibilityPrivateState({ holderSecret, expiry, signature: credential.signature });
    const d = await deploy(m, W.eligibilityWitnesses, proverState, ...args);

    const revealerState = W.createEligibilityPrivateState({ holderSecret, expiry, signature: credential.signature, releasePreimage: bound.preimage });
    await assert.rejects(call(m, d.C, d.state, revealerState, 'reveal'));

    const p = await call(m, d.C, d.state, proverState, 'prove');
    assert.equal(p.ledger.proven, true);
    assert.equal(p.ledger.preimageRevealed, false);
    assert.equal(hex(p.ledger.nullifier), hex(elig.nullifierFor(holderSecret, 'kyc-pass', escrow, bound.preimageCommit)));

    const r = await call(m, d.C, p.state, revealerState, 'reveal');
    assert.equal(r.ledger.preimageRevealed, true);
    assert.equal(hex(r.ledger.revealedPreimage), hex(bound.preimage));
  });
}
