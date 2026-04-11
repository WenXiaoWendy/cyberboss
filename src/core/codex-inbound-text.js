const { formatRuntimeLocalTimestamp } = require("./user-timezone");

function buildCodexInboundText(normalized, persisted = {}, config = {}) {
  const text = String(normalized?.text || "").trim();
  const saved = Array.isArray(persisted?.saved) ? persisted.saved : [];
  const failed = Array.isArray(persisted?.failed) ? persisted.failed : [];
  const userName = String(config?.userName || "").trim() || "the user";
  const localTime = formatRuntimeLocalTimestamp(normalized?.receivedAt, config?.userTimezone);
  const lines = [];
  if (localTime) {
    lines.push(`[${localTime}]`);
  }
  if (text) {
    if (lines.length) {
      lines.push("");
    }
    lines.push(text);
  }

  if (saved.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push(`${userName} sent image/file attachments. They were saved under the local data directory:`);
    for (const item of saved) {
      const suffix = item.sourceFileName ? ` (original name: ${item.sourceFileName})` : "";
      lines.push(`- [${item.kind}] ${item.absolutePath}${suffix}`);
    }
    lines.push(`You must read these files before replying to ${userName}. Do not skip the read step.`);
    lines.push(`If the required local tool is missing, tell ${userName} exactly what is missing and that you cannot read the file yet. Do not pretend you already read it.`);
  }

  if (failed.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push("Attachment intake errors:");
    for (const item of failed) {
      const label = item.sourceFileName || item.kind || "attachment";
      lines.push(`- ${label}: ${item.reason}`);
    }
  }

  return lines.join("\n").trim();
}

module.exports = {
  buildCodexInboundText,
};
