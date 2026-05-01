async function probeHttpUrl(url, { timeoutMs = 1200 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      statusCode: response.status,
      errorCode: response.ok ? "" : "http_status",
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      errorCode: error?.name === "AbortError" ? "timeout" : "network_error",
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { probeHttpUrl };
