<div align="center">

[中文](./README.zh-CN.md) · English

# The Overbearing Boss Fell for My ADHD
## Cyberboss: a WeChat bridge for Codex and Claude Code

> "Keep escaping into dopamine if you want. I'll still catch you at the next timestamp."

[![Node >=22](https://img.shields.io/badge/Node-22%2B-3C873A)](./package.json)
[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-b31b1b)](./LICENSE)
[![Runtime-Codex%20%7C%20ClaudeCode](https://img.shields.io/badge/Runtime-Codex%20%7C%20ClaudeCode-111827)](#technical-stack)
[![Bridge-Weixin](https://img.shields.io/badge/Bridge-Weixin-07C160)](#technical-stack)
[![Timeline-Enabled](https://img.shields.io/badge/Timeline-Enabled-8b5cf6)](#core-features)

<p>
  <a href="#user-guide">User Guide</a> ·
  <a href="#agent-guide">Agent Guide</a> ·
  <a href="#data-dir">Local Data</a> ·
  <a href="#faq">FAQ</a>
</p>

</div>

<p align="center">
  <img src="./docs/images/IMG_0241.PNG" alt="Cyberboss English demo 1" width="31%" />
  <img src="./docs/images/IMG_0244.PNG" alt="Cyberboss English demo 2" width="31%" />
  <img src="./docs/images/IMG_0245.PNG" alt="Cyberboss English demo 3" width="31%" />
</p>

Cyberboss is not another polite productivity timer. It is not a to-do list with better branding either.

It is an agent bridge that plugs a local coding runtime directly into WeChat and turns it into a time-aware, context-persistent accountability companion. It supports Codex and Claude Code while keeping the same commands and day-to-day behavior. It does not wait for you to "start a session". It watches the flow of your day, notices when you disappear, and decides when to show up again.

## Why Cyberboss?

For people with ADHD, or anyone who needs strong external accountability, most productivity tools fail for the same reason: they assume you still have enough executive function to remember to use them.

Cyberboss starts from a transfer of control.

- No manual start button
  It lives inside the chat interface you actually open every day.
- Inescapable sense of time
  It sees when you replied, when you vanished, and how long a promise stayed unresolved.
- Real external feedback
  If self-discipline is unreliable, hand the supervision layer to an agent that stays online, keeps memory, and can act across time.

<a id="core-features"></a>
## Core Features: fully automated accountability

1. Omniscient Time
Every inbound WeChat message is stamped with local time before it reaches the runtime. The model is not just reading text. It is reading your day as it unfolds.

2. The Ledger of Life
Using those timestamps, Cyberboss reconstructs when events start, when they end, and how long they last, then turns fragmented chat into a structured personal timeline.

3. Stochastic Pulse
At random intervals, the system wakes the agent up and lets it decide what to do next: send a message, stay silent, write in the diary, update the timeline, or use tools.

4. Local Reminder Queue
Reminders are not primarily a user-facing alarm clock. They are how the model leaves instructions for its future self and wakes itself up later.

5. Zero-Token Diary
Daily traces can be written to local files without depending on a cloud note service or burning extra model context every time.

## Timeline also works on its own

If the most interesting part of Cyberboss is the "ledger of life" layer, you can use that separately:

- Project: [WenXiaoWendy/timeline-for-agent](https://github.com/WenXiaoWendy/timeline-for-agent)
- It is an independent project and does not require the WeChat bridge
- You can plug it into your own agent, bot, or automation stack even if you do not use Codex

Cyberboss builds on top of `timeline-for-agent`, then adds WeChat, reminders, diary writing, and random check-ins around it.

<a id="technical-stack"></a>
## Technical Stack

- **Core**
  A pluggable runtime layer for Codex and Claude Code, with the same WeChat command surface and shared-thread workflow.
- **Bridge**
  A WeChat HTTP bridge with long-poll synchronization for inbound messages, outbound replies, files, and status transitions.
- **Task System**
  Local queues for reminders, system triggers, and timeline screenshot jobs.
- **Capability Layer**
  Timeline, diary, random check-ins, file delivery, and related runtime actions.
- **Optional Tooling**
  MCP or other local hardware / software integrations can be added, but they are optional.

## Why It Exists

Cyberboss is built against the myth that productivity begins with self-control.

- Pomodoro assumes you can start on command.
- To-do apps assume you can keep returning.
- Reminder apps assume you will still respect them when they fire.

Cyberboss assumes none of that. It treats the user as someone who may drift, disappear, procrastinate, or lose momentum, then moves the regulatory layer outside the user and into an always-on local agent.

<a id="user-guide"></a>
## User Guide

### Requirements

- Node.js `>= 22`
- `codex` or `claude` installed locally
- Chrome / Chromium / Edge if you want screenshot features

### Get the source and install dependencies

This project is not published as an npm package. Clone the repo and install inside the project directory:

```bash
git clone https://github.com/WenXiaoWendy/cyberboss.git
cd cyberboss
npm install
```

### Configure environment variables before the first command

`Cyberboss` reads environment variables from:

- `.env` in the current project directory
- `${HOME}/.cyberboss/.env`
- the current shell environment

Before running the first command, set at least:

```dotenv
CYBERBOSS_USER_NAME=YourName
CYBERBOSS_USER_GENDER=female
CYBERBOSS_ALLOWED_USER_IDS=your_wechat_user_id
CYBERBOSS_WORKSPACE_ROOT=/absolute/path/to/your/project
```

Common optional variables:

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
```

What these do:

- `CYBERBOSS_RUNTIME`
  Choose `codex` or `claudecode`. The command set stays the same.
- `CYBERBOSS_CODEX_ENDPOINT`
  Reuse an existing shared Codex app-server instead of spawning a private runtime.
- `CYBERBOSS_CODEX_COMMAND`
  Override the Codex launcher when `codex` is not directly on your `PATH`.
- `CYBERBOSS_CLAUDE_COMMAND`
  Override the Claude launcher. Default is `claude`.
- `CYBERBOSS_CLAUDE_MODEL`
  Set the default Claude model.
- `CYBERBOSS_CLAUDE_CONTEXT_WINDOW`
  Set Claude's effective context window so `/status` can show an approximate context usage line.
- `CYBERBOSS_CLAUDE_PERMISSION_MODE`
  Set Claude's permission mode before the bridge starts.
- `CYBERBOSS_CLAUDE_DISABLE_VERBOSE`
  Disable verbose Claude terminal output.
- `CYBERBOSS_CLAUDE_EXTRA_ARGS`
  Append extra Claude CLI arguments as a comma-separated list.
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS`
  Reserve output tokens for Claude replies. `/status` subtracts this reserve from the configured Claude context window.
- `CYBERBOSS_WEIXIN_MIN_CHUNK_CHARS`
  Set the default minimum merge size for short WeChat reply chunks.
- `CYBERBOSS_WEIXIN_BASE_URL`, `CYBERBOSS_WEIXIN_CDN_BASE_URL`, `CYBERBOSS_WEIXIN_QR_BOT_TYPE`
  Override the WeChat bridge endpoints and QR bot type when your deployment needs it.

Why this matters:

- the first `cyberboss` command auto-generates `~/.cyberboss/weixin-instructions.md`
- if `CYBERBOSS_USER_NAME` and `CYBERBOSS_USER_GENDER` are missing, that generated persona file may start from the wrong assumptions

If you want the strongest "push" effect, do not immediately rewrite the persona template by hand. Let the agent develop its rhythm through real conversation first, then edit only the parts that are clearly wrong.

If you plan to use shared mode, set `CYBERBOSS_WORKSPACE_ROOT` before the first start so `shared:open` resolves the right thread for the right project.

When `CYBERBOSS_RUNTIME=claudecode`, Cyberboss also upserts a workspace-local `.mcp.json` entry for `cyberboss_tools` before starting Claude, and launches Claude with that MCP config explicitly attached. That is how Claude discovers the Cyberboss project tools without any global registration.

### Terminal commands for end users

- `npm run login`
  Log into WeChat and save the bot account locally
- `npm run accounts`
  List saved local accounts
- `npm run shared:start`
  Default startup path. Starts the shared runtime bridge and the shared WeChat bridge
- `npm run shared:open`
  Default attach path. Opens the bound shared thread in your terminal
- `npm run shared:status`
  Check the shared runtime process, shared bridge, and `readyz`
- `npm run doctor`
  Inspect current config, channel/runtime boundaries, and thread status
- `npm run help`
  Show stable command entrypoints

Here, `checkin` means the random wake-up mechanism, not a fixed periodic reminder.

Switch the runtime with `CYBERBOSS_RUNTIME`. You do not need a different command set for Claude Code.

`npm run start` and `npm run start:checkin` are still useful for minimal local debugging, but they are not the recommended way to observe or debug the real shared bridge workflow.

### WeChat commands for end users

- `/bind /absolute/path`
  Bind the current chat to a project workspace
- `/status`
  Show current workspace, thread, model, and context state
- `/new`
  Move to a new thread draft
- `/reread`
  Reload the latest persona template and operations template into the current thread
- `/compact`
  Ask the current thread to compact its context. The bridge sends a start message and a completion message back to WeChat.
- `/switch <threadId>`
  Switch to a specific thread
- `/stop`
  Stop the current running turn
- `/checkin <min>-<max>`
  Update the proactive random check-in range for the current project
- `/chunk <number>`
  Adjust the minimum merge size for short WeChat reply chunks
- `/yes`
  Allow the current approval once
- `/always`
  Keep allowing the same kind of command inside the current project
- `/no`
  Reject the current approval
- `/model`
  Show current model
- `/model <id>`
  Switch model
- `/star`
  Show the GitHub star guide inside WeChat
- `/help`
  Show WeChat command help

Plain text messages go directly to the bound thread. If nothing is bound yet, bind a workspace first:

```text
/bind /absolute/path
```

### Observe the same thread from WeChat and terminal

If you want WeChat and your local terminal to stay attached to the same shared thread, use shared mode:

Terminal 1:

```bash
npm run shared:start
```

Keep it running in the foreground.

Terminal 2:

```bash
npm run shared:open
```

Useful diagnostics:

- `npm run shared:status`

Notes:

- Shared mode is the default mode in this README
- The same WeChat commands and day-to-day behavior apply under both Codex and Claude Code
- If `CYBERBOSS_RUNTIME=claudecode`, the local Claude window works best as a listener for the shared thread
- Do not let WeChat attach to a private spawned runtime if you expect terminal and WeChat to watch the same thread
- Do not keep multiple `cyberboss` bridge processes alive at the same time
- Do not put `npm run shared:start` in the background; it is the main shared bridge process

<a id="data-dir"></a>
## Local Data

The default state directory is:

```text
${HOME}/.cyberboss
```

Common contents:

- `accounts/`
  WeChat bot account data
- `sessions.json`
  workspace, thread, model, and approval state
- `weixin-config.json`
  WeChat reply chunk configuration
- `sync-buffers/`
  WeChat long-poll synchronization buffers
- `inbox/`
  saved incoming WeChat images and attachments
- `weixin-instructions.md`
  local persona file generated on first run
- `reminder-queue.json`
  reminder queue
- `system-message-queue.json`
  system / check-in queue
- `deferred-system-replies.json`
  replies waiting for the next usable WeChat context token
- `checkin-config.json`
  saved proactive check-in range
- `timeline-screenshot-queue.json`
  screenshot job queue
- `diary/`
  local diary files
- `timeline/`
  timeline data, site, and screenshots
- `logs/`
  shared bridge and shared runtime logs

This is the runtime state directory, not your project workspace. The WeChat thread and the terminal thread should still be opened against your actual project directory.

<a id="agent-guide"></a>
## Agent Guide

Agent-facing Cyberboss capabilities are project-native structured tools.

### Common project tools

- `cyberboss_reminder_create`
- `cyberboss_diary_append`
- `cyberboss_timeline_write`
- `cyberboss_timeline_build`
- `cyberboss_timeline_serve`
- `cyberboss_timeline_dev`
- `cyberboss_timeline_screenshot`
- `cyberboss_channel_send_file`
- `cyberboss_system_send`

### Agent conventions

- Use Cyberboss project tools for diary, reminder, timeline, screenshot, and file-send operations
- Prefer documented lifecycle entrypoints from this README, `--help`, and [docs/commands.md](./docs/commands.md) for human terminal usage
- On first failure, report the concrete error before reading source code

## Docs

- [docs/commands.md](./docs/commands.md)

<a id="faq"></a>
## FAQ

### Why not `npm install cyberboss`?

Because the project is not published as an npm package yet. Clone the repo and run `npm install` inside it.

### What exactly is `checkin`?

`checkin` is the random wake-up mechanism. The system wakes the model at a random time and lets it decide whether to show up, stay silent, write data, or act.

### Why set user name and gender before the first run?

Because the first `cyberboss` command auto-generates `~/.cyberboss/weixin-instructions.md`. Setting `CYBERBOSS_USER_NAME` and `CYBERBOSS_USER_GENDER` first avoids obviously wrong persona assumptions in that file.

### Why not rewrite instructions aggressively from day one?

If you want the strongest "cyberboss" effect, let the agent grow its pacing through real interaction first. If you over-script it too early, it starts sounding like a workflow script instead of an active companion.

## License

This project is built for local-first personal deployment. It continuously processes private chat content, reminders, life traces, and other highly sensitive personal context. I do not want that workflow to be repackaged into a closed cloud service that hides both the code path and the data path from the user.

Because of that, this project is released under `AGPL-3.0-only`. If you modify it, extend it, and offer it to users over a network, you must provide the full corresponding source code under the AGPL terms.
