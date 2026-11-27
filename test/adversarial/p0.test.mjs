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
    'no contract address is configured': { loadDeployments: () => null, verifyOnChainLedger: async () => ({ found: true, ok: true }) },
  };
  for (const [name, extra] of Object.entries(failOpen)) {
    test(`CZ-002: preprod verify must fail closed when ${name}`, async () => {
      const b = preprodBackend(extra);
      const p = await k.proveAgeOver(b, 1990, 18, 2026, 'salt');
      assert.equal(await b.verify(p), false);
    });
  }

  // ---------------- CZ-003 (e) ----------------
  test('CZ-003f: releaser refuses a contract deployed with an unexpected issuer', async () => {
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
  test('CZ-008b: account ids with non-zero padding are refused', () => {
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

// ---------------- CZ-002: strict, typed chain verification ----------------
const ADDR = 'ab'.repeat(32);
const policy = (over = {}) => ({ network: 'preprod', template: 'age_over', contractAddress: ADDR, publicParams: { minAge: 18, asOfYear: 2026 }, ...over });
const chainOk = { found: true, ledger: { proven: true, minAge: '18', asOfYear: '2026' }, artifactMatch: true };
const strictBackend = (readContractEvidence) =>
  preprodBackend({ readContractEvidence, verifyOnChainLedger: async () => ({ found: true, ok: true }) });

test('CZ-002 strict: verified chain evidence for the intended contract passes', async () => {
  const b = strictBackend(async () => chainOk);
  const p = await k.proveAgeOver(b, 1990, 18, 2026, 'salt');
  const r = await b.verifyStrict(p, policy());
  assert.equal(r.status, 'verified', r.reason);
  assert.equal(r.evidence.kind, 'verified-chain-evidence');
  assert.equal(r.evidence.contractAddress, ADDR);
});

const strictCases = [
  ['indexer timeout', async () => new Promise(() => {}), policy({ timeoutMs: 50 }), 'unavailable'],
  ['indexer error', async () => { throw new Error('ECONNRESET'); }, policy(), 'unavailable'],
  ['missing contract', async () => ({ found: false }), policy(), 'unavailable'],
  ['wrong network', async () => chainOk, policy({ network: 'mainnet' }), 'rejected'],
  ['different contract than the proof names', async () => chainOk, policy({ contractAddress: 'cd'.repeat(32) }), 'rejected'],
  ['incompatible artifact', async () => ({ ...chainOk, artifactMatch: false }), policy(), 'rejected'],
  ['artifact cannot be checked', async () => ({ ...chainOk, artifactMatch: null }), policy(), 'unavailable'],
  ['wrong public parameters on chain', async () => ({ ...chainOk, ledger: { ...chainOk.ledger, minAge: '16' } }), policy(), 'rejected'],
  ['predicate not proven yet', async () => ({ ...chainOk, ledger: { ...chainOk.ledger, proven: false } }), policy(), 'pending'],
  ['stale evidence', async () => chainOk, policy({ maxEvidenceAgeMs: -1 }), 'expired'],
  ['wrong template', async () => chainOk, policy({ template: 'balance_above', publicParams: { threshold: 1 } }), 'rejected'],
];
for (const [name, read, pol, want] of strictCases) {
  test(`CZ-002 strict: ${name} -> ${want}, never verified`, async () => {
    const b = strictBackend(read);
    const p = await k.proveAgeOver(b, 1990, 18, 2026, 'salt');
    const r = await b.verifyStrict(p, pol);
    assert.equal(r.status, want, r.reason);
    assert.equal(r.evidence, undefined);
    assert.equal(typeof r.reason, 'string');
  });
}
test('CZ-002 strict: no chain reader in the bridge -> unavailable; simulation evidence -> rejected', async () => {
  const b = preprodBackend({});
  const p = await k.proveAgeOver(b, 1990, 18, 2026, 'salt');
  assert.equal((await b.verifyStrict(p, policy())).status, 'unavailable');
  const sim = await k.proveAgeOver(new k.LocalSimulationBackend(), 1990, 18, 2026, 's');
  assert.equal((await strictBackend(async () => chainOk).verifyStrict(sim, policy())).status, 'rejected');
});

if (bridge) {
  test('CZ-002 bridge: readContractEvidence refuses unknown state shapes and compares verifier keys', async () => {
    await assert.rejects(
      bridge.readContractEvidence({ template: 'age_over', contractAddress: ADDR, deps: { queryContractState: async () => ({ data: {} }) } }),
      /unrecognized contract state/
    );
    const fs = await import('node:fs');
    const localVk = fs.readFileSync(new URL('../../midnight/managed/age_over/keys/prove.verifier', import.meta.url));
    const fakeState = (vk) => ({ contractState: { deserialize: () => ({ data: 'D', operation: () => (vk ? { verifierKey: vk } : undefined) }) } });
    const deps = (vk) => ({ queryContractState: async () => fakeState(vk), loadContract: async () => ({ ledger: () => ({ proven: true, minAge: 18n, asOfYear: 2026n, birthCommit: new Uint8Array(32) }) }) });
    const same = await bridge.readContractEvidence({ template: 'age_over', contractAddress: ADDR, deps: deps(new Uint8Array(localVk)) });
    assert.equal(same.found, true);
    assert.equal(same.artifactMatch, true);
    assert.equal(same.ledger.minAge, '18');
    const other = await bridge.readContractEvidence({ template: 'age_over', contractAddress: ADDR, deps: deps(new Uint8Array(localVk.length).fill(1)) });
    assert.equal(other.artifactMatch, false);
    const none = await bridge.readContractEvidence({ template: 'age_over', contractAddress: ADDR, deps: deps(null) });
    assert.equal(none.artifactMatch, null);
    const missing = await bridge.readContractEvidence({ template: 'age_over', contractAddress: ADDR, deps: { queryContractState: async () => null } });
    assert.equal(missing.found, false);
  });
}

// ---------------- CZ-003 (e): releaser must check the expected policy ----------------
if (elig) {
  test('CZ-003e: releaser requires and checks expected issuer, credential type and asOf', async () => {
    const OWNER = Buffer.alloc(20, 0x11), DEST = Buffer.alloc(20, 0x22);
    const escrow = { owner: OWNER, offerSequence: 17, destination: DEST };
    const issuer = elig.createMockIssuer();
    const holderSecret = new Uint8Array(crypto.randomBytes(32));
    const cred = elig.issueMockCredential(issuer, { holderSecret, credentialType: 'kyc-pass', expiry: 1_800_000_000n });
    const b = elig.createBoundPreimage();
    const r = await elig.runEligibility({ issuer, credential: cred, holderSecret, asOf: 1_700_000_000n, preimageCommit: b.preimageCommit, escrow, reveal: true, releasePreimage: b.preimage });
    const good = { ...escrow, condition: b.condition, issuer: issuer.publicKey, credentialType: 'kyc-pass', asOf: 1_700_000_000n };
    assert.equal(elig.fulfillmentFromRevealedLedger(r.rawLedger, good).fulfillment, b.fulfillment);
    assert.throws(() => elig.fulfillmentFromRevealedLedger(r.rawLedger, { ...good, issuer: undefined }), /issuer/);
    assert.throws(() => elig.fulfillmentFromRevealedLedger(r.rawLedger, { ...good, credentialType: undefined }), /credential type/);
    assert.throws(() => elig.fulfillmentFromRevealedLedger(r.rawLedger, { ...good, asOf: undefined }), /asOf/);
    assert.throws(() => elig.fulfillmentFromRevealedLedger(r.rawLedger, { ...good, credentialType: 'accredited' }), /credential type/);
    assert.throws(() => elig.fulfillmentFromRevealedLedger(r.rawLedger, { ...good, asOf: 1n }), /asOf/);
    // Canonical 32-byte account ids (20 bytes + 12 zero bytes) are still accepted.
    const padded = Buffer.alloc(32); OWNER.copy(padded);
    assert.ok(elig.bytesEqual(elig.encodeAccountId(padded), elig.encodeAccountId(OWNER)));
  });
}
