#!/usr/bin/env node

const { main } = require("../src/index");

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  const fullMessage = `[cyberboss] FATAL main rejected: ${message}`;
  console.error(fullMessage);
  try {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const crashLogPath = path.join(os.homedir(), ".cyberboss", "crash.log");
    fs.appendFileSync(crashLogPath, `[${new Date().toISOString()}] ${fullMessage}\n`);
  } catch {}
  process.stderr.write(fullMessage + "\n");
  setTimeout(() => { process.exitCode = 1; }, 100);
});

