#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
PORT="${CYBERBOSS_SHARED_PORT:-8765}"
LISTEN_URL="ws://127.0.0.1:${PORT}"
STATE_DIR="${CYBERBOSS_STATE_DIR:-$HOME/.cyberboss}"
LOG_DIR="${STATE_DIR}/logs"
PID_FILE="${LOG_DIR}/shared-app-server.pid"
LOG_FILE="${LOG_DIR}/shared-app-server.log"
CODEX_COMMAND="${CYBERBOSS_CODEX_COMMAND:-codex}"

function lookup_listen_pid() {
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null \
    | awk 'NR > 1 { print $2; found=1; exit } END { if (!found) exit 0 }'
}

mkdir -p "${LOG_DIR}"
export CYBERBOSS_STATE_DIR="${STATE_DIR}"
export TIMELINE_FOR_AGENT_STATE_DIR="${STATE_DIR}"
if [[ -z "${TIMELINE_FOR_AGENT_CHROME_PATH:-}" ]]; then
  export TIMELINE_FOR_AGENT_CHROME_PATH="${CYBERBOSS_SCREENSHOT_CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
fi
export CYBERBOSS_HOME="${CYBERBOSS_HOME:-${ROOT_DIR}}"

MCP_CONFIG_ARGS=()
while IFS= read -r line; do
  if [[ -n "${line}" ]]; then
    MCP_CONFIG_ARGS+=("${line}")
  fi
done < <(
  node -e '
    const helper = require(process.argv[1]);
    const args = helper.buildCodexMcpConfigArgs(
      helper.resolveCodexProjectToolMcpServerConfig({
        cyberbossHome: process.env.CYBERBOSS_HOME || process.argv[2],
      })
    );
    for (const arg of args) {
      process.stdout.write(`${arg}\n`);
    }
  ' "${ROOT_DIR}/src/adapters/runtime/codex/mcp-config.js" "${ROOT_DIR}"
)

if [[ -f "${PID_FILE}" ]]; then
  EXISTING_PID="$(cat "${PID_FILE}")"
  if [[ -n "${EXISTING_PID}" ]] && kill -0 "${EXISTING_PID}" 2>/dev/null; then
    echo "shared app-server already running pid=${EXISTING_PID} listen=${LISTEN_URL}"
    exit 0
  fi
  rm -f "${PID_FILE}"
fi

EXISTING_PID="$(lookup_listen_pid || true)"
if [[ -n "${EXISTING_PID}" ]]; then
  echo "${EXISTING_PID}" > "${PID_FILE}"
  echo "shared app-server already running pid=${EXISTING_PID} listen=${LISTEN_URL}"
  exit 0
fi

nohup "${CODEX_COMMAND}" "${MCP_CONFIG_ARGS[@]}" app-server --listen "${LISTEN_URL}" >> "${LOG_FILE}" 2>&1 &
APP_SERVER_PID=$!
echo "${APP_SERVER_PID}" > "${PID_FILE}"
sleep 1

LISTEN_PID="$(lookup_listen_pid || true)"
if kill -0 "${APP_SERVER_PID}" 2>/dev/null && [[ -n "${LISTEN_PID}" ]]; then
  echo "${LISTEN_PID}" > "${PID_FILE}"
  echo "started shared app-server pid=${LISTEN_PID} listen=${LISTEN_URL}"
  echo "log=${LOG_FILE}"
  exit 0
fi

EXISTING_PID="$(lookup_listen_pid || true)"
if [[ -n "${EXISTING_PID}" ]]; then
  echo "${EXISTING_PID}" > "${PID_FILE}"
  echo "shared app-server already running pid=${EXISTING_PID} listen=${LISTEN_URL}"
  exit 0
fi

echo "failed to start shared app-server; check ${LOG_FILE}" >&2
tail -n 20 "${LOG_FILE}" >&2 || true
exit 1
