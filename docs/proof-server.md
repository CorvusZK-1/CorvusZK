# Self-hosted Midnight proof server (runbook)

CorvusZK's on-chain path needs a **local** proof server. Whoever runs the proof server can see private inputs for proofs it generates — that is why CorvusZK is designed for self-hosting, not a shared third-party prover for production secrets.

## Start (Docker)

```bash
docker run --rm -p 6300:6300 midnightntwrk/proof-server:8.1.3 midnight-proof-server -v
```

Health check:

```bash
curl -s http://localhost:6300/
# expect JSON with "status":"ok"
```

Point the SDK / scripts at it:

```bash
export MIDNIGHT_PROOF_SERVER=http://localhost:6300
```

## Notes

- Version **8.1.3** matches the pinned Midnight packages under `midnight/package.json`.
- No paid cloud host is required for development. Do not put production private witnesses through a server you do not control.
- CorvusZK does not purchase or operate a hosted relay for you in this package.
