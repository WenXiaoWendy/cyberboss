# User Timezone Awareness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make runtime-facing inbound message timestamps use a required user-configured timezone, rendered as a human-readable local timestamp with UTC offset.

**Architecture:** Keep the change narrow. Add one small timezone helper module, validate `CYBERBOSS_USER_TIMEZONE` during config loading, and replace the hardcoded `Asia/Shanghai` formatting in runtime-bound inbound text generation. Leave storage, queues, and scheduling logic unchanged.

**Tech Stack:** Node.js 22, CommonJS, `node:test`, built-in `Intl.DateTimeFormat`

---

### Task 1: Add a small timezone helper with tests

**Files:**
- Create: `src/core/user-timezone.js`
- Create: `test/user-timezone.test.js`

**Step 1: Write the failing test**

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertValidUserTimezone,
  formatRuntimeLocalTimestamp,
} = require("../src/core/user-timezone");

test("formats runtime timestamp with UTC offset", () => {
  const value = formatRuntimeLocalTimestamp("2026-04-11T06:23:00.000Z", "Asia/Shanghai");
  assert.equal(value, "2026-04-11 14:23 UTC+08:00");
});

test("keeps empty timestamp empty", () => {
  assert.equal(formatRuntimeLocalTimestamp("", "Asia/Shanghai"), "");
});

test("rejects invalid timezone names", () => {
  assert.throws(
    () => assertValidUserTimezone("Mars/Base"),
    /Invalid CYBERBOSS_USER_TIMEZONE/
  );
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/user-timezone.test.js`
Expected: FAIL because `../src/core/user-timezone` does not exist yet.

**Step 3: Write minimal implementation**

```js
function assertValidUserTimezone(timeZone) {
  const normalized = normalizeText(timeZone);
  if (!normalized) {
    throw new Error("Missing required env CYBERBOSS_USER_TIMEZONE.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date());
  } catch {
    throw new Error(`Invalid CYBERBOSS_USER_TIMEZONE: ${normalized}`);
  }
  return normalized;
}

function formatRuntimeLocalTimestamp(receivedAt, timeZone) {
  const value = normalizeText(receivedAt);
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(parsed);

  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const offset = buildUtcOffset(parsed, timeZone);
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute} ${offset}`;
}
```

Also add a small internal `buildUtcOffset()` helper that uses `timeZoneName: "longOffset"` and returns strings like `UTC+08:00`.

**Step 4: Run test to verify it passes**

Run: `node --test test/user-timezone.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/user-timezone.test.js src/core/user-timezone.js
git commit -m "feat: add user timezone formatting helper"
```

### Task 2: Require and validate `CYBERBOSS_USER_TIMEZONE` in config

**Files:**
- Modify: `src/core/config.js:4-38`
- Test: `test/user-timezone.test.js`

**Step 1: Extend the failing test with config coverage**

Add a focused test that temporarily sets env vars and verifies `readConfig()` returns a validated `userTimezone`.

```js
const { readConfig } = require("../src/core/config");

test("readConfig exposes validated userTimezone", () => {
  const previous = process.env.CYBERBOSS_USER_TIMEZONE;
  process.env.CYBERBOSS_USER_TIMEZONE = "Asia/Shanghai";
  try {
    const config = readConfig();
    assert.equal(config.userTimezone, "Asia/Shanghai");
  } finally {
    if (previous == null) {
      delete process.env.CYBERBOSS_USER_TIMEZONE;
    } else {
      process.env.CYBERBOSS_USER_TIMEZONE = previous;
    }
  }
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/user-timezone.test.js`
Expected: FAIL because `readConfig()` does not yet return `userTimezone`.

**Step 3: Write minimal implementation**

In `src/core/config.js`:

- import `assertValidUserTimezone` from `./user-timezone`
- read `CYBERBOSS_USER_TIMEZONE`
- store the validated value as `userTimezone`

Implementation shape:

```js
const { assertValidUserTimezone } = require("./user-timezone");

userTimezone: assertValidUserTimezone(readTextEnv("CYBERBOSS_USER_TIMEZONE")),
```

Do not add fallback-to-machine-timezone behavior.

**Step 4: Run test to verify it passes**

Run: `node --test test/user-timezone.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/config.js test/user-timezone.test.js
git commit -m "feat: require configured user timezone"
```

### Task 3: Replace the hardcoded runtime timestamp formatting

**Files:**
- Modify: `src/core/app.js:1418-1479`
- Test: `test/user-timezone.test.js`

**Step 1: Add a failing runtime-format test**

Export a small pure function from `src/core/app.js`, or better, keep the logic in `src/core/user-timezone.js` and test the helper instead of testing `CyberbossApp` end-to-end. Add one regression test that captures the current formatting contract used by inbound runtime text.

```js
test("runtime stamp matches prompt-friendly format", () => {
  const value = formatRuntimeLocalTimestamp("2026-04-11T06:23:00.000Z", "Asia/Shanghai");
  assert.equal(value, "2026-04-11 14:23 UTC+08:00");
});
```

If this test already exists from Task 1, reuse it instead of duplicating it.

**Step 2: Run test to verify current app code is still using the old formatter**

Run: `npm run check`
Expected: PASS before the code change. This is a baseline syntax check before editing runtime code.

**Step 3: Write minimal implementation**

In `src/core/app.js`:

- import `formatRuntimeLocalTimestamp` from `./user-timezone`
- in `buildCodexInboundText(normalized, persisted, config)`, replace:

```js
const localTime = formatWechatLocalTime(normalized?.receivedAt);
```

with:

```js
const localTime = formatRuntimeLocalTimestamp(normalized?.receivedAt, config?.userTimezone);
```

- delete the old hardcoded `formatWechatLocalTime()` helper

This keeps all runtime-bound inbound text on the configured timezone because `buildCodexInboundText()` already receives `config`.

**Step 4: Run verification**

Run: `node --test test/user-timezone.test.js && npm run check`
Expected: all tests PASS, syntax check PASS.

**Step 5: Commit**

```bash
git add src/core/app.js src/core/user-timezone.js test/user-timezone.test.js
git commit -m "fix: use configured user timezone in runtime message stamps"
```

### Task 4: Document the new required env var

**Files:**
- Modify: `README.md:127-151`
- Modify: `README.en.md:128-149`
- Modify: `README.zh-CN.md:131-153`

**Step 1: Write the failing documentation expectation**

No automated test needed. Use a manual checklist:

- setup example includes `CYBERBOSS_USER_TIMEZONE`
- docs say it is required
- docs say it represents the user's current timezone
- docs say traveling users should update it

**Step 2: Update the docs**

Add `CYBERBOSS_USER_TIMEZONE` to each environment example and the surrounding explanation.

Suggested wording theme:

- `CYBERBOSS_USER_TIMEZONE=Asia/Shanghai`
- this controls how inbound message times are shown to the runtime
- update it when the user travels to a new timezone

**Step 3: Run verification**

Run: `node --test test/user-timezone.test.js && npm run check`
Expected: PASS.

Then manually read the edited README sections to confirm the wording is consistent across all three files.

**Step 4: Commit**

```bash
git add README.md README.en.md README.zh-CN.md
git commit -m "docs: document required user timezone config"
```

### Task 5: Final verification

**Files:**
- Verify only: `src/core/config.js`, `src/core/app.js`, `src/core/user-timezone.js`, `test/user-timezone.test.js`, `README.md`, `README.en.md`, `README.zh-CN.md`

**Step 1: Run the focused test suite**

Run: `node --test test/user-timezone.test.js`
Expected: PASS.

**Step 2: Run the repository syntax checks**

Run: `npm run check`
Expected: PASS.

**Step 3: Smoke-check the behavior manually**

Use a representative sample timestamp such as `2026-04-11T06:23:00.000Z` and confirm the runtime-facing stamp would render as:

```text
[2026-04-11 14:23 UTC+08:00]
```

when `CYBERBOSS_USER_TIMEZONE=Asia/Shanghai`.

Also confirm there is no remaining hardcoded `Asia/Shanghai` in runtime timestamp formatting.

**Step 4: Commit**

```bash
git add src/core/config.js src/core/app.js src/core/user-timezone.js test/user-timezone.test.js README.md README.en.md README.zh-CN.md
git commit -m "feat: add user timezone awareness"
```
