/**
 * "Run it live" HTTP server for corvuszk.com/app. Test networks only.
 *
 *   GET  /api/health             network, queue, runs left this hour
 *   POST /api/runs               start a run (rate limited) -> 202 { id, position } | 429 { error, retryAfterSec }
 *   GET  /api/runs/:id           run record (public fields only)
 *   GET  /api/runs/:id/events    server-sent events: each step as it happens
 *
 * Env: MIDNIGHT_NETWORK (preview | undeployed), MN_WALLET_DIR (folder with .wallets.<network>.json, mode 600),
 * MIDNIGHT_PROOF_SERVER (default http://localhost:6300), PORT (8790), ALLOWED_ORIGINS, TRUST_PROXY=1 behind a proxy,
 * RUNS_PER_HOUR (6), RUNS_PER_IP_PER_HOUR (2), MAX_QUEUED (3), RUN_TIMEOUT_MS (300000).
 * Never logs or returns seeds, holder secrets, or preimages before reveal.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { WindowLimiter, RunQueue, clientIp } from './limits.mjs';

const HOUR = 3_600_000;

export function createServer({ runner, now = () => Date.now(), env = process.env, log = console.log } = {}) {
  const globalLimit = new WindowLimiter({ max: Number(env.RUNS_PER_HOUR ?? 6), windowMs: HOUR, now });
  const ipLimit = new WindowLimiter({ max: Number(env.RUNS_PER_IP_PER_HOUR ?? 2), windowMs: HOUR, now });
  const queue = new RunQueue({ maxQueued: Number(env.MAX_QUEUED ?? 3), timeoutMs: Number(env.RUN_TIMEOUT_MS ?? 300_000) });
  const origins = String(env.ALLOWED_ORIGINS ?? 'https://corvuszk.com,http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim());
  const trustProxy = env.TRUST_PROXY === '1';
  const runs = new Map(); // id -> { id, status, createdAt, events[], result, error, listeners:Set }

  const publicRun = (r) => ({ id: r.id, status: r.status, createdAt: r.createdAt, position: queue.position(r.id), network: runner.network,
    events: r.events, result: r.result ?? null, error: r.error ?? null });

  function record(id) {
    const r = { id, status: 'queued', createdAt: new Date(now()).toISOString(), events: [], listeners: new Set() };
    runs.set(id, r);
    if (runs.size > 50) runs.delete(runs.keys().next().value);
    return r;
  }
  function push(r, ev) {
    r.events.push(ev);
    for (const res of r.listeners) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }
  function finish(r) {
    for (const res of r.listeners) { res.write(`event: end\ndata: ${JSON.stringify(publicRun(r))}\n\n`); res.end(); }
    r.listeners.clear();
  }

  function cors(req, res) {
    const o = req.headers.origin;
    if (o && origins.includes(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
  }
  const json = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };

  return http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})(\/events)?$/);
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { ok: true, network: runner.network, testnetOnly: true, queued: queue.size, runsLeftThisHour: globalLimit.remaining(),
          note: 'Runs use the CorvusZK test server wallet on a Midnight test network plus XRPL testnet. Not your wallet. No real money.' });
      }
      if (req.method === 'POST' && url.pathname === '/api/runs') {
        const ip = clientIp(req, trustProxy);
        const g = globalLimit.retryAfterSec(), p = ipLimit.retryAfterSec(ip);
        if (g || p) {
          const retry = Math.max(g, p);
          return json(res, 429, { error: g ? 'The hourly run budget for the test wallet is used up.' : 'You have used your runs for this hour.', retryAfterSec: retry }, { 'retry-after': String(retry) });
        }
        const id = crypto.randomUUID();
        const r = record(id);
        const ok = queue.push(id, async (signal) => {
          r.status = 'running';
          return runner.run((ev) => push(r, ev), signal);
        }, (err, result) => {
          if (err) { r.status = 'failed'; r.error = String(err.message ?? err).replace(/project_id=[^&\s"']+/g, 'project_id=***').slice(0, 300); push(r, { step: 'error', status: 'error', detail: r.error }); log('run failed', id, r.error); }
          else { r.status = 'done'; r.result = result; log('run done', id, result?.seconds, 's'); }
          finish(r);
        });
        if (!ok) { runs.delete(id); return json(res, 429, { error: 'The queue is full. Try again in a few minutes.', retryAfterSec: 120 }, { 'retry-after': '120' }); }
        globalLimit.take(); ipLimit.take(ip);
        return json(res, 202, { id, position: queue.position(id) });
      }
      if (req.method === 'GET' && m) {
        const r = runs.get(m[1]);
        if (!r) return json(res, 404, { error: 'unknown run' });
        if (!m[2]) return json(res, 200, publicRun(r));
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(`event: snapshot\ndata: ${JSON.stringify(publicRun(r))}\n\n`);
        if (r.status === 'done' || r.status === 'failed') { res.write(`event: end\ndata: ${JSON.stringify(publicRun(r))}\n\n`); return res.end(); }
        r.listeners.add(res);
        req.on('close', () => r.listeners.delete(res));
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: 'server error' });
      log('handler error', String(e?.message ?? e).slice(0, 200));
    }
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const { createLiveRunner } = await import('./live-run.mjs');
  const runner = await createLiveRunner({ log: (...a) => console.error(...a) });
  const port = Number(process.env.PORT ?? 8790);
  createServer({ runner }).listen(port, process.env.HOST ?? '0.0.0.0', () => console.log(`CorvusZK live server on :${port} (${runner.network})`));
  const stop = async () => { await runner.close().catch(() => {}); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
