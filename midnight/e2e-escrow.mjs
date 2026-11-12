// CorvusZK end-to-end: XRPL testnet escrow released only after the Midnight Preprod `attest` ZK proof is verified on-chain.
// Reads the condition contract's public ledger from the Preprod indexer; releases only if released==true and the attest tx is recorded.
import fs from 'node:fs'; import { WebSocket } from 'ws'; globalThis.WebSocket = WebSocket;
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { preprodConfig } from '../dist/midnight-config.js';
const xrpl = await import(new URL('../node_modules/xrpl/dist/npm/index.js', import.meta.url).href).then(m => m.default ?? m);
const k = await import('../dist/index.js');
const cfg = preprodConfig();
const { decodeContractState } = await import('./sdk-bridge.mjs');
const dep = JSON.parse(fs.readFileSync(new URL('./deployments.preprod.json', import.meta.url)));
const cond = dep.deployments?.condition; if (!cond?.contractAddress || !cond.call?.txHash) throw new Error('condition contract not deployed/attested yet');
const c = new xrpl.Client(k.XRPL_TESTNET_WSS); await c.connect();
const fw = () => c.fundWallet(null, { faucetHost: 'faucet.altnet.rippletest.net' });
const { wallet: buyer } = await fw(); const { wallet: seller } = await fw();
fs.writeFileSync(new URL('./.xrpl-e2e-keys.testnet.json', import.meta.url), JSON.stringify({ buyer: buyer.seed, seller: seller.seed }), { mode: 0o600 });
const cc = k.createCryptoCondition();
const esc = await k.createEscrow(c, buyer, { destination: seller.address, amountXrp: '25', condition: cc.condition });
if (esc.result !== 'tesSUCCESS') throw new Error('escrow create failed ' + esc.result);
// Verify the Midnight proof outcome on-chain (the node only accepts the attest tx if its ZK proof verifies).
const m = await import('./managed/condition/contract/index.js');
const st = await indexerPublicDataProvider(cfg.indexerHttpUrl, cfg.indexerWsUrl).queryContractState(cond.contractAddress);
const released = st ? m.ledger(await decodeContractState(st)).released : false;
const result = { midnightContract: cond.contractAddress, midnightAttestTx: cond.call.txHash, midnightReleasedFlag: String(released), xrplCreate: esc.hash };
if (released === true) {
  const tx = await c.autofill({ TransactionType: 'EscrowFinish', Account: seller.address, Owner: esc.owner, OfferSequence: esc.offerSequence, Condition: cc.condition, Fulfillment: cc.fulfillment });
  const r = await c.submitAndWait(tx, { wallet: seller }); result.xrplFinish = r.result.hash; result.xrplFinishResult = r.result.meta.TransactionResult;
} else result.xrplFinish = 'NOT RELEASED (Midnight state not proven)';
dep.e2e = { ...result, at: new Date().toISOString() }; fs.writeFileSync(new URL('./deployments.preprod.json', import.meta.url), JSON.stringify(dep, null, 1));
console.log(JSON.stringify(result, null, 1)); await c.disconnect(); process.exit(0);
