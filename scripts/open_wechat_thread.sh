#!/bin/zsh
set -euo pipefail

PORT="${CYBERBOSS_SHARED_PORT:-8765}"
REMOTE_URL="${CYBERBOSS_CODEX_ENDPOINT:-ws://127.0.0.1:${PORT}}"
STATE_DIR="${CYBERBOSS_STATE_DIR:-$HOME/.cyberboss}"
SESSION_FILE="${CYBERBOSS_SESSIONS_FILE:-${STATE_DIR}/sessions.json}"
WORKSPACE_ROOT="${CYBERBOSS_WORKSPACE_ROOT:-$PWD}"
ACCOUNT_DIR="${STATE_DIR}/accounts"
RUNTIME_ID="${CYBERBOSS_RUNTIME:-codex}"

if [[ ! -f "${SESSION_FILE}" ]]; then
  echo "session file not found: ${SESSION_FILE}" >&2
  exit 1
fi

RESOLVED="$(
  node -e '
    const fs = require("fs");
    const path = require("path");

    const sessionFile = process.argv[1];
    const workspaceRoot = process.argv[2];
    const accountDir = process.argv[3];
    const runtimeId = process.argv[4];
    const data = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    const bindings = Object.entries(data.bindings || {}).map(([bindingKey, binding]) => ({ bindingKey, ...(binding || {}) }));

    function normalize(value) {
      return typeof value === "string" ? value.trim() : "";
    }

    function toTimestamp(value) {
      const parsed = Date.parse(normalize(value));
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function resolveCurrentAccountId(dir) {
      const normalizedDir = normalize(dir);
      if (!normalizedDir || !fs.existsSync(normalizedDir)) {
        return "";
      }

      const entries = fs.readdirSync(normalizedDir)
        .filter((name) => name.endsWith(".json") && !name.endsWith(".context-tokens.json"))
        .map((name) => {
          const fullPath = path.join(normalizedDir, name);
          try {
            const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
            return {
              accountId: normalize(parsed && parsed.accountId),
              savedAt: toTimestamp(parsed && parsed.savedAt),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .filter((entry) => entry.accountId);

      entries.sort((left, right) => right.savedAt - left.savedAt);
      return entries[0]?.accountId || "";
    }

    function getThreadMapForRuntime(binding, runtimeId) {
      const normalizedRuntimeId = normalize(runtimeId);
      const runtimeMap = binding && typeof binding.threadIdByWorkspaceRootByRuntime === "object"
        ? binding.threadIdByWorkspaceRootByRuntime
        : {};
      const scoped = runtimeMap[normalizedRuntimeId];
      return scoped && typeof scoped === "object" ? scoped : {};
    }

    function getThreadId(binding, root) {
      const normalizedRoot = normalize(root);
      if (!normalizedRoot) {
        return "";
      }
      const map = getThreadMapForRuntime(binding, runtimeId);
      return normalize(map[normalizedRoot]);
    }

    const normalizedWorkspaceRoot = normalize(workspaceRoot);
    const currentAccountId = resolveCurrentAccountId(accountDir);

    const filteredBindings = bindings
      .filter((binding) => !currentAccountId || normalize(binding.accountId) === currentAccountId)
      .sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt));

    const exactBinding = filteredBindings.find((binding) => getThreadId(binding, normalizedWorkspaceRoot));
    if (exactBinding) {
      process.stdout.write(`${getThreadId(exactBinding, normalizedWorkspaceRoot)}\n${normalizedWorkspaceRoot}`);
      process.exit(0);
    }

    const activeBinding = filteredBindings.find((binding) => {
      const activeWorkspaceRoot = normalize(binding && binding.activeWorkspaceRoot);
      return activeWorkspaceRoot && getThreadId(binding, activeWorkspaceRoot);
    });
    if (activeBinding) {
      const activeWorkspaceRoot = normalize(activeBinding.activeWorkspaceRoot);
      process.stdout.write(`${getThreadId(activeBinding, activeWorkspaceRoot)}\n${activeWorkspaceRoot}`);
      process.exit(0);
    }

    process.exit(1);
  ' "${SESSION_FILE}" "${WORKSPACE_ROOT}" "${ACCOUNT_DIR}" "${RUNTIME_ID}"
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
