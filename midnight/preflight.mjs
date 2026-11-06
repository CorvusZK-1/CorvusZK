// Preflight for Preprod deployment. Prints status only; never prints the token or seeds.
import fs from 'node:fs'; import { preprodConfig, redact } from '../dist/midnight-config.js';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
const c = preprodConfig(); const res = {};
const gql = async q => fetch(c.indexerHttpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q }) });
let r = await gql('{ block { height } }'); res.indexer = `${r.status} tip=${(await r.json()).data?.block?.height}`;
r = await fetch(c.nodeRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'system_chain', params: [] }) }); res.nodeRpc = `${r.status} chain=${(await r.json()).result}`;
try { r = await fetch(c.proofServerUrl + '/version'); res.proofServer = `${r.status} v${await r.text()}`; } catch { res.proofServer = 'DOWN' }
try { const t = await WalletFacade.fetchTermsAndConditions({ indexerClientConnection: { indexerHttpUrl: c.indexerHttpUrl } }); res.termsAndConditions = t.url; } catch (e) { res.termsAndConditions = 'error: ' + String(e.message).replace(/project_id=[^&\s"]+/g,'project_id=***').slice(0,150); }
res.wallets = fs.existsSync(new URL('./.wallets.preprod.json', import.meta.url)) ? 'present (mode 600)' : 'missing';
for (const k of ['condition', 'balance_above', 'age_over']) {
  const d = new URL(`../contracts/out/${k}/`, import.meta.url);
  res['artifact_' + k] = ['contract/index.js', 'keys', 'zkir'].every(p => fs.existsSync(new URL(p, d))) ? 'ok' : 'missing';
}
res.endpoints = { indexer: redact(c.indexerHttpUrl), rpc: redact(c.nodeRpcUrl) };
console.log(JSON.stringify(res, null, 1));
