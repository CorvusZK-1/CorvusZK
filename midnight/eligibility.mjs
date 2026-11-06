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
import cc from 'five-bells-condition';
import { decodeAccountID } from 'xrpl';

export const MOCK_ISSUER_LABEL =
  'MOCK ISSUER — demonstration only. Not a regulated KYC or accreditation provider, not an XRPL CredentialCreate, and not checked by the XRPL ledger.';

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
  if (raw.length === 32) return new Uint8Array(raw);
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
  const raw = bytes32(preimage);
  const f = new cc.PreimageSha256();
  f.setPreimage(Buffer.from(raw));
  return {
    condition: f.getConditionBinary().toString('hex').toUpperCase(),
    fulfillment: f.serializeBinary().toString('hex').toUpperCase(),
  };
}

/**
 * Setup role only. Returns the preimage the creator already knows.
 * A releaser who was not given this object cannot finish the XRPL escrow
 * until `reveal` writes the preimage into contract state.
 * The creator can still submit EscrowFinish directly. XRPL does not check Midnight.
 */
export function createBoundPreimage() {
  const preimage = new Uint8Array(crypto.randomBytes(32));
  const commit = preimageCommit(preimage);
  const xrpl = xrplConditionFromPreimage(preimage);
  return {
    role: 'setup',
    note: 'The setup party knows this preimage and can finish the XRPL escrow without Midnight. Do not give preimage or fulfillment to the releaser.',
    preimage,
    preimageCommit: commit,
    condition: xrpl.condition,
    fulfillment: xrpl.fulfillment,
  };
}

async function loadContract(managedRoot) {
  const modPath = path.join(managedRoot, 'eligibility', 'contract', 'index.js');
  return import(pathToFileURL(modPath).href);
}

function call(C, contractState, name) {
  const ctx = rt.createCircuitContext(
    rt.dummyContractAddress(),
    '0'.repeat(64),
    contractState,
    {}
  );
  return C.circuits[name](ctx);
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
  const m = await loadContract(managedRoot);
  const signature = o.signature ?? o.credential?.signature;
  const holderSecret = o.holderSecret;
  const expiry = o.expiry ?? o.credential?.Expiration;
  const C = new m.Contract(witnesses({ ...o, holderSecret, signature, expiry }));
  const ctor = rt.createConstructorContext({}, '0'.repeat(64));
  const chainIssuer = o.chainIssuer ?? o.issuer;
  const binding = encodeEscrowBinding(o.escrow);
  const initial = C.initialState(
    ctor,
    chainIssuer.publicKey.x,
    chainIssuer.publicKey.y,
    pad32(o.credential.CredentialType),
    BigInt(o.asOf),
    bytes32(o.preimageCommit),
    binding.owner,
    binding.offerSequence,
    binding.destination
  );
  let state = initial.currentContractState;
  if (o.only !== 'reveal') {
    const proved = call(C, state, 'prove');
    state = proved.context.currentQueryContext.state;
    if (o.again) call(C, state, 'prove');
  }
  if (o.reveal || o.only === 'reveal') {
    const C2 = new m.Contract(
      witnesses({ ...o, holderSecret, signature, expiry, releasePreimage: o.releasePreimage })
    );
    const revealed = call(C2, state, 'reveal');
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
  };
}

/**
 * Releaser path. Builds the XRPL fulfillment from contract state.
 * Refuses unless prove() and reveal() have both succeeded, the revealed
 * preimage matches the commitment, and the caller names the same owner,
 * offer sequence, destination, and condition stored on that contract.
 */
export function fulfillmentFromRevealedLedger(ledger, expected) {
  if (!ledger || ledger.proven !== true) {
    throw new Error('eligibility not proven; refusing to derive the XRPL fulfillment');
  }
  if (ledger.preimageRevealed !== true) {
    throw new Error('preimage is not on contract state; refusing to derive the XRPL fulfillment');
  }
  if (!ledger.nullifier || Buffer.from(ledger.nullifier).every((b) => b === 0)) {
    throw new Error('escrow nullifier is missing; refusing to derive the XRPL fulfillment');
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
