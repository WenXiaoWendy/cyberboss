const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { resolveBodyInput } = require("../src/services/text-input");
const { buildTimelineFailureMessage, prepareTimelineInvocation } = require("../src/integrations/timeline");

const repoRoot = path.resolve(__dirname, "..");

function createTempFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-command-test-"));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

test("reminder body can be loaded from --text-file", async () => {
  const filePath = createTempFile("reminder.txt", "  remember me  \n");
  const body = await resolveBodyInput({ text: "", textFile: filePath });
  assert.equal(body, "remember me");
});

test("diary body can be loaded from --text-file", async () => {
  const filePath = createTempFile("diary.md", "\nline one\nline two\n");
  const body = await resolveBodyInput({ text: "", textFile: filePath });
  assert.equal(body, "line one\nline two");
});

test("timeline invocation translates --locale and --events-file", () => {
  const filePath = createTempFile("events.json", "[{\"title\":\"ship it\"}]");
  const prepared = prepareTimelineInvocation("write", [
    "--date", "2026-04-11",
    "--locale", "en",
    "--events-file", filePath,
  ]);

  assert.deepEqual(prepared.extraEnv, { TIMELINE_FOR_AGENT_LOCALE: "en" });
  assert.deepEqual(prepared.args, [
    "--date", "2026-04-11",
    "--json", "[{\"title\":\"ship it\"}]",
  ]);
});

test("timeline invocation rejects mixed json sources", () => {
  assert.throws(() => {
    prepareTimelineInvocation("write", ["--json", "[]", "--events-json", "[]"]);
  }, /Use only one of --json, --events-json, or --events-file/);
});

test("timeline failure message explains port conflicts", () => {
  const message = buildTimelineFailureMessage({
    subcommand: "serve",
    code: 1,
    stderr: "Error: listen EADDRINUSE: address already in use 127.0.0.1:4317",
  });
  assert.match(message, /port is already in use/i);
  assert.match(message, /4317/);
});

test("doctor --json prints diagnostics schema without bootstrapping state files", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-doctor-cli-"));
  const before = listRelativeFiles(stateDir);
  const result = spawnSync(process.execPath, ["./bin/cyberboss.js", "doctor", "--json"], {
    cwd: repoRoot,
    env: { ...process.env, CYBERBOSS_STATE_DIR: stateDir, CYBERBOSS_WORKSPACE_ROOT: repoRoot },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.schemaVersion, 1);
  assert.ok(Array.isArray(parsed.groups));
  assert.deepEqual(listRelativeFiles(stateDir), before);
});

test("doctor default text output uses diagnostics formatter", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-doctor-cli-"));
  const result = spawnSync(process.execPath, ["./bin/cyberboss.js", "doctor"], {
    cwd: repoRoot,
    env: { ...process.env, CYBERBOSS_STATE_DIR: stateDir, CYBERBOSS_WORKSPACE_ROOT: repoRoot },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Cyberboss Doctor/);
  assert.doesNotMatch(result.stdout, /"stateDir"/);
});

function listRelativeFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out = [];
  walk(dir, "");
  return out.sort();

  function walk(current, prefix) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, relative);
      } else {
        out.push(relative);
      }
    }
  }
}
