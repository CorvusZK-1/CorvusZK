/**
 * Policy-party registry for the strict release path (ADR-001 mode A, CZ-008).
 * The trusted policy party records each approved intent, the one contract bound to it,
 * which credential nullifier it consumed, and its settlement state. This is what enforces
 * "one credential, one escrow" and idempotent retries. It is local state of the trusted
 * party, not a global on-chain registry. Single-process; no cross-process locking.
 */
import fs from 'node:fs';
import path from 'node:path';

export type IntentState = 'registered' | 'submitting' | 'submitted-unknown' | 'settled' | 'failed';
export type IntentRecord = {
  intentHash: string;
  contractAddress?: string;
  credentialNullifier?: string;
  state: IntentState;
  txHash?: string;
  reason?: string;
};
export type RegistryData = { v: 1; intents: Record<string, IntentRecord>; credentials: Record<string, string> };

export class RegistryConflict extends Error {
  constructor(public code: 'intent-hash-conflict' | 'contract-already-bound' | 'credential-already-used' | 'intent-not-registered', msg: string) {
    super(msg);
  }
}

export class MemoryPolicyRegistry {
  protected data: RegistryData = { v: 1, intents: {}, credentials: {} };
  protected save(): void {}

  get(intentId: string): IntentRecord | undefined {
    const r = this.data.intents[intentId];
    return r ? { ...r } : undefined;
  }
  /** Idempotent for the same hash; refuses a different intent under the same id. */
  registerIntent(intentId: string, intentHash: string): void {
    const r = this.data.intents[intentId];
    if (r && r.intentHash !== intentHash) throw new RegistryConflict('intent-hash-conflict', `intent ${intentId} already registered with another hash`);
    if (!r) {
      this.data.intents[intentId] = { intentHash, state: 'registered' };
      this.save();
    }
  }
  bindContract(intentId: string, contractAddress: string): void {
    const r = this.data.intents[intentId];
    if (!r) throw new RegistryConflict('intent-not-registered', `intent ${intentId} is not registered`);
    if (r.contractAddress && r.contractAddress !== contractAddress) throw new RegistryConflict('contract-already-bound', `intent ${intentId} is bound to another contract`);
    if (!r.contractAddress) {
      r.contractAddress = contractAddress;
      this.save();
    }
  }
  /** One credential nullifier may be consumed by one intent only. Same intent again is fine. */
  claimCredential(credentialNullifier: string, intentId: string): void {
    const r = this.data.intents[intentId];
    if (!r) throw new RegistryConflict('intent-not-registered', `intent ${intentId} is not registered`);
    const owner = this.data.credentials[credentialNullifier];
    if (owner && owner !== intentId) throw new RegistryConflict('credential-already-used', 'credential already authorized another intent');
    if (!owner) {
      this.data.credentials[credentialNullifier] = intentId;
      r.credentialNullifier = credentialNullifier;
      this.save();
    }
  }
  setState(intentId: string, state: IntentState, extra: { txHash?: string; reason?: string } = {}): void {
    const r = this.data.intents[intentId];
    if (!r) throw new RegistryConflict('intent-not-registered', `intent ${intentId} is not registered`);
    if (r.state === 'settled') return; // terminal
    r.state = state;
    if (extra.txHash) r.txHash = extra.txHash;
    if (extra.reason) r.reason = extra.reason;
    this.save();
  }
}

/** JSON-file registry (mode 0600, atomic replace). Holds no secrets: hashes, ids, states only. */
export class FilePolicyRegistry extends MemoryPolicyRegistry {
  constructor(private file: string) {
    super();
    if (fs.existsSync(file)) {
      const d = JSON.parse(fs.readFileSync(file, 'utf8')) as RegistryData;
      if (d?.v !== 1 || !d.intents || !d.credentials) throw new Error('FilePolicyRegistry: unrecognized file');
      this.data = d;
    }
  }
  protected override save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
