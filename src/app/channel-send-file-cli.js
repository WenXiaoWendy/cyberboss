async function runChannelSendFileCommand(app) {
  const args = process.argv.slice(4);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const options = parseArgs(args);
  if (!options.path) {
    throw new Error("缺少 --path，指定要发回微信的本地文件路径");
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
    throw new Error(`未知参数: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log([
    "用法: npm run channel:send-file -- --path /绝对路径 [--user <wechatUserId>]",
    "",
    "参数：",
    "  --path /绝对路径         要发回当前微信聊天的本地文件",
    "  --user <wechatUserId>   可选，覆盖默认接收用户",
    "",
    "示例：",
    "  npm run channel:send-file -- --path /Users/name/project/README.md",
  ].join("\n"));
}

module.exports = { runChannelSendFileCommand };
