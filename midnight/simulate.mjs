// Local circuit simulation (no chain, no funds): runs Compact 0.36.0 constructors + circuits with compact-runtime 0.21.0.
import * as rt from '@midnight-ntwrk/compact-runtime'; import crypto from 'node:crypto';
import { initialState, runCircuit } from './rt-compat.mjs';
const res = {};
const B32 = new rt.CompactTypeBytes(32);
// condition
{ const m = await import('./managed/condition/contract/index.js'); const secret = crypto.randomBytes(32);
  const commit = rt.persistentHash(B32, secret);
  const mk = (s, ok) => new m.Contract({ attesterSecret: c => [c.privateState, s], deliveryOk: c => [c.privateState, ok] });
  const st = await initialState(rt, mk(secret, true), commit, new Uint8Array(32));
  try { const r = await runCircuit(rt, mk(secret, true), st, 'attest'); res.condition_valid = 'released=' + m.ledger(r.state).released; } catch (e) { res.condition_valid = 'ERR ' + e.message; }
  try { await runCircuit(rt, mk(crypto.randomBytes(32), true), st, 'attest'); res.condition_wrongSecret = 'UNEXPECTED PASS'; } catch (e) { res.condition_wrongSecret = 'rejected: ' + e.message.slice(0, 60); }
  try { await runCircuit(rt, mk(secret, false), st, 'attest'); res.condition_notDelivered = 'UNEXPECTED PASS'; } catch (e) { res.condition_notDelivered = 'rejected: ' + e.message.slice(0, 60); }
}
// age_over
{ const m = await import('./managed/age_over/contract/index.js'); const salt = crypto.randomBytes(32);
  const V = new rt.CompactTypeVector(2, B32);
  const enc = (n) => { const b = Buffer.alloc(32); b.writeUInt32LE(n, 0); return new Uint8Array(b); };
  const run = async (by, commitBy) => { const C = new m.Contract({ birthYear: c => [c.privateState, BigInt(by)], salt: c => [c.privateState, salt] });
    const st = await initialState(rt, C, 18n, 2026n, rt.persistentHash(V, [salt, enc(commitBy)])); return m.ledger((await runCircuit(rt, C, st, 'prove')).state).proven; };
  try { res.age_over18_1990 = 'proven=' + await run(1990, 1990); } catch (e) { res.age_over18_1990 = 'ERR ' + e.message.slice(0, 80); }
  try { await run(2012, 2012); res.age_under_2012 = 'UNEXPECTED PASS'; } catch (e) { res.age_under_2012 = 'rejected: ' + e.message.slice(0, 60); }
  try { await run(1990, 1985); res.age_wrongCommit = 'UNEXPECTED PASS'; } catch (e) { res.age_wrongCommit = 'rejected: ' + e.message.slice(0, 60); }
}
console.log(JSON.stringify(res, null, 1));
