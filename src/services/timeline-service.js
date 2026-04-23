const crypto = require("crypto");
const path = require("path");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { resolvePreferredSenderId } = require("../core/default-targets");
const { TimelineScreenshotQueueStore } = require("../core/timeline-screenshot-queue-store");

class TimelineService {
  constructor({ config, timelineIntegration, sessionStore }) {
    this.config = config;
    this.timelineIntegration = timelineIntegration;
    this.sessionStore = sessionStore;
    this.screenshotQueue = new TimelineScreenshotQueueStore({ filePath: config.timelineScreenshotQueueFile });
  }

  async read({ date = "" } = {}) {
    const args = [];
    if (date) {
      args.push("--date", date);
    }
    const execution = await this.timelineIntegration.runSubcommand("read", args);
    return {
      subcommand: "read",
      args,
      data: parseTimelineJsonOutput(execution, "read"),
      execution,
    };
  }

  async listCategories() {
    const execution = await this.timelineIntegration.runSubcommand("categories", []);
    return {
      subcommand: "categories",
      args: [],
      data: parseTimelineJsonOutput(execution, "categories"),
      execution,
    };
  }

  async listProposals({ date = "" } = {}) {
    const args = [];
    if (date) {
      args.push("--date", date);
    }
    const execution = await this.timelineIntegration.runSubcommand("proposals", args);
    return {
      subcommand: "proposals",
      args,
      data: parseTimelineJsonOutput(execution, "proposals"),
      execution,
    };
  }

  async write({
    date = "",
    events = undefined,
    eventsJson = "",
    eventsFile = "",
    locale = "",
    mode = "",
    finalize = false,
  } = {}) {
    const args = [];
    if (date) {
      args.push("--date", date);
    }
    if (locale) {
      args.push("--locale", locale);
    }
    if (mode) {
      args.push("--mode", mode);
    }
    if (finalize) {
      args.push("--finalize");
    }
    const sourceCount = countDefinedSources([
      Array.isArray(events) ? events : undefined,
      normalizeText(eventsJson),
      normalizeText(eventsFile),
    ]);
    if (sourceCount > 1) {
      throw new Error("Use only one of events, eventsJson, or eventsFile.");
    }
    if (eventsFile) {
      args.push("--events-file", eventsFile);
    } else if (Array.isArray(events)) {
      args.push("--events-json", JSON.stringify({ events }));
    } else if (eventsJson) {
      args.push("--events-json", eventsJson);
    }
    const execution = await this.timelineIntegration.runSubcommand("write", args);
    return {
      subcommand: "write",
      args,
      execution,
    };
  }

  async build({ locale = "" } = {}) {
    const args = locale ? ["--locale", locale] : [];
    const execution = await this.timelineIntegration.runSubcommand("build", args);
    return { subcommand: "build", args, execution };
  }

  async serve({ locale = "" } = {}) {
    const args = locale ? ["--locale", locale] : [];
    const execution = await this.timelineIntegration.runSubcommand("serve", args);
    return {
      subcommand: "serve",
      args,
      execution,
      url: normalizeText(execution?.url),
    };
  }

  async dev({ locale = "" } = {}) {
    const args = locale ? ["--locale", locale] : [];
    const execution = await this.timelineIntegration.runSubcommand("dev", args);
    return {
      subcommand: "dev",
      args,
      execution,
      url: normalizeText(execution?.url),
    };
  }

  async captureScreenshot({
    outputFile = "",
    selector = "",
    range = "",
    date = "",
    week = "",
    month = "",
    category = "",
    subcategory = "",
    width = 0,
    height = 0,
    sidePadding = undefined,
    locale = "",
  } = {}) {
    const resolvedOutputFile = resolveScreenshotOutputFile(this.config, outputFile);
    const args = buildTimelineScreenshotArgs({
      outputFile: resolvedOutputFile,
      selector,
      range,
      date,
      week,
      month,
      category,
      subcategory,
      width,
      height,
      sidePadding,
      locale,
    });
    const execution = await this.timelineIntegration.runSubcommand("screenshot", args);
    return {
      subcommand: "screenshot",
      args,
      outputFile: resolvedOutputFile,
      execution,
    };
  }

  queueScreenshot({
    userId = "",
    outputFile = "",
    selector = "",
    range = "",
    date = "",
    week = "",
    month = "",
    category = "",
    subcategory = "",
    width = 0,
    height = 0,
    sidePadding = undefined,
    locale = "",
  } = {}, context = {}) {
    const account = resolveSelectedAccount(this.config);
    const senderId = normalizeText(userId)
      || normalizeText(context?.senderId)
      || resolvePreferredSenderId({
        config: this.config,
        accountId: account.accountId,
        sessionStore: this.sessionStore,
      });

    if (!senderId) {
      throw new Error("Missing send target for timeline screenshot.");
    }

    const queued = this.screenshotQueue.enqueue({
      id: crypto.randomUUID(),
      accountId: account.accountId,
      senderId,
      outputFile: normalizeText(outputFile) ? path.resolve(outputFile) : "",
      selector: normalizeText(selector),
      range: normalizeText(range),
      date: normalizeText(date),
      week: normalizeText(week),
      month: normalizeText(month),
      category: normalizeText(category),
      subcategory: normalizeText(subcategory),
      width: normalizePositiveInteger(width),
      height: normalizePositiveInteger(height),
      sidePadding: normalizeNonNegativeInteger(sidePadding),
      locale: normalizeText(locale),
      createdAt: new Date().toISOString(),
    });
    return queued;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseTimelineJsonOutput(execution, subcommand) {
  const text = normalizeText(execution?.stdout);
  if (!text) {
    throw new Error(`timeline ${subcommand} returned no JSON output.`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`timeline ${subcommand} returned invalid JSON output.`);
  }
}

function countDefinedSources(values) {
  return values.filter((value) => {
    if (Array.isArray(value)) {
      return true;
    }
    return Boolean(value);
  }).length;
}

function buildTimelineScreenshotArgs({
  outputFile = "",
  selector = "",
  range = "",
  date = "",
  week = "",
  month = "",
  category = "",
  subcategory = "",
  width = 0,
  height = 0,
  sidePadding = undefined,
  locale = "",
} = {}) {
  const args = [];
  if (outputFile) {
    args.push("--output", outputFile);
  }
  if (selector) {
    args.push("--selector", selector);
  }
  if (range) {
    args.push("--range", range);
  }
  if (date) {
    args.push("--date", date);
  }
  if (week) {
    args.push("--week", week);
  }
  if (month) {
    args.push("--month", month);
  }
  if (category) {
    args.push("--category", category);
  }
  if (subcategory) {
    args.push("--subcategory", subcategory);
  }
  if (normalizePositiveInteger(width) > 0) {
    args.push("--width", String(normalizePositiveInteger(width)));
  }
  if (normalizePositiveInteger(height) > 0) {
    args.push("--height", String(normalizePositiveInteger(height)));
  }
  if (sidePadding !== undefined && sidePadding !== null) {
    args.push("--side-padding", String(normalizeNonNegativeInteger(sidePadding)));
  }
  if (locale) {
    args.push("--locale", locale);
  }
  return args;
}

function resolveScreenshotOutputFile(config, outputFile = "") {
  const normalized = normalizeText(outputFile);
  if (normalized) {
    return path.resolve(normalized);
  }
  const shotsDir = path.join(config.stateDir, "timeline", "shots");
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
    "-",
    String(now.getMilliseconds()).padStart(3, "0"),
  ].join("");
  return path.join(shotsDir, `cyberboss-timeline-${stamp}.png`);
}

function normalizePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeNonNegativeInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

module.exports = { TimelineService };
