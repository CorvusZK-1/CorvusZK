// Local circuit simulation (no chain, no funds): runs Compact constructors + circuits with compact-runtime 0.16.0.
import * as rt from '@midnight-ntwrk/compact-runtime'; import crypto from 'node:crypto';
const res = {};
const ctor = () => rt.createConstructorContext({}, '0'.repeat(64));
const call = (C, st, name) => { const ctx = rt.createCircuitContext(rt.dummyContractAddress(), '0'.repeat(64), st.currentContractState, {}); return C.circuits[name](ctx); };
const B32 = new rt.CompactTypeBytes(32);
// condition
{ const m = await import('./managed/condition/contract/index.js'); const secret = crypto.randomBytes(32);
  const commit = rt.persistentHash(B32, secret);
  const mk = (s, ok) => new m.Contract({ attesterSecret: c => [c.privateState, s], deliveryOk: c => [c.privateState, ok] });
  const st = mk(secret, true).initialState(ctor(), commit, new Uint8Array(32));
  try { const r = call(mk(secret, true), st, 'attest'); res.condition_valid = 'released=' + m.ledger(r.context.currentQueryContext.state).released; } catch (e) { res.condition_valid = 'ERR ' + e.message; }
  try { call(mk(crypto.randomBytes(32), true), st, 'attest'); res.condition_wrongSecret = 'UNEXPECTED PASS'; } catch (e) { res.condition_wrongSecret = 'rejected: ' + e.message.slice(0, 60); }
  try { call(mk(secret, false), st, 'attest'); res.condition_notDelivered = 'UNEXPECTED PASS'; } catch (e) { res.condition_notDelivered = 'rejected: ' + e.message.slice(0, 60); }
}
// age_over: find the field->bytes encoding by letting the circuit accept it
{ const m = await import('./managed/age_over/contract/index.js'); const salt = crypto.randomBytes(32);
  const V = new rt.CompactTypeVector(2, B32);
  const enc = (n, le) => { const b = Buffer.alloc(32); if (le) b.writeUInt16LE(n, 0); else b.writeUInt16BE(n, 30); return new Uint8Array(b); };
  const run = (by, commitBy, le) => { const C = new m.Contract({ birthYear: c => [c.privateState, BigInt(by)], salt: c => [c.privateState, salt] });
    const st = C.initialState(ctor(), 18n, 2026n, rt.persistentHash(V, [salt, enc(commitBy, le)])); return m.ledger(call(C, st, 'prove').context.currentQueryContext.state).proven; };
  let le = true; try { run(1990, 1990, true); } catch { le = false; }
  try { res.age_over18_1990 = 'proven=' + run(1990, 1990, le); } catch (e) { res.age_over18_1990 = 'ERR ' + e.message.slice(0, 80); }
  try { run(2012, 2012, le); res.age_under_2012 = 'UNEXPECTED PASS'; } catch (e) { res.age_under_2012 = 'rejected: ' + e.message.slice(0, 60); }
  try { run(1990, 1985, le); res.age_wrongCommit = 'UNEXPECTED PASS'; } catch (e) { res.age_wrongCommit = 'rejected: ' + e.message.slice(0, 60); }
}
console.log(JSON.stringify(res, null, 1));
