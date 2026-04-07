#!/bin/zsh
set -euo pipefail

PORT="${CYBERBOSS_SHARED_PORT:-8765}"
REMOTE_URL="${CYBERBOSS_CODEX_ENDPOINT:-ws://127.0.0.1:${PORT}}"
STATE_DIR="${CYBERBOSS_STATE_DIR:-$HOME/.cyberboss}"
SESSION_FILE="${CYBERBOSS_SESSIONS_FILE:-${STATE_DIR}/sessions.json}"
WORKSPACE_ROOT="${CYBERBOSS_WORKSPACE_ROOT:-$PWD}"

if [[ ! -f "${SESSION_FILE}" ]]; then
  echo "session file not found: ${SESSION_FILE}" >&2
  exit 1
fi

RESOLVED="$(
  node -e '
    const fs = require("fs");

    const sessionFile = process.argv[1];
    const workspaceRoot = process.argv[2];
    const data = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    const bindings = Object.values(data.bindings || {});

    function normalize(value) {
      return typeof value === "string" ? value.trim() : "";
    }

    function getThreadId(binding, root) {
      const normalizedRoot = normalize(root);
      if (!normalizedRoot) {
        return "";
      }
      const map = binding && typeof binding.threadIdByWorkspaceRoot === "object"
        ? binding.threadIdByWorkspaceRoot
        : {};
      return normalize(map[normalizedRoot]);
    }

    const normalizedWorkspaceRoot = normalize(workspaceRoot);

    const exactBinding = bindings.find((binding) => getThreadId(binding, normalizedWorkspaceRoot));
    if (exactBinding) {
      process.stdout.write(`${getThreadId(exactBinding, normalizedWorkspaceRoot)}\n${normalizedWorkspaceRoot}`);
      process.exit(0);
    }

    const activeBinding = bindings.find((binding) => {
      const activeWorkspaceRoot = normalize(binding && binding.activeWorkspaceRoot);
      return activeWorkspaceRoot && getThreadId(binding, activeWorkspaceRoot);
    });
    if (activeBinding) {
      const activeWorkspaceRoot = normalize(activeBinding.activeWorkspaceRoot);
      process.stdout.write(`${getThreadId(activeBinding, activeWorkspaceRoot)}\n${activeWorkspaceRoot}`);
      process.exit(0);
    }

    process.exit(1);
  ' "${SESSION_FILE}" "${WORKSPACE_ROOT}"
)"

if [[ -z "${RESOLVED}" ]]; then
  echo "no bound WeChat thread found for workspace: ${WORKSPACE_ROOT}" >&2
  exit 1
fi

THREAD_ID="${RESOLVED%%$'\n'*}"
RESOLVED_WORKSPACE_ROOT="${RESOLVED#*$'\n'}"

if [[ -z "${THREAD_ID}" || -z "${RESOLVED_WORKSPACE_ROOT}" ]]; then
  echo "failed to resolve bound WeChat thread from: ${SESSION_FILE}" >&2
  exit 1
fi

exec codex resume "${THREAD_ID}" --remote "${REMOTE_URL}" -C "${RESOLVED_WORKSPACE_ROOT}" "$@"
