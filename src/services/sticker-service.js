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
      guidance: "Choose 1-3 tags. Use short tags only. If the sticker contains readable text, keep a short scene description and append the sticker text in desc.",
    };
  }

  async saveFromInbox({ filePath = "", tags = [], desc = "", userId = "" } = {}, context = {}) {
    ensureStickerCatalogFilesSync(this.config);
    const resolvedInputPath = path.resolve(normalizeText(filePath));
    if (!resolvedInputPath) {
      throw new Error("Missing sticker inbox file path.");
    }
    if (!fs.existsSync(resolvedInputPath)) {
      throw new Error(`Sticker inbox file does not exist: ${resolvedInputPath}`);
    }
    if (!isUnderDirectory(resolvedInputPath, buildStickerPaths(this.config).inboxDir)) {
      throw new Error(`Sticker inbox file must be under ${buildStickerPaths(this.config).inboxDir}`);
    }
    const stat = fs.statSync(resolvedInputPath);
    if (!stat.isFile()) {
      throw new Error(`Sticker inbox file must be a file: ${resolvedInputPath}`);
    }

    const normalizedDesc = normalizeText(desc);
    if (!normalizedDesc) {
      throw new Error("Sticker description is required.");
    }
    const allowedTags = loadStickerTagsSync(this.config);
    const normalizedTags = normalizeStickerTags(tags, allowedTags);

    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "cyberboss-sticker-save-"));
    const normalizedGifPath = path.join(tempDir, "normalized.gif");
    try {
      await normalizeStickerGif({
        inputPath: resolvedInputPath,
        outputPath: normalizedGifPath,
        scriptPath: this.config.stickerNormalizeGifScript,
      });
      const normalizedBuffer = await fsp.readFile(normalizedGifPath);
      const index = loadStickerIndexSync(this.config);
      const duplicate = findDuplicateStickerByBuffer(this.config, index, normalizedBuffer);
      if (duplicate) {
        return {
          stickerId: duplicate.stickerId,
          filePath: duplicate.filePath,
          created: false,
          deduped: true,
          tags: index[duplicate.stickerId]?.tags || [],
          desc: index[duplicate.stickerId]?.desc || "",
        };
      }

      const stickerId = allocateNextStickerId(index);
      const stickerPath = resolveStickerFilePath(this.config, stickerId);
      await fsp.mkdir(path.dirname(stickerPath), { recursive: true });
      await fsp.copyFile(normalizedGifPath, stickerPath);

      const nextIndex = {
        ...index,
        [stickerId]: {
          tags: normalizedTags,
          desc: normalizedDesc,
        },
      };
      try {
        await writeJsonFile(this.config.stickersIndexFile, nextIndex);
      } catch (error) {
        await fsp.rm(stickerPath, { force: true }).catch(() => {});
        throw error;
      }

      await this.sendContextText({
        text: buildStickerSavedText({
          stickerId,
          tags: normalizedTags,
          desc: normalizedDesc,
        }),
        userId,
        context,
      });

      return {
        stickerId,
        filePath: stickerPath,
        created: true,
        deduped: false,
        tags: normalizedTags,
        desc: normalizedDesc,
      };
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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

  async deleteById({ stickerId = "" } = {}, context = {}) {
    ensureStickerCatalogFilesSync(this.config);
    const normalizedStickerId = normalizeStickerId(stickerId);
    if (!normalizedStickerId) {
      throw new Error("Sticker id is required.");
    }
    const index = loadStickerIndexSync(this.config);
    if (!index[normalizedStickerId]) {
      throw new Error(`Sticker not found: ${normalizedStickerId}`);
    }
    const nextIndex = { ...index };
    delete nextIndex[normalizedStickerId];
    await writeJsonFile(this.config.stickersIndexFile, nextIndex);

    const filePath = resolveStickerFilePath(this.config, normalizedStickerId);
    await fsp.rm(filePath, { force: true }).catch(() => {});

    await this.sendContextText({
      text: buildStickerDeletedText(normalizedStickerId),
      context,
    });

    return {
      stickerId: normalizedStickerId,
      filePath,
      deleted: true,
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
    stickersTemplateIndexFile: normalizeText(config.stickersTemplateIndexFile) || path.resolve(__dirname, "..", "..", "templates", "stickers", "index.json"),
    stickerTagsTemplateFile: normalizeText(config.stickerTagsTemplateFile) || path.resolve(__dirname, "..", "..", "templates", "stickers", "tags.json"),
  };
}

function ensureStickerCatalogFilesSync(config = {}) {
  const paths = buildStickerPaths(config);
  fs.mkdirSync(paths.stickersDir, { recursive: true });
  fs.mkdirSync(paths.stickerAssetsDir, { recursive: true });
  fs.mkdirSync(path.dirname(paths.stickersIndexFile), { recursive: true });
  ensureFileFromTemplateSync(paths.stickersIndexFile, paths.stickersTemplateIndexFile, "{}\n");
  ensureFileFromTemplateSync(
    paths.stickerTagsFile,
    paths.stickerTagsTemplateFile,
    "[]\n",
  );
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
      ? parsed.map((value) => normalizeText(value)).filter(Boolean)
      : [];
    return normalized.length ? normalized : loadStickerTagsTemplateSync(config);
  } catch {
    return loadStickerTagsTemplateSync(config);
  }
}

function loadStickerTagsTemplateSync(config = {}) {
  const templatePath = buildStickerPaths(config).stickerTagsTemplateFile;
  try {
    const raw = fs.readFileSync(templatePath, "utf8");
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

function ensureFileFromTemplateSync(targetPath, templatePath, fallbackContent) {
  if (!targetPath || fs.existsSync(targetPath)) {
    return;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (templatePath && fs.existsSync(templatePath)) {
    fs.copyFileSync(templatePath, targetPath);
    return;
  }
  fs.writeFileSync(targetPath, fallbackContent, "utf8");
}

function normalizeStickerTags(tags, allowedTags) {
  if (!Array.isArray(tags)) {
    throw new Error("Sticker tags must be an array.");
  }
  const normalized = Array.from(new Set(tags.map((value) => normalizeText(value)).filter(Boolean)));
  if (normalized.length < 1 || normalized.length > 3) {
    throw new Error("Sticker tags must contain 1 to 3 labels.");
  }
  const allowedSet = new Set(Array.isArray(allowedTags) ? allowedTags : []);
  for (const tag of normalized) {
    if (!allowedSet.has(tag)) {
      throw new Error(`Sticker tag is not allowed: ${tag}`);
    }
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

function findDuplicateStickerByBuffer(config = {}, index = {}, buffer) {
  const targetHash = computeBufferHash(buffer);
  for (const stickerId of Object.keys(index)) {
    const filePath = resolveStickerFilePath(config, stickerId);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    try {
      const currentHash = computeBufferHash(fs.readFileSync(filePath));
      if (currentHash === targetHash) {
        return { stickerId, filePath };
      }
    } catch {
      // Ignore unreadable sticker files during duplicate checks.
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

function buildStickerDeletedText(stickerId) {
  return [
    "表情包已删除",
    `ID: ${stickerId}`,
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

module.exports = {
  DEFAULT_PICK_LIMIT,
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
