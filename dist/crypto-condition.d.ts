/** Largest preimage accepted. XRPL limits a fulfillment to 256 bytes; this is a generous parser bound. */
export declare const MAX_PREIMAGE_BYTES = 65535;
/** Condition + fulfillment (uppercase hex, the form XRPL transactions use) for a preimage. */
export declare function preimageSha256(preimage: Uint8Array): {
    condition: string;
    fulfillment: string;
};
/** Extract the preimage from a PREIMAGE-SHA-256 fulfillment. Throws on anything else. */
export declare function preimageFromFulfillment(fulfillment: Uint8Array | string): Buffer;
/** Condition (uppercase hex) that a fulfillment satisfies. */
export declare function conditionFromFulfillment(fulfillment: Uint8Array | string): string;
/** True only if the fulfillment is a well-formed PREIMAGE-SHA-256 fulfillment for exactly this condition. */
export declare function validateFulfillment(fulfillment: Uint8Array | string, condition: Uint8Array | string): boolean;
