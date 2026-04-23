const fs = require("fs");
const path = require("path");

class TimelineScreenshotQueueStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = { jobs: [] };
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
      this.state = {
        jobs: jobs
          .map(normalizeTimelineScreenshotJob)
          .filter(Boolean)
          .sort(compareTimelineScreenshotJobs),
      };
    } catch {
      this.state = { jobs: [] };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  enqueue(job) {
    this.load();
    const normalized = normalizeTimelineScreenshotJob(job);
    if (!normalized) {
      throw new Error("invalid timeline screenshot job");
    }
    this.state.jobs.push(normalized);
    this.state.jobs.sort(compareTimelineScreenshotJobs);
    this.save();
    return normalized;
  }

  drainForAccount(accountId) {
    this.load();
    const normalizedAccountId = normalizeText(accountId);
    const drained = [];
    const pending = [];

    for (const job of this.state.jobs) {
      if (job.accountId === normalizedAccountId) {
        drained.push(job);
      } else {
        pending.push(job);
      }
    }

    if (drained.length) {
      this.state.jobs = pending;
      this.save();
    }

    return drained;
  }

  hasPendingForAccount(accountId) {
    this.load();
    const normalizedAccountId = normalizeText(accountId);
    return this.state.jobs.some((job) => job.accountId === normalizedAccountId);
  }
}

function normalizeTimelineScreenshotJob(job) {
  if (!job || typeof job !== "object") {
    return null;
  }

  const id = normalizeText(job.id);
  const accountId = normalizeText(job.accountId);
  const senderId = normalizeText(job.senderId);
  const outputFile = normalizeText(job.outputFile);
  const createdAt = normalizeIsoTime(job.createdAt);
  const selector = normalizeText(job.selector);
  const range = normalizeText(job.range);
  const date = normalizeText(job.date);
  const week = normalizeText(job.week);
  const month = normalizeText(job.month);
  const category = normalizeText(job.category);
  const subcategory = normalizeText(job.subcategory);
  const width = normalizePositiveInteger(job.width);
  const height = normalizePositiveInteger(job.height);
  const sidePadding = normalizeNonNegativeInteger(job.sidePadding);
  const locale = normalizeText(job.locale);

  if (!id || !accountId || !senderId) {
    return null;
  }

  return {
    id,
    accountId,
    senderId,
    outputFile,
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
    createdAt: createdAt || new Date().toISOString(),
  };
}

function normalizePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeNonNegativeInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeIsoTime(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString();
}

function compareTimelineScreenshotJobs(left, right) {
  const leftTime = Date.parse(left?.createdAt || "") || 0;
  const rightTime = Date.parse(right?.createdAt || "") || 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { TimelineScreenshotQueueStore };
