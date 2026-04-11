const test = require("node:test");
const assert = require("node:assert/strict");

const { CyberbossApp } = require("../src/core/app");

test("incoming real message replays deferred system replies with the fresh context token", async () => {
  const sent = [];
  const replayed = [];
  const appLike = {
    deferredSystemReplyQueue: {
      drainForSender(accountId, senderId) {
        replayed.push({ accountId, senderId });
        return [{
          id: "deferred-1",
          accountId,
          senderId,
          threadId: "thread-1",
          text: "刚才那条现在补给你",
          createdAt: new Date().toISOString(),
        }];
      },
      enqueue() {
        throw new Error("should not re-enqueue on successful replay");
      },
    },
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload);
      },
    },
  };

  await CyberbossApp.prototype.flushDeferredSystemRepliesForSender.call(appLike, {
    accountId: "acc-1",
    senderId: "user-1",
    contextToken: "ctx-fresh",
  });

  assert.deepEqual(replayed, [{ accountId: "acc-1", senderId: "user-1" }]);
  assert.deepEqual(sent, [{
    userId: "user-1",
    text: "刚才那条现在补给你",
    contextToken: "ctx-fresh",
  }]);
});

test("incoming replay failure re-enqueues deferred system replies", async () => {
  const requeued = [];
  const appLike = {
    deferredSystemReplyQueue: {
      drainForSender(accountId, senderId) {
        return [{
          id: "deferred-2",
          accountId,
          senderId,
          threadId: "thread-2",
          text: "补发失败",
          createdAt: new Date().toISOString(),
        }];
      },
      enqueue(payload) {
        requeued.push(payload);
      },
    },
    channelAdapter: {
      async sendText() {
        const error = new Error("sendMessage ret=-2 errcode= errmsg=");
        error.ret = -2;
        throw error;
      },
    },
  };

  await CyberbossApp.prototype.flushDeferredSystemRepliesForSender.call(appLike, {
    accountId: "acc-2",
    senderId: "user-2",
    contextToken: "ctx-fresh-2",
  });

  assert.equal(requeued.length, 1);
  assert.equal(requeued[0].senderId, "user-2");
  assert.equal(requeued[0].text, "补发失败");
  assert.match(requeued[0].lastError, /ret=-2/);
});
