const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { CyberbossApp } = require("../src/core/app");
const { BirthdayCareStore } = require("../src/core/birthday-care-store");
const { SystemMessageQueueStore } = require("../src/core/system-message-queue-store");
const {
  BirthdayCareService,
  resolveAnnualOccurrence,
} = require("../src/services/birthday-care-service");
const { ProjectToolHost } = require("../src/tools/tool-host");

function createFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-birthday-"));
  const filePath = path.join(directory, "birthday-care.json");
  const config = {
    birthdayCareFile: filePath,
    birthdayTimezone: "Asia/Shanghai",
  };
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    filePath,
    config,
    service: new BirthdayCareService({ config }),
  };
}

function localTime(date, hour = "09:00:00") {
  return new Date(`${date}T${hour}+08:00`);
}

test("solar birthdays recur across years and Feb 29 uses the documented Feb 28 policy", (t) => {
  const { service } = createFixture(t);
  service.upsert({ name: "Alice", calendar: "solar", month: 8, day: 20 });
  const leap = service.upsert({ name: "Leap", calendar: "solar", month: 2, day: 29 });

  assert.deepEqual(
    service.upcoming({ now: localTime("2026-08-21") }).map((item) => [item.name, item.nextSolarDate]),
    [["Leap", "2027-02-28"], ["Alice", "2027-08-20"]],
  );
  assert.equal(resolveAnnualOccurrence(leap, 2024).dateKey, "2024-02-29");
  assert.equal(resolveAnnualOccurrence(leap, 2025).dateKey, "2025-02-28");
  assert.equal(resolveAnnualOccurrence(leap, 2025).adjustment, "solar-feb29-to-feb28");
  assert.throws(
    () => service.upsert({ name: "Invalid", calendar: "solar", month: 4, day: 31 }),
    /does not exist/,
  );
});

test("lunar birthdays recalculate yearly, support leap months, clamp small months, and cross years", (t) => {
  const { service } = createFixture(t);
  const bob = service.upsert({ name: "Bob", calendar: "lunar", month: 7, day: 7 });
  const leap = service.upsert({ name: "Leap", calendar: "lunar", month: 6, day: 1, leapMonth: true });
  const monthEnd = service.upsert({ name: "MonthEnd", calendar: "lunar", month: 2, day: 30 });
  const yearEnd = service.upsert({ name: "YearEnd", calendar: "lunar", month: 12, day: 8 });

  assert.equal(resolveAnnualOccurrence(bob, 2025).dateKey, "2025-08-29");
  assert.notEqual(resolveAnnualOccurrence(bob, 2025).dateKey, resolveAnnualOccurrence(bob, 2026).dateKey);

  const leap2025 = resolveAnnualOccurrence(leap, 2025);
  assert.equal(leap2025.dateKey, "2025-07-25");
  assert.equal(leap2025.adjustment, "none");
  const leap2026 = resolveAnnualOccurrence(leap, 2026);
  assert.match(leap2026.adjustment, /lunar-leap-to-regular-month/);

  const clamped = resolveAnnualOccurrence(monthEnd, 2025);
  assert.match(clamped.adjustment, /lunar-day-clamped-to-month-end/);
  assert.equal(clamped.sourceLunarYear, 2025);

  const crossed = resolveAnnualOccurrence(yearEnd, 2026);
  assert.equal(crossed.sourceLunarYear, 2025);
  assert.match(crossed.dateKey, /^2026-/);
});

test("due processing covers T-7, T-4, T-2, T0, and the evening fallback once each", async (t) => {
  const { service } = createFixture(t);
  service.upsert({ name: "Alice", calendar: "solar", month: 8, day: 20 });
  const queued = [];
  const enqueue = (trigger) => queued.push(trigger);

  assert.equal((await service.processDue({ now: localTime("2026-08-13"), enqueue }))[0].stage, "prepare");
  assert.equal((await service.processDue({ now: localTime("2026-08-13"), enqueue })).length, 0);
  assert.equal((await service.processDue({ now: localTime("2026-08-16"), enqueue }))[0].stage, "followup");
  assert.equal((await service.processDue({ now: localTime("2026-08-18"), enqueue }))[0].stage, "pickup");
  assert.equal((await service.processDue({ now: localTime("2026-08-20", "09:00:00"), enqueue }))[0].stage, "birthday");
  assert.equal((await service.processDue({ now: localTime("2026-08-20", "19:00:00"), enqueue }))[0].stage, "birthday-evening");
  assert.equal((await service.processDue({ now: localTime("2026-08-20", "20:00:00"), enqueue })).length, 0);

  assert.deepEqual(queued.map((item) => item.stage), [
    "prepare",
    "followup",
    "pickup",
    "birthday",
    "birthday-evening",
  ]);
  assert.equal(new Set(queued.map((item) => item.id)).size, 5);
});

test("completed actions suppress their stages and no delivery address is stored", async (t) => {
  const { service, filePath } = createFixture(t);
  service.upsert({ name: "Alice", calendar: "solar", month: 8, day: 20 });
  service.mark({ name: "Alice", status: "address_asked", year: 2026 }, { now: localTime("2026-08-12") });
  service.mark({ name: "Alice", status: "gift_ordered", year: 2026 }, { now: localTime("2026-08-12") });
  assert.equal((await service.processDue({
    now: localTime("2026-08-13"),
    enqueue() {
      throw new Error("should not enqueue");
    },
  })).length, 0);
  assert.equal((await service.processDue({
    now: localTime("2026-08-16"),
    enqueue() {
      throw new Error("should not enqueue");
    },
  })).length, 0);

  service.mark({ name: "Alice", status: "pickup_reminded", year: 2026 }, { now: localTime("2026-08-17") });
  assert.equal(service.collectDue({ now: localTime("2026-08-18") }).length, 0);
  service.mark({ name: "Alice", status: "birthday_wished", year: 2026 }, { now: localTime("2026-08-20") });
  assert.equal(service.collectDue({ now: localTime("2026-08-20", "19:00:00") }).length, 0);

  const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal("address" in persisted.cycles[0], false);
  assert.ok(persisted.cycles[0].addressAskedAt);
});

test("offline catch-up emits only the most useful current stage and restart remains idempotent", async (t) => {
  const { config } = createFixture(t);
  const first = new BirthdayCareService({ config });
  first.upsert({ name: "Alice", calendar: "solar", month: 8, day: 20 });
  const queued = [];

  const caughtUp = await first.processDue({
    now: localTime("2026-08-15"),
    enqueue: (trigger) => queued.push(trigger),
  });
  assert.deepEqual(caughtUp.map((item) => item.stage), ["prepare"]);

  const restarted = new BirthdayCareService({ config });
  assert.equal((await restarted.processDue({
    now: localTime("2026-08-15"),
    enqueue: (trigger) => queued.push(trigger),
  })).length, 0);

  const lateCatchUp = await restarted.processDue({
    now: localTime("2026-08-19"),
    enqueue: (trigger) => queued.push(trigger),
  });
  assert.deepEqual(lateCatchUp.map((item) => item.stage), ["pickup"]);
  assert.equal(queued.some((item) => item.stage === "followup"), false);

  const nextYear = await restarted.processDue({
    now: localTime("2027-08-13"),
    enqueue: (trigger) => queued.push(trigger),
  });
  assert.equal(nextYear[0].id.endsWith(":2027:prepare"), true);
});

test("deterministic trigger ids prevent queue duplicates even before cycle state is committed", (t) => {
  const { directory, service } = createFixture(t);
  service.upsert({ name: "Alice", calendar: "solar", month: 8, day: 20 });
  const queue = new SystemMessageQueueStore({ filePath: path.join(directory, "system-messages.json") });
  const trigger = service.collectDue({ now: localTime("2026-08-13") })[0];
  const message = {
    id: trigger.id,
    accountId: "fake-account",
    senderId: "fake-user",
    workspaceRoot: directory,
    text: trigger.text,
    createdAt: trigger.createdAt,
  };
  queue.enqueue(message);
  queue.enqueue(message);
  assert.equal(queue.drainForAccount("fake-account").length, 1);
});

test("upcoming birthdays sort by actual resolved solar date", (t) => {
  const { service } = createFixture(t);
  service.upsert({ name: "Alice", calendar: "solar", month: 8, day: 20 });
  service.upsert({ name: "Bob", calendar: "lunar", month: 7, day: 7 });
  service.upsert({ name: "Early", calendar: "solar", month: 8, day: 10 });

  const upcoming = service.upcoming({ now: localTime("2025-08-01") });
  assert.deepEqual(upcoming.map((item) => item.name), ["Early", "Alice", "Bob"]);
  assert.deepEqual(upcoming.map((item) => item.nextSolarDate), ["2025-08-10", "2025-08-20", "2025-08-29"]);
});

test("natural Birthday Care tools persist fake Alice and Bob records", async (t) => {
  const { config } = createFixture(t);
  const birthday = new BirthdayCareService({ config });
  const host = new ProjectToolHost({
    services: { birthday },
    runtimeContextStore: { resolveActiveContext() { return {}; } },
  });

  const alice = await host.invokeTool("cyberboss_birthday_upsert", {
    name: "Alice",
    calendar: "solar",
    month: 8,
    day: 20,
  });
  const bob = await host.invokeTool("cyberboss_birthday_upsert", {
    name: "Bob",
    calendar: "lunar",
    month: 7,
    day: 7,
  });
  const list = await host.invokeTool("cyberboss_birthday_list", {});
  const upcoming = await host.invokeTool("cyberboss_birthday_upcoming", {});
  const marked = await host.invokeTool("cyberboss_birthday_mark", {
    friend: "Alice",
    status: "gift_ordered",
    year: 2026,
  });

  assert.equal(alice.text, "Birthday saved for Alice.");
  assert.equal(bob.text, "Birthday saved for Bob.");
  assert.equal(list.text, "Saved birthdays: Alice, Bob.");
  assert.match(upcoming.text, /Upcoming birthdays:/);
  assert.equal(marked.text, "Birthday care updated for Alice: gift ordered.");

  const restartedStore = new BirthdayCareStore({ filePath: config.birthdayCareFile });
  assert.deepEqual(restartedStore.listFriends().map((item) => item.name), ["Alice", "Bob"]);
  assert.ok(restartedStore.getCycle(alice.data.id, 2026).giftOrderedAt);
});

test("Cyberboss app writes birthday due work into the existing system-message queue", async (t) => {
  const { directory, service } = createFixture(t);
  service.upsert({ name: "Alice", calendar: "solar", month: 8, day: 20 });
  const queue = new SystemMessageQueueStore({ filePath: path.join(directory, "system-queue.json") });
  const originalDate = global.Date;
  const fixedNow = localTime("2026-08-13");
  class FixedDate extends originalDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow.getTime()]));
    }
    static now() {
      return fixedNow.getTime();
    }
  }
  global.Date = FixedDate;
  t.after(() => {
    global.Date = originalDate;
  });

  const appLike = {
    config: {
      workspaceId: "default",
      workspaceRoot: directory,
      allowedUserIds: ["fake-user"],
    },
    projectServices: { birthday: service },
    systemMessageQueue: queue,
    runtimeAdapter: {
      getSessionStore() {
        return {
          state: { bindings: {} },
          buildBindingKey() { return "fake-binding"; },
          getActiveWorkspaceRoot() { return ""; },
          getBinding() { return null; },
        };
      },
    },
  };

  const processed = await CyberbossApp.prototype.flushDueBirthdays.call(appLike, { accountId: "fake-account" });
  assert.equal(processed.length, 1);
  const drained = queue.drainForAccount("fake-account");
  assert.equal(drained.length, 1);
  assert.equal(drained[0].id.endsWith(":2026:prepare"), true);
  assert.match(drained[0].text, /Respond naturally in the current persona/);
  assert.doesNotMatch(drained[0].text, /小彻/);
});
