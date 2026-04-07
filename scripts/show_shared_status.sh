#!/bin/zsh
set -euo pipefail

PORT="${CYBERBOSS_SHARED_PORT:-8765}"
LISTEN_URL="ws://127.0.0.1:${PORT}"
STATE_DIR="${CYBERBOSS_STATE_DIR:-$HOME/.cyberboss}"
LOG_DIR="${STATE_DIR}/logs"
APP_SERVER_PID_FILE="${LOG_DIR}/shared-app-server.pid"
WECHAT_PID_FILE="${LOG_DIR}/shared-wechat.pid"
WECHAT_LOG_FILE="${LOG_DIR}/shared-wechat.log"

function print_pid_state() {
  local label="$1"
  local pid_file="$2"

  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo "${label}=${pid}"
      return
    fi
    echo "${label}=stale"
    return
  fi

  echo "${label}=missing"
}

echo "listen=${LISTEN_URL}"
print_pid_state "shared_app_server_pid" "${APP_SERVER_PID_FILE}"
print_pid_state "shared_cyberboss_pid" "${WECHAT_PID_FILE}"

if command -v curl >/dev/null 2>&1; then
  if curl -sf "http://127.0.0.1:${PORT}/readyz" >/dev/null; then
    echo "readyz=ok"
  else
    echo "readyz=down"
  fi
fi

if command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN || true
fi

if [[ -f "${WECHAT_LOG_FILE}" ]]; then
  echo "--- ${WECHAT_LOG_FILE} (tail) ---"
  tail -n 20 "${WECHAT_LOG_FILE}" || true
fi
