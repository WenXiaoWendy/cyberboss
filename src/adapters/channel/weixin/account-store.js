const fs = require("fs");
const path = require("path");
const { normalizeRouteTag } = require("./protocol");

function normalizeAccountId(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureAccountsDir(config) {
  fs.mkdirSync(config.accountsDir, { recursive: true });
}

function resolveAccountPath(config, accountId) {
  return path.join(config.accountsDir, `${normalizeAccountId(accountId)}.json`);
}

function deleteWeixinAccount(config, accountId) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) {
    return false;
  }
  try {
    const filePath = resolveAccountPath(config, normalized);
    if (!fs.existsSync(filePath)) {
      return false;
    }
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function saveWeixinAccount(config, rawAccountId, update) {
  ensureAccountsDir(config);
  const accountId = normalizeAccountId(rawAccountId);
  const filePath = resolveAccountPath(config, accountId);
  const existing = loadWeixinAccount(config, accountId) || {};
  const hasRouteTag = Object.prototype.hasOwnProperty.call(update || {}, "routeTag");
  const next = {
    accountId,
    rawAccountId: String(rawAccountId || "").trim() || existing.rawAccountId || "",
    token: typeof update.token === "string" && update.token.trim() ? update.token.trim() : existing.token || "",
    baseUrl: typeof update.baseUrl === "string" && update.baseUrl.trim() ? update.baseUrl.trim() : existing.baseUrl || config.weixinBaseUrl,
    userId: typeof update.userId === "string" ? update.userId.trim() : existing.userId || "",
    routeTag: hasRouteTag
      ? normalizeRouteTag(update.routeTag)
      : normalizeRouteTag(existing.routeTag || config.weixinRouteTag),
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best effort
  }
  return next;
}

function loadWeixinAccount(config, accountId) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) {
    return null;
  }
  try {
    const raw = fs.readFileSync(resolveAccountPath(config, normalized), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      accountId: normalized,
      rawAccountId: typeof parsed.rawAccountId === "string" ? parsed.rawAccountId : "",
      token: typeof parsed.token === "string" ? parsed.token : "",
      baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : config.weixinBaseUrl,
      userId: typeof parsed.userId === "string" ? parsed.userId : "",
      routeTag: Object.prototype.hasOwnProperty.call(parsed, "routeTag")
        ? normalizeRouteTag(parsed.routeTag)
        : normalizeRouteTag(config.weixinRouteTag),
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    return null;
  }
}

function listWeixinAccounts(config) {
  ensureAccountsDir(config);
  const files = fs.readdirSync(config.accountsDir, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".context-tokens.json"))
    .map((entry) => loadWeixinAccount(config, entry.name.slice(0, -5)))
    .filter(Boolean)
    .sort((left, right) => String(right.savedAt || "").localeCompare(String(left.savedAt || "")));
}

function resolveSelectedAccount(config) {
  if (config.accountId) {
    const account = loadWeixinAccount(config, config.accountId);
    if (!account) {
      throw new Error(`未找到微信账号: ${config.accountId}`);
    }
    if (!account.token) {
      throw new Error(`微信账号缺少 token: ${account.accountId}，请重新执行 login`);
    }
    return account;
  }
  const accounts = listWeixinAccounts(config);
  if (!accounts.length) {
    throw new Error("当前没有已保存的微信账号，请先执行 `npm run login`");
  }
  if (accounts.length > 1) {
    const accountIds = accounts.map((account) => account.accountId).join(", ");
    throw new Error(`检测到多个微信账号，请设置 CYBERBOSS_ACCOUNT_ID。可选值: ${accountIds}`);
  }
  if (!accounts[0].token) {
    throw new Error(`微信账号缺少 token: ${accounts[0].accountId}，请重新执行 login`);
  }
  return accounts[0];
}

module.exports = {
  deleteWeixinAccount,
  listWeixinAccounts,
  loadWeixinAccount,
  normalizeAccountId,
  resolveAccountPath,
  resolveSelectedAccount,
  saveWeixinAccount,
};
