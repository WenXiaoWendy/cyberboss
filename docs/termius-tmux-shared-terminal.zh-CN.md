# 在手机上用 Termius + tmux 查看 Cyberboss 共享终端

这份文档是给不熟悉命令行的用户准备的。

目标只有一个：

- 让你在手机上随时查看 `Cyberboss` 当前绑定线程的运行情况
- 必要时在手机上接管同一条共享线程
- 尽量避免因为目录、runtime、tmux 用法不对而报错

这份文档默认你已经：

- 在一台长期在线的电脑或服务器上安装好了 `Cyberboss`
- 可以用 `Termius` 从手机 SSH 登录到那台机器
- 机器上已经安装了 `tmux`

## 先理解 3 个东西

先只记住这 3 个名字：

1. `npm run shared:start`
   这是共享桥主进程。它负责跑 Cyberboss 和微信桥。

2. `npm run shared:open`
   这是共享线程观察/接管窗口。它会接入当前微信绑定的那条线程。

3. `tmux`
   这是终端“保活器”。即使你退出 SSH，里面的进程也不会立刻没掉。

你可以把它理解成：

- `shared:start` 是发动机
- `shared:open` 是驾驶舱
- `tmux` 是车库

## 最推荐的使用方式

建议固定用两个 tmux session：

- `cb-bridge`：专门跑 `shared:start`
- `cb-open`：专门跑 `shared:open`

这样最不容易混乱。

## 先确认你的项目目录

下面所有命令都默认你的项目在：

```bash
/Users/tingyiwen/Dev/cyberboss
```

如果你的路径不是这个，请把文档里的路径替换成你自己的。

很多报错都不是 Cyberboss 坏了，而是因为你不在项目目录里执行命令。

## 第一次启动：开共享桥

先在手机的 Termius 里 SSH 登录到机器，然后执行：

```bash
tmux new-session -d -s cb-bridge -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:start; exec zsh'
```

这条命令的意思是：

- 新建一个叫 `cb-bridge` 的 tmux session
- 进入 `Cyberboss` 项目目录
- 执行 `npm run shared:start`
- 如果命令退出，不要立刻关掉窗口，而是留在 `zsh` 里方便你看报错

然后 attach 进去看：

```bash
tmux attach -t cb-bridge
```

如果你只想看、不想误操作，也可以用只读模式：

```bash
tmux attach -r -t cb-bridge
```

### 怎么退出这个窗口但不关掉进程

在 tmux 里按：

```text
Ctrl+b
```

松开后再按：

```text
d
```

这叫 detach，意思是“离开这个窗口，但让它继续跑”。

如果你用手机键盘不方便发 `Ctrl+b`，Termius 一般可以通过扩展键盘发 `Ctrl`。

## 查看共享线程：开 shared:open

共享桥已经跑起来后，再开一个单独的 tmux session：

```bash
tmux new-session -d -s cb-open -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:open; exec zsh'
```

然后 attach：

```bash
tmux attach -t cb-open
```

这个窗口就是你平时最常看的窗口。它会接入当前微信绑定的那条共享线程。

## 手机和电脑同时看同一个 open 窗口

很多人说的“双开”，不是开两个 `shared:open` 进程。

正确做法是：

- 只开一个 `cb-open` session
- 手机和电脑都 attach 到同一个 tmux session

例如：

手机上：

```bash
tmux attach -t cb-open
```

电脑上：

```bash
tmux attach -r -t cb-open
```

推荐这样分工：

- 一端可输入
- 另一端只读

因为如果两端都可输入，两个键盘会同时往同一个窗口打字，很容易乱。

## 日常最常用的 8 条命令

### 1. 看当前 tmux 有哪些窗口

```bash
tmux ls
```

常见输出大概像这样：

```text
cb-bridge: 1 windows
cb-open: 1 windows
```

### 2. 进入共享桥窗口

```bash
tmux attach -t cb-bridge
```

### 3. 进入共享线程窗口

```bash
tmux attach -t cb-open
```

### 4. 只读方式进入共享线程窗口

```bash
tmux attach -r -t cb-open
```

### 5. 离开窗口但不关闭进程

按：

```text
Ctrl+b
```

然后按：

```text
d
```

### 6. 杀掉共享线程窗口，再重新开

```bash
tmux kill-session -t cb-open
tmux new-session -d -s cb-open -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:open; exec zsh'
```

### 7. 杀掉共享桥窗口，再重新开

```bash
tmux kill-session -t cb-bridge
tmux new-session -d -s cb-bridge -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:start; exec zsh'
```

### 8. 看共享桥状态

如果你不确定桥是不是还活着，在项目目录执行：

```bash
cd /Users/tingyiwen/Dev/cyberboss
npm run shared:status
```

## 推荐的固定工作流

### 场景 1：你刚重启了电脑/服务器

按这个顺序：

1. 登录 SSH
2. 启动共享桥
3. 确认桥正常
4. 启动 `shared:open`

直接复制：

```bash
tmux new-session -d -s cb-bridge -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:start; exec zsh'
tmux new-session -d -s cb-open -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:open; exec zsh'
cd /Users/tingyiwen/Dev/cyberboss
npm run shared:status
```

### 场景 2：桥已经在跑，你只是想在手机上看一眼

直接：

```bash
tmux attach -r -t cb-open
```

如果提示没有这个 session，再执行：

```bash
tmux new-session -d -s cb-open -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:open; exec zsh'
tmux attach -t cb-open
```

### 场景 3：微信里当前线程似乎没反应

先别急着重启全部进程。

按这个顺序查：

1. 查看共享桥状态
2. 查看 `cb-bridge` 窗口有没有报错
3. 查看 `cb-open` 窗口有没有报错

命令：

```bash
cd /Users/tingyiwen/Dev/cyberboss
npm run shared:status
tmux attach -t cb-bridge
tmux attach -t cb-open
```

## 3 个最常见报错

### 报错 1：`[exited]`

这通常表示 tmux 里的命令马上退出了。

最常见原因：

- 命令写错了
- 不在项目目录里
- `npm run shared:open` 或 `npm run shared:start` 自己报错了

推荐的启动方式已经带了：

```bash
; exec zsh
```

所以即使命令退出，窗口也不会立刻消失，你可以看到报错内容。

例如正确写法是：

```bash
tmux new-session -d -s cb-open -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:open; exec zsh'
```

不是：

```bash
tmux new -s npm run shared:open
```

后者会把 `npm` 当 session 名，把 `run` 当命令，当然会退出。

### 报错 2：`duplicate session: cb-open`

意思是这个 tmux session 已经存在了。

处理方式二选一：

直接进去：

```bash
tmux attach -t cb-open
```

或者杀掉重建：

```bash
tmux kill-session -t cb-open
tmux new-session -d -s cb-open -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:open; exec zsh'
```

### 报错 3：`Claude IPC socket not found`

这通常不是 tmux 问题，而是 runtime 配置问题。

它几乎总是在说明：

- 你以为自己在跑 `codex`
- 但环境变量里实际还是 `CYBERBOSS_RUNTIME=claudecode`
- 所以 `shared:open` 试图连接 Claude 的 IPC socket

先检查项目里的 `.env`：

```bash
cd /Users/tingyiwen/Dev/cyberboss
cat .env
```

如果里面有：

```env
CYBERBOSS_RUNTIME=claudecode
```

而你现在要用的是 `codex`，那就两种方式：

方式 1：这次临时强制用 `codex`

```bash
tmux new-session -d -s cb-open -c /Users/tingyiwen/Dev/cyberboss 'CYBERBOSS_RUNTIME=codex npm run shared:open; exec zsh'
```

方式 2：直接改 `.env`

```env
CYBERBOSS_RUNTIME=codex
```

## 推荐你固定记住的 4 条“安全命令”

### 只看状态，不改东西

```bash
cd /Users/tingyiwen/Dev/cyberboss
npm run shared:status
```

### 只读查看 open 窗口

```bash
tmux attach -r -t cb-open
```

### 重建 open 窗口

```bash
tmux kill-session -t cb-open
tmux new-session -d -s cb-open -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:open; exec zsh'
```

### 重建 bridge 窗口

```bash
tmux kill-session -t cb-bridge
tmux new-session -d -s cb-bridge -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:start; exec zsh'
```

## 不建议做的事

下面这些做法很容易把自己绕晕：

- 不要在 `~` 目录直接跑 `npm run shared:open`
- 不要重复开很多个 `shared:start`
- 不要把手机和电脑都以可输入模式 attach 到同一个 `cb-open`
- 不要把 tmux session 名和命令混在一起写
- 不要一看到报错就先 `tmux kill-server`

`tmux kill-server` 会把你所有 tmux session 全部杀掉。除非你明确知道自己在做什么，否则不要用。

## 一个最稳的最小流程

如果你只想记住最少的命令，那就记这 5 条：

启动共享桥：

```bash
tmux new-session -d -s cb-bridge -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:start; exec zsh'
```

启动共享线程窗口：

```bash
tmux new-session -d -s cb-open -c /Users/tingyiwen/Dev/cyberboss 'npm run shared:open; exec zsh'
```

查看桥状态：

```bash
cd /Users/tingyiwen/Dev/cyberboss
npm run shared:status
```

手机只读查看：

```bash
tmux attach -r -t cb-open
```

离开但不断开：

```text
Ctrl+b 然后 d
```

## 你真正需要记住的一句话

如果你只是想在手机上“随时看一眼 Cyberboss 当前线程跑得怎么样”，最稳的思路不是反复新开窗口，而是：

- 先把 `cb-bridge` 和 `cb-open` 固定开在 tmux 里
- 之后手机和电脑都只是在 **attach 到已有 session**
- 需要重建时，再明确地 `kill-session` 后重开

这样最不容易乱。
