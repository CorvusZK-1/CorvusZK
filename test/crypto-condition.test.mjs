// PREIMAGE-SHA-256 crypto-conditions without five-bells-condition.
// Reference vectors were generated with five-bells-condition@5.0.1 before it was removed.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import * as k from '../dist/index.js';

const { vectors } = JSON.parse(fs.readFileSync(new URL('./vectors/preimage-sha256.json', import.meta.url)));

test('crypto-condition: matches the five-bells-condition reference vectors (0 to 1000-byte preimages)', () => {
  assert.ok(vectors.length >= 9);
  for (const v of vectors) {
    const got = k.preimageSha256(Buffer.from(v.preimageHex, 'hex'));
    assert.equal(got.condition, v.condition, `condition, ${v.preimageHex.length / 2} bytes`);
    assert.equal(got.fulfillment, v.fulfillment, `fulfillment, ${v.preimageHex.length / 2} bytes`);
    assert.equal(k.conditionFromFulfillment(v.fulfillment), v.condition);
    assert.equal(k.validateFulfillment(v.fulfillment, v.condition), true);
    assert.equal(k.preimageFromFulfillment(v.fulfillment).toString('hex'), v.preimageHex);
  }
});

test('crypto-condition: empty preimage matches the crypto-conditions draft example', () => {
  const r = k.preimageSha256(new Uint8Array(0));
  assert.equal(r.fulfillment, 'A0028000');
  assert.equal(r.condition, 'A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100');
});

test('crypto-condition: createCryptoCondition output validates; wrong or malformed fulfillments do not', () => {
  const a = k.createCryptoCondition();
  const b = k.createCryptoCondition();
  assert.match(a.condition, /^A0258020[0-9A-F]{64}810120$/);
  assert.equal(k.validateFulfillment(a.fulfillment, a.condition), true);
  assert.equal(k.validateFulfillment(a.fulfillment.toLowerCase(), a.condition.toLowerCase()), true);
  assert.equal(k.validateFulfillment(b.fulfillment, a.condition), false);
  const bad = [
    '', 'zz', 'A0', 'A022', 'A0228020' + '00'.repeat(31), // truncated
    a.fulfillment + '00', // trailing byte
    'A1' + a.fulfillment.slice(2), // other condition type tag
    'A0228120' + a.fulfillment.slice(8), // wrong inner tag
    'A081228020' + a.fulfillment.slice(8), // non-minimal outer length
    a.condition, // a condition is not a fulfillment
  ];
  for (const f of bad) {
    assert.equal(k.validateFulfillment(f, a.condition), false, f.slice(0, 16));
    assert.throws(() => k.preimageFromFulfillment(f));
  }
});
