/**
 * CorvusZK — non-custodial SDK.
 * - Never holds user funds: XRP sits in a native XRPL escrow owned by the payer's own wallet.
 * - Never stores keys or fulfillments: callers pass them in; nothing is persisted.
 * Proof backends:
 *   LocalSimulationBackend — NOT zero-knowledge. A local prover checks the private predicate and
 *     signs an Ed25519 attestation. For dev/testing only; clearly labeled in every proof.
 *   MidnightBackend — real Compact circuits (condition / age_over / balance_above). Default mode
 *     `local-circuits` runs the same compiled circuits as midnight/simulate.mjs (no wallet sync).
 *     `preprod` attaches live Preprod contract addresses from deployments.preprod.json and can
 *     verify ledger flags via the indexer. `submitOnChain` posts a new callTx (attest/prove) via
 *     midnight/sdk-bridge.mjs using the existing wallet helpers (bounded sync; no redeploy).
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as xrpl from 'xrpl';
import cc from 'five-bells-condition';
import { preprodConfig } from './midnight-config.js';
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
/** Hiding commitment to a private value: sha256(salt || value). */
export function commit(value, salt) {
    return sha256(`${salt}|${value}`);
}
const claimBytes = (c) => Buffer.from(JSON.stringify(c));
export class LocalSimulationBackend {
    name = 'local-simulation';
    key = crypto.generateKeyPairSync('ed25519');
    publicKey = this.key.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
    async prove(claim, privateOk, _witness) {
        if (!privateOk)
            throw new Error('Predicate is false: refusing to produce a proof');
        const attestation = crypto.sign(null, claimBytes(claim), this.key.privateKey).toString('hex');
        return {
            claim,
            backend: this.name,
            zk: false,
            attestation,
            signerPublicKey: this.publicKey,
            createdAt: Date.now(),
        };
    }
    async verify(p) {
        if (p.backend !== this.name || p.signerPublicKey !== this.publicKey)
            return false;
        const pub = crypto.createPublicKey({
            key: Buffer.from(p.signerPublicKey, 'hex'),
            format: 'der',
            type: 'spki',
        });
        try {
            return crypto.verify(null, claimBytes(p.claim), pub, Buffer.from(p.attestation, 'hex'));
        }
        catch {
            return false;
        }
    }
}
export class MidnightBackend {
    name = 'midnight';
    opts;
    key = crypto.generateKeyPairSync('ed25519');
    publicKey = this.key.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
    bridgePromise = null;
    constructor(opts) {
        // Default (no-arg) constructor reads Blockfrost from env. Explicit `{}` leaves it missing
        // so unit tests and callers can require an intentional token.
        const base = opts === undefined
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
    requireConfig() {
        if (!this.opts.blockfrostProjectId) {
            throw new Error('MidnightBackend not available: missing blockfrostProjectId (free Blockfrost Midnight Preprod project, starts with "nightpreprod"). Proof server expected at ' +
                (this.opts.proofServer ?? 'http://localhost:6300') +
                '.');
        }
    }
    async getBridge() {
        if (this.opts.bridge)
            return this.opts.bridge;
        if (!this.bridgePromise) {
            this.bridgePromise = (async () => {
                const here = path.dirname(fileURLToPath(import.meta.url));
                const candidates = [
                    path.join(here, '..', 'midnight', 'sdk-bridge.mjs'),
                    path.join(process.cwd(), 'midnight', 'sdk-bridge.mjs'),
                ];
                let lastErr;
                for (const p of candidates) {
                    try {
                        return (await import(pathToFileURL(p).href));
                    }
                    catch (e) {
                        lastErr = e;
                    }
                }
                throw new Error(`MidnightBackend: could not load midnight/sdk-bridge.mjs (install midnight deps with: cd midnight && npm ci). ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
            })();
        }
        return this.bridgePromise;
    }
    templateFor(claim) {
        if (claim.kind === 'condition')
            return 'condition';
        if (claim.kind === 'ageOver')
            return 'age_over';
        return 'balance_above';
    }
    buildWitness(claim, witness) {
        if (claim.kind === 'condition') {
            if (!witness || witness.kind !== 'condition') {
                throw new Error('MidnightBackend.prove(condition) needs PrivateWitness { kind:"condition", secret }');
            }
            return {
                publicInputs: {},
                witness: { secret: witness.secret, deliveryOk: witness.deliveryOk !== false },
            };
        }
        if (claim.kind === 'ageOver') {
            if (!witness || witness.kind !== 'ageOver') {
                throw new Error('MidnightBackend.prove(ageOver) needs PrivateWitness { kind:"ageOver", birthYear, salt }');
            }
            return {
                publicInputs: { minAge: claim.minAge, asOfYear: claim.asOfYear },
                witness: { birthYear: witness.birthYear, salt: witness.salt },
            };
        }
        if (!witness || witness.kind !== 'balanceAbove') {
            throw new Error('MidnightBackend.prove(balanceAbove) needs PrivateWitness { kind:"balanceAbove", balance, salt }');
        }
        return {
            publicInputs: { threshold: claim.threshold },
            witness: { balance: witness.balance, salt: witness.salt },
        };
    }
    signAttestation(body) {
        const payload = Buffer.from(JSON.stringify(body));
        const sig = crypto.sign(null, payload, this.key.privateKey).toString('hex');
        const full = { ...body, sig };
        return Buffer.from(JSON.stringify(full)).toString('base64url');
    }
    parseAttestation(attestation) {
        try {
            return JSON.parse(Buffer.from(attestation, 'base64url').toString('utf8'));
        }
        catch {
            return null;
        }
    }
    async prove(claim, privateOk, witness) {
        this.requireConfig();
        if (!privateOk)
            throw new Error('Predicate is false: refusing to produce a proof');
        const bridge = await this.getBridge();
        const template = this.templateFor(claim);
        const built = this.buildWitness(claim, witness);
        const result = await bridge.proveLocal({
            template,
            publicInputs: built.publicInputs,
            witness: built.witness,
            managedRoot: this.opts.managedRoot ?? bridge.defaultManagedRoot,
        });
        let contractAddress;
        if (this.opts.mode === 'preprod' && bridge.loadDeployments) {
            const dep = bridge.loadDeployments(this.opts.deploymentsPath ?? bridge.defaultDeploymentsPath);
            contractAddress = dep?.deployments?.[template]?.contractAddress;
        }
        // Prefer Compact persistentHash commitment in the returned claim (not the SHA-256 helper commit).
        const outClaim = claim.kind === 'condition'
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
        const attestation = this.signAttestation({
            v: 1,
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
            zk: true,
            attestation,
            signerPublicKey: this.publicKey,
            createdAt: Date.now(),
        };
    }
    async verify(proof) {
        this.requireConfig();
        if (proof.backend !== this.name || proof.signerPublicKey !== this.publicKey)
            return false;
        const att = this.parseAttestation(proof.attestation);
        if (!att || att.v !== 1 || !att.sig || !att.transcriptHex)
            return false;
        const { sig, ...body } = att;
        const pub = crypto.createPublicKey({
            key: Buffer.from(proof.signerPublicKey, 'hex'),
            format: 'der',
            type: 'spki',
        });
        try {
            if (!crypto.verify(null, Buffer.from(JSON.stringify(body)), pub, Buffer.from(sig, 'hex'))) {
                return false;
            }
        }
        catch {
            return false;
        }
        // Ledger flag must show success for the template.
        if (att.template === 'condition' && att.ledger?.released !== true)
            return false;
        if (att.template !== 'condition' && att.ledger?.proven !== true)
            return false;
        // Optional Preprod indexer check when mode is preprod and a contract address is present.
        if ((this.opts.mode === 'preprod' || att.mode === 'preprod') && att.contractAddress) {
            try {
                const bridge = await this.getBridge();
                if (bridge.verifyOnChainLedger) {
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
                    if (onchain.found && !onchain.ok)
                        return false;
                }
            }
            catch {
                // Indexer optional: local signature + ledger snapshot still count when chain is unreachable.
            }
        }
        return true;
    }
    /**
     * Submit a new on-chain Midnight Preprod callTx (attest or prove) against an already-deployed
     * contract. Callers pass private witnesses; nothing is persisted by the SDK.
     * Requires BLOCKFROST / blockfrostProjectId, a reachable proof server, a synced funded wallet
     * with DUST, and a contract address (from deployments.preprod.json or opts).
     * Does not redeploy and does not wait for DUST registration — fails fast with a clear error.
     */
    async submitOnChain(o) {
        this.requireConfig();
        if (!o?.claim)
            throw new Error('submitOnChain: claim is required');
        if (!o?.witness)
            throw new Error('submitOnChain: witness is required (caller-supplied; not stored)');
        const bridge = await this.getBridge();
        if (!bridge.submitCallTx) {
            throw new Error('submitOnChain: bridge.submitCallTx is missing. Use the stock midnight/sdk-bridge.mjs or inject a bridge that implements submitCallTx.');
        }
        const template = this.templateFor(o.claim);
        const built = this.buildWitness(o.claim, o.witness);
        let contractAddress = o.contractAddress;
        if (!contractAddress && bridge.loadDeployments) {
            const dep = bridge.loadDeployments(this.opts.deploymentsPath ?? bridge.defaultDeploymentsPath);
            contractAddress = dep?.deployments?.[template]?.contractAddress;
        }
        if (!contractAddress) {
            throw new Error(`submitOnChain: no contractAddress for template "${template}". Pass contractAddress or ensure midnight/deployments.preprod.json has deployments.${template}.contractAddress.`);
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
                mode: 'preprod',
                contractAddress: submitted.contractAddress,
                onChainTxHash: submitted.txHash,
                onChainTxId: submitted.txId,
            });
            local.attestation = enriched;
        }
        return { ...submitted, proof: local };
    }
}
// ---------- Proof helpers ----------
export async function proveCondition(b, secret, salt, commitment) {
    const witness = { kind: 'condition', secret, deliveryOk: true };
    return b.prove({ kind: 'condition', commitment }, commit(secret, salt) === commitment, witness);
}
export async function proveBalanceAbove(b, balance, threshold, salt) {
    const witness = { kind: 'balanceAbove', balance, salt };
    return b.prove({ kind: 'balanceAbove', threshold, commitment: commit(balance, salt) }, balance > threshold, witness);
}
export async function proveAgeOver(b, birthYear, minAge, asOfYear, salt) {
    const witness = { kind: 'ageOver', birthYear, salt };
    return b.prove({ kind: 'ageOver', minAge, asOfYear, commitment: commit(birthYear, salt) }, asOfYear - birthYear >= minAge, witness);
}
// ---------- XRPL escrow (non-custodial) ----------
export function createCryptoCondition() {
    const preimage = crypto.randomBytes(32);
    const f = new cc.PreimageSha256();
    f.setPreimage(preimage);
    return {
        condition: f.getConditionBinary().toString('hex').toUpperCase(),
        fulfillment: f.serializeBinary().toString('hex').toUpperCase(),
    };
}
export async function createEscrow(client, payer, o) {
    const now = xrpl.isoTimeToRippleTime(new Date().toISOString());
    const r = await client.submitAndWait({
        TransactionType: 'EscrowCreate',
        Account: payer.address,
        Destination: o.destination,
        Amount: xrpl.xrpToDrops(o.amountXrp),
        Condition: o.condition,
        CancelAfter: now + (o.cancelAfterSec ?? 86400),
    }, { wallet: payer });
    const meta = r.result.meta;
    const seq = r.result.tx_json?.Sequence ?? r.result.Sequence;
    return { hash: r.result.hash, result: meta.TransactionResult, owner: payer.address, offerSequence: seq };
}
/** Verifies the proof first; only then submits EscrowFinish. Funds can only go to the escrow's fixed Destination. */
export async function verifyAndReleaseEscrow(client, submitter, o) {
    if (!(await o.backend.verify(o.proof)))
        return { released: false, reason: 'proof rejected' };
    const r = await client.submitAndWait({
        TransactionType: 'EscrowFinish',
        Account: submitter.address,
        Owner: o.owner,
        OfferSequence: o.offerSequence,
        Condition: o.condition,
        Fulfillment: o.fulfillment,
    }, { wallet: submitter });
    const res = r.result.meta.TransactionResult;
    return { released: res === 'tesSUCCESS', reason: res, hash: r.result.hash };
}
export const XRPL_TESTNET_WSS = 'wss://testnet.xrpl-labs.com';
export const explorerTx = (h) => `https://testnet.xrpl.org/transactions/${h}`;
export * from './midnight-config.js';
