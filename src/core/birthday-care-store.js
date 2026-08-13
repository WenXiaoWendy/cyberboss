const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STORE_VERSION = 1;
const STAGE_NAMES = ["prepare", "followup", "pickup", "birthday", "birthday-evening"];

class BirthdayCareStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = createEmptyState();
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.state = {
        version: STORE_VERSION,
        friends: Array.isArray(parsed?.friends) ? parsed.friends.map(normalizeStoredFriend).filter(Boolean) : [],
        cycles: Array.isArray(parsed?.cycles) ? parsed.cycles.map(normalizeStoredCycle).filter(Boolean) : [],
      };
    } catch {
      this.state = createEmptyState();
    }
    return this.state;
  }

  save() {
    this.ensureParentDirectory();
    const temporaryFile = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporaryFile, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    try {
      fs.renameSync(temporaryFile, this.filePath);
    } catch (error) {
      try {
        fs.rmSync(temporaryFile, { force: true });
      } catch {}
      throw error;
    }
  }

  listFriends() {
    this.load();
    return this.state.friends.map(cloneValue);
  }

  findFriend(reference) {
    this.load();
    const normalized = normalizeText(reference).toLocaleLowerCase();
    if (!normalized) {
      return null;
    }
    const friend = this.state.friends.find((candidate) => (
      candidate.id.toLocaleLowerCase() === normalized
      || candidate.name.toLocaleLowerCase() === normalized
    ));
    return friend ? cloneValue(friend) : null;
  }

  upsertFriend(friend) {
    this.load();
    const normalized = normalizeStoredFriend(friend);
    if (!normalized) {
      throw new Error("invalid birthday friend");
    }
    const index = this.state.friends.findIndex((candidate) => (
      candidate.id === normalized.id
      || candidate.name.toLocaleLowerCase() === normalized.name.toLocaleLowerCase()
    ));
    if (index >= 0) {
      this.state.friends[index] = normalized;
    } else {
      this.state.friends.push(normalized);
    }
    this.state.friends.sort((left, right) => left.name.localeCompare(right.name));
    this.save();
    return cloneValue(normalized);
  }

  removeFriend(reference) {
    this.load();
    const normalized = normalizeText(reference).toLocaleLowerCase();
    const friend = this.state.friends.find((candidate) => (
      candidate.id.toLocaleLowerCase() === normalized
      || candidate.name.toLocaleLowerCase() === normalized
    ));
    if (!friend) {
      return null;
    }
    this.state.friends = this.state.friends.filter((candidate) => candidate.id !== friend.id);
    this.state.cycles = this.state.cycles.filter((cycle) => cycle.friendId !== friend.id);
    this.save();
    return cloneValue(friend);
  }

  getCycle(friendId, year) {
    this.load();
    const cycle = this.state.cycles.find((candidate) => (
      candidate.friendId === friendId && candidate.year === Number(year)
    ));
    return cycle ? cloneValue(cycle) : null;
  }

  ensureCycle({ friendId, year, resolvedSolarDate, sourceLunarYear = null, nowIso = new Date().toISOString() }) {
    this.load();
    const numericYear = Number(year);
    const index = this.state.cycles.findIndex((candidate) => (
      candidate.friendId === friendId && candidate.year === numericYear
    ));
    if (index >= 0) {
      const existing = this.state.cycles[index];
      if (existing.resolvedSolarDate !== resolvedSolarDate || existing.sourceLunarYear !== sourceLunarYear) {
        existing.resolvedSolarDate = resolvedSolarDate;
        existing.sourceLunarYear = sourceLunarYear;
        existing.updatedAt = nowIso;
        this.save();
      }
      return cloneValue(existing);
    }
    const cycle = normalizeStoredCycle({
      friendId,
      year: numericYear,
      resolvedSolarDate,
      sourceLunarYear,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    if (!cycle) {
      throw new Error("invalid birthday cycle");
    }
    this.state.cycles.push(cycle);
    this.state.cycles.sort(compareCycles);
    this.save();
    return cloneValue(cycle);
  }

  updateCycle(friendId, year, update) {
    this.load();
    const index = this.state.cycles.findIndex((candidate) => (
      candidate.friendId === friendId && candidate.year === Number(year)
    ));
    if (index < 0) {
      throw new Error(`Birthday cycle not found for ${year}.`);
    }
    const draft = cloneValue(this.state.cycles[index]);
    const updated = typeof update === "function" ? update(draft) || draft : { ...draft, ...update };
    const normalized = normalizeStoredCycle(updated);
    if (!normalized) {
      throw new Error("invalid birthday cycle update");
    }
    this.state.cycles[index] = normalized;
    this.save();
    return cloneValue(normalized);
  }
}

function createEmptyState() {
  return { version: STORE_VERSION, friends: [], cycles: [] };
}

function normalizeStoredFriend(friend) {
  if (!friend || typeof friend !== "object") {
    return null;
  }
  const id = normalizeText(friend.id);
  const name = normalizeText(friend.name);
  const calendar = friend.calendar === "lunar" ? "lunar" : friend.calendar === "solar" ? "solar" : "";
  const month = Number(friend.month);
  const day = Number(friend.day);
  const timezone = normalizeText(friend.timezone);
  const createdAt = normalizeIso(friend.createdAt);
  const updatedAt = normalizeIso(friend.updatedAt);
  if (!id || !name || !calendar || !Number.isInteger(month) || !Number.isInteger(day) || !timezone) {
    return null;
  }
  return {
    id,
    name,
    calendar,
    month,
    day,
    leapMonth: calendar === "lunar" && friend.leapMonth === true,
    timezone,
    notes: normalizeText(friend.notes),
    prepareDaysBefore: normalizePositiveInteger(friend.prepareDaysBefore, 7),
    followupDaysBefore: normalizePositiveInteger(friend.followupDaysBefore, 4),
    pickupDaysBefore: normalizePositiveInteger(friend.pickupDaysBefore, 2),
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: updatedAt || createdAt || new Date().toISOString(),
  };
}

function normalizeStoredCycle(cycle) {
  if (!cycle || typeof cycle !== "object") {
    return null;
  }
  const friendId = normalizeText(cycle.friendId);
  const year = Number(cycle.year);
  const resolvedSolarDate = normalizeDateKey(cycle.resolvedSolarDate);
  if (!friendId || !Number.isInteger(year) || !resolvedSolarDate) {
    return null;
  }
  const stages = {};
  for (const name of STAGE_NAMES) {
    stages[name] = normalizeStageState(cycle.stages?.[name]);
  }
  return {
    friendId,
    year,
    resolvedSolarDate,
    sourceLunarYear: cycle.sourceLunarYear !== null
      && cycle.sourceLunarYear !== undefined
      && Number.isInteger(Number(cycle.sourceLunarYear))
      ? Number(cycle.sourceLunarYear)
      : null,
    addressAskedAt: normalizeIso(cycle.addressAskedAt),
    giftOrderedAt: normalizeIso(cycle.giftOrderedAt),
    pickupRemindedAt: normalizeIso(cycle.pickupRemindedAt),
    birthdayWishedAt: normalizeIso(cycle.birthdayWishedAt),
    stages,
    createdAt: normalizeIso(cycle.createdAt) || new Date().toISOString(),
    updatedAt: normalizeIso(cycle.updatedAt) || normalizeIso(cycle.createdAt) || new Date().toISOString(),
  };
}

function normalizeStageState(stage) {
  return {
    triggeredAt: normalizeIso(stage?.triggeredAt),
    sentAt: normalizeIso(stage?.sentAt),
  };
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeDateKey(value) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeIso(value) {
  const normalized = normalizeText(value);
  const parsed = Date.parse(normalized);
  return normalized && Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function compareCycles(left, right) {
  if (left.year !== right.year) {
    return left.year - right.year;
  }
  return left.friendId.localeCompare(right.friendId);
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  BirthdayCareStore,
  STAGE_NAMES,
};
