export type IntentV2 = {
    protocolVersion: 2;
    domain: 'corvuszk:intent:v2';
    environment: 'local' | 'testnet' | 'mainnet';
    xrplNetworkId: number;
    owner: string;
    offerSequence: number;
    destination: string;
    destinationTag: number | null;
    asset: 'XRP';
    /** Canonical decimal string of drops, no sign, no leading zeros. */
    amountDrops: string;
    /** PREIMAGE-SHA-256 crypto-condition, hex. */
    condition: string;
    /** XRPL (Ripple-epoch) seconds. */
    finishAfter: number | null;
    cancelAfter: number;
    midnightNetwork: 'local' | 'preprod' | 'mainnet';
    /** sha256 over the deployed circuit verifier keys (sdk-bridge circuitArtifactId). */
    circuitArtifactId: string;
    policyId: string;
    policyVersion: number;
    /** Issuer public key coordinates, hex without 0x. */
    issuerX: string;
    issuerY: string;
    credentialType: string;
    /** Decimal string, the contract's asOf. */
    asOf: string;
    intentId: string;
    /** Unix seconds. */
    issuedAt: number;
    expiresAt: number;
};
export declare const INTENT_V2_FIELDS: readonly ['protocolVersion', 'domain', 'environment', 'xrplNetworkId', 'owner', 'offerSequence', 'destination', 'destinationTag', 'asset', 'amountDrops', 'condition', 'finishAfter', 'cancelAfter', 'midnightNetwork', 'circuitArtifactId', 'policyId', 'policyVersion', 'issuerX', 'issuerY', 'credentialType', 'asOf', 'intentId', 'issuedAt', 'expiresAt'];
/** Validate and normalize. Throws on anything unexpected. */
export declare function normalizeIntentV2(input: unknown): IntentV2;
/**
 * Canonical bytes: "CZKI2" || for each field in INTENT_V2_FIELDS order:
 * u16be(len(name)) || name || u32be(len(value)) || value, where value is the UTF-8 of the
 * normalized value (integers in decimal, null as the 4 bytes "null", accounts as 40-hex account id).
 */
export declare function encodeIntentV2(input: unknown): Buffer;
/** Hex SHA-256 of the canonical encoding. This is what eligibility_v2 stores as intentHash. */
export declare function intentHashV2(input: unknown): string;
