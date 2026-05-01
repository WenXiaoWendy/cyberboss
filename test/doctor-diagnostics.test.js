const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createCheck, createGroup, summarizeGroups } = require("../src/diagnostics/schema");
const { redactSecret, redactId, redactPath } = require("../src/diagnostics/redact");
const { formatJsonReport } = require("../src/diagnostics/format-json");
const { formatTextReport } = require("../src/diagnostics/format-text");
const { parseDoctorOptions } = require("../src/diagnostics/options");
const { runDoctor } = require("../src/diagnostics");
const { runStickerCapabilityChecks } = require("../src/diagnostics/checks/capabilities");
const { runSharedChecks } = require("../src/diagnostics/checks/shared");
const { runToolsChecks } = require("../src/diagnostics/checks/tools");

test("diagnostics schema aggregates failure and warning counts", () => {
  const groups = [
    createGroup({
      id: "weixin",
      title: "WeChat",
      checks: [
        createCheck({ id: "weixin.ok", title: "ok", status: "ok", category: "account" }),
        createCheck({ id: "weixin.fail", title: "fail", status: "fail", category: "account" }),
        createCheck({ id: "weixin.warn", title: "warn", status: "warn", category: "account" }),
        createCheck({ id: "weixin.skip", title: "skip", status: "skip", category: "account" }),
        createCheck({ id: "weixin.unknown", title: "unknown", status: "unknown", category: "account" }),
      ],
    }),
  ];

  assert.deepEqual(summarizeGroups(groups), {
    status: "fail",
    issueCount: 1,
    warningCount: 1,
    skippedCount: 1,
    unknownCount: 1,
  });
});

test("diagnostics formatters never print raw secrets", () => {
  const secret = "sk-test12345678901234567890";
  const report = {
    schemaVersion: 1,
    generatedAt: "2026-05-01T00:00:00.000Z",
    options: { network: false, unsafeVerbose: false },
    summary: { status: "fail", issueCount: 1, warningCount: 0, skippedCount: 0, unknownCount: 0 },
    environment: {},
    groups: [
      createGroup({
        id: "privacy",
        title: "Privacy",
        checks: [
          createCheck({
            id: "privacy.secret",
            title: "Secret",
            status: "fail",
            category: "privacy",
            evidence: {
              token: redactSecret(secret),
              nested: { authorization: redactSecret(`Bearer ${secret}`) },
            },
          }),
        ],
      }),
    ],
  };

  assert.doesNotMatch(formatJsonReport(report), new RegExp(secret));
  assert.doesNotMatch(formatTextReport(report), new RegExp(secret));
});

test("unsafe verbose still keeps secrets redacted", () => {
  const secret = "Bearer abcdefghijklmnopqrstuvwxyz";
  assert.notEqual(redactSecret(secret), secret);
  assert.match(redactId("user-abcdef123456", { unsafeVerbose: false }), /hash=/);
  assert.equal(redactPath("/tmp/cyberboss/project", { unsafeVerbose: true }), "/tmp/cyberboss/project");
});

test("parseDoctorOptions supports json network unsafe verbose and report", () => {
  assert.deepEqual(parseDoctorOptions(["doctor", "--json", "--network", "--unsafe-verbose", "--report", "doctor.md"]), {
    json: true,
    network: true,
    unsafeVerbose: true,
    reportFile: "doctor.md",
  });
});

test("runDoctor returns stable top-level schema", async () => {
  const report = await runDoctor(makeConfig(), { now: () => new Date("2026-05-01T00:00:00Z") });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.generatedAt, "2026-05-01T00:00:00.000Z");
  assert.ok(Array.isArray(report.groups));
  assert.equal(typeof report.summary.status, "string");
  assert.equal(report.options.network, false);
  assert.equal(report.options.unsafeVerbose, false);
});

test("runDoctor keeps reporting when one diagnostics group crashes", async () => {
  const report = await runDoctor(makeConfig(), {
    now: fixedNow,
    checkGroups: [{
      id: "broken",
      title: "Broken",
      run() {
        throw new Error("simulated failure");
      },
    }],
  });

  assert.equal(report.summary.status, "fail");
  assertCheck(report, "diagnostics.group.crashed", "fail");
  assert.equal(report.groups[0].id, "broken");
});

test("configuration check fails when workspace root is missing", async () => {
  const config = makeConfig({ workspaceRoot: path.join(tempDir(), "missing") });
  const report = await runDoctor(config, { now: fixedNow });
  assertCheck(report, "configuration.workspace_root.missing", "fail");
});

test("state check reports corrupted json state files", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "sessions.json"), "{bad", "utf8");
  const config = makeConfig({ stateDir: dir, sessionsFile: path.join(dir, "sessions.json") });
  const report = await runDoctor(config, { now: fixedNow });
  assertCheck(report, "state.sessions_json.invalid", "fail");
});

test("environment check includes node and package metadata", async () => {
  const report = await runDoctor(makeConfig(), { now: fixedNow });
  assertCheck(report, "environment.node.version", "ok");
  assertCheck(report, "environment.package.version", "ok");
});

test("weixin check fails on multiple accounts without selection", async () => {
  const config = makeConfig();
  writeAccount(config, "acc-a", { token: "token-a", userId: "user-a" });
  writeAccount(config, "acc-b", { token: "token-b", userId: "user-b" });
  const report = await runDoctor(config, { now: fixedNow });
  assertCheck(report, "weixin.accounts.multiple_without_selection", "fail");
  assertNoRaw(report, "token-a");
  assertNoRaw(report, "user-a");
});

test("weixin media check warns when selected user has no context token", async () => {
  const config = makeConfig({ accountId: "acc-a", allowedUserIds: ["user-a"] });
  writeAccount(config, "acc-a", { token: "token-a", userId: "user-a" });
  const report = await runDoctor(config, { now: fixedNow });
  assertCheck(report, "weixin.media.context_token.missing_for_allowed_user", "warn");
});

test("runtime check treats ccswitch as claudecode compatible launcher", async () => {
  const config = makeConfig({ runtime: "claudecode", claudeCommand: "ccswitch" });
  const report = await runDoctor(config, { now: fixedNow });
  assertCheck(report, "runtime.claudecode.launcher.custom_command", "warn");
  assertCheck(report, "runtime.claudecode.protocol.unprobed", "unknown");
});

test("sticker capability detects corrupted local index", async () => {
  const config = makeConfig();
  fs.mkdirSync(path.dirname(config.stickersIndexFile), { recursive: true });
  fs.writeFileSync(config.stickersIndexFile, "{bad", "utf8");
  const report = await runDoctor(config, { now: fixedNow });
  assertCheck(report, "capabilities.stickers.local_index.invalid_json", "fail");
});

test("checkin capability warns when target cannot be resolved", async () => {
  const config = makeConfig({ startWithCheckin: true, allowedUserIds: [] });
  writeAccount(config, "acc-a", { token: "token-a", userId: "" });
  const report = await runDoctor(config, { now: fixedNow });
  assertCheck(report, "capabilities.checkin.target_user.unresolved", "warn");
});

test("tools check includes sticker timeline and whereabouts tools", async () => {
  const report = await runDoctor(makeConfig(), { now: fixedNow });
  assertCheck(report, "tools.core.expected_present", "ok");
  assertCheck(report, "tools.stickers.expected_present", "ok");
});

test("tools check skips sticker expectations when the project has no sticker capability", () => {
  const group = runToolsChecks({
    config: {},
    toolNames: [
      "cyberboss_diary_append",
      "cyberboss_reminder_create",
      "cyberboss_system_send",
      "cyberboss_channel_send_file",
      "cyberboss_timeline_read",
      "cyberboss_timeline_categories",
      "cyberboss_timeline_proposals",
      "cyberboss_timeline_write",
      "cyberboss_timeline_build",
      "cyberboss_timeline_serve",
      "cyberboss_timeline_dev",
      "cyberboss_timeline_screenshot",
    ],
  });

  assert.equal(group.status, "ok");
  assert.equal(findCheck({ groups: [group] }, "tools.stickers.not_applicable").status, "skip");
});

test("filesystem diagnostics degrade unreadable or mistyped paths to checks", () => {
  const stateDir = tempDir();
  const logsDir = path.join(stateDir, "logs");
  fs.mkdirSync(path.join(logsDir, "shared-app-server.pid"), { recursive: true });
  const sharedGroup = runSharedChecks({ config: { stateDir }, options: {} });
  assert.equal(findCheck({ groups: [sharedGroup] }, "shared.app_server_pid.unreadable").status, "warn");

  const stickerAssetsDir = path.join(stateDir, "not-a-directory");
  fs.writeFileSync(stickerAssetsDir, "asset placeholder", "utf8");
  const stickerGroup = runStickerCapabilityChecks({
    config: { stickersDir: stateDir, stickerAssetsDir },
    options: {},
  });
  assert.equal(findCheck({ groups: [stickerGroup] }, "capabilities.stickers.assets.unreadable").status, "warn");
});

test("network checks are skipped unless network option is set", async () => {
  const report = await runDoctor(makeConfig(), { now: fixedNow, networkProbe: async () => ({ ok: true }) });
  assertNoCheck(report, "network.weixin_base_url.reachable");
});

test("network check records timeout class without leaking token", async () => {
  const config = makeConfig({ accountId: "acc-a" });
  writeAccount(config, "acc-a", { token: "token-secret", userId: "user-a" });
  const report = await runDoctor(config, {
    now: fixedNow,
    network: true,
    networkProbe: async () => ({ ok: false, errorCode: "timeout", statusCode: 0 }),
  });
  assertCheck(report, "network.weixin_base_url.timeout", "warn");
  assertNoRaw(report, "token-secret");
});

function assertCheck(report, id, status) {
  const check = findCheck(report, id);
  assert.ok(check, `Expected check ${id}`);
  assert.equal(check.status, status);
}

function assertNoCheck(report, id) {
  assert.equal(findCheck(report, id), undefined);
}

function findCheck(report, id) {
  return (report.groups || [])
    .flatMap((group) => group.checks || [])
    .find((check) => check.id === id);
}

function assertNoRaw(report, text) {
  assert.doesNotMatch(JSON.stringify(report), new RegExp(escapeRegExp(text)));
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-doctor-test-"));
}

function fixedNow() {
  return new Date("2026-05-01T00:00:00Z");
}

function makeConfig(overrides = {}) {
  const stateDir = overrides.stateDir || tempDir();
  return {
    runtime: "codex",
    channel: "weixin",
    stateDir,
    workspaceRoot: process.cwd(),
    allowedUserIds: [],
    accountId: "",
    accountsDir: path.join(stateDir, "accounts"),
    syncBufferDir: path.join(stateDir, "sync-buffers"),
    weixinBaseUrl: "https://ilinkai.weixin.qq.com",
    weixinCdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
    codexEndpoint: "",
    codexCommand: "",
    claudeCommand: "claude",
    claudeModel: "",
    claudeContextWindow: undefined,
    claudeMaxOutputTokens: undefined,
    sharedPort: "8765",
    sessionsFile: path.join(stateDir, "sessions.json"),
    weixinConfigFile: path.join(stateDir, "weixin-config.json"),
    checkinConfigFile: path.join(stateDir, "checkin-config.json"),
    systemMessageQueueFile: path.join(stateDir, "system-message-queue.json"),
    deferredSystemReplyQueueFile: path.join(stateDir, "deferred-system-replies.json"),
    timelineScreenshotQueueFile: path.join(stateDir, "timeline-screenshot-queue.json"),
    projectToolContextFile: path.join(stateDir, "project-tool-runtime-context.json"),
    locationStoreFile: path.join(stateDir, "locations.json"),
    weixinInstructionsFile: path.join(stateDir, "weixin-instructions.md"),
    weixinOperationsFile: path.resolve(process.cwd(), "templates", "weixin-operations.md"),
    timelineCommand: "timeline-for-agent",
    timelineScreenshotQueueFile: path.join(stateDir, "timeline-screenshot-queue.json"),
    stickersDir: path.join(stateDir, "stickers"),
    stickerAssetsDir: path.join(stateDir, "stickers", "assets"),
    stickersIndexFile: path.join(stateDir, "stickers", "index.json"),
    stickerTagsFile: path.join(stateDir, "stickers", "tags.json"),
    stickersTemplateDir: path.resolve(process.cwd(), "templates", "stickers"),
    stickersTemplateIndexFile: path.resolve(process.cwd(), "templates", "stickers", "index.json"),
    stickerTagsTemplateFile: path.resolve(process.cwd(), "templates", "stickers", "tags.json"),
    diaryDir: path.join(stateDir, "diary"),
    reminderQueueFile: path.join(stateDir, "reminder-queue.json"),
    startWithCheckin: false,
    ...overrides,
  };
}

function writeAccount(config, accountId, data = {}) {
  fs.mkdirSync(config.accountsDir, { recursive: true });
  fs.writeFileSync(path.join(config.accountsDir, `${accountId}.json`), JSON.stringify({
    accountId,
    rawAccountId: accountId,
    token: data.token || "",
    userId: data.userId || "",
    baseUrl: data.baseUrl || config.weixinBaseUrl,
    savedAt: data.savedAt || "2026-05-01T00:00:00.000Z",
  }, null, 2));
}
