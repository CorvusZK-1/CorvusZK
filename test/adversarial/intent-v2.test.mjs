// PR-5b (CZ-003 b-d, CZ-008): canonical IntentV2, policy registry and strict release.
// Real eligibility_v2 circuit via compact-runtime; XRPL and the indexer are local fakes.
import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeAccountID } from 'xrpl';
import * as k from '../../dist/index.js';

let elig, bridge;
try {
  elig = await import('../../midnight/eligibility.mjs');
  bridge = await import('../../midnight/sdk-bridge.mjs');
} catch (err) {
  if (process.env.CORVUSZK_REQUIRE_MIDNIGHT) throw err;
  test('intent-v2 suite', { skip: `midnight runtime missing (${err.message})` }, () => {});
}

const vectors = JSON.parse(fs.readFileSync(new URL('../vectors/intent-v2.json', import.meta.url)));
const OWNER = encodeAccountID(Buffer.alloc(20, 0x11));
const DEST = encodeAccountID(Buffer.alloc(20, 0x22));
const OTHER = encodeAccountID(Buffer.alloc(20, 0x33));
const RIPPLE_EPOCH = 946684800;
const nowSec = () => Math.floor(Date.now() / 1000);

test('IntentV2: canonical encoding matches the committed test vector', () => {
  for (const v of vectors.vectors) {
    assert.equal(k.intentHashV2(v.intent), v.intentHash, v.name);
    assert.equal(k.encodeIntentV2(v.intent).toString('hex'), v.encodingHex, v.name);
  }
});

test('IntentV2: every field changes the hash', () => {
  const base = vectors.vectors[0].intent;
  const h0 = k.intentHashV2(base);
  const mutate = {
    environment: 'local', xrplNetworkId: 2, owner: OTHER, offerSequence: 18, destination: OTHER, destinationTag: 7,
    asset: 'XRP', amountDrops: '25000001', condition: 'A0258020' + 'CD'.repeat(32) + '810120', finishAfter: 5, cancelAfter: base.cancelAfter + 1,
    midnightNetwork: 'local', circuitArtifactId: 'ee'.repeat(32), policyId: 'other-policy', policyVersion: 2,
    issuerX: 'ff', issuerY: 'ee', credentialType: 'accredited', asOf: '1', intentId: 'intent-other', issuedAt: base.issuedAt + 1, expiresAt: base.expiresAt + 1,
  };
  for (const [field, val] of Object.entries(mutate)) {
    if (base[field] === val) continue;
    assert.notEqual(k.intentHashV2({ ...base, [field]: val }), h0, field);
  }
});

test('IntentV2: malformed intents are rejected, not coerced', () => {
  const base = vectors.vectors[0].intent;
  const bad = [
    ['unknown field', { ...base, extra: 1 }],
    ['missing field', (({ intentId, ...r }) => r)(base)],
    ['negative amount', { ...base, amountDrops: '-1' }],
    ['fractional amount', { ...base, amountDrops: '1.5' }],
    ['number amount', { ...base, amountDrops: 25000000 }],
    ['leading zeros', { ...base, amountDrops: '025000000' }],
    ['amount above XRP supply', { ...base, amountDrops: '100000000000000001' }],
    ['non-XRP asset', { ...base, asset: 'USD' }],
    ['bad account', { ...base, owner: 'not-an-address' }],
    ['owner == destination', { ...base, destination: base.owner }],
    ['bad condition', { ...base, condition: 'zz' }],
    ['sequence out of range', { ...base, offerSequence: 2 ** 32 }],
    ['expires before issued', { ...base, expiresAt: base.issuedAt - 1 }],
    ['wrong protocol', { ...base, protocolVersion: 1 }],
    ['unsafe integer', { ...base, cancelAfter: 2 ** 53 }],
  ];
  for (const [name, i] of bad) assert.throws(() => k.intentHashV2(i), undefined, name);
});

if (elig) {
  const issuer = elig.createMockIssuer();
  const asOf = BigInt(nowSec());

  async function setup(over = {}) {
    const holderSecret = over.holderSecret ?? new Uint8Array(crypto.randomBytes(32));
    const credential = over.credential ?? elig.issueMockCredential(issuer, { holderSecret, credentialType: 'kyc-pass', expiry: asOf + 86400n });
    const sampled = elig.samplePreimage('payer');
    const seq = over.offerSequence ?? 17;
    const intent = {
      protocolVersion: 2, domain: 'corvuszk:intent:v2', environment: 'testnet', xrplNetworkId: 1,
      owner: OWNER, offerSequence: seq, destination: DEST, destinationTag: null,
      asset: 'XRP', amountDrops: '25000000', condition: sampled.publicTerms.condition,
      finishAfter: null, cancelAfter: nowSec() - RIPPLE_EPOCH + 86400,
      midnightNetwork: 'preprod', circuitArtifactId: bridge.circuitArtifactId('eligibility_v2'),
      policyId: 'corvuszk-test-policy', policyVersion: 1,
      issuerX: issuer.publicKey.x.toString(16), issuerY: issuer.publicKey.y.toString(16),
      credentialType: 'kyc-pass', asOf: asOf.toString(),
      intentId: over.intentId ?? 'intent-' + crypto.randomUUID(), issuedAt: nowSec(), expiresAt: nowSec() + 3600,
      ...(over.intent ?? {}),
    };
    const deployedIntent = over.deployedIntent ? { ...intent, ...over.deployedIntent } : intent;
    const run = await elig.runEligibility({
      contractVersion: 2, intentHash: Buffer.from(k.intentHashV2(deployedIntent), 'hex'),
      issuer, credential, holderSecret, asOf, preimageCommit: sampled.publicTerms.preimageCommit,
      escrow: { owner: OWNER, offerSequence: seq, destination: DEST }, reveal: true, releasePreimage: sampled.holder.preimage,
    });
    const contractAddress = crypto.randomBytes(32).toString('hex');
    return { holderSecret, credential, intent, run, contractAddress, sampled };
  }

  function backendFor(run, over = {}) {
    return new k.MidnightBackend({
      blockfrostProjectId: 'nightpreprod-test-placeholder', mode: 'preprod',
      bridge: { proveLocal: async () => { throw new Error('unused'); }, circuitArtifactId: bridge.circuitArtifactId, readContractEvidence: over.read ?? (async () => ({ found: true, ledger: bridge.plainLedger(run.rawLedger), artifactMatch: true })) },
    });
  }

  function fakeXrpl(intent, over = {}) {
    const sent = [];
    const node = { LedgerEntryType: 'Escrow', Account: intent.owner, Destination: intent.destination, Amount: intent.amountDrops, Condition: intent.condition, CancelAfter: intent.cancelAfter, ...(over.node ?? {}) };
    let fail = over.failSubmits ?? 0;
    return {
      sent,
      request: async (r) => {
        if (r.command === 'server_info') return { result: { info: { network_id: over.networkId ?? 1 } } };
        if (r.command === 'ledger_entry') {
          if (over.notFound) { const e = new Error('entryNotFound'); e.data = { error: 'entryNotFound' }; throw e; }
          assert.equal(r.ledger_index, 'validated');
          assert.equal(r.escrow.owner, intent.owner);
          return { result: { node, validated: true } };
        }
        throw new Error('unexpected ' + r.command);
      },
      submitAndWait: async (tx) => {
        if (fail-- > 0) throw new Error('socket closed');
        sent.push(tx);
        return { result: { hash: 'F'.repeat(64), validated: true, meta: { TransactionResult: 'tesSUCCESS' } } };
      },
    };
  }

  const wallet = { address: DEST };
  async function release(s, over = {}) {
    const registry = over.registry ?? new k.MemoryPolicyRegistry();
    if (!over.skipRegister) {
      registry.registerIntent(s.intent.intentId, k.intentHashV2(s.intent));
      registry.bindContract(s.intent.intentId, over.boundAddress ?? s.contractAddress);
    }
    const client = over.client ?? fakeXrpl(s.intent, over.xrpl);
    const r = await k.releaseStrict({ client, submitter: wallet, backend: over.backend ?? backendFor(s.run), registry, intent: s.intent, contractAddress: s.contractAddress, trustMode: 'trusted-policy-party' });
    return { r, client, registry };
  }

  test('strict release: approved intent settles once; retry is idempotent', async () => {
    const s = await setup();
    const { r, client, registry } = await release(s);
    assert.equal(r.status, 'settled', r.reason);
    assert.equal(client.sent.length, 1);
    assert.equal(client.sent[0].TransactionType, 'EscrowFinish');
    assert.equal(client.sent[0].OfferSequence, 17);
    assert.equal(client.sent[0].Fulfillment, s.sampled.holder.fulfillment);
    const again = await k.releaseStrict({ client, submitter: wallet, backend: backendFor(s.run), registry, intent: s.intent, contractAddress: s.contractAddress, trustMode: 'trusted-policy-party' });
    assert.equal(again.status, 'already-settled');
    assert.equal(client.sent.length, 1);
  });

  test('CZ-008: one credential may not authorize a second escrow', async () => {
    const registry = new k.MemoryPolicyRegistry();
    const first = await setup();
    assert.equal((await release(first, { registry })).r.status, 'settled');
    const second = await setup({ holderSecret: first.holderSecret, credential: first.credential, offerSequence: 18 });
    assert.equal(second.run.ledger.credentialNullifier, first.run.ledger.credentialNullifier);
    const { r, client } = await release(second, { registry });
    assert.equal(r.status, 'refused');
    assert.match(r.reason, /credential-already-used/);
    assert.equal(client.sent.length, 0);
  });

  test('CZ-008: credential reuse is still refused after a restart (file registry)', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'czk-reg-')), 'registry.json');
    const first = await setup();
    assert.equal((await release(first, { registry: new k.FilePolicyRegistry(file) })).r.status, 'settled');
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
    const second = await setup({ holderSecret: first.holderSecret, credential: first.credential, offerSequence: 19 });
    const { r } = await release(second, { registry: new k.FilePolicyRegistry(file) });
    assert.equal(r.status, 'refused');
    // The original intent is still idempotent after restart.
    const again = await release(first, { registry: new k.FilePolicyRegistry(file), skipRegister: true });
    assert.equal(again.r.status, 'already-settled');
  });

  const refusals = [
    ['contract deployed for a different intent (amount)', { deployedIntent: { amountDrops: '1' } }, {}, /intentHash/],
    ['contract deployed for a different destination tag', { deployedIntent: { destinationTag: 9 } }, {}, /intentHash/],
    ['XRPL escrow amount differs from intent', {}, { xrpl: { node: { Amount: '1' } } }, /escrow-mismatch:Amount/],
    ['XRPL escrow destination differs', {}, { xrpl: { node: { Destination: OTHER } } }, /escrow-mismatch:Destination/],
    ['XRPL escrow condition differs', {}, { xrpl: { node: { Condition: 'A0258020' + 'AB'.repeat(32) + '810120' } } }, /escrow-mismatch:Condition/],
    ['XRPL escrow CancelAfter differs', {}, { xrpl: { node: { CancelAfter: 5 } } }, /escrow-mismatch:CancelAfter/],
    ['XRPL network differs', {}, { xrpl: { networkId: 0 } }, /network/],
    ['registry bound to a different contract', {}, { boundAddress: 'ee'.repeat(32) }, /contract/],
    ['intent never registered', {}, { skipRegister: true }, /not-registered/],
  ];
  for (const [name, so, ro, re] of refusals) {
    test(`strict release refuses: ${name}`, async () => {
      const s = await setup(so);
      const { r, client } = await release(s, ro);
      assert.notEqual(r.status, 'settled');
      assert.match(r.reason, re);
      assert.equal(client.sent.length, 0);
    });
  }

  test('strict release: expired intent, open cancel window, unavailable evidence', async () => {
    const exp = await setup({ intent: { issuedAt: nowSec() - 7200, expiresAt: nowSec() - 60 } });
    assert.equal((await release(exp)).r.status, 'expired');
    const late = await setup({ intent: { cancelAfter: nowSec() - RIPPLE_EPOCH - 10 } });
    const l = await release(late);
    assert.equal(l.r.status, 'refused');
    assert.match(l.r.reason, /cancel/);
    const s = await setup();
    const down = await release(s, { backend: backendFor(s.run, { read: async () => { throw new Error('ECONNRESET'); } }) });
    assert.equal(down.r.status, 'unavailable');
    assert.equal(down.client.sent.length, 0);
  });

  test('strict release: escrow missing => reconcile without submitting; lost submit response => reconcile, then one finish', async () => {
    const s = await setup();
    const nf = await release(s, { xrpl: { notFound: true } });
    assert.equal(nf.r.status, 'reconcile');
    assert.equal(nf.client.sent.length, 0);
    const s2 = await setup();
    const registry = new k.MemoryPolicyRegistry();
    const client = fakeXrpl(s2.intent, { failSubmits: 1 });
    const first = await release(s2, { registry, client });
    assert.equal(first.r.status, 'reconcile');
    const second = await k.releaseStrict({ client, submitter: wallet, backend: backendFor(s2.run), registry, intent: s2.intent, contractAddress: s2.contractAddress, trustMode: 'trusted-policy-party' });
    assert.equal(second.status, 'settled');
    assert.equal(client.sent.length, 1);
  });

  test('eligibility_v2 circuit: requires an intent hash; credential nullifier matches the JS helper', async () => {
    const s = await setup();
    const want = elig.credentialNullifierFor(s.holderSecret, 'kyc-pass', issuer.publicKey);
    assert.equal(s.run.ledger.credentialNullifier, Buffer.from(want).toString('hex'));
    assert.equal(s.run.ledger.intentHash, k.intentHashV2(s.intent));
    await assert.rejects(
      elig.runEligibility({ contractVersion: 2, intentHash: new Uint8Array(32), issuer, credential: s.credential, holderSecret: s.holderSecret, asOf, preimageCommit: s.sampled.publicTerms.preimageCommit, escrow: { owner: OWNER, offerSequence: 17, destination: DEST } }),
      /intent hash required/
    );
  });

  test('legacy verifyAndReleaseEscrow is exported as an explicitly unsafe demo API', () => {
    assert.equal(k.unsafeDemoVerifyAndReleaseEscrow, k.verifyAndReleaseEscrow);
  });
}

if (elig) {
  test('eligibility_v2 deploy args append the intent hash and require it', () => {
    const issuer = elig.createMockIssuer();
    const base = { issuer, credentialType: 'kyc-pass', asOf: 1n, preimageCommit: new Uint8Array(32).fill(1), escrow: { owner: OWNER, offerSequence: 1, destination: DEST } };
    assert.equal(elig.eligibilityDeployArgs(base).length, 8);
    const args = elig.eligibilityDeployArgs({ ...base, contractVersion: 2, intentHash: new Uint8Array(32).fill(9) });
    assert.equal(args.length, 9);
    assert.equal(args[8][0], 9);
    assert.throws(() => elig.eligibilityDeployArgs({ ...base, contractVersion: 2 }));
  });
}
