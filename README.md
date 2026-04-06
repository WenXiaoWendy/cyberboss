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
node ./bin/cyberboss.js login
node ./bin/cyberboss.js accounts
node ./bin/cyberboss.js start
node ./bin/cyberboss.js doctor
node ./bin/cyberboss.js help
```

目前终端只把启动和诊断平铺在顶层，不把提醒、日记、时间轴继续堆成一排顶层命令。

后续能力会下沉成子命令，例如：

```bash
cyberboss timeline write
cyberboss timeline build
cyberboss reminder write
cyberboss diary write
```

当前这些子命令入口已经预留，但执行能力还在后续接入。

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

### 4. 计划中的微信命令映射

下一批继续接：

- `/model` -> `model.inspect`
- `/model <id>` -> `model.select`
- `/send <path>` -> `channel.send_file`
- `/help` -> `app.help`

其中：

- `/status` 会合并原先 `where` 和 `usage` 的职责
- `/help` 保留
- `/reread` 暂不保留，优先交给自然语言触发

### 5. 为什么要分层

- 终端命令和微信命令不需要长得一样
- Codex、Claude Code、Cursor 以后也不需要共享同一套用户可见命令
- 只要内部 action 稳定，通道层就能各自做最合适的映射

## 默认约定

- `CYBERBOSS_STATE_DIR`
  - 默认：`${HOME}/.cyberboss`
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
