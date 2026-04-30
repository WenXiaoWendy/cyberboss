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
  assert.match(result.guidance, /short new tag/i);
  assert.match(result.guidance, /desc/i);
});

test("sticker service saves inbox images as GIF stickers, grows tags, dedupes, and notifies once", async () => {
  const config = createConfig();
  const { service, sentTexts } = createService(config);
  const inboxPath = writeInboxPng(config, "cat.png");

  const first = await service.saveFromInbox({
    items: [{
      filePath: inboxPath,
      tags: ["可爱", "夸夸"],
      desc: "小猫贴脸蹭蹭，撒娇示爱",
    }],
  }, {
    senderId: "user-1",
  });
  const firstItem = first.results[0];

  assert.equal(first.createdCount, 1);
  assert.equal(firstItem.created, true);
  assert.equal(path.extname(firstItem.filePath), ".gif");
  assert.ok(fs.existsSync(firstItem.filePath));
  assert.equal(loadStickerIndexSync(config)[firstItem.stickerId].desc, "小猫贴脸蹭蹭，撒娇示爱");
  assert.equal(loadStickerIndexSync(config)[firstItem.stickerId].tags.includes("夸夸"), true);
  assert.equal(loadStickerTagsSync(config).includes("夸夸"), true);
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^✅ 系统提示:/);
  assert.match(sentTexts[0].text, /表情包已保存/);
  assert.match(sentTexts[0].text, /如不需要添加该表情包,请让AI删除/);

  const second = await service.saveFromInbox({
    items: [{
      filePath: inboxPath,
      tags: ["可爱"],
      desc: "重复的小猫",
    }],
  }, {
    senderId: "user-1",
  });
  const secondItem = second.results[0];

  assert.equal(second.createdCount, 0);
  assert.equal(secondItem.created, false);
  assert.equal(secondItem.deduped, true);
  assert.equal(secondItem.stickerId, firstItem.stickerId);
  assert.equal(sentTexts.length, 1);
});

test("sticker service saves inbox images from an items array and keeps the tag catalog deduped", async () => {
  const config = createConfig();
  const { service, sentTexts } = createService(config);
  const inboxPathA = writeInboxPng(config, "batch-a.png");
  const inboxPathB = writeInboxPng(config, "batch-b.png");

  const batch = await service.saveFromInbox({
    items: [{
      filePath: inboxPathA,
      tags: ["可爱", "新梗"],
      desc: "小猫歪头卖萌",
    }, {
      filePath: inboxPathB,
      tags: ["新梗"],
      desc: "同一张图再次发送",
    }],
  }, {
    senderId: "user-1",
  });

  assert.equal(batch.createdCount, 1);
  assert.equal(batch.dedupedCount, 1);
  assert.equal(batch.results.length, 2);
  assert.equal(loadStickerTagsSync(config).filter((tag) => tag === "新梗").length, 1);
  assert.equal(sentTexts.length, 1);
});

test("sticker service rejects batch saves larger than 10 items", async () => {
  const config = createConfig();
  const { service } = createService(config);
  const items = Array.from({ length: 11 }, (_, index) => ({
    filePath: writeInboxPng(config, `oversize-${index}.png`),
    tags: ["可爱"],
    desc: `第${index + 1}张`,
  }));

  await assert.rejects(async () => {
    await service.saveFromInbox({ items });
  }, /Sticker save batch size must be 10 or less\./);
});

test("sticker service updates, picks, sends, and deletes saved stickers", async () => {
  const config = createConfig();
  const { service, sentTexts, sentFiles } = createService(config);
  const inboxPath = writeInboxPng(config, "smile.png");
  const saved = await service.saveFromInbox({
    items: [{
      filePath: inboxPath,
      tags: ["开心", "大笑"],
      desc: "笑到停不下来",
    }],
  }, {
    senderId: "user-1",
  });
  const savedItem = saved.results[0];

  const updated = await service.update({
    items: [{
      stickerId: savedItem.stickerId,
      tags: ["开心", "新标签"],
      desc: "笑到拍桌，还写着哈哈哈",
    }],
  });
  assert.equal(updated.updatedCount, 1);
  assert.deepEqual(loadStickerIndexSync(config)[savedItem.stickerId], {
    tags: ["开心", "新标签"],
    desc: "笑到拍桌，还写着哈哈哈",
  });
  assert.equal(loadStickerTagsSync(config).includes("新标签"), true);

  const picked = await service.pick({ tag: "开心", limit: 3 });
  assert.equal(picked.candidates.length, 1);
  assert.equal(picked.candidates[0].stickerId, savedItem.stickerId);

  const delivery = await service.sendToCurrentChat({
    stickerId: savedItem.stickerId,
  }, {
    senderId: "user-1",
  });
  assert.equal(delivery.stickerId, savedItem.stickerId);
  assert.equal(sentFiles.length, 1);
  assert.equal(sentFiles[0].args.filePath, savedItem.filePath);

  const deleted = await service.delete({
    items: [{
      stickerId: savedItem.stickerId,
    }],
  }, {
    senderId: "user-1",
  });
  assert.equal(deleted.deletedCount, 1);
  assert.equal(loadStickerIndexSync(config)[savedItem.stickerId], undefined);
  assert.equal(fs.existsSync(savedItem.filePath), false);
  assert.match(sentTexts[sentTexts.length - 1].text, /^❌ 系统提示:/);
  assert.match(sentTexts[sentTexts.length - 1].text, /表情包已删除/);
});
