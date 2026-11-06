/**
 * Minimal CorvusZK example: prove three claims offline, then show how
 * verifyAndReleaseEscrow would gate an XRPL EscrowFinish.
 *
 * Run from toolkit root after: npm install && npm run build
 *   node examples/escrow-offline.mjs
 *
 * No network. No wallets. No money. Uses LocalSimulationBackend (NOT zero-knowledge).
 */
import * as corvuszk from '../dist/index.js';

const backend = new corvuszk.LocalSimulationBackend();
const year = new Date().getFullYear();

async function tryProve(label, fn) {
  try {
    const proof = await fn();
    const ok = await backend.verify(proof);
    console.log(`PASS  ${label}`);
    console.log(`      claim=${JSON.stringify(proof.claim)} zk=${proof.zk} verified=${ok}`);
    return proof;
  } catch (err) {
    console.log(`REFUSE ${label} → ${err.message}`);
    return null;
  }
}

console.log('CorvusZK offline example (simulation backend — not ZK)\n');

await tryProve('age_over 18+ (born 1990)', () =>
  corvuszk.proveAgeOver(backend, 1990, 18, year, 'example-salt-age'),
);
await tryProve('age_over 18+ (born 2015) — should refuse', () =>
  corvuszk.proveAgeOver(backend, 2015, 18, year, 'example-salt-young'),
);
await tryProve('balance_above 1000 (holds 5000)', () =>
  corvuszk.proveBalanceAbove(backend, 5000, 1000, 'example-salt-bal'),
);

const commitment = corvuszk.commit('delivered', 'example-salt-cond');
await tryProve('condition met', () =>
  corvuszk.proveCondition(backend, 'delivered', 'example-salt-cond', commitment),
);

const cryptoCond = corvuszk.createCryptoCondition();
console.log('\nCrypto-condition for XRPL escrow (fulfillment stays with releaser):');
console.log('  condition:', cryptoCond.condition.slice(0, 40) + '…');
console.log('\nLive XRPL testnet demo: npm run demo');
console.log('Real Compact circuits:     npm run simulate  (after: cd midnight && npm ci)');
