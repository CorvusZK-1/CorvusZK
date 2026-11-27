/**
 * Strict release for the eligibility_v2 path (CZ-003, CZ-008; ADR-001 mode A, ADR-002).
 *
 * The caller is the trusted policy party. Funds move only if ALL of these hold:
 *  - the intent is well formed, registered, unexpired and bound to exactly this contract;
 *  - strict Midnight verification (verifyStrict) of that contract returns `verified`, with the
 *    deployed circuits matching the local artifacts and the public state matching the intent
 *    (intentHash, issuer, credential type, asOf, owner, sequence, destination), proven + revealed;
 *  - the revealed preimage opens the intent's condition;
 *  - the credential nullifier has not authorized a different intent;
 *  - the validated XRPL escrow object matches the intent (network, owner, destination, amount,
 *    condition, time bounds, destination tag) and is inside its finish window.
 * Retries are idempotent: a settled intent is never submitted again. XRPL consumes an escrow
 * once, so a duplicate EscrowFinish cannot pay twice; an unknown outcome returns `reconcile`.
 */
import cc from 'five-bells-condition';
import * as xrpl from 'xrpl';
import { normalizeIntentV2, intentHashV2 } from './intent.js';
import { RegistryConflict } from './registry.js';
export const STRICT_TEMPLATES = ['eligibility_v2', 'eligibility_v3'];
/** ADR-001: the only supported product mode. */
export const TRUST_MODE = 'trusted-policy-party';
export const TRUST_MODE_DISCLOSURE = 'Trusted policy party mode (ADR-001). XRPL does not verify the Midnight proof: it checks only the ' +
    'crypto-condition, the fixed destination and the time bounds. The policy party that holds the preimage ' +
    '(by default the payer side) can release early or withhold; withholding ends in a refund to the payer ' +
    'after CancelAfter. Testnet only: the demo credential signature is not secure (CZ-005).';
const RIPPLE_EPOCH = 946684800;
const accountHex32 = (a) => Buffer.from(xrpl.decodeAccountID(a)).toString('hex') + '00'.repeat(12);
const pad32Hex = (s) => {
    const b = Buffer.alloc(32);
    Buffer.from(s, 'utf8').copy(b);
    return b.toString('hex');
};
export async function releaseStrict(o) {
    const res = (status, reason, txHash) => ({ status, reason, ...(txHash ? { txHash } : {}) });
    const nowSec = Math.floor((o.now ? o.now() : Date.now()) / 1000);
    if (o?.trustMode !== TRUST_MODE)
        return res('refused', `trust-mode-required: pass trustMode '${TRUST_MODE}' (ADR-001)`);
    const template = o.contractTemplate ?? 'eligibility_v2';
    if (!STRICT_TEMPLATES.includes(template))
        return res('refused', `unknown-contract-template: ${String(template)}`);
    let intent;
    let hash;
    try {
        intent = normalizeIntentV2(o.intent);
        hash = intentHashV2(intent);
    }
    catch (e) {
        return res('refused', 'malformed-intent: ' + e.message);
    }
    // Only the mock issuer exists and its signature leaks the issuer key (CZ-005): no mainnet.
    if (intent.environment === 'mainnet' || intent.midnightNetwork === 'mainnet') {
        return res('refused', 'mainnet-not-supported: test networks only until the credential signature is replaced (CZ-005, ADR-004)');
    }
    const rec = o.registry.get(intent.intentId);
    if (!rec)
        return res('refused', 'intent-not-registered');
    if (rec.intentHash !== hash)
        return res('refused', 'intent-hash-conflict');
    if (rec.contractAddress !== o.contractAddress)
        return res('refused', 'contract-not-bound-to-intent');
    if (rec.state === 'settled')
        return res('already-settled', 'idempotent-retry', rec.txHash);
    if (nowSec > intent.expiresAt)
        return res('expired', 'intent-expired');
    // Artifact identity named by the intent must be the circuits this verifier ships.
    if (!o.backend.circuitArtifactId)
        return res('unavailable', 'artifact-id-unavailable');
    let localArtifact;
    try {
        localArtifact = await o.backend.circuitArtifactId(template);
    }
    catch {
        return res('unavailable', 'artifact-id-unavailable');
    }
    if (localArtifact !== intent.circuitArtifactId)
        return res('refused', 'circuit-artifact-mismatch');
    // Midnight: strict, typed verification against the intent (CZ-002/003).
    const outcome = await o.backend.verifyStrict(null, {
        network: intent.midnightNetwork,
        template,
        contractAddress: o.contractAddress,
        publicParams: {
            intentHash: hash,
            issuerX: BigInt('0x' + intent.issuerX).toString(),
            issuerY: BigInt('0x' + intent.issuerY).toString(),
            credentialType: pad32Hex(intent.credentialType),
            asOf: intent.asOf,
            escrowOwner: accountHex32(intent.owner),
            offerSequence: String(intent.offerSequence),
            escrowDestination: accountHex32(intent.destination),
        },
    });
    if (outcome.status !== 'verified' || !outcome.evidence) {
        const map = { rejected: 'refused', unavailable: 'unavailable', pending: 'pending', expired: 'expired' };
        return res(map[outcome.status] ?? 'refused', 'midnight:' + outcome.reason);
    }
    const ledger = outcome.evidence.ledger;
    // The revealed preimage must open exactly this intent's condition.
    const pre = String(ledger.revealedPreimage ?? '');
    if (!/^[0-9a-f]{64}$/.test(pre))
        return res('refused', 'no-revealed-preimage');
    const f = new cc.PreimageSha256();
    f.setPreimage(Buffer.from(pre, 'hex'));
    if (f.getConditionBinary().toString('hex').toUpperCase() !== intent.condition)
        return res('refused', 'revealed-preimage-does-not-open-condition');
    const fulfillment = f.serializeBinary().toString('hex').toUpperCase();
    // One credential, one intent (CZ-008).
    const credNull = String(ledger.credentialNullifier ?? '');
    if (!/^[0-9a-f]{64}$/.test(credNull) || /^0+$/.test(credNull))
        return res('refused', 'credential-nullifier-missing');
    try {
        o.registry.claimCredential(credNull, intent.intentId);
    }
    catch (e) {
        if (e instanceof RegistryConflict)
            return res('refused', e.code);
        throw e;
    }
    // XRPL: validated escrow object must match the intent.
    let networkId;
    let node;
    try {
        const info = await o.client.request({ command: 'server_info' });
        networkId = Number(info?.result?.info?.network_id ?? 0);
    }
    catch {
        return res('unavailable', 'xrpl-unavailable');
    }
    if (networkId !== intent.xrplNetworkId)
        return res('refused', 'xrpl-network-mismatch');
    try {
        const le = await o.client.request({ command: 'ledger_entry', escrow: { owner: intent.owner, seq: intent.offerSequence }, ledger_index: 'validated' });
        node = le?.result?.node;
        if (!node || le?.result?.validated === false)
            return res('reconcile', 'escrow-not-validated');
    }
    catch (e) {
        const code = e?.data?.error;
        if (code === 'entryNotFound')
            return res('reconcile', 'escrow-not-found: finished, cancelled or never created; look up the owner account history');
        return res('unavailable', 'xrpl-unavailable');
    }
    const want = {
        Account: intent.owner,
        Destination: intent.destination,
        Amount: intent.amountDrops,
        Condition: intent.condition,
        CancelAfter: intent.cancelAfter,
        FinishAfter: intent.finishAfter ?? undefined,
        DestinationTag: intent.destinationTag ?? undefined,
    };
    for (const [key, v] of Object.entries(want)) {
        const got = key === 'Condition' && typeof node[key] === 'string' ? node[key].toUpperCase() : node[key];
        if (got !== v)
            return res('refused', `escrow-mismatch:${key}`);
    }
    const rippleNow = nowSec - RIPPLE_EPOCH;
    if (rippleNow >= intent.cancelAfter)
        return res('refused', 'cancel-window-open: escrow can no longer be finished; use EscrowCancel to refund the owner');
    if (intent.finishAfter !== null && rippleNow <= intent.finishAfter)
        return res('pending', 'finish-after-not-reached');
    o.registry.setState(intent.intentId, 'submitting');
    let r;
    try {
        r = await o.client.submitAndWait({
            TransactionType: 'EscrowFinish',
            Account: o.submitter.address,
            Owner: intent.owner,
            OfferSequence: intent.offerSequence,
            Condition: intent.condition,
            Fulfillment: fulfillment,
        }, { wallet: o.submitter });
    }
    catch {
        o.registry.setState(intent.intentId, 'submitted-unknown');
        return res('reconcile', 'submit-outcome-unknown: retry re-reads the escrow before submitting again');
    }
    const code = r?.result?.meta?.TransactionResult;
    const txHash = r?.result?.hash;
    if (r?.result?.validated !== true) {
        o.registry.setState(intent.intentId, 'submitted-unknown', { txHash });
        return res('reconcile', 'finish-not-validated', txHash);
    }
    if (code === 'tesSUCCESS') {
        o.registry.setState(intent.intentId, 'settled', { txHash });
        return res('settled', 'ok', txHash);
    }
    o.registry.setState(intent.intentId, 'failed', { txHash, reason: code });
    return res('reconcile', `finish-result:${code}`, txHash);
}
