#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SIPS_PATH = "/usr/bin/sips";
const DEFAULT_SIZE = 240;

function main() {
  const args = process.argv.slice(2);
  const inputPath = readFlag(args, "--input");
  const outputPath = readFlag(args, "--output");
  const size = Number.parseInt(readFlag(args, "--size") || String(DEFAULT_SIZE), 10);

  if (!inputPath || !outputPath) {
    throw new Error("Usage: normalize-sticker-gif.js --input <path> --output <path> [--size 240]");
  }
  const resolvedInputPath = path.resolve(inputPath);
  const resolvedOutputPath = path.resolve(outputPath);
  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(`Input file does not exist: ${resolvedInputPath}`);
  }
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });

  const inputExt = path.extname(resolvedInputPath).toLowerCase();
  if (inputExt === ".gif") {
    fs.copyFileSync(resolvedInputPath, resolvedOutputPath);
    return;
  }

  const normalizedSize = Number.isInteger(size) && size > 0 ? size : DEFAULT_SIZE;
  if (process.platform === "darwin" && fs.existsSync(SIPS_PATH)) {
    normalizeWithSips({ inputPath: resolvedInputPath, outputPath: resolvedOutputPath, size: normalizedSize });
    return;
  }

  const imageMagick = findCommand(["magick", "convert"]);
  if (imageMagick) {
    normalizeWithImageMagick({
      command: imageMagick,
      inputPath: resolvedInputPath,
      outputPath: resolvedOutputPath,
      size: normalizedSize,
    });
    return;
  }

  throw new Error("Sticker GIF normalization for non-GIF inputs requires macOS `sips` or ImageMagick (`magick`/`convert`).");
}

function normalizeWithSips({ inputPath, outputPath, size }) {
  const result = spawnSync(SIPS_PATH, [
    "-s", "format", "gif",
    "-z", String(size), String(size),
    inputPath,
    "--out", outputPath,
  ], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    throw new Error(`sips gif normalization failed: ${stderr || stdout || `exit ${result.status}`}`);
  }
  ensureOutput(outputPath);
}

function normalizeWithImageMagick({ command, inputPath, outputPath, size }) {
  const args = command === "magick"
    ? [inputPath, "-resize", `${size}x${size}`, outputPath]
    : [inputPath, "-resize", `${size}x${size}`, outputPath];
  const result = spawnSync(command, args, {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    throw new Error(`ImageMagick gif normalization failed: ${stderr || stdout || `exit ${result.status}`}`);
  }
  ensureOutput(outputPath);
}

function ensureOutput(outputPath) {
  if (!fs.existsSync(outputPath)) {
    throw new Error(`GIF normalization produced no output: ${outputPath}`);
  }
}

function readFlag(args, flag) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      return String(args[index + 1] || "").trim();
    }
  }
  return "";
}

function findCommand(names) {
  const pathEntries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const entry of pathEntries) {
      const candidate = path.join(entry, name);
      if (fs.existsSync(candidate)) {
        return name;
      }
    }
  }
  return "";
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  console.error(message);
  process.exit(1);
}
