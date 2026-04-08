<div align="center">

# 《霸道总裁爱上患有 ADHD 的我》
## 基于 Codex 的微信桥接系统：Cyberboss

> “你尽管在多巴胺里逃避，但我永远会在下一个时间戳抓到你。”

[![Node >=22](https://img.shields.io/badge/Node-22%2B-3C873A)](./package.json)
[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-b31b1b)](./LICENSE)
[![Runtime-Codex](https://img.shields.io/badge/Runtime-Codex-111827)](#technical-stack)
[![Bridge-Weixin](https://img.shields.io/badge/Bridge-Weixin-07C160)](#technical-stack)
[![Timeline-Enabled](https://img.shields.io/badge/Timeline-Enabled-8b5cf6)](#core-features)

<p>
  <a href="#user-guide">用户使用</a> ·
  <a href="#agent-guide">Agent 接入</a> ·
  <a href="#data-dir">本地数据</a> ·
  <a href="#faq">FAQ</a>
</p>

</div>

<p align="center">
  <img src="./docs/images/chat-example-1.jpg" alt="Cyberboss 示例对话 1" width="23%" />
  <img src="./docs/images/chat-example-2.jpg" alt="Cyberboss 示例对话 2" width="23%" />
  <img src="./docs/images/chat-example-3.jpg" alt="Cyberboss 示例对话 3" width="23%" />
  <img src="./docs/images/chat-example-4.jpg" alt="Cyberboss 示例对话 4" width="23%" />
</p>

Cyberboss 不是另一个平庸的番茄钟，也不是一个只会堆积任务的待办清单。

它是一个将 Codex 深度接入微信的 Agent Bridge。它的存在不是为了“提醒你开始”，而是直接化身为那个拥有绝对时间感、盯死进度、在你消失太久时会主动破屏而出的“赛博老板”。

## 为什么需要 Cyberboss？

对于 ADHD 或任何需要高强度外部监管的人来说，传统工具最大的 Bug 在于：它们都寄希望于你的“主动性”。但当内在驱动力失灵时，任何需要手动开启的 App 都是摆设。

Cyberboss 的逻辑是管理权的让渡：

- 无需主动点开始
  它就在你的微信里，盯着你的每一句话。
- 不可逃避的感知
  它清楚你沉默的每一分钟意味着什么。
- 真实的外部反馈
  既然你无法自律，那就把管理权交给一个永远在线、拥有完美记忆、且会持续追踪上下文的 AI。

<a id="core-features"></a>
## 核心功能：全自动的赛博监管

1. 绝对时间感 (Omniscient Time)
每一条微信输入在进入 runtime 前，都会被自动打上本地时间戳。模型不再只是处理文本，它在处理“时间流”。它知道你上一秒在信誓旦旦，也知道你接下来的三个小时在人间蒸发。

2. 生活轨迹自动化报表 (The Ledger of Life)
基于已知的消息时间戳，它会像审计员一样持续补全你全天事件的开始、结束和时长，自动将细碎的聊天记录脱水、重构为结构化时间轴，并定期向你输出“处刑报表”。

3. 随机轮询唤醒 (Stochastic Pulse)
系统会在随机频率内主动戳醒模型。它会根据当前上下文自主判断：是该温柔提醒、严厉催促、默默写日记，还是调用工具查看你的状态。这种不可预测的“查岗”感，是杀掉 ADHD 拖延症的良药。

4. 跨时空自我唤醒 (Local Reminder Queue)
Reminder 队列不是给用户设的闹钟，而是模型留给未来自己的伏笔。

> “约定 10:00 起床，10:05 他若没收到你的消息，将自动调用米家 MCP 强行拉开窗帘并放歌。”

5. 零成本本地日志 (Zero-Token Diary)
它会将真正值得留下的生活痕迹沉淀到本地，不依赖第三方云服务，不烧额外上下文，却能留住你们之间最真实的连接。

## 也可以单独使用 Timeline

如果你对 `Cyberboss` 里最感兴趣的是“生活轨迹自动化报表”这一层，那么也可以直接把时间轴能力单独拿出去用：

- 项目地址：[WenXiaoWendy/timeline-for-agent](https://github.com/WenXiaoWendy/timeline-for-agent)
- 它本身就是独立项目，不依赖微信桥接才能工作
- 如果你不想使用 Codex，也完全可以把 `timeline-for-agent` 接进你自己的 agent、bot 或自动化系统里

`Cyberboss` 的时间轴能力本质上也是构建在 `timeline-for-agent` 之上，只是这里额外把它接进了微信、提醒、日记和随机轮询这整套生活监管链路里。

<a id="technical-stack"></a>
## 技术实现

- **Core**
  Codex runtime 与共享 `codex app-server`，负责承接微信消息、维持线程状态、执行工具与审批流。
- **Bridge**
  微信 HTTP bridge，支持长轮询同步，把微信侧输入、输出、文件和状态变化接到同一条 agent 链路里。
- **Task System**
  本地任务队列，当前包含 reminder、system message、timeline screenshot 三类异步任务。
- **Capability Layer**
  涵盖 Timeline、Diary、Check-in、File Transfer 等核心能力，其中 `checkin` 就是随机轮询唤醒入口。
- **Optional Tooling**
  支持接入 MCP 与其他本地硬件/软件接口；是否启用完全取决于你的本地环境。

## 开发初衷：拒绝“自律神话”

对于 ADHD 来说，问题从来不是“不懂道理”，而是“意志力断层”。

- 番茄钟要求你先自律
- 待办清单要求你先整理
- 提醒软件要求你先“记得去相信”它

Cyberboss 假设你是一个完全不可控的个体：你不需要先点开始，不需要先记得回来，甚至不需要先拥有执行意志。你只需要继续活着、继续聊天，剩下的由系统去记录时间、补齐轨迹、主动出现。

<a id="user-guide"></a>
## 用户使用

### 环境前提

- Node.js `>= 22`
- 本机已安装 `codex`
- 如果需要截图，本机需要可用的 Chrome / Chromium / Edge

### 获取源码与安装依赖

当前没有发布 npm 包。正确用法是先拉源码，再在仓库目录里安装依赖：

```bash
git clone https://github.com/WenXiaoWendy/cyberboss.git
cd cyberboss
npm install
```

不要把 README 里的命令理解成“全局安装后直接可用”的 npm package 命令。

### 在跑第一个命令前先配环境变量

`Cyberboss` 会按这个顺序读取环境变量：

- 当前项目目录下的 `.env`
- `${HOME}/.cyberboss/.env`
- 当前 shell 环境

建议你在第一次运行任何命令前，至少先配置这几项：

```dotenv
CYBERBOSS_USER_NAME=你的名字
CYBERBOSS_USER_GENDER=female
CYBERBOSS_ALLOWED_USER_IDS=你的微信 user id
CYBERBOSS_WORKSPACE_ROOT=/绝对路径/你的项目目录
```

可选常用项：

```dotenv
CYBERBOSS_ACCOUNT_ID=
CYBERBOSS_CODEX_ENDPOINT=ws://127.0.0.1:8765
CYBERBOSS_WEIXIN_ADAPTER=v2
```

`CYBERBOSS_ALLOWED_USER_IDS` 支持逗号分隔多个 user id。

原因有两个：

- 第一次运行任意 `cyberboss` 命令时，会自动生成 `~/.cyberboss/weixin-instructions.md`
- 如果你没先设置 `CYBERBOSS_USER_NAME` 和 `CYBERBOSS_USER_GENDER`，生成出来的 instructions 可能不符合真实情况

另外，如果你想要更强的“push 感”，建议一开始先不要主动大改 instructions 模板。先让 agent 在真实交流里自己更新行为，再回头只修明显不对的部分。

如果你要跑共享线程，建议也在第一次启动前就把 `CYBERBOSS_WORKSPACE_ROOT` 配好。这样 `shared:open` 会优先接到你当前项目对应的那条线程，而不是回退到别的历史绑定。

### 用户自己会用到的终端命令

- `npm run login`
  扫码登录微信，并把 bot 账号保存到本地
- `npm run accounts`
  查看本地已保存的账号
- `npm run shared:start`
  默认启动方式。跨平台启动共享 `codex app-server` 和共享微信桥接；Windows / macOS / Linux 都优先用这个入口
- `npm run shared:open`
  默认接管方式。跨平台接入当前微信绑定的那条共享线程
- `npm run shared:status`
  跨平台查看共享 `app-server`、共享桥接和 `readyz` 状态
- `npm run doctor`
  查看当前配置、channel/runtime 边界和线程状态
- `npm run help`
  查看可直接执行的命令入口

这里的 `checkin` 指的就是“随机轮询唤醒”能力，不是固定整点提醒。

`npm run start` / `npm run start:checkin` 可以用于本地最小链路调试，但不适合观察共享桥的真实行为，也不适合作为共享线程问题的默认排查入口。因此 README 只把共享模式作为默认入口。

### 用户在微信里会用到的命令

- `/bind /绝对路径`
  绑定当前聊天使用的项目目录
- `/status`
  查看当前绑定项目、线程、模型和上下文状态
- `/new`
  切到新线程草稿
- `/switch <threadId>`
  切换到指定线程
- `/stop`
  停止当前线程里的运行
- `/yes`
  允许当前待处理授权一次
- `/always`
  在当前项目内持续允许同前缀命令
- `/no`
  拒绝当前待处理授权
- `/model`
  查看当前模型
- `/model <id>`
  切换模型
- `/help`
  查看微信内命令帮助

普通文本消息会直接发送到当前绑定线程。如果当前还没绑定项目，先执行：

```text
/bind /绝对路径
```

### 双端监控同一条线程

如果你想把微信里当前绑定的同一条 Codex 线程同步到本机终端继续看、继续接管，稳定流程是：

第一个终端：

```bash
npm run shared:start
```

保持这个终端不要退出。第二个终端：

```bash
npm run shared:open
```

辅助诊断：

- `npm run shared:status`

注意：

- 共享启动就是默认启动方式；README 里的所有正常使用场景都默认建立在 `npm run shared:start` / `npm run shared:open` 之上
- 不要单独执行 `node ./bin/cyberboss.js start --checkin`，除非已经明确设置 `CYBERBOSS_CODEX_ENDPOINT=ws://127.0.0.1:8765`
- 不要让微信桥接走 `spawn` 私有 runtime；微信和终端必须连接同一个共享 `codex app-server`
- 不要同时保留多套 `cyberboss` 进程
- 不要把 `npm run shared:start` 放到后台跑；它就是共享桥接主进程
- Windows 用户不要再使用 `.sh` 入口；共享启动和接管请统一使用 `npm run shared:start` / `npm run shared:open`

<a id="data-dir"></a>
## 本地数据放在哪里

默认状态目录是：

```text
${HOME}/.cyberboss
```

常见内容：

- `accounts/`
  微信 bot 账号信息
- `sessions.json`
  工作区、线程、模型和审批状态
- `sync-buffers/`
  微信长轮询同步缓冲
- `weixin-instructions.md`
  首次运行自动生成的本地 instructions
- `reminder-queue.json`
  reminder 队列
- `system-message-queue.json`
  system / checkin 队列
- `timeline-screenshot-queue.json`
  截图任务队列
- `diary/`
  本地日记
- `timeline/`
  timeline 数据、site、shots
- `logs/`
  共享 bridge 和 shared app-server 日志

这个目录只是本地状态目录，不是线程工作目录；微信线程和终端线程仍然应该开在你的项目目录里。

仓库本身不包含你的微信账号、`context_token`、会话文件或其他运行态数据；这些都保存在状态目录里。

<a id="agent-guide"></a>
## Agent 接入

下面这些命令主要是给 agent / 自动化能力使用的，不是普通用户每天手敲的主入口。

### Agent 常用命令

- `npm run reminder:write -- --delay 30m --text "提醒内容"`
  给未来的自己留 reminder
- `npm run reminder:write -- --at "2026-04-07 21:30" --text "提醒内容"`
  写明确时间点 reminder
- `npm run diary:write -- --title 标题 --text "内容"`
  写本地日记
- `npm run diary:write -- --date 2026-04-06 --title "4.6" --text "内容"`
  写指定日期日记
- `npm run timeline:write -- --date YYYY-MM-DD --stdin`
  增量写入时间轴
- `npm run timeline:build`
  构建时间轴静态页面
- `npm run timeline:serve`
  启动时间轴静态页面服务
- `npm run timeline:dev`
  启动时间轴热更新开发服务
- `npm --prefix "$CYBERBOSS_HOME" run timeline:screenshot -- --send`
  稳定截图入口，会把截图任务交给当前微信桥执行
- `npm run channel:send-file -- --path /绝对路径`
  把本地已有文件直接发回当前微信聊天
- `npm run system:send -- --text "系统消息"`
  向内部系统队列写入一条不可见触发消息
- `npm run system:checkin`
  底层随机轮询入口，通常只用于调试；正常用户直接用共享模式

### Agent 使用约定

- 优先使用 `README`、`--help` 和 [docs/commands.md](./docs/commands.md) 里已经暴露的稳定入口
- 参数不清楚时先看 `--help`
- 第一次执行失败时，先反馈报错，不要立刻读源码
- 如果只是发文件或截图回微信，优先用现成命令，不要去找内部 `channelAdapter.sendFile(...)`

## 文档入口

- [docs/commands.md](./docs/commands.md)

<a id="faq"></a>
## FAQ

### 为什么不是直接 `npm install cyberboss`？

因为当前没有发布 npm package。正确方式是 `git clone` 仓库后，在项目目录里执行 `npm install`。

### `checkin` 到底是什么？

`checkin` 就是“随机轮询唤醒”能力。系统会在一个随机时间点唤醒模型，让它自己判断现在该不该主动出现。

### 为什么要在第一次运行前就设置用户名和性别？

因为第一次运行任意 `cyberboss` 命令时，会自动生成 `~/.cyberboss/weixin-instructions.md`。先配好 `CYBERBOSS_USER_NAME` 和 `CYBERBOSS_USER_GENDER`，可以避免生成明显不符合现实的 instructions。

### 为什么不建议一开始就大改 instructions？

如果你想要更强的“赛博老板”效果，最好先让 agent 在真实对话里自己长出节奏，再回头修正明显不对的部分。过早手工写死行为，通常会让它更像脚本，不像真的在盯你。

## License

本项目主要面向个人本地部署场景设计。由于它会长期处理微信消息、线程上下文、提醒、生活轨迹和其他高度私密的个人信息，我不希望它被闭源包装成云服务后，再反向剥夺用户对代码和数据流向的知情权。

因此，本项目采用 `AGPL-3.0-only` 协议发布。任何基于本项目进行修改、扩展并通过网络向用户提供服务的行为，都必须按照 AGPL 的要求向对应用户提供完整的对应源代码。

商业使用并非天然被禁止，但前提是必须完整遵守 AGPL。对于任何形式的闭源封装、闭源 SaaS 化或只提供服务不提供源码的做法，本项目都明确不欢迎。
