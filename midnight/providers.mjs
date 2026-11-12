/**
 * Midnight Preprod providers for deploy / on-chain callTx — ledger 9 (Wallet SDK 2.0.0, Midnight.js 5.0.0).
 * Same function names as the ledger 8 version so sdk-bridge.mjs and its tests are unchanged.
 * Never logs seeds or Blockfrost project ids.
 */
import path from 'node:path';
import { openWallet9, providersFor, assertProofServer as assert9, preprodEnv, redactErr } from './wallet9.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);

/** Open the throwaway deployer wallet, sync (bounded), require DUST > 0 (registers test NIGHT for DUST if needed). */
export async function openSyncedWallet(o = {}) {
  const syncTimeoutMs = Number(o.syncTimeoutMs ?? process.env.MN_SYNC_TIMEOUT_MS ?? 90_000);
  const w = await openWallet9({ walletDir: process.env.MN_WALLET_DIR ?? here, walletName: o.walletName ?? 'deployer', syncTimeoutMs, registerDust: o.registerDust ?? true, log: o.log ?? (() => {}) });
  if (BigInt(w.status.dustBalanceSpeck) <= 0n) {
    await w.stop();
    throw new Error('Midnight wallet is synced but DUST balance is 0. Register test NIGHT for DUST first (node deploy.mjs).');
  }
  return { ctx: w, wallet: w.wallet, state: null, status: w.status };
}

/** ContractProviders factory used by deployContract / findDeployedContract. */
export function makeProvidersFactory(ctx) {
  return (name) => providersFor(ctx, { zkConfigPath: path.join(here, 'managed', name), storeName: 'corvuszk-' + name });
}

export async function assertProofServer(url = preprodEnv().proofServer) {
  try { return await assert9(url); }
  catch (e) { throw new Error('Midnight proof server not reachable or wrong version: ' + redactErr(e).split('\n')[0].slice(0, 200)); }
}

export const cfg = new Proxy({}, { get: (_, k) => { const e = preprodEnv(); return { indexerHttpUrl: e.indexer, indexerWsUrl: e.indexerWS, nodeWsUrl: e.nodeWS, proofServerUrl: e.proofServer }[k]; } });
export { redactErr, here };
