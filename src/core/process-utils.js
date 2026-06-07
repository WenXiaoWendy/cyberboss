const { execSync } = require("child_process");

function killPidTree(pid) {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return false;
  }
  if (numeric === process.pid) {
    console.warn('[cyberboss] FATAL PREVENTED: killPidTree called with current process PID! Refusing to suicide.');
    return false;
  }
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /F /T /PID ${numeric}`, {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  }
  try {
    process.kill(numeric, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

module.exports = { killPidTree };
