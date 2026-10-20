const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { readConfig } = require("../src/core/config");
const { createProjectTooling } = require("../src/tools/create-project-tooling");
const { listProjectToolNames } = require("../src/tools/tool-host");
const { SEARCH_MCP_URL, SEARCH_USER_AGENT } = require("../src/services/web-search-service");
const { CyberbossApp } = require("../src/core/app");
const { mapCodexMessageToRuntimeEvent } = require("../src/adapters/runtime/codex/events");
const { mapClaudeCodeMessageToRuntimeEvent } = require("../src/adapters/runtime/claudecode/events");

// Simulates the wire protocol, not the SDK: production initialization, discovery,
// tool execution and response validation all run against these HTTP responses.
function createMcpFetch({ calls = [], mode = "success", onAbort = () => {} } = {}) {
  return async (url, init = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers));
    const message = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), headers, message });
    if (init.method === "GET") return new Response(null, { status: 405 });
    if (!message || message.id === undefined) return new Response(null, { status: 202 });
    if (mode === "connect_hang" || (message.method === "tools/call" && mode === "hang")) {
      return new Promise((resolve, reject) => {
        const abort = () => { onAbort(); reject(init.signal.reason); };
        if (init.signal.aborted) abort();
        else init.signal.addEventListener("abort", abort, { once: true });
      });
    }
    if (message.method === "tools/call" && mode === "http_error") {
      return new Response("Service unavailable", { status: 503 });
    }
    const tools = ["web_search", "web_fetch"].map((name) => ({ name, inputSchema: { type: "object" } }));
    const result = message.method === "initialize"
      ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
      : message.method === "tools/list" ? { tools }
      : { content: [{ type: "text", text: mode === "tool_error" ? "Search quota exceeded" : `Useful ${message.params.name} result: https://example.com/source` }], ...(mode === "tool_error" ? { isError: true } : {}) };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), { headers: { "Content-Type": "application/json" } });
  };
}

function tooling(t, webSearchOptions = {}, provider) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-search-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = { ...readConfig(), stateDir: root, sessionsFile: path.join(root, "sessions.json"),
    projectToolContextFile: path.join(root, "contexts.json"), ...(provider === undefined ? {} : { webSearchProvider: provider }) };
  return createProjectTooling(config, { channelAdapter: {}, timelineIntegration: {}, webSearchOptions });
}
const searchArgs = { objective: "Find the current Node.js release", search_queries: ["Node.js latest release version"] };

test("fresh configuration dispatches anonymous search and fetch through the project tool host", async (t) => {
  const saved = process.env.CYBERBOSS_WEB_SEARCH_PROVIDER;
  delete process.env.CYBERBOSS_WEB_SEARCH_PROVIDER;
  t.after(() => { if (saved === undefined) delete process.env.CYBERBOSS_WEB_SEARCH_PROVIDER; else process.env.CYBERBOSS_WEB_SEARCH_PROVIDER = saved; });
  const calls = [];
  const { toolHost } = tooling(t, { fetchImpl: createMcpFetch({ calls }) });
  assert.ok(toolHost.listTools().some((tool) => tool.name === "cyberboss_web_search"));
  assert.match((await toolHost.invokeTool("cyberboss_web_search", searchArgs)).text, /Useful web_search result: https:\/\/example.com\/source/);
  const fetchArgs = { urls: ["https://example.com/source"], search_queries: searchArgs.search_queries };
  assert.match((await toolHost.invokeTool("cyberboss_web_fetch", fetchArgs)).text, /Useful web_fetch/);
  for (const call of calls) {
    assert.equal(call.url, SEARCH_MCP_URL);
    assert.equal(call.headers["user-agent"], SEARCH_USER_AGENT);
    assert.equal(call.headers.authorization, undefined);
  }
  const requests = calls.filter((call) => call.message?.method === "tools/call");
  assert.deepEqual(requests.map((call) => call.message.params.arguments), [searchArgs, fetchArgs]);
  assert.equal(calls.filter((call) => call.message?.method === "tools/list").length, 2);
  // Discovery/execution do not infer conversation identity from mutable active
  // workspace context, saved credentials, model arguments, or a shared client.
  assert.ok(requests.every((call) => !("session_id" in call.message.params.arguments)));
  assert.ok(!listProjectToolNames().includes("cyberboss_web_search"));
  assert.ok(!listProjectToolNames().includes("cyberboss_web_fetch"));
});

for (const provider of ["runtime", "disabled"]) {
  test(`${provider} choice removes web tools and prevents outbound requests`, async (t) => {
    let requested = false;
    const { toolHost } = tooling(t, { fetchImpl: async () => { requested = true; throw new Error("unexpected network"); } }, provider);
    assert.ok(!toolHost.listTools().some((tool) => tool.name.startsWith("cyberboss_web_")));
    await assert.rejects(toolHost.invokeTool("cyberboss_web_search", searchArgs), /Unknown tool/);
    assert.equal(requested, false);
  });
}

test("invalid explicit provider fails without falling back to Parallel", (t) => {
  assert.throws(() => tooling(t, {}, "custom"), /must be parallel, runtime, or disabled/);
});

test("invalid URLs and arguments are rejected before any request", async (t) => {
  let requested = false;
  const { toolHost } = tooling(t, { fetchImpl: async () => { requested = true; } }, "parallel");
  for (const urls of [["file:///etc/passwd"], ["ftp://example.com"], ["https://user:pass@example.com"], ["not a URL"], [], Array(21).fill("https://example.com")]) {
    await assert.rejects(toolHost.invokeTool("cyberboss_web_fetch", { urls }));
  }
  await assert.rejects(toolHost.invokeTool("cyberboss_web_search", { ...searchArgs, search_queries: [] }));
  await assert.rejects(toolHost.invokeTool("cyberboss_web_search", { ...searchArgs, session_id: "untrusted" }));
  await assert.rejects(toolHost.invokeTool("cyberboss_web_fetch", { urls: ["https://example.com"], full_content: "yes" }));
  assert.equal(requested, false);
});

for (const mode of ["tool_error", "http_error"]) {
  test(`${mode} propagates through the dispatcher without provider fallback`, async (t) => {
    const calls = [];
    const { toolHost } = tooling(t, { fetchImpl: createMcpFetch({ calls, mode }) }, "parallel");
    await assert.rejects(toolHost.invokeTool("cyberboss_web_search", searchArgs), mode === "tool_error" ? /quota exceeded/ : /503|Service unavailable/);
    assert.equal(calls.filter((call) => call.message?.method === "tools/call").length, 1);
  });
}

for (const mode of ["connect_hang", "hang"]) {
  test(`${mode} is bounded by a whole-operation timeout`, async (t) => {
    let aborted = false;
    const { toolHost } = tooling(t, { fetchImpl: createMcpFetch({ mode, onAbort: () => { aborted = true; } }), timeoutMs: 50 }, "parallel");
    // AbortSignal.timeout is unref'd; keep the mock process alive like a socket.
    const keepAlive = setInterval(() => {}, 1000);
    try { await assert.rejects(toolHost.invokeTool("cyberboss_web_search", searchArgs), /timeout|timed out/i); }
    finally { clearInterval(keepAlive); }
    assert.equal(aborted, true);
  });
}

test("caller cancellation aborts an in-flight search", async (t) => {
  let aborted = false;
  const controller = new AbortController();
  const { toolHost } = tooling(t, { fetchImpl: createMcpFetch({ mode: "hang", onAbort: () => { aborted = true; } }) }, "parallel");
  const pending = toolHost.invokeTool("cyberboss_web_search", searchArgs, { signal: controller.signal });
  setTimeout(() => controller.abort(new Error("Stopped by caller")), 20);
  await assert.rejects(pending, /Stopped by caller/);
  assert.equal(aborted, true);
});

for (const runtime of ["codex", "claudecode"]) {
  test(`${runtime} web-tool approvals prompt unless explicitly allowlisted`, async () => {
    for (const allowed of [false, true]) {
      const prompts = [];
      const responses = [];
      const store = {
        findBindingForThreadId: () => ({ bindingKey: "binding", workspaceRoot: "/workspace" }),
        getApprovalCommandAllowlistForWorkspace: () => allowed ? [["mcp_tool", "cyberboss_tools", "cyberboss_web_search"]] : [],
        getApprovalPromptState: () => null,
        rememberApprovalPrompt() {}, clearApprovalPrompt() {},
      };
      const app = { config: {}, streamDelivery: { async handleRuntimeEvent() {} }, threadStateStore: { resolveApproval() {} },
        runtimeAdapter: { getSessionStore: () => store, async respondApproval(response) { responses.push(response); } },
        async sendApprovalPrompt(prompt) { prompts.push(prompt); } };
      const event = runtime === "claudecode"
        ? mapClaudeCodeMessageToRuntimeEvent({ type: "approval.requested", threadId: "thread", requestId: "request", toolName: "mcp__cyberboss_tools__cyberboss_web_search", input: searchArgs })
        : mapCodexMessageToRuntimeEvent({ id: "request", method: "mcpServer/elicitation/request", params: { threadId: "thread", serverName: "cyberboss_tools", message: 'Allow the cyberboss_tools MCP server to run tool "cyberboss_web_search"?', _meta: { codex_approval_kind: "mcp_tool_call", codex_tool_name: "cyberboss_web_search" }, requestedSchema: { type: "object", properties: { approve: { type: "boolean" } }, required: ["approve"] } } });
      assert.ok(event);
      await CyberbossApp.prototype.handleRuntimeEvent.call(app, event);
      assert.equal(prompts.length, allowed ? 0 : 1);
      assert.equal(responses.length, allowed ? 1 : 0);
    }
  });
}

test("stdio MCP caller consumes search output and receives remote errors", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-search-stdio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const preload = path.join(root, "fetch.cjs");
  fs.writeFileSync(preload, `globalThis.fetch = (${createMcpFetch.toString()})({mode: process.env.SEARCH_FIXTURE_MODE, onAbort: () => require("node:fs").writeFileSync(process.env.SEARCH_ABORT_MARKER, "aborted")});`);
  for (const mode of ["success", "tool_error", "hang"]) {
    const client = new Client({ name: "search-dispatch-test", version: "1" });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ["--require", preload, path.resolve(__dirname, "../bin/cyberboss.js"), "tool-mcp-server", "--runtime-id", "claudecode", "--workspace-root", root],
      cwd: root, stderr: "pipe", env: { HOME: root, PATH: process.env.PATH, CYBERBOSS_STATE_DIR: path.join(root, "state"), CYBERBOSS_WEB_SEARCH_PROVIDER: "parallel", SEARCH_FIXTURE_MODE: mode, SEARCH_ABORT_MARKER: path.join(root, "aborted") } });
    await client.connect(transport);
    try {
      assert.ok((await client.listTools()).tools.some((tool) => tool.name === "cyberboss_web_search"));
      if (mode === "hang") {
        const controller = new AbortController();
        const pending = client.callTool({ name: "cyberboss_web_search", arguments: searchArgs }, undefined, { signal: controller.signal });
        setTimeout(() => controller.abort(new Error("Stopped by MCP caller")), 50);
        await assert.rejects(pending, /Stopped by MCP caller/);
        // The same server remains responsive after cancellation.
        assert.ok((await client.listTools()).tools.length > 0);
        assert.equal(fs.readFileSync(path.join(root, "aborted"), "utf8"), "aborted");
      } else {
        const result = await client.callTool({ name: "cyberboss_web_search", arguments: searchArgs });
        assert.equal(Boolean(result.isError), mode === "tool_error");
        assert.match(result.content[0].text, mode === "success" ? /Useful web_search result: https:\/\/example.com\/source/ : /quota exceeded/);
        if (mode === "success") {
          const page = await client.callTool({ name: "cyberboss_web_fetch", arguments: { urls: ["https://example.com/source"] } });
          assert.match(page.content[0].text, /Useful web_fetch/);
        }
      }
    } finally { await client.close(); }
  }
});
