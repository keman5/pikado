#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mode="${1:-build}"
case "$mode" in build|deploy|check) ;; *) echo 'Usage: ./build.sh [build|check|deploy]' >&2; exit 2 ;; esac
if command -v caffeinate >/dev/null; then
  caffeinate -di -w "$$" &
fi
# This project is JavaScript-only; Go caches are relevant only if Go is added.
if [[ -f go.mod ]] && command -v go >/dev/null; then go clean -cache -testcache; fi
rm -rf .artifacts
if [[ ! -d node_modules ]]; then npm ci; fi
node --test tests/localization.test.mjs
if [[ "$mode" == check ]]; then exit 0; fi
npm run build
node scripts/check-build.mjs
if [[ "$mode" == deploy ]]; then
  npx --yes wrangler@4.152.0 deploy
fi
