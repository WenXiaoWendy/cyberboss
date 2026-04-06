const COMMAND_GROUPS = [
  {
    id: "lifecycle",
    label: "启动与诊断",
    actions: [
      {
        action: "app.login",
        summary: "发起微信扫码登录并保存账号",
        terminal: ["login"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.accounts",
        summary: "查看本地已保存账号",
        terminal: ["accounts"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.start",
        summary: "启动当前 channel/runtime 主循环",
        terminal: ["start"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.doctor",
        summary: "打印当前配置、边界和线程状态",
        terminal: ["doctor"],
        weixin: [],
        status: "active",
      },
      {
        action: "system.send",
        summary: "向内部系统队列写入一条不可见触发消息",
        terminal: ["system send"],
        terminalGroup: "system",
        weixin: [],
        status: "active",
      },
      {
        action: "system.checkin_poller",
        summary: "按随机间隔写入主动 check-in 触发",
        terminal: ["system checkin-poller"],
        terminalGroup: "system",
        weixin: [],
        status: "active",
      },
    ],
  },
  {
    id: "workspace",
    label: "项目与线程",
    actions: [
      {
        action: "workspace.bind",
        summary: "绑定当前聊天使用的项目目录",
        terminal: [],
        weixin: ["/bind"],
        status: "active",
      },
      {
        action: "workspace.status",
        summary: "查看当前项目、线程、模型与上下文使用情况",
        terminal: [],
        weixin: ["/status"],
        status: "active",
      },
      {
        action: "thread.new",
        summary: "切到新线程草稿",
        terminal: [],
        weixin: ["/new"],
        status: "active",
      },
      {
        action: "thread.switch",
        summary: "切换到指定线程",
        terminal: [],
        weixin: ["/switch <threadId>"],
        status: "active",
      },
      {
        action: "thread.stop",
        summary: "停止当前线程中的运行",
        terminal: [],
        weixin: ["/stop"],
        status: "active",
      },
    ],
  },
  {
    id: "approval",
    label: "授权与控制",
    actions: [
      {
        action: "approval.accept_once",
        summary: "允许当前待处理的授权请求一次",
        terminal: [],
        weixin: ["/yes"],
        status: "active",
      },
      {
        action: "approval.accept_workspace",
        summary: "在当前项目内持续允许同前缀命令",
        terminal: [],
        weixin: ["/always"],
        status: "active",
      },
      {
        action: "approval.reject_once",
        summary: "拒绝当前待处理的授权请求",
        terminal: [],
        weixin: ["/no"],
        status: "active",
      },
    ],
  },
  {
    id: "capabilities",
    label: "能力集成",
    actions: [
      {
        action: "model.inspect",
        summary: "查看当前模型",
        terminal: [],
        weixin: ["/model"],
        status: "active",
      },
      {
        action: "model.select",
        summary: "切换到指定模型",
        terminal: [],
        weixin: ["/model <id>"],
        status: "active",
      },
      {
        action: "channel.send_file",
        summary: "将文件作为附件发送回当前聊天",
        terminal: [],
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.write",
        summary: "将当前上下文写入时间轴",
        terminal: ["timeline write"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.build",
        summary: "构建时间轴静态页面",
        terminal: ["timeline build"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.serve",
        summary: "启动时间轴静态页面服务",
        terminal: ["timeline serve"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.dev",
        summary: "启动时间轴热更新开发服务",
        terminal: ["timeline dev"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.screenshot",
        summary: "截图时间轴页面",
        terminal: ["timeline screenshot"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "reminder.create",
        summary: "创建提醒并交给调度层处理",
        terminal: ["reminder write"],
        terminalGroup: "reminder",
        weixin: [],
        status: "active",
      },
      {
        action: "diary.append",
        summary: "追加一条日记记录",
        terminal: ["diary write"],
        terminalGroup: "diary",
        weixin: [],
        status: "active",
      },
      {
        action: "app.help",
        summary: "查看当前通道可用命令",
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
    "用法: npm run <script>",
    "",
    "当前终端命令：",
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
    lines.push("规划中的终端子命令：");
    for (const group of plannedGroups) {
      lines.push(`- ${group.name}`);
      for (const action of group.actions) {
        lines.push(`  ${action.terminal.join(", ")}  ${action.summary}`);
      }
    }
  }

  lines.push("");
  lines.push("微信命令映射与后续能力动作请看 README / docs。");
  return lines.join("\n");
}

function buildWeixinHelpText() {
  const lines = ["当前可用命令："];
  for (const group of COMMAND_GROUPS) {
    const activeActions = group.actions.filter((action) => action.status === "active" && action.weixin.length);
    if (!activeActions.length) {
      continue;
    }
    lines.push("");
    lines.push(`${group.label}：`);
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
    `用法: ${buildTopicUsage(normalizedTopic)}`,
    "",
    hasPlannedOnly
      ? `当前 ${normalizedTopic} 命令仍在接入中，计划中的子命令：`
      : `当前 ${normalizedTopic} 命令：`,
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
      return "npm run reminder:write -- <args>";
    case "diary":
      return "npm run diary:write -- <args>";
    case "system":
      return "npm run system:send -- <args> / npm run system:checkin";
    case "timeline":
      return "npm run timeline:write -- <args> / npm run timeline:build / npm run timeline:serve / npm run timeline:dev / npm run timeline:screenshot";
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
    case "doctor":
    case "help":
      return `npm run ${normalized}`;
    case "reminder write":
      return "npm run reminder:write -- <args>";
    case "diary write":
      return "npm run diary:write -- <args>";
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
      return "npm run timeline:screenshot";
    default:
      return normalized;
  }
}
