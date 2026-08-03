const path = require("path");

const BOOT_MESSAGE = "cyberboss.lifecycle.boot";
const READY_MESSAGE = "cyberboss.lifecycle.ready";
const STOP_MESSAGE = "cyberboss.lifecycle.stop";
const DEFAULT_READINESS_TIMEOUT_MS = 45_000;
const DEFAULT_STOP_TIMEOUT_MS = 45_000;
const START_TIME_TOLERANCE_MS = 5_000;

function launchOwnedChild({
  spawnImpl,
  executable,
  args,
  cwd,
  env,
  runToken,
  parentPid,
  protectedPids = [],
  now = Date.now,
  scheduleTimeout = setTimeout,
  clearScheduledTimeout = clearTimeout,
  readinessTimeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  if (typeof spawnImpl !== "function") {
    throw new Error("Owned child launch requires an explicit spawn implementation.");
  }
  const normalizedExecutable = normalizePath(executable);
  const normalizedRunToken = normalizeText(runToken);
  if (!normalizedExecutable || !normalizedRunToken) {
    throw new Error("Owned child launch requires an executable and unique run token.");
  }

  const spawnedAtMs = now();
  const child = spawnImpl(executable, [...args], {
    cwd,
    env: {
      ...env,
      CYBERBOSS_RUN_TOKEN: normalizedRunToken,
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const childPid = normalizePid(child?.pid);
  if (!child || !childPid) {
    throw new Error("Owned child launch did not return a valid ChildProcess handle.");
  }
  const protectedSet = new Set(
    protectedPids.map(normalizePid).filter(Boolean),
  );
  if (protectedSet.has(childPid)) {
    throw new Error("Owned child launch refused a protected process identity.");
  }

  forwardPipe(child.stdout, stdout);
  forwardPipe(child.stderr, stderr);

  const record = {
    child,
    pid: childPid,
    parentPid: normalizePid(parentPid),
    spawnedAtMs,
    executable: normalizedExecutable,
    runToken: normalizedRunToken,
    identityVerified: false,
    readyVerified: false,
  };

  let resolveReady;
  let rejectReady;
  let readySettled = false;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let resolveExit;
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });

  const readinessTimer = scheduleTimeout(() => {
    if (readySettled) {
      return;
    }
    readySettled = true;
    rejectReady(new Error("Owned child readiness timeout."));
  }, readinessTimeoutMs);

  const onMessage = (message) => {
    if (message?.type === BOOT_MESSAGE) {
      record.identityVerified = validateBootIdentity(message, record);
      return;
    }
    if (message?.type !== READY_MESSAGE || readySettled) {
      return;
    }
    if (!record.identityVerified
      || normalizeText(message.runToken) !== record.runToken
      || normalizePid(message.pid) !== record.pid) {
      return;
    }
    record.readyVerified = true;
    readySettled = true;
    clearScheduledTimeout(readinessTimer);
    resolveReady({
      pid: record.pid,
      spawnedAtMs: record.spawnedAtMs,
      executable: record.executable,
    });
  };
  const onExit = (code, signal) => {
    clearScheduledTimeout(readinessTimer);
    if (!readySettled) {
      readySettled = true;
      rejectReady(new Error("Owned child exited before readiness."));
    }
    resolveExit({ code, signal });
  };
  const onError = (error) => {
    if (!readySettled) {
      readySettled = true;
      clearScheduledTimeout(readinessTimer);
      rejectReady(error);
    }
  };

  child.on("message", onMessage);
  child.once("exit", onExit);
  child.once("error", onError);

  async function requestStop() {
    const refusal = verifyOwnedHandle(record, protectedSet);
    if (refusal) {
      return {
        stopped: false,
        reason: refusal,
        residualPid: record.pid,
      };
    }

    try {
      child.send({
        type: STOP_MESSAGE,
        runToken: record.runToken,
      });
    } catch {
      return {
        stopped: false,
        reason: "stop_request_failed",
        residualPid: record.pid,
      };
    }
    let stopTimer;
    const timeout = new Promise((resolve) => {
      stopTimer = scheduleTimeout(() => resolve({ timeout: true }), stopTimeoutMs);
    });
    const outcome = await Promise.race([exited, timeout]);
    clearScheduledTimeout(stopTimer);
    if (outcome?.timeout) {
      return {
        stopped: false,
        reason: "shutdown_timeout",
        residualPid: record.pid,
      };
    }
    return {
      stopped: true,
      code: outcome.code,
      signal: outcome.signal,
    };
  }

  function dispose() {
    clearScheduledTimeout(readinessTimer);
    child.off("message", onMessage);
    child.off("exit", onExit);
    child.off("error", onError);
  }

  return {
    record,
    ready,
    exited,
    requestStop,
    dispose,
  };
}

function validateBootIdentity(message, record) {
  const startedAtMs = Number(message?.startedAtMs);
  return normalizeText(message?.runToken) === record.runToken
    && normalizePid(message?.pid) === record.pid
    && normalizePid(message?.ppid) === record.parentPid
    && normalizePath(message?.executable) === record.executable
    && Number.isFinite(startedAtMs)
    && Math.abs(startedAtMs - record.spawnedAtMs) <= START_TIME_TOLERANCE_MS;
}

function verifyOwnedHandle(record, protectedSet) {
  if (!record.identityVerified) {
    return "identity_unverified";
  }
  if (!record.child || normalizePid(record.child.pid) !== record.pid) {
    return "pid_changed";
  }
  if (protectedSet.has(record.pid)) {
    return "protected_process";
  }
  if (normalizePath(record.child.spawnfile) !== record.executable) {
    return "executable_changed";
  }
  if (record.child.exitCode != null || record.child.signalCode != null) {
    return "already_exited";
  }
  return "";
}

function forwardPipe(source, destination) {
  if (!source || typeof source.on !== "function"
    || !destination || typeof destination.write !== "function") {
    return;
  }
  source.on("data", (chunk) => destination.write(chunk));
}

function normalizePid(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePath(value) {
  const normalized = normalizeText(value);
  return normalized ? path.resolve(normalized).toLowerCase() : "";
}

module.exports = {
  BOOT_MESSAGE,
  READY_MESSAGE,
  STOP_MESSAGE,
  launchOwnedChild,
};
