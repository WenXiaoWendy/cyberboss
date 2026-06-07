const fs = require("fs");
const path = require("path");
const os = require("os");

const MAX_ENTRIES = 6;
const STATE_FILE = path.join(os.homedir(), ".cyberboss", "recent-context.txt");

function saveTurnContext(userText) {
  try {
    const dir = path.dirname(STATE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    let lines = [];
    try {
      lines = fs.readFileSync(STATE_FILE, "utf8").split("\n").filter(Boolean);
    } catch {}
    const summary = String(userText || "").trim().slice(0, 200);
    if (summary) {
      lines.push(`[${formatLocalTime()}] uu: ${summary}`);
    }
    if (lines.length > MAX_ENTRIES) {
      lines = lines.slice(-MAX_ENTRIES);
    }
    fs.writeFileSync(STATE_FILE, lines.join("\n") + "\n", "utf8");
  } catch {
    // best-effort
  }
}

function saveAssistantContext(text) {
  try {
    const dir = path.dirname(STATE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    let lines = [];
    try {
      lines = fs.readFileSync(STATE_FILE, "utf8").split("\n").filter(Boolean);
    } catch {}
    const summary = String(text || "").trim().slice(0, 160);
    if (summary) {
      lines.push(`[${formatLocalTime()}] assistant: ${summary}`);
    }
    if (lines.length > MAX_ENTRIES) {
      lines = lines.slice(-MAX_ENTRIES);
    }
    fs.writeFileSync(STATE_FILE, lines.join("\n") + "\n", "utf8");
  } catch {
    // best-effort
  }
}

function formatLocalTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date()).replace(/\//g, "-");
}

function loadTurnContext() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8").trim();
    if (!raw) return "";
    return `RECENT TURN CONTEXT (last ${MAX_ENTRIES} entries from previous session):\n${raw}`;
  } catch {
    return "";
  }
}

module.exports = { saveTurnContext, saveAssistantContext, loadTurnContext };
