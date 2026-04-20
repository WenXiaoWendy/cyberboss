# Commands

## Design Principles

`Cyberboss` does not hard-code one shared string format across terminal commands, WeChat commands, and different agent runtimes.

It defines stable internal actions first, then lets each channel expose its own entrypoints:

- core action: stable internal meaning
- terminal command: terminal entrypoint
- weixin command: WeChat entrypoint

This keeps the core naming stable when new runtimes or channels are added later.

The runtime can be `codex` or `claudecode`, but the documented command surface stays the same.

## Current Action Groups

### Lifecycle & Diagnostics

- `app.login`
- `app.accounts`
- `app.start`
- `app.shared_start`
- `app.shared_open`
- `app.shared_status`
- `app.doctor`

### Workspace & Thread

- `workspace.bind`
- `workspace.status`
- `thread.new`
- `thread.reread`
- `thread.compact`
- `thread.switch`
- `thread.stop`
- `system.checkin_range`
- `channel.chunk_min`

### Approvals & Control

- `approval.accept_once`
- `approval.accept_workspace`
- `approval.reject_once`

### Capabilities

- `model.inspect`
- `model.select`
- `channel.send_file`
- `timeline.write`
- `reminder.create`
- `diary.append`
- `app.star`
- `app.help`

## Current Terminal Commands

The intentionally small public set is:

- `npm run login`
- `npm run accounts`
- `npm run shared:start`
- `npm run shared:open`
- `npm run shared:status`
- `npm run doctor`
- `npm run help`

## Capability Commands

### channel

- `npm run channel:send-file -- --path /absolute/path`

Notes:
- Sends an existing local file back to the current WeChat chat
- `--user <wechatUserId>` can override the default receiver

### reminder

- `cyberboss reminder write --delay 30m --text "Reminder text"`
- `cyberboss reminder write --delay 1h30m --text "Reminder text"`
- `cyberboss reminder write --delay 20m --text-file /absolute/path/to/reminder.txt`
- `cyberboss reminder write --at "2026-04-07 21:30" --text "Reminder text"`

### diary

- `cyberboss diary write --title "Title" --text "Content"`
- `cyberboss diary write --date 2026-04-06 --title "4.6" --text-file /absolute/path/to/entry.md`

Notes:
- `--title` only affects the entry title
- `--date` decides which diary file to write into
- `--time` is optional and overrides the entry time

### system

- `cyberboss system send --text "System message"`
- `cyberboss system checkin-poller`

Notes:
- `checkin` is usually better started through shared mode: `npm run shared:start`
- `system:checkin` remains available as the low-level polling entrypoint

### timeline

- `cyberboss timeline write --date YYYY-MM-DD --events-file /absolute/path/to/events.json`
- `cyberboss timeline build`
- `cyberboss timeline serve`
- `cyberboss timeline dev`
- `cyberboss timeline screenshot --send`
- `cyberboss timeline serve --locale zh-CN`
- `cyberboss timeline screenshot --send --locale en`

Notes:
- `timeline:screenshot -- --send` queues the screenshot for the current WeChat bridge and automatically sends the result back to the current WeChat user.
- `TIMELINE_FOR_AGENT_LOCALE` supports `en` and `zh-CN` and controls the language of the timeline UI and screenshots.

All `reminder / diary / system / timeline` commands listed here are already usable.

## Current WeChat Commands

- `/bind`
- `/status`
- `/new`
- `/reread`
- `/compact`
- `/stop`
- `/switch <threadId>`
- `/checkin <min>-<max>`
- `/chunk <number>`
- `/yes`
- `/always`
- `/no`
- `/model`
- `/model <id>`
- `/star`
- `/help`

Notes:

- `/status` now covers what used to be split between `where` and `usage`
- there is currently no separate `/context` command; use `/status` and read the `📦 context` line
- `/compact` asks the current thread to compact its context and reports start / finish back to WeChat
- file sending is still available, but no longer exposed as a WeChat command
