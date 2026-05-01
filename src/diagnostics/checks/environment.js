const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { createCheck, createGroup } = require("../schema");

function runEnvironmentChecks(context) {
  return createGroup({
    id: "environment",
    title: "Environment",
    checks: [
      checkNodeVersion(),
      checkPackageMetadata(),
      checkNodeModules(),
      checkGitCommit(),
    ],
  });
}

function checkNodeVersion() {
  const version = process.version;
  const major = Number.parseInt(version.replace(/^v/, "").split(".")[0], 10);
  const ok = Number.isFinite(major) && major >= 22;
  return createCheck({
    id: "environment.node.version",
    title: "Node.js version",
    status: ok ? "ok" : "fail",
    category: "install",
    evidence: { version, required: ">=22" },
    recommendation: ok ? "" : "Install Node.js 22 or newer in the Linux environment.",
  });
}

function checkPackageMetadata() {
  const packagePath = path.resolve(process.cwd(), "package.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return createCheck({
      id: "environment.package.version",
      title: "Package metadata",
      status: "ok",
      category: "install",
      evidence: { name: parsed.name || "", version: parsed.version || "" },
    });
  } catch (error) {
    return createCheck({
      id: "environment.package.version",
      title: "Package metadata",
      status: "fail",
      category: "install",
      evidence: { errorCode: error?.code || "parse_error" },
      recommendation: "Run Doctor from the Cyberboss repository root.",
    });
  }
}

function checkNodeModules() {
  const exists = fs.existsSync(path.resolve(process.cwd(), "node_modules"));
  return createCheck({
    id: exists ? "environment.node_modules.present" : "environment.node_modules.missing",
    title: "Installed dependencies",
    status: exists ? "ok" : "warn",
    category: "install",
    evidence: { exists },
    recommendation: exists ? "" : "Run npm install before starting Cyberboss.",
  });
}

function checkGitCommit() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 700,
  });
  const commit = String(result.stdout || "").trim();
  return createCheck({
    id: "environment.git.commit",
    title: "Git commit",
    status: commit ? "ok" : "unknown",
    category: "install",
    evidence: { commit: commit || "", errorCode: result.error?.code || (result.status ? `exit_${result.status}` : "") },
  });
}

module.exports = { runEnvironmentChecks };
