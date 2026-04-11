<div align="center">

[中文](./README.zh-CN.md) · English

# The Overbearing Boss Fell for My ADHD
## Cyberboss: a WeChat bridge built on Codex

> "Keep escaping into dopamine if you want. I'll still catch you at the next timestamp."

[![Node >=22](https://img.shields.io/badge/Node-22%2B-3C873A)](./package.json)
[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-b31b1b)](./LICENSE)
[![Runtime-Codex](https://img.shields.io/badge/Runtime-Codex-111827)](#technical-stack)
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
  <img src="./docs/images/IMG_0241.PNG" alt="Cyberboss demo 1" width="31%" />
  <img src="./docs/images/IMG_0244.PNG" alt="Cyberboss demo 2" width="31%" />
  <img src="./docs/images/IMG_0245.PNG" alt="Cyberboss demo 3" width="31%" />
</p>

Cyberboss is not another polite productivity timer. It is not a to-do list with better branding either.

It is an agent bridge that plugs Codex directly into WeChat and turns it into a time-aware, context-persistent accountability companion. It does not wait for you to "start a session". It watches the flow of your day, notices when you disappear, and decides when to show up again.

## Why Cyberboss?

For people with ADHD, or anyone who needs strong external accountability, most productivity tools fail for the same reason: they assume you still have enough executive function to remember to use them.

Cyberboss starts from a transfer of control.

- No manual start button
  It already lives inside the chat interface you actually open every day.
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
  Codex runtime plus a shared `codex app-server` for thread continuity, approvals, and tool execution.
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
- `codex` installed locally
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
CYBERBOSS_USER_TIMEZONE=Asia/Shanghai
CYBERBOSS_ALLOWED_USER_IDS=your_wechat_user_id
CYBERBOSS_WORKSPACE_ROOT=/absolute/path/to/your/project
```

`CYBERBOSS_USER_TIMEZONE` is required. Set it to the user's current IANA timezone. It controls how inbound message times are shown to the runtime. If the user travels to a new timezone, update it before continuing to use Cyberboss.

Common optional variables:

```dotenv
CYBERBOSS_ACCOUNT_ID=
CYBERBOSS_CODEX_ENDPOINT=ws://127.0.0.1:8765
CYBERBOSS_WEIXIN_ADAPTER=v2
```

Why this matters:

- the first `cyberboss` command auto-generates `~/.cyberboss/weixin-instructions.md`
- if `CYBERBOSS_USER_NAME` and `CYBERBOSS_USER_GENDER` are missing, that generated persona file may start from the wrong assumptions

If you want the strongest sense of pressure, do not rewrite the persona template by hand too early. Let the agent develop its rhythm through real conversation first, then edit only the parts that are clearly wrong.

If you plan to use shared mode, set `CYBERBOSS_WORKSPACE_ROOT` before the first start so `shared:open` resolves the right thread for the right project.

### Terminal commands for end users

- `npm run login`
  Log into WeChat and save the bot account locally
- `npm run accounts`
  List saved local accounts
- `npm run shared:start`
  Default startup path. Starts the shared `codex app-server` and the shared WeChat bridge
- `npm run shared:open`
  Default attach path. Opens the currently bound shared thread in your terminal
- `npm run shared:status`
  Check shared `app-server`, shared bridge, and `readyz`
- `npm run doctor`
  Inspect current config, channel/runtime boundaries, and thread status
- `npm run help`
  Show stable command entrypoints

Here, `checkin` means the random wake-up mechanism, not a fixed periodic reminder.

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
- `/switch <threadId>`
  Switch to a specific thread
- `/stop`
  Stop the current running turn
- `/yes`
  Allow the current approval once
- `/always`
  Persist approval for the same command prefix inside the current project
- `/no`
  Reject the current approval
- `/model`
  Show current model
- `/model <id>`
  Switch model
- `/help`
  Show WeChat command help

Plain text messages go directly to the currently bound thread. If nothing is bound yet, bind a workspace first:

```text
/bind /absolute/path
```

### Observe the same thread from WeChat and terminal

If you want WeChat and your local terminal to stay attached to the same Codex thread, use shared mode:

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
- Do not run a private spawned runtime for WeChat if you expect terminal and WeChat to watch the same thread
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
- `sync-buffers/`
  WeChat long-poll synchronization buffers
- `weixin-instructions.md`
  local persona file generated on first run
- `reminder-queue.json`
  reminder queue
- `system-message-queue.json`
  system / check-in queue
- `timeline-screenshot-queue.json`
  screenshot job queue
- `diary/`
  local diary files
- `timeline/`
  timeline data, site, and screenshots
- `logs/`
  shared bridge and shared app-server logs

This is the runtime state directory, not your project workspace. The WeChat thread and the terminal thread should still be opened against your actual project directory.

<a id="agent-guide"></a>
## Agent Guide

The following commands are primarily for agents and automations, not the main daily entrypoints for end users.

### Common agent commands

- `npm run reminder:write -- --delay 30m --text "Reminder text"`
  Write a reminder for the future self
- `npm run reminder:write -- --at "2026-04-07 21:30" --text "Reminder text"`
  Write a reminder at an explicit time
- `npm run diary:write -- --title Title --text "Content"`
  Write a local diary entry
- `npm run diary:write -- --date 2026-04-06 --title "4.6" --text "Content"`
  Write a diary entry into a specific date file
- `npm run timeline:write -- --date YYYY-MM-DD --stdin`
  Incrementally write timeline events
- `npm run timeline:build`
  Build the static timeline site
- `npm run timeline:serve`
  Start the static timeline site server
- `npm run timeline:dev`
  Start the hot-reload timeline dev server
- `npm --prefix "$CYBERBOSS_HOME" run timeline:screenshot -- --send`
  Stable screenshot entrypoint; queues the screenshot for the current WeChat bridge
- `npm run channel:send-file -- --path /absolute/path`
  Send an existing local file back to the current WeChat chat
- `npm run system:send -- --text "System message"`
  Inject a hidden system trigger into the local system queue
- `npm run system:checkin`
  Low-level random check-in entrypoint, mostly useful for debugging

### Agent conventions

- Prefer stable documented entrypoints from this README, `--help`, and [docs/commands.md](./docs/commands.md)
- If parameters are unclear, check `--help` first
- On first failure, report the concrete error before reading source code
- If the job is only to send a file or a screenshot back to WeChat, use the existing command instead of reaching into internal adapter methods

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

If you want the strongest Cyberboss effect, let the agent develop its pacing through real interaction first. If you over-script it too early, it starts sounding like a workflow script instead of an active companion.

## License

This project is built for local-first personal deployment. It continuously processes private chat content, reminders, life traces, and other highly sensitive personal context. I do not want that workflow to be repackaged into a closed cloud service that hides both the code path and the data path from the user.

Because of that, this project is released under `AGPL-3.0-only`. If you modify it, extend it, and offer it to users over a network, you must provide the full corresponding source code under the AGPL terms.
