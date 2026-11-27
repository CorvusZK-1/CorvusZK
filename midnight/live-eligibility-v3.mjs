/**
 * Live strict-release run for eligibility_v3 (CZ-005 issuer, CZ-007 proof window). Test networks only.
 * Not run in CI.
 *
 * XRPL testnet EscrowCreate (payer-side preimage) -> IntentV2 registered in a policy registry
 * -> Midnight Preprod deploy eligibility_v3 bound to the intent hash -> prove -> reveal
 * -> releaseStrict (strict indexer read, artifact check, escrow check) -> XRPL EscrowFinish.
 *
 * Prints transaction hashes and explorer links only. Never prints seeds, the Blockfrost project id,
 * the issuer key, the holder secret, or the preimage.
 * Run: /workspace/dapps/with-preprod-key.sh node midnight/live-eligibility-v3.mjs  (after npm run build)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as xrpl from 'xrpl';
import * as elig from './eligibility.mjs';
import { midnightLinks, xrplLinks } from './live-eligibility.mjs';
import { circuitArtifactId } from './sdk-bridge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RIPPLE_EPOCH = 946684800;
const redact = (e) => String(e?.stack || e).replace(/project_id=[^&\s"']+/g, 'project_id=***');
const log = (...a) => console.error(new Date().toISOString(), ...a);

export async function main() {
  const token = process.env.BLOCKFROST_MIDNIGHT_PREPROD;
  if (!token) throw new Error('Set BLOCKFROST_MIDNIGHT_PREPROD (use /workspace/dapps/with-preprod-key.sh)');
  const walletDir = process.env.MN_WALLET_DIR ?? here;
  if (!fs.existsSync(path.join(walletDir, '.wallets.preprod.json'))) throw new Error('Missing .wallets.preprod.json in MN_WALLET_DIR or midnight/ (Preprod test deployer wallet)');
  const proofServer = process.env.MIDNIGHT_PROOF_SERVER ?? 'http://localhost:6300';
  const dist = await import(pathToFileURL(path.join(here, '..', 'dist', 'index.js')).href);

  const issuer = elig.createIssuerV3();
  const holderSecret = new Uint8Array(crypto.randomBytes(32));
  const nowSec = () => Math.floor(Date.now() / 1000);
  const asOf = BigInt(nowSec());
  const expiry = asOf + 86_400n * 30n;
  const credential = await elig.issueCredentialV3(issuer, { holderSecret, credentialType: 'kyc-pass', expiry });
  if (!(await elig.verifyCredentialV3(credential, issuer.publicKey))) throw new Error('v3 credential did not verify off-chain');
  const sampled = elig.samplePreimage('payer');
  const terms = elig.payerFacingTerms(sampled);

  const client = new xrpl.Client(process.env.XRPL_TESTNET_WSS ?? dist.XRPL_TESTNET_WSS);
  await client.connect();
  const backend = new dist.MidnightBackend({ blockfrostProjectId: token, mode: 'preprod', proofServer, syncTimeoutMs: Number(process.env.MN_SYNC_TIMEOUT_MS ?? 600_000) });
  const registryFile = path.join(here, 'logs', 'v3-policy-registry.json');
  const registry = new dist.FilePolicyRegistry(registryFile);
  let contractAddress;
  try {
    log('funding XRPL testnet payer and destination from the public faucet');
    const { wallet: payer } = await client.fundWallet(null, { faucetHost: 'faucet.altnet.rippletest.net' });
    const { wallet: destination } = await client.fundWallet(null, { faucetHost: 'faucet.altnet.rippletest.net' });
    const created = await dist.createEscrow(client, payer, { destination: destination.address, amountXrp: process.env.XRPL_ESCROW_XRP ?? '20', condition: terms.condition, cancelAfterSec: Number(process.env.XRPL_CANCEL_AFTER_SEC ?? 7200) });
    if (created.result !== 'tesSUCCESS') throw new Error('EscrowCreate ' + created.result);
    log('escrow created', created.hash);
    const node = (await client.request({ command: 'ledger_entry', escrow: { owner: payer.address, seq: created.offerSequence }, ledger_index: 'validated' })).result.node;
    const networkId = Number((await client.request({ command: 'server_info' })).result.info.network_id ?? 0);

    const intent = {
      protocolVersion: 2, domain: 'corvuszk:intent:v2', environment: 'testnet', xrplNetworkId: networkId,
      owner: payer.address, offerSequence: created.offerSequence, destination: destination.address, destinationTag: null,
      asset: 'XRP', amountDrops: node.Amount, condition: terms.condition, finishAfter: null, cancelAfter: node.CancelAfter,
      midnightNetwork: 'preprod', circuitArtifactId: circuitArtifactId('eligibility_v3'),
      policyId: 'corvuszk-preprod-v3-run', policyVersion: 1,
      issuerX: issuer.publicKey.x.toString(16), issuerY: issuer.publicKey.y.toString(16),
      credentialType: 'kyc-pass', asOf: asOf.toString(),
      intentId: 'intent-' + crypto.randomUUID(), issuedAt: nowSec(), expiresAt: nowSec() + 6 * 3600,
    };
    const intentHash = dist.intentHashV2(intent);
    registry.registerIntent(intent.intentId, intentHash);
    const escrow = { owner: payer.address, offerSequence: created.offerSequence, destination: destination.address };

    log('deploying eligibility_v3 on Midnight Preprod');
    const deployed = await backend.deployEligibility({ contractVersion: 3, intentHash: Buffer.from(intentHash, 'hex'), issuer, credentialType: 'kyc-pass', asOf, preimageCommit: terms.preimageCommit, escrow });
    contractAddress = deployed.contractAddress;
    registry.bindContract(intent.intentId, contractAddress);
    log('deployed', contractAddress);
    const proved = await backend.callEligibility({ circuit: 'prove', contractAddress, contractVersion: 3, witness: { holderSecret, expiry, signature: credential.signature } });
    log('prove', proved.txHash);
    const revealed = await backend.callEligibility({ circuit: 'reveal', contractAddress, contractVersion: 3, witness: { releasePreimage: sampled.holder.preimage } });
    log('reveal', revealed.txHash);

    // Strict release by the trusted policy party. Retry while the indexer catches up.
    let rel;
    const deadline = Date.now() + Number(process.env.ELIGIBILITY_INDEXER_WAIT_MS ?? 300_000);
    for (;;) {
      rel = await dist.releaseStrict({ client, submitter: destination, backend, registry, intent, contractAddress, trustMode: 'trusted-policy-party', contractTemplate: 'eligibility_v3' });
      log('releaseStrict', rel.status, rel.reason);
      if (!['pending', 'unavailable'].includes(rel.status) || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 10_000));
    }
    if (rel.status !== 'settled') throw new Error(`releaseStrict ${rel.status}: ${rel.reason}`);
    const again = await dist.releaseStrict({ client, submitter: destination, backend, registry, intent, contractAddress, trustMode: 'trusted-policy-party', contractTemplate: 'eligibility_v3' });
    const tx = await client.request({ command: 'tx', transaction: rel.txHash });
    return {
      template: 'eligibility_v3', issuerScheme: elig.V3_SCHEME, trustMode: 'trusted-policy-party', preimageHolder: 'payer',
      intentId: intent.intentId, intentHash,
      xrplCreate: xrplLinks(created.hash, created.feeDrops),
      midnightDeploy: midnightLinks(deployed), midnightProve: midnightLinks(proved), midnightReveal: midnightLinks(revealed),
      strictRelease: { status: rel.status, retry: again.status },
      xrplFinish: { ...xrplLinks(rel.txHash, tx.result?.Fee ?? tx.result?.tx_json?.Fee), result: tx.result?.meta?.TransactionResult },
    };
  } finally {
    if (contractAddress) { try { await backend.closeEligibilitySession(contractAddress); } catch { /* ignore */ } }
    try { await client.disconnect(); } catch { /* ignore */ }
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); }).catch((e) => { console.error(redact(e)); process.exit(1); });
}
