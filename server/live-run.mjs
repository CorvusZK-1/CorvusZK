/**
 * One live CorvusZK eligibility run, reported step by step:
 *   XRPL testnet EscrowCreate -> Midnight deploy -> prove -> reveal -> indexer read -> XRPL EscrowFinish.
 *
 * Test networks only. The Midnight side uses the server's own throwaway test wallet (MIDNIGHT_NETWORK =
 * preview, or undeployed for a local devnet). The XRPL side uses fresh XRPL testnet faucet wallets per run.
 * The issuer is a labeled MOCK. Never emits seeds, the holder secret, or the preimage before reveal.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xrpl from 'xrpl';
import * as elig from '../midnight/eligibility.mjs';
import * as bridge from '../midnight/sdk-bridge.mjs';
import { makeProvidersFactory, assertProofServer } from '../midnight/providers.mjs';
import { openWallet9, midnightEnv, explorerBase, redactErr } from '../midnight/wallet9.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const XRPL_TESTNET_SERVERS = (process.env.XRPL_TESTNET_WSS ?? 'wss://testnet.xrpl-labs.com,wss://s.altnet.rippletest.net:51233').split(',');

/** Connect to the first XRPL testnet server that answers. */
async function connectXrpl() {
  let last;
  for (const url of XRPL_TESTNET_SERVERS) {
    const c = new xrpl.Client(url.trim(), { connectionTimeout: 10_000 });
    try { await c.connect(); return c; } catch (e) { last = e; }
  }
  throw new Error(`No XRPL testnet server reachable (${last?.message ?? 'unknown error'})`);
}
const XRPL_FAUCET = 'faucet.altnet.rippletest.net';
const xrplTx = (hash) => `https://testnet.xrpl.org/transactions/${hash}`;

export const STEPS = [
  { id: 'xrpl-lock', title: 'Lock test XRP in an XRPL escrow', net: 'xrpl' },
  { id: 'deploy', title: 'Deploy the eligibility contract on Midnight', net: 'midnight' },
  { id: 'prove', title: 'Prove eligibility privately (zero-knowledge proof)', net: 'midnight' },
  { id: 'reveal', title: 'Reveal the release key (only works after the proof)', net: 'midnight' },
  { id: 'read', title: 'Read the contract state back from the indexer', net: 'midnight' },
  { id: 'xrpl-release', title: 'Release the XRPL escrow', net: 'xrpl' },
];

/** Opens the server wallet once and keeps it synced between runs. */
export async function createLiveRunner({ walletDir = process.env.MN_WALLET_DIR, log = () => {} } = {}) {
  const env = midnightEnv();
  await assertProofServer(env.proofServer);
  const ctx = await openWallet9({ walletDir, syncTimeoutMs: Number(process.env.MN_SYNC_TIMEOUT_MS ?? 1_800_000), registerDust: true, log });
  // deployEligibility normally opens and stops a wallet per call; hand it the long-lived one instead.
  const keepOpen = { ...ctx.wallet, stop: async () => {} };
  const deps = {
    openSyncedWallet: async () => ({ ctx, wallet: keepOpen, state: null }),
    makeProvidersFactory,
    assertProofServer: async () => assertProofServer(env.proofServer),
  };
  const mExplorer = (kind, h) => (h && explorerBase() ? `${explorerBase()}/${kind}/${h}` : null);

  async function dustBalanceSpeck() {
    const { firstValueFrom } = await import('rxjs');
    const s = await firstValueFrom(ctx.wallet.state());
    return String(s.dust.balance(new Date()));
  }

  /** Run once. `emit(event)` gets {step, status, ...public fields}. Throws on failure. */
  async function run(emit = () => {}, signal) {
    const check = () => { if (signal?.aborted) throw signal.reason ?? new Error('aborted'); };
    const step = (id, status, extra = {}) => emit({ step: id, status, at: new Date().toISOString(), ...extra });
    const sampled = elig.samplePreimage('destination');
    const terms = elig.payerFacingTerms(sampled);
    const issuer = elig.createMockIssuer();
    const holderSecret = new Uint8Array(crypto.randomBytes(32));
    const asOf = BigInt(Math.floor(Date.now() / 1000));
    const expiry = asOf + 86_400n * 365n;
    const credential = elig.issueMockCredential(issuer, { holderSecret, credentialType: 'kyc-pass', expiry });
    let client;
    let contractAddress;
    const t0 = Date.now();
    try {
      step('xrpl-lock', 'running', { detail: 'Funding two throwaway XRPL testnet wallets from the public faucet' });
      client = await connectXrpl();
      const { wallet: payer } = await client.fundWallet(null, { faucetHost: XRPL_FAUCET });
      const { wallet: destination } = await client.fundWallet(null, { faucetHost: XRPL_FAUCET });
      check();
      const now = xrpl.isoTimeToRippleTime(new Date().toISOString());
      const created = await client.submitAndWait({
        TransactionType: 'EscrowCreate', Account: payer.address, Destination: destination.address,
        Amount: xrpl.xrpToDrops(process.env.XRPL_ESCROW_XRP ?? '20'), Condition: terms.condition, CancelAfter: now + 86_400,
      }, { wallet: payer });
      const cRes = created.result.meta?.TransactionResult;
      if (cRes !== 'tesSUCCESS') throw new Error(`EscrowCreate ${cRes}`);
      const offerSequence = created.result.tx_json?.Sequence ?? created.result.Sequence;
      const escrow = { owner: payer.address, offerSequence, destination: destination.address };
      step('xrpl-lock', 'done', { tx: { hash: created.result.hash, result: cRes, ledger: created.result.ledger_index, explorer: xrplTx(created.result.hash) },
        public: { payer: payer.address, destination: destination.address, amountXrp: process.env.XRPL_ESCROW_XRP ?? '20', condition: terms.condition } });
      check();

      step('deploy', 'running', { detail: 'Deploying one eligibility contract bound to this escrow' });
      const deployed = await bridge.deployEligibility({ issuer, credentialType: 'kyc-pass', asOf, preimageCommit: terms.preimageCommit, escrow, deps });
      contractAddress = deployed.contractAddress;
      step('deploy', 'done', { contractAddress, contractExplorer: mExplorer('contracts', contractAddress),
        tx: { hash: deployed.txHash, block: deployed.blockHeight, explorer: mExplorer('transactions', deployed.txHash), fees: deployed.fees } });
      check();

      step('prove', 'running', { detail: 'Proof server builds a zero-knowledge proof of the mock credential; only "proven" and a one-time nullifier go on chain' });
      const proved = await bridge.callEligibility({ circuit: 'prove', contractAddress, witness: { holderSecret, expiry, signature: credential.signature } });
      step('prove', 'done', { tx: { hash: proved.txHash, block: proved.blockHeight, explorer: mExplorer('transactions', proved.txHash), fees: proved.fees } });
      check();

      step('reveal', 'running', { detail: 'Publishing the release key; the contract refuses this unless the proof succeeded' });
      const revealed = await bridge.callEligibility({ circuit: 'reveal', contractAddress, witness: { releasePreimage: sampled.holder.preimage } });
      step('reveal', 'done', { tx: { hash: revealed.txHash, block: revealed.blockHeight, explorer: mExplorer('transactions', revealed.txHash), fees: revealed.fees } });
      check();

      step('read', 'running', { detail: 'Waiting for the indexer to show the revealed state' });
      const env2 = midnightEnv();
      const state = await bridge.readEligibilityState({ contractAddress, waitMs: 180_000, indexerHttpUrl: env2.indexer, indexerWsUrl: env2.indexerWS });
      if (!state.preimageRevealed || !state.rawLedger) throw new Error('Indexer did not show the revealed state in time');
      const pub = state.ledger;
      step('read', 'done', { ledger: { proven: pub.proven, preimageRevealed: pub.preimageRevealed, nullifier: pub.nullifier, credentialType: pub.credentialType,
        escrowOwner: pub.escrowOwner, offerSequence: pub.offerSequence, escrowDestination: pub.escrowDestination, preimageCommit: pub.preimageCommit } });
      check();

      step('xrpl-release', 'running', { detail: 'Destination submits EscrowFinish with the key read from Midnight' });
      const fin = elig.fulfillmentFromRevealedLedger(state.rawLedger, { ...escrow, condition: terms.condition });
      const finished = await client.submitAndWait({
        TransactionType: 'EscrowFinish', Account: destination.address, Owner: payer.address, OfferSequence: offerSequence,
        Condition: terms.condition, Fulfillment: fin.fulfillment,
      }, { wallet: destination });
      const fRes = finished.result.meta?.TransactionResult;
      if (fRes !== 'tesSUCCESS') throw new Error(`EscrowFinish ${fRes}`);
      step('xrpl-release', 'done', { tx: { hash: finished.result.hash, result: fRes, ledger: finished.result.ledger_index, explorer: xrplTx(finished.result.hash) } });
      return { ok: true, network: env.networkId, contractAddress, seconds: Math.round((Date.now() - t0) / 1000) };
    } finally {
      if (contractAddress) { try { await bridge.closeEligibilitySession(contractAddress); } catch { /* ignore */ } }
      try { await client?.disconnect(); } catch { /* ignore */ }
    }
  }

  return { network: env.networkId, run, dustBalanceSpeck, close: () => ctx.stop(), redactErr };
}

// CLI: one run, printed as JSON lines. MIDNIGHT_NETWORK=undeployed|preview MN_WALLET_DIR=... node server/live-run.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runner = await createLiveRunner({ log: (...a) => console.error(...a) });
  try {
    const r = await runner.run((e) => console.log(JSON.stringify(e)));
    console.log(JSON.stringify({ result: r }));
  } catch (e) { console.error(redactErr(e)); process.exitCode = 1; }
  finally { await runner.close(); process.exit(process.exitCode ?? 0); }
}
