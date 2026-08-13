# Optional Birthday Care integration

CyberBoss consumes the external, agent-agnostic [`birthday-care-agent`](https://github.com/Sylvia1817/birthday-care-agent) package. This repository owns only the adapter: tools, scheduling, queue insertion, feature isolation, migration from the earlier local prototype, and agent-operation guidance.

## Enable

Birthday Care is disabled by default so the upstream bridge behaves exactly as before.

```text
CYBERBOSS_ENABLE_BIRTHDAY_CARE=true
```

Optional settings:

- `CYBERBOSS_BIRTHDAY_TIMEZONE` defaults to `Asia/Shanghai`.
- `CYBERBOSS_BIRTHDAY_CHECK_INTERVAL_MS` defaults to one hour and never runs more often than once per minute.
- `CYBERBOSS_STATE_DIR` controls the private data location; the default file is `~/.cyberboss/birthday-care.json`.

The adapter checks at startup and then uses a cheap throttle inside the existing bridge loop. It does not recalculate birthdays on every long poll.

## Isolation and delivery

Initialization failure disables only Birthday Care and hides its tools. Scheduled failures are logged and contained; normal chat, timeline, diary, stickers, and ordinary reminders keep running.

The core returns deterministic structured events. CyberBoss inserts them into the existing system-message queue by event ID and marks the core action delivered only after queue insertion succeeds. The queue requeues failed runtime dispatches.

The active agent persona writes the final user-facing message. Internal event IDs and JSON are never shown.

## Privacy and migration

The data file is local/private and must never be committed. Birthday Care records only whether this year's address was asked; it never stores the address itself.

If the earlier CyberBoss-local prototype data format is detected, the adapter creates a `.pre-birthday-care-agent-v1.bak` backup and converts it once to the standalone `schemaVersion: 1` format before opening it.
