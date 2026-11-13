/**
 * Typed witness implementations for the four CorvusZK Compact contracts.
 *
 * In Compact, a `witness` declaration is a private input the circuit asks the
 * caller's machine for. It never goes on the public ledger unless the circuit
 * explicitly `disclose()`s something derived from it. This file is the typed
 * TypeScript side of those declarations, in the standard Midnight.js shape:
 * each witness reads the contract's private state and returns
 * `[privateState, value]`.
 *
 * The same logic is used by the JavaScript runtime code:
 *   - `midnight/sdk-bridge.mjs` (`witnessesFor`) for condition / age_over /
 *     balance_above and the Preprod `callTx` path,
 *   - `midnight/eligibility.mjs` (`witnesses`) for the eligibility contract.
 * Those files stay plain `.mjs` so the SDK runs on Node 20 without a build
 * step. `test/templates.test.mjs` drives the compiled contracts through these
 * typed witnesses, and CI type-checks this file against the compiler's
 * generated `Witnesses<PS>` types (`npm run typecheck:witnesses`).
 *
 * Nothing here logs or persists private values.
 */
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type {
  Ledger as ConditionLedger,
  Witnesses as ConditionWitnesses,
} from './managed/condition/contract/index.js';
import type {
  Ledger as AgeOverLedger,
  Witnesses as AgeOverWitnesses,
} from './managed/age_over/contract/index.js';
import type {
  Ledger as BalanceAboveLedger,
  Witnesses as BalanceAboveWitnesses,
} from './managed/balance_above/contract/index.js';
import type {
  Ledger as EligibilityLedger,
  Witnesses as EligibilityWitnesses,
} from './managed/eligibility/contract/index.js';

/** 32 zero bytes, used when a witness is asked for before it is known (e.g. preimage before reveal). */
const zeros32 = (): Uint8Array => new Uint8Array(32);

function bytes32(value: Uint8Array, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error(`${name} must be a 32-byte Uint8Array`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// condition.compact: witness attesterSecret(): Bytes<32>; witness deliveryOk(): Boolean;
// ---------------------------------------------------------------------------

/** Private state of the delivery attester. `attesterSecret` must hash to the public `attesterCommit`. */
export type ConditionPrivateState = {
  readonly attesterSecret: Uint8Array;
  readonly deliveryOk: boolean;
};

export const createConditionPrivateState = (attesterSecret: Uint8Array, deliveryOk = true): ConditionPrivateState => ({
  attesterSecret: bytes32(attesterSecret, 'attesterSecret'),
  deliveryOk,
});

export const conditionWitnesses: ConditionWitnesses<ConditionPrivateState> = {
  attesterSecret: ({ privateState }: WitnessContext<ConditionLedger, ConditionPrivateState>) => [
    privateState,
    privateState.attesterSecret,
  ],
  deliveryOk: ({ privateState }: WitnessContext<ConditionLedger, ConditionPrivateState>) => [
    privateState,
    privateState.deliveryOk,
  ],
};

// ---------------------------------------------------------------------------
// age_over.compact: witness birthYear(): Uint<16>; witness salt(): Bytes<32>;
// ---------------------------------------------------------------------------

/** Private state of the age holder. `persistentHash([salt, birthYear])` must equal the public `birthCommit`. */
export type AgeOverPrivateState = {
  readonly birthYear: bigint;
  readonly salt: Uint8Array;
};

export const createAgeOverPrivateState = (birthYear: number | bigint, salt: Uint8Array): AgeOverPrivateState => {
  const by = BigInt(birthYear);
  if (by < 0n || by > 0xffffn) throw new Error('birthYear must fit Uint<16>');
  return { birthYear: by, salt: bytes32(salt, 'salt') };
};

export const ageOverWitnesses: AgeOverWitnesses<AgeOverPrivateState> = {
  birthYear: ({ privateState }: WitnessContext<AgeOverLedger, AgeOverPrivateState>) => [
    privateState,
    privateState.birthYear,
  ],
  salt: ({ privateState }: WitnessContext<AgeOverLedger, AgeOverPrivateState>) => [privateState, privateState.salt],
};

// ---------------------------------------------------------------------------
// balance_above.compact: witness balance(): Uint<64>; witness salt(): Bytes<32>;
// ---------------------------------------------------------------------------

/** Private state of the balance holder. `persistentHash([salt, balance])` must equal the public `balanceCommit`. */
export type BalanceAbovePrivateState = {
  readonly balance: bigint;
  readonly salt: Uint8Array;
};

export const createBalanceAbovePrivateState = (balance: number | bigint, salt: Uint8Array): BalanceAbovePrivateState => {
  const b = BigInt(balance);
  if (b < 0n || b > 0xffffffffffffffffn) throw new Error('balance must fit Uint<64>');
  return { balance: b, salt: bytes32(salt, 'salt') };
};

export const balanceAboveWitnesses: BalanceAboveWitnesses<BalanceAbovePrivateState> = {
  balance: ({ privateState }: WitnessContext<BalanceAboveLedger, BalanceAbovePrivateState>) => [
    privateState,
    privateState.balance,
  ],
  salt: ({ privateState }: WitnessContext<BalanceAboveLedger, BalanceAbovePrivateState>) => [
    privateState,
    privateState.salt,
  ],
};

// ---------------------------------------------------------------------------
// eligibility.compact:
//   witness holderSecret(): Bytes<32>;  witness expiry(): Uint<64>;
//   witness nonceX(): Field;            witness nonceY(): Field;
//   witness sigS(): JubjubScalar;       witness releasePreimage(): Bytes<32>;
// ---------------------------------------------------------------------------

/**
 * Private state of the credential holder (and, for reveal, of the party that
 * sampled the release preimage). The signature is the MOCK issuer's Schnorr
 * signature from `issueMockCredential` in `midnight/eligibility.mjs`.
 */
export type EligibilityPrivateState = {
  readonly holderSecret: Uint8Array;
  readonly expiry: bigint;
  readonly signature: { readonly nonceX: bigint; readonly nonceY: bigint; readonly s: bigint };
  /** Only needed for `reveal()`. Left unset for `prove()`. */
  readonly releasePreimage?: Uint8Array;
};

export const createEligibilityPrivateState = (o: {
  holderSecret: Uint8Array;
  expiry: number | bigint;
  signature: { nonceX: string | bigint; nonceY: string | bigint; s: string | bigint };
  releasePreimage?: Uint8Array;
}): EligibilityPrivateState => ({
  holderSecret: bytes32(o.holderSecret, 'holderSecret'),
  expiry: BigInt(o.expiry),
  signature: { nonceX: BigInt(o.signature.nonceX), nonceY: BigInt(o.signature.nonceY), s: BigInt(o.signature.s) },
  releasePreimage: o.releasePreimage === undefined ? undefined : bytes32(o.releasePreimage, 'releasePreimage'),
});

type EligCtx = WitnessContext<EligibilityLedger, EligibilityPrivateState>;

export const eligibilityWitnesses: EligibilityWitnesses<EligibilityPrivateState> = {
  holderSecret: ({ privateState }: EligCtx) => [privateState, privateState.holderSecret],
  expiry: ({ privateState }: EligCtx) => [privateState, privateState.expiry],
  nonceX: ({ privateState }: EligCtx) => [privateState, privateState.signature.nonceX],
  nonceY: ({ privateState }: EligCtx) => [privateState, privateState.signature.nonceY],
  sigS: ({ privateState }: EligCtx) => [privateState, privateState.signature.s],
  releasePreimage: ({ privateState }: EligCtx) => [privateState, privateState.releasePreimage ?? zeros32()],
};
