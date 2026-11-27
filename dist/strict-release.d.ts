import { type IntentV2 } from './intent.js';
import { type MemoryPolicyRegistry } from './registry.js';
import type { ExpectedChainPolicy, VerificationOutcome } from './index.js';
export type StrictReleaseStatus = 'settled' | 'already-settled' | 'refused' | 'unavailable' | 'pending' | 'expired' | 'reconcile';
export type StrictReleaseResult = {
    status: StrictReleaseStatus;
    reason: string;
    txHash?: string;
};
export type TrustMode = 'trusted-policy-party';
/** ADR-001: the only supported product mode. */
export declare const TRUST_MODE: TrustMode;
export declare const TRUST_MODE_DISCLOSURE: string;
type XrplLike = {
    request: (r: any) => Promise<any>;
    submitAndWait: (tx: any, o: {
        wallet: any;
    }) => Promise<any>;
};
type StrictBackend = {
    verifyStrict: (proof: null, policy: ExpectedChainPolicy) => Promise<VerificationOutcome>;
    circuitArtifactId?: (template: string) => Promise<string>;
};
export declare function releaseStrict(o: {
    client: XrplLike;
    submitter: {
        address: string;
    };
    backend: StrictBackend;
    registry: MemoryPolicyRegistry;
    intent: IntentV2;
    contractAddress: string;
    trustMode: TrustMode;
    now?: () => number;
}): Promise<StrictReleaseResult>;
export {};
