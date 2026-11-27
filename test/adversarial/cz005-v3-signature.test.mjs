// CZ-005 / ADR-004: eligibility_v3 replaces the demo signature with the Compact standard library's
// jubjubSchnorrVerify, and credentials are signed with compact-runtime's jubjubSchnorrSign.
// Local fixtures only: the compiled eligibility_v3 circuit runs through compact-runtime. No network.
// These tests are evidence for review, not a substitute for the outside review in ADR-004.
import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { encodeAccountID } from 'xrpl';

let elig, rt;
try {
  elig = await import('../../midnight/eligibility.mjs');
  rt = createRequire(new URL('../../midnight/package.json', import.meta.url))('@midnight-ntwrk/compact-runtime');
} catch (err) {
  if (process.env.CORVUSZK_REQUIRE_MIDNIGHT) throw err;
  test('CZ-005 v3 suite', { skip: `midnight runtime missing (${err.message})` }, () => {});
}

if (elig) {
  const OWNER = Buffer.alloc(20, 0x11), DEST = Buffer.alloc(20, 0x22);
  const escrow = { owner: OWNER, offerSequence: 17, destination: DEST };
  const asOf = 1_700_000_000n;
  const intentHash = new Uint8Array(crypto.randomBytes(32));

  async function run(o) {
    const sampled = elig.samplePreimage('payer');
    return elig.runEligibility({
      contractVersion: 3, intentHash, asOf, preimageCommit: sampled.publicTerms.preimageCommit, escrow,
      reveal: o.reveal ?? false, releasePreimage: sampled.holder.preimage, ...o,
    });
  }
  const fresh = async (over = {}) => {
    const issuer = over.issuer ?? elig.createIssuerV3();
    const holderSecret = over.holderSecret ?? new Uint8Array(crypto.randomBytes(32));
    const credential = await elig.issueCredentialV3(issuer, { holderSecret, credentialType: 'kyc-pass', expiry: 1_800_000_000n });
    return { issuer, holderSecret, credential };
  };

  test('v3: a standard-library signed credential proves and reveals', async () => {
    const { issuer, holderSecret, credential } = await fresh();
    assert.equal(await elig.verifyCredentialV3(credential, issuer.publicKey), true);
    const r = await run({ issuer, credential, holderSecret, reveal: true });
    assert.equal(r.ledger.proven, true);
    assert.equal(r.ledger.preimageRevealed, true);
    assert.equal(r.ledger.intentHash, Buffer.from(intentHash).toString('hex'));
    assert.match(r.ledger.credentialNullifier, /^[0-9a-f]{64}$/);
  });

  test('v3: the record carries no secret key and no holder secret', async () => {
    const { issuer, holderSecret, credential } = await fresh();
    const s = JSON.stringify(credential);
    assert.ok(!s.includes(issuer.secretKey.toString()));
    assert.ok(!s.includes(Buffer.from(holderSecret).toString('hex')));
  });

  const forgeries = {
    'a different issuer key is configured on-chain': async (f) => ({ ...f, chainIssuer: elig.createIssuerV3() }),
    'the expiry is edited': async (f) => ({ ...f, credential: { ...f.credential, Expiration: '1900000000' } }),
    'the credential type is edited': async (f) => ({ ...f, credential: { ...f.credential, CredentialType: 'accredited' } }),
    'another holder presents the credential': async (f) => ({ ...f, holderSecret: new Uint8Array(crypto.randomBytes(32)) }),
    'the response is malleated (+1)': async (f) => ({ ...f, credential: { ...f.credential, signature: { ...f.credential.signature, response: (BigInt(f.credential.signature.response) + 1n).toString() } } }),
    'the announcement is swapped from another credential': async (f) => {
      const other = await fresh({ issuer: f.issuer });
      return { ...f, credential: { ...f.credential, signature: { ...f.credential.signature, announcementX: other.credential.signature.announcementX, announcementY: other.credential.signature.announcementY } } };
    },
  };
  for (const [name, mutate] of Object.entries(forgeries)) {
    test(`v3 refuses: ${name}`, async () => {
      const f = await mutate(await fresh());
      await assert.rejects(run({ issuer: f.issuer, chainIssuer: f.chainIssuer, credential: f.credential, holderSecret: f.holderSecret }), /bad signature|failed assert|range|expired|invalid|scalar/i);
    });
  }

  test('v3 refuses a missing signature', async () => {
    const f = await fresh();
    await assert.rejects(run({ ...f, credential: { ...f.credential, signature: undefined } }));
  });

  // Finding for the outside review: the stdlib verifier takes the response as a Field and does not
  // require it to be below the JubJub group order, so (R, s + n) also verifies. RFC 8032-style
  // canonical-S checks would reject it. Here it cannot be used to reuse or forge a credential:
  // nullifiers come from the holder secret, not from the signature bytes. Issuers and registries
  // must not use the signature bytes as an identifier.
  test('KNOWN (v3, for review): a non-canonical response (s + group order) also verifies', async () => {
    const f = await fresh();
    const sig = { ...f.credential.signature, response: (BigInt(f.credential.signature.response) + rt.JUBJUB_SCALAR_MODULUS).toString() };
    const r = await run({ ...f, credential: { ...f.credential, signature: sig } });
    assert.equal(r.ledger.proven, true);
    const canonical = await run({ ...f });
    assert.equal(r.ledger.credentialNullifier, canonical.ledger.credentialNullifier, 'same credential, same nullifier');
  });

  test('v3 refuses the identity point as the issuer key', async () => {
    const f = await fresh();
    await assert.rejects(run({ ...f, chainIssuer: { publicKey: { x: 0n, y: 1n } } }));
  });

  test('v3: the CZ-005 key-recovery attack does not work (signature scalar is reduced, nonce is full size)', async () => {
    const V5 = new rt.CompactTypeVector(5, rt.CompactTypeField);
    let recovered = 0, checked = 0;
    for (let i = 0; i < 5; i++) {
      const { issuer, holderSecret, credential } = await fresh();
      const [m] = await elig.credentialMessageV3({ credentialType: 'kyc-pass', subject: elig.subjectCommit(holderSecret), expiry: 1_800_000_000n });
      const R = { x: BigInt(credential.signature.announcementX), y: BigInt(credential.signature.announcementY) };
      const s = BigInt(credential.signature.response);
      assert.ok(s < rt.JUBJUB_SCALAR_MODULUS, 'response is reduced mod the JubJub group order');
      // Challenge as documented by compact-runtime: Poseidon(R.x, R.y, pk.x, pk.y, msg).
      const c = rt.transientHash(V5, [R.x, R.y, issuer.publicKey.x, issuer.publicKey.y, m]) % rt.JUBJUB_SCALAR_MODULUS;
      const lhs = rt.ecMulGenerator(s);
      const rhs = rt.ecAdd(R, rt.ecMul(issuer.publicKey, c));
      if (lhs.x !== rhs.x || lhs.y !== rhs.y) continue;
      checked++;
      // The v1 attack: sk ~ s / e (integer division), searched in a small window.
      const base = s / c;
      for (let d = 0n; d <= 64n && base - d > 0n; d++) {
        const P = rt.ecMulGenerator(base - d);
        if (P.x === issuer.publicKey.x && P.y === issuer.publicKey.y) { recovered++; break; }
      }
    }
    assert.equal(checked, 5, 'challenge derivation matches the compact-runtime documentation');
    assert.equal(recovered, 0);
  });

  test('v1 and v2 still run unchanged (recorded demo stays valid)', async () => {
    const issuer = elig.createMockIssuer();
    const holderSecret = new Uint8Array(crypto.randomBytes(32));
    const credential = elig.issueMockCredential(issuer, { holderSecret, credentialType: 'kyc-pass', expiry: 1_800_000_000n });
    const sampled = elig.samplePreimage('payer');
    const r2 = await elig.runEligibility({ contractVersion: 2, intentHash, issuer, credential, holderSecret, asOf, preimageCommit: sampled.publicTerms.preimageCommit, escrow });
    assert.equal(r2.ledger.proven, true);
    const r1 = await elig.runEligibility({ issuer, credential, holderSecret, asOf, preimageCommit: sampled.publicTerms.preimageCommit, escrow });
    assert.equal(r1.ledger.proven, true);
  });
}
