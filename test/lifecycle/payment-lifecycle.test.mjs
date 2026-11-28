// End-to-end payment lifecycle tests: create -> fund -> prove -> release, plus refund and timeout paths.
//
// What is real here: the CorvusZK SDK (createEscrow, releaseStrict, the policy registry, intent hashing),
// the compiled eligibility_v2 Compact circuit (run locally through compact-runtime), and real XRPL
// crypto-conditions (PREIMAGE-SHA-256, checked against committed reference vectors).
// What is simulated: the XRPL ledger (an in-memory ledger that applies the EscrowCreate / EscrowFinish /
// EscrowCancel rules and keeps balances) and the Midnight indexer read (it returns the public ledger the
// local circuit run produced). No network, no wallets with funds, no real keys, no real value.
//
// The demo issuer used here is the mock issuer, which is NOT secure (CZ-005). These tests check the
// payment state machine, not the credential cryptography.
import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import * as xrpl from 'xrpl';
import * as k from '../../dist/index.js';

let elig, bridge;
try {
  elig = await import('../../midnight/eligibility.mjs');
  bridge = await import('../../midnight/sdk-bridge.mjs');
} catch (err) {
  if (process.env.CORVUSZK_REQUIRE_MIDNIGHT) throw err;
  test('payment lifecycle suite', { skip: `midnight runtime missing (${err.message}). Run: cd midnight && npm ci` }, () => {});
}

const RIPPLE_EPOCH = 946684800;
const FEE = 12n; // drops per transaction
const XRP = (n) => BigInt(xrpl.xrpToDrops(String(n)));

/**
 * In-memory XRPL ledger. Applies the escrow rules that matter for the lifecycle:
 *  - EscrowCreate debits the owner (amount + fee) and creates an Escrow object keyed by (owner, sequence);
 *  - EscrowFinish needs a matching fulfillment, fails once CancelAfter has passed, credits the destination;
 *  - EscrowCancel works only after CancelAfter and refunds the owner;
 *  - an escrow is consumed once (tecNO_TARGET afterwards).
 * Time is controlled by the test (clock.advance).
 */
function fakeLedger({ networkId = 1, startMs = Date.now() } = {}) {
  let nowMs = startMs;
  const accounts = new Map(); // address -> { balance: bigint, seq: number }
  const escrows = new Map(); // `${owner}:${seq}` -> node
  const txs = [];
  const rippleNow = () => Math.floor(nowMs / 1000) - RIPPLE_EPOCH;
  const acct = (a) => {
    if (!accounts.has(a)) accounts.set(a, { balance: 0n, seq: 1 });
    return accounts.get(a);
  };
  const done = (tx, code) => {
    const hash = crypto.createHash('sha256').update(JSON.stringify(tx) + txs.length).digest('hex').toUpperCase();
    txs.push({ tx, code, hash });
    return { result: { hash, validated: true, tx_json: tx, meta: { TransactionResult: code } } };
  };

  function apply(tx, wallet) {
    if (wallet?.address !== tx.Account) throw new Error('signing wallet does not match Account');
    const a = acct(tx.Account);
    tx = { ...tx, Sequence: a.seq };
    if (a.balance < FEE) return done(tx, 'terINSUF_FEE_B');
    a.seq += 1;
    a.balance -= FEE;
    const now = rippleNow();

    if (tx.TransactionType === 'EscrowCreate') {
      const amt = BigInt(tx.Amount);
      if (tx.CancelAfter !== undefined && tx.CancelAfter <= now) return done(tx, 'tecNO_PERMISSION');
      if (tx.FinishAfter !== undefined && tx.CancelAfter !== undefined && tx.FinishAfter >= tx.CancelAfter) return done(tx, 'temBAD_EXPIRATION');
      if (a.balance < amt) return done(tx, 'tecUNFUNDED');
      a.balance -= amt;
      escrows.set(`${tx.Account}:${tx.Sequence}`, {
        LedgerEntryType: 'Escrow', Account: tx.Account, Destination: tx.Destination, Amount: tx.Amount,
        Condition: tx.Condition, CancelAfter: tx.CancelAfter,
        ...(tx.FinishAfter !== undefined ? { FinishAfter: tx.FinishAfter } : {}),
        ...(tx.DestinationTag !== undefined ? { DestinationTag: tx.DestinationTag } : {}),
      });
      return done(tx, 'tesSUCCESS');
    }

    const key = `${tx.Owner}:${tx.OfferSequence}`;
    const node = escrows.get(key);
    if (!node) return done(tx, 'tecNO_TARGET');

    if (tx.TransactionType === 'EscrowFinish') {
      if (node.CancelAfter !== undefined && now > node.CancelAfter) return done(tx, 'tecNO_PERMISSION');
      if (node.FinishAfter !== undefined && now <= node.FinishAfter) return done(tx, 'tecNO_PERMISSION');
      if (node.Condition) {
        if (!tx.Fulfillment || String(tx.Condition).toUpperCase() !== node.Condition.toUpperCase()) return done(tx, 'tecCRYPTOCONDITION_ERROR');
        try {
          if (!k.validateFulfillment(tx.Fulfillment, node.Condition)) {
            return done(tx, 'tecCRYPTOCONDITION_ERROR');
          }
        } catch {
          return done(tx, 'tecCRYPTOCONDITION_ERROR');
        }
      }
      escrows.delete(key);
      acct(node.Destination).balance += BigInt(node.Amount);
      return done(tx, 'tesSUCCESS');
    }
    if (tx.TransactionType === 'EscrowCancel') {
      if (node.CancelAfter === undefined || !(now > node.CancelAfter)) return done(tx, 'tecNO_PERMISSION');
      escrows.delete(key);
      acct(node.Account).balance += BigInt(node.Amount);
      return done(tx, 'tesSUCCESS');
    }
    return done(tx, 'temUNKNOWN');
  }

  return {
    txs,
    escrows,
    fund: (address, drops) => { acct(address).balance += drops; },
    balance: (address) => acct(address).balance,
    clock: { nowMs: () => nowMs, advance: (sec) => { nowMs += sec * 1000; }, rippleNow },
    // Same surface the SDK uses on xrpl.Client.
    request: async (r) => {
      if (r.command === 'server_info') return { result: { info: { network_id: networkId } } };
      if (r.command === 'ledger_entry') {
        const node = escrows.get(`${r.escrow.owner}:${r.escrow.seq}`);
        if (!node) { const e = new Error('entryNotFound'); e.data = { error: 'entryNotFound' }; throw e; }
        return { result: { node: { ...node }, validated: true } };
      }
      throw new Error('unexpected command ' + r.command);
    },
    submitAndWait: async (tx, { wallet }) => apply(tx, wallet),
  };
}

if (elig) {
  const issuer = elig.createMockIssuer();
  const nowSec = () => Math.floor(Date.now() / 1000);
  const asOf = BigInt(nowSec());
  const trustMode = 'trusted-policy-party';

  /** One complete deal on a fresh ledger: payer funded, escrow created, intent registered. */
  async function openDeal({ amountXrp = '25', cancelAfterSec = 3600, preimageRole = 'payer', intentOver = {} } = {}) {
    const ledger = fakeLedger();
    const payer = xrpl.Wallet.generate();
    const merchant = xrpl.Wallet.generate();
    const releaser = xrpl.Wallet.generate(); // the trusted policy party's fee account
    ledger.fund(payer.address, XRP(100));
    ledger.fund(releaser.address, XRP(1));

    // 1) Create: the holder samples the preimage; only the condition goes into the XRPL escrow.
    const sampled = elig.samplePreimage(preimageRole);
    const terms = elig.payerFacingTerms(sampled);
    assert.equal(terms.preimage, undefined, 'payer-facing terms carry no preimage');

    // 2) Fund: the payer's own wallet locks XRP on-ledger with the SDK.
    const created = await k.createEscrow(ledger, payer, { destination: merchant.address, amountXrp, condition: terms.condition, cancelAfterSec });
    assert.equal(created.result, 'tesSUCCESS');
    const node = (await ledger.request({ command: 'ledger_entry', escrow: { owner: payer.address, seq: created.offerSequence }, ledger_index: 'validated' })).result.node;

    const intent = {
      protocolVersion: 2, domain: 'corvuszk:intent:v2', environment: 'testnet', xrplNetworkId: 1,
      owner: payer.address, offerSequence: created.offerSequence, destination: merchant.address, destinationTag: null,
      asset: 'XRP', amountDrops: node.Amount, condition: terms.condition,
      finishAfter: null, cancelAfter: node.CancelAfter,
      midnightNetwork: 'preprod', circuitArtifactId: bridge.circuitArtifactId('eligibility_v2'),
      policyId: 'corvuszk-lifecycle-test', policyVersion: 1,
      issuerX: issuer.publicKey.x.toString(16), issuerY: issuer.publicKey.y.toString(16),
      credentialType: 'kyc-pass', asOf: asOf.toString(),
      intentId: 'intent-' + crypto.randomUUID(), issuedAt: nowSec(), expiresAt: nowSec() + 1800,
      ...intentOver,
    };
    const registry = new k.MemoryPolicyRegistry();
    registry.registerIntent(intent.intentId, k.intentHashV2(intent));
    const contractAddress = crypto.randomBytes(32).toString('hex');
    registry.bindContract(intent.intentId, contractAddress);
    return { ledger, payer, merchant, releaser, sampled, intent, registry, contractAddress, created };
  }

  /** 3) Prove: run the real eligibility_v2 circuit for this intent (optionally with a bad credential / no reveal). */
  async function prove(d, { useIssuer = issuer, reveal = true } = {}) {
    const holderSecret = new Uint8Array(crypto.randomBytes(32));
    const credential = elig.issueMockCredential(useIssuer, { holderSecret, credentialType: 'kyc-pass', expiry: asOf + 86400n });
    const run = await elig.runEligibility({
      contractVersion: 2, intentHash: Buffer.from(k.intentHashV2(d.intent), 'hex'),
      issuer: useIssuer, credential, holderSecret, asOf, preimageCommit: d.sampled.publicTerms.preimageCommit,
      escrow: { owner: d.payer.address, offerSequence: d.intent.offerSequence, destination: d.merchant.address },
      reveal, releasePreimage: reveal ? d.sampled.holder.preimage : undefined,
    });
    return run;
  }

  function backendFor(run, { down = false } = {}) {
    return new k.MidnightBackend({
      blockfrostProjectId: 'nightpreprod-test-placeholder', mode: 'preprod',
      bridge: {
        proveLocal: async () => { throw new Error('unused'); },
        circuitArtifactId: bridge.circuitArtifactId,
        readContractEvidence: async () => {
          if (down) throw new Error('ECONNRESET');
          return { found: true, ledger: bridge.plainLedger(run.rawLedger), artifactMatch: true };
        },
      },
    });
  }

  /** 4) Release: the trusted policy party runs strict release. */
  const release = (d, run, opts = {}) =>
    k.releaseStrict({
      client: d.ledger, submitter: d.releaser, backend: backendFor(run, opts), registry: d.registry,
      intent: d.intent, contractAddress: d.contractAddress, trustMode, now: d.ledger.clock.nowMs,
    });

  const cancel = (d, wallet = d.payer) =>
    d.ledger.submitAndWait({ TransactionType: 'EscrowCancel', Account: wallet.address, Owner: d.payer.address, OfferSequence: d.intent.offerSequence }, { wallet });
  const code = (r) => r.result.meta.TransactionResult;

  test('lifecycle: create -> fund -> prove -> release pays the merchant exactly once', async () => {
    const d = await openDeal({ amountXrp: '25' });
    assert.equal(d.ledger.balance(d.payer.address), XRP(75) - FEE, 'payer paid amount + one fee');
    assert.equal(d.ledger.escrows.size, 1);

    const run = await prove(d);
    const r = await release(d, run);
    assert.equal(r.status, 'settled', r.reason);
    assert.match(r.txHash, /^[0-9A-F]{64}$/);
    assert.equal(d.ledger.balance(d.merchant.address), XRP(25), 'merchant received the full amount');
    assert.equal(d.ledger.escrows.size, 0, 'escrow consumed');
    assert.equal(d.registry.get(d.intent.intentId).state, 'settled');

    // Retrying release is idempotent and sends nothing.
    const before = d.ledger.txs.length;
    const again = await release(d, run);
    assert.equal(again.status, 'already-settled');
    assert.equal(d.ledger.txs.length, before);
    // The payer can no longer cancel: the escrow is gone.
    d.ledger.clock.advance(7200);
    assert.equal(code(await cancel(d)), 'tecNO_TARGET');
    assert.equal(d.ledger.balance(d.payer.address), XRP(75) - 2n * FEE);
  });

  test('lifecycle: destination-sampled preimage also settles through strict release', async () => {
    const d = await openDeal({ preimageRole: 'destination' });
    const r = await release(d, await prove(d));
    assert.equal(r.status, 'settled', r.reason);
    assert.equal(d.ledger.balance(d.merchant.address), XRP(25));
  });

  test('lifecycle: proof from an unexpected issuer is refused; payer is refunded after CancelAfter', async () => {
    const d = await openDeal({ cancelAfterSec: 600 });
    const run = await prove(d, { useIssuer: elig.createMockIssuer() });
    const r = await release(d, run);
    assert.equal(r.status, 'refused');
    assert.equal(d.ledger.escrows.size, 1, 'funds stay locked on-ledger');
    assert.equal(d.ledger.balance(d.merchant.address), 0n);

    // Too early to refund.
    assert.equal(code(await cancel(d)), 'tecNO_PERMISSION');
    d.ledger.clock.advance(605);
    assert.equal(code(await cancel(d)), 'tesSUCCESS');
    assert.equal(d.ledger.balance(d.payer.address), XRP(100) - 3n * FEE, 'payer got everything back except network fees');
    assert.equal(d.ledger.escrows.size, 0);
  });

  test('lifecycle: proven but not yet revealed waits (pending), nothing is submitted; after reveal it settles', async () => {
    const d = await openDeal();
    const before = d.ledger.txs.length;
    const r = await release(d, await prove(d, { reveal: false }));
    assert.equal(r.status, 'pending', r.reason);
    assert.equal(d.ledger.txs.length, before);
    assert.equal(d.ledger.escrows.size, 1);
    const done = await release(d, await prove(d));
    assert.equal(done.status, 'settled', done.reason);
  });

  test('lifecycle timeout: valid proof but release comes too late; escrow can only be refunded', async () => {
    const d = await openDeal({ cancelAfterSec: 900, intentOver: { expiresAt: nowSec() + 7200 } });
    const run = await prove(d);
    d.ledger.clock.advance(905); // policy party withheld past CancelAfter (a few seconds of margin for clock rounding)
    const r = await release(d, run);
    assert.equal(r.status, 'refused');
    assert.match(r.reason, /cancel-window-open/);
    assert.equal(d.ledger.escrows.size, 1);

    // Even with the right fulfillment, the ledger refuses a late finish.
    const late = await d.ledger.submitAndWait(
      { TransactionType: 'EscrowFinish', Account: d.merchant.address, Owner: d.payer.address, OfferSequence: d.intent.offerSequence, Condition: d.intent.condition, Fulfillment: d.sampled.holder.fulfillment },
      { wallet: d.merchant }
    );
    assert.equal(code(late), 'terINSUF_FEE_B'); // merchant has no XRP yet for fees
    d.ledger.fund(d.merchant.address, XRP(1));
    const late2 = await d.ledger.submitAndWait(
      { TransactionType: 'EscrowFinish', Account: d.merchant.address, Owner: d.payer.address, OfferSequence: d.intent.offerSequence, Condition: d.intent.condition, Fulfillment: d.sampled.holder.fulfillment },
      { wallet: d.merchant }
    );
    assert.equal(code(late2), 'tecNO_PERMISSION');

    // Anyone may cancel after CancelAfter; the refund always goes to the payer.
    assert.equal(code(await cancel(d, d.releaser)), 'tesSUCCESS');
    assert.equal(d.ledger.balance(d.payer.address), XRP(100) - FEE);
    assert.equal(d.ledger.balance(d.merchant.address), XRP(1) - FEE, 'only the validated (tec) attempt cost a fee');
  });

  test('lifecycle timeout: intent expires before release; release refuses, then refund', async () => {
    const d = await openDeal({ cancelAfterSec: 3600, intentOver: { expiresAt: nowSec() + 60 } });
    const run = await prove(d);
    d.ledger.clock.advance(120);
    const r = await release(d, run);
    assert.equal(r.status, 'expired');
    d.ledger.clock.advance(3600);
    assert.equal(code(await cancel(d)), 'tesSUCCESS');
    assert.equal(d.ledger.balance(d.payer.address), XRP(100) - 2n * FEE);
  });

  test('lifecycle: Midnight read outage returns unavailable, then a later retry settles once', async () => {
    const d = await openDeal();
    const run = await prove(d);
    const down = await release(d, run, { down: true });
    assert.equal(down.status, 'unavailable');
    assert.equal(d.ledger.escrows.size, 1);
    const up = await release(d, run);
    assert.equal(up.status, 'settled', up.reason);
    assert.equal(d.ledger.txs.filter((t) => t.tx.TransactionType === 'EscrowFinish').length, 1);
  });

  test('lifecycle: wrong fulfillment cannot finish the escrow on the ledger', async () => {
    const d = await openDeal();
    const other = elig.samplePreimage('payer');
    const r = await d.ledger.submitAndWait(
      { TransactionType: 'EscrowFinish', Account: d.releaser.address, Owner: d.payer.address, OfferSequence: d.intent.offerSequence, Condition: d.intent.condition, Fulfillment: other.holder.fulfillment },
      { wallet: d.releaser }
    );
    assert.equal(code(r), 'tecCRYPTOCONDITION_ERROR');
    assert.equal(d.ledger.escrows.size, 1);
  });

  test('lifecycle: mainnet intents are refused before anything is read or sent (CZ-005)', async () => {
    const d = await openDeal({ intentOver: { environment: 'mainnet', xrplNetworkId: 0, midnightNetwork: 'mainnet' } });
    const before = d.ledger.txs.length;
    const r = await release(d, await prove(d));
    assert.equal(r.status, 'refused');
    assert.match(r.reason, /mainnet-not-supported/);
    assert.equal(d.ledger.txs.length, before);
  });

  test('lifecycle: payer without enough XRP cannot fund an escrow', async () => {
    const ledger = fakeLedger();
    const payer = xrpl.Wallet.generate();
    ledger.fund(payer.address, XRP(5));
    const c = elig.samplePreimage('payer');
    const r = await k.createEscrow(ledger, payer, { destination: xrpl.Wallet.generate().address, amountXrp: '25', condition: c.publicTerms.condition });
    assert.equal(r.result, 'tecUNFUNDED');
    assert.equal(ledger.escrows.size, 0);
  });
}

// Offline demo path (simulation backend + legacy demo release). Labelled unsafe for real value.
test('demo lifecycle (simulation backend): proof verifies -> escrow released; tampered proof -> funds stay', async () => {
  const ledger = fakeLedger();
  const payer = xrpl.Wallet.generate();
  const merchant = xrpl.Wallet.generate();
  ledger.fund(payer.address, XRP(50));
  ledger.fund(merchant.address, XRP(1));
  const sim = new k.LocalSimulationBackend();

  const cond = k.createCryptoCondition();
  const esc = await k.createEscrow(ledger, payer, { destination: merchant.address, amountXrp: '10', condition: cond.condition, cancelAfterSec: 600 });
  assert.equal(esc.result, 'tesSUCCESS');

  const proof = await k.proveAgeOver(sim, 1990, 18, 2026, 'salt');
  const forged = { ...proof, claim: { ...proof.claim, minAge: 65 } };
  const bad = await k.unsafeDemoVerifyAndReleaseEscrow(ledger, merchant, { backend: sim, proof: forged, owner: payer.address, offerSequence: esc.offerSequence, condition: cond.condition, fulfillment: cond.fulfillment });
  assert.equal(bad.released, false);
  assert.equal(ledger.escrows.size, 1);

  const ok = await k.unsafeDemoVerifyAndReleaseEscrow(ledger, merchant, { backend: sim, proof, owner: payer.address, offerSequence: esc.offerSequence, condition: cond.condition, fulfillment: cond.fulfillment });
  assert.equal(ok.released, true, ok.reason);
  assert.equal(ledger.balance(merchant.address), XRP(1) - FEE + XRP(10));
  assert.equal(ledger.escrows.size, 0);
});
