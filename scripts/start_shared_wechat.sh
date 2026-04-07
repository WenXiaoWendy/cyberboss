#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${CYBERBOSS_SHARED_PORT:-8765}"
STATE_DIR="${CYBERBOSS_STATE_DIR:-$HOME/.cyberboss}"
LOG_DIR="${STATE_DIR}/logs"
PID_FILE="${LOG_DIR}/shared-wechat.pid"

function resolve_pid_cwd() {
  local pid="$1"
  lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

function find_existing_bridge_pid() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid_from_file
    pid_from_file="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid_from_file}" ]] && kill -0 "${pid_from_file}" 2>/dev/null; then
      echo "${pid_from_file}"
      return 0
    fi
  fi

  local pid
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    if [[ "$(resolve_pid_cwd "${pid}")" == "${ROOT_DIR}" ]]; then
      echo "${pid}"
      return 0
    fi
  done < <(ps -ax -o pid=,command= | awk '/node \.\/bin\/cyberboss\.js start --checkin/ { print $1 }')

  return 1
}

function cleanup_pid_file() {
  if [[ -f "${PID_FILE}" ]]; then
    local current_pid
    current_pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ "${current_pid}" == "$$" ]]; then
      rm -f "${PID_FILE}"
    fi
  fi
}

"${ROOT_DIR}/scripts/start_shared_app_server.sh"
mkdir -p "${LOG_DIR}"

EXISTING_PID="$(find_existing_bridge_pid || true)"
if [[ -n "${EXISTING_PID}" ]]; then
  echo "${EXISTING_PID}" > "${PID_FILE}"
  echo "shared cyberboss already running pid=${EXISTING_PID}"
  exit 0
fi

echo "$$" > "${PID_FILE}"
trap cleanup_pid_file EXIT INT TERM
cd "${ROOT_DIR}"
export CYBERBOSS_CODEX_ENDPOINT="ws://127.0.0.1:${PORT}"
node ./bin/cyberboss.js start --checkin
