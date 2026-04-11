const fs = require("fs");
const path = require("path");

async function runDiaryWriteCommand(config) {
  const args = process.argv.slice(4);
  const options = parseArgs(args);
  const body = await resolveBody(options);
  if (!body) {
    throw new Error("日记内容不能为空，传 --text 或通过 stdin 输入");
  }

  const now = new Date();
  const dateString = options.date || formatDate(now, config.timezone);
  const timeString = options.time || formatTime(now, config.timezone);
  const filePath = path.join(config.diaryDir, `${dateString}.md`);
  const entry = buildDiaryEntry({
    timeString,
    title: options.title,
    body,
  });

  fs.mkdirSync(config.diaryDir, { recursive: true });
  const prefix = fs.existsSync(filePath) && fs.statSync(filePath).size > 0 ? "\n\n" : "";
  fs.appendFileSync(filePath, `${prefix}${entry}`, "utf8");
  console.log(`diary written: ${filePath}`);
}

function parseArgs(args) {
  const options = {
    text: "",
    title: "",
    date: "",
    time: "",
    useStdin: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--text") {
      options.text = String(args[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--title") {
      options.title = String(args[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--date") {
      options.date = String(args[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--time") {
      options.time = String(args[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--stdin") {
      options.useStdin = true;
      continue;
    }
    throw new Error(`未知参数: ${arg}`);
  }
  return options;
}

async function resolveBody(options) {
  const inlineText = normalizeBody(options.text);
  if (inlineText) {
    return inlineText;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return normalizeBody(await readStdin());
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
}

function buildDiaryEntry({ timeString, title, body }) {
  const heading = title ? `## ${timeString} ${title.trim()}` : `## ${timeString}`;
  return `${heading}\n\n${body}`;
}

function normalizeBody(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function formatDate(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatTime(date, timezone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

module.exports = { runDiaryWriteCommand };
