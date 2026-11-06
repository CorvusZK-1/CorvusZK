/**
 * Live eligibility flow. Not run in CI.
 *
 * XRPL testnet EscrowCreate -> Midnight Preprod deploy -> prove -> reveal
 * -> read the preimage from indexer state -> XRPL EscrowFinish.
 *
 * Default preimage mode is `destination`: the destination samples the preimage.
 * The payer is given only the condition and the commitment.
 * Set PREIMAGE_MODE=payer to use the payer-sampled mode instead.
 *
 * Prints transaction hashes, explorer links, and fees copied from receipts.
 * Does not print seeds, the Blockfrost project id, the preimage, or the holder secret.
 *
 * Prerequisites: docs/live-eligibility.md
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as xrpl from 'xrpl';
import * as elig from './eligibility.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function redact(err) {
  return String(err?.stack || err).replace(/project_id=[^&\s"']+/g, 'project_id=***');
}

export function midnightLinks(tx) {
  const hash = tx?.txHash ? String(tx.txHash) : '';
  const address = tx?.contractAddress ? String(tx.contractAddress) : '';
  return {
    circuit: tx?.circuit ?? null,
    txId: tx?.txId ?? null,
    txHash: hash || null,
    blockHeight: tx?.blockHeight ?? null,
    fees: tx?.fees ?? { paidFees: null, estimatedFees: null },
    contractAddress: address || null,
    txExplorer: hash ? `https://preprod.midnightexplorer.com/transactions/${hash}` : null,
    contractExplorer: address ? `https://preprod.midnightexplorer.com/contracts/${address}` : null,
  };
}

export function xrplLinks(hash, feeDrops) {
  return {
    hash: hash ?? null,
    feeDrops: feeDrops ?? null,
    feeXrp: feeDrops != null ? xrpl.dropsToXrp(String(feeDrops)) : null,
    explorer: hash ? `https://testnet.xrpl.org/transactions/${hash}` : null,
  };
}

async function assertProofServer(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    throw new Error(
      `Proof server not reachable at ${url}. Start it with:\n` +
        '  docker run --rm -p 6300:6300 midnightntwrk/proof-server:8.1.3 midnight-proof-server -v\n' +
        `(${redact(err).split('\n')[0]})`
    );
  }
}

async function createEscrow(client, payer, destination, terms) {
  if (!terms?.condition || terms.preimage || terms.fulfillment || terms.holder) {
    throw new Error('EscrowCreate was given more than the public condition and commitment');
  }
  const now = xrpl.isoTimeToRippleTime(new Date().toISOString());
  const submitted = await client.submitAndWait(
    {
      TransactionType: 'EscrowCreate',
      Account: payer.address,
      Destination: destination.address,
      Amount: xrpl.xrpToDrops(process.env.XRPL_ESCROW_XRP ?? '20'),
      Condition: terms.condition,
      CancelAfter: now + Number(process.env.XRPL_CANCEL_AFTER_SEC ?? 86400),
    },
    { wallet: payer }
  );
  const meta = submitted.result.meta;
  if (meta?.TransactionResult !== 'tesSUCCESS') {
    throw new Error(`EscrowCreate ${meta?.TransactionResult ?? 'failed'}`);
  }
  const offerSequence = submitted.result.tx_json?.Sequence ?? submitted.result.Sequence;
  if (offerSequence == null) throw new Error('EscrowCreate receipt had no Sequence');
  return { submitted, offerSequence };
}

export async function main() {
  const token = process.env.BLOCKFROST_MIDNIGHT_PREPROD;
  if (!token) {
    throw new Error('Set BLOCKFROST_MIDNIGHT_PREPROD to a Blockfrost Midnight Preprod project id.');
  }
  const walletFile = path.join(here, '.wallets.preprod.json');
  if (!fs.existsSync(walletFile)) {
    throw new Error(
      'Missing midnight/.wallets.preprod.json. That gitignored file is the deployer wallet used by midnight/deploy.mjs. It needs Preprod NIGHT registered for DUST.'
    );
  }
  const proofServer = process.env.MIDNIGHT_PROOF_SERVER ?? 'http://localhost:6300';
  await assertProofServer(proofServer);
  const role = process.env.PREIMAGE_MODE === 'payer' ? 'payer' : 'destination';
  const sampled = elig.samplePreimage(role);
  const terms = elig.payerFacingTerms(sampled);
  const issuer = elig.createMockIssuer();
  const holderSecret = new Uint8Array(crypto.randomBytes(32));
  const asOf = BigInt(Math.floor(Date.now() / 1000));
  const expiry = asOf + 86_400n * 365n;
  const credential = elig.issueMockCredential(issuer, {
    holderSecret,
    credentialType: 'kyc-pass',
    expiry,
  });

  const dist = await import(pathToFileURL(path.join(here, '..', 'dist', 'index.js')).href);
  const client = new xrpl.Client(process.env.XRPL_TESTNET_WSS ?? dist.XRPL_TESTNET_WSS);
  await client.connect();
  const backend = new dist.MidnightBackend({
    blockfrostProjectId: token,
    mode: 'preprod',
    proofServer,
    syncTimeoutMs: Number(process.env.MN_SYNC_TIMEOUT_MS ?? 90_000),
  });
  let contractAddress;
  try {
    const { wallet: payer } = await client.fundWallet(null, { faucetHost: 'faucet.altnet.rippletest.net' });
    const { wallet: destination } = await client.fundWallet(null, {
      faucetHost: 'faucet.altnet.rippletest.net',
    });
    const created = await createEscrow(client, payer, destination, terms);
    const escrow = {
      owner: payer.address,
      offerSequence: created.offerSequence,
      destination: destination.address,
    };
    const deployed = await backend.deployEligibility({
      issuer,
      credentialType: 'kyc-pass',
      asOf,
      preimageCommit: terms.preimageCommit,
      escrow,
    });
    contractAddress = deployed.contractAddress;
    const proved = await backend.callEligibility({
      circuit: 'prove',
      contractAddress,
      witness: { holderSecret, expiry, signature: credential.signature },
    });
    const revealedTx = await backend.callEligibility({
      circuit: 'reveal',
      contractAddress,
      witness: { releasePreimage: sampled.holder.preimage },
    });
    const state = await backend.readEligibilityState({
      contractAddress,
      waitMs: Number(process.env.ELIGIBILITY_INDEXER_WAIT_MS ?? 180_000),
    });
    if (!state.preimageRevealed || !state.revealedPreimage || !state.rawLedger) {
      throw new Error(
        'Indexer did not show preimageRevealed before ELIGIBILITY_INDEXER_WAIT_MS. The reveal tx may still be unfinalized.'
      );
    }
    const fin = elig.fulfillmentFromRevealedLedger(state.rawLedger, {
      ...escrow,
      condition: terms.condition,
    });
    const finished = await client.submitAndWait(
      {
        TransactionType: 'EscrowFinish',
        Account: destination.address,
        Owner: payer.address,
        OfferSequence: created.offerSequence,
        Condition: terms.condition,
        Fulfillment: fin.fulfillment,
      },
      { wallet: destination }
    );
    const finishMeta = finished.result.meta?.TransactionResult;
    if (finishMeta !== 'tesSUCCESS') throw new Error(`EscrowFinish ${finishMeta}`);
    const createFee = dist.feeDropsFromXrplResult(created.submitted);
    const finishFee = dist.feeDropsFromXrplResult(finished);
    return {
      preimageMode: role,
      trust: sampled.trust,
      mockIssuer: elig.MOCK_ISSUER_LABEL,
      xrplCreate: xrplLinks(created.submitted.result.hash, createFee),
      midnightDeploy: midnightLinks(deployed),
      midnightProve: midnightLinks(proved),
      midnightReveal: midnightLinks(revealedTx),
      indexer: {
        found: state.found,
        proven: state.proven,
        preimageRevealed: state.preimageRevealed,
        revealedPreimageSha256: crypto.createHash('sha256').update(state.revealedPreimage).digest('hex'),
      },
      xrplFinish: {
        ...xrplLinks(finished.result.hash, finishFee),
        result: finishMeta,
      },
    };
  } finally {
    if (contractAddress) {
      try {
        await backend.closeEligibilitySession(contractAddress);
      } catch {
        /* ignore */
      }
    }
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((err) => {
      console.error(redact(err));
      process.exit(1);
    });
}
