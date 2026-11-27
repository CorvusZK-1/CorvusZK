// Hosted CorvusZK demo backend.
// XRPL TESTNET ONLY. Simulation proofs (not zero-knowledge).
// No wallets, seeds, or mainnet credentials are loaded or stored.
// Throwaway testnet keys are funded by the public faucet and discarded after each run.

import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as xrpl from 'xrpl';
import * as k from '../dist/index.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const NETWORK = 'xrpl-testnet';
const FAUCET_HOST = 'faucet.altnet.rippletest.net';
const RUN_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT = 1;
const MAX_PER_IP = 4;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_AGE = 120;
const MIN_AGE = 1;

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || 'https://corvuszk.com,https://www.corvuszk.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const BLOCKED_ENV = [
  'BLOCKFROST_MIDNIGHT_MAINNET',
  'BLOCKFROST_MAINNET',
  'XRPL_MAINNET_WSS',
  'MAINNET_SEED',
  'MAINNET_WALLET',
  'WALLET_SEED',
  'WALLET_MNEMONIC',
  'MNEMONIC',
  'PRIVATE_KEY',
  'DEPLOYER_SEED',
];

function refuseDangerousEnv() {
  const hits = [];
  for (const name of BLOCKED_ENV) {
    if (process.env[name]) hits.push(name);
  }
  const networkish = [
    process.env.NETWORK,
    process.env.XRPL_NETWORK,
    process.env.MIDNIGHT_NETWORK,
    process.env.CARDANO_NETWORK,
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
  if (networkish.some((v) => v.includes('mainnet') || v === 'main')) {
    hits.push('NETWORK/XRPL_NETWORK/MIDNIGHT_NETWORK (mainnet not allowed)');
  }
  if (hits.length) {
    console.error('Refusing to start: mainnet or wallet-related environment is set:', hits.join(', '));
    process.exit(1);
  }
}

refuseDangerousEnv();

if (!k.XRPL_TESTNET_WSS || !String(k.XRPL_TESTNET_WSS).includes('testnet')) {
  console.error('Refusing to start: XRPL_TESTNET_WSS is missing or not a testnet URL');
  process.exit(1);
}

const htmlPath = fileURLToPath(new URL('./index.html', import.meta.url));
const html = fs.readFileSync(htmlPath);

let inFlight = 0;
const hitsByIp = new Map();

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function rateLimit(ip) {
  const now = Date.now();
  const list = (hitsByIp.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_IP) {
    hitsByIp.set(ip, list);
    return false;
  }
  list.push(now);
  hitsByIp.set(ip, list);
  return true;
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

async function runDemo(age) {
  const steps = [];
  const client = new xrpl.Client(k.XRPL_TESTNET_WSS);
  await client.connect();
  try {
    const fund = () => client.fundWallet(null, { faucetHost: FAUCET_HOST });
    const { wallet: buyer } = await fund();
    const { wallet: seller } = await fund();
    // Addresses only — never seeds or secret keys.
    steps.push(['Funded throwaway testnet wallets', `${buyer.address} -> ${seller.address}`]);

    const cond = k.createCryptoCondition();
    const esc = await k.createEscrow(client, buyer, {
      destination: seller.address,
      amountXrp: '20',
      condition: cond.condition,
    });
    steps.push(['EscrowCreate 20 XRP (' + esc.result + ')', k.explorerTx(esc.hash)]);

    const backend = new k.LocalSimulationBackend();
    let proof;
    try {
      proof = await k.proveAgeOver(
        backend,
        new Date().getFullYear() - age,
        18,
        new Date().getFullYear(),
        'demo-salt',
      );
      steps.push([
        'Proof: buyer is 18+ (SIMULATION, not ZK)',
        'birth year stays with the local prover; only the claim is shared',
      ]);
    } catch (e) {
      steps.push(['Proof refused', String(e.message || e)]);
      return steps;
    }

    const release = await k.verifyAndReleaseEscrow(client, seller, {
      backend,
      proof,
      owner: esc.owner,
      offerSequence: esc.offerSequence,
      ...cond,
    });
    steps.push([
      'EscrowFinish (' + release.reason + ')',
      release.hash ? k.explorerTx(release.hash) : '',
    ]);
    return steps;
  } finally {
    await client.disconnect();
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Demo timed out')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/health')) {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        ok: true,
        network: NETWORK,
        backend: 'simulation',
        zk: false,
      }),
    );
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/run') {
    const ip = clientIp(req);
    if (inFlight >= MAX_CONCURRENT) {
      res.statusCode = 429;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([['Busy', 'A demo is already running. Try again in a minute.']]));
      return;
    }
    if (!rateLimit(ip)) {
      res.statusCode = 429;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([['Slow down', 'Please wait a few minutes before running another demo.']]));
      return;
    }

    const age = Number(url.searchParams.get('age') || 30);
    if (!Number.isFinite(age) || age < MIN_AGE || age > MAX_AGE) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([['Error', 'Age must be a number between 1 and 120']]));
      return;
    }

    inFlight += 1;
    try {
      const steps = await withTimeout(runDemo(age), RUN_TIMEOUT_MS);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(steps));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([['Error', String(e.message || e)]]));
    } finally {
      inFlight -= 1;
    }
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`CorvusZK testnet demo listening on ${HOST}:${PORT} (xrpl-testnet, simulation proofs only)`);
});
