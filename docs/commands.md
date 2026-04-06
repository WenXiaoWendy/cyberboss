# Commands

## 设计原则

`Cyberboss` 不把所有终端、微信、不同 agent 的命令写死成同一套字符串。

它先定义稳定的内部 action，再让每个通道做自己的映射：

- core action：内部稳定语义
- terminal command：终端入口
- weixin command：微信入口

这样后面接入新的 runtime 或 channel 时，不需要反复重命名 core。

## 当前 action 分组

### 启动与诊断

- `app.login`
- `app.accounts`
- `app.start`
- `app.doctor`

### 项目与线程

- `workspace.bind`
- `workspace.status`
- `thread.new`
- `thread.switch`
- `thread.stop`

### 授权与控制

- `approval.accept_once`
- `approval.accept_workspace`
- `approval.reject_once`

### 能力集成

- `model.inspect`
- `model.select`
- `channel.send_file`
- `timeline.write`
- `reminder.create`
- `diary.append`
- `app.help`

## 当前终端命令

当前只开放最小一组：

- `cyberboss login`
- `cyberboss accounts`
- `cyberboss start`
- `cyberboss doctor`
- `cyberboss help`

## 规划中的终端子命令

为了避免继续把所有能力都平铺在顶层，后续命令会按能力分组：

### timeline

- `cyberboss timeline write`
- `cyberboss timeline build`
- `cyberboss timeline serve`
- `cyberboss timeline screenshot`

### reminder

- `cyberboss reminder write`

### diary

- `cyberboss diary write`

当前这些子命令只预留命名和帮助，不代表功能已经完全接入。

## 当前已接入的微信命令

- `/bind`
- `/status`
- `/new`
- `/stop`
- `/switch <threadId>`
- `/yes`
- `/always`
- `/no`

## 计划中的微信命令

下一批考虑：

- `/model`
- `/model <id>`
- `/send <path>`
- `/help`

说明：

- `/status` 合并了原先 `where` 和 `usage` 的职责
- `/help` 保留
- `/reread` 先不做，自然语言触发即可
- `/send` 保留，因为“模型能读文件”不等于“桥能把文件作为附件发回聊天”
