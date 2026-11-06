/**
 * Shared Midnight Preprod providers for deploy / on-chain callTx.
 * Never logs seeds or Blockfrost project ids.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { buildWallet, synced, summarize, cfg, redactErr } from './wallet.mjs';
import * as Rx from 'rxjs';

const here = path.dirname(new URL(import.meta.url).pathname);

/** Workaround from example-counter (signRecipe hardcodes 'pre-proof'). */
export function signIntents(tx, signFn, marker) {
  if (!tx?.intents || tx.intents.size === 0) return;
  for (const seg of tx.intents.keys()) {
    const it = tx.intents.get(seg);
    if (!it) continue;
    const c = ledger.Intent.deserialize('signature', marker, 'pre-binding', it.serialize());
    const sig = signFn(c.signatureData(seg));
    for (const k of ['fallibleUnshieldedOffer', 'guaranteedUnshieldedOffer']) {
      if (c[k]) c[k] = c[k].addSignatures(c[k].inputs.map((_, i) => c[k].signatures.at(i) ?? sig));
    }
    tx.intents.set(seg, c);
  }
}

/**
 * Open deployer (or named) wallet, wait until synced with a hard timeout, require DUST > 0.
 * @param {{ walletName?: string, syncTimeoutMs?: number }} o
 */
export async function openSyncedWallet(o = {}) {
  const walletName = o.walletName ?? 'deployer';
  const syncTimeoutMs = Number(o.syncTimeoutMs ?? process.env.MN_SYNC_TIMEOUT_MS ?? 90_000);
  const ctx = await buildWallet(walletName);
  const w = ctx.wallet;
  let s;
  try {
    s = await Rx.firstValueFrom(
      w.state().pipe(
        Rx.filter((x) => x.isSynced),
        Rx.timeout({ first: syncTimeoutMs })
      )
    );
  } catch (e) {
    try {
      await ctx.saveSnap?.();
    } catch {}
    const msg = redactErr(e);
    throw new Error(
      `Midnight wallet did not sync within ${syncTimeoutMs}ms. ` +
        `Restore may need more time, or the indexer is unreachable. ` +
        `Set MN_SYNC_TIMEOUT_MS higher if you have a saved .wallet-state.*.preprod.json. (${msg.slice(0, 200)})`
    );
  }
  const dust = s.dust.balance(new Date());
  if (dust <= 0n) {
    throw new Error(
      'Midnight wallet is synced but DUST balance is 0. Register NIGHT for DUST via midnight/deploy.mjs (or the faucet path) before on-chain submit. Not waiting here.'
    );
  }
  return { ctx, wallet: w, state: s, status: summarize(s) };
}

/** Build the ContractProviders factory used by deployContract / findDeployedContract. */
export function makeProvidersFactory(ctx, wallet, state) {
  const wp = {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
    async balanceTx(tx, ttl) {
      const r = await wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60_000) }
      );
      const f = (p) => ctx.unshieldedKeystore.signData(p);
      signIntents(r.baseTransaction, f, 'proof');
      if (r.balancingTransaction) signIntents(r.balancingTransaction, f, 'pre-proof');
      return wallet.finalizeRecipe(r);
    },
    submitTx: (tx) => wallet.submitTransaction(tx),
  };
  const acct = wp.getCoinPublicKey();
  const pw = Buffer.from(acct, 'hex').toString('base64') + '!';
  return (name) => {
    const zk = new NodeZkConfigProvider(path.join(here, 'managed', name));
    return {
      privateStateProvider: levelPrivateStateProvider({
        privateStateStoreName: 'corvuszk-' + name,
        accountId: acct,
        privateStoragePasswordProvider: () => pw,
      }),
      publicDataProvider: indexerPublicDataProvider(cfg.indexerHttpUrl, cfg.indexerWsUrl),
      zkConfigProvider: zk,
      proofProvider: httpClientProofProvider(cfg.proofServerUrl, zk),
      walletProvider: wp,
      midnightProvider: wp,
    };
  };
}

/** Quick proof-server reachability check (never logs URLs with tokens). */
export async function assertProofServer(url = cfg.proofServerUrl, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`proof server HTTP ${res.status}`);
  } catch (e) {
    throw new Error(
      `Midnight proof server not reachable at ${url.replace(/\?.*$/, '')}. ` +
        `Start: docker run -p 6300:6300 midnightntwrk/proof-server:8.1.3 midnight-proof-server -v. ` +
        `(${redactErr(e).slice(0, 160)})`
    );
  } finally {
    clearTimeout(t);
  }
}

export { cfg, redactErr, here };
