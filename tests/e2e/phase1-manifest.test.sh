#!/usr/bin/env bash
# Phase 1 E2E: nx-mk run produces .nx-mk/manifest.json when openapi is configured.
#
# Windows/Git-Bash notes:
#   - mktemp -d may not exist -> fall back to $TEMP (Windows temp, node-compatible).
#   - jq may not be installed -> JSON validity is checked with node, shape with grep.
#   - $REPO is POSIX (/d/...) because bash needs it; node/plugin-swagger need a
#     Windows path (D:\) — so $CLI and $FIXTURE are converted with cygpath -m.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
# Convert to Windows path for node (cygpath -m outputs D:/... form, which node's
# isAbsolute() accepts and resolve() normalizes; on non-Windows it's a no-op).
REPO_WIN=$(cygpath -m "$REPO" 2>/dev/null || echo "$REPO")
CLI="$REPO_WIN/packages/cli/dist/index.js"
FIXTURE="$REPO_WIN/packages/manifest/src/__tests__/fixtures/openapi-minimal.json"

if [ ! -f "$CLI" ]; then
  echo "ERROR: CLI not built — run: pnpm --filter @nx-mk/cli build"
  exit 1
fi
if [ ! -f "$FIXTURE" ]; then
  echo "ERROR: fixture not found: $FIXTURE"
  exit 1
fi

new_tmp() {
  # Git Bash mktemp -d works, but keep the fallback for other Windows shells.
  mktemp -d 2>/dev/null || echo "$TEMP/nx-mk-e2e-$RANDOM"
}

cleanup() {
  rm -rf "$TMP" "$TMP2"
}
trap cleanup EXIT
# Initialize before set -euo pipefail runs the trap (avoid unbound-var in cleanup)
TMP=""
TMP2=""

### --- Positive: openapi configured -> manifest.json produced --- ###
TMP=$(new_tmp)
cd "$TMP"
cat > nx-mk.config.yml <<EOF
openapi: $FIXTURE
plugins:
  - '@nx-mk/plugin-swagger'
EOF

# Run
node "$CLI" run
RUN_EXIT=$?

[ "$RUN_EXIT" = "0" ] || { echo "FAIL: nx-mk run exit=$RUN_EXIT (expected 0)"; exit 1; }

# Assert manifest.json exists
[ -f .nx-mk/manifest.json ] || { echo "FAIL: .nx-mk/manifest.json not produced"; exit 1; }

# Assert it has the expected shape (jq may not be available — use grep)
grep -q '"endpoints"' .nx-mk/manifest.json || { echo "FAIL: manifest.json missing 'endpoints' field"; exit 1; }
grep -q '"fields"' .nx-mk/manifest.json || { echo "FAIL: manifest.json missing 'fields' field"; exit 1; }

# Verify it's valid JSON
node -e "JSON.parse(require('fs').readFileSync('.nx-mk/manifest.json', 'utf8'))" \
  || { echo "FAIL: manifest.json is not valid JSON"; exit 1; }

echo "PASS: .nx-mk/manifest.json generated with expected structure"

### --- Negative: no openapi -> no manifest.json, run still exits 0 --- ###
TMP2=$(new_tmp)
cd "$TMP2"
cat > nx-mk.config.yml <<EOF
plugins:
  - '@nx-mk/plugin-swagger'
EOF

node "$CLI" run
NEG_EXIT=$?
[ "$NEG_EXIT" = "0" ] || { echo "FAIL: nx-mk run (no openapi) exit=$NEG_EXIT (expected 0)"; exit 1; }
[ ! -f .nx-mk/manifest.json ] || { echo "FAIL: manifest.json should NOT exist when openapi absent"; exit 1; }

echo "PASS: no manifest.json when openapi absent"
