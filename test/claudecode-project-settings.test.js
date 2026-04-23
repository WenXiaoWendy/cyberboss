const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ensureClaudeProjectMcpConfig,
  buildClaudeProjectMcpServerConfig,
} = require("../src/adapters/runtime/claudecode/project-settings");

test("ensureClaudeProjectMcpConfig upserts cyberboss MCP server into workspace .mcp.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-claude-settings-"));
  const workspaceRoot = path.join(root, "workspace");
  const cyberbossHome = path.join(root, "cyberboss-home");
  const configPath = path.join(workspaceRoot, ".mcp.json");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(path.join(cyberbossHome, "bin"), { recursive: true });
  fs.writeFileSync(path.join(cyberbossHome, "bin", "cyberboss.js"), "#!/usr/bin/env node\n", "utf8");
  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      other: {
        command: "uvx",
        args: ["other"],
      },
    },
  }, null, 2));

  const result = ensureClaudeProjectMcpConfig({ workspaceRoot, cyberbossHome });
  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.equal(result.configPath, configPath);
  assert.deepEqual(saved.mcpServers.other, {
    command: "uvx",
    args: ["other"],
  });
  assert.deepEqual(saved.mcpServers.cyberboss_tools, buildClaudeProjectMcpServerConfig({
    workspaceRoot,
    cyberbossHome,
  }));
});

test("ensureClaudeProjectMcpConfig rewrites stale cyberboss MCP server config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-claude-settings-stale-"));
  const workspaceRoot = path.join(root, "workspace");
  const cyberbossHome = path.join(root, "cyberboss-home");
  const configPath = path.join(workspaceRoot, ".mcp.json");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(path.join(cyberbossHome, "bin"), { recursive: true });
  fs.writeFileSync(path.join(cyberbossHome, "bin", "cyberboss.js"), "#!/usr/bin/env node\n", "utf8");
  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      cyberboss_tools: {
        command: "node",
        args: ["old.js"],
      },
    },
  }, null, 2));

  ensureClaudeProjectMcpConfig({ workspaceRoot, cyberbossHome });

  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(saved.mcpServers.cyberboss_tools, buildClaudeProjectMcpServerConfig({
    workspaceRoot,
    cyberbossHome,
  }));
});
