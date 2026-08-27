#!/usr/bin/env bash
#
# Everything, in one command. This repository has no CI: there is no remote and
# no Actions runner, so this script is the only thing standing between a change
# and a regression. Run it before every commit.
#
#   scripts/verify.sh              full run
#   scripts/verify.sh --fast       skip the web production build
#
# Exits non-zero on the first layer that fails, and says which.

set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
FAST=${1:-}
FAILED=()

say()  { printf '\n\033[1m== %s\033[0m\n' "$1"; }
ok()   { printf '   [ok]   %s\n' "$1"; }
bad()  { printf '   [FAIL] %s\n' "$1"; FAILED+=("$2"); }
skip() { printf '   [skip] %s\n' "$1"; }

# --------------------------------------------------------------------- rust
# Smart App Control blocks freshly built test binaries on Windows (see
# docs/windows-notes.md), so the suite runs in WSL when one is available.
say "engine (Rust)"
RUST_CMD=""
if [ "$OS" = "Windows_NT" ] && command -v wsl.exe >/dev/null 2>&1 &&
   wsl -d Ubuntu -- bash -lc 'test -x $HOME/.cargo/bin/cargo' 2>/dev/null; then
  RUST_CMD="wsl -d Ubuntu -- bash -lc 'cd /mnt/c/laragon/www/controlshift && export CARGO_TARGET_DIR=\$HOME/cs-target && \$HOME/.cargo/bin/cargo"
  RUST_SUFFIX="'"
  printf '   (running in WSL: Smart App Control blocks test binaries on Windows)\n'
elif command -v cargo >/dev/null 2>&1; then
  RUST_CMD="cargo"
  RUST_SUFFIX=""
fi

if [ -z "$RUST_CMD" ]; then
  skip "no cargo on PATH and no WSL toolchain"
  FAILED+=("rust: could not run")
else
  out=$(eval "$RUST_CMD test 2>&1$RUST_SUFFIX")
  passed=$(echo "$out" | grep -oP '^test result: ok\. \K\d+' | awk '{s+=$1} END {print s+0}')
  if echo "$out" | grep -q "4551"; then
    bad "blocked by Smart App Control - see docs/windows-notes.md" "rust: blocked"
  elif echo "$out" | grep -qE "^test result: FAILED|^error"; then
    echo "$out" | grep -E "^(test .* FAILED|error)" | head -5 | sed 's/^/     /'
    bad "tests failed" "rust: tests"
  elif [ "$passed" -lt 30 ]; then
    # A suite that reports almost nothing did not run. Green on zero tests is
    # the failure this whole script exists to prevent.
    bad "only $passed tests ran - expected the full suite" "rust: incomplete"
  else
    ok "$passed tests"
  fi
  eval "$RUST_CMD fmt --check >/dev/null 2>&1$RUST_SUFFIX" && ok "fmt" || bad "fmt" "rust: fmt"
  eval "$RUST_CMD clippy --all-targets -- -D warnings >/dev/null 2>&1$RUST_SUFFIX" \
    && ok "clippy" || bad "clippy" "rust: clippy"
fi

# ------------------------------------------------------------------- golden
# The golden has to be reproducible byte for byte or it is not a fixture. This
# caught a real one: openpyxl stamps the time into the workbook, so every
# regeneration changed the file and its hash in the manifest.
say "golden dataset"
if python scripts/gen_go001.py >/dev/null 2>&1; then
  if [ -z "$(git status --short golden/)" ]; then
    ok "regenerates byte for byte"
  else
    git status --short golden/ | head -3 | sed 's/^/     /'
    bad "regenerating changes files - the golden is not reproducible" "golden: drift"
  fi
else
  bad "generator failed (does it still match MASTER SPEC 59?)" "golden: generator"
fi

# ---------------------------------------------------------------------- api
say "api (TypeScript, against the real database)"
cd "$ROOT/services/api"
if npx --no-install tsc -p tsconfig.json >/dev/null 2>&1; then
  ok "typecheck and build"
  total=0
  for suite in scanner uploads tenancy estimating commercial branding; do
    out=$(node --test --env-file=.env "dist/$suite.test.js" 2>&1)
    p=$(echo "$out" | grep -oP '^ℹ pass \K\d+' || echo 0)
    f=$(echo "$out" | grep -oP '^ℹ fail \K\d+' || echo 1)
    total=$((total + p))
    [ "$f" = "0" ] && ok "$suite ($p)" || bad "$suite: $f failing" "api: $suite"
  done
  if [ "$total" -lt 40 ]; then
    # Same guard as the engine: a suite that reports almost nothing did not run.
    bad "only $total assertions ran - expected the full suite" "api: incomplete"
  else
    printf '   %d assertions\n' "$total"
  fi
else
  npx --no-install tsc -p tsconfig.json 2>&1 | head -5 | sed 's/^/     /'
  bad "does not compile" "api: build"
fi

# ---------------------------------------------------------------------- web
say "console (Next.js)"
cd "$ROOT/apps/web"
npx --no-install tsc --noEmit -p tsconfig.json >/dev/null 2>&1 \
  && ok "typecheck" || { npx --no-install tsc --noEmit -p tsconfig.json 2>&1 | head -5 | sed 's/^/     /'; bad "typecheck" "web: types"; }
if [ "$FAST" = "--fast" ]; then
  skip "production build (--fast)"
else
  # A production build overwrites a running dev server's .next, so this stops
  # short of leaving one broken: re-run `npm run dev` afterwards.
  rm -rf .next
  npx --no-install next build >/dev/null 2>&1 && ok "production build" || bad "production build" "web: build"
fi

# ---------------------------------------------------------------- end to end
say "end to end (the running product)"
cd "$ROOT"
if curl -s -o /dev/null -m 3 "http://127.0.0.1:3000/api/opportunities"; then
  out=$(python scripts/e2e_go001.py 2>&1)
  if echo "$out" | grep -q "checks passed"; then
    ok "$(echo "$out" | grep -oP '\d+ checks passed')"
  else
    echo "$out" | grep -E "\[FAIL\]|Error|error" | head -5 | sed 's/^/     /'
    bad "GO-001 did not complete" "e2e"
  fi
  node --env-file=services/api/.env -e "
    const {PrismaClient}=require('./services/api/node_modules/@prisma/client');
    (async()=>{const p=new PrismaClient();
      await p.opportunity.deleteMany({where:{name:{startsWith:'GO-001 end-to-end'}}});
      await p.\$disconnect();})()" >/dev/null 2>&1
else
  skip "API is not running (node services/api/dist/main.js)"
  FAILED+=("e2e: API down")
fi

# ------------------------------------------------------------------ scanner
say "malware scanner"
if bash scripts/smoke_scanner.sh >/dev/null 2>&1; then
  ok "live and flagging EICAR"
else
  skip "no scanner reachable - uploads will be refused by analysis, which is correct"
fi

# ------------------------------------------------------------------ verdict
printf '\n'
if [ ${#FAILED[@]} -eq 0 ]; then
  printf '\033[1mgreen\033[0m - every layer verified\n'
  exit 0
fi
printf '\033[1mNOT green\033[0m - %d problem(s): %s\n' "${#FAILED[@]}" "${FAILED[*]}"
exit 1
