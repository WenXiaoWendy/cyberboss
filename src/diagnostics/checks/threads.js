const fs = require("fs");
const { createCheck, createGroup } = require("../schema");
const { readJsonFile } = require("../file-utils");
const { redactId, redactPath } = require("../redact");

function runThreadChecks(context) {
  const config = context.config || {};
  const options = context.options || {};
  const parsed = readJsonFile(config.sessionsFile || "");
  if (!parsed.exists) {
    return createGroup({
      id: "threads",
      title: "Threads",
      checks: [
        createCheck({
          id: "threads.sessions_file.missing",
          title: "Sessions file",
          status: "warn",
          category: "binding",
          evidence: { exists: false, file: redactPath(config.sessionsFile, options) },
          recommendation: "Bind a WeChat chat to create session state.",
        }),
      ],
    });
  }
  if (!parsed.ok) {
    return createGroup({
      id: "threads",
      title: "Threads",
      checks: [
        createCheck({
          id: "threads.sessions_file.invalid_json",
          title: "Sessions file",
          status: "fail",
          category: "state",
          evidence: { exists: true, ok: false },
          recommendation: "Repair or replace sessions.json.",
        }),
      ],
    });
  }
  const bindings = parsed.data?.bindings && typeof parsed.data.bindings === "object" ? parsed.data.bindings : {};
  const runtime = config.runtime || "codex";
  const threadCount = countThreads(bindings, runtime);
  return createGroup({
    id: "threads",
    title: "Threads",
    checks: [
      createCheck({
        id: "threads.bindings.summary",
        title: "Thread bindings",
        status: Object.keys(bindings).length ? "ok" : "warn",
        category: "binding",
        evidence: {
          bindingCount: Object.keys(bindings).length,
          runtime,
          threadCount,
          bindingIds: Object.keys(bindings).map((key) => redactId(key, options)),
        },
        recommendation: Object.keys(bindings).length ? "" : "Use /bind from WeChat to bind a workspace.",
      }),
    ],
  });
}

function countThreads(bindings, runtime) {
  let count = 0;
  for (const binding of Object.values(bindings || {})) {
    const byRuntime = binding?.threadIdByWorkspaceRootByRuntime?.[runtime] || {};
    count += Object.values(byRuntime).filter(Boolean).length;
  }
  return count;
}

module.exports = { runThreadChecks };
