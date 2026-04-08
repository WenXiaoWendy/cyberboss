const http = require("http");
const {
  listenUrl,
  appServerPidFile,
  bridgePidFile,
  readPidFile,
  isPidAlive,
} = require("./shared-common");

async function main() {
  console.log(`listen=${listenUrl}`);
  printPidState("shared_app_server_pid", appServerPidFile);
  printPidState("shared_cyberboss_pid", bridgePidFile);
  console.log(`readyz=${await checkReadyz() ? "ok" : "down"}`);
}

function printPidState(label, filePath) {
  const pid = readPidFile(filePath);
  if (!pid) {
    console.log(`${label}=missing`);
    return;
  }
  if (!isPidAlive(pid)) {
    console.log(`${label}=stale`);
    return;
  }
  console.log(`${label}=${pid}`);
}

function checkReadyz() {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: new URL(listenUrl).port,
        path: "/readyz",
        timeout: 600,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
