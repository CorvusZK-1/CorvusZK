// PR-6 (CZ-004, CZ-005): trust-mode labelling and characterization tests for known residual risks.
// "KNOWN" tests pass while the documented weakness exists. They are evidence, not endorsements.
import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as k from '../../dist/index.js';

let elig, rt;
try {
  elig = await import('../../midnight/eligibility.mjs');
  rt = createRequire(new URL('../../midnight/package.json', import.meta.url))('@midnight-ntwrk/compact-runtime');
} catch (err) {
  if (process.env.CORVUSZK_REQUIRE_MIDNIGHT) throw err;
  test('trust-model suite', { skip: `midnight runtime missing (${err.message})` }, () => {});
}

test('ADR-001: strict release requires the explicit trusted-policy-party mode', async () => {
  for (const trustMode of [undefined, 'trustless', 'xrpl-enforced']) {
    const r = await k.releaseStrict({ client: {}, submitter: {}, backend: {}, registry: new k.MemoryPolicyRegistry(), intent: {}, contractAddress: 'ab', trustMode });
    assert.equal(r.status, 'refused');
    assert.match(r.reason, /trust-mode/);
  }
  assert.equal(k.TRUST_MODE, 'trusted-policy-party');
  assert.match(k.TRUST_MODE_DISCLOSURE, /XRPL does not verify/);
});

test('ADR-001/CZ-005: strict release refuses mainnet while only the mock issuer exists', async () => {
  const v = (await import('../vectors/intent-v2.json', { with: { type: 'json' } })).default.vectors[0].intent;
  const r = await k.releaseStrict({ client: {}, submitter: {}, backend: {}, registry: new k.MemoryPolicyRegistry(), intent: { ...v, environment: 'mainnet' }, contractAddress: 'ab', trustMode: 'trusted-policy-party' });
  assert.equal(r.status, 'refused');
  assert.match(r.reason, /mainnet-not-supported/);
  const r2 = await k.releaseStrict({ client: {}, submitter: {}, backend: {}, registry: new k.MemoryPolicyRegistry(), intent: { ...v, midnightNetwork: 'mainnet' }, contractAddress: 'ab', trustMode: 'trusted-policy-party' });
  assert.match(r2.reason, /mainnet-not-supported/);
});

if (elig) {
  test('ADR-001 default: the payer-side policy party samples the preimage', () => {
    const s = elig.samplePreimage();
    assert.equal(s.role, 'payer');
    assert.match(s.trust, /policy party/i);
  });

  test('KNOWN (CZ-004): the preimage holder can finish the escrow with no Midnight step', () => {
    const s = elig.samplePreimage('payer');
    assert.equal(k.conditionFromFulfillment(s.holder.fulfillment), s.publicTerms.condition);
  });

  test('CZ-005: mock issuer and credentials are labelled insecure and test-only', () => {
    const issuer = elig.createMockIssuer();
    assert.equal(issuer.testOnly, true);
    assert.match(issuer.label, /recover/i);
    const cred = elig.issueMockCredential(issuer, { holderSecret: new Uint8Array(32).fill(3), credentialType: 'kyc-pass', expiry: 10n });
    assert.equal(cred.testOnly, true);
    assert.match(cred.label, /INSECURE/);
  });

  test('KNOWN (CZ-005): a holder recovers the mock issuer key from one credential', () => {
    const V8 = new rt.CompactTypeVector(8, new rt.CompactTypeBytes(32));
    let recovered = 0;
    for (let i = 0; i < 5; i++) {
      const issuer = elig.createMockIssuer();
      const holderSecret = new Uint8Array(crypto.randomBytes(32));
      const cred = elig.issueMockCredential(issuer, { holderSecret, credentialType: 'kyc-pass', expiry: 1_800_000_000n });
      const nonce = { x: BigInt(cred.signature.nonceX), y: BigInt(cred.signature.nonceY) };
      const msg = new Uint8Array(rt.persistentHash(V8, [elig.pad32('corvuszk:elig:v1'), elig.pad32('kyc-pass'), elig.subjectCommit(holderSecret), elig.u64ToBytes32(1_800_000_000n), rt.upgradeFromTransient(nonce.x), rt.upgradeFromTransient(nonce.y), rt.upgradeFromTransient(issuer.publicKey.x), rt.upgradeFromTransient(issuer.publicKey.y)]));
      const e = elig.fold96(msg);
      const base = BigInt(cred.signature.s) / e;
      for (let d = 0n; d <= 64n && base - d > 0n; d++) {
        const P = elig.pointOf(base - d);
        if (P.x === issuer.publicKey.x && P.y === issuer.publicKey.y) { recovered++; break; }
      }
    }
    assert.equal(recovered, 5, 'if this fails, the mock signature changed: re-review CZ-005 and update the disclosure');
  });
}
