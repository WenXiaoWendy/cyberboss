const path = require("path");
const { applyCyberbossEnv } = require("../src/core/env-loader");
const {
  assertSafeBetaStartAllowed,
  isSafeBetaEnabled,
} = require("../src/core/safe-beta");
const {
  buildCodexMcpConfigArgs,
  resolveSafeBetaMemoryMcpServerConfig,
} = require("../src/adapters/runtime/codex/mcp-config");
const { buildTurnStartParams } = require("../src/adapters/runtime/codex/rpc-client");

function buildSafeBetaDryRunReport(env = process.env) {
  const safeBeta = isSafeBetaEnabled(env.CYBERBOSS_SAFE_BETA);
  if (!safeBeta) {
    throw new Error("Safe Beta dry-run refused: CYBERBOSS_SAFE_BETA must be true.");
  }
  const allowedUserIds = String(env.CYBERBOSS_ALLOWED_USER_IDS || "").split(",");
  assertSafeBetaStartAllowed({ safeBeta, mode: "start", allowedUserIds });
  const mcp = resolveSafeBetaMemoryMcpServerConfig({
    pythonPath: env.CYBERBOSS_MEMORY_PYTHON,
    memoryAgentRoot: env.CYBERBOSS_MEMORY_AGENT_ROOT,
    databasePath: env.CYBERBOSS_MEMORY_SQLITE,
    baseEnv: env,
  });
  const turn = buildTurnStartParams({
    threadId: "dry-run",
    input: [{ type: "text", text: "dry-run" }],
    workspaceRoot: process.cwd(),
    accessMode: "full-access",
    safeBeta: true,
  });
  const configArgs = buildCodexMcpConfigArgs(mcp);
  return {
    dryRun: true,
    processesStarted: [],
    networkConnectionsOpened: [],
    safeBeta: true,
    allowlist: {
      configured: allowedUserIds.map((value) => value.trim()).filter(Boolean).length > 0,
      identitiesDisclosed: false,
    },
    state: {
      custom: Boolean(env.CYBERBOSS_STATE_DIR),
      bootstrapRoot: env.CYBERBOSS_STATE_DIR ? path.basename(env.CYBERBOSS_STATE_DIR) : "",
    },
    codex: {
      approvalPolicy: turn.approvalPolicy,
      sandboxPolicy: turn.sandboxPolicy,
      networkAccess: false,
    },
    mcp: {
      servers: [mcp.name],
      required: mcp.required,
      enabledTools: mcp.enabledTools,
      ferryApprovalMode: mcp.approvalModeByTool.ferry,
      projectToolsConfigured: configArgs.some((value) => String(value).includes("cyberboss_tools")),
      handoffConfigured: configArgs.some((value) => String(value).includes("handoff")),
      childEnvNames: Object.keys(mcp.env).sort(),
    },
    activeCapabilities: {
      checkin: false,
      randomWake: false,
      location: false,
      systemSend: false,
      reminder: false,
      diary: false,
      timeline: false,
      fileSend: false,
      sticker: false,
      whereabouts: false,
    },
  };
}

function main() {
  applyCyberbossEnv();
  console.log(JSON.stringify(buildSafeBetaDryRunReport(), null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[cyberboss] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

module.exports = { buildSafeBetaDryRunReport };
