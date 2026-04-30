const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { loadPersistedContextTokens } = require("../adapters/channel/weixin/context-token-store");
const { resolvePreferredSenderId } = require("../core/default-targets");

const execFileAsync = promisify(execFile);
const DEFAULT_PICK_LIMIT = 5;
const MAX_PICK_LIMIT = 20;
const MAX_STICKER_SAVE_BATCH_SIZE = 10;
const MAX_STICKER_MUTATION_BATCH_SIZE = 50;
const MIN_STICKER_DESC_CHARS = 16;
const STICKER_TAG_GUIDANCE = "Reuse existing tags when they fit. Otherwise create short new tags; new tags are added to the tag list.";
const STICKER_DESC_GUIDANCE = `Prefer descs of ${MIN_STICKER_DESC_CHARS} or more characters. If readable text exists, append it after the short scene description.`;
const STICKER_DESC_FIELD_DESCRIPTION = `A concrete sticker description. ${STICKER_DESC_GUIDANCE}`;

class StickerService {
  constructor({ config, channelAdapter, sessionStore, channelFileService }) {
    this.config = config;
    this.channelAdapter = channelAdapter;
    this.sessionStore = sessionStore;
    this.channelFileService = channelFileService;
  }

  async listTags() {
    ensureStickerCatalogFilesSync(this.config);
    return {
      tags: loadStickerTagsSync(this.config),
      guidance: `Choose 1-3 short tags. ${STICKER_TAG_GUIDANCE} Make desc concrete enough to identify the sticker. ${STICKER_DESC_GUIDANCE}`,
    };
  }

  async saveFromInbox({ items = [], userId = "" } = {}, context = {}) {
    ensureStickerCatalogFilesSync(this.config);
    const normalizedItems = normalizeStickerSaveItems(items, this.config);
    const index = loadStickerIndexSync(this.config);
    const tagCatalog = loadStickerTagsSync(this.config);
    const hashByStickerId = buildStickerHashIndex(this.config, index);
    const createdPaths = [];
    const results = [];

    try {
      for (const item of normalizedItems) {
        const saved = await saveStickerEntry({
          config: this.config,
          index,
          tagCatalog,
          hashByStickerId,
          item,
        });
        results.push(saved.result);
        if (saved.createdPath) {
          createdPaths.push(saved.createdPath);
        }
      }

      const createdCount = results.filter((item) => item.created).length;
      if (createdCount > 0) {
        await writeJsonFile(this.config.stickersIndexFile, index);
        await writeJsonFile(this.config.stickerTagsFile, tagCatalog);
        for (const item of results) {
          if (!item.created) {
            continue;
          }
          await this.sendContextText({
            text: buildStickerSavedText(item),
            userId,
            context,
      });
    }
  }

      return {
        results,
        createdCount,
        dedupedCount: results.filter((item) => item.deduped).length,
      };
    } catch (error) {
      await Promise.all(createdPaths.map((filePath) => fsp.rm(filePath, { force: true }).catch(() => {})));
      throw error;
    }
  }

  async pick({ tag = "", limit = DEFAULT_PICK_LIMIT } = {}) {
    ensureStickerCatalogFilesSync(this.config);
    const normalizedTag = normalizeText(tag);
    if (!normalizedTag) {
      throw new Error("Sticker tag is required.");
    }
    const normalizedLimit = normalizePickLimit(limit);
    const index = loadStickerIndexSync(this.config);
    const entries = Object.entries(index)
      .filter(([stickerId, value]) => Array.isArray(value?.tags)
        && value.tags.includes(normalizedTag)
        && fs.existsSync(resolveStickerFilePath(this.config, stickerId)))
      .slice(-normalizedLimit)
      .reverse()
      .map(([stickerId, value]) => ({
        stickerId,
        desc: normalizeText(value?.desc),
      }));

    return {
      tag: normalizedTag,
      candidates: entries,
    };
  }

  async sendToCurrentChat({ stickerId = "", userId = "" } = {}, context = {}) {
    ensureStickerCatalogFilesSync(this.config);
    const normalizedStickerId = normalizeStickerId(stickerId);
    if (!normalizedStickerId) {
      throw new Error("Sticker id is required.");
    }
    const index = loadStickerIndexSync(this.config);
    if (!index[normalizedStickerId]) {
      throw new Error(`Sticker not found: ${normalizedStickerId}`);
    }
    const filePath = resolveStickerFilePath(this.config, normalizedStickerId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Sticker file is missing: ${filePath}`);
    }
    const delivery = await this.channelFileService.sendToCurrentChat({
      filePath,
      userId,
    }, context);
    return {
      stickerId: normalizedStickerId,
      filePath,
      delivery,
    };
  }

  async delete({ items = [] } = {}, context = {}) {
    ensureStickerCatalogFilesSync(this.config);
    const index = loadStickerIndexSync(this.config);
    const normalizedItems = normalizeStickerDeleteItems(items);
    const normalizedStickerIds = normalizedItems.map((item) => item.stickerId);
    for (const stickerId of normalizedStickerIds) {
      if (!index[stickerId]) {
        throw new Error(`Sticker not found: ${stickerId}`);
      }
    }
    const nextIndex = { ...index };
    for (const stickerId of normalizedStickerIds) {
      delete nextIndex[stickerId];
    }
    await writeJsonFile(this.config.stickersIndexFile, nextIndex);

    const results = [];
    for (const stickerId of normalizedStickerIds) {
      const filePath = resolveStickerFilePath(this.config, stickerId);
      await fsp.rm(filePath, { force: true }).catch(() => {});
      results.push({
        stickerId,
        filePath,
        deleted: true,
      });
    }

    await this.sendContextText({
      text: buildStickerDeletedText(normalizedStickerIds),
      context,
    });

    return {
      results,
      deletedCount: results.length,
    };
  }

  async update({ items = [] } = {}) {
    ensureStickerCatalogFilesSync(this.config);
    const index = loadStickerIndexSync(this.config);
    const normalizedItems = normalizeStickerUpdateItems(items);
    for (const item of normalizedItems) {
      if (!index[item.stickerId]) {
        throw new Error(`Sticker not found: ${item.stickerId}`);
      }
    }
    const tagCatalog = loadStickerTagsSync(this.config);
    for (const item of normalizedItems) {
      index[item.stickerId] = {
        tags: item.tags,
        desc: item.desc,
      };
      tagCatalog.splice(0, tagCatalog.length, ...mergeStickerTagCatalog(tagCatalog, item.tags));
    }
    await writeJsonFile(this.config.stickersIndexFile, index);
    await writeJsonFile(this.config.stickerTagsFile, tagCatalog);
    return {
      results: normalizedItems.map((item) => ({
        stickerId: item.stickerId,
        tags: item.tags,
        desc: item.desc,
        updated: true,
      })),
      updatedCount: normalizedItems.length,
    };
  }

  async sendContextText({ text = "", userId = "", context = {} } = {}) {
    const normalizedText = normalizeText(text);
    if (!normalizedText || !this.channelAdapter || typeof this.channelAdapter.sendText !== "function") {
      return false;
    }
    let account = null;
    try {
      account = resolveSelectedAccount(this.config);
    } catch {
      return false;
    }
    const targetUserId = normalizeText(userId)
      || normalizeText(context?.senderId)
      || resolvePreferredSenderId({
        config: this.config,
        accountId: account.accountId,
        sessionStore: this.sessionStore,
      });
    if (!targetUserId) {
      return false;
    }
    const contextTokens = loadPersistedContextTokens(this.config, account.accountId);
    const contextToken = normalizeText(contextTokens[targetUserId]);
    if (!contextToken) {
      return false;
    }
    await this.channelAdapter.sendText({
      userId: targetUserId,
      text: normalizedText,
      contextToken,
      preserveBlock: true,
    }).catch(() => {});
    return true;
  }
}

function buildStickerPaths(config = {}) {
  const stateDir = normalizeText(config.stateDir);
  return {
    stateDir,
    inboxDir: path.join(stateDir, "inbox"),
    stickersDir: normalizeText(config.stickersDir) || path.join(stateDir, "stickers"),
    stickerAssetsDir: normalizeText(config.stickerAssetsDir) || path.join(stateDir, "stickers", "assets"),
    stickersIndexFile: normalizeText(config.stickersIndexFile) || path.join(stateDir, "stickers", "index.json"),
    stickerTagsFile: normalizeText(config.stickerTagsFile) || path.join(stateDir, "stickers", "tags.json"),
    stickersTemplateDir: normalizeText(config.stickersTemplateDir) || path.resolve(__dirname, "..", "..", "templates", "stickers"),
    stickersTemplateIndexFile: normalizeText(config.stickersTemplateIndexFile) || path.resolve(__dirname, "..", "..", "templates", "stickers", "index.json"),
    stickerTagsTemplateFile: normalizeText(config.stickerTagsTemplateFile) || path.resolve(__dirname, "..", "..", "templates", "stickers", "tags.json"),
  };
}

function ensureStickerCatalogFilesSync(config = {}) {
  const paths = buildStickerPaths(config);
  if (fs.existsSync(paths.stickersDir)) {
    return;
  }
  if (paths.stickersTemplateDir && fs.existsSync(paths.stickersTemplateDir)) {
    fs.cpSync(paths.stickersTemplateDir, paths.stickersDir, { recursive: true });
    return;
  }
  fs.mkdirSync(paths.stickerAssetsDir, { recursive: true });
  writeJsonFileSync(paths.stickersIndexFile, {});
  writeJsonFileSync(paths.stickerTagsFile, []);
}

function loadStickerIndexSync(config = {}) {
  ensureStickerCatalogFilesSync(config);
  try {
    const raw = fs.readFileSync(buildStickerPaths(config).stickersIndexFile, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const normalized = {};
    for (const [stickerId, value] of Object.entries(parsed)) {
      normalized[normalizeStickerId(stickerId)] = {
        tags: Array.isArray(value?.tags)
          ? Array.from(new Set(value.tags.map((item) => normalizeText(item)).filter(Boolean)))
          : [],
        desc: normalizeText(value?.desc),
      };
    }
    return normalized;
  } catch {
    return {};
  }
}

function loadStickerTagsSync(config = {}) {
  ensureStickerCatalogFilesSync(config);
  try {
    const raw = fs.readFileSync(buildStickerPaths(config).stickerTagsFile, "utf8");
    const parsed = JSON.parse(raw);
    const normalized = Array.isArray(parsed)
      ? Array.from(new Set(parsed.map((value) => normalizeText(value)).filter(Boolean)))
      : [];
    return normalized.length ? normalized : loadStickerTagsTemplateSync(config);
  } catch {
    return loadStickerTagsTemplateSync(config);
  }
}

function loadStickerTagsTemplateSync(config = {}) {
  const templatePath = buildStickerPaths(config).stickerTagsTemplateFile;
  return loadStickerTagsFileSync(templatePath);
}

function loadStickerTagsFileSync(filePath = "") {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? Array.from(new Set(parsed.map((value) => normalizeText(value)).filter(Boolean)))
      : [];
  } catch {
    return [];
  }
}

function resolveStickerFilePath(config = {}, stickerId = "") {
  return path.join(buildStickerPaths(config).stickerAssetsDir, `${normalizeStickerId(stickerId)}.gif`);
}

function normalizeStickerTags(tags) {
  if (!Array.isArray(tags)) {
    throw new Error("Sticker tags must be an array.");
  }
  const normalized = Array.from(new Set(tags.map((value) => normalizeText(value)).filter(Boolean)));
  if (normalized.length < 1 || normalized.length > 3) {
    throw new Error("Sticker tags must contain 1 to 3 labels.");
  }
  return normalized;
}

function normalizeStickerDesc(desc) {
  const normalized = normalizeText(desc);
  if (!normalized) {
    throw new Error("Sticker description is required.");
  }
  return normalized;
}

function normalizePickLimit(limit) {
  if (!Number.isInteger(limit)) {
    return DEFAULT_PICK_LIMIT;
  }
  return Math.max(1, Math.min(MAX_PICK_LIMIT, limit));
}

function allocateNextStickerId(index = {}) {
  const max = Object.keys(index)
    .map((key) => {
      const match = key.match(/^stk_(\d+)$/i);
      return match ? Number.parseInt(match[1], 10) : 0;
    })
    .reduce((current, value) => Math.max(current, value), 0);
  return `stk_${String(max + 1).padStart(3, "0")}`;
}

function buildStickerHashIndex(config = {}, index = {}) {
  const hashByStickerId = new Map();
  for (const stickerId of Object.keys(index)) {
    const filePath = resolveStickerFilePath(config, stickerId);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    try {
      hashByStickerId.set(stickerId, computeBufferHash(fs.readFileSync(filePath)));
    } catch {
      // Ignore unreadable sticker files during duplicate checks.
    }
  }
  return hashByStickerId;
}

function findDuplicateStickerByHash(config = {}, index = {}, hashByStickerId = new Map(), targetHash = "") {
  for (const stickerId of Object.keys(index)) {
    if (hashByStickerId.get(stickerId) === targetHash) {
      return {
        stickerId,
        filePath: resolveStickerFilePath(config, stickerId),
      };
    }
  }
  return null;
}

function computeBufferHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function normalizeStickerGif({ inputPath, outputPath, scriptPath }) {
  const normalizedScriptPath = path.resolve(normalizeText(scriptPath));
  if (!normalizedScriptPath || !fs.existsSync(normalizedScriptPath)) {
    throw new Error(`Sticker gif normalization script not found: ${normalizedScriptPath}`);
  }
  try {
    await execFileAsync(process.execPath, [
      normalizedScriptPath,
      "--input", path.resolve(inputPath),
      "--output", path.resolve(outputPath),
      "--size", "240",
    ]);
  } catch (error) {
    const stderr = normalizeText(error?.stderr);
    const stdout = normalizeText(error?.stdout);
    const message = stderr || stdout || (error instanceof Error ? error.message : String(error || "unknown error"));
    throw new Error(`Sticker GIF normalization failed: ${message}`);
  }
}

function buildStickerSavedText({ stickerId, tags, desc }) {
  return [
    "✅ 系统提示:",
    "表情包已保存",
    `ID: ${stickerId}`,
    `标签: ${(Array.isArray(tags) ? tags : []).join("、")}`,
    `描述: ${normalizeText(desc)}`,
    "如不需要添加该表情包,请让AI删除",
  ].join("\n");
}

function normalizeStickerSaveItems(items, config = {}) {
  if (!Array.isArray(items)) {
    throw new Error("Sticker save items must be an array.");
  }
  if (!items.length) {
    throw new Error("Sticker save items cannot be empty.");
  }
  if (items.length > MAX_STICKER_SAVE_BATCH_SIZE) {
    throw new Error(`Sticker save batch size must be ${MAX_STICKER_SAVE_BATCH_SIZE} or less.`);
  }
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Sticker save item must be an object: ${index}`);
    }
    return {
      filePath: resolveStickerInboxFilePath(config, item.filePath),
      tags: normalizeStickerTags(item.tags),
      desc: normalizeStickerDesc(item.desc),
    };
  });
}

function normalizeStickerUpdateItems(items) {
  if (!Array.isArray(items)) {
    throw new Error("Sticker update items must be an array.");
  }
  if (!items.length) {
    throw new Error("Sticker update items cannot be empty.");
  }
  if (items.length > MAX_STICKER_MUTATION_BATCH_SIZE) {
    throw new Error(`Sticker update batch size must be ${MAX_STICKER_MUTATION_BATCH_SIZE} or less.`);
  }
  const seen = new Set();
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Sticker update item must be an object: ${index}`);
    }
    const stickerId = normalizeStickerId(item.stickerId);
    if (!stickerId) {
      throw new Error("Sticker id is required.");
    }
    if (seen.has(stickerId)) {
      throw new Error(`Duplicate sticker id in update batch: ${stickerId}`);
    }
    seen.add(stickerId);
    return {
      stickerId,
      tags: normalizeStickerTags(item.tags),
      desc: normalizeStickerDesc(item.desc),
    };
  });
}

function normalizeStickerDeleteItems(items) {
  if (!Array.isArray(items)) {
    throw new Error("Sticker delete items must be an array.");
  }
  if (!items.length) {
    throw new Error("Sticker delete items cannot be empty.");
  }
  if (items.length > MAX_STICKER_MUTATION_BATCH_SIZE) {
    throw new Error(`Sticker delete batch size must be ${MAX_STICKER_MUTATION_BATCH_SIZE} or less.`);
  }
  const seen = new Set();
  const normalized = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Sticker delete item must be an object: ${index}`);
    }
    const stickerId = normalizeStickerId(item.stickerId);
    if (!stickerId) {
      throw new Error("Sticker id is required.");
    }
    if (seen.has(stickerId)) {
      continue;
    }
    seen.add(stickerId);
    normalized.push({ stickerId });
  }
  return normalized;
}

function resolveStickerInboxFilePath(config = {}, filePath = "") {
  const resolvedInputPath = path.resolve(normalizeText(filePath));
  if (!resolvedInputPath) {
    throw new Error("Missing sticker inbox file path.");
  }
  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(`Sticker inbox file does not exist: ${resolvedInputPath}`);
  }
  if (!isUnderDirectory(resolvedInputPath, buildStickerPaths(config).inboxDir)) {
    throw new Error(`Sticker inbox file must be under ${buildStickerPaths(config).inboxDir}`);
  }
  const stat = fs.statSync(resolvedInputPath);
  if (!stat.isFile()) {
    throw new Error(`Sticker inbox file must be a file: ${resolvedInputPath}`);
  }
  return resolvedInputPath;
}

function mergeStickerTagCatalog(currentTags = [], incomingTags = []) {
  const base = Array.isArray(currentTags)
    ? currentTags.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  const extra = Array.isArray(incomingTags)
    ? incomingTags.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  return Array.from(new Set([...base, ...extra]));
}

async function saveStickerEntry({
  config = {},
  index = {},
  tagCatalog = [],
  hashByStickerId = new Map(),
  item = {},
} = {}) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "cyberboss-sticker-save-"));
  const normalizedGifPath = path.join(tempDir, "normalized.gif");
  try {
    await normalizeStickerGif({
      inputPath: item.filePath,
      outputPath: normalizedGifPath,
      scriptPath: config.stickerNormalizeGifScript,
    });
    const normalizedBuffer = await fsp.readFile(normalizedGifPath);
    const normalizedHash = computeBufferHash(normalizedBuffer);
    const duplicate = findDuplicateStickerByHash(config, index, hashByStickerId, normalizedHash);
    if (duplicate) {
      return {
        result: {
          stickerId: duplicate.stickerId,
          filePath: duplicate.filePath,
          created: false,
          deduped: true,
          tags: index[duplicate.stickerId]?.tags || [],
          desc: index[duplicate.stickerId]?.desc || "",
        },
        createdPath: "",
      };
    }

    const stickerId = allocateNextStickerId(index);
    const stickerPath = resolveStickerFilePath(config, stickerId);
    await fsp.mkdir(path.dirname(stickerPath), { recursive: true });
    await fsp.copyFile(normalizedGifPath, stickerPath);
    index[stickerId] = {
      tags: item.tags,
      desc: item.desc,
    };
    hashByStickerId.set(stickerId, normalizedHash);
    tagCatalog.splice(0, tagCatalog.length, ...mergeStickerTagCatalog(tagCatalog, item.tags));
    return {
      result: {
        stickerId,
        filePath: stickerPath,
        created: true,
        deduped: false,
        tags: item.tags,
        desc: item.desc,
      },
      createdPath: stickerPath,
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function buildStickerDeletedText(stickerIds) {
  const normalizedIds = Array.isArray(stickerIds)
    ? stickerIds.map((value) => normalizeStickerId(value)).filter(Boolean)
    : [normalizeStickerId(stickerIds)].filter(Boolean);
  return [
    "❌ 系统提示:",
    "表情包已删除",
    `ID: ${normalizedIds.join("、")}`,
  ].join("\n");
}

function normalizeStickerId(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isUnderDirectory(filePath, parentDir) {
  const normalizedParentDir = path.resolve(parentDir);
  const normalizedFilePath = path.resolve(filePath);
  return normalizedFilePath === normalizedParentDir || normalizedFilePath.startsWith(`${normalizedParentDir}${path.sep}`);
}

async function writeJsonFile(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonFileSync(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

module.exports = {
  DEFAULT_PICK_LIMIT,
  MIN_STICKER_DESC_CHARS,
  STICKER_TAG_GUIDANCE,
  STICKER_DESC_GUIDANCE,
  STICKER_DESC_FIELD_DESCRIPTION,
  StickerService,
  allocateNextStickerId,
  buildStickerPaths,
  ensureStickerCatalogFilesSync,
  loadStickerTagsTemplateSync,
  loadStickerTagsSync,
  loadStickerIndexSync,
  normalizeStickerGif,
  resolveStickerFilePath,
};
