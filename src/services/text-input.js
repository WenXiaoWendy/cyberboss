const fs = require("fs");

async function resolveBodyInput({ text = "", textFile = "" } = {}) {
  const inlineText = normalizeBody(text);
  if (inlineText) {
    return inlineText;
  }
  const fileText = readTextFile(textFile);
  if (fileText) {
    return fileText;
  }
  return "";
}

function readTextFile(filePath) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    return "";
  }
  return normalizeBody(fs.readFileSync(normalizedPath, "utf8"));
}

function normalizeBody(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

module.exports = {
  normalizeBody,
  readTextFile,
  resolveBodyInput,
};
