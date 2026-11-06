/** Midnight Preprod provider config. Token is read from env BLOCKFROST_MIDNIGHT_PREPROD and never logged. */
export declare function preprodConfig(env?: Record<string, string | undefined>): {
    networkId: 'preprod';
    indexerHttpUrl: string;
    indexerWsUrl: string;
    nodeRpcUrl: string;
    nodeWsUrl: string;
    proofServerUrl: string;
    faucetUrl: string;
};
/** Redacts the token from any URL before display. */
export declare const redact: (u: string) => string;
