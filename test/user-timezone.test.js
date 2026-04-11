const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertValidUserTimezone,
  formatRuntimeLocalTimestamp,
} = require("../src/core/user-timezone");
const { readConfig } = require("../src/core/config");
const { buildCodexInboundText } = require("../src/core/codex-inbound-text");

test("formats runtime timestamp with UTC offset", () => {
  const value = formatRuntimeLocalTimestamp("2026-04-11T06:23:00.000Z", "Asia/Shanghai");
  assert.equal(value, "2026-04-11 14:23 UTC+08:00");
});

test("keeps empty timestamp empty", () => {
  assert.equal(formatRuntimeLocalTimestamp("", "Asia/Shanghai"), "");
});

test("keeps invalid timestamp input unchanged", () => {
  assert.equal(formatRuntimeLocalTimestamp("not-a-date", "Asia/Shanghai"), "not-a-date");
});

test("trims invalid timestamp input before returning it", () => {
  assert.equal(formatRuntimeLocalTimestamp("  not-a-date  ", "Asia/Shanghai"), "not-a-date");
});

test("rejects invalid timezone names", () => {
  assert.throws(
    () => assertValidUserTimezone("Mars/Base"),
    /Invalid CYBERBOSS_USER_TIMEZONE/
  );
});

test("rejects missing timezone values", () => {
  assert.throws(
    () => assertValidUserTimezone("   "),
    /CYBERBOSS_USER_TIMEZONE/
  );
});

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

test("buildCodexInboundText uses configured user timezone for runtime stamps", () => {
  const text = buildCodexInboundText(
    {
      text: "hello",
      receivedAt: "2026-04-11T06:23:00.000Z",
    },
    { saved: [], failed: [] },
    {
      userName: "Alan",
      userTimezone: "America/Los_Angeles",
    }
  );

  assert.equal(text, "[2026-04-10 23:23 UTC-07:00]\n\nhello");
});
