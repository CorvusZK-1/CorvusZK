// Offline tests for the "Run it live" server: rate limits, queue, timeout, and the HTTP API with a fake runner.
import test from 'node:test';
import assert from 'node:assert';
import { WindowLimiter, RunQueue } from '../server/limits.mjs';
import { createServer } from '../server/index.mjs';

test('WindowLimiter allows max hits per window, then reports retry time', () => {
  let t = 0;
  const l = new WindowLimiter({ max: 2, windowMs: 1000, now: () => t });
  assert.equal(l.take('a'), true); assert.equal(l.take('a'), true); assert.equal(l.take('a'), false);
  assert.equal(l.take('b'), true);
  assert.ok(l.retryAfterSec('a') >= 1);
  t = 1001; assert.equal(l.take('a'), true);
});

test('RunQueue runs one job at a time, caps waiting jobs, and times out', async () => {
  const q = new RunQueue({ maxQueued: 1, timeoutMs: 50 });
  const order = [];
  let release;
  assert.equal(q.push('a', () => new Promise((r) => { release = r; }), () => order.push('a')), true);
  assert.equal(q.push('b', async () => 1, () => order.push('b')), true);
  assert.equal(q.push('c', async () => 1), false, 'queue full');
  assert.equal(q.position('a'), 0); assert.equal(q.position('b'), 1);
  release(); await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(order, ['a', 'b']);
  const err = await new Promise((resolve) => q.push('slow', () => new Promise(() => {}), (e) => resolve(e)));
  assert.match(err.message, /timed out/);
});

async function withServer(env, runner, fn) {
  const srv = createServer({ runner, env, log: () => {} });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base); } finally { srv.close(); }
}

const fakeRunner = {
  network: 'undeployed',
  async run(emit) { emit({ step: 'xrpl-lock', status: 'done' }); emit({ step: 'xrpl-release', status: 'done' }); return { ok: true, seconds: 1 }; },
};

test('HTTP: health, start a run, stream its events, then per-IP limit', async () => {
  await withServer({ RUNS_PER_IP_PER_HOUR: '1', ALLOWED_ORIGINS: 'https://corvuszk.com' }, fakeRunner, async (base) => {
    const h = await (await fetch(base + '/api/health')).json();
    assert.equal(h.testnetOnly, true); assert.equal(h.network, 'undeployed');
    const r = await fetch(base + '/api/runs', { method: 'POST', headers: { origin: 'https://corvuszk.com' } });
    assert.equal(r.status, 202);
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://corvuszk.com');
    const { id } = await r.json();
    const sse = await (await fetch(`${base}/api/runs/${id}/events`)).text();
    assert.match(sse, /xrpl-release/); assert.match(sse, /event: end/);
    const rec = await (await fetch(`${base}/api/runs/${id}`)).json();
    assert.equal(rec.status, 'done'); assert.equal(rec.events.length, 2);
    const again = await fetch(base + '/api/runs', { method: 'POST' });
    assert.equal(again.status, 429); assert.ok(Number(again.headers.get('retry-after')) > 0);
  });
});

test('HTTP: unknown origins get no CORS header; failures report a short error', async () => {
  const failing = { network: 'undeployed', async run() { throw new Error('boom'); } };
  await withServer({}, failing, async (base) => {
    const r = await fetch(base + '/api/runs', { method: 'POST', headers: { origin: 'https://evil.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    const { id } = await r.json();
    await fetch(`${base}/api/runs/${id}/events`).then((x) => x.text());
    const rec = await (await fetch(`${base}/api/runs/${id}`)).json();
    assert.equal(rec.status, 'failed'); assert.equal(rec.error, 'boom');
  });
});
