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
- `workspace.where`
- `thread.new`
- `thread.stop`

### 授权与控制

- `approval.accept`
- `approval.reject`

### 能力集成

- `timeline.write`
- `reminder.create`
- `diary.append`

## 当前终端命令

当前只开放最小一组：

- `cyberboss login`
- `cyberboss accounts`
- `cyberboss start`
- `cyberboss doctor`
- `cyberboss help`

## 计划中的微信命令

第一批仅考虑：

- `/bind`
- `/where`
- `/new`
- `/stop`
- `/ok`
- `/no`

后续能力命令会再单独讨论，不直接照旧项目平移。
