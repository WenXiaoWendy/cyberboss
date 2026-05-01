const fs = require("fs");
const path = require("path");
const { createCheck, createGroup } = require("../schema");
const { listCommandGroups } = require("../../core/command-registry");

const EXPECTED_TERMINAL = ["login", "accounts", "start", "doctor", "help", "shared start", "shared open", "shared status"];
const EXPECTED_WEIXIN = ["/bind", "/status", "/new", "/reread", "/compact", "/switch <threadId>", "/stop", "/checkin <min>-<max>", "/chunk <number>", "/yes", "/always", "/no", "/model", "/model <id>", "/star", "/help"];

function runCommandChecks() {
  let groups = [];
  try {
    groups = listCommandGroups();
  } catch (error) {
    return createGroup({
      id: "commands",
      title: "Commands",
      checks: [createCheck({ id: "commands.registry.load_failed", title: "Command registry", status: "fail", category: "config", evidence: { errorName: error?.name || "Error" } })],
    });
  }
  const terminal = groups.flatMap((group) => group.actions || []).flatMap((action) => action.terminal || []);
  const weixin = groups.flatMap((group) => group.actions || []).flatMap((action) => action.weixin || []);
  const missingTerminal = EXPECTED_TERMINAL.filter((item) => !terminal.includes(item));
  const missingWeixin = EXPECTED_WEIXIN.filter((item) => !weixin.includes(item));
  return createGroup({
    id: "commands",
    title: "Commands",
    checks: [
      createCheck({
        id: missingTerminal.length ? "commands.terminal.expected_missing" : "commands.terminal.expected_present",
        title: "Terminal commands",
        status: missingTerminal.length ? "fail" : "ok",
        category: "config",
        evidence: { missing: missingTerminal },
      }),
      createCheck({
        id: missingWeixin.length ? "commands.weixin.expected_missing" : "commands.weixin.expected_present",
        title: "WeChat commands",
        status: missingWeixin.length ? "fail" : "ok",
        category: "config",
        evidence: { missing: missingWeixin },
      }),
      checkDocsCommands(),
    ],
  });
}

function checkDocsCommands() {
  const docsPath = path.resolve(process.cwd(), "docs", "commands.md");
  if (!fs.existsSync(docsPath)) {
    return createCheck({ id: "commands.docs.missing", title: "Commands docs", status: "warn", category: "config", evidence: { exists: false } });
  }
  const text = fs.readFileSync(docsPath, "utf8");
  const missing = [...EXPECTED_WEIXIN, ...["npm run doctor", "npm run shared:start"]].filter((item) => !text.includes(item));
  return createCheck({
    id: missing.length ? "commands.docs.drift" : "commands.docs.current",
    title: "Commands docs drift",
    status: missing.length ? "warn" : "ok",
    category: "config",
    evidence: { missing },
  });
}

module.exports = { runCommandChecks };
