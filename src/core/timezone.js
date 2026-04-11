const DEFAULT_TIMEZONE = "UTC";
const LEGACY_TIMELINE_TIMEZONE = "Asia/Shanghai";

function normalizeTimezone(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return "";
  }
}

function resolveSystemTimezone() {
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return normalizeTimezone(systemTimezone) || DEFAULT_TIMEZONE;
}

function resolveConfiguredTimezone(value = "") {
  return normalizeTimezone(value) || resolveSystemTimezone();
}

function formatDateInTimezone(value, timezone) {
  const resolvedTimezone = resolveConfiguredTimezone(timezone);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: resolvedTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

module.exports = {
  DEFAULT_TIMEZONE,
  LEGACY_TIMELINE_TIMEZONE,
  formatDateInTimezone,
  normalizeTimezone,
  resolveConfiguredTimezone,
  resolveSystemTimezone,
};
