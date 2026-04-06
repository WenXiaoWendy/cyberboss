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
        status: "planned",
      },
      {
        action: "workspace.where",
        summary: "查看当前项目、线程和运行态",
        terminal: [],
        weixin: ["/where"],
        status: "planned",
      },
      {
        action: "thread.new",
        summary: "切到新线程草稿",
        terminal: [],
        weixin: ["/new"],
        status: "planned",
      },
      {
        action: "thread.stop",
        summary: "停止当前线程中的运行",
        terminal: [],
        weixin: ["/stop"],
        status: "planned",
      },
    ],
  },
  {
    id: "approval",
    label: "授权与控制",
    actions: [
      {
        action: "approval.accept",
        summary: "允许当前待处理的授权请求",
        terminal: [],
        weixin: ["/ok"],
        status: "planned",
      },
      {
        action: "approval.reject",
        summary: "拒绝当前待处理的授权请求",
        terminal: [],
        weixin: ["/no"],
        status: "planned",
      },
    ],
  },
  {
    id: "capabilities",
    label: "能力集成",
    actions: [
      {
        action: "timeline.write",
        summary: "将当前上下文写入时间轴",
        terminal: [],
        weixin: [],
        status: "planned",
      },
      {
        action: "reminder.create",
        summary: "创建提醒并交给调度层处理",
        terminal: [],
        weixin: [],
        status: "planned",
      },
      {
        action: "diary.append",
        summary: "追加一条日记记录",
        terminal: [],
        weixin: [],
        status: "planned",
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

  lines.push("");
  lines.push("微信命令映射与后续能力动作请看 README / docs。");
  return lines.join("\n");
}

module.exports = {
  buildTerminalHelpText,
  listCommandGroups,
};
