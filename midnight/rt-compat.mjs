// compact-runtime 0.21 helpers (Compact toolchain 0.36.0 output): constructors and circuits are async,
// circuit contexts take an options object, and the new ledger state sits in context.queryContexts[address].
export async function initialState(rt, C, ...args) {
  const r = await C.initialState(rt.createConstructorContext({}, '0'.repeat(64)), ...args);
  return r.currentContractState;
}
export async function runCircuit(rt, C, contractState, name, ...args) {
  const addr = rt.dummyContractAddress();
  const ctx = rt.createCircuitContext({ circuitId: name, contractAddress: addr, coinPublicKeyOrZswapState: '0'.repeat(64), contractState, privateState: {} });
  const r = await C.circuits[name](ctx, ...args);
  return { result: r.result, state: r.context.queryContexts[addr].state };
}
