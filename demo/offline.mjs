// CorvusZK offline demo: no network, no wallets, no money. Run: npm run build && npm run demo:offline
// Shows the three claims with the simulation backend, plus the escrow-release decision logic.
import * as k from '../dist/index.js';
const b = new k.LocalSimulationBackend(); const year = new Date().getFullYear();
const show = async (label, fn) => { try { const p = await fn(); console.log('PASS ', label, '->', JSON.stringify(p.claim), '| zk:', p.zk, '| verified:', await b.verify(p)); }
  catch (e) { console.log('REFUSED', label, '->', e.message); } };
console.log('CorvusZK offline demo (simulation backend: signed attestation, NOT zero-knowledge)\n');
await show('age_over: born 1990, needs 18+', () => k.proveAgeOver(b, 1990, 18, year, 'salt-1'));
await show('age_over: born 2015, needs 18+', () => k.proveAgeOver(b, 2015, 18, year, 'salt-2'));
await show('balance_above: holds 5000, needs > 1000', () => k.proveBalanceAbove(b, 5000, 1000, 'salt-3'));
await show('balance_above: holds 500, needs > 1000', () => k.proveBalanceAbove(b, 500, 1000, 'salt-4'));
const c = k.commit('delivered', 'salt-5');
await show('condition: right secret', () => k.proveCondition(b, 'delivered', 'salt-5', c));
await show('condition: wrong secret', () => k.proveCondition(b, 'not-delivered', 'salt-5', c));
const cc = k.createCryptoCondition();
console.log('\nEscrow lock: condition', cc.condition.slice(0, 24) + '...', '(fulfillment stays with the releaser)');
console.log('Release rule: submit EscrowFinish only when the proof verifies. Live testnet version: npm run demo (http://localhost:8787)');
