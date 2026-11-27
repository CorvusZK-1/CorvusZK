// P0 adversarial tests from the review baseline (review/review-baseline.md).
// Each test asserts the SAFE behaviour. Tests marked `todo` fail today and are tracked,
// not blocking; the PR that fixes a finding removes its `todo` marker.
// Local fixtures only: no network, no wallets, no real keys.
import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import * as k from '../../dist/index.js';

const TOKEN = 'nightpreprod-test-placeholder';

let bridge, elig;
try {
  bridge = await import('../../midnight/sdk-bridge.mjs');
  elig = await import('../../midnight/eligibility.mjs');
} catch (err) {
  if (process.env.CORVUSZK_REQUIRE_MIDNIGHT) throw err;
  test('adversarial P0 suite', { skip: `midnight runtime missing (${err.message}). Run: cd midnight && npm ci` }, () => {});
}

const okLocal = async ({ template, publicInputs }) => ({
  template,
  circuit: 'prove',
  commitmentHex: 'aa'.repeat(32),
  ledger: { proven: true, minAge: Number(publicInputs?.minAge), asOfYear: Number(publicInputs?.asOfYear) },
  transcriptHex: 'bb'.repeat(32),
});
const preprodBackend = (extra) =>
  new k.MidnightBackend({
    blockfrostProjectId: TOKEN,
    mode: 'preprod',
    bridge: { proveLocal: okLocal, loadDeployments: () => ({ deployments: { age_over: { contractAddress: 'ab'.repeat(32) } } }), ...extra },
  });

if (bridge) {
  // ---------------- CZ-001 ----------------
  test('CZ-001: a local-circuits run must not claim zero-knowledge evidence', async () => {
    const b = new k.MidnightBackend({ blockfrostProjectId: TOKEN, mode: 'local-circuits', proofServer: 'http://127.0.0.1:1' });
    const p = await k.proveAgeOver(b, 1990, 18, 2026, 'salt');
    assert.notEqual(p.zk, true);
    assert.equal(p.evidence, 'local-circuit-evaluation');
  });

  // ---------------- CZ-003 (a) ----------------
  test('CZ-003a: relabelling the outer claim must break verification', async () => {
    const b = new k.MidnightBackend({ blockfrostProjectId: TOKEN, mode: 'local-circuits' });
    const p = await k.proveAgeOver(b, 1990, 18, 2026, 'salt');
    const forged = structuredClone(p);
    forged.claim = { kind: 'balanceAbove', threshold: 1_000_000_000, commitment: '00'.repeat(32) };
    assert.equal(await b.verify(forged), false);
  });
  test('CZ-003b: editing a claim parameter must break verification', async () => {
    const b = new k.MidnightBackend({ blockfrostProjectId: TOKEN, mode: 'local-circuits' });
    const p = await k.proveAgeOver(b, 1990, 18, 2026, 'salt');
    const forged = structuredClone(p);
    forged.claim.minAge = 65;
    assert.equal(await b.verify(forged), false);
  });

  // ---------------- CZ-002 ----------------
  const failOpen = {
    'indexer throws': { verifyOnChainLedger: async () => { throw new Error('ETIMEDOUT'); } },
    'contract not found': { verifyOnChainLedger: async () => ({ found: false, ok: false }) },
    'no chain verifier available': {},
  };
  for (const [name, extra] of Object.entries(failOpen)) {
    test(`CZ-002: preprod verify must fail closed when ${name}`, { todo: 'CZ-002 (PR-4)' }, async () => {
      const b = preprodBackend(extra);
      const p = await k.proveAgeOver(b, 1990, 18, 2026, 'salt');
      assert.equal(await b.verify(p), false);
    });
  }

  // ---------------- CZ-003 (e) ----------------
  test('CZ-003f: releaser refuses a contract deployed with an unexpected issuer', { todo: 'CZ-003e (PR-5a)' }, async () => {
    const OWNER = Buffer.alloc(20, 0x11), DEST = Buffer.alloc(20, 0x22);
    const escrow = { owner: OWNER, offerSequence: 17, destination: DEST };
    const expectedIssuer = elig.createMockIssuer();
    const rogue = elig.createMockIssuer();
    const holderSecret = new Uint8Array(crypto.randomBytes(32));
    const cred = elig.issueMockCredential(rogue, { holderSecret, credentialType: 'anything', expiry: 1_800_000_000n });
    const b = elig.createBoundPreimage();
    const r = await elig.runEligibility({ issuer: rogue, credential: cred, holderSecret, asOf: 1_700_000_000n, preimageCommit: b.preimageCommit, escrow, reveal: true, releasePreimage: b.preimage });
    assert.throws(() =>
      elig.fulfillmentFromRevealedLedger(r.rawLedger, {
        ...escrow,
        condition: b.condition,
        issuer: expectedIssuer.publicKey,
        credentialType: 'kyc-pass',
        asOf: 1_700_000_000n,
      })
    );
  });

  // ---------------- CZ-008 (canonical encoding) ----------------
  test('CZ-008b: account ids with non-zero padding are refused', { todo: 'CZ-008b (PR-5a)' }, () => {
    assert.throws(() => elig.encodeAccountId(Buffer.alloc(32, 0x11)));
    assert.throws(() => elig.encodeAccountId('11'.repeat(32)));
  });
}

// ---------------- CZ-001 (evidence kinds) ----------------
test('CZ-001: every backend labels its evidence kind; only verified chain evidence may set zk', async () => {
  const sim = new k.LocalSimulationBackend();
  const p = await k.proveAgeOver(sim, 1990, 18, 2026, 's');
  assert.equal(p.evidence, 'simulation-attestation');
  assert.equal(p.zk, false);
  assert.equal(k.isVerifiedChainEvidence(p), false);
  // Relabelling a simulation proof as chain evidence must not verify.
  const forged = { ...p, evidence: 'verified-chain-evidence', zk: true };
  assert.equal(await sim.verify(forged), false);
});
test('CZ-001: unknown, malformed and oversized evidence is rejected', async () => {
  const b = new k.MidnightBackend({ blockfrostProjectId: TOKEN, mode: 'local-circuits', bridge: { proveLocal: okLocal } });
  const p = await k.proveAgeOver(b, 1990, 18, 2026, 'salt');
  assert.equal(await b.verify(p), true);
  assert.equal(await b.verify({ ...p, evidence: 'something-new' }), false);
  assert.equal(await b.verify({ ...p, evidence: 'verified-chain-evidence', zk: true }), false);
  assert.equal(await b.verify({ ...p, attestation: 'not base64 json' }), false);
  assert.equal(await b.verify({ ...p, attestation: 'A'.repeat(300_000) }), false);
  assert.equal(await b.verify(null), false);
});

// ---------------- CZ-003 (a): claim <-> signed circuit ledger ----------------
test('CZ-003a: claim parameters must match the circuit ledger that was signed', async () => {
  // A bridge that reports a different public parameter than the claim asked for.
  const lying = async ({ template }) => ({ template, circuit: 'prove', commitmentHex: 'aa'.repeat(32), ledger: { proven: true, minAge: 10, asOfYear: 2026 }, transcriptHex: 'bb'.repeat(32) });
  const b = new k.MidnightBackend({ blockfrostProjectId: TOKEN, mode: 'local-circuits', bridge: { proveLocal: lying } });
  await assert.rejects(k.proveAgeOver(b, 1990, 18, 2026, 'salt'), /does not match/);
});
test('CZ-003a: attestations without a signed claim (v1) are rejected', async () => {
  const b = new k.MidnightBackend({ blockfrostProjectId: TOKEN, mode: 'local-circuits', bridge: { proveLocal: okLocal } });
  const p = await k.proveAgeOver(b, 1990, 18, 2026, 'salt');
  const att = JSON.parse(Buffer.from(p.attestation, 'base64url').toString());
  assert.equal(att.v, 2);
  assert.deepEqual(att.claim, p.claim);
  const v1 = { ...att, v: 1 };
  delete v1.claim;
  assert.equal(await b.verify({ ...p, attestation: Buffer.from(JSON.stringify(v1)).toString('base64url') }), false);
});
