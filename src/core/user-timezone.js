function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

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

function buildUtcOffset(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit",
  }).formatToParts(date);
  const offsetPart = parts.find((part) => part.type === "timeZoneName")?.value;

  if (!offsetPart || offsetPart === "GMT") {
    return "UTC+00:00";
  }

  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetPart);
  if (!match) {
    return offsetPart.replace(/^GMT/, "UTC");
  }

  const [, sign, hours, minutes = "00"] = match;
  return `UTC${sign}${hours.padStart(2, "0")}:${minutes}`;
}

function formatRuntimeLocalTimestamp(receivedAt, timeZone) {
  if (receivedAt == null) {
    return "";
  }

  const normalizedTimestamp = String(receivedAt).trim();
  if (!normalizedTimestamp) {
    return "";
  }

  const normalizedTimezone = assertValidUserTimezone(timeZone);
  const parsed = new Date(normalizedTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return normalizedTimestamp;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizedTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(parsed);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute} ${buildUtcOffset(parsed, normalizedTimezone)}`;
}

module.exports = {
  assertValidUserTimezone,
  formatRuntimeLocalTimestamp,
};
