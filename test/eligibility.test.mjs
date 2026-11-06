import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { encodeAccountID } from 'xrpl';

let elig;
try {
  elig = await import('../midnight/eligibility.mjs');
} catch (err) {
  test('eligibility circuit', { skip: `midnight runtime not installed (${err.message}). Run: cd midnight && npm ci` }, () => {});
}

const AS_OF = 1_700_000_000n;
const EXPIRY = 1_800_000_000n;
const OWNER = Buffer.alloc(20, 0x11);
const DESTINATION = Buffer.alloc(20, 0x22);

function holder() {
  return new Uint8Array(crypto.randomBytes(32));
}

function escrow(over = {}) {
  return {
    owner: over.owner ?? OWNER,
    offerSequence: over.offerSequence ?? 17,
    destination: over.destination ?? DESTINATION,
  };
}

async function issued(overrides = {}) {
  const issuer = overrides.issuer ?? elig.createMockIssuer();
  const holderSecret = overrides.holderSecret ?? holder();
  const credential = elig.issueMockCredential(issuer, {
    holderSecret,
    credentialType: overrides.credentialType ?? 'kyc-pass',
    expiry: overrides.expiry ?? EXPIRY,
  });
  const bound = elig.createBoundPreimage();
  return { issuer, holderSecret, credential, bound, escrow: escrow(overrides.escrow) };
}

function run(parts, extra = {}) {
  return elig.runEligibility({
    issuer: extra.chainIssuer ? parts.issuer : parts.issuer,
    chainIssuer: extra.chainIssuer,
    credential: extra.credential ?? parts.credential,
    holderSecret: extra.holderSecret ?? parts.holderSecret,
    asOf: extra.asOf ?? AS_OF,
    preimageCommit: extra.preimageCommit ?? parts.bound.preimageCommit,
    escrow: extra.escrow ?? parts.escrow,
    only: extra.only,
    reveal: extra.reveal,
    releasePreimage: extra.releasePreimage,
    again: extra.again,
  });
}

function expectRelease(parts, over = {}) {
  return {
    condition: over.condition ?? parts.bound.condition,
    owner: over.owner ?? parts.escrow.owner,
    offerSequence: over.offerSequence ?? parts.escrow.offerSequence,
    destination: over.destination ?? parts.escrow.destination,
  };
}

if (elig) {
  test('mock issuer record is labeled and does not contain the holder secret', async () => {
    const { credential, holderSecret } = await issued();
    assert.equal(credential.mock, true);
    assert.match(credential.label, /MOCK ISSUER/);
    assert.match(credential.alignment, /XLS-70/);
    assert.equal(credential.CredentialType, 'kyc-pass');
    assert.equal(typeof credential.Subject.commitmentHex, 'string');
    const blob = JSON.stringify(credential);
    assert.equal(blob.includes(Buffer.from(holderSecret).toString('hex')), false);
    assert.equal('secretKey' in credential, false);
  });

  test('classic XRPL addresses encode to the same account ids as raw bytes', () => {
    const binding = elig.encodeEscrowBinding({
      owner: encodeAccountID(OWNER),
      offerSequence: 17,
      destination: encodeAccountID(DESTINATION),
    });
    assert.ok(elig.bytesEqual(binding.owner, elig.encodeAccountId(OWNER)));
    assert.ok(elig.bytesEqual(binding.destination, elig.encodeAccountId(DESTINATION)));
    assert.equal(binding.offerSequence, 17n);
  });

  test('valid credential proves once for one escrow and reveals that preimage only', async () => {
    const parts = await issued();
    const proved = await run(parts);
    assert.equal(proved.ledger.proven, true);
    assert.equal(proved.ledger.preimageRevealed, false);
    assert.equal(proved.ledger.offerSequence, '17');
    assert.equal(proved.ledger.escrowOwner, Buffer.from(elig.encodeAccountId(OWNER)).toString('hex'));
    assert.equal(JSON.stringify(proved.ledger).includes(Buffer.from(parts.holderSecret).toString('hex')), false);
    assert.equal(JSON.stringify(proved.ledger).includes(parts.credential.Subject.commitmentHex), false);
    assert.ok(
      elig.bytesEqual(
        proved.rawLedger.nullifier,
        elig.nullifierFor(parts.holderSecret, 'kyc-pass', parts.escrow, parts.bound.preimageCommit)
      )
    );
    assert.throws(() => elig.fulfillmentFromRevealedLedger(proved.rawLedger, expectRelease(parts)), /not on contract state/);

    const otherEscrow = escrow({ offerSequence: 18 });
    assert.equal(
      elig.bytesEqual(
        proved.rawLedger.nullifier,
        elig.nullifierFor(parts.holderSecret, 'kyc-pass', otherEscrow, parts.bound.preimageCommit)
      ),
      false
    );

    await assert.rejects(run(parts, { again: true }), /already proven/);

    const revealed = await run(parts, { reveal: true, releasePreimage: parts.bound.preimage });
    const rel = elig.fulfillmentFromRevealedLedger(revealed.rawLedger, expectRelease(parts));
    assert.equal(rel.condition, parts.bound.condition);
    assert.equal(rel.fulfillment, parts.bound.fulfillment);
    assert.match(rel.condition, /^A0258020[0-9A-F]{64}810120$/);
    assert.throws(
      () => elig.fulfillmentFromRevealedLedger(revealed.rawLedger, expectRelease(parts, { offerSequence: 99 })),
      /offer sequence/
    );
    assert.throws(
      () =>
        elig.fulfillmentFromRevealedLedger(
          revealed.rawLedger,
          expectRelease(parts, { destination: Buffer.alloc(20, 0x33) })
        ),
      /destination/
    );
  });

  test('expired credential, wrong holder, wrong issuer, bad signature, and blank owner are rejected', async () => {
    const parts = await issued();
    await assert.rejects(run(parts, { asOf: EXPIRY + 1n }), /expired/);
    await assert.rejects(run(parts, { holderSecret: holder() }), /bad signature/);
    await assert.rejects(run(parts, { chainIssuer: elig.createMockIssuer() }), /bad signature/);
    const tampered = {
      ...parts.credential,
      signature: { ...parts.credential.signature, s: (BigInt(parts.credential.signature.s) + 1n).toString() },
    };
    await assert.rejects(run(parts, { credential: tampered }), /bad signature|EmbeddedFr|failed assert/);
    await assert.rejects(run(parts, { escrow: escrow({ owner: Buffer.alloc(20) }) }), /escrow owner required/);
  });

  test('reveal before prove is rejected and a wrong preimage or condition does not open the escrow', async () => {
    const parts = await issued();
    await assert.rejects(
      run(parts, { only: 'reveal', releasePreimage: parts.bound.preimage }),
      /eligibility not proven/
    );
    const other = elig.createBoundPreimage();
    await assert.rejects(
      run(parts, { reveal: true, releasePreimage: other.preimage }),
      /preimage mismatch/
    );
    const revealed = await run(parts, { reveal: true, releasePreimage: parts.bound.preimage });
    assert.throws(
      () => elig.fulfillmentFromRevealedLedger(revealed.rawLedger, expectRelease(parts, { condition: other.condition })),
      /does not open the XRPL escrow condition/
    );
  });

  test('releaser helper does not take the setup preimage as an input', async () => {
    const parts = await issued();
    const revealed = await run(parts, { reveal: true, releasePreimage: parts.bound.preimage });
    const rel = elig.fulfillmentFromRevealedLedger(revealed.rawLedger, expectRelease(parts));
    assert.equal(Object.hasOwn(rel, 'preimage'), false);
    assert.match(parts.bound.note, /setup party knows this preimage/);
  });
}
