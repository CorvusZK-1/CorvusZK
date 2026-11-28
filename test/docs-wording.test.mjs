import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Wording guards from the 27 Nov 2026 review: no overclaims in public docs.
const files = ['README.md', 'WHAT-YOU-GET.md', 'docs/getting-started.md', 'docs/xrpl-escrow-flow.md', 'docs/security-model.md', 'docs/templates.md'];
const text = Object.fromEntries(files.map((f) => [f, fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')]));

test('docs never claim "trustless" except to deny it', () => {
  for (const [f, t] of Object.entries(text)) {
    for (const line of t.split('\n')) {
      if (/trustless/i.test(line)) assert.match(line, /\bnot\b|never|no /i, `${f}: ${line}`);
    }
  }
});

test('docs do not say released can only become true "honestly"', () => {
  for (const [f, t] of Object.entries(text)) assert.doesNotMatch(t, /true honestly/i, f);
});

test('docs do not call Midnight decentralized', () => {
  for (const [f, t] of Object.entries(text)) assert.doesNotMatch(t, /midnight[^.\n]{0,40}\bdecentrali[sz]ed\b/i, f);
});

test('docs mention the NIGHT-for-DUST requirement', () => {
  assert.match(text['docs/getting-started.md'], /hold some NIGHT/);
});
