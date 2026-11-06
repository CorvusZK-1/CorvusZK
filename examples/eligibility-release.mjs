/**
 * Mock-issuer eligibility, then XRPL fulfillment taken from Midnight state.
 *
 * The issuer is created in this process and labeled MOCK. Nothing here is a
 * regulated KYC check, an XRPL CredentialCreate, or a Midnight Preprod
 * transaction. compact-runtime executes the circuit locally.
 *
 * What stays private: holder secret, subject commitment, expiry, Schnorr
 * nonce and scalar (they are witnesses). The public ledger shows the issuer
 * point, credential type, asOf, nullifier, preimage commitment, and — only
 * after reveal — the preimage.
 *
 * What XRPL still publishes if you lock funds with `condition`: the amount,
 * the payer account, the destination account, and the finish time. This
 * example does not submit an XRPL transaction.
 *
 * Remaining trust: the setup party who sampled the preimage can finish that
 * escrow without Midnight. XRPL does not verify the Compact proof.
 * prove() records one nullifier on this contract (owner, sequence,
 * destination, preimage commitment). A second prove on that state fails.
 * A new contract starts unused. There is no global nullifier set.
 */
import crypto from 'node:crypto';
import * as elig from '../midnight/eligibility.mjs';

const issuer = elig.createMockIssuer();
const holderSecret = new Uint8Array(crypto.randomBytes(32));
const expiry = 1_900_000_000n;
const asOf = 1_700_000_000n;
const credential = elig.issueMockCredential(issuer, {
  holderSecret,
  credentialType: 'kyc-pass',
  expiry,
});
const bound = elig.createBoundPreimage();
const escrow = {
  owner: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
  offerSequence: 17,
  destination: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
};

const proved = await elig.runEligibility({
  issuer,
  credential,
  holderSecret,
  asOf,
  preimageCommit: bound.preimageCommit,
  escrow,
});
let early = 'refused';
try {
  elig.fulfillmentFromRevealedLedger(proved.rawLedger, { ...escrow, condition: bound.condition });
  early = 'UNEXPECTED fulfillment';
} catch (err) {
  early = err.message;
}

const revealed = await elig.runEligibility({
  issuer,
  credential,
  holderSecret,
  asOf,
  preimageCommit: bound.preimageCommit,
  escrow,
  reveal: true,
  releasePreimage: bound.preimage,
});
const rel = elig.fulfillmentFromRevealedLedger(revealed.rawLedger, { ...escrow, condition: bound.condition });

const view = {
  mockIssuer: credential.label,
  xls70Vocabulary: {
    Issuer: credential.Issuer,
    Subject: 'commitment only (not printed; not an XRPL account)',
    CredentialType: credential.CredentialType,
    Expiration: credential.Expiration,
  },
  publicAfterProve: proved.ledger,
  releaserBeforeReveal: early,
  publicAfterReveal: {
    proven: revealed.ledger.proven,
    preimageRevealed: revealed.ledger.preimageRevealed,
    credentialType: revealed.ledger.credentialType,
    nullifier: revealed.ledger.nullifier,
    escrowOwner: revealed.ledger.escrowOwner,
    offerSequence: revealed.ledger.offerSequence,
    escrowDestination: revealed.ledger.escrowDestination,
  },
  xrplFromRevealedState: {
    condition: rel.condition,
    fulfillment: rel.fulfillment,
    source: rel.source,
  },
  stillPublicOnXrpl: ['escrow amount', 'payer account', 'destination account', 'finish time'],
  notVerifiedHere: [
    'No XRPL transaction was submitted.',
    'No Midnight Preprod transaction was submitted.',
    'Local compact-runtime execution is not a proof-server proof.',
    'The setup party who created the preimage can still finish the escrow directly.',
  ],
};
console.log(JSON.stringify(view, null, 2));
