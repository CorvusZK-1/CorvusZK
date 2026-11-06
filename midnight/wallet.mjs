// Wallet helpers for Midnight Preprod (adapted from midnightntwrk/example-counter, Apache-2.0).
// Never logs seeds or the Blockfrost project id.
import fs from 'node:fs'; import * as Rx from 'rxjs'; import { WebSocket } from 'ws';
import * as ledger from '@midnight-ntwrk/ledger-v8'; import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { WalletEntrySchema } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { preprodConfig } from '../dist/midnight-config.js';
globalThis.WebSocket = WebSocket;
setNetworkId('preprod');
export const cfg = preprodConfig();
export const redactErr = e => String(e?.stack || e).replace(/project_id=[^&\s"']+/g, 'project_id=***');
const seeds = JSON.parse(fs.readFileSync(new URL('./.wallets.preprod.json', import.meta.url)));
export async function buildWallet(name = 'deployer') {
  const hd = HDWallet.fromSeed(Buffer.from(seeds[name], 'hex'));
  const keys = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0).keys;
  hd.hdWallet.clear();
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());
  const conn = { indexerHttpUrl: cfg.indexerHttpUrl, indexerWsUrl: cfg.indexerWsUrl };
  const configuration = { networkId: getNetworkId(), indexerClientConnection: conn, provingServerUrl: new URL(cfg.proofServerUrl), relayURL: new URL(cfg.nodeWsUrl),
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema), costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
    // SDK option (Sync.d.ts BatchUpdatesConfig): bigger batches, no inter-batch sleep. Defaults are size 10, spacing 4ms.
    batchUpdates: { size: Number(process.env.MN_BATCH_SIZE ?? 500), timeout: 50, spacing: 0 } };
  const snapFile = new URL(`./.wallet-state.${name}.preprod.json`, import.meta.url);
  let snap = null; try { snap = JSON.parse(fs.readFileSync(snapFile)); console.log(new Date().toISOString(), 'restoring wallet state saved', snap.savedAt); } catch {}
  const pick = (k, fresh, restore) => { if (snap?.[k]) { try { return restore(snap[k]); } catch (e) { console.log('restore failed for', k, '- starting fresh'); } } return fresh(); };
  const wallet = await WalletFacade.init({ configuration,
    shielded: c => pick('shielded', () => ShieldedWallet(c).startWithSecretKeys(shieldedSecretKeys), x => ShieldedWallet(c).restore(x)),
    unshielded: c => pick('unshielded', () => UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)), x => UnshieldedWallet(c).restore(x)),
    dust: c => pick('dust', () => DustWallet(c).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust), x => DustWallet(c).restore(x)) });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  // Periodic owner-only snapshot so a restart resumes instead of re-syncing from zero.
  let saving = false;
  const saveSnap = async () => { if (saving) return; saving = true; try {
    const [sh, un, du] = await Promise.all([wallet.shielded.serializeState(), wallet.unshielded.serializeState(), wallet.dust.serializeState()]);
    const tmp = snapFile.pathname + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), shielded: sh, unshielded: un, dust: du }), { mode: 0o600 }); fs.renameSync(tmp, snapFile.pathname);
    console.log(new Date().toISOString(), 'wallet state saved'); } catch (e) { console.log('snapshot failed:', String(e?.message || e).slice(0, 200)); } finally { saving = false; } };
  const timer = setInterval(saveSnap, 5 * 60_000); timer.unref();
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore, saveSnap };
}
export const synced = w => Rx.firstValueFrom(w.state().pipe(Rx.filter(s => s.isSynced)));
export function summarize(s) {
  const now = new Date();
  return { address: undefined, nightBalance: String(s.unshielded.balances[unshieldedToken().raw] ?? 0n), nightUtxos: s.unshielded.availableCoins.length,
    registeredUtxos: s.unshielded.availableCoins.filter(c => c.meta?.registeredForDustGeneration === true).length,
    dustBalanceSpeck: String(s.dust.balance(now)), dustCoins: s.dust.availableCoins.length, dustPending: s.dust.pendingCoins.length };
}
export function logProgress(w, every = 30_000, saveSnap) {
  // Stall watchdog: the SDK does not recover after an indexer websocket drop (Wallet.Sync error).
  // If no sync progress for 10 min before first full sync, save state and exit 3 so the runner relaunches.
  let last = '', lastAt = Date.now(), everSynced = false;
  const wd = setInterval(async () => { if (!everSynced && Date.now() - lastAt > Number(process.env.MN_STALL_MS ?? 120_000)) { console.log(new Date().toISOString(), 'sync stalled - restarting');
    try { if (saveSnap) await saveSnap(); } catch {} process.exit(3); } }, 20_000); wd.unref();
  w.state().subscribe(s => { if (s.isSynced) everSynced = true; const g = x => { const q = x?.progress ?? x?.state?.progress; return String(q?.appliedIndex ?? q?.appliedId ?? ''); }; const k = [g(s.shielded), g(s.unshielded), g(s.dust)].join('|'); if (k !== last) { last = k; lastAt = Date.now(); } });
  return w.state().pipe(Rx.throttleTime(every)).subscribe(s => {
    const p = x => { try { const q = x?.progress ?? x?.state?.progress; return q ? `${q.appliedIndex ?? q.appliedId ?? '?'}/${q.highestRelevantIndex ?? q.highestIndex ?? '?'}` : 'n/a'; } catch { return 'n/a'; } };
    console.log(new Date().toISOString(), 'sync', JSON.stringify({ synced: s.isSynced, shielded: p(s.shielded), unshielded: p(s.unshielded), dust: p(s.dust) }));
  });
}
