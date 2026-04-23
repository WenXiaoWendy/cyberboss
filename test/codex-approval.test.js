const test = require("node:test");
const assert = require("node:assert/strict");

const { CyberbossApp } = require("../src/core/app");
const { mapCodexMessageToRuntimeEvent } = require("../src/adapters/runtime/codex/events");
const { buildCodexMcpConfigArgs } = require("../src/adapters/runtime/codex/mcp-config");

test("codex MCP config auto-approves cyberboss tools", () => {
  const args = buildCodexMcpConfigArgs({
    name: "cyberboss_tools",
    command: "/usr/bin/node",
    args: ["/workspace/bin/cyberboss.js", "tool-mcp-server"],
  });

  assert.deepEqual(args.slice(0, 4), [
    "-c",
    "mcp_servers.cyberboss_tools.command=\"/usr/bin/node\"",
    "-c",
    "mcp_servers.cyberboss_tools.args=[\"/workspace/bin/cyberboss.js\",\"tool-mcp-server\"]",
  ]);
  assert.match(
    args.join("\n"),
    /mcp_servers\.cyberboss_tools\.tools\.cyberboss_channel_send_file\.approval_mode="auto"/
  );
  assert.match(
    args.join("\n"),
    /mcp_servers\.cyberboss_tools\.tools\.cyberboss_reminder_create\.approval_mode="auto"/
  );
  assert.match(
    args.join("\n"),
    /mcp_servers\.cyberboss_tools\.tools\.cyberboss_timeline_screenshot\.approval_mode="auto"/
  );
  assert.match(
    args.join("\n"),
    /mcp_servers\.cyberboss_tools\.tools\.whereabouts_snapshot\.approval_mode="auto"/
  );
});

test("codex MCP elicitation approvals map to runtime approval events", () => {
  const event = mapCodexMessageToRuntimeEvent({
    id: "req-mcp-1",
    method: "mcpServer/elicitation/request",
    params: {
      serverName: "cyberboss_tools",
      threadId: "thread-1",
      turnId: "turn-1",
      mode: "form",
      _meta: {
        codex_approval_kind: "mcp_tool_call",
        persist: ["session", "always"],
        tool_description: "Create a reminder in Cyberboss. Input: { text: string, delayMinutes?: integer }",
        tool_params_display: [
          { name: "delayMinutes", display_name: "delayMinutes", value: 5 },
          { name: "text", display_name: "text", value: "hello" },
        ],
      },
      message: "Allow the cyberboss_tools MCP server to run tool \"cyberboss_reminder_create\"?",
      requestedSchema: {
        type: "object",
        properties: {},
      },
    },
  });

  assert.equal(event.type, "runtime.approval.requested");
  assert.equal(event.payload.kind, "mcp_tool_call");
  assert.equal(event.payload.threadId, "thread-1");
  assert.deepEqual(event.payload.commandTokens, ["mcp_tool", "cyberboss_tools", "cyberboss_reminder_create"]);
  assert.equal(event.payload.command, "cyberboss_reminder_create\ndelayMinutes: 5\ntext: hello");
  assert.deepEqual(event.payload.responseTemplate.supportedCommands, ["yes", "no"]);
  assert.deepEqual(event.payload.responseTemplate.responseByCommand.yes, {
    action: "accept",
  });
  assert.equal(event.payload.elicitation.approvalKind, "mcp_tool_call");
  assert.deepEqual(event.payload.elicitation.persistScopes, ["session", "always"]);
  assert.deepEqual(event.payload.elicitation.toolParamsDisplay, [
    { name: "delayMinutes", displayName: "delayMinutes", value: 5 },
    { name: "text", displayName: "text", value: "hello" },
  ]);
  assert.deepEqual(event.payload.responseTemplate.responseByCommand.no, {
    action: "cancel",
  });
});

test("handleRuntimeEvent auto-approves project-native Codex MCP elicitation approvals", async () => {
  const responses = [];
  const appLike = {
    config: { stateDir: "/tmp/cyberboss-test-state" },
    streamDelivery: {
      async handleRuntimeEvent() {},
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          clearApprovalPrompt() {},
          findBindingForThreadId() {
            return { bindingKey: "binding-1", workspaceRoot: "/workspace" };
          },
          getApprovalPromptState() {
            return null;
          },
          rememberApprovalPrompt() {},
          getApprovalCommandAllowlistForWorkspace() {
            return [];
          },
        };
      },
      async respondApproval(payload) {
        responses.push(payload);
      },
    },
    threadStateStore: {
      resolveApproval() {},
    },
    async sendApprovalPrompt() {
      throw new Error("should not prompt for project-native Codex MCP tools");
    },
  };

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      kind: "mcp_elicitation",
      elicitation: {
        approvalKind: "mcp_tool_call",
      },
      threadId: "thread-1",
      requestId: "req-project-tool",
      commandTokens: ["mcp_tool", "cyberboss_tools", "cyberboss_reminder_create"],
      responseTemplate: {
        responseByCommand: {
          yes: {
            action: "accept",
          },
        },
      },
    },
  });

  assert.deepEqual(responses, [{
    requestId: "req-project-tool",
    result: {
      action: "accept",
    },
  }]);
});

test("handleApprovalCommand sends MCP elicitation responses back through the runtime", async () => {
  const responses = [];
  const sent = [];
  const approval = {
    kind: "mcp_tool_call",
    requestId: "req-ext-mcp",
    commandTokens: ["mcp_tool", "notes_server", "note_create"],
    responseTemplate: {
      supportedCommands: ["yes", "no"],
      responseByCommand: {
        yes: {
          action: "accept",
        },
        no: {
          action: "cancel",
        },
      },
    },
  };

  const appLike = {
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    runtimeAdapter: {
      async respondApproval(payload) {
        responses.push(payload);
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "thread-1";
          },
          clearApprovalPrompt() {},
          rememberApprovalPrefixForWorkspace() {
            throw new Error("should not remember allowlists for MCP elicitation responses");
          },
        };
      },
    },
    threadStateStore: {
      getThreadState() {
        return { pendingApproval: approval };
      },
      resolveApproval() {},
    },
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
  };

  await CyberbossApp.prototype.handleApprovalCommand.call(
    appLike,
    { workspaceId: "workspace-id", accountId: "account-id", senderId: "user-1", contextToken: "ctx-1" },
    { name: "yes" },
  );

  assert.deepEqual(responses, [{
    requestId: "req-ext-mcp",
    result: {
      action: "accept",
    },
  }]);
  assert.deepEqual(sent, ["✅ This request has been approved."]);
});

test("handleApprovalCommand does not pretend to support persistent Codex MCP tool approval from WeChat", async () => {
  const responses = [];
  const sent = [];
  const approval = {
    kind: "mcp_tool_call",
    requestId: "req-ext-mcp",
    commandTokens: ["mcp_tool", "notes_server", "note_create"],
    responseTemplate: {
      supportedCommands: ["yes", "no"],
      responseByCommand: {
        yes: {
          action: "accept",
        },
        no: {
          action: "cancel",
        },
      },
    },
  };

  const appLike = {
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    runtimeAdapter: {
      async respondApproval(payload) {
        responses.push(payload);
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "thread-1";
          },
          clearApprovalPrompt() {},
        };
      },
    },
    threadStateStore: {
      getThreadState() {
        return { pendingApproval: approval };
      },
      resolveApproval() {},
    },
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
  };

  await CyberbossApp.prototype.handleApprovalCommand.call(
    appLike,
    { workspaceId: "workspace-id", accountId: "account-id", senderId: "user-1", contextToken: "ctx-1" },
    { name: "always" },
  );

  assert.deepEqual(responses, []);
  assert.deepEqual(sent, ["⚠️ Persistent approval for this Codex MCP tool request is not available from WeChat."]);
});
