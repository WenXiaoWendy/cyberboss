const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { buildTimelineFailureMessage } = require("../src/integrations/timeline");

test("timeline integration does not write child output to process stdio", async () => {
  const integrationPath = path.resolve(__dirname, "../src/integrations/timeline/index.js");
  const childProcess = require("node:child_process");
  const originalSpawn = childProcess.spawn;
  const originalModule = require.cache[integrationPath];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const writes = [];

  childProcess.spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => {
      child.stdout.emit("data", Buffer.from("timeline build ok\n", "utf8"));
      child.stderr.emit("data", Buffer.from("warning line\n", "utf8"));
      child.emit("exit", 0, null);
    });
    return child;
  };

  process.stdout.write = (chunk, ...rest) => {
    writes.push(["stdout", String(chunk)]);
    return originalStdoutWrite.call(process.stdout, chunk, ...rest);
  };
  process.stderr.write = (chunk, ...rest) => {
    writes.push(["stderr", String(chunk)]);
    return originalStderrWrite.call(process.stderr, chunk, ...rest);
  };

  delete require.cache[integrationPath];

  try {
    const { createTimelineIntegration } = require(integrationPath);
    const integration = createTimelineIntegration({ stateDir: "/tmp/cyberboss-state" });
    const result = await integration.runSubcommand("build", []);
    assert.match(result.stdout, /timeline build ok/);
    assert.match(result.stderr, /warning line/);
    assert.deepEqual(writes, []);
  } finally {
    childProcess.spawn = originalSpawn;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    delete require.cache[integrationPath];
    if (originalModule) {
      require.cache[integrationPath] = originalModule;
    }
  }
});

test("timeline failure message prefers the root error over stack tail", () => {
  const message = buildTimelineFailureMessage({
    subcommand: "write",
    code: 1,
    stderr: [
      "Error: Invalid timeline event at index 1: title is missing and eventNodeId cannot backfill it",
      "    at /Users/tingyiwen/Dev/cyberboss/node_modules/timeline-for-agent/src/infra/timeline/timeline-store.js:356:13",
      "    at withTimelineWriteLock (/Users/tingyiwen/Dev/cyberboss/node_modules/timeline-for-agent/src/application/timeline/shared.js:64:18)",
    ].join("\n"),
  });
  assert.match(message, /Invalid timeline event at index 1: title is missing and eventNodeId cannot backfill it/);
  assert.doesNotMatch(message, /withTimelineWriteLock/);
});
