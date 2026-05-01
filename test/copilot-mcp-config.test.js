const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const {
  resolveCopilotProjectToolMcpServerConfig,
} = require("../src/adapters/runtime/copilot/mcp-config");

test("resolveCopilotProjectToolMcpServerConfig points at bin/cyberboss.js with runtime-id flag", () => {
  const config = resolveCopilotProjectToolMcpServerConfig();
  assert.ok(config, "expected mcp server config when bin/cyberboss.js exists");
  assert.equal(config.name, "cyberboss_tools");
  assert.equal(config.command, process.execPath);
  // Args shape: [<scriptPath>, "tool-mcp-server", "--runtime-id", "copilot"]
  assert.ok(config.args[0].endsWith(path.join("bin", "cyberboss.js")));
  assert.equal(config.args[1], "tool-mcp-server");
  assert.equal(config.args[2], "--runtime-id");
  assert.equal(config.args[3], "copilot");
});

test("resolveCopilotProjectToolMcpServerConfig honors CYBERBOSS_HOME override and returns null when missing", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-mcp-test-"));
  try {
    // No bin/cyberboss.js inside this temp dir → null.
    const missing = resolveCopilotProjectToolMcpServerConfig({ cyberbossHome: tmpHome });
    assert.equal(missing, null);

    // Now drop a stub script at the expected path and expect a config back.
    fs.mkdirSync(path.join(tmpHome, "bin"), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, "bin", "cyberboss.js"), "#!/usr/bin/env node\n");
    const present = resolveCopilotProjectToolMcpServerConfig({ cyberbossHome: tmpHome });
    assert.ok(present);
    assert.equal(present.args[0], path.join(tmpHome, "bin", "cyberboss.js"));
    assert.equal(present.args[3], "copilot");
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
