const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { CyberbossApp } = require("../src/core/app");

test("system messages bypass normal inbound wrapping", async () => {
  const prepared = await CyberbossApp.prototype.prepareIncomingMessageForRuntime.call({}, {
    provider: "system",
    text: "SYSTEM ACTION MODE\n\nTrigger:\n测试 system send 命令",
    attachments: [],
  }, "/tmp");

  assert.deepEqual(prepared, {
    provider: "system",
    text: "SYSTEM ACTION MODE\n\nTrigger:\n测试 system send 命令",
    originalText: "SYSTEM ACTION MODE\n\nTrigger:\n测试 system send 命令",
    attachments: [],
    attachmentFailures: [],
  });
});

test("image attachments inject view_image instructions for runtimes that support it", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-inbound-test-"));
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? "image/jpeg" : "";
      },
    },
    async arrayBuffer() {
      return Buffer.from("fake-jpeg-bytes");
    },
  });

  try {
    const prepared = await CyberbossApp.prototype.prepareIncomingMessageForRuntime.call({
      config: {
        stateDir,
        weixinCdnBaseUrl: "https://cdn.example.com",
        userName: "User",
      },
      runtimeAdapter: {
        describe() {
          return { id: "codex" };
        },
      },
      channelAdapter: {
        async sendText() {},
      },
    }, {
      provider: "weixin",
      text: "",
      senderId: "user-1",
      contextToken: "ctx-1",
      attachments: [{
        kind: "image",
        fileName: "photo.jpg",
        directUrls: ["https://example.com/photo.jpg"],
        mediaRef: { encryptType: 0 },
      }],
      receivedAt: "2026-04-17T10:00:00.000Z",
    }, "/workspace");

    assert.match(prepared.text, /Read every image first with `view_image`\./i);
    assert.match(prepared.text, /Say nothing before reading/i);
    assert.match(prepared.text, /cyberboss_sticker_save_from_inbox/i);
    assert.match(prepared.text, /`items` array/i);
    assert.match(prepared.text, /cyberboss_sticker_tags/i);
    assert.match(prepared.text, /short new tag/i);
    assert.match(prepared.text, /Do not describe save steps/i);
    assert.doesNotMatch(prepared.text, /Do not use `Read` or shell commands on image files/i);
    assert.equal(prepared.attachments[0].contentType, "image/jpeg");
    assert.equal(prepared.attachments[0].isImage, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("image attachments tell claudecode to use Read on the saved local image file", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-inbound-test-"));
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? "image/jpeg" : "";
      },
    },
    async arrayBuffer() {
      return Buffer.from("fake-jpeg-bytes");
    },
  });

  try {
    const prepared = await CyberbossApp.prototype.prepareIncomingMessageForRuntime.call({
      config: {
        stateDir,
        weixinCdnBaseUrl: "https://cdn.example.com",
        userName: "User",
      },
      runtimeAdapter: {
        describe() {
          return { id: "claudecode" };
        },
      },
      channelAdapter: {
        async sendText() {},
      },
    }, {
      provider: "weixin",
      text: "",
      senderId: "user-1",
      contextToken: "ctx-1",
      attachments: [{
        kind: "image",
        fileName: "photo.jpg",
        directUrls: ["https://example.com/photo.jpg"],
        mediaRef: { encryptType: 0 },
      }],
      receivedAt: "2026-04-17T10:00:00.000Z",
    }, "/workspace");

    assert.match(prepared.text, /Read them before replying to User/i);
    assert.match(prepared.text, /Read every image first with `Read`\./i);
    assert.match(prepared.text, /Say nothing before reading/i);
    assert.match(prepared.text, /cyberboss_sticker_save_from_inbox/i);
    assert.match(prepared.text, /`items` array/i);
    assert.match(prepared.text, /cyberboss_sticker_tags/i);
    assert.match(prepared.text, /short new tag/i);
    assert.match(prepared.text, /Do not describe save steps/i);
    assert.doesNotMatch(prepared.text, /Do not use shell commands or wrappers/i);
    assert.doesNotMatch(prepared.text, /view_image/i);
    assert.equal(prepared.attachments[0].contentType, "image/jpeg");
    assert.equal(prepared.attachments[0].isImage, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("image-only inbound turns enter the dedicated debounce queue", async () => {
  const queued = [];
  let routed = 0;
  await CyberbossApp.prototype.handlePreparedMessage.call({
    runtimeAdapter: {
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
        };
      },
    },
    streamDelivery: {
      setReplyTarget() {},
    },
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    async prepareIncomingMessageForRuntime() {
      return {
        workspaceId: "default",
        accountId: "wx-account",
        senderId: "user-1",
        contextToken: "ctx-1",
        provider: "weixin",
        originalText: "",
        text: "image prompt",
        attachments: [{
          kind: "image",
          contentType: "image/jpeg",
          isImage: true,
          absolutePath: "/tmp/a.jpg",
        }],
        attachmentFailures: [],
        receivedAt: "2026-04-30T10:00:00.000Z",
      };
    },
    isTurnDispatchBlocked() {
      return false;
    },
    enqueuePendingImageInbound(payload) {
      queued.push(payload);
    },
    async routePreparedInbound() {
      routed += 1;
    },
  }, {
    workspaceId: "default",
    accountId: "wx-account",
    senderId: "user-1",
    contextToken: "ctx-1",
    text: "",
    attachments: [],
  }, {
    allowCommands: false,
  });

  assert.equal(queued.length, 1);
  assert.equal(routed, 0);
});

test("debounced image batches merge with a trailing text message into one prepared turn", async () => {
  const scopeKey = "binding-1::/workspace";
  let routed = null;
  const app = {
    config: {
      userName: "User",
    },
    pendingImageInboundByScope: new Map([[scopeKey, {
      bindingKey: "binding-1",
      workspaceRoot: "/workspace",
      messages: [{
        senderId: "user-1",
        accountId: "wx-account",
        workspaceId: "default",
        provider: "weixin",
        contextToken: "ctx-1",
        originalText: "",
        text: "image prompt 1",
        attachments: [{
          kind: "image",
          contentType: "image/jpeg",
          isImage: true,
          absolutePath: "/tmp/a.jpg",
        }],
        attachmentFailures: [],
        receivedAt: "2026-04-30T10:00:00.000Z",
      }, {
        senderId: "user-1",
        accountId: "wx-account",
        workspaceId: "default",
        provider: "weixin",
        contextToken: "ctx-1",
        originalText: "",
        text: "image prompt 2",
        attachments: [{
          kind: "image",
          contentType: "image/png",
          isImage: true,
          absolutePath: "/tmp/b.png",
        }],
        attachmentFailures: [],
        receivedAt: "2026-04-30T10:00:01.000Z",
      }],
      timer: null,
    }]]),
    runtimeAdapter: {
      describe() {
        return { id: "codex" };
      },
    },
    clearPendingImageInboundTimer: CyberbossApp.prototype.clearPendingImageInboundTimer,
    async routePreparedInbound({ prepared }) {
      routed = prepared;
      return true;
    },
  };

  await CyberbossApp.prototype.flushPendingImageInboundBatch.call(app, {
    bindingKey: "binding-1",
    workspaceRoot: "/workspace",
    trailingPrepared: {
      senderId: "user-1",
      accountId: "wx-account",
      workspaceId: "default",
      provider: "weixin",
      contextToken: "ctx-2",
      originalText: "这是补充文字",
      text: "text prompt",
      attachments: [],
      attachmentFailures: [],
      receivedAt: "2026-04-30T10:00:02.000Z",
    },
  });

  assert.ok(routed);
  assert.equal(routed.attachments.length, 2);
  assert.equal(routed.contextToken, "ctx-2");
  assert.match(routed.originalText, /这是补充文字/);
  assert.match(routed.text, /这是补充文字/);
  assert.equal((routed.text.match(/Say nothing before reading/g) || []).length, 1);
});

test("debounced image batches still hand off to the normal pending buffer when the runtime is blocked", async () => {
  const scopeKey = "binding-1::/workspace";
  const buffered = [];
  const app = {
    pendingImageInboundByScope: new Map([[scopeKey, {
      bindingKey: "binding-1",
      workspaceRoot: "/workspace",
      messages: [{
        senderId: "user-1",
        accountId: "wx-account",
        workspaceId: "default",
        provider: "weixin",
        contextToken: "ctx-1",
        originalText: "",
        text: "image prompt",
        attachments: [{
          kind: "image",
          contentType: "image/jpeg",
          isImage: true,
          absolutePath: "/tmp/a.jpg",
        }],
        attachmentFailures: [],
        receivedAt: "2026-04-30T10:00:00.000Z",
      }],
      timer: null,
    }]]),
    config: {
      userName: "User",
    },
    runtimeAdapter: {
      describe() {
        return { id: "codex" };
      },
    },
    isTurnDispatchBlocked() {
      return true;
    },
    bufferPendingInboundMessage(payload) {
      buffered.push(payload);
    },
    async dispatchPreparedTurn() {
      throw new Error("should not dispatch while blocked");
    },
    clearPendingImageInboundTimer: CyberbossApp.prototype.clearPendingImageInboundTimer,
    routePreparedInbound: CyberbossApp.prototype.routePreparedInbound,
  };

  await CyberbossApp.prototype.flushPendingImageInboundBatch.call(app, {
    bindingKey: "binding-1",
    workspaceRoot: "/workspace",
  });

  assert.equal(buffered.length, 1);
  assert.equal(buffered[0].prepared.attachments.length, 1);
});

test("pending image-only inbox messages merge into one read prompt", () => {
  const merged = CyberbossApp.prototype.mergePendingInboundDraft.call({
    config: {
      userName: "User",
    },
    runtimeAdapter: {
      describe() {
        return { id: "codex" };
      },
    },
  }, {
    bindingKey: "binding-1",
    workspaceRoot: "/workspace",
    messages: [{
      senderId: "user-1",
      accountId: "wx-account",
      workspaceId: "default",
      provider: "weixin",
      contextToken: "ctx-1",
      originalText: "",
      text: "old image prompt 1",
      attachments: [{
        kind: "image",
        contentType: "image/jpeg",
        isImage: true,
        absolutePath: "/tmp/a.jpg",
      }],
      attachmentFailures: [],
      receivedAt: "2026-04-30T10:00:00.000Z",
    }, {
      senderId: "user-1",
      accountId: "wx-account",
      workspaceId: "default",
      provider: "weixin",
      contextToken: "ctx-1",
      originalText: "",
      text: "old image prompt 2",
      attachments: [{
        kind: "image",
        contentType: "image/png",
        isImage: true,
        absolutePath: "/tmp/b.png",
      }],
      attachmentFailures: [],
      receivedAt: "2026-04-30T10:00:01.000Z",
    }],
  });

  assert.equal(merged.prepared.attachments.length, 2);
  assert.equal(merged.remainingMessages.length, 0);
  assert.match(merged.prepared.text, /Saved attachments:/i);
  assert.match(merged.prepared.text, /cyberboss_sticker_save_from_inbox/i);
  assert.match(merged.prepared.text, /`items` array/i);
  assert.equal((merged.prepared.text.match(/Say nothing before reading/g) || []).length, 1);
});

test("pending image-only inbox messages are split into batches of 10 attachments", () => {
  const merged = CyberbossApp.prototype.mergePendingInboundDraft.call({
    config: {
      userName: "User",
    },
    runtimeAdapter: {
      describe() {
        return { id: "codex" };
      },
    },
  }, {
    bindingKey: "binding-1",
    workspaceRoot: "/workspace",
    messages: [{
      senderId: "user-1",
      accountId: "wx-account",
      workspaceId: "default",
      provider: "weixin",
      contextToken: "ctx-1",
      originalText: "",
      text: "old image prompt",
      attachments: Array.from({ length: 12 }, (_, index) => ({
        kind: "image",
        contentType: "image/jpeg",
        isImage: true,
        absolutePath: `/tmp/${index + 1}.jpg`,
      })),
      attachmentFailures: [],
      receivedAt: "2026-04-30T10:00:00.000Z",
    }],
  });

  assert.equal(merged.prepared.attachments.length, 10);
  assert.equal(merged.remainingMessages.length, 1);
  assert.equal(merged.remainingMessages[0].attachments.length, 2);
});

test("location arrive_home trigger enqueues a system action message", () => {
  const queued = [];
  CyberbossApp.prototype.handleLocationAccepted.call({
    activeAccountId: "wx-account",
    config: {
      allowedUserIds: ["user-1"],
      workspaceRoot: "/workspace",
      workspaceId: "default",
    },
    runtimeAdapter: {
      getSessionStore() {
        return {};
      },
    },
    systemMessageQueue: {
      enqueue(message) {
        queued.push(message);
        return message;
      },
    },
  }, {
    appended: {
      point: {
        id: "point-1",
        trigger: "arrive_home",
        timestamp: "2026-04-18T16:00:00.000Z",
        receivedAt: "2026-04-18T16:00:01.000Z",
      },
      movementEvent: null,
    },
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].id, "location-trigger:point-1");
  assert.equal(queued[0].senderId, "user-1");
  assert.equal(queued[0].workspaceRoot, "/workspace");
  assert.equal(queued[0].text, "User arrives home.");
});

test("location leave_home trigger and major move both enqueue system action messages", () => {
  const queued = [];
  CyberbossApp.prototype.handleLocationAccepted.call({
    activeAccountId: "wx-account",
    config: {
      allowedUserIds: ["user-1"],
      workspaceRoot: "/workspace",
      workspaceId: "default",
    },
    runtimeAdapter: {
      getSessionStore() {
        return {};
      },
    },
    systemMessageQueue: {
      enqueue(message) {
        queued.push(message);
        return message;
      },
    },
  }, {
    appended: {
      point: {
        id: "point-2",
        trigger: "leave_home",
        timestamp: "2026-04-18T17:00:00.000Z",
        receivedAt: "2026-04-18T17:00:02.000Z",
      },
      movementEvent: {
        id: "move-1",
        distanceMeters: 2400,
        fromAddress: "Home",
        toAddress: "Office",
        movedAt: "2026-04-18T17:20:00.000Z",
      },
    },
  });

  assert.equal(queued.length, 2);
  assert.equal(queued[0].id, "location-trigger:point-2");
  assert.equal(queued[0].text, "User leaves home.");
  assert.equal(queued[1].id, "location-move:move-1");
  assert.match(queued[1].text, /location appears to have changed significantly/i);
});
