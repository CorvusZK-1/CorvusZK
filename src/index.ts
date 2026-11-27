/**
 * CorvusZK — non-custodial SDK.
 * - Never holds user funds: XRP sits in a native XRPL escrow owned by the payer's own wallet.
 * - Never stores keys or fulfillments: callers pass them in; nothing is persisted.
 * Proof backends:
 *   LocalSimulationBackend — NOT zero-knowledge. A local prover checks the private predicate and
 *     signs an Ed25519 attestation. For dev/testing only; clearly labeled in every proof.
 *   MidnightBackend — real Compact circuits (condition / age_over / balance_above / eligibility).
 *     Default mode `local-circuits` runs the original three circuits locally (no wallet sync).
 *     `preprod` attaches live Preprod contract addresses from deployments.preprod.json.
 *     `submitOnChain` posts a callTx for those three. `deployEligibility`, `callEligibility`,
 *     and `readEligibilityState` deploy and run eligibility prove/reveal on Preprod.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as xrpl from 'xrpl';
import { preimageSha256 } from './crypto-condition.js';
import { preprodConfig } from './midnight-config.js';

export type Claim =
  | { kind: 'condition'; commitment: string }
  | { kind: 'balanceAbove'; threshold: number; commitment: string }
  | { kind: 'ageOver'; minAge: number; asOfYear: number; commitment: string };

/** Private witnesses for Midnight Compact circuits. Never stored; never placed on Proof.claim. */
export type PrivateWitness =
  | { kind: 'condition'; secret: string | Uint8Array; deliveryOk?: boolean }
  | { kind: 'balanceAbove'; balance: number; salt: string | Uint8Array }
  | { kind: 'ageOver'; birthYear: number; salt: string | Uint8Array };

/**
 * What kind of evidence a Proof object carries. These are different guarantees:
 * - `simulation-attestation`: a local process checked the predicate in plain code and signed it. Not ZK.
 * - `local-circuit-evaluation`: the compiled Compact circuit ran on this machine (compact-runtime).
 *   Constraints were checked, but no zero-knowledge proof was produced or verified.
 * - `chain-transaction-reported`: our own submitter reports that a Midnight transaction was accepted.
 *   The node verified a ZK proof for that transaction, but this SDK has not independently checked it.
 * - `verified-chain-evidence`: chain state was independently checked against trusted policy
 *   configuration (see MidnightBackend.verifyStrict). Only this kind may be treated as ZK evidence.
 */
export type EvidenceKind =
  | 'simulation-attestation'
  | 'local-circuit-evaluation'
  | 'chain-transaction-reported'
  | 'verified-chain-evidence';
export const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  'simulation-attestation',
  'local-circuit-evaluation',
  'chain-transaction-reported',
  'verified-chain-evidence',
];

/** Upper bound for an attestation string; larger inputs are rejected before parsing. */
export const MAX_ATTESTATION_BYTES = 64 * 1024;

export interface Proof {
  claim: Claim;
  backend: 'local-simulation' | 'midnight';
  /** Explicit evidence kind. Check this, not `zk`. */
  evidence: EvidenceKind;
  /**
   * @deprecated Use `evidence`. True only when `evidence === 'verified-chain-evidence'`.
   * Local runs (simulation or compact-runtime) always set `zk: false`.
   */
  zk: boolean;
  attestation: string;
  signerPublicKey: string;
  createdAt: number;
}

export interface ProofBackend {
  name: Proof['backend'];
  prove(claim: Claim, privateOk: boolean, witness?: PrivateWitness): Promise<Proof>;
  verify(proof: Proof): Promise<boolean>;
}

/** Injectable bridge shape (tests / custom loaders). */
export type OnChainSubmitResult = {
  template: string;
  circuit: string;
  contractAddress: string;
  txId: string;
  txHash: string;
  blockHeight?: number;
  fees?: { paidFees: string | null; estimatedFees: string | null };
};

export type MidnightBridge = {
  proveLocal: (o: {
    template: 'condition' | 'age_over' | 'balance_above';
    publicInputs: Record<string, unknown>;
    witness: Record<string, unknown>;
    managedRoot?: string;
  }) => Promise<{
    template: string;
    circuit: string;
    commitmentHex: string;
    ledger: Record<string, unknown>;
    transcriptHex: string;
  }>;
  loadDeployments?: (p?: string) => null | {
    deployments?: Record<string, { contractAddress?: string; call?: { txHash?: string } }>;
  };
  verifyOnChainLedger?: (o: {
    template: string;
    contractAddress: string;
    indexerHttpUrl: string;
    indexerWsUrl: string;
    managedRoot?: string;
  }) => Promise<{ found: boolean; ok: boolean }>;
  /** Submit attest/prove callTx against an already-deployed Preprod contract. */
  submitCallTx?: (o: {
    template: 'condition' | 'age_over' | 'balance_above' | 'eligibility';
    circuit?: 'attest' | 'prove' | 'reveal';
    contractAddress: string;
    witness: Record<string, unknown>;
    managedRoot?: string;
    walletName?: string;
    syncTimeoutMs?: number;
  }) => Promise<OnChainSubmitResult>;
  deployEligibility?: (o: Record<string, unknown>) => Promise<OnChainSubmitResult>;
  callEligibility?: (o: Record<string, unknown>) => Promise<OnChainSubmitResult>;
  readEligibilityState?: (o: Record<string, unknown>) => Promise<{
    found: boolean;
    proven: boolean;
    preimageRevealed: boolean;
    revealedPreimage: Uint8Array | null;
    ledger: Record<string, unknown> | null;
    rawLedger: Record<string, unknown> | null;
  }>;
  closeEligibilitySession?: (contractAddress: string) => Promise<void>;
  /** sha256 over the template's compiled circuit verifier keys. */
  circuitArtifactId?: (template: string, managedRoot?: string) => string;
  /** Strict chain read used by verifyStrict (midnight/sdk-bridge.mjs readContractEvidence). */
  readContractEvidence?: (o: {
    template: string;
    contractAddress: string;
    indexerHttpUrl: string;
    indexerWsUrl: string;
    managedRoot?: string;
  }) => Promise<{ found: boolean; ledger?: Record<string, unknown>; artifactMatch?: boolean | null }>;
  defaultManagedRoot?: string;
  defaultDeploymentsPath?: string;
};

/** Outcome of strict verification. Only `verified` permits progression (CZ-002). */
export type VerificationStatus = 'verified' | 'rejected' | 'unavailable' | 'pending' | 'expired';
export type VerifiedChainEvidence = {
  kind: 'verified-chain-evidence';
  network: string;
  template: string;
  contractAddress: string;
  ledger: Record<string, unknown>;
  checkedAt: number;
};
export type VerificationOutcome = {
  status: VerificationStatus;
  /** Machine-readable reason, e.g. `indexer-unavailable`, `artifact-mismatch`. */
  reason: string;
  evidence?: VerifiedChainEvidence;
};
/**
 * Trusted policy configuration for strict verification. Comes from the integrator's own
 * configuration, never from the proof being checked.
 */
export type ExpectedChainPolicy = {
  network: string;
  template: 'condition' | 'age_over' | 'balance_above' | 'eligibility' | 'eligibility_v2';
  contractAddress: string;
  /** Public ledger values that must match exactly (compared as strings). */
  publicParams?: Record<string, string | number | bigint>;
  /** Reject proofs older than this (ms). */
  maxEvidenceAgeMs?: number;
  /** Indexer read timeout (default 20000 ms). Timeout => `unavailable`. */
  timeoutMs?: number;
};

const SUCCESS_FLAGS: Record<string, (l: Record<string, unknown>) => boolean> = {
  eligibility_v2: (l) => l.proven === true && l.preimageRevealed === true,
  condition: (l) => l.released === true,
  age_over: (l) => l.proven === true,
  balance_above: (l) => l.proven === true,
  eligibility: (l) => l.proven === true && l.preimageRevealed === true,
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => {
      t = setTimeout(() => rej(new Error('timeout')), ms);
    }),
  ]);
}

export type MidnightBackendOpts = {
  blockfrostProjectId?: string;
  proofServer?: string;
  walletSeedFile?: string;
  /** `local-circuits` (default): run compiled Compact circuits locally. `preprod`: same prove path + attach/deployments verify. */
  mode?: 'local-circuits' | 'preprod';
  deploymentsPath?: string;
  managedRoot?: string;
  /** Wallet name key inside midnight/.wallets.preprod.json (default deployer). Path only — never logged. */
  walletName?: string;
  /** Hard cap for wallet sync before submitOnChain fails (default 90000). */
  syncTimeoutMs?: number;
  /** Override dynamic import of midnight/sdk-bridge.mjs (unit tests). */
  bridge?: MidnightBridge;
};

const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
/** Hiding commitment to a private value: sha256(salt || value). */
export function commit(value: string | number, salt: string): string {
  return sha256(`${salt}|${value}`);
}
const claimBytes = (c: Claim) => Buffer.from(JSON.stringify(c));

/** True only for evidence that was independently verified against trusted chain configuration. */
export function isVerifiedChainEvidence(p: Pick<Proof, 'evidence' | 'zk'> | null | undefined): boolean {
  return !!p && p.evidence === 'verified-chain-evidence';
}

/** Deterministic JSON (sorted keys) for signing and comparing claims. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().filter((key) => o[key] !== undefined).map((key) => JSON.stringify(key) + ':' + canonicalJson(o[key])).join(',') + '}';
}

/** The public parameters a circuit ledger reports must be the ones the claim states. */
function claimMatchesLedger(claim: Claim, template: string, ledger: Record<string, unknown> | undefined): boolean {
  if (!ledger) return false;
  if (claim.kind === 'ageOver') {
    return template === 'age_over' && Number(ledger.minAge) === claim.minAge && Number(ledger.asOfYear) === claim.asOfYear;
  }
  if (claim.kind === 'balanceAbove') {
    return template === 'balance_above' && Number(ledger.threshold) === claim.threshold;
  }
  return claim.kind === 'condition' && template === 'condition';
}

function wellFormedProof(p: unknown): p is Proof {
  if (!p || typeof p !== 'object') return false;
  const q = p as Partial<Proof>;
  if (typeof q.attestation !== 'string' || q.attestation.length > MAX_ATTESTATION_BYTES) return false;
  if (typeof q.signerPublicKey !== 'string' || !q.claim || typeof q.claim !== 'object') return false;
  if (!EVIDENCE_KINDS.includes(q.evidence as EvidenceKind)) return false;
  // `zk` may only be true together with verified chain evidence.
  if (q.zk !== (q.evidence === 'verified-chain-evidence')) return false;
  return true;
}

type MidnightAttestation = {
  /** v2 signs the claim itself (CZ-003a). v1 attestations are rejected. */
  v: 2;
  evidence: EvidenceKind;
  claim: Claim;
  mode: 'local-circuits' | 'preprod';
  template: string;
  circuit: string;
  transcriptHex: string;
  ledger: Record<string, unknown>;
  contractAddress?: string;
  onChainTxHash?: string;
  onChainTxId?: string;
  sig: string;
};

export class LocalSimulationBackend implements ProofBackend {
  name = 'local-simulation' as const;
  private key = crypto.generateKeyPairSync('ed25519');
  readonly publicKey = this.key.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  async prove(claim: Claim, privateOk: boolean, _witness?: PrivateWitness): Promise<Proof> {
    if (!privateOk) throw new Error('Predicate is false: refusing to produce a proof');
    const attestation = crypto.sign(null, claimBytes(claim), this.key.privateKey).toString('hex');
    return {
      claim,
      backend: this.name,
      evidence: 'simulation-attestation',
      zk: false,
      attestation,
      signerPublicKey: this.publicKey,
      createdAt: Date.now(),
    };
  }
  async verify(p: Proof): Promise<boolean> {
    if (!wellFormedProof(p) || p.evidence !== 'simulation-attestation') return false;
    if (p.backend !== this.name || p.signerPublicKey !== this.publicKey) return false;
    const pub = crypto.createPublicKey({
      key: Buffer.from(p.signerPublicKey, 'hex'),
      format: 'der',
      type: 'spki',
    });
    try {
      return crypto.verify(null, claimBytes(p.claim), pub, Buffer.from(p.attestation, 'hex'));
    } catch {
      return false;
    }
  }
}

export class MidnightBackend implements ProofBackend {
  name = 'midnight' as const;
  readonly opts: MidnightBackendOpts;
  private key = crypto.generateKeyPairSync('ed25519');
  readonly publicKey = this.key.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  private bridgePromise: Promise<MidnightBridge> | null = null;

  constructor(opts?: MidnightBackendOpts) {
    // Default (no-arg) constructor reads Blockfrost from env. Explicit `{}` leaves it missing
    // so unit tests and callers can require an intentional token.
    const base: MidnightBackendOpts =
      opts === undefined
        ? {
            blockfrostProjectId: process.env.BLOCKFROST_MIDNIGHT_PREPROD,
            walletSeedFile: 'midnight/.wallets.preprod.json',
          }
        : opts;
    this.opts = {
      ...base,
      mode: base.mode ?? 'local-circuits',
      proofServer: base.proofServer ?? process.env.MIDNIGHT_PROOF_SERVER ?? 'http://localhost:6300',
      blockfrostProjectId: base.blockfrostProjectId,
    };
  }

  private requireConfig(): void {
    if (!this.opts.blockfrostProjectId) {
      throw new Error(
        'MidnightBackend not available: missing blockfrostProjectId (free Blockfrost Midnight Preprod project, starts with "nightpreprod"). Proof server expected at ' +
          (this.opts.proofServer ?? 'http://localhost:6300') +
          '.'
      );
    }
  }

  private async getBridge(): Promise<MidnightBridge> {
    if (this.opts.bridge) return this.opts.bridge;
    if (!this.bridgePromise) {
      this.bridgePromise = (async () => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const candidates = [
          path.join(here, '..', 'midnight', 'sdk-bridge.mjs'),
          path.join(process.cwd(), 'midnight', 'sdk-bridge.mjs'),
        ];
        let lastErr: unknown;
        for (const p of candidates) {
          try {
            return (await import(pathToFileURL(p).href)) as MidnightBridge;
          } catch (e) {
            lastErr = e;
          }
        }
        throw new Error(
          `MidnightBackend: could not load midnight/sdk-bridge.mjs (install midnight deps with: cd midnight && npm ci). ${
            lastErr instanceof Error ? lastErr.message : String(lastErr)
          }`
        );
      })();
    }
    return this.bridgePromise;
  }

  private templateFor(claim: Claim): 'condition' | 'age_over' | 'balance_above' {
    if (claim.kind === 'condition') return 'condition';
    if (claim.kind === 'ageOver') return 'age_over';
    return 'balance_above';
  }

  private buildWitness(claim: Claim, witness?: PrivateWitness): {
    publicInputs: Record<string, unknown>;
    witness: Record<string, unknown>;
  } {
    if (claim.kind === 'condition') {
      if (!witness || witness.kind !== 'condition') {
        throw new Error(
          'MidnightBackend.prove(condition) needs PrivateWitness { kind:"condition", secret }'
        );
      }
      return {
        publicInputs: {},
        witness: { secret: witness.secret, deliveryOk: witness.deliveryOk !== false },
      };
    }
    if (claim.kind === 'ageOver') {
      if (!witness || witness.kind !== 'ageOver') {
        throw new Error(
          'MidnightBackend.prove(ageOver) needs PrivateWitness { kind:"ageOver", birthYear, salt }'
        );
      }
      return {
        publicInputs: { minAge: claim.minAge, asOfYear: claim.asOfYear },
        witness: { birthYear: witness.birthYear, salt: witness.salt },
      };
    }
    if (!witness || witness.kind !== 'balanceAbove') {
      throw new Error(
        'MidnightBackend.prove(balanceAbove) needs PrivateWitness { kind:"balanceAbove", balance, salt }'
      );
    }
    return {
      publicInputs: { threshold: claim.threshold },
      witness: { balance: witness.balance, salt: witness.salt },
    };
  }

  private signAttestation(body: Omit<MidnightAttestation, 'sig'>): string {
    const payload = Buffer.from(canonicalJson(body));
    const sig = crypto.sign(null, payload, this.key.privateKey).toString('hex');
    const full: MidnightAttestation = { ...body, sig };
    return Buffer.from(JSON.stringify(full)).toString('base64url');
  }

  private parseAttestation(attestation: string): MidnightAttestation | null {
    if (typeof attestation !== 'string' || attestation.length > MAX_ATTESTATION_BYTES) return null;
    try {
      return JSON.parse(Buffer.from(attestation, 'base64url').toString('utf8')) as MidnightAttestation;
    } catch {
      return null;
    }
  }

  async prove(claim: Claim, privateOk: boolean, witness?: PrivateWitness): Promise<Proof> {
    this.requireConfig();
    if (!privateOk) throw new Error('Predicate is false: refusing to produce a proof');
    const bridge = await this.getBridge();
    const template = this.templateFor(claim);
    const built = this.buildWitness(claim, witness);
    const result = await bridge.proveLocal({
      template,
      publicInputs: built.publicInputs,
      witness: built.witness,
      managedRoot: this.opts.managedRoot ?? bridge.defaultManagedRoot,
    });

    let contractAddress: string | undefined;
    if (this.opts.mode === 'preprod' && bridge.loadDeployments) {
      const dep = bridge.loadDeployments(
        this.opts.deploymentsPath ?? bridge.defaultDeploymentsPath
      );
      contractAddress = dep?.deployments?.[template]?.contractAddress;
    }

    // Prefer Compact persistentHash commitment in the returned claim (not the SHA-256 helper commit).
    const outClaim: Claim =
      claim.kind === 'condition'
        ? { kind: 'condition', commitment: result.commitmentHex }
        : claim.kind === 'ageOver'
          ? {
              kind: 'ageOver',
              minAge: claim.minAge,
              asOfYear: claim.asOfYear,
              commitment: result.commitmentHex,
            }
          : {
              kind: 'balanceAbove',
              threshold: claim.threshold,
              commitment: result.commitmentHex,
            };

    if (!claimMatchesLedger(outClaim, result.template, result.ledger)) {
      throw new Error('MidnightBackend.prove: circuit ledger does not match the requested claim; refusing to attest');
    }
    const attestation = this.signAttestation({
      v: 2,
      evidence: 'local-circuit-evaluation',
      claim: outClaim,
      mode: this.opts.mode ?? 'local-circuits',
      template: result.template,
      circuit: result.circuit,
      transcriptHex: result.transcriptHex,
      ledger: result.ledger,
      contractAddress,
    });

    return {
      claim: outClaim,
      backend: this.name,
      // Local compact-runtime execution: constraints checked, no ZK proof produced (CZ-001).
      evidence: 'local-circuit-evaluation',
      zk: false,
      attestation,
      signerPublicKey: this.publicKey,
      createdAt: Date.now(),
    };
  }

  /** Signature, evidence label and claim checks only (no chain). Returns the attestation or null. */
  private checkSignedProof(proof: Proof): MidnightAttestation | null {
    if (!wellFormedProof(proof)) return null;
    if (proof.backend !== this.name || proof.signerPublicKey !== this.publicKey) return null;
    const att = this.parseAttestation(proof.attestation);
    if (!att || att.v !== 2 || !att.sig || !att.transcriptHex || !att.claim) return null;
    // CZ-003a: the outer claim must be exactly the signed claim, and agree with the signed ledger.
    if (canonicalJson(att.claim) !== canonicalJson(proof.claim)) return null;
    if (!claimMatchesLedger(att.claim, att.template, att.ledger)) return null;
    // The evidence kind is signed; the outer label must match it.
    if (att.evidence !== proof.evidence) return null;
    if (att.evidence !== 'local-circuit-evaluation' && att.evidence !== 'chain-transaction-reported') return null;
    const { sig, ...body } = att;
    const pub = crypto.createPublicKey({
      key: Buffer.from(proof.signerPublicKey, 'hex'),
      format: 'der',
      type: 'spki',
    });
    try {
      if (!crypto.verify(null, Buffer.from(canonicalJson(body)), pub, Buffer.from(sig, 'hex'))) {
        return null;
      }
    } catch {
      return null;
    }
    // Ledger flag must show success for the template.
    if (att.template === 'condition' && att.ledger?.released !== true) return null;
    if (att.template !== 'condition' && att.ledger?.proven !== true) return null;
    return att;
  }

  async verify(proof: Proof): Promise<boolean> {
    this.requireConfig();
    const att = this.checkSignedProof(proof);
    if (!att) return false;
    // Preprod: the chain check is required and fails closed (CZ-002). A missing address,
    // missing verifier, missing state or any indexer error means "not verified".
    // For typed outcomes (unavailable vs rejected) use verifyStrict().
    if (this.opts.mode === 'preprod' || att.mode === 'preprod') {
      if (!att.contractAddress) return false;
      try {
        const bridge = await this.getBridge();
        if (!bridge.verifyOnChainLedger) return false;
        {
          const cfg = preprodConfig({
            BLOCKFROST_MIDNIGHT_PREPROD: this.opts.blockfrostProjectId,
            MIDNIGHT_PROOF_SERVER: this.opts.proofServer,
          });
          const onchain = await bridge.verifyOnChainLedger({
            template: att.template,
            contractAddress: att.contractAddress,
            indexerHttpUrl: cfg.indexerHttpUrl,
            indexerWsUrl: cfg.indexerWsUrl,
            managedRoot: this.opts.managedRoot ?? bridge.defaultManagedRoot,
          });
          if (!onchain.found || !onchain.ok) return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * Strict verification against trusted policy configuration (CZ-002).
   * Reads the expected contract from the indexer, checks network, template, deployed circuit
   * verifier keys against the local compiled artifacts, the public parameters and the success
   * flag. Returns a typed outcome; only `verified` carries `verified-chain-evidence`.
   * Trust model: the indexer is trusted to report current chain state; this is not a light
   * client and does not check finality beyond what the indexer reports.
   */
  async verifyStrict(proof: Proof | null, expected: ExpectedChainPolicy): Promise<VerificationOutcome> {
    const out = (status: VerificationStatus, reason: string): VerificationOutcome => ({ status, reason });
    if (!this.opts.blockfrostProjectId) return out('unavailable', 'not-configured');
    if (!expected || !expected.contractAddress || !expected.template || !SUCCESS_FLAGS[expected.template]) {
      return out('rejected', 'policy-incomplete');
    }
    if (expected.network !== 'preprod') return out('rejected', 'network-mismatch');
    if (proof) {
      if (!wellFormedProof(proof)) return out('rejected', 'malformed-proof');
      if (proof.evidence === 'simulation-attestation') return out('rejected', 'simulation-evidence-not-accepted');
      const att = this.checkSignedProof(proof);
      if (!att) return out('rejected', 'bad-attestation');
      if (att.template !== expected.template) return out('rejected', 'template-mismatch');
      if (att.contractAddress && att.contractAddress !== expected.contractAddress) return out('rejected', 'contract-mismatch');
      if (expected.maxEvidenceAgeMs != null && Date.now() - proof.createdAt > expected.maxEvidenceAgeMs) {
        return out('expired', 'evidence-too-old');
      }
    }
    let bridge: MidnightBridge;
    try {
      bridge = await this.getBridge();
    } catch {
      return out('unavailable', 'bridge-unavailable');
    }
    if (!bridge.readContractEvidence) return out('unavailable', 'no-chain-reader');
    let chain: Awaited<ReturnType<NonNullable<MidnightBridge['readContractEvidence']>>>;
    try {
      const cfg = preprodConfig({
        BLOCKFROST_MIDNIGHT_PREPROD: this.opts.blockfrostProjectId,
        MIDNIGHT_PROOF_SERVER: this.opts.proofServer,
      });
      chain = await withTimeout(
        bridge.readContractEvidence({
          template: expected.template,
          contractAddress: expected.contractAddress,
          indexerHttpUrl: cfg.indexerHttpUrl,
          indexerWsUrl: cfg.indexerWsUrl,
          managedRoot: this.opts.managedRoot ?? bridge.defaultManagedRoot,
        }),
        expected.timeoutMs ?? 20_000
      );
    } catch (e) {
      return out('unavailable', e instanceof Error && e.message === 'timeout' ? 'indexer-timeout' : 'indexer-error');
    }
    if (!chain || !chain.found || !chain.ledger) return out('unavailable', 'contract-not-found');
    if (chain.artifactMatch === false) return out('rejected', 'artifact-mismatch');
    if (chain.artifactMatch !== true) return out('unavailable', 'artifact-unverifiable');
    for (const [key, want] of Object.entries(expected.publicParams ?? {})) {
      if (String(chain.ledger[key]) !== String(want)) return out('rejected', `public-param-mismatch:${key}`);
    }
    if (!SUCCESS_FLAGS[expected.template](chain.ledger)) return out('pending', 'predicate-not-proven-on-chain');
    return {
      status: 'verified',
      reason: 'ok',
      evidence: {
        kind: 'verified-chain-evidence',
        network: expected.network,
        template: expected.template,
        contractAddress: expected.contractAddress,
        ledger: chain.ledger,
        checkedAt: Date.now(),
      },
    };
  }

  /**
   * Submit a new on-chain Midnight Preprod callTx (attest or prove) against an already-deployed
   * contract. Callers pass private witnesses; nothing is persisted by the SDK.
   * Requires BLOCKFROST / blockfrostProjectId, a reachable proof server, a synced funded wallet
   * with DUST, and a contract address (from deployments.preprod.json or opts).
   * Does not redeploy and does not wait for DUST registration — fails fast with a clear error.
   */
  async submitOnChain(o: {
    claim: Claim;
    witness: PrivateWitness;
    contractAddress?: string;
    walletName?: string;
    syncTimeoutMs?: number;
  }): Promise<OnChainSubmitResult & { proof: Proof }> {
    this.requireConfig();
    if (!o?.claim) throw new Error('submitOnChain: claim is required');
    if (!o?.witness) throw new Error('submitOnChain: witness is required (caller-supplied; not stored)');
    const bridge = await this.getBridge();
    if (!bridge.submitCallTx) {
      throw new Error(
        'submitOnChain: bridge.submitCallTx is missing. Use the stock midnight/sdk-bridge.mjs or inject a bridge that implements submitCallTx.'
      );
    }
    const template = this.templateFor(o.claim);
    const built = this.buildWitness(o.claim, o.witness);
    let contractAddress = o.contractAddress;
    if (!contractAddress && bridge.loadDeployments) {
      const dep = bridge.loadDeployments(
        this.opts.deploymentsPath ?? bridge.defaultDeploymentsPath
      );
      contractAddress = dep?.deployments?.[template]?.contractAddress;
    }
    if (!contractAddress) {
      throw new Error(
        `submitOnChain: no contractAddress for template "${template}". Pass contractAddress or ensure midnight/deployments.preprod.json has deployments.${template}.contractAddress.`
      );
    }
    const submitted = await bridge.submitCallTx({
      template,
      contractAddress,
      witness: built.witness,
      managedRoot: this.opts.managedRoot ?? bridge.defaultManagedRoot,
      walletName: o.walletName ?? this.opts.walletName ?? 'deployer',
      syncTimeoutMs: o.syncTimeoutMs ?? this.opts.syncTimeoutMs,
    });
    // Also produce a local circuit proof attestation that references the on-chain tx.
    const local = await this.prove(o.claim, true, o.witness);
    const att = this.parseAttestation(local.attestation);
    if (att) {
      const { sig: _s, ...body } = att;
      const enriched = this.signAttestation({
        ...body,
        evidence: 'chain-transaction-reported',
        mode: 'preprod',
        contractAddress: submitted.contractAddress,
        onChainTxHash: submitted.txHash,
        onChainTxId: submitted.txId,
      });
      local.attestation = enriched;
      local.evidence = 'chain-transaction-reported';
      local.zk = false;
    }
    return { ...submitted, proof: local };
  }

  /**
   * Deploy a fresh eligibility contract on Midnight Preprod.
   * Pass the preimage commitment and escrow binding, not the preimage.
   * The in-process wallet stays open for callEligibility until closeEligibilitySession.
   */
  async deployEligibility(o: {
    issuer: { publicKey: { x: bigint; y: bigint } };
    credentialType: string;
    asOf: bigint | number | string;
    preimageCommit: Uint8Array;
    escrow: { owner: string | Uint8Array; offerSequence: number | bigint; destination: string | Uint8Array };
    witness?: Record<string, unknown>;
    walletName?: string;
    syncTimeoutMs?: number;
  }): Promise<OnChainSubmitResult> {
    this.requireConfig();
    const bridge = await this.getBridge();
    if (!bridge.deployEligibility) {
      throw new Error(
        'deployEligibility: bridge.deployEligibility is missing. Use midnight/sdk-bridge.mjs.'
      );
    }
    return bridge.deployEligibility({
      ...o,
      walletName: o.walletName ?? this.opts.walletName ?? 'deployer',
      syncTimeoutMs: o.syncTimeoutMs ?? this.opts.syncTimeoutMs,
      managedRoot: this.opts.managedRoot ?? bridge.defaultManagedRoot,
    });
  }

  /** Post eligibility prove() or reveal() on Preprod. Witnesses are caller-supplied and not stored. */
  async callEligibility(o: {
    circuit: 'prove' | 'reveal';
    contractAddress: string;
    witness: Record<string, unknown>;
    walletName?: string;
    syncTimeoutMs?: number;
  }): Promise<OnChainSubmitResult> {
    this.requireConfig();
    if (o?.circuit !== 'prove' && o?.circuit !== 'reveal') {
      throw new Error('callEligibility: circuit must be "prove" or "reveal"');
    }
    const bridge = await this.getBridge();
    if (!bridge.callEligibility) {
      throw new Error('callEligibility: bridge.callEligibility is missing. Use midnight/sdk-bridge.mjs.');
    }
    return bridge.callEligibility({
      ...o,
      walletName: o.walletName ?? this.opts.walletName ?? 'deployer',
      syncTimeoutMs: o.syncTimeoutMs ?? this.opts.syncTimeoutMs,
      managedRoot: this.opts.managedRoot ?? bridge.defaultManagedRoot,
    });
  }

  /**
   * Read the eligibility ledger from the Preprod indexer.
   * `revealedPreimage` is set only after reveal() is in the indexed state.
   */
  async readEligibilityState(o: { contractAddress: string; waitMs?: number }): Promise<{
    found: boolean;
    proven: boolean;
    preimageRevealed: boolean;
    revealedPreimage: Uint8Array | null;
    ledger: Record<string, unknown> | null;
    rawLedger: Record<string, unknown> | null;
  }> {
    this.requireConfig();
    if (!o?.contractAddress) throw new Error('readEligibilityState: contractAddress is required');
    const bridge = await this.getBridge();
    if (!bridge.readEligibilityState) {
      throw new Error('readEligibilityState: bridge.readEligibilityState is missing. Use midnight/sdk-bridge.mjs.');
    }
    const cfg = preprodConfig({
      BLOCKFROST_MIDNIGHT_PREPROD: this.opts.blockfrostProjectId,
      MIDNIGHT_PROOF_SERVER: this.opts.proofServer,
    });
    return bridge.readEligibilityState({
      contractAddress: o.contractAddress,
      waitMs: o.waitMs,
      indexerHttpUrl: cfg.indexerHttpUrl,
      indexerWsUrl: cfg.indexerWsUrl,
      managedRoot: this.opts.managedRoot ?? bridge.defaultManagedRoot,
    });
  }

  /** Artifact id of the locally compiled circuits for a template (IntentV2.circuitArtifactId). */
  async circuitArtifactId(template: string): Promise<string> {
    const bridge = await this.getBridge();
    if (!bridge.circuitArtifactId) throw new Error('circuitArtifactId: bridge does not provide it');
    return bridge.circuitArtifactId(template, this.opts.managedRoot ?? bridge.defaultManagedRoot);
  }

  async closeEligibilitySession(contractAddress: string): Promise<void> {
    const bridge = await this.getBridge();
    if (bridge.closeEligibilitySession) await bridge.closeEligibilitySession(contractAddress);
  }
}

// ---------- Proof helpers ----------
export async function proveCondition(
  b: ProofBackend,
  secret: string,
  salt: string,
  commitment: string
) {
  const witness: PrivateWitness = { kind: 'condition', secret, deliveryOk: true };
  return b.prove(
    { kind: 'condition', commitment },
    commit(secret, salt) === commitment,
    witness
  );
}
export async function proveBalanceAbove(
  b: ProofBackend,
  balance: number,
  threshold: number,
  salt: string
) {
  const witness: PrivateWitness = { kind: 'balanceAbove', balance, salt };
  return b.prove(
    { kind: 'balanceAbove', threshold, commitment: commit(balance, salt) },
    balance > threshold,
    witness
  );
}
export async function proveAgeOver(
  b: ProofBackend,
  birthYear: number,
  minAge: number,
  asOfYear: number,
  salt: string
) {
  const witness: PrivateWitness = { kind: 'ageOver', birthYear, salt };
  return b.prove(
    { kind: 'ageOver', minAge, asOfYear, commitment: commit(birthYear, salt) },
    asOfYear - birthYear >= minAge,
    witness
  );
}

// ---------- XRPL escrow (non-custodial) ----------
/** Fee string from an xrpl.js submitAndWait result, in drops. Null when the receipt omits it. */
export function feeDropsFromXrplResult(result: unknown): string | null {
  const root = (result as { result?: { Fee?: unknown; tx_json?: { Fee?: unknown } }; Fee?: unknown; tx_json?: { Fee?: unknown } })
    ?.result ?? (result as { Fee?: unknown; tx_json?: { Fee?: unknown } });
  const drops = root?.Fee ?? root?.tx_json?.Fee ?? null;
  return drops == null ? null : String(drops);
}

/** paidFees / estimatedFees from a Midnight finalization receipt. Null fields mean the receipt omitted them. */
export function feesFromMidnightReceipt(pub: { fees?: { paidFees?: unknown; estimatedFees?: unknown } } | null | undefined): {
  paidFees: string | null;
  estimatedFees: string | null;
} {
  const fees = pub?.fees;
  return {
    paidFees: fees?.paidFees != null ? String(fees.paidFees) : null,
    estimatedFees: fees?.estimatedFees != null ? String(fees.estimatedFees) : null,
  };
}

/** PREIMAGE-SHA-256 condition. The caller receives the fulfillment immediately.
 *  This function does not bind that fulfillment to a Midnight proof.
 *  The bound path is midnight/eligibility.mjs (see README "Security model").
 */
export function createCryptoCondition() {
  return preimageSha256(crypto.randomBytes(32));
}

export async function createEscrow(
  client: xrpl.Client,
  payer: xrpl.Wallet,
  o: { destination: string; amountXrp: string; condition: string; cancelAfterSec?: number }
) {
  const now = xrpl.isoTimeToRippleTime(new Date().toISOString());
  const r = await client.submitAndWait(
    {
      TransactionType: 'EscrowCreate',
      Account: payer.address,
      Destination: o.destination,
      Amount: xrpl.xrpToDrops(o.amountXrp),
      Condition: o.condition,
      CancelAfter: now + (o.cancelAfterSec ?? 86400),
    },
    { wallet: payer }
  );
  const meta = r.result.meta as { TransactionResult: string };
  const seq = (r.result as any).tx_json?.Sequence ?? (r.result as any).Sequence;
  return {
    hash: r.result.hash,
    result: meta.TransactionResult,
    owner: payer.address,
    offerSequence: seq as number,
    feeDrops: feeDropsFromXrplResult(r),
  };
}

/**
 * DEMO ONLY (unsafe for real value). Application-gated release: checks a generic proof with the
 * caller's backend, then submits a caller-supplied fulfillment. It is not bound to any intent,
 * escrow, issuer or policy (CZ-003) and anyone holding the fulfillment can finish anyway (CZ-004).
 * Kept so the recorded demo keeps working. For real flows use `releaseStrict`.
 * @deprecated Use releaseStrict (src/strict-release.ts).
 */
export async function verifyAndReleaseEscrow(
  client: xrpl.Client,
  submitter: xrpl.Wallet,
  o: {
    backend: ProofBackend;
    proof: Proof;
    owner: string;
    offerSequence: number;
    condition: string;
    fulfillment: string;
  }
) {
  if (!(await o.backend.verify(o.proof))) return { released: false as const, reason: 'proof rejected' };
  const r = await client.submitAndWait(
    {
      TransactionType: 'EscrowFinish',
      Account: submitter.address,
      Owner: o.owner,
      OfferSequence: o.offerSequence,
      Condition: o.condition,
      Fulfillment: o.fulfillment,
    },
    { wallet: submitter }
  );
  const res = (r.result.meta as { TransactionResult: string }).TransactionResult;
  return { released: res === 'tesSUCCESS', reason: res, hash: r.result.hash, feeDrops: feeDropsFromXrplResult(r) };
}

/** Explicitly named alias of the demo-only release API. */
export const unsafeDemoVerifyAndReleaseEscrow = verifyAndReleaseEscrow;

export const XRPL_TESTNET_WSS = 'wss://testnet.xrpl-labs.com';
export const explorerTx = (h: string) => `https://testnet.xrpl.org/transactions/${h}`;
export * from './midnight-config.js';
export * from './intent.js';
export * from './registry.js';
export * from './strict-release.js';
export * from './crypto-condition.js';
