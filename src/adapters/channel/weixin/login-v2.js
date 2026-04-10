const {
  buildCommonHeaders,
  normalizeProtocolClientVersion,
  normalizeRouteTag,
} = require("./protocol");
const { redactSensitiveText } = require("./redact");
const {
  ACTIVE_LOGIN_TTL_MS,
  MAX_QR_REFRESH_COUNT,
  ensureTrailingSlash,
  finishWeixinLogin,
  printQrCode,
} = require("./login-common");

const QR_LONG_POLL_TIMEOUT_MS = 35_000;

async function fetchQrCode({ apiBaseUrl, botType, routeTag = "", clientVersion = "" }) {
  const base = ensureTrailingSlash(apiBaseUrl);
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, base);
  const response = await fetch(url.toString(), {
    headers: buildCommonHeaders({ routeTag, clientVersion }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`二维码获取失败: ${response.status} ${response.statusText} ${redactSensitiveText(body)}`);
  }
  return response.json();
}

async function pollQrStatus({ apiBaseUrl, qrcode, routeTag = "", clientVersion = "" }) {
  const base = ensureTrailingSlash(apiBaseUrl);
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      headers: buildCommonHeaders({ routeTag, clientVersion }),
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
    if (isTransientLongPollError(error)) {
      return { status: "wait" };
    }
    throw error;
  }
}

async function waitForV2WeixinLogin({ apiBaseUrl, botType, routeTag = "", clientVersion = "", timeoutMs }) {
  let qrResponse = await fetchQrCode({ apiBaseUrl, botType, routeTag, clientVersion });
  let startedAt = Date.now();
  let refreshCount = 0;
  let scannedPrinted = false;
  let pollBaseUrl = apiBaseUrl;

  console.log("使用微信扫描以下二维码，以完成连接：\n");
  printQrCode(qrResponse.qrcode_img_content);
  console.log("\n等待连接结果...\n");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (Date.now() - startedAt > ACTIVE_LOGIN_TTL_MS) {
      ({ qrResponse, startedAt, refreshCount, scannedPrinted, pollBaseUrl } = await refreshQrCode({
        reason: "二维码已过期，正在刷新...",
        apiBaseUrl,
        botType,
        routeTag,
        clientVersion,
        refreshCount,
      }));
    }

    const statusResponse = await pollQrStatus({
      apiBaseUrl: pollBaseUrl,
      qrcode: qrResponse.qrcode,
      routeTag,
      clientVersion,
    });

    switch (statusResponse.status) {
      case "wait":
        process.stdout.write(".");
        await sleep(1_000);
        break;
      case "scaned":
        if (!scannedPrinted) {
          process.stdout.write("\n已扫码，请在微信中确认授权...\n");
          scannedPrinted = true;
        }
        await sleep(1_000);
        break;
      case "scaned_but_redirect":
        // V2 login can hand the QR polling phase off to a redirected host.
        // If we keep polling the gateway after this point, login looks "stuck"
        // even though the user already confirmed in WeChat.
        if (typeof statusResponse.redirect_host === "string" && statusResponse.redirect_host.trim()) {
          pollBaseUrl = `https://${statusResponse.redirect_host.trim()}`;
        }
        await sleep(1_000);
        break;
      case "expired":
        ({ qrResponse, startedAt, refreshCount, scannedPrinted, pollBaseUrl } = await refreshQrCode({
          reason: "二维码已过期，正在刷新...",
          apiBaseUrl,
          botType,
          routeTag,
          clientVersion,
          refreshCount,
        }));
        break;
      case "confirmed":
        if (!statusResponse.bot_token || !statusResponse.ilink_bot_id) {
          throw new Error("登录成功但缺少 bot token 或账号 ID");
        }
        return {
          accountId: statusResponse.ilink_bot_id,
          token: statusResponse.bot_token,
          baseUrl: statusResponse.baseurl || pollBaseUrl || apiBaseUrl,
          userId: statusResponse.ilink_user_id || "",
          routeTag,
        };
      default:
        throw new Error(`二维码状态异常: ${redactSensitiveText(JSON.stringify(statusResponse))}`);
    }
  }

  throw new Error("登录超时，请重新执行 login");
}

async function refreshQrCode({ reason, apiBaseUrl, botType, routeTag, clientVersion, refreshCount }) {
  const nextRefreshCount = refreshCount + 1;
  if (nextRefreshCount > MAX_QR_REFRESH_COUNT) {
    throw new Error("二维码多次过期，请重新执行 login");
  }
  const qrResponse = await fetchQrCode({ apiBaseUrl, botType, routeTag, clientVersion });
  console.log(`${reason}(${nextRefreshCount}/${MAX_QR_REFRESH_COUNT})\n`);
  printQrCode(qrResponse.qrcode_img_content);
  return {
    qrResponse,
    startedAt: Date.now(),
    refreshCount: nextRefreshCount,
    scannedPrinted: false,
    pollBaseUrl: apiBaseUrl,
  };
}

function isTransientLongPollError(error) {
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  const message = String(error?.message || "").toLowerCase();
  return message.includes("aborted")
    || message.includes("fetch failed")
    || message.includes("networkerror")
    || message.includes("timed out")
    || error instanceof TypeError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runV2LoginFlow(config) {
  const routeTag = normalizeRouteTag(config.weixinRouteTag);
  const clientVersion = normalizeProtocolClientVersion(config.weixinProtocolClientVersion);
  const routeTagLabel = routeTag ? ` routeTag=${routeTag}` : "";
  console.log(`[cyberboss] 正在启动微信扫码登录（v2）...${routeTagLabel}`);
  const result = await waitForV2WeixinLogin({
    apiBaseUrl: config.weixinBaseUrl,
    botType: config.weixinQrBotType,
    routeTag,
    clientVersion,
    timeoutMs: 480_000,
  });
  finishWeixinLogin(config, result);
}

module.exports = {
  runV2LoginFlow,
};
