#!/usr/bin/env bash
# Compile all four Compact contracts in place with the pinned compiler.
# Usage: scripts/compile-contracts.sh            (full compile, with proving keys)
#        scripts/compile-contracts.sh --check    (compile, then fail if the committed
#                                                  artifacts in midnight/managed differ)
# Needs the Compact toolchain: https://docs.midnight.network/  (compact update 0.36.0)
set -euo pipefail
cd "$(dirname "$0")/.."
COMPACT_VERSION="${COMPACT_VERSION:-0.36.0}"
for c in condition age_over balance_above eligibility; do
  echo "== compact compile contracts/$c.compact (compiler $COMPACT_VERSION)"
  compact compile "+$COMPACT_VERSION" "contracts/$c.compact" "midnight/managed/$c"
done
if [[ "${1:-}" == "--check" ]]; then
  if ! git diff --quiet -- midnight/managed; then
    echo "Compiled output differs from the committed midnight/managed artifacts:" >&2
    git diff --stat -- midnight/managed >&2
    exit 1
  fi
  echo "All four contracts compiled; output matches the committed artifacts byte for byte."
fi
