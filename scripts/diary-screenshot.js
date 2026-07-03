// Screenshot a diary HTML view page.
// Usage: node scripts/diary-screenshot.js <date>

const fs = require("fs");
const path = require("path");
const os = require("os");
const { chromium } = require("playwright-core");

const DIARY_DIR = path.join(os.homedir(), ".cyberboss", "diary");

async function main() {
  const date = process.argv[2] || today();
  const htmlPath = path.join(DIARY_DIR, `view-${date}.html`);

  if (!fs.existsSync(htmlPath)) {
    console.error("HTML not found:", htmlPath);
    process.exit(1);
  }

  const outputPath = path.join(DIARY_DIR, `shot-${date}.png`);
  const url = `file:///${htmlPath.replace(/\\/g, "/")}`;

  const browser = await chromium.launch({
    headless: true,
    channel: "msedge",
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 520, height: 800 },
      deviceScaleFactor: 2,
    });
    // Block external fonts that hang behind GFW
    await page.route("**/*", (route) => {
      const u = route.request().url();
      if (u.includes("googleapis.com") || u.includes("gstatic.com") || u.includes("fonts.googleapis")) {
        route.abort();
      } else {
        route.continue();
      }
    });
    await page.goto(url, { waitUntil: "load", timeout: 15000 });
    await page.screenshot({ path: outputPath, type: "png", fullPage: true });
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(outputPath);
}

function today() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
