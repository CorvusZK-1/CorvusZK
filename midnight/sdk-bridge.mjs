/**
 * CorvusZK Midnight SDK bridge.
 * Runs the same compiled Compact circuits as simulate.mjs (local, no chain, no wallet sync).
 * Optional Preprod indexer verify against deployments.preprod.json addresses.
 * Never logs seeds, Blockfrost project ids, or wallet secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);

function loadRuntime() {
  return import(pathToFileURL(require.resolve('@midnight-ntwrk/compact-runtime')).href);
}

function toBytes32(input) {
  if (input instanceof Uint8Array) {
    if (input.length === 32) return new Uint8Array(input);
    return new Uint8Array(crypto.createHash('sha256').update(input).digest());
  }
  if (typeof input === 'string') {
    if (/^[0-9a-fA-F]{64}$/.test(input)) return new Uint8Array(Buffer.from(input, 'hex'));
    return new Uint8Array(crypto.createHash('sha256').update(input, 'utf8').digest());
  }
  throw new Error('expected string or Uint8Array for bytes32 material');
}

function encUint32LE(n) {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(Number(n) >>> 0, 0);
  return new Uint8Array(b);
}

async function loadContract(template, managedRoot = path.join(here, 'managed')) {
  const modPath = path.join(managedRoot, template, 'contract', 'index.js');
  if (!fs.existsSync(modPath)) {
    throw new Error(`Compact contract not found at ${modPath} (run compact compile / keep midnight/managed)`);
  }
  return import(pathToFileURL(modPath).href);
}

/**
 * Execute a local Compact circuit for one of the three templates.
 * @param {object} o
 * @param {'condition'|'age_over'|'balance_above'} o.template
 * @param {object} o.publicInputs
 * @param {object} o.witness
 * @param {string} [o.managedRoot]
 * @returns {Promise<{template:string, circuit:string, commitmentHex:string, ledger:object, transcriptHex:string}>}
 */
export async function proveLocal(o) {
  const rt = await loadRuntime();
  const managedRoot = o.managedRoot ?? path.join(here, 'managed');
  const m = await loadContract(o.template, managedRoot);
  const ctor = () => rt.createConstructorContext({}, '0'.repeat(64));
  const call = (C, st, name) => {
    const ctx = rt.createCircuitContext(rt.dummyContractAddress(), '0'.repeat(64), st.currentContractState, {});
    return C.circuits[name](ctx);
  };
  const B32 = new rt.CompactTypeBytes(32);
  const V = new rt.CompactTypeVector(2, B32);

  if (o.template === 'condition') {
    const secret = toBytes32(o.witness.secret);
    const deliveryOk = o.witness.deliveryOk !== false;
    const commit = rt.persistentHash(B32, secret);
    const escrowId = o.publicInputs?.escrowId
      ? toBytes32(o.publicInputs.escrowId)
      : new Uint8Array(32);
    const C = new m.Contract({
      attesterSecret: (c) => [c.privateState, secret],
      deliveryOk: (c) => [c.privateState, deliveryOk],
    });
    const st = C.initialState(ctor(), commit, escrowId);
    const r = call(C, st, 'attest');
    const led = m.ledger(r.context.currentQueryContext.state);
    if (!led.released) throw new Error('condition circuit did not set released');
    const commitmentHex = Buffer.from(commit).toString('hex');
    const transcriptHex = crypto
      .createHash('sha256')
      .update('condition|')
      .update(commit)
      .update(escrowId)
      .update(led.released ? '1' : '0')
      .digest('hex');
    return {
      template: 'condition',
      circuit: 'attest',
      commitmentHex,
      ledger: { released: led.released, escrowId: Buffer.from(led.escrowId).toString('hex') },
      transcriptHex,
    };
  }

  if (o.template === 'age_over') {
    const birthYear = Number(o.witness.birthYear);
    const salt = toBytes32(o.witness.salt);
    const minAge = Number(o.publicInputs.minAge);
    const asOfYear = Number(o.publicInputs.asOfYear);
    const commit = rt.persistentHash(V, [salt, encUint32LE(birthYear)]);
    const C = new m.Contract({
      birthYear: (c) => [c.privateState, BigInt(birthYear)],
      salt: (c) => [c.privateState, salt],
    });
    const st = C.initialState(ctor(), BigInt(minAge), BigInt(asOfYear), commit);
    const r = call(C, st, 'prove');
    const led = m.ledger(r.context.currentQueryContext.state);
    if (!led.proven) throw new Error('age_over circuit did not set proven');
    const commitmentHex = Buffer.from(commit).toString('hex');
    const transcriptHex = crypto
      .createHash('sha256')
      .update('age_over|')
      .update(commit)
      .update(Buffer.from([minAge & 0xff, (minAge >> 8) & 0xff]))
      .update(Buffer.from([asOfYear & 0xff, (asOfYear >> 8) & 0xff]))
      .update(led.proven ? '1' : '0')
      .digest('hex');
    return {
      template: 'age_over',
      circuit: 'prove',
      commitmentHex,
      ledger: { proven: led.proven, minAge: Number(led.minAge), asOfYear: Number(led.asOfYear) },
      transcriptHex,
    };
  }

  if (o.template === 'balance_above') {
    const balance = Number(o.witness.balance);
    const salt = toBytes32(o.witness.salt);
    const threshold = Number(o.publicInputs.threshold);
    const commit = rt.persistentHash(V, [salt, encUint32LE(balance)]);
    const C = new m.Contract({
      balance: (c) => [c.privateState, BigInt(balance)],
      salt: (c) => [c.privateState, salt],
    });
    const st = C.initialState(ctor(), BigInt(threshold), commit);
    const r = call(C, st, 'prove');
    const led = m.ledger(r.context.currentQueryContext.state);
    if (!led.proven) throw new Error('balance_above circuit did not set proven');
    const commitmentHex = Buffer.from(commit).toString('hex');
    const transcriptHex = crypto
      .createHash('sha256')
      .update('balance_above|')
      .update(commit)
      .update(Buffer.from(String(threshold)))
      .update(led.proven ? '1' : '0')
      .digest('hex');
    return {
      template: 'balance_above',
      circuit: 'prove',
      commitmentHex,
      ledger: { proven: led.proven, threshold: Number(led.threshold) },
      transcriptHex,
    };
  }

  throw new Error(`unknown template: ${o.template}`);
}

/** Load deployments.preprod.json (or custom path). Does not touch secrets files. */
export function loadDeployments(deploymentsPath = path.join(here, 'deployments.preprod.json')) {
  if (!fs.existsSync(deploymentsPath)) return null;
  return JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));
}

/**
 * Read public ledger flag for a deployed Preprod contract via indexer.
 * Requires midnight/node_modules and a Blockfrost-backed config (token never logged).
 */
export async function verifyOnChainLedger(o) {
  const { setNetworkId } = await import('@midnight-ntwrk/midnight-js/network-id');
  const { indexerPublicDataProvider } = await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  );
  setNetworkId('preprod');
  const m = await loadContract(o.template, o.managedRoot ?? path.join(here, 'managed'));
  const st = await indexerPublicDataProvider(o.indexerHttpUrl, o.indexerWsUrl).queryContractState(
    o.contractAddress
  );
  if (!st) return { found: false, ok: false };
  const led = m.ledger(st.data);
  const ok = o.template === 'condition' ? led.released === true : led.proven === true;
  return { found: true, ok, ledger: led };
}

export const defaultManagedRoot = path.join(here, 'managed');
export const defaultDeploymentsPath = path.join(here, 'deployments.preprod.json');

/**
 * Build Compact witness factories from plain private inputs (caller-supplied; never logged).
 * @param {'condition'|'age_over'|'balance_above'} template
 * @param {object} witness plain values
 */
export function witnessesFor(template, witness) {
  if (template === 'condition') {
    const secret = toBytes32(witness.secret);
    const deliveryOk = witness.deliveryOk !== false;
    return {
      attesterSecret: (c) => [c.privateState, secret],
      deliveryOk: (c) => [c.privateState, deliveryOk],
    };
  }
  if (template === 'age_over') {
    const birthYear = Number(witness.birthYear);
    const salt = toBytes32(witness.salt);
    return {
      birthYear: (c) => [c.privateState, BigInt(birthYear)],
      salt: (c) => [c.privateState, salt],
    };
  }
  if (template === 'balance_above') {
    const balance = Number(witness.balance);
    const salt = toBytes32(witness.salt);
    return {
      balance: (c) => [c.privateState, BigInt(balance)],
      salt: (c) => [c.privateState, salt],
    };
  }
  throw new Error(`unknown template: ${template}`);
}

export function circuitFor(template) {
  return template === 'condition' ? 'attest' : 'prove';
}

/**
 * Submit an on-chain callTx (attest/prove) against an already-deployed Preprod contract.
 * Reuses wallet helpers; does NOT redeploy and does NOT wait for DUST registration.
 *
 * @param {object} o
 * @param {'condition'|'age_over'|'balance_above'} o.template
 * @param {string} o.contractAddress
 * @param {object} o.witness plain private inputs (caller-owned; never logged)
 * @param {string} [o.managedRoot]
 * @param {string} [o.walletName]
 * @param {number} [o.syncTimeoutMs]
 * @param {object} [o.deps] injectable for unit tests: { openSyncedWallet, makeProvidersFactory, assertProofServer, findDeployedContract, CompiledContract, loadContract }
 * @returns {Promise<{template:string, circuit:string, contractAddress:string, txId:string, txHash:string, blockHeight:number|undefined}>}
 */
export async function submitCallTx(o) {
  if (!o?.template) throw new Error('submitCallTx: template is required');
  if (!o?.contractAddress) throw new Error('submitCallTx: contractAddress is required (from deployments.preprod.json or caller)');
  if (!o?.witness) throw new Error('submitCallTx: witness is required (caller-supplied private inputs; SDK does not store them)');

  const deps = o.deps ?? {};
  const managedRoot = o.managedRoot ?? path.join(here, 'managed');
  const circuit = circuitFor(o.template);

  // Lazy-load heavy modules unless injected (keeps unit tests offline).
  const openSyncedWallet =
    deps.openSyncedWallet ?? (await import('./providers.mjs')).openSyncedWallet;
  const makeProvidersFactory =
    deps.makeProvidersFactory ?? (await import('./providers.mjs')).makeProvidersFactory;
  const assertProofServer =
    deps.assertProofServer ?? (await import('./providers.mjs')).assertProofServer;
  const findDeployedContract =
    deps.findDeployedContract ??
    (await import('@midnight-ntwrk/midnight-js/contracts')).findDeployedContract;
  const CompiledContract =
    deps.CompiledContract ?? (await import('@midnight-ntwrk/compact-js')).CompiledContract;
  const loadContractFn = deps.loadContract ?? loadContract;

  await assertProofServer();

  const { ctx, wallet, state } = await openSyncedWallet({
    walletName: o.walletName ?? 'deployer',
    syncTimeoutMs: o.syncTimeoutMs,
  });

  try {
    const m = await loadContractFn(o.template, managedRoot);
    const w = witnessesFor(o.template, o.witness);
    const cc = CompiledContract.make(o.template, m.Contract).pipe(
      CompiledContract.withWitnesses(w),
      CompiledContract.withCompiledFileAssets(path.join(managedRoot, o.template))
    );
    const providers = makeProvidersFactory(ctx, wallet, state)(o.template);
    const found = await findDeployedContract(providers, {
      compiledContract: cc,
      contractAddress: o.contractAddress,
      privateStateId: o.template,
      initialPrivateState: {},
    });
    if (typeof found.callTx?.[circuit] !== 'function') {
      throw new Error(`submitCallTx: circuit "${circuit}" not available on found contract`);
    }
    const r = await found.callTx[circuit]();
    const pub = r.public ?? r;
    return {
      template: o.template,
      circuit,
      contractAddress: o.contractAddress,
      txId: String(pub.txId ?? ''),
      txHash: String(pub.txHash ?? ''),
      blockHeight: pub.blockHeight,
    };
  } finally {
    try {
      await wallet.stop();
    } catch {
      /* ignore */
    }
  }
}
