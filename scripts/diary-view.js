// Render diary markdown files to a styled HTML page.
// Usage: node scripts/diary-view.js [date] [--open]

const fs = require("fs");
const path = require("path");
const os = require("os");

const DIARY_DIR = path.join(os.homedir(), ".cyberboss", "diary");

function main() {
  const args = process.argv.slice(2);
  const openFlag = args.includes("--open");
  const dateArg = args.find((a) => !a.startsWith("--"));
  const date = dateArg || today();
  const target = resolveDate(date);

  const entries = readDiaryEntries(target);
  const html = renderPage(target, entries);
  const outPath = path.join(DIARY_DIR, `view-${target}.html`);
  fs.writeFileSync(outPath, html, "utf8");
  console.log(outPath);

  if (openFlag) {
    const { exec } = require("child_process");
    const cmd = process.platform === "win32"
      ? `start "" "${outPath}"`
      : process.platform === "darwin"
        ? `open "${outPath}"`
        : `xdg-open "${outPath}"`;
    exec(cmd);
  }
}

function today() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function resolveDate(input) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }
  return today();
}

function readDiaryEntries(date) {
  const filePath = path.join(DIARY_DIR, `${date}.md`);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return parseEntries(raw);
}

function parseEntries(raw) {
  const entries = [];
  const lines = raw.split("\n");
  let current = null;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(\d{1,2}:\d{2})\s+(.+)/);
    if (h2) {
      if (current) {
        entries.push(current);
      }
      current = { time: h2[1], title: h2[2], body: [] };
      continue;
    }
    if (current && line.trim()) {
      current.body.push(line.trim());
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

function renderPage(date, entries) {
  const { dateCN, dateEN } = formatDate(date);
  const items = entries.map((e) => renderEntry(e)).join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>日记 - ${date}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500&family=Noto+Serif+SC:wght@400;500;600&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: "Noto Serif SC", "STSong", "SimSun", Georgia, serif;
    background: #f5f0e8;
    color: #3a3226;
    padding: 48px 32px 48px 64px;
    max-width: 560px;
    margin: 0 auto;
    line-height: 2;
    background-image: repeating-linear-gradient(
      to bottom,
      transparent,
      transparent 31px,
      #d8cfbe 31px,
      #d8cfbe 32px
    );
    background-position: 0 0;
    background-size: 100% 32px;
    position: relative;
  }

  /* left margin line */
  body::before {
    content: "";
    position: fixed;
    top: 0; left: calc(50% - 280px + 48px);
    width: 1px;
    height: 100%;
    background: #e8a0a0;
    opacity: 0.6;
    z-index: 1;
    pointer-events: none;
  }

  /* page shadow / depth */
  .page-wrapper {
    position: relative;
    background: rgba(253, 251, 245, 0.85);
    padding: 40px 28px 48px;
    border-radius: 2px;
    box-shadow: 0 2px 20px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04);
  }

  .date-header {
    text-align: center;
    margin-bottom: 36px;
    padding-bottom: 20px;
    border-bottom: 1px solid #d8cfbe;
  }

  .date-cn {
    font-family: "Noto Serif SC", "STSong", serif;
    font-size: 20px;
    font-weight: 500;
    color: #4a3f32;
    letter-spacing: 0.05em;
    margin-bottom: 2px;
  }

  .date-en {
    font-family: "Playfair Display", Georgia, serif;
    font-size: 12px;
    font-style: italic;
    color: #a09080;
    letter-spacing: 0.08em;
    text-transform: capitalize;
  }

  .entry {
    margin-bottom: 28px;
    padding-left: 8px;
    position: relative;
  }

  .entry-header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 4px;
  }

  .entry-time {
    font-family: "Playfair Display", Georgia, serif;
    font-size: 12px;
    color: #b0a090;
    font-style: italic;
    flex-shrink: 0;
  }

  .entry-title {
    font-family: "Noto Serif SC", "STSong", serif;
    font-size: 15px;
    font-weight: 600;
    color: #8b4a3a;
  }

  .entry-body p {
    font-size: 14px;
    color: #4a3f32;
    text-indent: 2em;
  }

  .signature {
    margin-top: 48px;
    padding-top: 16px;
    text-align: right;
    font-family: "Playfair Display", Georgia, serif;
    font-size: 13px;
    font-style: italic;
    color: #a09080;
  }

  .empty {
    text-align: center;
    color: #b0a090;
    padding: 60px 0;
    font-size: 14px;
    font-style: italic;
  }
</style>
</head>
<body>
<div class="page-wrapper">
  <div class="date-header">
    <div class="date-cn">${dateCN}</div>
    <div class="date-en">${dateEN}</div>
  </div>
${entries.length ? items : '<div class="empty">这天还没有日记 · No entries yet</div>'}
  <div class="signature">— with uu</div>
</div>
</body>
</html>`;
}

function renderEntry(entry) {
  const body = entry.body.map((p) => `    <p>${esc(p)}</p>`).join("\n");
  return `  <div class="entry">
    <div class="entry-header">
      <span class="entry-time">${esc(entry.time)}</span>
      <span class="entry-title">${esc(entry.title)}</span>
    </div>
    <div class="entry-body">
${body}
    </div>
  </div>`;
}

function formatDate(date) {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { dateCN: date, dateEN: date };
  const weekdaysCN = ["日", "一", "二", "三", "四", "五", "六"];
  const weekdaysEN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthsEN = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return {
    dateCN: `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日 星期${weekdaysCN[d.getDay()]}`,
    dateEN: `${weekdaysEN[d.getDay()]}, ${monthsEN[d.getMonth()]} ${Number(m[3])}, ${Number(m[1])}`,
  };
}

function esc(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main();
