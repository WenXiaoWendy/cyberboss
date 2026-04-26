const test = require("node:test");
const assert = require("node:assert/strict");

const { mapCopilotMessageToRuntimeEvent } = require("../src/adapters/runtime/copilot/events");

const CONTEXT = { threadId: "thread-1", turnId: "turn-1" };

test("assistant.delta maps to runtime.reply.delta with delta text", () => {
  const event = mapCopilotMessageToRuntimeEvent(
    {
      type: "assistant.delta",
      payload: { delta: "hello", messageId: "m-1" },
    },
    CONTEXT,
  );
  assert.equal(event.type, "runtime.reply.delta");
  assert.equal(event.payload.threadId, "thread-1");
  assert.equal(event.payload.turnId, "turn-1");
  assert.equal(event.payload.itemId, "m-1");
  assert.equal(event.payload.text, "hello");
});

test("assistant.delta with empty delta returns null (do not emit empty events)", () => {
  const event = mapCopilotMessageToRuntimeEvent(
    { type: "assistant.delta", payload: { delta: "" } },
    CONTEXT,
  );
  assert.equal(event, null);
});

test("assistant.complete maps to runtime.reply.completed with full text", () => {
  const event = mapCopilotMessageToRuntimeEvent(
    {
      type: "assistant.complete",
      payload: { text: "done", messageId: "m-2" },
    },
    CONTEXT,
  );
  assert.equal(event.type, "runtime.reply.completed");
  assert.equal(event.payload.text, "done");
  assert.equal(event.payload.itemId, "m-2");
});

test("idle maps to runtime.turn.completed and forwards accumulated text from context", () => {
  const event = mapCopilotMessageToRuntimeEvent(
    { type: "idle", payload: {} },
    { ...CONTEXT, text: "final answer" },
  );
  assert.equal(event.type, "runtime.turn.completed");
  assert.equal(event.payload.text, "final answer");
});

test("error maps to runtime.turn.failed with normalized message", () => {
  const event = mapCopilotMessageToRuntimeEvent(
    { type: "error", error: new Error("boom"), message: "boom" },
    CONTEXT,
  );
  assert.equal(event.type, "runtime.turn.failed");
  assert.equal(event.payload.text, "boom");
});

test("error without explicit message falls back to a generic string", () => {
  const event = mapCopilotMessageToRuntimeEvent(
    { type: "error" },
    CONTEXT,
  );
  assert.equal(event.type, "runtime.turn.failed");
  assert.equal(event.payload.text, "copilot runtime error");
});

test("unknown event types do not produce a runtime event", () => {
  assert.equal(
    mapCopilotMessageToRuntimeEvent({ type: "message.sent" }, CONTEXT),
    null,
  );
  assert.equal(mapCopilotMessageToRuntimeEvent(null, CONTEXT), null);
});

test("session.usage_info maps to runtime.context.updated with currentTokens and contextWindow", () => {
  const event = mapCopilotMessageToRuntimeEvent(
    {
      type: "session.usage_info",
      payload: { currentTokens: 12345, tokenLimit: 200000, messagesLength: 7 },
    },
    CONTEXT,
  );
  assert.equal(event.type, "runtime.context.updated");
  assert.equal(event.payload.threadId, "thread-1");
  assert.equal(event.payload.runtimeId, "copilot");
  assert.equal(event.payload.currentTokens, 12345);
  assert.equal(event.payload.contextWindow, 200000);
});

test("session.usage_info with invalid tokenLimit returns null", () => {
  const event = mapCopilotMessageToRuntimeEvent(
    {
      type: "session.usage_info",
      payload: { currentTokens: 100, tokenLimit: 0 },
    },
    CONTEXT,
  );
  assert.equal(event, null);
});
