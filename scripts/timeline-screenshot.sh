#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARGS=()

for arg in "$@"; do
  if [[ "$arg" == "--send" ]]; then
    continue
  fi
  ARGS+=("$arg")
done

cd "$ROOT"
exec node ./bin/cyberboss.js timeline screenshot "${ARGS[@]}"
