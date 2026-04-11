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
    "Usage: npm run <script>",
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
  const lines = ["Available commands:"];
  for (const group of COMMAND_GROUPS) {
    const activeActions = group.actions.filter((action) => action.status === "active" && action.weixin.length);
    if (!activeActions.length) {
      continue;
    }
    lines.push("");
    lines.push(`${group.label}:`);
    for (const action of activeActions) {
      lines.push(`- ${action.weixin.join(", ")}  ${action.summary}`);
    }
  }
  return lines.join("\n");
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
  buildTerminalHelpText,
  buildTerminalTopicHelp,
  buildWeixinHelpText,
  isPlannedTerminalTopic,
  listCommandGroups,
};

function formatTerminalExamples(action) {
  const terminal = Array.isArray(action?.terminal) ? action.terminal : [];
  if (!terminal.length) {
    return "";
  }
  return terminal.map((commandText) => toNpmRunExample(commandText)).join(", ");
}

function buildTopicUsage(topic) {
  switch (topic) {
    case "reminder":
      return [
        "npm run reminder:write -- <args>",
        "",
        "Arguments:",
        "  --delay 30s|10m|1h30m|2d4h",
        "  --at 2026-04-07T21:30+08:00 | 2026-04-07 21:30",
        "  --text \"Reminder text\"",
        "  --stdin                    prefer this for long text or text containing quotes",
        "  --user <wechatUserId>      optional",
        "",
        "Examples:",
        "  npm run reminder:write -- --delay 30m --text \"Reminder text\"",
        "  printf '%s\\n' 'Ask again in 20 minutes if she still has not come back.' | npm run reminder:write -- --delay 20m --stdin",
      ].join("\n");
    case "diary":
      return [
        "npm run diary:write -- <args>",
        "",
        "Arguments:",
        "  --text \"Content\"",
        "  --title \"Title\"      only affects the entry title, not the target date file",
        "  --date YYYY-MM-DD     decides which diary file to write into",
        "  --time HH:mm          optional, overrides the entry time",
        "",
        "Example:",
        "  npm run diary:write -- --date 2026-04-06 --title \"4.6\" --text \"Content\"",
      ].join("\n");
    case "channel":
      return [
        "npm run channel:send-file -- --path /absolute/path [--user <wechatUserId>]",
        "",
        "Arguments:",
        "  --path /absolute/path     local file to send back to the current WeChat chat",
        "  --user <wechatUserId>    optional, overrides the default receiver",
      ].join("\n");
    case "system":
      return "npm run system:send -- <args> / npm run system:checkin";
    case "timeline":
      return [
        "npm run timeline:write -- <args> / npm run timeline:build / npm run timeline:serve / npm run timeline:dev / npm run timeline:screenshot -- --send",
        "",
        "Notes:",
        "  The stable timeline screenshot entrypoint is `npm run timeline:screenshot -- --send`. It hands the job to the current WeChat bridge.",
      ].join("\n");
    default:
      return "npm run <script>";
  }
}

function toNpmRunExample(commandText) {
  const normalized = typeof commandText === "string" ? commandText.trim() : "";
  switch (normalized) {
    case "login":
    case "accounts":
    case "start":
    case "shared start":
    case "shared open":
    case "shared status":
    case "doctor":
    case "help":
      return `npm run ${normalized.replace(" ", ":")}`;
    case "start --checkin":
      return "npm run start:checkin";
    case "reminder write":
      return "npm run reminder:write -- <args>";
    case "diary write":
      return "npm run diary:write -- <args>";
    case "channel send-file":
      return "npm run channel:send-file -- --path /absolute/path";
    case "system send":
      return "npm run system:send -- <args>";
    case "system checkin-poller":
      return "npm run system:checkin";
    case "timeline write":
      return "npm run timeline:write -- <args>";
    case "timeline build":
      return "npm run timeline:build";
    case "timeline serve":
      return "npm run timeline:serve";
    case "timeline dev":
      return "npm run timeline:dev";
    case "timeline screenshot":
      return "npm run timeline:screenshot -- --send";
    default:
      return normalized;
  }
}
