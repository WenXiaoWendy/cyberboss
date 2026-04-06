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

- `npm run login`
- `npm run accounts`
- `npm run start`
- `npm run doctor`
- `npm run help`

## 规划中的终端子命令

为了避免继续把所有能力都平铺在顶层，后续命令会按能力分组：

### reminder

- `npm run reminder:write -- --delay 30m --text "提醒内容"`

### diary

- `npm run diary:write -- --title 标题 --text "内容"`

### system

- `npm run system:send -- --text "系统消息"`
- `npm run system:checkin`

### timeline

- `npm run timeline:write -- --date YYYY-MM-DD --stdin`
- `npm run timeline:build`
- `npm run timeline:serve`
- `npm run timeline:dev`
- `npm run timeline:screenshot`

当前文档里列出的 `reminder / diary / system / timeline` 都已可直接使用。

## 当前已接入的微信命令

- `/bind`
- `/status`
- `/new`
- `/stop`
- `/switch <threadId>`
- `/yes`
- `/always`
- `/no`
- `/model`
- `/model <id>`
- `/help`

说明：

- `/status` 合并了原先 `where` 和 `usage` 的职责
- `/help` 保留
- `/reread` 先不做，自然语言触发即可
- 文件发送能力仍保留，但不再暴露成微信命令
