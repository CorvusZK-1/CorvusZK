/**
 * Mock-issuer eligibility and bound XRPL release.
 *
 * This is a demonstration. The issuer is generated in-process. It is not a
 * regulated KYC or accreditation provider. The Compact circuit checks a Schnorr
 * signature on the embedded curve shipped with Compact toolchain 0.31.1
 * (`ecMul` / `ecMulGenerator`). That toolchain has no Ed25519 or ECDSA verify,
 * and no scalar-field modulo, so keys and the Fiat-Shamir challenge are 96-bit
 * values chosen so `s = k + e*sk` does not wrap. This is not an XRPL
 * Credential (XLS-70) ledger object and it is not deployed on Midnight Preprod
 * by this module.
 *
 * Local execution uses compact-runtime. That checks the circuit constraints on
 * this machine. It is not a proof-server proof and not a Preprod transaction.
 *
 * Never logs issuer secret keys, holder secrets, or release preimages.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { preimageSha256 } from '../dist/crypto-condition.js';
import { decodeAccountID } from 'xrpl';

export const MOCK_ISSUER_LABEL =
  'MOCK ISSUER — demonstration only. INSECURE: anyone holding one credential can recover this issuer\'s private key (CZ-005). Test fixtures only. Not a regulated KYC or accreditation provider, not an XRPL CredentialCreate, and not checked by the XRPL ledger.';

/** Largest scalar accepted by ecMulGenerator in compact-runtime 0.16.0 (EmbeddedFr). */
export const EMBEDDED_SCALAR_MODULUS =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

/** 12-byte scalars keep k + e*sk below EMBEDDED_SCALAR_MODULUS and below the Compact field prime. */
export const SCALAR_BYTES = 12;

const here = path.dirname(new URL(import.meta.url).pathname);
const B32 = new rt.CompactTypeBytes(32);
const V2 = new rt.CompactTypeVector(2, B32);
const V7 = new rt.CompactTypeVector(7, B32);
const V8 = new rt.CompactTypeVector(8, B32);
const V5 = new rt.CompactTypeVector(5, B32);

export function pad32(text) {
  const out = Buffer.alloc(32);
  const raw = Buffer.from(String(text), 'utf8');
  if (raw.length > 32) throw new Error(`pad32: "${text}" is longer than 32 bytes`);
  raw.copy(out);
  return new Uint8Array(out);
}

export function u64ToBytes32(n) {
  const v = BigInt(n);
  if (v < 0n || v > 0xffffffffffffffffn) throw new Error('u64 out of range');
  const out = Buffer.alloc(32);
  out.writeBigUInt64LE(v);
  return new Uint8Array(out);
}

export function fold96(bytes) {
  if (bytes.length < 12) throw new Error('fold96: need 12 bytes');
  let acc = 0n;
  for (let i = 0; i < 12; i++) acc += BigInt(bytes[i]) << (8n * BigInt(i));
  return acc;
}

function hashV(type, values) {
  return new Uint8Array(rt.persistentHash(type, values));
}

export function subjectCommit(holderSecret) {
  return hashV(V2, [pad32('corvuszk:subject:v1'), bytes32(holderSecret)]);
}

export function preimageCommit(preimage) {
  return hashV(V2, [pad32('corvuszk:preimage:v1'), bytes32(preimage)]);
}

/**
 * 20-byte XRPL account id, left-aligned in 32 bytes. Accepts a classic
 * address, a 20-byte buffer, or hex of 20 or 32 bytes.
 */
export function encodeAccountId(account) {
  let raw;
  if (typeof account === 'string') {
    if (/^[0-9a-fA-F]{40}$/.test(account)) raw = Buffer.from(account, 'hex');
    else if (/^[0-9a-fA-F]{64}$/.test(account)) raw = Buffer.from(account, 'hex');
    else raw = Buffer.from(decodeAccountID(account));
  } else {
    raw = Buffer.from(account);
  }
  if (raw.length === 32) {
    // Canonical form only: 20-byte account id, then 12 zero bytes (CZ-008).
    if (!raw.subarray(20).every((b) => b === 0)) throw new Error('account id: 32-byte form must end in 12 zero bytes');
    return new Uint8Array(raw);
  }
  if (raw.length !== 20) throw new Error('account id must be 20 bytes or a classic address');
  const out = Buffer.alloc(32);
  raw.copy(out, 0);
  return new Uint8Array(out);
}

export function encodeOfferSequence(sequence) {
  const v = BigInt(sequence);
  if (v < 0n || v > 0xffffffffn) throw new Error('offerSequence must fit in uint32');
  return v;
}

export function encodeEscrowBinding(escrow) {
  if (!escrow) throw new Error('escrow binding is required (owner, offerSequence, destination)');
  return {
    owner: encodeAccountId(escrow.owner),
    offerSequence: encodeOfferSequence(escrow.offerSequence),
    destination: encodeAccountId(escrow.destination),
  };
}

/** One-time nullifier for this holder, credential type, escrow, and preimage commitment. */
export function nullifierFor(holderSecret, credentialType, escrow, preimageCommitBytes) {
  const binding = encodeEscrowBinding(escrow);
  return hashV(V7, [
    pad32('corvuszk:escrow-null:v1'),
    bytes32(holderSecret),
    pad32(credentialType),
    binding.owner,
    u64ToBytes32(binding.offerSequence),
    binding.destination,
    bytes32(preimageCommitBytes),
  ]);
}

/** Field element -> 32 bytes little-endian (Compact `Field as Bytes<32>`). */
export function fieldToBytes32(v) {
  let x = BigInt(v);
  if (x < 0n) throw new Error('field element must be non-negative');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) { out[i] = Number(x & 0xffn); x >>= 8n; }
  if (x !== 0n) throw new Error('field element does not fit in 32 bytes');
  return out;
}

/**
 * eligibility_v2 credential nullifier: stable for one holder secret, credential type and issuer,
 * independent of the escrow. The strict releaser's registry refuses a second intent for it.
 */
export function credentialNullifierFor(holderSecret, credentialType, issuerPublicKey) {
  return hashV(V5, [
    pad32('corvuszk:cred-null:v2'),
    bytes32(holderSecret),
    pad32(credentialType),
    fieldToBytes32(issuerPublicKey.x),
    fieldToBytes32(issuerPublicKey.y),
  ]);
}

function bytes32(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length !== 32) throw new Error(`expected 32 bytes, got ${b.length}`);
  return b;
}

function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function equalBytes(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function randomScalar() {
  const n = BigInt('0x' + crypto.randomBytes(SCALAR_BYTES).toString('hex'));
  if (n === 0n) return randomScalar();
  return n;
}

export function pointOf(scalar) {
  const P = rt.ecMulGenerator(scalar);
  return { x: rt.jubjubPointX(P), y: rt.jubjubPointY(P), point: P };
}

/**
 * In-process mock issuer. `secretKey` stays with the caller and is not a
 * production key (96-bit embedded-curve scalar).
 */
export function createMockIssuer() {
  const secretKey = randomScalar();
  const pub = pointOf(secretKey);
  return {
    mock: true,
    testOnly: true,
    label: MOCK_ISSUER_LABEL,
    scheme: 'compact-0.31.1-embedded-schnorr-96bit',
    secretKey,
    publicKey: { x: pub.x, y: pub.y },
  };
}

function messageHash({ credentialType, subject, expiry, nonce, issuer }) {
  return hashV(V8, [
    pad32('corvuszk:elig:v1'),
    pad32(credentialType),
    bytes32(subject),
    u64ToBytes32(expiry),
    rt.upgradeFromTransient(nonce.x),
    rt.upgradeFromTransient(nonce.y),
    rt.upgradeFromTransient(issuer.x),
    rt.upgradeFromTransient(issuer.y),
  ]);
}

/**
 * Issuer signs a commitment to the holder secret. The secret itself is not an
 * argument and is not part of the returned record.
 */
export function issueMockCredential(issuer, o) {
  if (!issuer?.mock) throw new Error('issueMockCredential: issuer must be createMockIssuer()');
  const credentialType = o.credentialType ?? 'kyc-pass';
  const expiry = BigInt(o.expiry);
  const subject = subjectCommit(o.holderSecret);
  const k = randomScalar();
  const nonce = pointOf(k);
  const msg = messageHash({
    credentialType,
    subject,
    expiry,
    nonce,
    issuer: issuer.publicKey,
  });
  const e = fold96(msg);
  const s = k + e * issuer.secretKey;
  if (s >= EMBEDDED_SCALAR_MODULUS) {
    throw new Error('issueMockCredential: signature scalar wrapped; retry');
  }
  return {
    mock: true,
    testOnly: true,
    label: MOCK_ISSUER_LABEL,
    scheme: issuer.scheme,
    alignment:
      'Field names follow XRPL Credentials (XLS-70) vocabulary. Subject is a commitment, not an XRPL account. This record is not a Credential ledger object. The Compact circuit verifies the embedded-curve Schnorr signature, not an XRPL transaction signature.',
    Issuer: {
      curve: 'compact-embedded',
      x: issuer.publicKey.x.toString(16),
      y: issuer.publicKey.y.toString(16),
    },
    Subject: { commitmentHex: hex(subject) },
    CredentialType: credentialType,
    Expiration: expiry.toString(),
    signature: {
      nonceX: nonce.x.toString(),
      nonceY: nonce.y.toString(),
      s: s.toString(),
    },
  };
}

export function xrplConditionFromPreimage(preimage) {
  return preimageSha256(bytes32(preimage));
}

const TRUST = {
  payer:
    'Default (ADR-001): the payer-side policy party sampled the preimage. It can submit EscrowFinish before any Midnight proof (which only pays the fixed destination early) or withhold reveal (the payer is refunded after CancelAfter). The destination cannot finish until the preimage is revealed on Midnight or the policy party shares it.',
  destination:
    'The destination (policy party) sampled the preimage. They can submit EscrowFinish before any Midnight proof. The payer receives only the condition and the preimage commitment, so the payer cannot finish early.',
};

/**
 * Sample the XRPL preimage for one role.
 * `publicTerms` is safe to give to the other party: condition and commitment only.
 * `holder` stays with the sampler. After `reveal`, the preimage is public anyway.
 */
export function samplePreimage(role = 'payer') {
  if (role !== 'payer' && role !== 'destination') {
    throw new Error('samplePreimage role must be "payer" or "destination"');
  }
  const preimage = new Uint8Array(crypto.randomBytes(32));
  const commit = preimageCommit(preimage);
  const xrplCond = xrplConditionFromPreimage(preimage);
  return {
    role,
    trust: TRUST[role],
    publicTerms: {
      condition: xrplCond.condition,
      preimageCommit: commit,
    },
    holder: {
      role,
      preimage,
      fulfillment: xrplCond.fulfillment,
    },
  };
}

/** The object the payer is allowed to see. No preimage and no fulfillment. */
export function payerFacingTerms(sampled) {
  if (!sampled?.publicTerms?.condition || !sampled?.publicTerms?.preimageCommit) {
    throw new Error('payerFacingTerms: expected samplePreimage() output');
  }
  return {
    condition: sampled.publicTerms.condition,
    preimageCommit: sampled.publicTerms.preimageCommit,
  };
}

/**
 * Payer-sampled preimage. Kept for existing callers.
 * The payer holds the fulfillment and can finish without Midnight.
 */
export function createBoundPreimage() {
  const sampled = samplePreimage('payer');
  return {
    role: 'payer',
    trust: sampled.trust,
    note: 'The setup party knows this preimage and can finish the XRPL escrow without Midnight. Do not give preimage or fulfillment to the releaser.',
    preimage: sampled.holder.preimage,
    preimageCommit: sampled.publicTerms.preimageCommit,
    condition: sampled.publicTerms.condition,
    fulfillment: sampled.holder.fulfillment,
    publicTerms: sampled.publicTerms,
    holder: sampled.holder,
  };
}

/** Constructor argument list for contracts/eligibility.compact, in source order. */
export function eligibilityDeployArgs(o) {
  const binding = encodeEscrowBinding(o.escrow);
  const issuer = o.issuer?.publicKey ?? o.issuer;
  if (issuer?.x == null || issuer?.y == null) throw new Error('eligibilityDeployArgs: issuer public key is required');
  return [
    issuer.x,
    issuer.y,
    pad32(o.credentialType),
    BigInt(o.asOf),
    bytes32(o.preimageCommit ?? o.publicTerms?.preimageCommit),
    binding.owner,
    binding.offerSequence,
    binding.destination,
    ...(o.contractVersion === 2 ? [bytes32(o.intentHash)] : []),
  ];
}

async function loadContract(managedRoot, template = 'eligibility') {
  const modPath = path.join(managedRoot, template, 'contract', 'index.js');
  return import(pathToFileURL(modPath).href);
}

// compact-runtime 0.21: circuits are async; the new state is in queryContexts[address].
async function call(C, contractState, name) {
  const addr = rt.dummyContractAddress();
  const ctx = rt.createCircuitContext({ circuitId: name, contractAddress: addr, coinPublicKeyOrZswapState: '0'.repeat(64), contractState, privateState: {} });
  const r = await C.circuits[name](ctx);
  return { ...r, context: { ...r.context, currentQueryContext: r.context.queryContexts[addr] } };
}

function witnesses(w) {
  return {
    holderSecret: (c) => [c.privateState, bytes32(w.holderSecret)],
    expiry: (c) => [c.privateState, BigInt(w.expiry)],
    nonceX: (c) => [c.privateState, BigInt(w.signature.nonceX)],
    nonceY: (c) => [c.privateState, BigInt(w.signature.nonceY)],
    sigS: (c) => [c.privateState, BigInt(w.signature.s)],
    releasePreimage: (c) => [c.privateState, bytes32(w.releasePreimage ?? new Uint8Array(32))],
  };
}

/**
 * Run constructor + prove, optionally reveal, against the compiled circuit.
 * @param {object} o
 * @param {boolean} [o.reveal] when true, run reveal() after a successful prove
 */
export async function runEligibility(o) {
  const managedRoot = o.managedRoot ?? path.join(here, 'managed');
  const v2 = o.contractVersion === 2;
  const m = await loadContract(managedRoot, v2 ? 'eligibility_v2' : 'eligibility');
  const signature = o.signature ?? o.credential?.signature;
  const holderSecret = o.holderSecret;
  const expiry = o.expiry ?? o.credential?.Expiration;
  const C = new m.Contract(witnesses({ ...o, holderSecret, signature, expiry }));
  const ctor = rt.createConstructorContext({}, '0'.repeat(64));
  const chainIssuer = o.chainIssuer ?? o.issuer;
  const binding = encodeEscrowBinding(o.escrow);
  const initial = await C.initialState(
    ctor,
    chainIssuer.publicKey.x,
    chainIssuer.publicKey.y,
    pad32(o.credential.CredentialType),
    BigInt(o.asOf),
    bytes32(o.preimageCommit),
    binding.owner,
    binding.offerSequence,
    binding.destination,
    ...(v2 ? [bytes32(o.intentHash)] : [])
  );
  let state = initial.currentContractState;
  if (o.only !== 'reveal') {
    const proved = await call(C, state, 'prove');
    state = proved.context.currentQueryContext.state;
    if (o.again) await call(C, state, 'prove');
  }
  if (o.reveal || o.only === 'reveal') {
    const C2 = new m.Contract(
      witnesses({ ...o, holderSecret, signature, expiry, releasePreimage: o.releasePreimage })
    );
    const revealed = await call(C2, state, 'reveal');
    state = revealed.context.currentQueryContext.state;
  }
  const ledger = m.ledger(state);
  return { ledger: publicLedger(ledger), rawLedger: ledger };
}

export function publicLedger(ledger) {
  return {
    issuerX: ledger.issuerX.toString(16),
    issuerY: ledger.issuerY.toString(16),
    credentialType: Buffer.from(ledger.credentialType).toString('utf8').replace(/\0+$/, ''),
    asOf: ledger.asOf.toString(),
    preimageCommit: hex(ledger.preimageCommit),
    escrowOwner: hex(ledger.escrowOwner),
    offerSequence: ledger.offerSequence.toString(),
    escrowDestination: hex(ledger.escrowDestination),
    proven: ledger.proven === true,
    nullifier: hex(ledger.nullifier),
    preimageRevealed: ledger.preimageRevealed === true,
    revealedPreimage: ledger.preimageRevealed ? hex(ledger.revealedPreimage) : null,
    ...(ledger.intentHash ? { intentHash: hex(ledger.intentHash), credentialNullifier: hex(ledger.credentialNullifier) } : {}),
  };
}

function toBigIntField(v, name) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === 'string' && /^(0x)?[0-9a-fA-F]+$/.test(v)) return BigInt(v.startsWith('0x') ? v : '0x' + v);
  throw new Error(`${name}: expected bigint or hex string`);
}

/**
 * Releaser path. Builds the XRPL fulfillment from contract state.
 * Refuses unless prove() and reveal() have both succeeded, the revealed
 * preimage matches the commitment, and the caller names the same owner,
 * offer sequence, destination, and condition stored on that contract, and
 * the same issuer public key, credential type and asOf the releaser's own
 * policy expects (CZ-003e). These expectations come from the releaser's
 * configuration, never from the contract being checked.
 * @param {object} expected { owner, offerSequence, destination, condition, issuer:{x,y}, credentialType, asOf }
 */
export function fulfillmentFromRevealedLedger(ledger, expected) {
  if (!expected?.issuer || expected.issuer.x == null || expected.issuer.y == null) {
    throw new Error('expected issuer public key is required; refusing to derive the XRPL fulfillment');
  }
  if (!expected.credentialType) throw new Error('expected credential type is required; refusing to derive the XRPL fulfillment');
  if (expected.asOf == null) throw new Error('expected asOf is required; refusing to derive the XRPL fulfillment');
  if (!ledger || ledger.proven !== true) {
    throw new Error('eligibility not proven; refusing to derive the XRPL fulfillment');
  }
  if (ledger.preimageRevealed !== true) {
    throw new Error('preimage is not on contract state; refusing to derive the XRPL fulfillment');
  }
  if (!ledger.nullifier || Buffer.from(ledger.nullifier).every((b) => b === 0)) {
    throw new Error('escrow nullifier is missing; refusing to derive the XRPL fulfillment');
  }
  const ix = toBigIntField(expected.issuer.x, 'issuer.x');
  const iy = toBigIntField(expected.issuer.y, 'issuer.y');
  if (BigInt(ledger.issuerX) !== ix || BigInt(ledger.issuerY) !== iy) {
    throw new Error('issuer public key on the contract is not the expected issuer');
  }
  if (!equalBytes(ledger.credentialType, pad32(expected.credentialType))) {
    throw new Error('credential type on the contract is not the expected credential type');
  }
  if (BigInt(ledger.asOf) !== BigInt(expected.asOf)) {
    throw new Error('asOf on the contract is not the expected asOf');
  }
  const binding = encodeEscrowBinding(expected);
  if (!equalBytes(ledger.escrowOwner, binding.owner)) {
    throw new Error('escrow owner does not match the contract');
  }
  if (BigInt(ledger.offerSequence) !== binding.offerSequence) {
    throw new Error(
      `offer sequence does not match the contract (${ledger.offerSequence} != ${binding.offerSequence})`
    );
  }
  if (!equalBytes(ledger.escrowDestination, binding.destination)) {
    throw new Error('escrow destination does not match the contract');
  }
  const preimage = bytes32(ledger.revealedPreimage);
  const commit = preimageCommit(preimage);
  if (!equalBytes(commit, ledger.preimageCommit)) {
    throw new Error('revealed preimage does not match preimageCommit');
  }
  const xrpl = xrplConditionFromPreimage(preimage);
  const expect = String(expected.condition || '').toUpperCase();
  if (!expect || xrpl.condition !== expect) {
    throw new Error('revealed preimage does not open the XRPL escrow condition');
  }
  return {
    source: 'midnight-revealed-preimage',
    condition: xrpl.condition,
    fulfillment: xrpl.fulfillment,
    escrowOwner: Buffer.from(binding.owner).toString('hex'),
    offerSequence: binding.offerSequence.toString(),
    escrowDestination: Buffer.from(binding.destination).toString('hex'),
  };
}

export function bytesEqual(a, b) {
  return equalBytes(a, b);
}
