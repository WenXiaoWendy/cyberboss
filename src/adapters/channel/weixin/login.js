const qrcodeTerminal = require("qrcode-terminal");
const {
  deleteWeixinAccount,
  listWeixinAccounts,
  saveWeixinAccount,
} = require("./account-store");
const { clearPersistedContextTokens } = require("./context-token-store");
const { redactSensitiveText } = require("./redact");

const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_QR_REFRESH_COUNT = 3;

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

async function fetchQrCode(apiBaseUrl, botType) {
  const base = ensureTrailingSlash(apiBaseUrl);
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, base);
  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`Failed to fetch QR code: ${response.status} ${response.statusText} ${redactSensitiveText(body)}`);
  }
  return response.json();
}

async function pollQrStatus(apiBaseUrl, qrcode) {
  const base = ensureTrailingSlash(apiBaseUrl);
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        "iLink-App-ClientVersion": "1",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`QR status polling failed: ${response.status} ${response.statusText} ${redactSensitiveText(rawText)}`);
    }
    return JSON.parse(rawText);
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "wait" };
    }
    throw error;
  }
}

function printQrCode(url) {
  try {
    qrcodeTerminal.generate(url, { small: true });
    console.log("If the QR code does not render correctly here, open this link in a browser and scan it there:");
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

async function waitForWeixinLogin({ apiBaseUrl, botType, timeoutMs }) {
  let qrResponse = await fetchQrCode(apiBaseUrl, botType);
  let startedAt = Date.now();
  let scannedPrinted = false;
  let refreshCount = 1;

  console.log("Scan this QR code with WeChat to connect:\n");
  printQrCode(qrResponse.qrcode_img_content);
  console.log("\nWaiting for the connection result...\n");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (Date.now() - startedAt > ACTIVE_LOGIN_TTL_MS) {
      qrResponse = await fetchQrCode(apiBaseUrl, botType);
      startedAt = Date.now();
      scannedPrinted = false;
      refreshCount += 1;
      if (refreshCount > MAX_QR_REFRESH_COUNT) {
        throw new Error("The QR code expired too many times. Run login again.");
      }
      console.log(`QR code expired. Refreshing... (${refreshCount}/${MAX_QR_REFRESH_COUNT})\n`);
      printQrCode(qrResponse.qrcode_img_content);
    }

    const statusResponse = await pollQrStatus(apiBaseUrl, qrResponse.qrcode);
    switch (statusResponse.status) {
      case "wait":
        process.stdout.write(".");
        break;
      case "scaned":
        if (!scannedPrinted) {
          process.stdout.write("\nQR code scanned. Confirm the login inside WeChat...\n");
          scannedPrinted = true;
        }
        break;
      case "expired":
        qrResponse = await fetchQrCode(apiBaseUrl, botType);
        startedAt = Date.now();
        scannedPrinted = false;
        refreshCount += 1;
        if (refreshCount > MAX_QR_REFRESH_COUNT) {
          throw new Error("The QR code expired too many times. Run login again.");
        }
        console.log(`QR code expired. Refreshing... (${refreshCount}/${MAX_QR_REFRESH_COUNT})\n`);
        printQrCode(qrResponse.qrcode_img_content);
        break;
      case "confirmed":
        if (!statusResponse.bot_token || !statusResponse.ilink_bot_id) {
          throw new Error("Login succeeded but the response is missing the bot token or account ID.");
        }
        return {
          accountId: statusResponse.ilink_bot_id,
          token: statusResponse.bot_token,
          baseUrl: statusResponse.baseurl || apiBaseUrl,
          userId: statusResponse.ilink_user_id || "",
        };
      default:
        break;
    }
  }
  throw new Error("Login timed out. Run login again.");
}

async function runLoginFlow(config) {
  console.log("[cyberboss] starting WeChat QR login...");
  const result = await waitForWeixinLogin({
    apiBaseUrl: config.weixinBaseUrl,
    botType: config.weixinQrBotType,
    timeoutMs: 480_000,
  });
  const account = saveWeixinAccount(config, result.accountId, result);
  cleanupStaleAccountsForUserId(config, account);
  console.log("\n✅ Connected to WeChat successfully.");
  console.log(`accountId: ${account.accountId}`);
  console.log(`userId: ${account.userId || "(unknown)"}`);
  console.log(`baseUrl: ${account.baseUrl}`);
}

module.exports = { runLoginFlow };
