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
        status: "planned",
      },
      {
        action: "model.select",
        summary: "切换到指定模型",
        terminal: [],
        weixin: ["/model <id>"],
        status: "planned",
      },
      {
        action: "channel.send_file",
        summary: "将工作区文件发送回当前聊天",
        terminal: [],
        weixin: ["/send <path>"],
        status: "planned",
      },
      {
        action: "timeline.write",
        summary: "将当前上下文写入时间轴",
        terminal: ["timeline write"],
        terminalGroup: "timeline",
        weixin: [],
        status: "planned",
      },
      {
        action: "timeline.build",
        summary: "构建时间轴静态页面",
        terminal: ["timeline build"],
        terminalGroup: "timeline",
        weixin: [],
        status: "planned",
      },
      {
        action: "timeline.serve",
        summary: "启动时间轴静态页面服务",
        terminal: ["timeline serve"],
        terminalGroup: "timeline",
        weixin: [],
        status: "planned",
      },
      {
        action: "timeline.screenshot",
        summary: "截图时间轴页面",
        terminal: ["timeline screenshot"],
        terminalGroup: "timeline",
        weixin: [],
        status: "planned",
      },
      {
        action: "reminder.create",
        summary: "创建提醒并交给调度层处理",
        terminal: ["reminder write"],
        terminalGroup: "reminder",
        weixin: [],
        status: "planned",
      },
      {
        action: "diary.append",
        summary: "追加一条日记记录",
        terminal: ["diary write"],
        terminalGroup: "diary",
        weixin: [],
        status: "planned",
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
    "用法: cyberboss <命令>",
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
      lines.push(`  ${action.terminal.join(", ")}  ${action.summary}`);
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

function buildTerminalTopicHelp(topic) {
  const normalizedTopic = normalizeTopic(topic);
  const actions = COMMAND_GROUPS
    .flatMap((group) => group.actions)
    .filter((action) => normalizeTopic(action.terminalGroup) === normalizedTopic && action.terminal.length);

  if (!actions.length) {
    return "";
  }

  const lines = [
    `用法: cyberboss ${normalizedTopic} <子命令>`,
    "",
    `当前 ${normalizedTopic} 命令仍在接入中，计划中的子命令：`,
  ];
  for (const action of actions) {
    lines.push(`- ${action.terminal.join(", ")}  ${action.summary}`);
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
    if (!action.terminal.length || !action.terminalGroup) {
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
  isPlannedTerminalTopic,
  listCommandGroups,
};
