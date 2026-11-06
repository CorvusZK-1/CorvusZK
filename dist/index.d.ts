import * as xrpl from 'xrpl';
export type Claim = {
    kind: 'condition';
    commitment: string;
} | {
    kind: 'balanceAbove';
    threshold: number;
    commitment: string;
} | {
    kind: 'ageOver';
    minAge: number;
    asOfYear: number;
    commitment: string;
};
/** Private witnesses for Midnight Compact circuits. Never stored; never placed on Proof.claim. */
export type PrivateWitness = {
    kind: 'condition';
    secret: string | Uint8Array;
    deliveryOk?: boolean;
} | {
    kind: 'balanceAbove';
    balance: number;
    salt: string | Uint8Array;
} | {
    kind: 'ageOver';
    birthYear: number;
    salt: string | Uint8Array;
};
export interface Proof {
    claim: Claim;
    backend: 'local-simulation' | 'midnight';
    zk: boolean;
    attestation: string;
    signerPublicKey: string;
    createdAt: number;
}
export interface ProofBackend {
    name: Proof['backend'];
    prove(claim: Claim, privateOk: boolean, witness?: PrivateWitness): Promise<Proof>;
    verify(proof: Proof): Promise<boolean>;
}
/** Injectable bridge shape (tests / custom loaders). */
export type OnChainSubmitResult = {
    template: string;
    circuit: string;
    contractAddress: string;
    txId: string;
    txHash: string;
    blockHeight?: number;
    fees?: {
        paidFees: string | null;
        estimatedFees: string | null;
    };
};
export type MidnightBridge = {
    proveLocal: (o: {
        template: 'condition' | 'age_over' | 'balance_above';
        publicInputs: Record<string, unknown>;
        witness: Record<string, unknown>;
        managedRoot?: string;
    }) => Promise<{
        template: string;
        circuit: string;
        commitmentHex: string;
        ledger: Record<string, unknown>;
        transcriptHex: string;
    }>;
    loadDeployments?: (p?: string) => null | {
        deployments?: Record<string, {
            contractAddress?: string;
            call?: {
                txHash?: string;
            };
        }>;
    };
    verifyOnChainLedger?: (o: {
        template: string;
        contractAddress: string;
        indexerHttpUrl: string;
        indexerWsUrl: string;
        managedRoot?: string;
    }) => Promise<{
        found: boolean;
        ok: boolean;
    }>;
    /** Submit attest/prove callTx against an already-deployed Preprod contract. */
    submitCallTx?: (o: {
        template: 'condition' | 'age_over' | 'balance_above' | 'eligibility';
        circuit?: 'attest' | 'prove' | 'reveal';
        contractAddress: string;
        witness: Record<string, unknown>;
        managedRoot?: string;
        walletName?: string;
        syncTimeoutMs?: number;
    }) => Promise<OnChainSubmitResult>;
    deployEligibility?: (o: Record<string, unknown>) => Promise<OnChainSubmitResult>;
    callEligibility?: (o: Record<string, unknown>) => Promise<OnChainSubmitResult>;
    readEligibilityState?: (o: Record<string, unknown>) => Promise<{
        found: boolean;
        proven: boolean;
        preimageRevealed: boolean;
        revealedPreimage: Uint8Array | null;
        ledger: Record<string, unknown> | null;
        rawLedger: Record<string, unknown> | null;
    }>;
    closeEligibilitySession?: (contractAddress: string) => Promise<void>;
    defaultManagedRoot?: string;
    defaultDeploymentsPath?: string;
};
export type MidnightBackendOpts = {
    blockfrostProjectId?: string;
    proofServer?: string;
    walletSeedFile?: string;
    /** `local-circuits` (default): run compiled Compact circuits locally. `preprod`: same prove path + attach/deployments verify. */
    mode?: 'local-circuits' | 'preprod';
    deploymentsPath?: string;
    managedRoot?: string;
    /** Wallet name key inside midnight/.wallets.preprod.json (default deployer). Path only — never logged. */
    walletName?: string;
    /** Hard cap for wallet sync before submitOnChain fails (default 90000). */
    syncTimeoutMs?: number;
    /** Override dynamic import of midnight/sdk-bridge.mjs (unit tests). */
    bridge?: MidnightBridge;
};
/** Hiding commitment to a private value: sha256(salt || value). */
export declare function commit(value: string | number, salt: string): string;
export declare class LocalSimulationBackend implements ProofBackend {
    name: 'local-simulation';
    private key;
    readonly publicKey: string;
    prove(claim: Claim, privateOk: boolean, _witness?: PrivateWitness): Promise<Proof>;
    verify(p: Proof): Promise<boolean>;
}
export declare class MidnightBackend implements ProofBackend {
    name: 'midnight';
    readonly opts: MidnightBackendOpts;
    private key;
    readonly publicKey: string;
    private bridgePromise;
    constructor(opts?: MidnightBackendOpts);
    private requireConfig;
    private getBridge;
    private templateFor;
    private buildWitness;
    private signAttestation;
    private parseAttestation;
    prove(claim: Claim, privateOk: boolean, witness?: PrivateWitness): Promise<Proof>;
    verify(proof: Proof): Promise<boolean>;
    /**
     * Submit a new on-chain Midnight Preprod callTx (attest or prove) against an already-deployed
     * contract. Callers pass private witnesses; nothing is persisted by the SDK.
     * Requires BLOCKFROST / blockfrostProjectId, a reachable proof server, a synced funded wallet
     * with DUST, and a contract address (from deployments.preprod.json or opts).
     * Does not redeploy and does not wait for DUST registration — fails fast with a clear error.
     */
    submitOnChain(o: {
        claim: Claim;
        witness: PrivateWitness;
        contractAddress?: string;
        walletName?: string;
        syncTimeoutMs?: number;
    }): Promise<OnChainSubmitResult & {
        proof: Proof;
    }>;
    /**
     * Deploy a fresh eligibility contract on Midnight Preprod.
     * Pass the preimage commitment and escrow binding, not the preimage.
     * The in-process wallet stays open for callEligibility until closeEligibilitySession.
     */
    deployEligibility(o: {
        issuer: {
            publicKey: {
                x: bigint;
                y: bigint;
            };
        };
        credentialType: string;
        asOf: bigint | number | string;
        preimageCommit: Uint8Array;
        escrow: {
            owner: string | Uint8Array;
            offerSequence: number | bigint;
            destination: string | Uint8Array;
        };
        witness?: Record<string, unknown>;
        walletName?: string;
        syncTimeoutMs?: number;
    }): Promise<OnChainSubmitResult>;
    /** Post eligibility prove() or reveal() on Preprod. Witnesses are caller-supplied and not stored. */
    callEligibility(o: {
        circuit: 'prove' | 'reveal';
        contractAddress: string;
        witness: Record<string, unknown>;
        walletName?: string;
        syncTimeoutMs?: number;
    }): Promise<OnChainSubmitResult>;
    /**
     * Read the eligibility ledger from the Preprod indexer.
     * `revealedPreimage` is set only after reveal() is in the indexed state.
     */
    readEligibilityState(o: {
        contractAddress: string;
        waitMs?: number;
    }): Promise<{
        found: boolean;
        proven: boolean;
        preimageRevealed: boolean;
        revealedPreimage: Uint8Array | null;
        ledger: Record<string, unknown> | null;
        rawLedger: Record<string, unknown> | null;
    }>;
    closeEligibilitySession(contractAddress: string): Promise<void>;
}
export declare function proveCondition(b: ProofBackend, secret: string, salt: string, commitment: string): Promise<Proof>;
export declare function proveBalanceAbove(b: ProofBackend, balance: number, threshold: number, salt: string): Promise<Proof>;
export declare function proveAgeOver(b: ProofBackend, birthYear: number, minAge: number, asOfYear: number, salt: string): Promise<Proof>;
/** Fee string from an xrpl.js submitAndWait result, in drops. Null when the receipt omits it. */
export declare function feeDropsFromXrplResult(result: unknown): string | null;
/** paidFees / estimatedFees from a Midnight finalization receipt. Null fields mean the receipt omitted them. */
export declare function feesFromMidnightReceipt(pub: {
    fees?: {
        paidFees?: unknown;
        estimatedFees?: unknown;
    };
} | null | undefined): {
    paidFees: string | null;
    estimatedFees: string | null;
};
/** PREIMAGE-SHA-256 condition. The caller receives the fulfillment immediately.
 *  This function does not bind that fulfillment to a Midnight proof.
 *  The bound path is midnight/eligibility.mjs (see README "Security model").
 */
export declare function createCryptoCondition(): {
    condition: any;
    fulfillment: any;
};
export declare function createEscrow(client: xrpl.Client, payer: xrpl.Wallet, o: {
    destination: string;
    amountXrp: string;
    condition: string;
    cancelAfterSec?: number;
}): Promise<{
    hash: string;
    result: string;
    owner: string;
    offerSequence: number;
    feeDrops: string | null;
}>;
/** Verifies the proof first; only then submits EscrowFinish. Funds can only go to the escrow's fixed Destination. */
export declare function verifyAndReleaseEscrow(client: xrpl.Client, submitter: xrpl.Wallet, o: {
    backend: ProofBackend;
    proof: Proof;
    owner: string;
    offerSequence: number;
    condition: string;
    fulfillment: string;
}): Promise<{
    released: false;
    reason: string;
    hash?: undefined;
    feeDrops?: undefined;
} | {
    released: boolean;
    reason: string;
    hash: string;
    feeDrops: string | null;
}>;
export declare const XRPL_TESTNET_WSS = "wss://testnet.xrpl-labs.com";
export declare const explorerTx: (h: string) => string;
export * from './midnight-config.js';
