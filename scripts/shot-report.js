// Screenshot a standalone HTML file
// Usage: node scripts/shot-report.js <html-file>
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

async function main() {
  const htmlPath = process.argv[2];
  if (!htmlPath || !fs.existsSync(htmlPath)) {
    console.error("HTML not found:", htmlPath);
    process.exit(1);
  }
  const outputPath = htmlPath.replace(/\.html$/, ".png");
  const url = "file:///" + htmlPath.replace(/\\/g, "/");

  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 560, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.screenshot({ path: outputPath, fullPage: true });
    console.log(outputPath);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
