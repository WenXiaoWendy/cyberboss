const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildAgentCommandGuide, buildAgentCommandReminder } = require("../src/core/command-registry");
const { resolveBody: resolveReminderBody } = require("../src/app/reminder-write-cli");
const { resolveBody: resolveDiaryBody } = require("../src/app/diary-write-cli");
const { prepareTimelineInvocation } = require("../src/integrations/timeline");

function createTempFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-command-test-"));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

test("agent command reminder stays short and avoids npm prefix env", () => {
  const reminder = buildAgentCommandReminder();
  assert.match(reminder, /trust workspace help only/i);
  assert.doesNotMatch(reminder, /CYBERBOSS_HOME/);
  assert.doesNotMatch(reminder, /npm --prefix/);
});

test("scoped command guide uses the cyberboss launcher for the requested topic only", () => {
  const guide = buildAgentCommandGuide(["reminder"]);
  assert.match(guide, /REMINDER COMMAND HELP/);
  assert.match(guide, /bin[\\/]+cyberboss(?:\.cmd)?/);
  assert.doesNotMatch(guide, /TIMELINE COMMAND HELP/);
  assert.doesNotMatch(guide, /CYBERBOSS_HOME/);
  assert.doesNotMatch(guide, /npm --prefix/);
});

test("timeline command guide shows a valid event payload shape", () => {
  const guide = buildAgentCommandGuide(["timeline"]);
  assert.match(guide, /"events":\[/);
  assert.match(guide, /"startAt":/);
  assert.match(guide, /"endAt":/);
  assert.match(guide, /"subcategoryId":/);
});

test("reminder body can be loaded from --text-file", async () => {
  const filePath = createTempFile("reminder.txt", "  remember me  \n");
  const body = await resolveReminderBody({ text: "", textFile: filePath, useStdin: false });
  assert.equal(body, "remember me");
});

test("diary body can be loaded from --text-file", async () => {
  const filePath = createTempFile("diary.md", "\nline one\nline two\n");
  const body = await resolveDiaryBody({ text: "", textFile: filePath, useStdin: false });
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
