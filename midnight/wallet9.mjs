// Ledger 9 wallet + providers for Midnight Preprod, Preview, undeployed, and Mainnet
// (Wallet SDK 2.0.0, Midnight.js 5.0.0). Built on @midnight-ntwrk/testkit-js 5.0.0 helpers (Apache-2.0).
// Never logs seeds or the Blockfrost project id. On mainnet, never auto-registers NIGHT for DUST.
import fs from 'node:fs';
import path from 'node:path';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import {
  FluentWalletBuilder, MidnightWalletProvider, initializeMidnightProviders, logger as tkLogger, syncWallet, WalletSeeds, DEFAULT_DUST_OPTIONS,
} from '@midnight-ntwrk/testkit-js';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/v9';
import {
  NetworkId, ShieldedWallet, UnshieldedWallet, DustWallet, WalletFacade, PublicKey, createKeystore,
  InMemoryTransactionHistoryStorage, WalletEntrySchema, mergeWalletEntries,
} from '@midnightntwrk/wallet-sdk';

globalThis.WebSocket ??= WebSocket;
const HERE = path.dirname(new URL(import.meta.url).pathname);
tkLogger.level = process.env.MN_TESTKIT_LOG ?? 'silent'; // testkit logs configs that contain the project id

export const redactErr = (e) => String(e?.stack || e)
  .replace(/project_id=[^&\s"']+/gi, 'project_id=***')
  .replace(/nightpreprod[A-Za-z0-9]+/g, 'nightpreprod***')
  .replace(/midnightmainnet[A-Za-z0-9]+/gi, 'midnightmainnet***')
  .replace(/mainnet[A-Za-z0-9]{20,}/g, 'mainnet***');

/**
 * Network endpoints. MIDNIGHT_NETWORK=preprod (default) uses Blockfrost and needs BLOCKFROST_MIDNIGHT_PREPROD.
 * MIDNIGHT_NETWORK=preview uses the Midnight-hosted Preview endpoints, which need no token.
 * MIDNIGHT_NETWORK=mainnet uses Blockfrost Midnight Mainnet and needs BLOCKFROST_MIDNIGHT_MAINNET.
 */
export function midnightEnv(env = process.env) {
  const network = (env.MIDNIGHT_NETWORK ?? 'preprod').toLowerCase();
  const proofServer = env.MIDNIGHT_PROOF_SERVER ?? 'http://localhost:6300';
  if (network === 'undeployed' || network === 'local') {
    // Local devnet (node + indexer in Docker). For tests only.
    return {
      walletNetworkId: NetworkId.NetworkId.Undeployed,
      networkId: 'undeployed',
      indexer: env.MIDNIGHT_LOCAL_INDEXER ?? 'http://127.0.0.1:8088/api/v4/graphql',
      indexerWS: env.MIDNIGHT_LOCAL_INDEXER_WS ?? 'ws://127.0.0.1:8088/api/v4/graphql/ws',
      node: env.MIDNIGHT_LOCAL_NODE ?? 'http://127.0.0.1:9944',
      nodeWS: env.MIDNIGHT_LOCAL_NODE_WS ?? 'ws://127.0.0.1:9944',
      proofServer,
    };
  }
  if (network === 'preview') {
    return {
      walletNetworkId: NetworkId.NetworkId.Preview,
      networkId: 'preview',
      indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
      indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
      node: 'https://rpc.preview.midnight.network',
      nodeWS: 'wss://rpc.preview.midnight.network',
      proofServer,
    };
  }
  if (network === 'mainnet') {
    const t = env.BLOCKFROST_MIDNIGHT_MAINNET;
    if (!t) throw new Error('Set BLOCKFROST_MIDNIGHT_MAINNET (Blockfrost Midnight Mainnet project id)');
    const q = `?project_id=${encodeURIComponent(t)}`;
    return {
      walletNetworkId: NetworkId.NetworkId.MainNet,
      networkId: 'mainnet',
      indexer: `https://midnight-mainnet.blockfrost.io/api/v0${q}`,
      indexerWS: `wss://midnight-mainnet.blockfrost.io/api/v0/ws${q}`,
      node: `https://rpc.midnight-mainnet.blockfrost.io${q}`,
      nodeWS: `wss://rpc.midnight-mainnet.blockfrost.io${q}`,
      proofServer,
    };
  }
  if (network !== 'preprod') throw new Error(`MIDNIGHT_NETWORK must be "preprod", "preview", "mainnet" or "undeployed" (got "${network}")`);
  const t = env.BLOCKFROST_MIDNIGHT_PREPROD;
  if (!t) throw new Error('Set BLOCKFROST_MIDNIGHT_PREPROD (free Blockfrost Midnight Preprod project id), or MIDNIGHT_NETWORK=preview');
  const q = `?project_id=${encodeURIComponent(t)}`;
  return {
    walletNetworkId: NetworkId.NetworkId.PreProd,
    networkId: 'preprod',
    indexer: `https://midnight-preprod.blockfrost.io/api/v0${q}`,
    indexerWS: `wss://midnight-preprod.blockfrost.io/api/v0/ws${q}`,
    node: `https://rpc.midnight-preprod.blockfrost.io${q}`,
    nodeWS: `wss://rpc.midnight-preprod.blockfrost.io${q}`,
    proofServer,
  };
}
/** Kept for existing callers; follows MIDNIGHT_NETWORK like midnightEnv. */
export const preprodEnv = midnightEnv;

/** Public explorer links for the active network. */
export function explorerBase(networkId = midnightEnv().networkId) {
  if (networkId === 'undeployed') return null;
  // Mainnet explorer lives at www; test networks use the <network>.midnightexplorer.com host.
  if (networkId === 'mainnet') return 'https://www.midnightexplorer.com';
  return `https://${networkId}.midnightexplorer.com`;
}

export async function assertProofServer(url = preprodEnv().proofServer) {
  let v;
  try { const r = await fetch(url + '/version', { signal: AbortSignal.timeout(4000) }); v = (await r.text()).trim(); }
  catch (e) { throw new Error(`Proof server not reachable at ${url}. Start: docker run -p 6300:6300 midnightntwrk/proof-server:9.0.0 midnight-proof-server -v`); }
  if (!v.startsWith('9.')) throw new Error(`Proof server at ${url} is ${v}; ledger 9 needs proof server 9.0.0`);
  return v;
}

function seedFor(name, dir) {
  const f = path.join(dir, `.wallets.${midnightEnv().networkId}.json`);
  if (!fs.existsSync(f)) throw new Error(`Missing ${f} (wallet seeds; never commit this file)`);
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const s = raw[name] ?? raw.midnight?.[name];
  if (!s || typeof s !== 'string') throw new Error(`No wallet named ${name} in ${f}`);
  return s;
}

export function summarize(s) {
  const now = new Date();
  return {
    protocol: s.protocol?._tag,
    nightBalance: String(s.unshielded.balances[unshieldedToken().raw] ?? 0n),
    nightUtxos: s.unshielded.availableCoins.length,
    registeredUtxos: s.unshielded.availableCoins.filter((c) => c.meta?.registeredForDustGeneration === true).length,
    dustBalanceSpeck: String(s.dust.balance(now)),
  };
}

/**
 * Open the deployer wallet and sync.
 * On preprod/preview, if DUST is 0 and registerDust is true, register test NIGHT for DUST.
 * On mainnet this never registers NIGHT (cNIGHT on Cardano is the only DUST source) and
 * installs a fee cap on submitTransaction.
 * Returns { provider, wallet, env, status, stop }.
 */
export async function openWallet9({ walletDir, walletName = 'deployer', syncTimeoutMs = 3_600_000, registerDust, log = console.log } = {}) {
  const env = midnightEnv();
  if (env.networkId === 'mainnet') registerDust = false;
  else if (registerDust == null) registerDust = true;
  const seed = seedFor(walletName, walletDir ?? process.env.MN_WALLET_DIR ?? HERE);
  const dir = walletDir ?? process.env.MN_WALLET_DIR ?? HERE;
  const builder = FluentWalletBuilder.forEnvironment(env);
  // Larger sync batches: the SDK default (10 events/batch) made a from-genesis Preprod DUST sync take hours.
  const config = { ...builder.config, batchUpdates: { size: Number(process.env.MN_SYNC_BATCH ?? 500), timeout: 100, spacing: 0 } };
  const seeds = WalletSeeds.fromMasterSeed(seed);
  const keystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, builder.networkId);
  // Owner-only snapshot (Wallet SDK 2 format) so later runs resume instead of syncing Preprod from genesis.
  const snapFile = path.join(dir, `.wallet-state.${walletName}.${env.networkId === 'preprod' ? 'preprod-l9' : env.networkId}.json`);
  let snap = null;
  if (process.env.MN_NO_RESTORE !== '1' && fs.existsSync(snapFile)) { try { snap = JSON.parse(fs.readFileSync(snapFile, 'utf8')); log(new Date().toISOString(), 'restoring ledger 9 wallet snapshot saved', snap.savedAt); } catch { snap = null; } }
  const pick = (k, fresh, restore) => { if (snap?.[k]) { try { return restore(snap[k]); } catch (e) { log('restore failed for', k, '- starting fresh'); } } return fresh(); };
  const dustConfig = { ...config, costParameters: { ledgerParams: DEFAULT_DUST_OPTIONS.ledgerParams, additionalFeeOverhead: DEFAULT_DUST_OPTIONS.additionalFeeOverhead, feeBlocksMargin: DEFAULT_DUST_OPTIONS.feeBlocksMargin } };
  const unConfig = { ...config, txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries) };
  const sh = pick('shielded', () => ShieldedWallet(config).startWithSeed(seeds.shielded), (x) => ShieldedWallet(config).restore(x));
  const un = pick('unshielded', () => UnshieldedWallet(unConfig).startWithPublicKey(PublicKey.fromKeyStore(keystore)), (x) => UnshieldedWallet(unConfig).restore(x));
  const du = pick('dust', () => DustWallet(dustConfig).startWithSeed(seeds.dust), (x) => DustWallet(dustConfig).restore(x));
  const wallet = await WalletFacade.init({ configuration: config, shielded: () => sh, unshielded: () => un, dust: () => du });
  const provider = await MidnightWalletProvider.withWallet(tkLogger, env, wallet, seeds, keystore);
  await wallet.start(seeds);
  let saving = false;
  const saveSnap = async () => {
    if (saving) return; saving = true;
    try {
      const [a, b, c] = await Promise.all([wallet.shielded.serializeState(), wallet.unshielded.serializeState(), wallet.dust.serializeState()]);
      const tmp = snapFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), shielded: a, unshielded: b, dust: c }), { mode: 0o600 });
      fs.renameSync(tmp, snapFile);
      log(new Date().toISOString(), 'wallet snapshot saved');
    } catch (e) { log('snapshot failed:', redactErr(e).slice(0, 200)); } finally { saving = false; }
  };
  const snapTimer = setInterval(saveSnap, 5 * 60_000); snapTimer.unref();
  const t0 = Date.now(); let lastKey = "", lastMove = Date.now();
  const tick = setInterval(async () => {
    try { const s = await Rx.firstValueFrom(wallet.state()); const p = (x) => { const q = x?.progress; return q ? `${q.appliedIndex ?? q.appliedId ?? '?'}/${q.highestRelevantIndex ?? q.highestIndex ?? '?'}` : 'n/a'; };
      log(new Date().toISOString(), 'sync', JSON.stringify({ min: Math.round((Date.now() - t0) / 6000) / 10, protocol: s.protocol?._tag, synced: s.isSynced, sh: p(s.shielded), un: p(s.unshielded), du: p(s.dust) }));
      // Stall watchdog: the Wallet SDK can stop advancing after an indexer websocket error. Save and exit 75 so a
      // wrapper (or the operator) restarts from the snapshot instead of waiting forever.
      const key = p(s.shielded) + p(s.dust) + p(s.unshielded);
      if (!s.isSynced) {
        if (key !== lastKey) { lastKey = key; lastMove = Date.now(); }
        else if (Date.now() - lastMove > Number(process.env.MN_STALL_MS ?? 300_000)) { log(new Date().toISOString(), 'sync stalled; saving snapshot and exiting 75'); await saveSnap(); process.exit(75); }
      } } catch {}
  }, Number(process.env.MN_PROGRESS_MS ?? 60_000));
  tick.unref();
  let state;
  try {
    state = await syncWallet(wallet, 2_000, syncTimeoutMs);
  } finally { clearInterval(tick); }
  let status = summarize(state);
  log(new Date().toISOString(), 'synced', JSON.stringify(status));
  await saveSnap();
  if (env.networkId === 'mainnet' && BigInt(status.dustBalanceSpeck) === 0n) {
    throw new Error('Mainnet wallet DUST is 0 after sync. DUST comes from the Cardano cNIGHT registration; refusing to register or spend.');
  }
  if (env.networkId === 'mainnet') {
    installMainnetFeeGuard(wallet, { log });
  }
  if (registerDust && BigInt(status.dustBalanceSpeck) === 0n) {
    const unregistered = state.unshielded.availableCoins.filter((c) => c.utxo.type === unshieldedToken().raw && c.meta.registeredForDustGeneration === false);
    if (!unregistered.length) throw new Error('DUST is 0 and there are no unregistered NIGHT UTXOs; get test tNIGHT from the free faucet for this network');
    log(new Date().toISOString(), `registering ${unregistered.length} test NIGHT UTXO(s) for DUST...`);
    const recipe = await wallet.registerNightUtxosForDustGeneration(unregistered, keystore.getPublicKey(), (p) => keystore.signDataAsync(p));
    const txId = await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
    status.dustRegistrationTxId = String(txId);
    log(new Date().toISOString(), 'DUST registration submitted', String(txId));
    const s2 = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n), Rx.timeout({ first: Number(process.env.MN_DUST_WAIT_MS ?? 1_200_000) })));
    status = { ...summarize(s2), dustRegistrationTxId: String(txId) };
    log(new Date().toISOString(), 'DUST available', JSON.stringify(status));
    await saveSnap();
  }
  return { provider, wallet, env, status, saveSnap, stop: async () => { clearInterval(snapTimer); await saveSnap(); await wallet.stop(); } };
}

const SPECKS_PER_DUST = 10n ** 15n;
const DEFAULT_MAX_FEE_DUST = Number(process.env.MN_MAX_FEE_DUST ?? 10);

/** Refuse mainnet submits whose estimated fee (including balancing) exceeds the cap. */
export function installMainnetFeeGuard(wallet, { maxFeeDust = DEFAULT_MAX_FEE_DUST, log = console.log } = {}) {
  if (wallet.__corvuszkFeeGuard) return wallet;
  const maxSpeck = BigInt(Math.round(Number(maxFeeDust) * 1e15));
  const origSubmit = wallet.submitTransaction.bind(wallet);
  const origEst = wallet.estimateTransactionFee.bind(wallet);
  wallet.submitTransaction = async (tx, ...rest) => {
    let fee;
    try { fee = await origEst(tx); }
    catch (e) { throw new Error('Mainnet fee estimate failed; not submitting. ' + redactErr(e).slice(0, 400)); }
    const dust = Number(fee) / 1e15;
    log(new Date().toISOString(), `estimated fee ${dust.toFixed(4)} DUST (cap ${maxFeeDust})`);
    if (fee > maxSpeck) throw new Error(`Estimated fee ${dust.toFixed(4)} DUST exceeds cap ${maxFeeDust} DUST; not submitting`);
    return origSubmit(tx, ...rest);
  };
  wallet.__corvuszkFeeGuard = true;
  return wallet;
}

/** Midnight.js 5 provider set for one compiled contract folder. */
export function providersFor({ provider, env }, { zkConfigPath, storeName }) {
  return initializeMidnightProviders(provider, env, { zkConfigPath, privateStateStoreName: storeName });
}

/** Public receipt fields only. */
export function receipt(pub, extra = {}) {
  const txHash = String(pub?.txHash ?? '');
  const contractAddress = String(pub?.contractAddress ?? extra.contractAddress ?? '');
  return {
    ...extra,
    txId: String(pub?.txId ?? ''),
    txHash,
    blockHeight: pub?.blockHeight ?? null,
    fees: { paidFees: pub?.fees?.paidFees != null ? String(pub.fees.paidFees) : null, estimatedFees: pub?.fees?.estimatedFees != null ? String(pub.fees.estimatedFees) : null },
    contractAddress: contractAddress || null,
    txExplorer: txHash && explorerBase() ? `${explorerBase()}/transactions/${txHash}` : null,
    contractExplorer: contractAddress && explorerBase() ? `${explorerBase()}/contracts/${contractAddress}` : null,
  };
}
