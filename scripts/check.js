const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const files = ["src", "test", "scripts", "bin"]
  .flatMap((root) => collect(path.resolve(root)))
  .filter((file) => file.endsWith(".js"));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

console.log(`Checked ${files.length} JavaScript files.`);

function collect(target) {
  if (!fs.existsSync(target)) return [];
  if (fs.statSync(target).isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true })
    .flatMap((entry) => collect(path.join(target, entry.name)));
}
