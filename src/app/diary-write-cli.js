const fs = require("fs");
const path = require("path");

async function runDiaryWriteCommand(config) {
  const args = process.argv.slice(4);
  const options = parseArgs(args);
  const body = await resolveBody(options);
  if (!body) {
    throw new Error("Diary content cannot be empty. Pass --text, --text-file, or provide input through stdin.");
  }

  const now = new Date();
  const dateString = options.date || formatDate(now);
  const timeString = options.time || formatTime(now);
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
    textFile: "",
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
    if (arg === "--text-file") {
      options.textFile = String(args[index + 1] || "");
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
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function resolveBody(options) {
  const inlineText = normalizeBody(options.text);
  if (inlineText) {
    return inlineText;
  }
  const fileText = readTextFile(options.textFile);
  if (fileText) {
    return fileText;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return normalizeBody(await readStdin());
}

function readTextFile(filePath) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    return "";
  }
  return normalizeBody(fs.readFileSync(normalizedPath, "utf8"));
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

function formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

module.exports = {
  parseArgs,
  resolveBody,
  runDiaryWriteCommand,
};
