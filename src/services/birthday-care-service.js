const fs = require("fs");
const path = require("path");

class BirthdayCareService {
  constructor({ config, coreModule = null }) {
    this.config = config || {};
    const { BirthdayCare, JsonStore } = coreModule || require("birthday-care-agent");
    migrateLegacyDataFile(this.config.birthdayCareFile);
    this.care = new BirthdayCare({
      store: new JsonStore({ filePath: this.config.birthdayCareFile }),
    });
  }

  upsert(input = {}, options = {}) {
    return this.care.upsertFriend({
      ...input,
      timezone: input.timezone || this.config.birthdayTimezone || "Asia/Shanghai",
    }, options);
  }

  list() {
    return this.care.listFriends();
  }

  upcoming({ limit = 20, now = new Date() } = {}) {
    return this.care.getUpcoming({ limit, now });
  }

  mark({ id = "", name = "", status = "", year = undefined, at = "" } = {}, { now = new Date() } = {}) {
    const reference = id || name;
    const cycle = this.care.markCareState(reference, status, {
      year,
      at: at || now,
    });
    const friend = this.care.listFriends().find((item) => item.id === cycle.friendId);
    return { friend, cycle, status };
  }

  remove({ id = "", name = "" } = {}) {
    return this.care.removeFriend(id || name);
  }

  collectDue({ now = new Date() } = {}) {
    return this.care.getDueActions(now).map((action) => buildTrigger(action, now));
  }

  async processDue({ now = new Date(), enqueue } = {}) {
    if (typeof enqueue !== "function") {
      throw new Error("Birthday due processing requires an enqueue function.");
    }
    const triggers = this.collectDue({ now });
    const processed = [];
    for (const trigger of triggers) {
      await enqueue(trigger);
      this.care.markActionDelivered(trigger.id, { at: now });
      processed.push(trigger);
    }
    return processed;
  }
}

function createBirthdayCareService({ config, logger = console, coreModule = null } = {}) {
  if (!config?.birthdayCareEnabled) {
    return null;
  }
  try {
    return new BirthdayCareService({ config, coreModule });
  } catch (error) {
    logger.warn?.(`[cyberboss] Birthday Care disabled: ${formatError(error)}`);
    return null;
  }
}

function buildTrigger(action, now = new Date()) {
  const stage = action.type.replace(/^birthday\./, "");
  return {
    ...action,
    stage,
    createdAt: new Date(now).toISOString(),
    text: [
      `Birthday Care is due for ${action.friendName}.`,
      `Birthday date: ${action.birthdayDate}; stage: ${stage}; days until: ${action.daysUntil}.`,
      `Current care state: address asked=${action.state.addressAsked}; gift ordered=${action.state.giftOrdered}; pickup reminded=${action.state.pickupReminded}; birthday wished=${action.state.birthdayWished}.`,
      "Respond naturally in the current persona. Do not expose internal ids, JSON, tool names, or state-machine details.",
    ].join("\n"),
  };
}

function migrateLegacyDataFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return false;
  }
  if (parsed?.schemaVersion === 1 || parsed?.version !== 1) return false;
  const migrated = {
    schemaVersion: 1,
    friends: Array.isArray(parsed.friends) ? parsed.friends : [],
    cycles: Array.isArray(parsed.cycles) ? parsed.cycles.map(flattenLegacyCycle) : [],
  };
  const backupPath = `${filePath}.pre-birthday-care-agent-v1.bak`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
  return true;
}

function flattenLegacyCycle(cycle = {}) {
  const result = {
    friendId: cycle.friendId,
    year: cycle.year,
    resolvedSolarDate: cycle.resolvedSolarDate,
    addressAskedAt: cycle.addressAskedAt || null,
    giftOrderedAt: cycle.giftOrderedAt || null,
    pickupRemindedAt: cycle.pickupRemindedAt || null,
    birthdayWishedAt: cycle.birthdayWishedAt || null,
  };
  for (const stage of ["prepare", "followup", "pickup", "birthday", "birthday-evening"]) {
    const camel = stage.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    result[`${camel}TriggeredAt`] = cycle.stages?.[stage]?.triggeredAt || null;
    result[`${camel}DeliveredAt`] = cycle.stages?.[stage]?.sentAt || null;
  }
  return result;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

module.exports = {
  BirthdayCareService,
  buildTrigger,
  createBirthdayCareService,
  migrateLegacyDataFile,
};
