import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  holderSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  expiry(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  nonceX(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  nonceY(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  sigS(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  releasePreimage(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  prove(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  reveal(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  prove(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  reveal(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  prove(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  reveal(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly issuerX: bigint;
  readonly issuerY: bigint;
  readonly credentialType: Uint8Array;
  readonly asOf: bigint;
  readonly preimageCommit: Uint8Array;
  readonly escrowOwner: Uint8Array;
  readonly offerSequence: bigint;
  readonly escrowDestination: Uint8Array;
  readonly proven: boolean;
  readonly nullifier: Uint8Array;
  readonly preimageRevealed: boolean;
  readonly revealedPreimage: Uint8Array;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               ix_0: bigint,
               iy_0: bigint,
               ctype_0: Uint8Array,
               asOf__0: bigint,
               pCommit_0: Uint8Array,
               owner_0: Uint8Array,
               seq_0: bigint,
               dest_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
