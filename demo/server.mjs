// Local demo: node demo/server.mjs  ->  http://localhost:8787  (XRPL TESTNET ONLY, simulation proof backend)
import http from 'node:http'; import fs from 'node:fs'; import * as xrpl from 'xrpl'; import * as k from '../dist/index.js';
const html=fs.readFileSync(new URL('./index.html',import.meta.url));
async function run(age){
  const steps=[];const c=new xrpl.Client(k.XRPL_TESTNET_WSS);await c.connect();
  try{
    const fw=()=>c.fundWallet(null,{faucetHost:'faucet.altnet.rippletest.net'});
    const {wallet:buyer}=await fw();const {wallet:seller}=await fw();steps.push(['Funded throwaway testnet wallets',buyer.address+' -> '+seller.address]);
    const cond=k.createCryptoCondition();const esc=await k.createEscrow(c,buyer,{destination:seller.address,amountXrp:'20',condition:cond.condition});
    steps.push(['EscrowCreate 20 XRP ('+esc.result+')',k.explorerTx(esc.hash)]);
    const b=new k.LocalSimulationBackend();let proof;
    try{proof=await k.proveAgeOver(b,new Date().getFullYear()-age,18,new Date().getFullYear(),'demo-salt');steps.push(['Proof: buyer is 18+ (SIMULATION, not ZK)','birth year stays with the local prover; only the claim is shared']);}
    catch(e){steps.push(['Proof refused',String(e.message)]);return steps;}
    const r=await k.verifyAndReleaseEscrow(c,seller,{backend:b,proof,owner:esc.owner,offerSequence:esc.offerSequence,...cond});
    steps.push(['EscrowFinish ('+r.reason+')',r.hash?k.explorerTx(r.hash):'']);return steps;
  }finally{await c.disconnect();}
}
http.createServer(async(q,s)=>{const u=new URL(q.url,'http://x');
  if(u.pathname==='/api/run'){try{s.setHeader('content-type','application/json');s.end(JSON.stringify(await run(Number(u.searchParams.get('age')||30))));}catch(e){s.statusCode=500;s.end(JSON.stringify([['Error',String(e.message)]]));}return;}
  s.setHeader('content-type','text/html');s.end(html);}).listen(8787,()=>console.log('demo on http://localhost:8787'));
