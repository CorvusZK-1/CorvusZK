# Security notice: CorvusZK demo credential signature is not secure

**Date:** 26 November 2026 (America/Los_Angeles)  
**Contact:** cory.raven1@gmail.com

The eligibility demo in CorvusZK (`contracts/eligibility.compact` and the "mock issuer" in `midnight/eligibility.mjs`) uses a custom signature scheme written for demonstration. An engineering review found that anyone who receives **one** credential from that demo issuer can work out the issuer's private signing key and then create valid-looking credentials for anyone.

- **Who is affected:** anyone who has used the CorvusZK eligibility demo issuer, or copied that signature code, to decide who may receive funds. The issuer has always been labelled a mock, and the project is marked "Unaudited. Not for real value." There is no known real-value use. Do not use it for anything that matters.
- **Mainnet deployment:** the eligibility contract already deployed on Midnight mainnet (13 November 2026) uses this insecure demo issuer and must not be used with real value.
- **What is not affected:** the XRPL escrow itself (funds still go only to the fixed destination or back to the payer after `CancelAfter`), and the other three contract templates (`condition`, `age_over`, and `balance_above`), which do not use this signature.
- **What we are doing:** the demo issuer is now clearly marked insecure and test-only in code, the SDK refuses mainnet release while it is in use, and we plan to replace it with a standard, well-reviewed signature primitive from Midnight's standard library, after outside review.
- **What you should do:** treat any credential from the demo issuer as untrusted. Do not deploy the eligibility contract with real value.

Questions: [cory.raven1@gmail.com](mailto:cory.raven1@gmail.com). To report a new vulnerability, use this repository's [Security Advisories](https://github.com/CorvusZK-1/CorvusZK/security/advisories/new).
