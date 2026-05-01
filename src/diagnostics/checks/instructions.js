const fs = require("fs");
const path = require("path");
const { createCheck, createGroup } = require("../schema");
const { inspectPath } = require("../file-utils");

function runInstructionsChecks(context) {
  const config = context.config || {};
  const options = context.options || {};
  return createGroup({
    id: "instructions",
    title: "Instructions",
    checks: [
      checkFile("instructions.weixin.generated", "Generated WeChat instructions", config.weixinInstructionsFile, options, "warn"),
      checkFile("instructions.weixin.operations_template", "WeChat operations template", config.weixinOperationsFile, options, "fail"),
      checkFile("instructions.weixin.source_template", "WeChat instructions source template", path.resolve(process.cwd(), "templates", "weixin-instructions.md"), options, "fail"),
    ],
  });
}

function checkFile(idBase, title, filePath, options, missingStatus) {
  const summary = inspectPath(filePath, options);
  const ok = summary.exists && summary.type === "file" && summary.sizeBytes > 0;
  return createCheck({
    id: ok ? `${idBase}.present` : `${idBase}.missing`,
    title,
    status: ok ? "ok" : missingStatus,
    category: "state",
    evidence: { exists: summary.exists, type: summary.type, sizeBytes: summary.sizeBytes || 0, mtime: summary.mtime || "" },
    recommendation: ok ? "" : "Run Cyberboss from a complete checkout and let bootstrap create local instructions when appropriate.",
  });
}

module.exports = { runInstructionsChecks };
