const path = require("path");

const {
  BOOT_MESSAGE,
  READY_MESSAGE,
  STOP_MESSAGE,
} = require("./owned-process-lifecycle");

function createChildIpcLifecycle({
  processRef = process,
  now = Date.now,
} = {}) {
  const runToken = normalizeText(processRef?.env?.CYBERBOSS_RUN_TOKEN);
  if (!runToken || typeof processRef?.send !== "function") {
    throw new Error("Safe bridge child requires an authenticated IPC lifecycle.");
  }

  const identity = {
    runToken,
    pid: normalizePid(processRef.pid),
    ppid: normalizePid(processRef.ppid),
    executable: path.resolve(processRef.execPath),
    startedAtMs: now() - (Number(processRef.uptime?.()) || 0) * 1000,
  };
  let stopHandler = null;
  let stopping = false;
  let stopRequested = false;

  const onMessage = (message) => {
    if (message?.type !== STOP_MESSAGE
      || normalizeText(message.runToken) !== runToken
      || stopping) {
      return;
    }
    stopRequested = true;
    invokeStop();
  };

  const invokeStop = () => {
    if (!stopRequested || stopping || typeof stopHandler !== "function") {
      return;
    }
    stopping = true;
    processRef.send({
      type: "cyberboss.lifecycle.stopping",
      runToken,
      pid: identity.pid,
    });
    Promise.resolve().then(stopHandler).catch(() => {});
  };

  processRef.on("message", onMessage);
  processRef.send({
    type: BOOT_MESSAGE,
    ...identity,
  });

  return {
    registerStop(handler) {
      if (typeof handler !== "function") {
        throw new Error("Safe bridge lifecycle stop handler is required.");
      }
      stopHandler = handler;
      invokeStop();
    },
    markReady() {
      processRef.send({
        type: READY_MESSAGE,
        runToken,
        pid: identity.pid,
      });
    },
    dispose() {
      processRef.off("message", onMessage);
      stopHandler = null;
    },
  };
}

function normalizePid(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  createChildIpcLifecycle,
};
