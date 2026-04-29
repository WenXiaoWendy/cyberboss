const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { saveWeixinAccount } = require("../src/adapters/channel/weixin/account-store");
const { persistContextToken } = require("../src/adapters/channel/weixin/context-token-store");
const {
  StickerService,
  loadStickerTagsTemplateSync,
  loadStickerTagsSync,
  loadStickerIndexSync,
} = require("../src/services/sticker-service");

function createConfig() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-sticker-test-"));
  const stickersDir = path.join(stateDir, "stickers");
  return {
    stateDir,
    stickersDir,
    stickerAssetsDir: path.join(stickersDir, "assets"),
    stickersIndexFile: path.join(stickersDir, "index.json"),
    stickerTagsFile: path.join(stickersDir, "tags.json"),
    stickersTemplateIndexFile: path.join("/Users/tingyiwen/Dev/cyberboss", "templates", "stickers", "index.json"),
    stickerTagsTemplateFile: path.join("/Users/tingyiwen/Dev/cyberboss", "templates", "stickers", "tags.json"),
    stickerNormalizeGifScript: path.join("/Users/tingyiwen/Dev/cyberboss", "scripts", "normalize-sticker-gif.js"),
    accountsDir: path.join(stateDir, "accounts"),
    weixinBaseUrl: "https://ilinkai.weixin.qq.com",
    workspaceId: "default",
    allowedUserIds: [],
  };
}

function writeInboxPng(config, fileName = "cat.png") {
  const inboxDir = path.join(config.stateDir, "inbox", "2026-04-29");
  fs.mkdirSync(inboxDir, { recursive: true });
  const filePath = path.join(inboxDir, fileName);
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==";
  fs.writeFileSync(filePath, Buffer.from(pngBase64, "base64"));
  return filePath;
}

function createService(config) {
  saveWeixinAccount(config, "wx-account", {
    token: "token-1",
    baseUrl: config.weixinBaseUrl,
    userId: "bot-user",
  });
  persistContextToken(config, "wx-account", "user-1", "ctx-1");
  const sentTexts = [];
  const sentFiles = [];
  const service = new StickerService({
    config: {
      ...config,
      accountId: "wx-account",
    },
    channelAdapter: {
      async sendText(payload) {
        sentTexts.push(payload);
      },
    },
    sessionStore: {
      state: { bindings: {} },
    },
    channelFileService: {
      async sendToCurrentChat(args, context) {
        sentFiles.push({ args, context });
        return { filePath: args.filePath, userId: args.userId || context.senderId };
      },
    },
  });
  return { service, sentTexts, sentFiles };
}

test("sticker service initializes the default tag catalog", () => {
  const config = createConfig();
  const tags = loadStickerTagsSync(config);
  assert.deepEqual(tags, loadStickerTagsTemplateSync(config));
  assert.ok(fs.existsSync(config.stickerTagsFile));
});

test("sticker service keeps a local tags file unchanged when a template exists", () => {
  const config = createConfig();
  fs.mkdirSync(path.dirname(config.stickerTagsFile), { recursive: true });
  fs.writeFileSync(config.stickerTagsFile, `${JSON.stringify(["自定义"], null, 2)}\n`, "utf8");

  const tags = loadStickerTagsSync(config);

  assert.deepEqual(tags, ["自定义"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(config.stickerTagsFile, "utf8")), ["自定义"]);
});

test("sticker service exposes the current tag catalog on demand", async () => {
  const config = createConfig();
  const { service } = createService(config);
  const result = await service.listTags();

  assert.equal(Array.isArray(result.tags), true);
  assert.equal(result.tags.includes("可爱"), true);
  assert.match(result.guidance, /desc/i);
});

test("sticker service saves inbox images as GIF stickers, dedupes, and notifies once", async () => {
  const config = createConfig();
  const { service, sentTexts } = createService(config);
  const inboxPath = writeInboxPng(config, "cat.png");

  const first = await service.saveFromInbox({
    filePath: inboxPath,
    tags: ["可爱", "爱"],
    desc: "小猫贴脸蹭蹭，撒娇示爱",
  }, {
    senderId: "user-1",
  });

  assert.equal(first.created, true);
  assert.equal(path.extname(first.filePath), ".gif");
  assert.ok(fs.existsSync(first.filePath));
  assert.equal(loadStickerIndexSync(config)[first.stickerId].desc, "小猫贴脸蹭蹭，撒娇示爱");
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^✅ 系统提示:/);
  assert.match(sentTexts[0].text, /表情包已保存/);
  assert.match(sentTexts[0].text, /如不需要添加该表情包,请让AI删除/);

  const second = await service.saveFromInbox({
    filePath: inboxPath,
    tags: ["可爱"],
    desc: "重复的小猫",
  }, {
    senderId: "user-1",
  });

  assert.equal(second.created, false);
  assert.equal(second.deduped, true);
  assert.equal(second.stickerId, first.stickerId);
  assert.equal(sentTexts.length, 1);
});

test("sticker service picks, sends, and deletes saved stickers", async () => {
  const config = createConfig();
  const { service, sentTexts, sentFiles } = createService(config);
  const inboxPath = writeInboxPng(config, "smile.png");
  const saved = await service.saveFromInbox({
    filePath: inboxPath,
    tags: ["开心", "大笑"],
    desc: "笑到停不下来",
  }, {
    senderId: "user-1",
  });

  const picked = await service.pick({ tag: "开心", limit: 3 });
  assert.equal(picked.candidates.length, 1);
  assert.equal(picked.candidates[0].stickerId, saved.stickerId);

  const delivery = await service.sendToCurrentChat({
    stickerId: saved.stickerId,
  }, {
    senderId: "user-1",
  });
  assert.equal(delivery.stickerId, saved.stickerId);
  assert.equal(sentFiles.length, 1);
  assert.equal(sentFiles[0].args.filePath, saved.filePath);

  const deleted = await service.deleteById({
    stickerId: saved.stickerId,
  }, {
    senderId: "user-1",
  });
  assert.equal(deleted.deleted, true);
  assert.equal(loadStickerIndexSync(config)[saved.stickerId], undefined);
  assert.equal(fs.existsSync(saved.filePath), false);
  assert.match(sentTexts[sentTexts.length - 1].text, /表情包已删除/);
});
