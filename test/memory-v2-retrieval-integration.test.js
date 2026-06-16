const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const originalLoad = Module._load;
Module._load = function loadWithOptionalStubs(request, parent, isMain) {
  if (request === "whereabouts-mcp") {
    return {
      WhereaboutsToolHost: class {
        listTools() {
          return [];
        }

        async invokeTool() {
          throw new Error("whereabouts-mcp is stubbed in this test");
        }
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { CyberbossApp } = require("../src/core/app");
const { MemoryV2Retrieval } = require("../src/memory-v2/retrieval");

function createRetrievalFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-v2-retrieval-"));
  const dbPath = path.join(root, "memory-v2.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE memory_index (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      heat REAL NOT NULL,
      pinned INTEGER NOT NULL,
      source_timestamp TEXT NOT NULL,
      source_role TEXT NOT NULL
    );
  `);
  const insert = db.prepare(`
    INSERT INTO memory_index (
      id, status, memory_type, title, content, heat, pinned,
      source_timestamp, source_role
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    "mem_active",
    "active",
    "conversation",
    "Tea preference",
    "The user likes jasmine tea and prefers short direct answers.",
    0.7,
    0,
    "2026-01-01T00:00:00.000Z",
    "user",
  );
  insert.run(
    "mem_invalid",
    "invalid",
    "conversation",
    "Invalid tea",
    "The user likes jasmine tea but this record is invalid.",
    3,
    1,
    "2026-01-02T00:00:00.000Z",
    "user",
  );
  insert.run(
    "mem_pending",
    "pending",
    "conversation",
    "Pending tea",
    "The user likes jasmine tea but this record is pending.",
    3,
    1,
    "2026-01-03T00:00:00.000Z",
    "user",
  );
  db.close();
  return { root, dbPath };
}

test("memory-v2 retrieval injects only active short summaries", () => {
  const fixture = createRetrievalFixture();
  const retrieval = new MemoryV2Retrieval({ dbPath: fixture.dbPath });

  const result = retrieval.retrieve("jasmine tea", { limit: 5 });

  assert.deepEqual(result.entries.map((entry) => entry.id), ["mem_active"]);
  assert.equal(Object.hasOwn(result.entries[0], "content"), false);
  assert.match(result.prompt, /MEMORY V2 RECALL CONTEXT/);
  assert.match(result.prompt, /Tea preference/);
  assert.doesNotMatch(result.prompt, /Invalid tea/);
  assert.doesNotMatch(result.prompt, /Pending tea/);
});

test("memory-v2 recall context is default-off", () => {
  const retrieval = {
    retrieve() {
      return {
        entries: [{ id: "mem_1" }],
        prompt: "MEMORY V2 RECALL CONTEXT\n- [mem_1] short summary",
      };
    },
  };
  const disabled = CyberbossApp.prototype.applyMemoryV2RecallContext.call({
    config: { memoryV2RecallEnabled: false },
    memoryV2Retrieval: retrieval,
  }, "hello", { originalText: "hello" });
  const enabled = CyberbossApp.prototype.applyMemoryV2RecallContext.call({
    config: { memoryV2RecallEnabled: true, memoryV2RecallLimit: 5 },
    memoryV2Retrieval: retrieval,
  }, "hello", { originalText: "hello" });

  assert.deepEqual(disabled, { text: "hello", memoryV2RecallCandidates: [] });
  assert.match(enabled.text, /MEMORY V2 RECALL CONTEXT/);
  assert.match(enabled.text, /CURRENT WECHAT INPUT\nhello/);
  assert.deepEqual(enabled.memoryV2RecallCandidates, [{ id: "mem_1" }]);
});

test("memory-v2 recall writes only after a completed turn and uses idempotent keys", async () => {
  const recalls = [];
  const appLike = {
    config: { memoryV2RecallWriteEnabled: true },
    memoryV2RecallByRunKey: new Map(),
    runtimeAdapter: {
      describe() {
        return { id: "claudecode" };
      },
    },
    getMemoryV2RecallWriter() {
      return {
        recall(payload) {
          recalls.push(payload);
        },
      };
    },
  };

  CyberbossApp.prototype.rememberMemoryV2RecallCandidates.call(appLike, {
    threadId: "thread-1",
    turnId: "turn-1",
  }, [{ id: "mem_1" }, { id: "mem_1" }, { id: "mem_2" }]);
  await CyberbossApp.prototype.recordMemoryV2RecallTurn.call(appLike, {
    threadId: "thread-1",
    turnId: "turn-1",
  });

  assert.deepEqual(recalls.map((item) => item.eventId), [
    "thread-1:turn-1:mem_1",
    "thread-1:turn-1:mem_2",
  ]);
  assert.deepEqual(recalls.map((item) => item.id), ["mem_1", "mem_2"]);
  assert.equal(recalls[0].consumer, "claudecode");
  assert.equal(recalls[0].purpose, "response_context");
});

test("memory-v2 recall writer flag stays separately default-off", async () => {
  const pending = new Map([["thread-1:turn-1", ["mem_1"]]]);
  const result = await CyberbossApp.prototype.recordMemoryV2RecallTurn.call({
    config: { memoryV2RecallWriteEnabled: false },
    memoryV2RecallByRunKey: pending,
    getMemoryV2RecallWriter() {
      throw new Error("writer should not be created");
    },
  }, {
    threadId: "thread-1",
    turnId: "turn-1",
  });

  assert.deepEqual(result, { skipped: true, reason: "disabled" });
  assert.equal(pending.size, 0);
});
