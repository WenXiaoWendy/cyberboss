const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const adapterModulePath = path.resolve(repoRoot, "src/adapters/channel/weixin/index.js");

function resolveRepoModule(relativePath) {
  return require.resolve(path.resolve(repoRoot, relativePath));
}

function stubModule(relativePath, exports, originals) {
  const resolved = resolveRepoModule(relativePath);
  originals.set(resolved, require.cache[resolved]);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

function restoreModules(originals) {
  for (const [resolved, original] of originals.entries()) {
    if (original) {
      require.cache[resolved] = original;
    } else {
      delete require.cache[resolved];
    }
  }
}

test("v2 weixin adapter keeps media sends on the legacy stack", async () => {
  const originals = new Map();
  let capturedArgs = null;

  try {
    stubModule("src/adapters/channel/weixin/account-store.js", {
      listWeixinAccounts() {
        return [];
      },
      resolveSelectedAccount() {
        return {
          accountId: "acct-1",
          baseUrl: "http://wx.example.test",
          token: "token-1",
          routeTag: "route-1",
        };
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/context-token-store.js", {
      loadPersistedContextTokens() {
        return {};
      },
      persistContextToken(_config, _accountId, userId, contextToken) {
        return { [userId]: contextToken };
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/login-v2.js", {
      async runV2LoginFlow() {},
    }, originals);
    stubModule("src/adapters/channel/weixin/api-v2.js", {
      async getConfigV2() {
        return null;
      },
      async getUpdatesV2() {
        return { msgs: [], get_updates_buf: "" };
      },
      async sendTextV2() {},
      async sendTypingV2() {},
    }, originals);
    stubModule("src/adapters/channel/weixin/legacy.js", {
      createLegacyWeixinChannelAdapter() {
        throw new Error("legacy adapter should not be constructed in this test");
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/message-utils-v2.js", {
      createInboundFilter() {
        return {
          normalize(message) {
            return message;
          },
        };
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/media-send.js", {
      async sendWeixinMediaFile(args) {
        capturedArgs = args;
        return { kind: "file", fileName: "timeline.png" };
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/sync-buffer-store.js", {
      loadSyncBuffer() {
        return "";
      },
      saveSyncBuffer() {},
    }, originals);

    originals.set(adapterModulePath, require.cache[adapterModulePath]);
    delete require.cache[adapterModulePath];
    const { createWeixinChannelAdapter } = require(adapterModulePath);

    const adapter = createWeixinChannelAdapter({
      weixinAdapterVariant: "v2",
      weixinCdnBaseUrl: "http://cdn.example.test",
      weixinProtocolClientVersion: "9.9.9",
    });

    const result = await adapter.sendFile({
      userId: "user-1",
      filePath: "C:\\temp\\timeline.png",
      contextToken: "ctx-1",
    });

    assert.equal(result.kind, "file");
    assert.deepEqual(capturedArgs, {
      filePath: "C:\\temp\\timeline.png",
      to: "user-1",
      contextToken: "ctx-1",
      baseUrl: "http://wx.example.test",
      token: "token-1",
      cdnBaseUrl: "http://cdn.example.test",
      apiVariant: "legacy",
      routeTag: "route-1",
      clientVersion: "9.9.9",
    });
  } finally {
    delete require.cache[adapterModulePath];
    restoreModules(originals);
  }
});
