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
        action: "app.shared_start",
        summary: "启动共享 app-server 与共享微信桥接",
        terminal: ["shared start"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.shared_open",
        summary: "接入当前微信绑定的共享线程",
        terminal: ["shared open"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.shared_status",
        summary: "查看共享 app-server 与共享桥接状态",
        terminal: ["shared status"],
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
        action: "thread.reread",
        summary: "让当前线程重新读取最新 instructions",
        terminal: [],
        weixin: ["/reread"],
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
        terminal: ["channel send-file"],
        terminalGroup: "channel",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.categories",
        summary: "查看当前可用的 timeline 分类和 eventNode",
        terminal: ["timeline categories"],
        terminalGroup: "timeline",
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
    "  npm run shared:start   默认启动共享 app-server 与共享微信桥接",
    "  npm run shared:open    默认接入当前微信绑定的共享线程",
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
      return [
        "npm run reminder:write -- <args>",
        "",
        "参数：",
        "  --delay 30s|10m|1h30m|2d4h",
        "  --at 2026-04-07T21:30+08:00 | 2026-04-07 21:30",
        "  --text \"提醒内容\"",
        "  --user <wechatUserId>  可选",
      ].join("\n");
    case "diary":
      return [
        "npm run diary:write -- <args>",
        "",
        "参数：",
        "  --text \"内容\"",
        "  --title \"标题\"        只影响条目标题，不决定落到哪一天",
        "  --date YYYY-MM-DD     决定写入哪个日记文件",
        "  --time HH:mm          可选，覆盖条目时间",
        "",
        "示例：",
        "  npm run diary:write -- --date 2026-04-06 --title \"4.6\" --text \"内容\"",
      ].join("\n");
    case "channel":
      return [
        "npm run channel:send-file -- --path /绝对路径 [--user <wechatUserId>]",
        "",
        "参数：",
        "  --path /绝对路径         要发回当前微信聊天的本地文件",
        "  --user <wechatUserId>   可选，覆盖默认接收用户",
      ].join("\n");
    case "system":
      return "npm run system:send -- <args> / npm run system:checkin";
    case "timeline":
      return [
        "npm run timeline:categories / npm run timeline:write -- <args> / npm run timeline:build / npm run timeline:serve / npm run timeline:dev / npm run timeline:screenshot -- --send",
        "",
        "补充：",
        "  如果不确定 categoryId / subcategoryId / eventNodeId，先执行 npm run timeline:categories",
        "  timeline 截图稳定入口是 npm run timeline:screenshot -- --send，它会把任务交给当前微信桥执行",
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
      return "npm run channel:send-file -- --path /绝对路径";
    case "system send":
      return "npm run system:send -- <args>";
    case "system checkin-poller":
      return "npm run system:checkin";
    case "timeline write":
      return "npm run timeline:write -- <args>";
    case "timeline categories":
      return "npm run timeline:categories";
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
