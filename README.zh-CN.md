<div align="center">

中文 · [English](./README.md)

# 《霸道总裁爱上患有 ADHD 的我》
## 支持 Codex 与 Claude Code 的微信桥接系统：Cyberboss

> “你尽管在多巴胺里逃避，但我永远会在下一个时间戳抓到你。”

[![Node >=22](https://img.shields.io/badge/Node-22%2B-3C873A)](./package.json)
[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-b31b1b)](./LICENSE)
[![Runtime-Codex%20%7C%20ClaudeCode](https://img.shields.io/badge/Runtime-Codex%20%7C%20ClaudeCode-111827)](#technical-stack)
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

它是一个把本地 coding runtime 深度接入微信的 Agent Bridge。当前同时支持 Codex 和 Claude Code，但日常使用命令和行为保持一致。它的存在不是为了“提醒你开始”，而是直接化身为那个拥有绝对时间感、盯死进度、在你消失太久时会主动破屏而出的“赛博老板”。

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
  可切换的 Codex / Claude Code runtime 层，对外保持同一套微信命令与共享线程工作流。
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
- 本机已安装 `codex` 或 `claude`
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
CYBERBOSS_RUNTIME=codex
CYBERBOSS_CODEX_ENDPOINT=ws://127.0.0.1:8765
CYBERBOSS_CODEX_COMMAND=
CYBERBOSS_CLAUDE_COMMAND=claude
CYBERBOSS_CLAUDE_MODEL=
CYBERBOSS_CLAUDE_CONTEXT_WINDOW=
CYBERBOSS_CLAUDE_PERMISSION_MODE=default
CYBERBOSS_CLAUDE_DISABLE_VERBOSE=false
CYBERBOSS_CLAUDE_EXTRA_ARGS=
CLAUDE_CODE_MAX_OUTPUT_TOKENS=
CYBERBOSS_ACCOUNT_ID=
CYBERBOSS_WEIXIN_MIN_CHUNK_CHARS=20
CYBERBOSS_WEIXIN_BASE_URL=https://ilinkai.weixin.qq.com
CYBERBOSS_WEIXIN_CDN_BASE_URL=https://novac2c.cdn.weixin.qq.com/c2c
CYBERBOSS_WEIXIN_QR_BOT_TYPE=3
CYBERBOSS_ENABLE_LOCATION_SERVER=false
CYBERBOSS_LOCATION_HOST=0.0.0.0
CYBERBOSS_LOCATION_PORT=4318
CYBERBOSS_LOCATION_TOKEN=
CYBERBOSS_LOCATION_HOME_CENTER=
CYBERBOSS_LOCATION_WORK_CENTER=
CYBERBOSS_LOCATION_KNOWN_PLACES=
CYBERBOSS_LOCATION_PLACE_RADIUS_METERS=150
CYBERBOSS_LOCATION_BATTERY_HISTORY_LIMIT=100
```

这些变量的作用：

- `CYBERBOSS_RUNTIME`
  选择 `codex` 或 `claudecode`。两种 runtime 使用同一套命令。
- `CYBERBOSS_CODEX_ENDPOINT`
  复用已有的共享 Codex app-server，而不是新起私有 runtime。
- `CYBERBOSS_CODEX_COMMAND`
  当 `codex` 不在 `PATH` 上时，自定义 Codex 启动命令。
- `CYBERBOSS_CLAUDE_COMMAND`
  自定义 Claude 启动命令，默认是 `claude`。
- `CYBERBOSS_CLAUDE_MODEL`
  设置 Claude 默认模型。
- `CYBERBOSS_CLAUDE_CONTEXT_WINDOW`
  设置 Claude 实际上下文窗口，`/status` 里的 `📦 context` 近似值会基于它计算。
- `CYBERBOSS_CLAUDE_PERMISSION_MODE`
  设置 Claude 权限模式。
- `CYBERBOSS_CLAUDE_DISABLE_VERBOSE`
  关闭 Claude 终端 verbose 输出。
- `CYBERBOSS_CLAUDE_EXTRA_ARGS`
  以逗号分隔的形式追加 Claude CLI 参数。
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS`
  为 Claude 回复预留输出 token。`/status` 会先从 Claude 上下文窗口里减掉这部分预留量。
- `CYBERBOSS_WEIXIN_MIN_CHUNK_CHARS`
  设置微信短分片合并阈值默认值。
- `CYBERBOSS_WEIXIN_BASE_URL`、`CYBERBOSS_WEIXIN_CDN_BASE_URL`、`CYBERBOSS_WEIXIN_QR_BOT_TYPE`
  在特殊部署环境下覆盖微信桥接接口地址和二维码 bot 类型。
- `CYBERBOSS_ENABLE_LOCATION_SERVER`
  是否启动内置 whereabouts HTTP 接收服务。
- `CYBERBOSS_LOCATION_HOST`
  内置 whereabouts HTTP 服务监听地址，默认 `0.0.0.0`。
- `CYBERBOSS_LOCATION_PORT`
  内置 whereabouts HTTP 服务端口，默认 `4318`。
- `CYBERBOSS_LOCATION_TOKEN`
  上传定位数据时使用的 Bearer token。
- `CYBERBOSS_LOCATION_HOME_CENTER`、`CYBERBOSS_LOCATION_WORK_CENTER`
  家和公司的中心坐标，格式 `lat,lng`。
- `CYBERBOSS_LOCATION_KNOWN_PLACES`
  额外地点标签，JSON 数组。
- `CYBERBOSS_LOCATION_PLACE_RADIUS_METERS`
  地点标签识别半径，默认 `150`。
- `CYBERBOSS_LOCATION_BATTERY_HISTORY_LIMIT`
  电量观测保留数量，默认 `100`。


`CYBERBOSS_ALLOWED_USER_IDS` 支持逗号分隔多个 user id。

原因有两个：

- 第一次运行任意 `cyberboss` 命令时，会自动生成 `~/.cyberboss/weixin-instructions.md`
- 如果你没先设置 `CYBERBOSS_USER_NAME` 和 `CYBERBOSS_USER_GENDER`，生成出来的 instructions 可能不符合真实情况

另外，如果你想要更强的“push 感”，建议一开始先不要主动大改 instructions 模板。先让 agent 在真实交流里自己更新行为，再回头只修明显不对的部分。

如果你要跑共享线程，建议也在第一次启动前就把 `CYBERBOSS_WORKSPACE_ROOT` 配好。这样 `shared:open` 会优先接到你当前项目对应的那条线程，而不是回退到别的历史绑定。

当 `CYBERBOSS_RUNTIME=claudecode` 时，Cyberboss 会在当前工作区自动补写 `.mcp.json` 里的 `cyberboss_tools`，并在启动 Claude 时显式挂上这份 MCP 配置。Claude 能发现 Cyberboss project tools，靠的就是这条项目本地配置，而不是全局注册。

### 用户自己会用到的终端命令

- `npm run login`
  扫码登录微信，并把 bot 账号保存到本地
- `npm run accounts`
  查看本地已保存的账号
- `npm run shared:start`
  默认启动方式。跨平台启动共享 runtime bridge 和共享微信桥接；Windows / macOS / Linux 都优先用这个入口
- `npm run shared:open`
  默认接管方式。跨平台接入当前微信绑定的那条共享线程
- `npm run shared:status`
  跨平台查看共享 runtime 进程、共享桥接和 `readyz` 状态
- `npm run doctor`
  查看当前配置、channel/runtime 边界和线程状态
- `npm run help`
  查看可直接执行的命令入口

这里的 `checkin` 指的就是“随机轮询唤醒”能力，不是固定整点提醒。

切换 runtime 只需要改 `CYBERBOSS_RUNTIME`。不需要为 Claude Code 单独学习另一套命令。

`npm run start` / `npm run start:checkin` 可以用于本地最小链路调试，但不适合观察共享桥的真实行为，也不适合作为共享线程问题的默认排查入口。因此 README 只把共享模式作为默认入口。

### 用户在微信里会用到的命令

- `/bind /绝对路径`
  绑定当前聊天使用的项目目录
- `/status`
  查看当前绑定项目、线程、模型和上下文状态
- `/new`
  切到新线程草稿
- `/reread`
  让当前线程重新读取最新 instructions，适合刚改完人格模板或操作模板后使用
- `/compact`
  压缩当前线程上下文。桥会先回一条开始提示，完成后再回一条完成提示。
- `/switch <threadId>`
  切换到指定线程
- `/stop`
  停止当前线程里的运行
- `/checkin <min>-<max>`
  调整当前项目的随机 checkin 区间
- `/chunk <number>`
  调整微信短回复的最小合并字符数
- `/yes`
  允许当前待处理授权一次
- `/always`
  在当前项目内持续允许同类命令
- `/no`
  拒绝当前待处理授权
- `/model`
  查看当前模型
- `/model <id>`
  切换模型
- `/star`
  在微信里查看 GitHub star 引导
- `/help`
  查看微信内命令帮助

普通文本消息会直接发送到当前绑定线程。如果当前还没绑定项目，先执行：

```text
/bind /绝对路径
```

### 双端监控同一条线程

如果你想把微信里当前绑定的同一条共享线程同步到本机终端继续看，稳定流程是：

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

如果你想在手机上通过 `Termius + tmux` 长期查看共享线程，参考：

- [docs/termius-tmux-shared-terminal.zh-CN.md](docs/termius-tmux-shared-terminal.zh-CN.md)

注意：

- 共享启动就是默认启动方式；README 里的所有正常使用场景都默认建立在 `npm run shared:start` / `npm run shared:open` 之上
- 不管底层 runtime 是 Codex 还是 Claude Code，微信里的命令和日常行为都保持一致
- 如果 `CYBERBOSS_RUNTIME=claudecode`，本地 Claude 窗口当前更适合作为共享线程的监听窗口
- 不要单独执行 `node ./bin/cyberboss.js start --checkin`，除非已经明确设置 `CYBERBOSS_CODEX_ENDPOINT=ws://127.0.0.1:8765`
- 不要让微信桥接走 `spawn` 私有 runtime；微信和终端必须连接同一套共享 runtime 会话
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
- `inbox/`
  保存收到的微信图片和附件
- `stickers/`
  表情包资产目录，包含：
  - `assets/`
    已入库表情包素材，当前统一规范化为 GIF
  - `index.json`
    表情包索引，维护 `stickerId -> { tags, desc }`
  - `tags.json`
    表情包标签表，AI 读取这里，用户也可以手动编辑这里
- `weixin-instructions.md`
  首次运行自动生成的本地 instructions
- `reminder-queue.json`
  reminder 队列
- `system-message-queue.json`
  system / checkin 队列
- `deferred-system-replies.json`
  等待下一个可用微信 context token 的补发消息
- `timeline-screenshot-queue.json`
  截图任务队列
- `diary/`
  本地日记
- `timeline/`
  timeline 数据、site、shots
- `logs/`
  共享 bridge 和 shared runtime 日志

这个目录只是本地状态目录，不是线程工作目录；微信线程和终端线程仍然应该开在你的项目目录里。

仓库本身不包含你的微信账号、`context_token`、会话文件或其他运行态数据；这些都保存在状态目录里。

### 行踪服务说明

- Cyberboss 已内置 `whereabouts-mcp`，可以直接接收手机上传的定位、电量和触发原因。
- 如果要启用内置行踪服务，至少需要配置：
  - `CYBERBOSS_ENABLE_LOCATION_SERVER=true`
  - `CYBERBOSS_LOCATION_TOKEN=<your_token>`
  - `CYBERBOSS_LOCATION_HOME_CENTER=lat,lng`
- 常用可选项：
  - `CYBERBOSS_LOCATION_HOST`
  - `CYBERBOSS_LOCATION_WORK_CENTER`
  - `CYBERBOSS_LOCATION_KNOWN_PLACES`
  - `CYBERBOSS_LOCATION_PLACE_RADIUS_METERS`
  - `CYBERBOSS_LOCATION_BATTERY_HISTORY_LIMIT`
- 内置服务默认监听 `http://0.0.0.0:4318`，上传接口是 `POST /location/ingest`，健康检查是 `GET /healthz`。
- 行踪数据默认写入 `~/.cyberboss/locations.json`，不是写进项目目录。

### 表情包说明

- 当前这条微信桥链路里，微信出入站都不能把动图展示能力当成可靠前提。不要假设发出去或收进来的 GIF 会在聊天窗口里正常播放。
- 因此，表情包入库时当前统一规范化为 GIF，目的是先把资产格式收敛好。这样后续如果微信开放更完整的表情能力，可以直接复用现有库存而不用重新整理。
- 标签表固定放在 `~/.cyberboss/stickers/tags.json`。AI 会从这里读取可用标签，用户也可以直接手动增删改。
- 为了方便管理，当前表情包检索只做标签过滤，不做向量库召回。

<a id="agent-guide"></a>
## Agent 接入

给 agent 暴露的 Cyberboss 能力是项目内结构化工具。

### 常用项目工具

- `cyberboss_reminder_create`
- `cyberboss_diary_append`
- `cyberboss_timeline_write`
- `cyberboss_timeline_build`
- `cyberboss_timeline_serve`
- `cyberboss_timeline_dev`
- `cyberboss_timeline_screenshot`
- `cyberboss_channel_send_file`
- `whereabouts_current_stay`
- `whereabouts_recent_stays`
- `whereabouts_recent_moves`
- `whereabouts_snapshot`
- `whereabouts_summary`
- `cyberboss_sticker_tags`
- `cyberboss_sticker_pick`
- `cyberboss_sticker_send`
- `cyberboss_sticker_delete`
- `cyberboss_sticker_save_from_inbox`
- `cyberboss_sticker_update`
- `cyberboss_system_send`

### Agent 使用约定

- diary、reminder、timeline、screenshot、file-send 这类 Cyberboss 能力使用项目工具
- 终端给人手动使用的仍然是 `README`、`--help` 和 [docs/commands.md](./docs/commands.md) 中的生命周期入口
- 第一次执行失败时，先反馈报错，不要立刻读源码

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
