const fs = require("fs");
const path = require("path");

const {
  LEGACY_TIMELINE_TIMEZONE,
  formatDateInTimezone,
  resolveConfiguredTimezone,
} = require("../../core/timezone");

function ensureTimelineStateTimezone(config = {}) {
  const targetTimezone = resolveConfiguredTimezone(config.timezone);
  const paths = resolveTimelinePaths(config);
  const snapshot = loadTimelineSnapshot(paths);

  if (!snapshot.hasAnyFile) {
    initializeTimelineSnapshot(paths, targetTimezone);
    return;
  }

  const currentTimezone = resolveConfiguredTimezone(snapshot.timezone);
  if (currentTimezone === targetTimezone) {
    return;
  }

  if (!shouldSyncTimezone(snapshot.timezone, targetTimezone, config)) {
    return;
  }

  const nextFacts = regroupFactsByTimezone(snapshot.facts, targetTimezone);
  const nextSnapshot = {
    timezone: targetTimezone,
    taxonomy: snapshot.taxonomy,
    facts: nextFacts,
    proposals: Array.isArray(snapshot.proposals) ? snapshot.proposals : [],
  };

  writeTimelineSnapshot(paths, nextSnapshot);
}

function resolveTimelinePaths(config = {}) {
  const stateDir = path.join(String(config.stateDir || "").trim(), "timeline");
  return {
    dir: stateDir,
    stateFile: path.join(stateDir, "timeline-state.json"),
    taxonomyFile: path.join(stateDir, "timeline-taxonomy.json"),
    factsFile: path.join(stateDir, "timeline-facts.json"),
  };
}

function loadTimelineSnapshot(paths) {
  const stateDoc = readJsonFile(paths.stateFile);
  const taxonomyDoc = readJsonFile(paths.taxonomyFile);
  const factsDoc = readJsonFile(paths.factsFile);

  return {
    hasAnyFile: Boolean(stateDoc || taxonomyDoc || factsDoc),
    timezone: normalizeText(stateDoc?.timezone)
      || normalizeText(taxonomyDoc?.timezone)
      || normalizeText(factsDoc?.timezone),
    taxonomy: readTaxonomy(stateDoc, taxonomyDoc),
    facts: readFacts(stateDoc, factsDoc),
    proposals: readProposals(stateDoc, factsDoc),
  };
}

function readTaxonomy(stateDoc, taxonomyDoc) {
  const fromState = stateDoc?.taxonomy;
  if (fromState && typeof fromState === "object") {
    return fromState;
  }
  const fromTaxonomy = taxonomyDoc?.taxonomy;
  return fromTaxonomy && typeof fromTaxonomy === "object" ? fromTaxonomy : {};
}

function readFacts(stateDoc, factsDoc) {
  const fromState = stateDoc?.facts;
  if (fromState && typeof fromState === "object") {
    return fromState;
  }
  const fromFacts = factsDoc?.facts;
  return fromFacts && typeof fromFacts === "object" ? fromFacts : {};
}

function readProposals(stateDoc, factsDoc) {
  if (Array.isArray(stateDoc?.proposals)) {
    return stateDoc.proposals;
  }
  return Array.isArray(factsDoc?.proposals) ? factsDoc.proposals : [];
}

function initializeTimelineSnapshot(paths, timezone) {
  writeTimelineSnapshot(paths, {
    timezone,
    taxonomy: {},
    facts: {},
    proposals: [],
  });
}

function shouldSyncTimezone(currentTimezone, targetTimezone, config = {}) {
  const normalizedCurrent = normalizeText(currentTimezone);
  if (!normalizedCurrent) {
    return true;
  }
  if (normalizedCurrent === targetTimezone) {
    return false;
  }
  if (config.forceTimelineTimezone) {
    return true;
  }
  return normalizedCurrent === LEGACY_TIMELINE_TIMEZONE;
}

function regroupFactsByTimezone(facts, timezone) {
  const buckets = new Map();

  for (const [originalDate, rawDay] of Object.entries(facts || {})) {
    const day = rawDay && typeof rawDay === "object" ? rawDay : {};
    const events = Array.isArray(day.events) ? day.events : [];
    if (!events.length) {
      mergeDayBucket(buckets, normalizeText(originalDate), day, []);
      continue;
    }

    for (const event of events) {
      const bucketDate = resolveEventBucketDate(event, timezone) || normalizeText(originalDate);
      mergeDayBucket(buckets, bucketDate, day, [event]);
    }
  }

  const output = {};
  for (const [date, day] of Array.from(buckets.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    const events = Array.isArray(day.events)
      ? [...day.events].sort((left, right) => {
        const leftTime = Date.parse(left.startAt || "");
        const rightTime = Date.parse(right.startAt || "");
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return String(left.id || "").localeCompare(String(right.id || ""));
      })
      : [];
    if (!date || !events.length) {
      continue;
    }
    output[date] = {
      status: day.status === "final" ? "final" : "draft",
      updatedAt: day.updatedAt || "",
      source: day.source || null,
      events,
    };
  }
  return output;
}

function resolveEventBucketDate(event, timezone) {
  const startDate = formatDateInTimezone(event?.startAt, timezone);
  const endDate = formatDateInTimezone(event?.endAt, timezone);
  return startDate || endDate || "";
}

function mergeDayBucket(buckets, date, sourceDay, events) {
  if (!date) {
    return;
  }
  const current = buckets.get(date) || {
    status: "final",
    updatedAt: "",
    source: null,
    events: [],
  };

  current.status = current.status === "final" && sourceDay?.status === "final" ? "final" : "draft";
  current.updatedAt = pickLatestTimestamp(current.updatedAt, sourceDay?.updatedAt);
  current.source = mergeSource(current.source, sourceDay?.source);
  current.events.push(...events);
  buckets.set(date, current);
}

function mergeSource(current, incoming) {
  const normalizedCurrent = normalizeSource(current);
  const normalizedIncoming = normalizeSource(incoming);
  if (!normalizedCurrent) {
    return normalizedIncoming;
  }
  if (!normalizedIncoming) {
    return normalizedCurrent;
  }
  return JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedIncoming)
    ? normalizedCurrent
    : null;
}

function normalizeSource(source) {
  if (!source || typeof source !== "object") {
    return null;
  }
  const threadId = normalizeText(source.threadId);
  const workspaceRoot = normalizeText(source.workspaceRoot);
  const transcriptMessageCount = Number.isFinite(Number(source.transcriptMessageCount))
    ? Number(source.transcriptMessageCount)
    : 0;
  if (!threadId && !workspaceRoot && transcriptMessageCount <= 0) {
    return null;
  }
  return {
    threadId,
    workspaceRoot,
    transcriptMessageCount,
  };
}

function pickLatestTimestamp(left, right) {
  const leftValue = Date.parse(normalizeText(left));
  const rightValue = Date.parse(normalizeText(right));
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
    return leftValue >= rightValue ? normalizeText(left) : normalizeText(right);
  }
  return normalizeText(right) || normalizeText(left);
}

function writeTimelineSnapshot(paths, snapshot) {
  fs.mkdirSync(paths.dir, { recursive: true });
  writeJsonFile(paths.stateFile, {
    version: 1,
    timezone: snapshot.timezone,
    taxonomy: snapshot.taxonomy,
    facts: snapshot.facts,
    proposals: snapshot.proposals,
  });
  writeJsonFile(paths.taxonomyFile, {
    version: 1,
    timezone: snapshot.timezone,
    taxonomy: snapshot.taxonomy,
  });
  writeJsonFile(paths.factsFile, {
    version: 1,
    timezone: snapshot.timezone,
    facts: snapshot.facts,
    proposals: snapshot.proposals,
  });
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, value) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
    fs.renameSync(tempPath, filePath);
  } finally {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Ignore temp cleanup failures after successful rename.
    }
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  ensureTimelineStateTimezone,
};
