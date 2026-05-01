const fs = require("fs");
const path = require("path");
const http = require("http");
const { createCheck, createGroup } = require("../schema");
const { redactPath } = require("../redact");

function runSharedChecks(context) {
  const config = context.config || {};
  const options = context.options || {};
  const logDir = path.join(config.stateDir || "", "logs");
  const appServerPidFile = path.join(logDir, "shared-app-server.pid");
  const bridgePidFile = path.join(logDir, "shared-wechat.pid");
  return createGroup({
    id: "shared",
    title: "Shared Mode",
    checks: [
      checkPidFile("shared.app_server_pid", "Shared app-server PID", appServerPidFile, options),
      checkPidFile("shared.bridge_pid", "Shared WeChat bridge PID", bridgePidFile, options),
      checkSharedPort(config),
    ],
  });
}

function checkPidFile(idBase, title, filePath, options) {
  if (!fs.existsSync(filePath)) {
    return createCheck({
      id: `${idBase}.missing`,
      title,
      status: "ok",
      category: "shared",
      evidence: { exists: false, file: redactPath(filePath, options) },
    });
  }
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    return createCheck({
      id: `${idBase}.unreadable`,
      title,
      status: "warn",
      category: "shared",
      evidence: { exists: true, file: redactPath(filePath, options), errorCode: error?.code || "stat_error" },
      recommendation: "Inspect stale or inaccessible shared-mode pid files.",
    });
  }
  if (!stat.isFile()) {
    return createCheck({
      id: `${idBase}.unreadable`,
      title,
      status: "warn",
      category: "shared",
      evidence: { exists: true, type: stat.isDirectory() ? "directory" : "other", file: redactPath(filePath, options) },
      recommendation: "Replace the pid path with a regular file or restart shared mode.",
    });
  }
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return createCheck({
      id: `${idBase}.unreadable`,
      title,
      status: "warn",
      category: "shared",
      evidence: { exists: true, file: redactPath(filePath, options), errorCode: error?.code || "read_error" },
      recommendation: "Inspect stale or inaccessible shared-mode pid files.",
    });
  }
  const pid = Number.parseInt(raw.trim(), 10);
  const alive = isPidAlive(pid);
  return createCheck({
    id: alive ? `${idBase}.alive` : `${idBase}.stale`,
    title,
    status: alive ? "ok" : "warn",
    category: "shared",
    evidence: { exists: true, pid, alive },
    recommendation: alive ? "" : "Remove stale pid files or restart shared mode.",
  });
}

function checkSharedPort(config) {
  const value = Number.parseInt(String(config.sharedPort || process.env.CYBERBOSS_SHARED_PORT || "8765"), 10);
  const ok = Number.isInteger(value) && value > 0 && value <= 65535;
  return createCheck({
    id: ok ? "shared.port.valid" : "shared.port.invalid",
    title: "Shared app-server port",
    status: ok ? "ok" : "warn",
    category: "shared",
    evidence: { port: value },
    recommendation: ok ? "" : "Set CYBERBOSS_SHARED_PORT to an integer between 1 and 65535.",
  });
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function checkReadyz(port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/readyz", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

module.exports = { runSharedChecks, checkReadyz };
