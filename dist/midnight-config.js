/** Midnight Preprod provider config. Token is read from env BLOCKFROST_MIDNIGHT_PREPROD and never logged. */
export function preprodConfig(env = process.env) {
    const t = env.BLOCKFROST_MIDNIGHT_PREPROD;
    if (!t)
        throw new Error('Set BLOCKFROST_MIDNIGHT_PREPROD (Blockfrost Midnight Preprod project id)');
    const q = `?project_id=${encodeURIComponent(t)}`;
    return {
        networkId: 'preprod',
        indexerHttpUrl: `https://midnight-preprod.blockfrost.io/api/v0${q}`,
        indexerWsUrl: `wss://midnight-preprod.blockfrost.io/api/v0/ws${q}`,
        nodeRpcUrl: `https://rpc.midnight-preprod.blockfrost.io${q}`,
        nodeWsUrl: `wss://rpc.midnight-preprod.blockfrost.io${q}`,
        proofServerUrl: env.MIDNIGHT_PROOF_SERVER ?? 'http://localhost:6300',
        faucetUrl: 'https://midnight-tmnight-preprod.nethermind.dev/',
    };
}
/** Redacts the token from any URL before display. */
export const redact = (u) => u.replace(/project_id=[^&]+/, 'project_id=***');
