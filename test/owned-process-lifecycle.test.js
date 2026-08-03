const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const {
  launchOwnedChild,
} = require("../src/core/owned-process-lifecycle");
const {
  createChildIpcLifecycle,
} = require("../src/core/child-ipc-lifecycle");
const {
  captureSqliteBaseline,
  compareSqliteBaseline,
} = require("../src/core/sqlite-baseline");

class FakeStream extends EventEmitter {
  constructor() {
    super();
    this.forwarded = [];
  }
}

class FakeChild extends EventEmitter {
  constructor({ pid = 41001, executable = "C:\\runtime\\node.exe" } = {}) {
    super();
    this.pid = pid;
    this.spawnfile = executable;
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.exitCode = null;
    this.signalCode = null;
    this.sent = [];
    this.killCalls = 0;
  }

  send(message) {
    this.sent.push(message);
    return true;
  }

  kill() {
    this.killCalls += 1;
    throw new Error("Tests must never terminate a process.");
  }

  finish(code = 0) {
    this.exitCode = code;
    this.emit("exit", code, null);
  }
}

function launchFixture(overrides = {}) {
  const child = overrides.child || new FakeChild();
  const timers = [];
  const controller = launchOwnedChild({
    spawnImpl(executable, args, options) {
      assert.equal(options.shell, false);
      assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe", "ipc"]);
      assert.equal(executable, "C:\\runtime\\node.exe");
      assert.deepEqual(args, ["C:\\repo\\bin\\cyberboss.js", "start"]);
      return child;
    },
    executable: "C:\\runtime\\node.exe",
    args: ["C:\\repo\\bin\\cyberboss.js", "start"],
    cwd: "C:\\repo",
    env: { SAFE: "true" },
    runToken: "run-token-1",
    parentPid: 30001,
    protectedPids: [30001, 30002],
    now: () => 1_000_000,
    scheduleTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearScheduledTimeout() {},
    stdout: new FakeStream(),
    stderr: new FakeStream(),
    ...overrides,
  });
  return { child, controller, timers };
}

function bootMessage(overrides = {}) {
  return {
    type: "cyberboss.lifecycle.boot",
    runToken: "run-token-1",
    pid: 41001,
    ppid: 30001,
    executable: "C:\\runtime\\node.exe",
    startedAtMs: 999_500,
    ...overrides,
  };
}

test("readiness failure never performs global matching or process termination", async () => {
  const desktop = new FakeChild({ pid: 90001, executable: "C:\\Program Files\\OpenAI\\Codex.exe" });
  const { child, controller, timers } = launchFixture();
  timers[0]();
  await assert.rejects(controller.ready, /readiness timeout/i);
  const result = await controller.requestStop();
  assert.equal(result.stopped, false);
  assert.equal(result.reason, "identity_unverified");
  assert.equal(child.killCalls, 0);
  assert.equal(desktop.killCalls, 0);
});

test("Codex Desktop app-server is protected and never becomes an owned candidate", () => {
  const desktop = new FakeChild({ pid: 30002, executable: "C:\\Program Files\\OpenAI\\Codex.exe" });
  assert.throws(() => launchFixture({ child: desktop }), /protected process/i);
  assert.equal(desktop.killCalls, 0);
  assert.deepEqual(desktop.sent, []);
});

test("a PowerShell command containing the repository path is never inspected or matched", () => {
  const decoy = new FakeChild({ pid: 51001, executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" });
  decoy.commandLine = "audit C:\\repo without starting anything";
  const { controller } = launchFixture();
  assert.equal(controller.record.pid, 41001);
  assert.equal(decoy.killCalls, 0);
  assert.deepEqual(decoy.sent, []);
});

test("PID reuse or a changed child handle refuses cleanup", async () => {
  const { child, controller } = launchFixture();
  child.emit("message", bootMessage());
  child.pid = 41002;
  const result = await controller.requestStop();
  assert.equal(result.stopped, false);
  assert.equal(result.reason, "pid_changed");
  assert.deepEqual(child.sent, []);
  assert.equal(child.killCalls, 0);
});

test("an executable identity change refuses cleanup", async () => {
  const { child, controller } = launchFixture();
  child.emit("message", bootMessage());
  child.spawnfile = "C:\\runtime\\different.exe";
  const result = await controller.requestStop();
  assert.equal(result.stopped, false);
  assert.equal(result.reason, "executable_changed");
  assert.deepEqual(child.sent, []);
  assert.equal(child.killCalls, 0);
});

test("start time or run token mismatch refuses identity", async () => {
  for (const message of [
    bootMessage({ startedAtMs: 900_000 }),
    bootMessage({ runToken: "wrong-token" }),
  ]) {
    const { child, controller } = launchFixture();
    child.emit("message", message);
    const result = await controller.requestStop();
    assert.equal(result.stopped, false);
    assert.equal(result.reason, "identity_unverified");
    assert.deepEqual(child.sent, []);
    assert.equal(child.killCalls, 0);
  }
});

test("only the exact verified root receives a cooperative stop request", async () => {
  const descendant = new FakeChild({ pid: 42001 });
  const outsider = new FakeChild({ pid: 43001 });
  const { child, controller } = launchFixture();
  child.emit("message", bootMessage());
  child.emit("message", {
    type: "cyberboss.lifecycle.ready",
    runToken: "run-token-1",
    pid: 41001,
  });
  await controller.ready;
  const stop = controller.requestStop();
  assert.deepEqual(child.sent, [{
    type: "cyberboss.lifecycle.stop",
    runToken: "run-token-1",
  }]);
  child.finish(0);
  const result = await stop;
  assert.equal(result.stopped, true);
  assert.equal(descendant.killCalls, 0);
  assert.equal(outsider.killCalls, 0);
  assert.equal(child.killCalls, 0);
});

test("readiness is proven by IPC and stdout/stderr remain pipes", async () => {
  const { child, controller } = launchFixture();
  child.emit("message", bootMessage());
  child.emit("message", {
    type: "cyberboss.lifecycle.ready",
    runToken: "run-token-1",
    pid: 41001,
  });
  const ready = await controller.ready;
  assert.equal(ready.pid, 41001);
  assert.equal(controller.record.identityVerified, true);
});

test("child IPC lifecycle ignores a wrong token and queues an exact stop until registration", async () => {
  const processRef = new EventEmitter();
  processRef.pid = 41001;
  processRef.ppid = 30001;
  processRef.execPath = "C:\\runtime\\node.exe";
  processRef.uptime = () => 0.5;
  processRef.env = { CYBERBOSS_RUN_TOKEN: "run-token-1" };
  processRef.sent = [];
  processRef.send = (message) => processRef.sent.push(message);
  let stopCalls = 0;
  const lifecycle = createChildIpcLifecycle({
    processRef,
    now: () => 1_000_000,
  });
  lifecycle.markReady();
  processRef.emit("message", {
    type: "cyberboss.lifecycle.stop",
    runToken: "wrong-token",
  });
  processRef.emit("message", {
    type: "cyberboss.lifecycle.stop",
    runToken: "run-token-1",
  });
  assert.equal(stopCalls, 0);
  lifecycle.registerStop(async () => {
    stopCalls += 1;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopCalls, 1);
  assert.deepEqual(processRef.sent.map((message) => message.type), [
    "cyberboss.lifecycle.boot",
    "cyberboss.lifecycle.ready",
    "cyberboss.lifecycle.stopping",
  ]);
  lifecycle.dispose();
});

test("Unicode SQLite paths preserve hashes and sidecar comparisons", () => {
  const root = fs.mkdtempSync(path.join(__dirname, ".星星 SQLite 基线-"));
  try {
    const database = path.join(root, "记忆.sqlite3");
    fs.writeFileSync(database, "stable-memory");
    const baseline = captureSqliteBaseline(database);
    assert.equal(baseline.databasePath, path.resolve(database));
    assert.equal(compareSqliteBaseline(baseline).unchanged, true);
    fs.writeFileSync(database, "changed-memory");
    assert.equal(compareSqliteBaseline(baseline).hashUnchanged, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
