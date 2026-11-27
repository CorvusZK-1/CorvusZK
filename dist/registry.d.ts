export type IntentState = 'registered' | 'submitting' | 'submitted-unknown' | 'settled' | 'failed';
export type IntentRecord = {
    intentHash: string;
    contractAddress?: string;
    credentialNullifier?: string;
    state: IntentState;
    txHash?: string;
    reason?: string;
};
export type RegistryData = {
    v: 1;
    intents: Record<string, IntentRecord>;
    credentials: Record<string, string>;
};
export declare class RegistryConflict extends Error {
    code: 'intent-hash-conflict' | 'contract-already-bound' | 'credential-already-used' | 'intent-not-registered';
    constructor(code: 'intent-hash-conflict' | 'contract-already-bound' | 'credential-already-used' | 'intent-not-registered', msg: string);
}
export declare class MemoryPolicyRegistry {
    protected data: RegistryData;
    protected save(): void;
    get(intentId: string): IntentRecord | undefined;
    /** Idempotent for the same hash; refuses a different intent under the same id. */
    registerIntent(intentId: string, intentHash: string): void;
    bindContract(intentId: string, contractAddress: string): void;
    /** One credential nullifier may be consumed by one intent only. Same intent again is fine. */
    claimCredential(credentialNullifier: string, intentId: string): void;
    setState(intentId: string, state: IntentState, extra?: {
        txHash?: string;
        reason?: string;
    }): void;
}
/** JSON-file registry (mode 0600, atomic replace). Holds no secrets: hashes, ids, states only. */
export declare class FilePolicyRegistry extends MemoryPolicyRegistry {
    private file;
    constructor(file: string);
    protected save(): void;
}
