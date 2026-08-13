const crypto = require("crypto");

const { Lunar, LunarYear } = require("lunar-javascript");

const { BirthdayCareStore, STAGE_NAMES } = require("../core/birthday-care-store");

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_PREPARE_DAYS = 7;
const DEFAULT_FOLLOWUP_DAYS = 4;
const DEFAULT_PICKUP_DAYS = 2;
const EVENING_HOUR = 18;
const MARK_FIELDS = {
  address_asked: "addressAskedAt",
  gift_ordered: "giftOrderedAt",
  pickup_reminded: "pickupRemindedAt",
  birthday_wished: "birthdayWishedAt",
};

class BirthdayCareService {
  constructor({ config, store = null }) {
    this.config = config || {};
    this.timezone = normalizeTimezone(this.config.birthdayTimezone || DEFAULT_TIMEZONE);
    this.store = store || new BirthdayCareStore({ filePath: this.config.birthdayCareFile });
  }

  upsert(input = {}) {
    const reference = normalizeText(input.id) || normalizeText(input.name);
    const existing = reference ? this.store.findFriend(reference) : null;
    const nowIso = new Date().toISOString();
    const calendar = normalizeCalendar(input.calendar || existing?.calendar || "solar");
    const month = readInteger(input.month, existing?.month);
    const day = readInteger(input.day, existing?.day);
    const name = normalizeText(input.name) || existing?.name || "";
    const timezone = normalizeTimezone(input.timezone || existing?.timezone || this.timezone);
    const leapMonth = calendar === "lunar"
      ? readBoolean(input.leapMonth, existing?.leapMonth || false)
      : false;

    if (!name) {
      throw new Error("Birthday name is required.");
    }
    validateBirthdayDate({ calendar, month, day });

    const friend = {
      id: existing?.id || normalizeText(input.id) || crypto.randomUUID(),
      name,
      calendar,
      month,
      day,
      leapMonth,
      timezone,
      notes: input.notes === undefined ? existing?.notes || "" : normalizeText(input.notes),
      prepareDaysBefore: readNonNegativeInteger(input.prepareDaysBefore, existing?.prepareDaysBefore, DEFAULT_PREPARE_DAYS),
      followupDaysBefore: readNonNegativeInteger(input.followupDaysBefore, existing?.followupDaysBefore, DEFAULT_FOLLOWUP_DAYS),
      pickupDaysBefore: readNonNegativeInteger(input.pickupDaysBefore, existing?.pickupDaysBefore, DEFAULT_PICKUP_DAYS),
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    validateStageOffsets(friend);
    return this.store.upsertFriend(friend);
  }

  list() {
    return this.store.listFriends();
  }

  upcoming({ limit = 20, now = new Date() } = {}) {
    const normalizedNow = normalizeDate(now);
    const normalizedLimit = readNonNegativeInteger(limit, 20, 20);
    return this.store.listFriends()
      .map((friend) => {
        const local = getZonedDateTimeParts(normalizedNow, friend.timezone);
        const today = buildDateKey(local.year, local.month, local.day);
        let occurrence = resolveAnnualOccurrence(friend, local.year);
        if (dateKeyToOrdinal(occurrence.dateKey) < dateKeyToOrdinal(today)) {
          occurrence = resolveAnnualOccurrence(friend, local.year + 1);
        }
        return {
          id: friend.id,
          name: friend.name,
          calendar: friend.calendar,
          month: friend.month,
          day: friend.day,
          leapMonth: friend.leapMonth,
          timezone: friend.timezone,
          nextSolarDate: occurrence.dateKey,
          year: occurrence.year,
          daysUntil: dateKeyToOrdinal(occurrence.dateKey) - dateKeyToOrdinal(today),
          dateAdjustment: occurrence.adjustment,
        };
      })
      .sort(compareUpcoming)
      .slice(0, normalizedLimit);
  }

  mark({ id = "", name = "", status = "", year = undefined, at = "" } = {}, { now = new Date() } = {}) {
    const friend = this.requireFriend(id || name);
    const field = MARK_FIELDS[normalizeText(status).toLowerCase()];
    if (!field) {
      throw new Error(`Unknown birthday status: ${status}.`);
    }
    const normalizedNow = normalizeDate(now);
    const cycleYear = Number.isInteger(Number(year))
      ? Number(year)
      : resolveMarkCycleYear(friend, normalizedNow);
    const occurrence = resolveAnnualOccurrence(friend, cycleYear);
    const nowIso = normalizeOptionalIso(at) || normalizedNow.toISOString();
    this.store.ensureCycle({
      friendId: friend.id,
      year: cycleYear,
      resolvedSolarDate: occurrence.dateKey,
      sourceLunarYear: occurrence.sourceLunarYear,
      nowIso,
    });
    const cycle = this.store.updateCycle(friend.id, cycleYear, (draft) => {
      draft[field] = nowIso;
      draft.updatedAt = nowIso;
      return draft;
    });
    return { friend, cycle, status: normalizeText(status).toLowerCase() };
  }

  remove({ id = "", name = "" } = {}) {
    const removed = this.store.removeFriend(id || name);
    if (!removed) {
      throw new Error("Birthday record not found.");
    }
    return removed;
  }

  async processDue({ now = new Date(), enqueue } = {}) {
    if (typeof enqueue !== "function") {
      throw new Error("Birthday due processing requires an enqueue function.");
    }
    const normalizedNow = normalizeDate(now);
    const candidates = this.collectDue({ now: normalizedNow });
    const processed = [];
    for (const candidate of candidates) {
      await enqueue(candidate);
      const cycle = this.markStageTriggered(candidate.friendId, candidate.year, candidate.stage, normalizedNow);
      processed.push({ ...candidate, cycle });
    }
    return processed;
  }

  collectDue({ now = new Date() } = {}) {
    const normalizedNow = normalizeDate(now);
    const due = [];
    for (const friend of this.store.listFriends()) {
      const local = getZonedDateTimeParts(normalizedNow, friend.timezone);
      const today = buildDateKey(local.year, local.month, local.day);
      const todayOrdinal = dateKeyToOrdinal(today);
      const candidateYears = [local.year, local.year + 1];
      for (const year of candidateYears) {
        const occurrence = resolveAnnualOccurrence(friend, year);
        const daysUntil = dateKeyToOrdinal(occurrence.dateKey) - todayOrdinal;
        if (daysUntil < 0 || daysUntil > friend.prepareDaysBefore) {
          continue;
        }
        const cycle = this.store.ensureCycle({
          friendId: friend.id,
          year,
          resolvedSolarDate: occurrence.dateKey,
          sourceLunarYear: occurrence.sourceLunarYear,
          nowIso: normalizedNow.toISOString(),
        });
        const stage = selectDueStage({ friend, cycle, daysUntil, localHour: local.hour });
        if (!stage) {
          continue;
        }
        due.push(buildDueTrigger({
          friend,
          cycle,
          stage,
          daysUntil,
          occurrence,
          now: normalizedNow,
        }));
        break;
      }
    }
    return due.sort((left, right) => left.id.localeCompare(right.id));
  }

  markStageTriggered(friendId, year, stage, now = new Date()) {
    assertStageName(stage);
    const nowIso = normalizeDate(now).toISOString();
    return this.store.updateCycle(friendId, year, (draft) => {
      if (!draft.stages[stage].triggeredAt) {
        draft.stages[stage].triggeredAt = nowIso;
        draft.updatedAt = nowIso;
      }
      return draft;
    });
  }

  markStageSentByTriggerId(triggerId, now = new Date()) {
    const parsed = parseBirthdayTriggerId(triggerId);
    if (!parsed) {
      return null;
    }
    const nowIso = normalizeDate(now).toISOString();
    const existing = this.store.getCycle(parsed.friendId, parsed.year);
    if (!existing) {
      return null;
    }
    return this.store.updateCycle(parsed.friendId, parsed.year, (draft) => {
      if (!draft.stages[parsed.stage].sentAt) {
        draft.stages[parsed.stage].sentAt = nowIso;
        draft.updatedAt = nowIso;
      }
      return draft;
    });
  }

  requireFriend(reference) {
    const friend = this.store.findFriend(reference);
    if (!friend) {
      throw new Error(`Birthday record not found: ${normalizeText(reference) || "unknown"}.`);
    }
    return friend;
  }
}

function resolveAnnualOccurrence(friend, solarYear) {
  const year = Number(solarYear);
  if (!Number.isInteger(year)) {
    throw new Error("Birthday year must be an integer.");
  }
  if (friend.calendar === "solar") {
    const daysInMonth = getSolarMonthDays(year, friend.month);
    let day = friend.day;
    let adjustment = "none";
    if (friend.month === 2 && friend.day === 29 && daysInMonth === 28) {
      day = 28;
      adjustment = "solar-feb29-to-feb28";
    }
    return {
      year,
      dateKey: buildDateKey(year, friend.month, day),
      sourceLunarYear: null,
      adjustment,
    };
  }

  for (const lunarYear of [year - 1, year]) {
    const lunarMonth = resolveLunarMonth(lunarYear, friend.month, friend.leapMonth);
    if (!lunarMonth) {
      continue;
    }
    const resolvedDay = Math.min(friend.day, lunarMonth.getDayCount());
    const lunar = Lunar.fromYmd(lunarYear, lunarMonth.getMonth(), resolvedDay);
    const solar = lunar.getSolar();
    if (solar.getYear() !== year) {
      continue;
    }
    const adjustmentParts = [];
    if (friend.leapMonth && lunarMonth.getMonth() > 0) {
      adjustmentParts.push("lunar-leap-to-regular-month");
    }
    if (resolvedDay !== friend.day) {
      adjustmentParts.push("lunar-day-clamped-to-month-end");
    }
    return {
      year,
      dateKey: buildDateKey(solar.getYear(), solar.getMonth(), solar.getDay()),
      sourceLunarYear: lunarYear,
      adjustment: adjustmentParts.join(",") || "none",
    };
  }
  throw new Error(`Unable to resolve lunar birthday for solar year ${year}.`);
}

function resolveLunarMonth(lunarYear, month, preferLeapMonth) {
  const lunarMonths = LunarYear.fromYear(lunarYear).getMonths()
    .filter((candidate) => candidate.getYear() === lunarYear);
  if (preferLeapMonth) {
    const leap = lunarMonths.find((candidate) => candidate.getMonth() === -month);
    if (leap) {
      return leap;
    }
  }
  return lunarMonths.find((candidate) => candidate.getMonth() === month) || null;
}

function selectDueStage({ friend, cycle, daysUntil, localHour }) {
  if (daysUntil === 0) {
    if (cycle.birthdayWishedAt) {
      return "";
    }
    const stage = localHour >= EVENING_HOUR ? "birthday-evening" : "birthday";
    return cycle.stages[stage].triggeredAt ? "" : stage;
  }

  const candidates = [
    { name: "pickup", threshold: friend.pickupDaysBefore, relevant: !cycle.pickupRemindedAt },
    { name: "followup", threshold: friend.followupDaysBefore, relevant: !cycle.giftOrderedAt },
    {
      name: "prepare",
      threshold: friend.prepareDaysBefore,
      relevant: !cycle.addressAskedAt || !cycle.giftOrderedAt,
    },
  ];
  const candidate = candidates.find(({ name, threshold, relevant }) => (
    relevant && daysUntil <= threshold && !cycle.stages[name].triggeredAt
  ));
  return candidate?.name || "";
}

function buildDueTrigger({ friend, cycle, stage, daysUntil, occurrence, now }) {
  const id = `birthday:${friend.id}:${cycle.year}:${stage}`;
  const status = {
    addressAsked: !!cycle.addressAskedAt,
    giftOrdered: !!cycle.giftOrderedAt,
    pickupReminded: !!cycle.pickupRemindedAt,
    birthdayWished: !!cycle.birthdayWishedAt,
  };
  const stageGuidance = {
    prepare: "Help the user ask for this year's delivery address if still needed and prepare the gift.",
    followup: "The gift is not marked ordered yet; give one useful, caring follow-up.",
    pickup: "Prompt a logistics check or a pickup note if it is still useful.",
    birthday: "Help the user send a birthday wish today.",
    "birthday-evening": "It is later on the birthday and no wish is marked; give one light fallback nudge.",
  }[stage];
  const text = [
    `Birthday Care is due for ${friend.name}.`,
    `Occurrence: ${occurrence.dateKey}; stage: ${stage}; days until birthday: ${daysUntil}.`,
    `Current cycle status: address asked=${status.addressAsked}; gift ordered=${status.giftOrdered}; pickup reminded=${status.pickupReminded}; birthday wished=${status.birthdayWished}.`,
    stageGuidance,
    "Respond naturally in the current persona. Do not repeat completed actions, expose internal ids/JSON/tool names, or invent/store a delivery address.",
  ].join(" ");
  return {
    id,
    friendId: friend.id,
    friendName: friend.name,
    year: cycle.year,
    stage,
    resolvedSolarDate: occurrence.dateKey,
    daysUntil,
    text,
    createdAt: now.toISOString(),
  };
}

function resolveMarkCycleYear(friend, now) {
  const local = getZonedDateTimeParts(now, friend.timezone);
  const todayOrdinal = dateKeyToOrdinal(buildDateKey(local.year, local.month, local.day));
  const nextOccurrence = resolveAnnualOccurrence(friend, local.year + 1);
  if (todayOrdinal >= dateKeyToOrdinal(nextOccurrence.dateKey) - friend.prepareDaysBefore) {
    return local.year + 1;
  }
  return local.year;
}

function parseBirthdayTriggerId(value) {
  const match = normalizeText(value).match(/^birthday:(.+):(\d{4}):(prepare|followup|pickup|birthday|birthday-evening)$/);
  if (!match) {
    return null;
  }
  return { friendId: match[1], year: Number(match[2]), stage: match[3] };
}

function validateBirthdayDate({ calendar, month, day }) {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Birthday month must be from 1 to 12.");
  }
  if (!Number.isInteger(day) || day < 1) {
    throw new Error("Birthday day must be a positive integer.");
  }
  if (calendar === "lunar") {
    if (day > 30) {
      throw new Error("Lunar birthday day must be from 1 to 30.");
    }
    return;
  }
  const representativeDays = getSolarMonthDays(2024, month);
  if (day > representativeDays) {
    throw new Error("That solar calendar date does not exist.");
  }
}

function validateStageOffsets(friend) {
  if (friend.prepareDaysBefore < friend.followupDaysBefore || friend.followupDaysBefore < friend.pickupDaysBefore) {
    throw new Error("Birthday stage offsets must satisfy prepare >= followup >= pickup.");
  }
}

function assertStageName(stage) {
  if (!STAGE_NAMES.includes(stage)) {
    throw new Error(`Unknown birthday stage: ${stage}.`);
  }
}

function getZonedDateTimeParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function normalizeTimezone(value) {
  const normalized = normalizeText(value) || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: normalized }).format(new Date());
  } catch {
    throw new Error(`Invalid birthday timezone: ${normalized}.`);
  }
  return normalized;
}

function getSolarMonthDays(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function buildDateKey(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateKeyToOrdinal(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function compareUpcoming(left, right) {
  if (left.nextSolarDate !== right.nextSolarDate) {
    return left.nextSolarDate.localeCompare(right.nextSolarDate);
  }
  return left.name.localeCompare(right.name);
}

function normalizeDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Invalid birthday reference time.");
  }
  return date;
}

function normalizeOptionalIso(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error("Birthday status time must be a valid ISO timestamp.");
  }
  return new Date(parsed).toISOString();
}

function normalizeCalendar(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized !== "solar" && normalized !== "lunar") {
    throw new Error("Birthday calendar must be solar or lunar.");
  }
  return normalized;
}

function readInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return Number(fallback);
  }
  return Number(value);
}

function readNonNegativeInteger(value, fallback, defaultValue) {
  const candidate = value === undefined || value === null || value === ""
    ? fallback === undefined || fallback === null ? defaultValue : fallback
    : value;
  const parsed = Number(candidate);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Birthday reminder offsets must be non-negative integers.");
  }
  return parsed;
}

function readBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback === true;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  BirthdayCareService,
  buildDateKey,
  dateKeyToOrdinal,
  parseBirthdayTriggerId,
  resolveAnnualOccurrence,
};
