const path = require("path");

const COMMAND_GROUPS = [
  {
    id: "lifecycle",
    label: "Lifecycle & Diagnostics",
    actions: [
      {
        action: "app.login",
        summary: "Start WeChat QR login and save the account",
        terminal: ["login"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.accounts",
        summary: "List locally saved accounts",
        terminal: ["accounts"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.start",
        summary: "Start the current channel/runtime main loop",
        terminal: ["start"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.shared_start",
        summary: "Start the shared app-server and shared WeChat bridge",
        terminal: ["shared start"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.shared_open",
        summary: "Attach to the shared thread currently bound in WeChat",
        terminal: ["shared open"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.shared_status",
        summary: "Show the shared app-server and bridge status",
        terminal: ["shared status"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.doctor",
        summary: "Print current config, boundaries, and thread state",
        terminal: ["doctor"],
        weixin: [],
        status: "active",
      },
      {
        action: "system.send",
        summary: "Write an invisible trigger message into the internal system queue",
        terminal: ["system send"],
        terminalGroup: "system",
        weixin: [],
        status: "active",
      },
      {
        action: "system.checkin_poller",
        summary: "Emit proactive check-in triggers at random intervals",
        terminal: ["system checkin-poller"],
        terminalGroup: "system",
        weixin: [],
        status: "active",
      },
    ],
  },
  {
    id: "workspace",
    label: "Workspace & Thread",
    actions: [
      {
        action: "workspace.bind",
        summary: "Bind the current chat to a workspace directory",
        terminal: [],
        weixin: ["/bind"],
        status: "active",
      },
      {
        action: "workspace.status",
        summary: "Show the current workspace, thread, model, and context usage",
        terminal: [],
        weixin: ["/status"],
        status: "active",
      },
      {
        action: "thread.new",
        summary: "Switch to a fresh thread draft",
        terminal: [],
        weixin: ["/new"],
        status: "active",
      },
      {
        action: "thread.reread",
        summary: "Make the current thread reread the latest instructions",
        terminal: [],
        weixin: ["/reread"],
        status: "active",
      },
      {
        action: "thread.compact",
        summary: "Compact the current thread context",
        terminal: [],
        weixin: ["/compact"],
        status: "active",
      },
      {
        action: "thread.switch",
        summary: "Switch to a specific thread",
        terminal: [],
        weixin: ["/switch <threadId>"],
        status: "active",
      },
      {
        action: "thread.stop",
        summary: "Stop the current run inside the thread",
        terminal: [],
        weixin: ["/stop"],
        status: "active",
      },
      {
        action: "system.checkin_range",
        summary: "Reset the proactive check-in range in minutes",
        terminal: [],
        weixin: ["/checkin <min>-<max>"],
        status: "active",
      },
      {
        action: "channel.chunk_min",
        summary: "Adjust the minimum short-chunk merge size for WeChat replies",
        terminal: [],
        weixin: ["/chunk <number>"],
        status: "active",
      },
    ],
  },
  {
    id: "approval",
    label: "Approvals & Control",
    actions: [
      {
        action: "approval.accept_once",
        summary: "Allow the current approval request once",
        terminal: [],
        weixin: ["/yes"],
        status: "active",
      },
      {
        action: "approval.accept_workspace",
        summary: "Keep allowing matching command prefixes in the current workspace",
        terminal: [],
        weixin: ["/always"],
        status: "active",
      },
      {
        action: "approval.reject_once",
        summary: "Deny the current approval request",
        terminal: [],
        weixin: ["/no"],
        status: "active",
      },
    ],
  },
  {
    id: "capabilities",
    label: "Capabilities",
    actions: [
      {
        action: "model.inspect",
        summary: "Inspect the current model",
        terminal: [],
        weixin: ["/model"],
        status: "active",
      },
      {
        action: "model.select",
        summary: "Switch to a specific model",
        terminal: [],
        weixin: ["/model <id>"],
        status: "active",
      },
      {
        action: "channel.send_file",
        summary: "Send a local file back to the current chat as an attachment",
        terminal: ["channel send-file"],
        terminalGroup: "channel",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.write",
        summary: "Write the current context into timeline",
        terminal: ["timeline write"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.build",
        summary: "Build the static timeline site",
        terminal: ["timeline build"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.serve",
        summary: "Start the static timeline site server",
        terminal: ["timeline serve"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.dev",
        summary: "Start the hot-reload timeline dev server",
        terminal: ["timeline dev"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.screenshot",
        summary: "Capture a timeline screenshot",
        terminal: ["timeline screenshot"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "reminder.create",
        summary: "Create a reminder and hand it to the scheduler",
        terminal: ["reminder write"],
        terminalGroup: "reminder",
        weixin: [],
        status: "active",
      },
      {
        action: "diary.append",
        summary: "Append a diary entry",
        terminal: ["diary write"],
        terminalGroup: "diary",
        weixin: [],
        status: "active",
      },
      {
        action: "app.star",
        summary: "Star the project on GitHub",
        terminal: [],
        weixin: ["/star"],
        status: "active",
      },
      {
        action: "app.help",
        summary: "Show currently available commands for this channel",
        terminal: ["help"],
        weixin: ["/help"],
        status: "active",
      },
    ],
  },
];

function listCommandGroups() {
  return COMMAND_GROUPS.map((group) => ({
    ...group,
    actions: group.actions.map((action) => ({ ...action })),
  }));
}

function buildTerminalHelpText() {
  const lines = [
    "Usage: cyberboss <command>",
    "",
    "Current terminal commands:",
    "  npm run shared:start   default entrypoint for the shared app-server and WeChat bridge",
    "  npm run shared:open    default entrypoint for the shared thread currently bound in WeChat",
  ];

  for (const group of COMMAND_GROUPS) {
    const activeActions = group.actions.filter((action) => action.status === "active" && action.terminal.length);
    if (!activeActions.length) {
      continue;
    }
    lines.push(`- ${group.label}`);
    for (const action of activeActions) {
      lines.push(`  ${formatTerminalExamples(action)}  ${action.summary}`);
    }
  }

  const plannedGroups = collectPlannedTerminalGroups();
  if (plannedGroups.length) {
    lines.push("");
    lines.push("Planned terminal subcommands:");
    for (const group of plannedGroups) {
      lines.push(`- ${group.name}`);
      for (const action of group.actions) {
        lines.push(`  ${action.terminal.join(", ")}  ${action.summary}`);
      }
    }
  }

  lines.push("");
  lines.push("See the README and docs for WeChat command mappings and capability actions.");
  return lines.join("\n");
}

function buildWeixinHelpText() {
  const lines = ["💡 Available commands:"];
  for (const group of COMMAND_GROUPS) {
    const activeActions = group.actions.filter((action) => action.status === "active" && action.weixin.length);
    if (!activeActions.length) {
      continue;
    }
    lines.push("");
    lines.push(`${groupEmoji(group.id)} 【${group.label}】`);
    for (const action of activeActions) {
      lines.push(`  ${actionEmoji(action)} ${action.weixin.join(", ")} — ${action.summary}`);
    }
  }
  return lines.join("\n");
}

function groupEmoji(groupId) {
  switch (groupId) {
    case "lifecycle": return "🔄";
    case "workspace": return "📁";
    case "approval": return "🔐";
    case "capabilities": return "⚡️";
    default: return "•";
  }
}

function actionEmoji(action) {
  switch (action.action) {
    case "workspace.bind": return "📍";
    case "workspace.status": return "📊";
    case "thread.new": return "🆕";
    case "thread.reread": return "🔄";
    case "thread.compact": return "🗜️";
    case "thread.switch": return "🔀";
    case "thread.stop": return "⏹️";
    case "system.checkin_range": return "⏰";
    case "approval.accept_once": return "✅";
    case "approval.accept_workspace": return "💡";
    case "approval.reject_once": return "❌";
    case "model.inspect":
    case "model.select": return "🤖";
    case "app.help": return "❓";
    case "app.star": return "⭐️";
    default: return "•";
  }
}

function buildTerminalTopicHelp(topic) {
  const normalizedTopic = normalizeTopic(topic);
  const actions = COMMAND_GROUPS
    .flatMap((group) => group.actions)
    .filter((action) => normalizeTopic(action.terminalGroup) === normalizedTopic && action.terminal.length);

  if (!actions.length) {
    return "";
  }

  const hasPlannedOnly = actions.every((action) => action.status === "planned");
  const lines = [
    `Usage: ${buildTopicUsage(normalizedTopic)}`,
    "",
    hasPlannedOnly
      ? `The ${normalizedTopic} command group is still being wired in. Planned subcommands:`
      : `Current ${normalizedTopic} commands:`,
  ];
  for (const action of actions) {
    lines.push(`- ${formatTerminalExamples(action)}  ${action.summary}`);
  }
  return lines.join("\n");
}

function isPlannedTerminalTopic(topic) {
  const normalizedTopic = normalizeTopic(topic);
  return COMMAND_GROUPS
    .flatMap((group) => group.actions)
    .some((action) => normalizeTopic(action.terminalGroup) === normalizedTopic && action.terminal.length);
}

function collectPlannedTerminalGroups() {
  const grouped = new Map();
  for (const action of COMMAND_GROUPS.flatMap((group) => group.actions)) {
    if (!action.terminal.length || !action.terminalGroup || action.status !== "planned") {
      continue;
    }
    const key = action.terminalGroup;
    if (!grouped.has(key)) {
      grouped.set(key, { name: key, actions: [] });
    }
    grouped.get(key).actions.push(action);
  }
  return Array.from(grouped.values());
}

function normalizeTopic(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

module.exports = {
  buildAgentCommandGuide,
  buildAgentCommandReminder,
  buildTerminalHelpText,
  buildTerminalTopicHelp,
  buildWeixinHelpText,
  isPlannedTerminalTopic,
  listCommandGroups,
};

function buildAgentCommandReminder() {
  return "For local commands, you must strictly follow workspace help only. Do not invent variants.";
}

function buildAgentCommandGuide(topics = []) {
  const normalizedTopics = Array.from(new Set(
    (Array.isArray(topics) ? topics : [])
      .map((value) => normalizeTopic(value))
      .filter(Boolean)
  ));
  if (!normalizedTopics.length) {
    return buildAgentCommandReminder();
  }

  const sections = [buildAgentCommandReminder()];
  for (const topic of normalizedTopics) {
    sections.push("", `${topic.toUpperCase()} COMMAND HELP`, buildScopedTopicHelp(topic));
  }
  return sections.join("\n").trim();
}

function formatTerminalExamples(action) {
  const terminal = Array.isArray(action?.terminal) ? action.terminal : [];
  if (!terminal.length) {
    return "";
  }
  return terminal.map((commandText) => toTerminalCommandExample(commandText)).join(", ");
}

function buildTopicUsage(topic) {
  switch (topic) {
    case "reminder":
      return [
        "cyberboss reminder write <args>",
        "",
        "Arguments:",
        "  --delay 30s|10m|1h30m|2d4h",
        "  --at 2026-04-07T21:30+08:00 | 2026-04-07 21:30",
        "  --text \"Reminder text\"",
        "  --text-file /absolute/path prefer this for long text or text containing quotes",
        "  --stdin                    fallback if you truly need stdin",
        "  --user <wechatUserId>      optional",
        "",
        "Examples:",
        "  cyberboss reminder write --delay 30m --text \"Reminder text\"",
        "  cyberboss reminder write --delay 20m --text-file /absolute/path/to/reminder.txt",
      ].join("\n");
    case "diary":
      return [
        "cyberboss diary write <args>",
        "",
        "Arguments:",
        "  --text \"Content\"",
        "  --text-file /absolute/path",
        "  --title \"Title\"      only affects the entry title, not the target date file",
        "  --date YYYY-MM-DD     decides which diary file to write into",
        "  --time HH:mm          optional, overrides the entry time",
        "",
        "Example:",
        "  cyberboss diary write --date 2026-04-06 --title \"4.6\" --text-file /absolute/path/to/entry.md",
      ].join("\n");
    case "channel":
      return [
        "cyberboss channel send-file --path /absolute/path [--user <wechatUserId>]",
        "",
        "Arguments:",
        "  --path /absolute/path     local file to send back to the current WeChat chat",
        "  --user <wechatUserId>    optional, overrides the default receiver",
      ].join("\n");
    case "system":
      return "cyberboss system send <args> / cyberboss system checkin-poller";
    case "timeline":
      return [
        "cyberboss timeline write <args> / cyberboss timeline build [--locale <id>] / cyberboss timeline serve [--locale <id>] / cyberboss timeline dev [--locale <id>] / cyberboss timeline screenshot --send [--locale <id>]",
        "",
        "Common flags:",
        "  --locale en|zh-CN   applies to build, serve, dev, and screenshot",
        "  --send              only for screenshot; queue the image for the current WeChat bridge to send",
        "",
        "Notes:",
        "  `timeline write` expects a JSON object with `events: [...]`, not a bare array or `{\"title\":\"...\"}` placeholder.",
        "  each event must include `startAt`, `endAt`, and either `eventNodeId` or a resolvable `subcategoryId` (preferably with `categoryId`).",
        "  The stable timeline screenshot entrypoint is `cyberboss timeline screenshot --send`. It hands the job to the current WeChat bridge.",
      ].join("\n");
    default:
      return "cyberboss <command>";
  }
}

function buildScopedTopicHelp(topic) {
  switch (normalizeTopic(topic)) {
    case "reminder":
      return [
        `${buildAgentCommandInvocation(["reminder", "write", "--delay", "30m", "--text", "Reminder text"])}`,
        `${buildAgentCommandInvocation(["reminder", "write", "--delay", "20m", "--text-file", "/absolute/path/to/reminder.txt"])}   long text`,
      ].join("\n");
    case "diary":
      return [
        `${buildAgentCommandInvocation(["diary", "write", "--title", "Title", "--text", "Content"])}`,
        `${buildAgentCommandInvocation(["diary", "write", "--date", "YYYY-MM-DD", "--title", "Title", "--text-file", "/absolute/path/to/entry.md"])}   long text`,
      ].join("\n");
    case "timeline":
      return [
        `${buildAgentCommandInvocation(["timeline", "write", "--date", "YYYY-MM-DD", "--events-json", "{\"events\":[{\"startAt\":\"2026-04-12T09:00:00+08:00\",\"endAt\":\"2026-04-12T09:30:00+08:00\",\"title\":\"Breakfast\",\"categoryId\":\"life\",\"subcategoryId\":\"life.meal\"}]}"])} `,
        "JSON must be an object with `events`; each event needs `startAt`, `endAt`, and either `eventNodeId` or a resolvable `subcategoryId`.",
        `${buildAgentCommandInvocation(["timeline", "write", "--date", "YYYY-MM-DD", "--events-file", "/absolute/path/to/events.json"])}   large payload`,
        `${buildAgentCommandInvocation(["timeline", "serve", "--locale", "zh-CN"])} / ${buildAgentCommandInvocation(["timeline", "screenshot", "--send", "--locale", "en"])}   locale-sensitive`,
      ].join("\n");
    case "channel":
      return buildAgentCommandInvocation(["channel", "send-file", "--path", "/absolute/path"]);
    case "system":
      return [
        `${buildAgentCommandInvocation(["system", "send", "--text", "System message", "--workspace", "/absolute/path"])}`,
        `${buildAgentCommandInvocation(["system", "checkin-poller"])}   poller only`,
      ].join("\n");
    default:
      return buildTopicUsage(topic);
  }
}

function toTerminalCommandExample(commandText) {
  const normalized = typeof commandText === "string" ? commandText.trim() : "";
  switch (normalized) {
    case "login":
    case "accounts":
    case "start":
    case "doctor":
    case "help":
      return `cyberboss ${normalized}`;
    case "shared start":
    case "shared open":
    case "shared status":
      return `npm run ${normalized.replace(" ", ":")}`;
    case "start --checkin":
      return "cyberboss start --checkin";
    case "reminder write":
      return "cyberboss reminder write <args>";
    case "diary write":
      return "cyberboss diary write <args>";
    case "channel send-file":
      return "cyberboss channel send-file --path /absolute/path";
    case "system send":
      return "cyberboss system send <args>";
    case "system checkin-poller":
      return "cyberboss system checkin-poller";
    case "timeline write":
      return "cyberboss timeline write <args>";
    case "timeline build":
      return "cyberboss timeline build";
    case "timeline serve":
      return "cyberboss timeline serve";
    case "timeline dev":
      return "cyberboss timeline dev";
    case "timeline screenshot":
      return "cyberboss timeline screenshot --send";
    default:
      return normalized;
  }
}

function getAgentCyberbossExecutable() {
  const executable = process.platform === "win32"
    ? path.resolve(__dirname, "..", "..", "bin", "cyberboss.cmd")
    : path.resolve(__dirname, "..", "..", "bin", "cyberboss");
  return executable;
}

function buildAgentCommandInvocation(args = []) {
  const executable = getAgentCyberbossExecutable();
  const normalizedArgs = Array.isArray(args) ? args.map((value) => String(value ?? "")) : [];
  if (process.platform === "win32") {
    const innerCommand = [executable, ...normalizedArgs].map(quoteWindowsCmdArg).join(" ");
    return `cmd /d /s /c ${quoteWindowsCmdArg(innerCommand)}`;
  }
  return [executable, ...normalizedArgs].map(quotePosixShellArg).join(" ");
}

function quotePosixShellArg(value) {
  const text = String(value ?? "");
  if (!text.length) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, `'\"'\"'`)}'`;
}

function quoteWindowsCmdArg(value) {
  const text = String(value ?? "");
  if (!text.length) {
    return "\"\"";
  }
  if (!/[\s"]/u.test(text)) {
    return text;
  }
  const escaped = text.replace(/(\\*)"/g, "$1$1\\\"");
  return `"${escaped.replace(/(\\+)$/g, "$1$1")}"`;
}
