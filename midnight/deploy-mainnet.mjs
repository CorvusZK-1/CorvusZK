// CorvusZK — Midnight MAINNET deploy of the four public Compact contracts.
// Usage (Cory approved this run):
//   MIDNIGHT_NETWORK=mainnet MN_WALLET_DIR=/workspace/dapps MN_MAINNET_CONFIRM=CORY_APPROVED \
//     BLOCKFROST_MIDNIGHT_MAINNET="$(tr -d '[:space:]' < /workspace/dapps/.blockfrost-mainnet-id)" \
//     node deploy-mainnet.mjs
// Never logs seeds, recovery phrases, or the Blockfrost project id.
// Never registers NIGHT, never touches any wallet other than the dedicated mainnet deployer.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { openWallet9, providersFor, assertProofServer, receipt, redactErr, explorerBase } from './wallet9.mjs';
import * as elig from './eligibility.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const SPECKS_PER_DUST = 10n ** 15n;
const NEEDED_DUST = Number(process.env.DUST_NEEDED ?? '110');
const MAX_TOTAL_DUST = Number(process.env.MN_MAX_TOTAL_DUST ?? '40');
const ID_FILE = '/workspace/dapps/.blockfrost-mainnet-id';
const OUT = path.join(here, 'deployments.mainnet.json');
const SEC = '/workspace/dapps/.contract-secrets.mainnet.json';

function loadMainnetProjectId() {
  if (process.env.BLOCKFROST_MIDNIGHT_MAINNET) return process.env.BLOCKFROST_MIDNIGHT_MAINNET;
  if (!fs.existsSync(ID_FILE)) throw new Error('Missing Blockfrost mainnet id file');
  const t = fs.readFileSync(ID_FILE, 'utf8').trim();
  if (!t) throw new Error('Blockfrost mainnet id file is empty');
  return t;
}

function confirmOrDie() {
  const ok = process.env.MN_MAINNET_CONFIRM === 'CORY_APPROVED' || process.argv.includes('--yes');
  if (!ok) {
    throw new Error('Refusing mainnet deploy without MN_MAINNET_CONFIRM=CORY_APPROVED (Cory already approved this run; the flag is the non-interactive confirm).');
  }
}

function dustFromSpecks(specks) {
  return Number(BigInt(specks)) / 1e15;
}

const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const save = () => fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
const sec = fs.existsSync(SEC) ? JSON.parse(fs.readFileSync(SEC, 'utf8')) : {};
const saveSec = () => fs.writeFileSync(SEC, JSON.stringify(sec), { mode: 0o600 });
const log = (...a) => console.log(new Date().toISOString(), ...a);
const errChain = (e) => {
  const parts = [];
  for (let x = e, i = 0; x && i < 8; x = x.cause, i++) parts.push(`${x?._tag ?? x?.name ?? ''}: ${x?.message ?? String(x)}`);
  return redactErr(parts.join(' <- '));
};

let w;
delete out.fatal;

try {
  confirmOrDie();
  process.env.MIDNIGHT_NETWORK = 'mainnet';
  process.env.BLOCKFROST_MIDNIGHT_MAINNET = loadMainnetProjectId();
  process.env.MN_WALLET_DIR = process.env.MN_WALLET_DIR ?? '/workspace/dapps';

  out.ledger = {
    network: 'mainnet',
    ledger: 9,
    walletSdk: '2.0.0',
    midnightJs: '5.0.0',
    compact: '0.36.0',
    compactRuntime: '0.21.0',
    proofServer: await assertProofServer(),
    explorer: explorerBase('mainnet'),
    note: 'Unaudited. Not for real value. Dedicated CorvusZK mainnet wallet only.',
  };

  w = await openWallet9({
    walletDir: process.env.MN_WALLET_DIR,
    syncTimeoutMs: Number(process.env.MN_SYNC_TIMEOUT_MS ?? 3_600_000),
    registerDust: false,
    log,
  });

  const startDust = dustFromSpecks(w.status.dustBalanceSpeck);
  out.deployerStatus = { ...w.status, dustBalanceDust: startDust, at: new Date().toISOString() };
  save();
  log('status', JSON.stringify({ ...out.deployerStatus, /* public only already */ }));
  log(`wallet DUST at sync: ${startDust.toFixed(4)} (need ${NEEDED_DUST} to start)`);
  if (startDust < NEEDED_DUST) {
    throw new Error(`Wallet DUST ${startDust.toFixed(4)} is under the ${NEEDED_DUST} DUST start threshold; not deploying.`);
  }

  const B32 = new rt.CompactTypeBytes(32), V = new rt.CompactTypeVector(2, B32);
  sec.l9 ??= {};
  sec.l9.conditionSecret ??= crypto.randomBytes(32).toString('hex');
  sec.l9.ageSalt ??= crypto.randomBytes(32).toString('hex');
  sec.l9.balSalt ??= crypto.randomBytes(32).toString('hex');
  saveSec();
  const cs = Buffer.from(sec.l9.conditionSecret, 'hex');
  const as = Buffer.from(sec.l9.ageSalt, 'hex');
  const bs = Buffer.from(sec.l9.balSalt, 'hex');
  const enc = (n) => { const b = Buffer.alloc(32); b.writeUInt32LE(n, 0); return new Uint8Array(b); };

  // Placeholder XRPL binding for a demonstration eligibility instance. No real escrow is created.
  if (!sec.l9.eligibility) {
    const issuer = elig.createMockIssuer();
    const sampled = elig.samplePreimage('destination');
    const { Wallet: XrplWallet } = await import('xrpl');
    const placeholderOwner = XrplWallet.generate();
    const placeholderDest = XrplWallet.generate();
    sec.l9.eligibility = {
      note: 'Demonstration instance only. Mock issuer. Placeholder XRPL accounts — no real escrow, keys discarded.',
      credentialType: 'kyc-pass',
      asOf: Number(BigInt(Math.floor(Date.now() / 1000))),
      escrow: {
        owner: placeholderOwner.address,
        offerSequence: 1,
        destination: placeholderDest.address,
      },
      preimageCommit: Buffer.from(sampled.publicTerms.preimageCommit).toString('hex'),
      issuerPub: { x: issuer.publicKey.x.toString(), y: issuer.publicKey.y.toString() },
    };
    saveSec();
  }
  const eligSec = sec.l9.eligibility;

  const specs = {
    condition: {
      w: { attesterSecret: (c) => [c.privateState, new Uint8Array(cs)], deliveryOk: (c) => [c.privateState, true] },
      args: [rt.persistentHash(B32, new Uint8Array(cs)), new Uint8Array(32)],
      call: 'attest',
    },
    age_over: {
      w: { birthYear: (c) => [c.privateState, 1990n], salt: (c) => [c.privateState, new Uint8Array(as)] },
      args: [18n, 2026n, rt.persistentHash(V, [new Uint8Array(as), enc(1990)])],
      call: 'prove',
    },
    balance_above: {
      w: { balance: (c) => [c.privateState, 5000n], salt: (c) => [c.privateState, new Uint8Array(bs)] },
      args: [1000n, rt.persistentHash(V, [new Uint8Array(bs), enc(5000)])],
      call: 'prove',
    },
    eligibility: {
      w: {},
      args: elig.eligibilityDeployArgs({
        issuer: { publicKey: { x: BigInt(eligSec.issuerPub.x), y: BigInt(eligSec.issuerPub.y) } },
        credentialType: eligSec.credentialType,
        asOf: eligSec.asOf,
        preimageCommit: Buffer.from(eligSec.preimageCommit, 'hex'),
        escrow: eligSec.escrow,
      }),
      call: null, // deploy only; prove/reveal would need the holder witness and is not required for the address
    },
  };

  out.deployments ??= {};
  const spent = () => {
    let total = 0;
    for (const d of Object.values(out.deployments)) {
      for (const part of [d, d.call]) {
        const paid = part?.fees?.paidFees;
        if (paid != null) total += Number(paid) / 1e15;
      }
    }
    return total;
  };

  for (const [name, sp] of Object.entries(specs)) {
    if (out.deployments[name]?.contractAddress && (sp.call == null || out.deployments[name]?.call?.txHash) && !process.argv.includes('--redeploy')) {
      log('already deployed', name, out.deployments[name].contractAddress);
      continue;
    }
    if (spent() >= MAX_TOTAL_DUST) throw new Error(`Spent ${spent().toFixed(4)} DUST already, at or over the ${MAX_TOTAL_DUST} total cap; stopping.`);
    const existing = !process.argv.includes('--redeploy') && out.deployments[name]?.contractAddress;
    try {
      const m = await import(`./managed/${name}/contract/index.js`);
      const cc = CompiledContract.make(name, m.Contract).pipe(
        CompiledContract.withWitnesses(sp.w),
        CompiledContract.withCompiledFileAssets(path.join(here, 'managed', name)),
      );
      const prov = providersFor(w, { zkConfigPath: path.join(here, 'managed', name), storeName: 'corvuszk-mainnet-' + name });
      let dc, addr;
      if (existing) {
        addr = existing;
        log('reusing mainnet deployment', name, addr);
        dc = await findDeployedContract(prov, { compiledContract: cc, contractAddress: addr, privateStateId: name, initialPrivateState: {} });
      } else {
        log('deploying', name, '(ZK proof from the local proof server, mainnet)');
        dc = await deployContract(prov, { compiledContract: cc, privateStateId: name, initialPrivateState: {}, args: sp.args });
        const p = dc.deployTxData.public;
        addr = p.contractAddress;
        out.deployments[name] = { ...receipt(p, { circuit: 'deploy' }), at: new Date().toISOString() };
        save();
        log('deployed', name, addr, 'paid', out.deployments[name].fees?.paidFees);
      }
      if (sp.call && !(out.deployments[name]?.call?.txHash) ) {
        try {
          const r = await dc.callTx[sp.call]();
          delete out.deployments[name].callError;
          out.deployments[name].call = { ...receipt(r.public, { circuit: sp.call, contractAddress: addr }), at: new Date().toISOString() };
          save();
          log('called', name, sp.call, r.public.txHash);
        } catch (e) {
          out.deployments[name].callError = { error: errChain(e).slice(0, 2000), at: new Date().toISOString() };
          save();
          log('CALL FAILED', name, errChain(e).slice(0, 1500));
        }
      }
    } catch (e) {
      out.deployments[name] = { ...(out.deployments[name] ?? {}), deployError: errChain(e).slice(0, 2000), at: new Date().toISOString() };
      save();
      log('FAILED', name, errChain(e).slice(0, 1500));
      throw e;
    }
  }

  const endState = await (await import('rxjs')).firstValueFrom(w.wallet.state());
  const endDust = dustFromSpecks(endState.dust.balance(new Date()));
  out.fees = {
    dustBefore: startDust,
    dustAfter: endDust,
    dustSpentApprox: startDust - endDust,
    paidFromReceipts: spent(),
    at: new Date().toISOString(),
  };
  save();
  log('done', JSON.stringify(out.fees));
  await w.stop();
  process.exit(0);
} catch (e) {
  out.fatal = redactErr(e).slice(0, 1500);
  save();
  console.error(redactErr(e).slice(0, 2000));
  try { await w?.stop(); } catch {}
  process.exit(1);
}
