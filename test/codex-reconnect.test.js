const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("codex adapter reinitializes when the websocket transport has dropped", async () => {
  const indexPath = path.resolve(__dirname, "../src/adapters/runtime/codex/index.js");
  const rpcClientPath = path.resolve(__dirname, "../src/adapters/runtime/codex/rpc-client.js");
  const mcpConfigPath = path.resolve(__dirname, "../src/adapters/runtime/codex/mcp-config.js");

  const originalIndex = require.cache[indexPath];
  const originalRpc = require.cache[rpcClientPath];
  const originalMcp = require.cache[mcpConfigPath];

  class MockCodexRpcClient {
    constructor() {
      this.isReady = false;
      this.transportReady = false;
      this.connectCalls = 0;
      this.initializeCalls = 0;
    }

    async connect() {
      this.connectCalls += 1;
      this.transportReady = true;
    }

    async initialize() {
      this.initializeCalls += 1;
      this.isReady = true;
    }

    isTransportReady() {
      return this.transportReady;
    }

    async listModels() {
      return { result: { data: [] } };
    }

    onMessage() {
      return () => {};
    }

    async close() {}
  }

  delete require.cache[indexPath];
  require.cache[rpcClientPath] = {
    id: rpcClientPath,
    filename: rpcClientPath,
    loaded: true,
    exports: {
      CodexRpcClient: MockCodexRpcClient,
    },
  };
  require.cache[mcpConfigPath] = {
    id: mcpConfigPath,
    filename: mcpConfigPath,
    loaded: true,
    exports: {
      resolveCodexProjectToolMcpServerConfig() {
        return null;
      },
    },
  };

  try {
    const { createCodexRuntimeAdapter } = require(indexPath);
    const adapter = createCodexRuntimeAdapter({
      sessionsFile: path.join(__dirname, "..", "tmp", "codex-reconnect-sessions.json"),
      codexEndpoint: "ws://127.0.0.1:8765",
      stateDir: path.join(__dirname, "..", "tmp"),
    });

    await adapter.initialize();
    const client = adapter.createClient();
    assert.equal(client.connectCalls, 1);
    assert.equal(client.initializeCalls, 1);

    client.transportReady = false;
    client.isReady = false;

    await adapter.initialize();
    assert.equal(client.connectCalls, 2);
    assert.equal(client.initializeCalls, 2);
  } finally {
    delete require.cache[indexPath];
    if (originalIndex) {
      require.cache[indexPath] = originalIndex;
    }
    if (originalRpc) {
      require.cache[rpcClientPath] = originalRpc;
    } else {
      delete require.cache[rpcClientPath];
    }
    if (originalMcp) {
      require.cache[mcpConfigPath] = originalMcp;
    } else {
      delete require.cache[mcpConfigPath];
    }
  }
});
