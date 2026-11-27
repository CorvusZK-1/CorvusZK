/**
 * PREIMAGE-SHA-256 crypto-conditions (draft-thomas-crypto-conditions, as used by XRPL escrows).
 * Replaces the five-bells-condition dependency: CorvusZK only needs this one condition type,
 * and node:crypto plus a minimal DER encoder covers it with no transitive packages.
 *
 *   fulfillment = A0 len( 80 len(preimage) preimage )
 *   condition   = A0 len( 80 20 sha256(preimage)  81 len(cost) cost )   cost = preimage length in bytes
 *
 * Parsing is strict: only definite, minimal DER lengths; no trailing bytes; no other types.
 */
import crypto from 'node:crypto';

/** Largest preimage accepted. XRPL limits a fulfillment to 256 bytes; this is a generous parser bound. */
export const MAX_PREIMAGE_BYTES = 65_535;

function derLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n <= 0xff) return Buffer.from([0x81, n]);
  if (n <= 0xffff) return Buffer.from([0x82, n >> 8, n & 0xff]);
  throw new RangeError('crypto-condition: length too large');
}
function tlv(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}
/** DER INTEGER content for a non-negative number: minimal big-endian, with a 0x00 sign byte when the top bit is set. */
function uintBytes(n: number): Buffer {
  if (n === 0) return Buffer.from([0]);
  const out: number[] = [];
  while (n > 0) {
    out.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  if (out[0] & 0x80) out.unshift(0);
  return Buffer.from(out);
}
function readTlv(buf: Buffer, at: number): { tag: number; body: Buffer; end: number } {
  if (at + 2 > buf.length) throw new Error('crypto-condition: truncated');
  const tag = buf[at];
  let len = buf[at + 1];
  let p = at + 2;
  if (len & 0x80) {
    const nb = len & 0x7f;
    if (nb === 0 || nb > 2 || p + nb > buf.length) throw new Error('crypto-condition: bad length');
    len = 0;
    for (let i = 0; i < nb; i++) len = len * 256 + buf[p + i];
    if ((nb === 1 && len < 0x80) || (nb === 2 && len <= 0xff)) throw new Error('crypto-condition: non-minimal length');
    p += nb;
  }
  if (p + len > buf.length) throw new Error('crypto-condition: truncated');
  return { tag, body: buf.subarray(p, p + len), end: p + len };
}

function toBuf(x: Uint8Array | string, what: string): Buffer {
  if (typeof x === 'string') {
    if (!/^([0-9a-fA-F]{2})*$/.test(x)) throw new Error(`crypto-condition: ${what} must be hex`);
    return Buffer.from(x, 'hex');
  }
  return Buffer.from(x);
}

/** Condition + fulfillment (uppercase hex, the form XRPL transactions use) for a preimage. */
export function preimageSha256(preimage: Uint8Array): { condition: string; fulfillment: string } {
  const p = Buffer.from(preimage);
  if (p.length > MAX_PREIMAGE_BYTES) throw new RangeError('crypto-condition: preimage too long');
  const fulfillment = tlv(0xa0, tlv(0x80, p));
  const hash = crypto.createHash('sha256').update(p).digest();
  const condition = tlv(0xa0, Buffer.concat([tlv(0x80, hash), tlv(0x81, uintBytes(p.length))]));
  return { condition: condition.toString('hex').toUpperCase(), fulfillment: fulfillment.toString('hex').toUpperCase() };
}

/** Extract the preimage from a PREIMAGE-SHA-256 fulfillment. Throws on anything else. */
export function preimageFromFulfillment(fulfillment: Uint8Array | string): Buffer {
  const buf = toBuf(fulfillment, 'fulfillment');
  const outer = readTlv(buf, 0);
  if (outer.tag !== 0xa0 || outer.end !== buf.length) throw new Error('crypto-condition: not a PREIMAGE-SHA-256 fulfillment');
  const inner = readTlv(outer.body, 0);
  if (inner.tag !== 0x80 || inner.end !== outer.body.length) throw new Error('crypto-condition: malformed fulfillment');
  if (inner.body.length > MAX_PREIMAGE_BYTES) throw new Error('crypto-condition: preimage too long');
  return Buffer.from(inner.body);
}

/** Condition (uppercase hex) that a fulfillment satisfies. */
export function conditionFromFulfillment(fulfillment: Uint8Array | string): string {
  return preimageSha256(preimageFromFulfillment(fulfillment)).condition;
}

/** True only if the fulfillment is a well-formed PREIMAGE-SHA-256 fulfillment for exactly this condition. */
export function validateFulfillment(fulfillment: Uint8Array | string, condition: Uint8Array | string): boolean {
  try {
    const want = toBuf(condition, 'condition');
    const got = Buffer.from(conditionFromFulfillment(fulfillment), 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch {
    return false;
  }
}
