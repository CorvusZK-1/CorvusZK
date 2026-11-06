#!/usr/bin/env node
/**
 * CorvusZK — submit a new on-chain callTx (attest/prove) via the SDK bridge.
 *
 * Usage:
 *   node submit-onchain.mjs --template age_over
 *   node submit-onchain.mjs --template condition --dry-run
 *
 * Env (names only — never print values):
 *   BLOCKFROST_MIDNIGHT_PREPROD   required
 *   MIDNIGHT_PROOF_SERVER         default http://localhost:6300
 *   MN_SYNC_TIMEOUT_MS            default 90000 (fail fast; no multi-hour wait)
 *
 * Witnesses for the live Preprod contracts deployed 3 Nov 2026 are read from
 * .contract-secrets.preprod.json when present (mode 600). Callers can instead
 * pass JSON on stdin with { secret|birthYear|balance, salt?, deliveryOk? }.
 * Never logs secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (flag) => args.includes(flag);
const template = get('--template') || 'age_over';
const dryRun = has('--dry-run');
const syncTimeoutMs = Number(get('--sync-timeout-ms') || process.env.MN_SYNC_TIMEOUT_MS || 90_000);

if (!['condition', 'age_over', 'balance_above'].includes(template)) {
  console.error('Unknown --template. Use condition | age_over | balance_above');
  process.exit(2);
}
if (!process.env.BLOCKFROST_MIDNIGHT_PREPROD) {
  console.error('Set BLOCKFROST_MIDNIGHT_PREPROD (Blockfrost Midnight Preprod project id). Value is never logged.');
  process.exit(2);
}

const { loadDeployments, submitCallTx, circuitFor } = await import(pathToFileURL(path.join(here, 'sdk-bridge.mjs')).href);
const deps = loadDeployments();
const contractAddress = deps?.deployments?.[template]?.contractAddress;
if (!contractAddress) {
  console.error(`No contractAddress for ${template} in deployments.preprod.json`);
  process.exit(2);
}

function loadWitness(t) {
  // Prefer stdin JSON if piped; else secrets file for the known Preprod demo deployments.
  if (!process.stdin.isTTY) {
    const raw = fs.readFileSync(0, 'utf8').trim();
    if (raw) return JSON.parse(raw);
  }
  const secPath = path.join(here, '.contract-secrets.preprod.json');
  if (!fs.existsSync(secPath)) {
    throw new Error(
      'No witness JSON on stdin and .contract-secrets.preprod.json missing. ' +
        'Pipe {"birthYear":1990,"salt":"<hex>"} (or template-appropriate fields).'
    );
  }
  const sec = JSON.parse(fs.readFileSync(secPath, 'utf8'));
  if (t === 'condition') {
    return { secret: Buffer.from(sec.conditionSecret, 'hex'), deliveryOk: true };
  }
  if (t === 'age_over') {
    return { birthYear: 1990, salt: Buffer.from(sec.ageSalt, 'hex') };
  }
  return { balance: 5000, salt: Buffer.from(sec.balSalt, 'hex') };
}

const witness = loadWitness(template);
console.log(
  JSON.stringify({
    action: dryRun ? 'dry-run' : 'submitCallTx',
    template,
    circuit: circuitFor(template),
    contractAddress,
    syncTimeoutMs,
    proofServer: process.env.MIDNIGHT_PROOF_SERVER || 'http://localhost:6300',
    note: 'witness loaded (not printed)',
  })
);

if (dryRun) process.exit(0);

try {
  const result = await submitCallTx({
    template,
    contractAddress,
    witness,
    syncTimeoutMs,
  });
  console.log(JSON.stringify({ ok: true, ...result }));
  process.exit(0);
} catch (e) {
  const msg = String(e?.stack || e)
    .replace(/project_id=[^&\s"']+/g, 'project_id=***')
    .slice(0, 1200);
  console.error(JSON.stringify({ ok: false, error: msg }));
  process.exit(1);
}
