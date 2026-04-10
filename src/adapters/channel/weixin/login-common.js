const qrcodeTerminal = require("qrcode-terminal");
const {
  deleteWeixinAccount,
  listWeixinAccounts,
  saveWeixinAccount,
} = require("./account-store");
const { clearPersistedContextTokens } = require("./context-token-store");

const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const MAX_QR_REFRESH_COUNT = 3;

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function printQrCode(url) {
  try {
    qrcodeTerminal.generate(url, { small: true });
    console.log("如果二维码未能成功展示，请用浏览器打开以下链接扫码：");
    console.log(url);
  } catch {
    console.log(url);
  }
}

function cleanupStaleAccountsForUserId(config, activeAccount) {
  const activeUserId = typeof activeAccount?.userId === "string" ? activeAccount.userId.trim() : "";
  if (!activeUserId) {
    return [];
  }
  const staleAccounts = listWeixinAccounts(config).filter((account) => (
    account.accountId !== activeAccount.accountId
    && typeof account.userId === "string"
    && account.userId.trim() === activeUserId
  ));
  for (const staleAccount of staleAccounts) {
    deleteWeixinAccount(config, staleAccount.accountId);
    clearPersistedContextTokens(config, staleAccount.accountId);
    console.log(`[cyberboss] removed stale account ${staleAccount.accountId} for userId ${activeUserId}`);
  }
  return staleAccounts;
}

function finishWeixinLogin(config, result) {
  const account = saveWeixinAccount(config, result.accountId, result);
  cleanupStaleAccountsForUserId(config, account);
  console.log("\n✅ 与微信连接成功！");
  console.log(`accountId: ${account.accountId}`);
  console.log(`userId: ${account.userId || "(unknown)"}`);
  console.log(`baseUrl: ${account.baseUrl}`);
  if (account.routeTag) {
    console.log(`routeTag: ${account.routeTag}`);
  }
  return account;
}

module.exports = {
  ACTIVE_LOGIN_TTL_MS,
  MAX_QR_REFRESH_COUNT,
  ensureTrailingSlash,
  finishWeixinLogin,
  printQrCode,
};
