const path = require("node:path");

function extractApprovalCommandTokens(value, options = {}) {
  return normalizeCommandTokens(extractTokens(value, options));
}

function buildApprovalMatchTokens({ toolName = "", commandTokens = [], input = null, options = {} } = {}) {
  const normalizedToolName = normalizeString(toolName).toLowerCase();
  if (normalizedToolName === "view_image") {
    return ["view_image"];
  }
  if (normalizedToolName === "read" && isImageFilePath(extractApprovalFilePath(input, options))) {
    return ["read_image"];
  }
  const mcpToolTokens = extractMcpToolTokens(normalizedToolName);
  if (mcpToolTokens.length) {
    return mcpToolTokens;
  }

  const rawTokens = normalizeCommandTokens(commandTokens).length
    ? normalizeCommandTokens(commandTokens)
    : extractApprovalCommandTokens(input, options);

  return canonicalizeCommandTokens(rawTokens);
}

function extractTokens(value, options = {}) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === "string")
      ? value.map((entry) => entry.trim()).filter(Boolean)
      : [];
  }
  if (typeof value === "string") {
    return splitCommandLine(value);
  }
  if (typeof value !== "object") {
    return [];
  }

  const preferredKeys = Array.isArray(options.preferredKeys) ? options.preferredKeys : [];
  for (const key of preferredKeys) {
    const tokens = extractTokens(value[key], options);
    if (tokens.length) {
      return tokens;
    }
  }

  for (const key of DEFAULT_TOKEN_KEYS) {
    if (preferredKeys.includes(key)) {
      continue;
    }
    const tokens = extractTokens(value[key], options);
    if (tokens.length) {
      return tokens;
    }
  }

  if (options.scanNestedExecPolicyKeys) {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.includes("execpolicy") || normalizedKey.includes("exec_policy")) {
        const tokens = extractTokens(nested, options);
        if (tokens.length) {
          return tokens;
        }
      }
    }
  }

  return [];
}

function buildApprovalCommandPreview(tokens) {
  const normalized = normalizeCommandTokens(tokens);
  if (!normalized.length) {
    return "";
  }
  return normalized.map((token) => (token.includes(" ") ? JSON.stringify(token) : token)).join(" ");
}

function matchesCommandPrefix(commandTokens, allowlist) {
  const normalizedCommandTokens = canonicalizeCommandTokens(commandTokens);
  if (!normalizedCommandTokens.length || !Array.isArray(allowlist) || !allowlist.length) {
    return false;
  }
  return allowlist.some((prefix) => {
    const normalizedPrefix = canonicalizeCommandTokens(prefix);
    if (!normalizedPrefix.length || normalizedPrefix.length > normalizedCommandTokens.length) {
      return false;
    }
    return normalizedPrefix.every((part, index) => part === normalizedCommandTokens[index]);
  });
}

function canonicalizeCommandTokens(tokens) {
  const normalized = normalizeCommandTokens(tokens);
  if (!normalized.length) {
    return [];
  }
  if (normalized.length >= 3 && isShellWrapper(normalized[0], normalized[1])) {
    return canonicalizeCommandTokens(splitCommandLine(normalized.slice(2).join(" ")));
  }
  if (normalized[0] === "npm") {
    const runIndex = normalized.indexOf("run");
    if (runIndex >= 0) {
      const scriptName = normalizeString(normalized[runIndex + 1]);
      return scriptName ? ["npm", "run", scriptName] : [];
    }
  }

  const executable = baseName(normalized[0]);
  if (executable === "node" || executable === "node.exe") {
    const binPath = normalizeString(normalized[1]);
    const binBase = baseName(binPath);
    if ((binPath === "./bin/cyberboss.js" || /\/bin\/cyberboss\.js$/u.test(binPath)) && normalized.length >= 4) {
      return ["cyberboss", normalizeString(normalized[2]), normalizeString(normalized[3])].filter(Boolean);
    }
    if (binBase) {
      return [executable, binBase];
    }
  }

  if (executable === "cyberboss" || executable === "cyberboss.js") {
    return ["cyberboss", normalizeString(normalized[1]), normalizeString(normalized[2])].filter(Boolean);
  }

  return normalized;
}

function normalizeCommandTokens(tokens) {
  return Array.isArray(tokens)
    ? tokens.map((part) => normalizeString(part)).filter(Boolean)
    : [];
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function extractApprovalFilePath(value, options = {}) {
  return extractApprovalFilePaths(value, options)[0] || "";
}

function extractApprovalFilePaths(value, options = {}) {
  const collected = [];
  collectApprovalFilePaths(value, options, collected, new Set());
  return collected;
}

function collectApprovalFilePaths(value, options, collected, seenObjects) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  if (seenObjects.has(value)) {
    return;
  }
  seenObjects.add(value);

  const preferredKeys = Array.isArray(options.preferredKeys) ? options.preferredKeys : [];
  for (const key of [...preferredKeys, ...DEFAULT_FILE_PATH_KEYS]) {
    pushUniqueFilePath(collected, value[key]);
  }
  for (const key of DEFAULT_FILE_PATH_LIST_KEYS) {
    const list = value[key];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const entry of list) {
      pushUniqueFilePath(collected, entry);
    }
  }

  for (const nested of Object.values(value)) {
    if (!nested || typeof nested !== "object") {
      continue;
    }
    if (Array.isArray(nested)) {
      for (const entry of nested) {
        collectApprovalFilePaths(entry, options, collected, seenObjects);
      }
      continue;
    }
    collectApprovalFilePaths(nested, options, collected, seenObjects);
  }
}

function pushUniqueFilePath(collected, value) {
  const filePath = normalizeString(value);
  if (!filePath || collected.includes(filePath)) {
    return;
  }
  collected.push(filePath);
}

function isImageFilePath(filePath) {
  const normalized = normalizeString(filePath).toLowerCase();
  if (!normalized) {
    return false;
  }
  return IMAGE_FILE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

function splitCommandLine(input) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of String(input || "")) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function isPathWithinRoot(filePath, rootPath) {
  const normalizedFilePath = normalizeString(filePath);
  const normalizedRootPath = normalizeString(rootPath);
  if (!normalizedFilePath || !normalizedRootPath) {
    return false;
  }

  const resolvedFilePath = basePath(normalizedFilePath);
  const resolvedRootPath = basePath(normalizedRootPath);
  return resolvedFilePath === resolvedRootPath || resolvedFilePath.startsWith(`${resolvedRootPath}/`);
}

function isShellWrapper(command, flag) {
  const executable = baseName(command);
  return (executable === "sh" || executable === "bash" || executable === "zsh") && normalizeString(flag) === "-lc";
}

function extractMcpToolTokens(toolName) {
  const normalized = normalizeString(toolName).toLowerCase();
  if (!normalized.startsWith("mcp__")) {
    return [];
  }
  const parts = normalized.split("__").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "mcp") {
    return [];
  }
  const serverName = normalizeString(parts[1]);
  const toolParts = parts.slice(2).map((part) => normalizeString(part)).filter(Boolean);
  if (!serverName || !toolParts.length) {
    return [];
  }
  return ["mcp_tool", serverName, toolParts.join("__")];
}

function baseName(value) {
  const normalized = normalizeString(value).replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/");
  return normalizeString(parts[parts.length - 1]);
}

function basePath(value) {
  return normalizeString(value) ? path.resolve(value).replace(/\\/g, "/") : "";
}

const DEFAULT_TOKEN_KEYS = [
  "proposedExecpolicyAmendment",
  "prefix_rule",
  "argv",
  "args",
  "command",
  "cmd",
  "exec",
  "shellCommand",
  "script",
];

const DEFAULT_FILE_PATH_KEYS = [
  "file_path",
  "filePath",
  "path",
];

const DEFAULT_FILE_PATH_LIST_KEYS = [
  "paths",
];

const IMAGE_FILE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
];

module.exports = {
  extractApprovalCommandTokens,
  extractApprovalFilePath,
  extractApprovalFilePaths,
  buildApprovalMatchTokens,
  buildApprovalCommandPreview,
  canonicalizeCommandTokens,
  isImageFilePath,
  isPathWithinRoot,
  matchesCommandPrefix,
  normalizeCommandTokens,
  splitCommandLine,
  extractMcpToolTokens,
};
