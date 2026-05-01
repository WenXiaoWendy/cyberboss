const fs = require("fs");
const path = require("path");
const { createCheck, createGroup } = require("../schema");
const { readJsonFile } = require("../file-utils");
const { redactId, redactPath } = require("../redact");
const { probeHttpUrl } = require("../network");

async function runWeixinChecks(context) {
  const config = context.config || {};
  const options = context.options || {};
  const accounts = listAccountFiles(config);
  const selectedAccountId = normalizeText(config.accountId);
  const selected = resolveSelectedAccount(accounts, selectedAccountId);
  const checks = [
    checkAccountsDir(config, options),
    checkAccounts(config, options, accounts, selectedAccountId, selected),
    checkSelectedToken(options, selected),
    checkContextTokens(config, options, selected),
    checkMediaContextTokens(config, options, selected),
    checkSyncBuffer(config, options, selected),
    checkUrl("weixin.base_url", "WeChat base URL", config.weixinBaseUrl),
    checkUrl("weixin.media.cdn_base_url", "WeChat CDN base URL", config.weixinCdnBaseUrl),
  ];
  if (options.network) {
    checks.push(
      await checkNetworkUrl(context, "network.weixin_base_url", "WeChat base URL reachability", config.weixinBaseUrl),
      await checkNetworkUrl(context, "network.weixin_cdn_base_url", "WeChat CDN base URL reachability", config.weixinCdnBaseUrl),
    );
  }

  return createGroup({ id: "weixin", title: "WeChat", checks });
}

function checkAccountsDir(config, options) {
  const exists = fs.existsSync(config.accountsDir || "");
  return createCheck({
    id: exists ? "weixin.accounts_dir.present" : "weixin.accounts_dir.missing",
    title: "WeChat accounts directory",
    status: exists ? "ok" : "warn",
    category: "account",
    evidence: { exists, accountsDir: redactPath(config.accountsDir, options) },
    recommendation: exists ? "" : "Run npm run login to save a WeChat account.",
  });
}

function checkAccounts(config, options, accounts, selectedAccountId, selected) {
  if (!accounts.length) {
    return createCheck({
      id: "weixin.accounts.none",
      title: "Saved WeChat accounts",
      status: "warn",
      category: "account",
      evidence: { savedAccountCount: 0 },
      recommendation: "Run npm run login to save a WeChat account.",
    });
  }
  if (selectedAccountId && !selected) {
    return createCheck({
      id: "weixin.accounts.selected_missing",
      title: "Selected WeChat account",
      status: "fail",
      category: "account",
      evidence: { selectedAccount: redactId(selectedAccountId, options), savedAccountCount: accounts.length },
      recommendation: "Set CYBERBOSS_ACCOUNT_ID to one saved account id.",
    });
  }
  if (!selectedAccountId && accounts.length > 1) {
    return createCheck({
      id: "weixin.accounts.multiple_without_selection",
      title: "Multiple WeChat accounts need explicit selection",
      status: "fail",
      category: "account",
      evidence: {
        savedAccountCount: accounts.length,
        accountIds: accounts.map((account) => redactId(account.accountId, options)),
      },
      recommendation: "Set CYBERBOSS_ACCOUNT_ID to one saved account id.",
      privacy: { redacted: true, unsafeFieldsAvailable: ["accountIds"] },
    });
  }
  return createCheck({
    id: "weixin.accounts.selection.ok",
    title: "Selected WeChat account",
    status: "ok",
    category: "account",
    evidence: { savedAccountCount: accounts.length, selectedAccount: selected ? redactId(selected.accountId, options) : "" },
  });
}

function checkSelectedToken(options, selected) {
  if (!selected) {
    return createCheck({ id: "weixin.accounts.selected_token.skipped", title: "Selected account token", status: "skip", category: "account" });
  }
  const hasToken = Boolean(normalizeText(selected.token));
  return createCheck({
    id: hasToken ? "weixin.accounts.selected_token.present" : "weixin.accounts.selected_token_missing",
    title: "Selected account token",
    status: hasToken ? "ok" : "fail",
    category: "account",
    evidence: { accountId: redactId(selected.accountId, options), hasToken },
    recommendation: hasToken ? "" : "Run npm run login again for the selected account.",
  });
}

function checkContextTokens(config, options, selected) {
  if (!selected) {
    return createCheck({ id: "weixin.context_tokens.skipped", title: "Context token store", status: "skip", category: "account" });
  }
  const filePath = path.join(config.accountsDir, `${selected.accountId}.context-tokens.json`);
  if (!fs.existsSync(filePath)) {
    return createCheck({
      id: "weixin.context_tokens.missing",
      title: "Context token store",
      status: "warn",
      category: "account",
      evidence: { exists: false },
      recommendation: "Let the target WeChat user send one message to refresh context_token.",
    });
  }
  const parsed = readJsonFile(filePath);
  if (!parsed.ok || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    return createCheck({
      id: "weixin.context_tokens.invalid_json",
      title: "Context token store",
      status: "fail",
      category: "state",
      evidence: { exists: true, ok: false, file: redactPath(filePath, options) },
      recommendation: "Remove or repair the corrupted context token file.",
    });
  }
  return createCheck({
    id: "weixin.context_tokens.valid",
    title: "Context token store",
    status: "ok",
    category: "account",
    evidence: { exists: true, userCount: Object.keys(parsed.data).length },
  });
}

function checkMediaContextTokens(config, options, selected) {
  if (!selected) {
    return createCheck({ id: "weixin.media.context_token.skipped", title: "Media context tokens", status: "skip", category: "account" });
  }
  const allowed = Array.isArray(config.allowedUserIds) ? config.allowedUserIds.filter(Boolean) : [];
  const filePath = path.join(config.accountsDir, `${selected.accountId}.context-tokens.json`);
  const parsed = readJsonFile(filePath);
  const tokens = parsed.ok && parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : {};
  const missing = allowed.filter((userId) => !normalizeText(tokens[userId]));
  return createCheck({
    id: missing.length ? "weixin.media.context_token.missing_for_allowed_user" : "weixin.media.context_token.available",
    title: "Media delivery context tokens",
    status: missing.length ? "warn" : "ok",
    category: "account",
    evidence: {
      allowedUserCount: allowed.length,
      missingCount: missing.length,
      missingUsers: missing.map((userId) => redactId(userId, options)),
    },
    recommendation: missing.length ? "Ask each target WeChat user to send one message before sending files or stickers." : "",
  });
}

function checkSyncBuffer(config, options, selected) {
  if (!selected) {
    return createCheck({ id: "weixin.sync_buffer.skipped", title: "Sync buffer", status: "skip", category: "state" });
  }
  const filePath = path.join(config.syncBufferDir || "", `${selected.accountId}.txt`);
  return createCheck({
    id: fs.existsSync(filePath) ? "weixin.sync_buffer.present" : "weixin.sync_buffer.missing",
    title: "Sync buffer",
    status: "ok",
    category: "state",
    evidence: { exists: fs.existsSync(filePath), file: redactPath(filePath, options) },
  });
}

function checkUrl(idBase, title, value) {
  try {
    const url = new URL(normalizeText(value));
    const ok = url.protocol === "http:" || url.protocol === "https:";
    return createCheck({
      id: ok ? `${idBase}.valid` : `${idBase}.invalid`,
      title,
      status: ok ? "ok" : "warn",
      category: "config",
      evidence: { protocol: url.protocol, host: url.host },
      recommendation: ok ? "" : "Use an http or https URL.",
    });
  } catch {
    return createCheck({
      id: `${idBase}.invalid`,
      title,
      status: "warn",
      category: "config",
      evidence: { valid: false },
      recommendation: "Set a valid URL.",
    });
  }
}

async function checkNetworkUrl(context, idBase, title, value) {
  const normalized = normalizeText(value);
  let endpoint = null;
  try {
    endpoint = new URL(normalized);
  } catch {
    return createCheck({
      id: `${idBase}.invalid_url`,
      title,
      status: "warn",
      category: "network",
      evidence: { valid: false },
      recommendation: "Set a valid http or https endpoint before running network diagnostics.",
    });
  }
  const probe = context.networkProbe || probeHttpUrl;
  const result = await probe(endpoint.toString());
  const status = result.ok ? "ok" : "warn";
  const suffix = result.ok ? "reachable" : normalizeText(result.errorCode) || "failed";
  return createCheck({
    id: `${idBase}.${suffix}`,
    title,
    status,
    category: "network",
    evidence: {
      host: endpoint.host,
      protocol: endpoint.protocol,
      statusCode: Number(result.statusCode || 0),
      errorCode: normalizeText(result.errorCode),
    },
    recommendation: result.ok ? "" : "Check local DNS/proxy/network access before testing WeChat bridge APIs.",
  });
}

function listAccountFiles(config) {
  const dir = config.accountsDir || "";
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".context-tokens.json"))
    .map((entry) => readAccountFile(path.join(dir, entry.name), entry.name.slice(0, -5)))
    .filter(Boolean)
    .sort((left, right) => String(right.savedAt || "").localeCompare(String(left.savedAt || "")));
}

function readAccountFile(filePath, fallbackAccountId) {
  const parsed = readJsonFile(filePath);
  if (!parsed.ok || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    return null;
  }
  return {
    accountId: normalizeAccountId(parsed.data.accountId || fallbackAccountId),
    token: normalizeText(parsed.data.token),
    userId: normalizeText(parsed.data.userId),
    baseUrl: normalizeText(parsed.data.baseUrl),
    savedAt: normalizeText(parsed.data.savedAt),
  };
}

function resolveSelectedAccount(accounts, selectedAccountId) {
  const normalized = normalizeAccountId(selectedAccountId);
  if (normalized) {
    return accounts.find((account) => account.accountId === normalized) || null;
  }
  return accounts.length === 1 ? accounts[0] : null;
}

function normalizeAccountId(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { runWeixinChecks };
