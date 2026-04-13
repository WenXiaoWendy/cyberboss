const test = require("node:test");
const assert = require("node:assert/strict");

const { StreamDelivery } = require("../src/core/stream-delivery");

const DEFERRED_REPLY_NOTICE = "由于微信 context_token 的限制，上轮对话里有一部分内容当时没能送达；这次用户再次发来消息、context_token 刷新后，先把遗留内容补上。";
const DEFERRED_PLAIN_REPLY_HEADER = "===== 上轮对话遗留内容 =====";
const DEFERRED_SYSTEM_REPLY_HEADER = "===== 期间模型主动联系 =====";
const CURRENT_REPLY_HEADER = "===== 本轮模型回复 =====";

function createHarness({ sendText, getKnownContextTokens } = {}) {
  const sent = [];
  const channelAdapter = {
    async sendText(payload) {
      if (typeof sendText === "function") {
        await sendText(payload, sent);
        return;
      }
      sent.push(payload);
    },
    getKnownContextTokens() {
      if (typeof getKnownContextTokens === "function") {
        return getKnownContextTokens();
      }
      return {};
    },
  };

  const bindingByThreadId = new Map();
  const sessionStore = {
    findBindingForThreadId(threadId) {
      return bindingByThreadId.get(threadId) || null;
    },
  };

  const streamDelivery = new StreamDelivery({ channelAdapter, sessionStore });
  return { sent, streamDelivery, bindingByThreadId };
}

async function runCompletedTurn(streamDelivery, { threadId, turnId, itemId, text }) {
  await streamDelivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: { threadId, turnId },
  });
  await streamDelivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: { threadId, turnId, itemId, text },
  });
  await streamDelivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: { threadId, turnId },
  });
}

test("system silent JSON is suppressed", async () => {
  const { sent, streamDelivery } = createHarness();
  streamDelivery.queueReplyTargetForThread("thread-1", {
    userId: "user-1",
    contextToken: "ctx-1",
    provider: "system",
  });

  await runCompletedTurn(streamDelivery, {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    text: "{\"action\":\"silent\"}",
  });

  assert.deepEqual(sent, []);
});

test("system send_message JSON sends only the message text", async () => {
  const { sent, streamDelivery } = createHarness();
  streamDelivery.queueReplyTargetForThread("thread-2", {
    userId: "user-2",
    contextToken: "ctx-2",
    provider: "system",
  });

  await runCompletedTurn(streamDelivery, {
    threadId: "thread-2",
    turnId: "turn-2",
    itemId: "item-2",
    text: "{\"action\":\"send_message\",\"message\":\"在呢\"}",
  });

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    userId: "user-2",
    text: "在呢",
    contextToken: "ctx-2",
  });
});

test("explicit turn target binding overrides the binding-level fallback", async () => {
  const { sent, streamDelivery, bindingByThreadId } = createHarness();
  bindingByThreadId.set("thread-2b", { bindingKey: "binding-2b" });
  streamDelivery.setReplyTarget("binding-2b", {
    userId: "user-2b",
    contextToken: "ctx-weixin",
    provider: "weixin",
  });
  streamDelivery.bindReplyTargetForTurn({
    threadId: "thread-2b",
    turnId: "turn-2b",
    target: {
      userId: "user-2b",
      contextToken: "ctx-system",
      provider: "system",
    },
  });

  await runCompletedTurn(streamDelivery, {
    threadId: "thread-2b",
    turnId: "turn-2b",
    itemId: "item-2b",
    text: "{\"action\":\"send_message\",\"message\":\"只发系统消息\"}",
  });

  assert.deepEqual(sent, [{
    userId: "user-2b",
    text: "只发系统消息",
    contextToken: "ctx-system",
  }]);
});

test("thread-level system target overrides an already attached binding target", async () => {
  const { sent, streamDelivery, bindingByThreadId } = createHarness();
  bindingByThreadId.set("thread-3", { bindingKey: "binding-3" });
  streamDelivery.setReplyTarget("binding-3", {
    userId: "user-3",
    contextToken: "ctx-weixin",
    provider: "weixin",
  });

  await streamDelivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: { threadId: "thread-3", turnId: "turn-3" },
  });
  await streamDelivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-3",
      turnId: "turn-3",
      itemId: "item-3",
      text: "{\"action\":\"silent\"}",
    },
  });

  streamDelivery.queueReplyTargetForThread("thread-3", {
    userId: "user-3",
    contextToken: "ctx-system",
    provider: "system",
  });

  await streamDelivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: { threadId: "thread-3", turnId: "turn-3" },
  });

  assert.deepEqual(sent, []);
});

test("thread-level targets are consumed in turn order instead of overwriting active runs", async () => {
  const { sent, streamDelivery, bindingByThreadId } = createHarness();
  bindingByThreadId.set("thread-3b", { bindingKey: "binding-3b" });
  streamDelivery.setReplyTarget("binding-3b", {
    userId: "user-3b",
    contextToken: "ctx-binding",
    provider: "weixin",
  });

  await streamDelivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: { threadId: "thread-3b", turnId: "turn-a" },
  });
  streamDelivery.queueReplyTargetForThread("thread-3b", {
    userId: "user-3b",
    contextToken: "ctx-system",
    provider: "system",
  });

  await streamDelivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: { threadId: "thread-3b", turnId: "turn-b" },
  });
  streamDelivery.queueReplyTargetForThread("thread-3b", {
    userId: "user-3b",
    contextToken: "ctx-weixin",
    provider: "weixin",
  });

  await runCompletedTurn(streamDelivery, {
    threadId: "thread-3b",
    turnId: "turn-a",
    itemId: "item-a",
    text: "{\"action\":\"send_message\",\"message\":\"先发系统消息\"}",
  });
  await runCompletedTurn(streamDelivery, {
    threadId: "thread-3b",
    turnId: "turn-b",
    itemId: "item-b",
    text: "再发普通消息",
  });

  assert.deepEqual(sent, [
    {
      userId: "user-3b",
      text: "先发系统消息",
      contextToken: "ctx-system",
    },
    {
      userId: "user-3b",
      text: "再发普通消息",
      contextToken: "ctx-weixin",
    },
  ]);
});

test("plain weixin reply still strips protocol leak text", async () => {
  const { sent, streamDelivery } = createHarness();
  streamDelivery.queueReplyTargetForThread("thread-4", {
    userId: "user-4",
    contextToken: "ctx-4",
    provider: "weixin",
  });

  await runCompletedTurn(streamDelivery, {
    threadId: "thread-4",
    turnId: "turn-4",
    itemId: "item-4",
    text: "好的。analysis to=functions.exec_command code?",
  });

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    userId: "user-4",
    text: "好的。",
    contextToken: "ctx-4",
  });
});

test("plain weixin reply does not leak a standalone structured action payload", async () => {
  const { sent, streamDelivery } = createHarness();
  streamDelivery.queueReplyTargetForThread("thread-4c", {
    userId: "user-4c",
    contextToken: "ctx-4c",
    provider: "weixin",
  });

  await runCompletedTurn(streamDelivery, {
    threadId: "thread-4c",
    turnId: "turn-4c",
    itemId: "item-4c",
    text: "json:{\"action\":\"send_message\",\"message\":\"我接得住。\"}",
  });

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    userId: "user-4c",
    text: "我接得住。",
    contextToken: "ctx-4c",
  });
});

test("plain weixin reply sends finalized item text even if earlier streaming text was different", async () => {
  const { sent, streamDelivery } = createHarness();
  streamDelivery.queueReplyTargetForThread("thread-4b", {
    userId: "user-4b",
    contextToken: "ctx-4b",
    provider: "weixin",
  });

  await streamDelivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: { threadId: "thread-4b", turnId: "turn-4b" },
  });
  await streamDelivery.handleRuntimeEvent({
    type: "runtime.reply.delta",
    payload: { threadId: "thread-4b", turnId: "turn-4b", itemId: "item-4b", text: "先写很长的一版" },
  });
  await streamDelivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: { threadId: "thread-4b", turnId: "turn-4b", itemId: "item-4b", text: "改短了" },
  });
  await streamDelivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: { threadId: "thread-4b", turnId: "turn-4b" },
  });

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    userId: "user-4b",
    text: "改短了",
    contextToken: "ctx-4b",
  });
});

test("system send_message retries with the latest context token on ret=-2", async () => {
  const attempts = [];
  const { sent, streamDelivery } = createHarness({
    async sendText(payload, successful) {
      attempts.push(payload);
      if (attempts.length === 1) {
        const error = new Error("sendMessage ret=-2 errcode= errmsg=");
        error.ret = -2;
        throw error;
      }
      successful.push(payload);
    },
    getKnownContextTokens() {
      return { "user-5": "ctx-fresh" };
    },
  });
  streamDelivery.queueReplyTargetForThread("thread-5", {
    userId: "user-5",
    contextToken: "ctx-stale",
    provider: "system",
  });

  await runCompletedTurn(streamDelivery, {
    threadId: "thread-5",
    turnId: "turn-5",
    itemId: "item-5",
    text: "{\"action\":\"send_message\",\"message\":\"回来啦\"}",
  });

  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0], {
    userId: "user-5",
    text: "回来啦",
    contextToken: "ctx-stale",
  });
  assert.deepEqual(attempts[1], {
    userId: "user-5",
    text: "回来啦",
    contextToken: "ctx-fresh",
  });
  assert.deepEqual(sent, [{
    userId: "user-5",
    text: "回来啦",
    contextToken: "ctx-fresh",
  }]);
});

test("system send_message is deferred after retry exhaustion", async () => {
  const deferred = [];
  const { sent, streamDelivery } = createHarness({
    async sendText() {
      const error = new Error("sendMessage ret=-2 errcode= errmsg=");
      error.ret = -2;
      throw error;
    },
    getKnownContextTokens() {
      return { "user-6": "ctx-stale" };
    },
  });
  streamDelivery.onDeferredSystemReply = async (payload) => {
    deferred.push(payload);
  };
  streamDelivery.queueReplyTargetForThread("thread-6", {
    userId: "user-6",
    contextToken: "ctx-stale",
    provider: "system",
  });

  await runCompletedTurn(streamDelivery, {
    threadId: "thread-6",
    turnId: "turn-6",
    itemId: "item-6",
    text: "{\"action\":\"send_message\",\"message\":\"等等我\"}",
  });

  assert.deepEqual(sent, []);
  assert.equal(deferred.length, 1);
  assert.equal(deferred[0].threadId, "thread-6");
  assert.equal(deferred[0].userId, "user-6");
  assert.equal(deferred[0].text, "等等我");
});

test("plain reply prepends deferred prefix to the next reply", async () => {
  const { sent, streamDelivery, bindingByThreadId } = createHarness();
  bindingByThreadId.set("thread-7", { bindingKey: "binding-7" });
  streamDelivery.setReplyTarget("binding-7", {
    userId: "user-7",
    contextToken: "ctx-7",
    provider: "weixin",
  });
  streamDelivery.setDeferredReplyPrefix(
    "binding-7",
    `${DEFERRED_REPLY_NOTICE}\n\n${DEFERRED_PLAIN_REPLY_HEADER}\n旧尾段\n\n${DEFERRED_SYSTEM_REPLY_HEADER}\n中间主动联系`
  );

  await runCompletedTurn(streamDelivery, {
    threadId: "thread-7",
    turnId: "turn-7",
    itemId: "item-7",
    text: "这是新一轮自动回复",
  });

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    userId: "user-7",
    text: `${DEFERRED_REPLY_NOTICE}\n\n${DEFERRED_PLAIN_REPLY_HEADER}\n旧尾段\n\n${DEFERRED_SYSTEM_REPLY_HEADER}\n中间主动联系\n\n${CURRENT_REPLY_HEADER}\n这是新一轮自动回复`,
    contextToken: "ctx-7",
    preserveBlock: true,
  });
});

test("plain reply with deferred prefix is sent as soon as the first item is finalized", async () => {
  const { sent, streamDelivery, bindingByThreadId } = createHarness();
  bindingByThreadId.set("thread-8", { bindingKey: "binding-8" });
  streamDelivery.setReplyTarget("binding-8", {
    userId: "user-8",
    contextToken: "ctx-8",
    provider: "weixin",
  });
  streamDelivery.setDeferredReplyPrefix(
    "binding-8",
    `${DEFERRED_REPLY_NOTICE}\n\n${DEFERRED_PLAIN_REPLY_HEADER}\n旧尾段\n\n${DEFERRED_SYSTEM_REPLY_HEADER}\n中间主动联系`
  );

  await streamDelivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: { threadId: "thread-8", turnId: "turn-8" },
  });
  await streamDelivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-8",
      turnId: "turn-8",
      itemId: "item-8",
      text: "第一段",
    },
  });

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    userId: "user-8",
    text: `${DEFERRED_REPLY_NOTICE}\n\n${DEFERRED_PLAIN_REPLY_HEADER}\n旧尾段\n\n${DEFERRED_SYSTEM_REPLY_HEADER}\n中间主动联系\n\n${CURRENT_REPLY_HEADER}\n第一段`,
    contextToken: "ctx-8",
    preserveBlock: true,
  });
});
