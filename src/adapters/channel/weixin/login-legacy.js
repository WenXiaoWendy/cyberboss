const { redactSensitiveText } = require("./redact");
const {
  ACTIVE_LOGIN_TTL_MS,
  MAX_QR_REFRESH_COUNT,
  ensureTrailingSlash,
  finishWeixinLogin,
  printQrCode,
} = require("./login-common");

const QR_LONG_POLL_TIMEOUT_MS = 35_000;

async function fetchQrCode(apiBaseUrl, botType) {
  const base = ensureTrailingSlash(apiBaseUrl);
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, base);
  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`二维码获取失败: ${response.status} ${response.statusText} ${redactSensitiveText(body)}`);
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
      throw new Error(`二维码状态轮询失败: ${response.status} ${response.statusText} ${redactSensitiveText(rawText)}`);
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

async function waitForLegacyWeixinLogin({ apiBaseUrl, botType, timeoutMs }) {
  let qrResponse = await fetchQrCode(apiBaseUrl, botType);
  let startedAt = Date.now();
  let scannedPrinted = false;
  let refreshCount = 1;

  console.log("使用微信扫描以下二维码，以完成连接：\n");
  printQrCode(qrResponse.qrcode_img_content);
  console.log("\n等待连接结果...\n");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (Date.now() - startedAt > ACTIVE_LOGIN_TTL_MS) {
      qrResponse = await fetchQrCode(apiBaseUrl, botType);
      startedAt = Date.now();
      scannedPrinted = false;
      refreshCount += 1;
      if (refreshCount > MAX_QR_REFRESH_COUNT) {
        throw new Error("二维码多次过期，请重新执行 login");
      }
      console.log(`二维码已过期，正在刷新...(${refreshCount}/${MAX_QR_REFRESH_COUNT})\n`);
      printQrCode(qrResponse.qrcode_img_content);
    }

    const statusResponse = await pollQrStatus(apiBaseUrl, qrResponse.qrcode);
    switch (statusResponse.status) {
      case "wait":
        process.stdout.write(".");
        break;
      case "scaned":
        if (!scannedPrinted) {
          process.stdout.write("\n已扫码，请在微信中确认授权...\n");
          scannedPrinted = true;
        }
        break;
      case "expired":
        qrResponse = await fetchQrCode(apiBaseUrl, botType);
        startedAt = Date.now();
        scannedPrinted = false;
        refreshCount += 1;
        if (refreshCount > MAX_QR_REFRESH_COUNT) {
          throw new Error("二维码多次过期，请重新执行 login");
        }
        console.log(`二维码已过期，正在刷新...(${refreshCount}/${MAX_QR_REFRESH_COUNT})\n`);
        printQrCode(qrResponse.qrcode_img_content);
        break;
      case "confirmed":
        if (!statusResponse.bot_token || !statusResponse.ilink_bot_id) {
          throw new Error("登录成功但缺少 bot token 或账号 ID");
        }
        return {
          accountId: statusResponse.ilink_bot_id,
          token: statusResponse.bot_token,
          baseUrl: statusResponse.baseurl || apiBaseUrl,
          userId: statusResponse.ilink_user_id || "",
          routeTag: "",
        };
      default:
        break;
    }
  }
  throw new Error("登录超时，请重新执行 login");
}

async function runLegacyLoginFlow(config) {
  console.log("[cyberboss] 正在启动微信扫码登录（legacy）...");
  const result = await waitForLegacyWeixinLogin({
    apiBaseUrl: config.weixinBaseUrl,
    botType: config.weixinQrBotType,
    timeoutMs: 480_000,
  });
  finishWeixinLogin(config, result);
}

module.exports = { runLegacyLoginFlow };
