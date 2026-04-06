const os = require("os");
const path = require("path");

function readConfig() {
  const mode = process.argv[2] || "";
  const stateDir = process.env.CYBERBOSS_STATE_DIR || path.join(os.homedir(), ".cyberboss");

  return {
    mode,
    stateDir,
    workspaceId: readTextEnv("CYBERBOSS_WORKSPACE_ID") || "default",
    workspaceRoot: readTextEnv("CYBERBOSS_WORKSPACE_ROOT") || process.cwd(),
    channel: readTextEnv("CYBERBOSS_CHANNEL") || "weixin",
    runtime: readTextEnv("CYBERBOSS_RUNTIME") || "codex",
    timelineCommand: readTextEnv("CYBERBOSS_TIMELINE_COMMAND") || "timeline-for-agent",
    accountId: readTextEnv("CYBERBOSS_ACCOUNT_ID"),
    weixinBaseUrl: readTextEnv("CYBERBOSS_WEIXIN_BASE_URL") || "https://ilinkai.weixin.qq.com",
    weixinCdnBaseUrl: readTextEnv("CYBERBOSS_WEIXIN_CDN_BASE_URL") || "https://novac2c.cdn.weixin.qq.com/c2c",
    weixinQrBotType: readTextEnv("CYBERBOSS_WEIXIN_QR_BOT_TYPE") || "3",
    accountsDir: path.join(stateDir, "accounts"),
    syncBufferDir: path.join(stateDir, "sync-buffers"),
    codexEndpoint: readTextEnv("CYBERBOSS_CODEX_ENDPOINT"),
    codexCommand: readTextEnv("CYBERBOSS_CODEX_COMMAND"),
    sessionsFile: path.join(stateDir, "sessions.json"),
  };
}

function readTextEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { readConfig };
