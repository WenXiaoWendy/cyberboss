const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { CyberbossApp } = require("../src/core/app");
const { SystemMessageQueueStore } = require("../src/core/system-message-queue-store");
const { BirthdayCareService, createBirthdayCareService } = require("../src/services/birthday-care-service");
const { ProjectToolHost } = require("../src/tools/tool-host");

function createFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-birthday-adapter-"));
  const config = {
    birthdayCareEnabled: true,
    birthdayCareFile: path.join(directory, "birthday-care.json"),
    birthdayTimezone: "Asia/Shanghai",
    birthdayCareCheckIntervalMs: 60 * 60 * 1000,
    workspaceId: "default",
    workspaceRoot: directory,
    allowedUserIds: ["fake-user"],
  };
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, config, service: new BirthdayCareService({ config }) };
}

function localTime(date, hour = "09:00:00") {
  return new Date(`${date}T${hour}+08:00`);
}

test("adapter tools call the external core and persist only versioned private state", async (t) => {
  const { config, service } = createFixture(t);
  const host = new ProjectToolHost({
    services: { birthday: service },
    runtimeContextStore: { resolveActiveContext() { return {}; } },
  });

  assert.equal(host.listTools().some((tool) => tool.name === "cyberboss_birthday_upsert"), true);
  const alice = await host.invokeTool("cyberboss_birthday_upsert", { name: "Alice", calendar: "solar", month: 8, day: 20 });
  await host.invokeTool("cyberboss_birthday_upsert", { name: "Bob", calendar: "lunar", month: 7, day: 7 });
  const upcoming = await host.invokeTool("cyberboss_birthday_upcoming", {});
  const marked = await host.invokeTool("cyberboss_birthday_mark", { friend: "Alice", status: "gift_ordered", year: 2026 });

  assert.equal(alice.text, "Birthday saved for Alice.");
  assert.match(upcoming.text, /Upcoming birthdays:/);
  assert.equal(marked.text, "Birthday care updated for Alice: gift ordered.");
  const persisted = JSON.parse(fs.readFileSync(config.birthdayCareFile, "utf8"));
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(JSON.stringify(persisted).toLowerCase().includes("deliveryaddress"), false);
});

test("queue insertion is idempotent across repeated checks and restart", async (t) => {
  const { directory, config, service } = createFixture(t);
  service.upsert({ id: "alice", name: "Alice", calendar: "solar", month: 8, day: 20 });
  const queue = new SystemMessageQueueStore({ filePath: path.join(directory, "system-messages.json") });
  const enqueue = (trigger) => queue.enqueue({
    id: trigger.id,
    accountId: "fake-account",
    senderId: "fake-user",
    workspaceRoot: directory,
    text: trigger.text,
    createdAt: trigger.createdAt,
  });

  const first = await service.processDue({ now: localTime("2026-08-13"), enqueue });
  const repeated = await service.processDue({ now: localTime("2026-08-13"), enqueue });
  const restarted = new BirthdayCareService({ config });
  const afterRestart = await restarted.processDue({ now: localTime("2026-08-13"), enqueue });

  assert.equal(first[0].id, "birthday:alice:2026:prepare");
  assert.deepEqual(repeated, []);
  assert.deepEqual(afterRestart, []);
  assert.equal(queue.drainForAccount("fake-account").length, 1);
  assert.match(first[0].text, /Send exactly one short reminder message now/);
  assert.doesNotMatch(first[0].text, /小彻/);
});

test("legacy in-repo data migrates once with a recoverable backup", (t) => {
  const { config } = createFixture(t);
  const legacy = {
    version: 1,
    friends: [{
      id: "alice", name: "Alice", calendar: "solar", month: 8, day: 20, leapMonth: false,
      timezone: "Asia/Shanghai", notes: "", prepareDaysBefore: 7, followupDaysBefore: 4,
      pickupDaysBefore: 2, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z"
    }],
    cycles: [{
      friendId: "alice", year: 2026, resolvedSolarDate: "2026-08-20",
      giftOrderedAt: "2026-08-10T00:00:00.000Z",
      stages: { prepare: { triggeredAt: "2026-08-13T00:00:00.000Z", sentAt: "2026-08-13T00:01:00.000Z" } }
    }]
  };
  fs.writeFileSync(config.birthdayCareFile, JSON.stringify(legacy), "utf8");
  const service = new BirthdayCareService({ config });
  const migrated = service.care.exportData();

  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.cycles[0].giftOrderedAt, "2026-08-10T00:00:00.000Z");
  assert.equal(migrated.cycles[0].prepareDeliveredAt, "2026-08-13T00:01:00.000Z");
  assert.equal(fs.existsSync(`${config.birthdayCareFile}.pre-birthday-care-agent-v1.bak`), true);
});

test("feature flag and initialization failure hide Birthday Care without affecting other tools", () => {
  assert.equal(createBirthdayCareService({ config: { birthdayCareEnabled: false } }), null);
  const warnings = [];
  const disabled = createBirthdayCareService({
    config: { birthdayCareEnabled: true, birthdayCareFile: "unused" },
    coreModule: {},
    logger: { warn(message) { warnings.push(message); } },
  });
  assert.equal(disabled, null);
  assert.match(warnings[0], /Birthday Care disabled/);

  const host = new ProjectToolHost({
    services: { diary: { append() {} } },
    runtimeContextStore: { resolveActiveContext() { return {}; } },
  });
  assert.equal(host.listTools().some((tool) => tool.name.startsWith("cyberboss_birthday_")), false);
  assert.equal(host.listTools().some((tool) => tool.name === "cyberboss_diary_append"), true);
});

test("app scheduler checks at startup, throttles later loops, and contains module failures", async (t) => {
  const { directory, config, service } = createFixture(t);
  service.upsert({ id: "alice", name: "Alice", calendar: "solar", month: 8, day: 20 });
  const queue = new SystemMessageQueueStore({ filePath: path.join(directory, "app-system-messages.json") });
  const appLike = createAppLike(config, service, queue, directory);

  const first = await CyberbossApp.prototype.flushDueBirthdays.call(appLike, { accountId: "fake-account" }, { now: localTime("2026-08-13") });
  const throttled = await CyberbossApp.prototype.flushDueBirthdays.call(appLike, { accountId: "fake-account" }, { now: localTime("2026-08-13", "09:30:00") });
  assert.equal(first.length, 1);
  assert.deepEqual(throttled, []);

  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(message);
  t.after(() => { console.error = originalError; });
  const failing = createAppLike(config, { async processDue() { throw new Error("fake module failure"); } }, queue, directory);
  const contained = await CyberbossApp.prototype.flushDueBirthdays.call(failing, { accountId: "fake-account" }, { now: localTime("2026-08-14") });
  assert.deepEqual(contained, []);
  assert.match(errors[0], /Birthday Care check failed: fake module failure/);
});

function createAppLike(config, birthday, systemMessageQueue, workspaceRoot) {
  return {
    config,
    nextBirthdayCareCheckAtMs: 0,
    projectServices: { birthday },
    systemMessageQueue,
    runtimeAdapter: {
      getSessionStore() {
        return {
          state: { bindings: {} },
          buildBindingKey() { return "fake-binding"; },
          getActiveWorkspaceRoot() { return workspaceRoot; },
          getBinding() { return null; },
        };
      },
    },
  };
}
