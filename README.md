# Cyberboss

`Cyberboss` 是一个面向个人生活流的 agent bridge。

它的目标不是绑定某一个聊天渠道或某一个模型运行时，而是把这些边界拆开：

- channel adapter
  - 微信、Telegram、WhatsApp 等消息入口
- runtime adapter
  - Codex、Claude Code、Cursor、OpenClaw 等 agent 运行时
- capability integrations
  - timeline、reminder、diary、check-in
- core orchestrator
  - 统一管理会话、任务、状态和能力编排

## 当前阶段

这个仓库现在已经有一条最小可跑链路：

- 微信底层账号与收发能力
- Codex runtime 连接、发消息、收完成态
- core 内部的线程运行态记录

后续会继续往上接授权、更多微信命令、提醒、日记、时间轴。

当前默认启用参考 `cc-connect` 思路重写的 `weixin-v2` 实验通道。
如果需要回退旧实现，可以设置：

```bash
export CYBERBOSS_WEIXIN_ADAPTER=legacy
```

## 命令分层

### 1. Core Action

`Cyberboss` 内部先定义稳定动作，再由不同通道映射成自己的命令形态。

- `app.login`
- `app.accounts`
- `app.start`
- `app.doctor`
- `workspace.bind`
- `workspace.status`
- `thread.new`
- `thread.switch`
- `thread.stop`
- `approval.accept_once`
- `approval.accept_workspace`
- `approval.reject_once`
- `model.inspect`
- `model.select`
- `channel.send_file`
- `timeline.write`
- `reminder.create`
- `diary.append`
- `app.help`

### 2. 当前终端命令

```bash
npm install
npm run check
npm run login
npm run accounts
npm run start
npm run start:checkin
npm run doctor
npm run help
npm run channel:send-file -- --path /绝对路径
```

目前终端只把启动和诊断平铺在顶层，不把提醒、日记、时间轴继续堆成一排顶层命令。

后续能力会下沉成子命令，例如：

```bash
npm run reminder:write -- --delay 30m --text "提醒内容"
npm run reminder:write -- --delay 1h30m --text "提醒内容"
npm run reminder:write -- --at "2026-04-07 21:30" --text "提醒内容"
npm run diary:write -- --title 标题 --text "内容"
npm run diary:write -- --date 2026-04-06 --title "4.6" --text "内容"
npm run system:send -- --text "系统消息"
```

`checkin` 现在更推荐跟随启动一起开，用 `npm run start:checkin`；单独的 `system:checkin` 仍保留作底层入口。

目前已接入 `reminder`、`diary`、`system`、`timeline` 这四组脚本。

其中日记命令要注意：

- `--title` 只影响这条日记的小标题
- `--date` 才决定写入哪个 `YYYY-MM-DD.md`
- 如果你想把标题写成 `4.6`，同时又落到 `2026-04-06.md`，需要两个都传


如果你想把微信里当前绑定的同一条 Codex 线程在本机终端继续打开，稳定流程是：

```bash
cd /Users/tingyiwen/Dev/cyberboss
./scripts/start_shared_wechat.sh
```

保持这个终端不要退出。再开第二个终端执行：

```bash
cd /Users/tingyiwen/Dev/cyberboss
./scripts/open_wechat_thread.sh
```

辅助诊断：

- `./scripts/show_shared_status.sh` 用来检查共享 `app-server`、共享 `cyberboss` 和最近日志
- `./scripts/open_shared_wechat_thread.sh` 现在只做前置检查和接入，不再偷偷启动后台 `cyberboss`

禁止事项：

- 不要单独执行 `node ./bin/cyberboss.js start --checkin`，除非已经明确设置 `CYBERBOSS_CODEX_ENDPOINT=ws://127.0.0.1:8765`
- 不要让微信桥接走 `spawn` 私有 runtime；微信和终端必须同时连接同一个共享 `codex app-server`
- 不要同时保留多套 `cyberboss` 进程；微信侧只应该有一条后台桥接链路
- 不要把 `./scripts/start_shared_wechat.sh` 放到后台跑；它就是共享桥接主进程，必须保活在一个独立终端里

时间轴命令：

```bash
npm run timeline:write -- --date YYYY-MM-DD --stdin
npm run timeline:build
npm run timeline:serve
npm run timeline:dev
sh "$CYBERBOSS_HOME/scripts/timeline-screenshot.sh" --send
```

其中截图的稳定入口是 `sh "$CYBERBOSS_HOME/scripts/timeline-screenshot.sh" --send`，它只负责把截图任务写进本地队列，再由正在运行的微信桥执行截图并发回聊天。

如果要把本地已有文件直接发回当前微信聊天，使用：

```bash
npm run channel:send-file -- --path /绝对路径
```

可选参数：

- `--user <wechatUserId>`：覆盖默认接收用户

时间轴截图仍优先走它自己的稳定入口：

```bash
sh "$CYBERBOSS_HOME/scripts/timeline-screenshot.sh" --send
```

### 3. 当前已接入的微信命令

已经接入：

- `/bind` -> `workspace.bind`
- `/status` -> `workspace.status`
- `/new` -> `thread.new`
- `/stop` -> `thread.stop`
- `/switch <threadId>` -> `thread.switch`
- `/yes` -> `approval.accept_once`
- `/always` -> `approval.accept_workspace`
- `/no` -> `approval.reject_once`
- `/model` -> `model.inspect`
- `/model <id>` -> `model.select`
- `/help` -> `app.help`

其中：

- `/status` 会合并原先 `where` 和 `usage` 的职责
- `/help` 保留
- `/reread` 暂不保留，优先交给自然语言触发
- 发文件回聊天保留为内部能力，不再暴露成微信命令

### 5. 为什么要分层

- 终端命令和微信命令不需要长得一样
- Codex、Claude Code、Cursor 以后也不需要共享同一套用户可见命令
- 只要内部 action 稳定，通道层就能各自做最合适的映射

## 默认约定

- `CYBERBOSS_STATE_DIR`
  - 默认：`${HOME}/.cyberboss`
  - 这是本地状态目录，不是线程工作目录；微信线程和终端线程仍然应该开在你的项目目录里，不需要切到 `${HOME}`
- `CYBERBOSS_USER_NAME`
  - 默认：`用户`
  - 用来替换默认文案、check-in 触发和本地 instructions 里的用户名
- `CYBERBOSS_CHANNEL`
  - 默认：`weixin`
- `CYBERBOSS_RUNTIME`
  - 默认：`codex`
- `CYBERBOSS_TIMELINE_COMMAND`
  - 默认：`timeline-for-agent`
- `CYBERBOSS_WEIXIN_BASE_URL`
  - 默认：`https://ilinkai.weixin.qq.com`
- `CYBERBOSS_ACCOUNT_ID`
  - 多账号时指定当前使用的微信 bot 账号

如果你不想在本地 instructions 和默认触发文案里继续用 `用户`，可以先设置：

```bash
export CYBERBOSS_USER_NAME="你的名字"
```

后续再把 `~/.cyberboss/weixin-instructions.md` 里对应的人名一起替换掉。

## 结构

```text
src/
  adapters/
    channel/
    runtime/
  core/
  integrations/
docs/
```

详细拆分计划见：

- [docs/architecture.md](./docs/architecture.md)

命令与动作映射见：

- [docs/commands.md](./docs/commands.md)

## 当前已接入的微信底层能力

- 微信扫码登录
- bot token 本地持久化
- 已保存账号列表
- context token 本地持久化
- 微信 HTTP API 基础访问封装

## 当前已接入的 Codex runtime 底层能力

- Codex app-server / websocket RPC client
- session store
- model catalog 规范化
- runtime adapter
- assistant 回复事件流
- 授权响应
- 线程运行态记录
