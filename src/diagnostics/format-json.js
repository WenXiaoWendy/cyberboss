const { redactMaybeSensitive } = require("./redact");

function formatJsonReport(report) {
  return JSON.stringify(redactMaybeSensitive(report), null, 2);
}

module.exports = { formatJsonReport };
