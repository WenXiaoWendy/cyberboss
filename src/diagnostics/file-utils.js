const fs = require("fs");
const { redactPath } = require("./redact");

function inspectPath(filePath, options = {}) {
  const normalizedPath = typeof filePath === "string" ? filePath.trim() : "";
  const out = {
    path: redactPath(normalizedPath, options),
    exists: false,
    type: "missing",
  };
  if (!normalizedPath) {
    return out;
  }
  try {
    const stat = fs.statSync(normalizedPath);
    return {
      ...out,
      exists: true,
      type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
      sizeBytes: stat.size,
      mtime: stat.mtime.toISOString(),
      mode: stat.mode & 0o777,
      readable: canAccess(normalizedPath, fs.constants.R_OK),
      writable: canAccess(normalizedPath, fs.constants.W_OK),
    };
  } catch (error) {
    return {
      ...out,
      errorCode: error?.code || "unknown",
    };
  }
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { exists: false, ok: true, data: null, errorCode: "" };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return { exists: true, ok: true, data: JSON.parse(raw), errorCode: "" };
  } catch (error) {
    return { exists: true, ok: false, data: null, errorCode: error?.code || "parse_error" };
  }
}

function canAccess(filePath, mode) {
  try {
    fs.accessSync(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  inspectPath,
  readJsonFile,
};
