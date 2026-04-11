async function runChannelSendFileCommand(app) {
  const args = process.argv.slice(4);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const options = parseArgs(args);
  if (!options.path) {
    throw new Error("Missing --path. Provide the local file path to send back to WeChat.");
  }

  const result = await app.sendLocalFileToCurrentChat({
    senderId: options.user,
    filePath: options.path,
  });
  console.log(`file sent: ${result.filePath}`);
}

function parseArgs(args) {
  const options = {
    path: "",
    user: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "");
    if (arg === "--path") {
      options.path = String(args[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--user") {
      options.user = String(args[index + 1] || "");
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log([
    "Usage: npm run channel:send-file -- --path /absolute/path [--user <wechatUserId>]",
    "",
    "Arguments:",
    "  --path /absolute/path    local file to send back to the current WeChat chat",
    "  --user <wechatUserId>   optional, overrides the default receiver",
    "",
    "Example:",
    "  npm run channel:send-file -- --path /Users/name/project/README.md",
  ].join("\n"));
}

module.exports = { runChannelSendFileCommand };
