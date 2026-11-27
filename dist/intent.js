/**
 * IntentV2: the one approved settlement a strict release may perform (CZ-003, ADR-002).
 * Canonical, length-prefixed encoding; SHA-256 with a domain tag. Strict validation:
 * values are rejected, never coerced. Test vectors: test/vectors/intent-v2.json.
 */
import crypto from 'node:crypto';
import * as xrpl from 'xrpl';
export const INTENT_V2_FIELDS = [
    'protocolVersion', 'domain', 'environment', 'xrplNetworkId', 'owner', 'offerSequence', 'destination',
    'destinationTag', 'asset', 'amountDrops', 'condition', 'finishAfter', 'cancelAfter', 'midnightNetwork',
    'circuitArtifactId', 'policyId', 'policyVersion', 'issuerX', 'issuerY', 'credentialType', 'asOf',
    'intentId', 'issuedAt', 'expiresAt',
];
const MAX_DROPS = 100000000000000000n; // 100 billion XRP
const U32 = 0xffffffff;
function fail(field, why) {
    throw new Error(`IntentV2.${field}: ${why}`);
}
function uint(v, field, max = Number.MAX_SAFE_INTEGER) {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max)
        fail(field, 'expected a non-negative safe integer in range');
    return v;
}
function oneOf(v, field, allowed) {
    if (typeof v !== 'string' || !allowed.includes(v))
        fail(field, `expected one of ${allowed.join(', ')}`);
    return v;
}
function ident(v, field, maxLen) {
    if (typeof v !== 'string' || !/^[A-Za-z0-9._:-]+$/.test(v) || v.length > maxLen)
        fail(field, 'expected [A-Za-z0-9._:-], bounded length');
    return v;
}
function account(v, field) {
    if (typeof v !== 'string' || !xrpl.isValidClassicAddress(v))
        fail(field, 'expected a classic XRPL address');
    return v;
}
function hexField(v, field) {
    if (typeof v !== 'string' || !/^[0-9a-fA-F]{1,64}$/.test(v))
        fail(field, 'expected hex without 0x');
    return BigInt('0x' + v).toString(16);
}
/** Validate and normalize. Throws on anything unexpected. */
export function normalizeIntentV2(input) {
    if (!input || typeof input !== 'object')
        fail('*', 'expected an object');
    const i = input;
    for (const key of Object.keys(i))
        if (!INTENT_V2_FIELDS.includes(key))
            fail(key, 'unknown field');
    for (const key of INTENT_V2_FIELDS)
        if (!(key in i))
            fail(key, 'missing');
    if (i.protocolVersion !== 2)
        fail('protocolVersion', 'expected 2');
    if (i.domain !== 'corvuszk:intent:v2')
        fail('domain', 'expected corvuszk:intent:v2');
    const amount = i.amountDrops;
    if (typeof amount !== 'string' || !/^[1-9][0-9]*$/.test(amount) || BigInt(amount) > MAX_DROPS)
        fail('amountDrops', 'expected canonical positive decimal string of drops');
    if (typeof i.condition !== 'string' || !/^A0258020[0-9A-F]{64}810120$/i.test(i.condition))
        fail('condition', 'expected PREIMAGE-SHA-256 condition hex');
    if (typeof i.circuitArtifactId !== 'string' || !/^[0-9a-f]{64}$/.test(i.circuitArtifactId))
        fail('circuitArtifactId', 'expected 64 lowercase hex');
    if (typeof i.credentialType !== 'string' || !/^[\x21-\x7e]{1,32}$/.test(i.credentialType))
        fail('credentialType', 'expected 1-32 printable ASCII');
    if (typeof i.asOf !== 'string' || !/^(0|[1-9][0-9]*)$/.test(i.asOf) || BigInt(i.asOf) > 0xffffffffffffffffn)
        fail('asOf', 'expected uint64 decimal string');
    const out = {
        protocolVersion: 2,
        domain: 'corvuszk:intent:v2',
        environment: oneOf(i.environment, 'environment', ['local', 'testnet', 'mainnet']),
        xrplNetworkId: uint(i.xrplNetworkId, 'xrplNetworkId', U32),
        owner: account(i.owner, 'owner'),
        offerSequence: uint(i.offerSequence, 'offerSequence', U32),
        destination: account(i.destination, 'destination'),
        destinationTag: i.destinationTag === null ? null : uint(i.destinationTag, 'destinationTag', U32),
        asset: oneOf(i.asset, 'asset', ['XRP']),
        amountDrops: amount,
        condition: i.condition.toUpperCase(),
        finishAfter: i.finishAfter === null ? null : uint(i.finishAfter, 'finishAfter', U32),
        cancelAfter: uint(i.cancelAfter, 'cancelAfter', U32),
        midnightNetwork: oneOf(i.midnightNetwork, 'midnightNetwork', ['local', 'preprod', 'mainnet']),
        circuitArtifactId: i.circuitArtifactId,
        policyId: ident(i.policyId, 'policyId', 64),
        policyVersion: uint(i.policyVersion, 'policyVersion', U32),
        issuerX: hexField(i.issuerX, 'issuerX'),
        issuerY: hexField(i.issuerY, 'issuerY'),
        credentialType: i.credentialType,
        asOf: i.asOf,
        intentId: ident(i.intentId, 'intentId', 128),
        issuedAt: uint(i.issuedAt, 'issuedAt'),
        expiresAt: uint(i.expiresAt, 'expiresAt'),
    };
    if (out.owner === out.destination)
        fail('destination', 'must differ from owner');
    if (out.finishAfter !== null && out.finishAfter >= out.cancelAfter)
        fail('finishAfter', 'must be before cancelAfter');
    if (out.expiresAt <= out.issuedAt)
        fail('expiresAt', 'must be after issuedAt');
    return out;
}
/**
 * Canonical bytes: "CZKI2" || for each field in INTENT_V2_FIELDS order:
 * u16be(len(name)) || name || u32be(len(value)) || value, where value is the UTF-8 of the
 * normalized value (integers in decimal, null as the 4 bytes "null", accounts as 40-hex account id).
 */
export function encodeIntentV2(input) {
    const n = normalizeIntentV2(input);
    const parts = [Buffer.from('CZKI2', 'ascii')];
    for (const key of INTENT_V2_FIELDS) {
        let v = n[key];
        if (key === 'owner' || key === 'destination')
            v = Buffer.from(xrpl.decodeAccountID(v)).toString('hex');
        const value = Buffer.from(v === null ? 'null' : String(v), 'utf8');
        const name = Buffer.from(key, 'ascii');
        const hdr = Buffer.alloc(6);
        hdr.writeUInt16BE(name.length, 0);
        hdr.writeUInt32BE(value.length, 2);
        parts.push(hdr.subarray(0, 2), name, hdr.subarray(2), value);
    }
    return Buffer.concat(parts);
}
/** Hex SHA-256 of the canonical encoding. This is what eligibility_v2 stores as intentHash. */
export function intentHashV2(input) {
    return crypto.createHash('sha256').update(encodeIntentV2(input)).digest('hex');
}
