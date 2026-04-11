# User Timezone Awareness Design

## Goal

Stop the assistant from making time-of-day mistakes such as telling the user to sleep at noon. The system should use a configured user timezone when presenting message timestamps to the runtime.

## Decision

Add a required config value:

- `CYBERBOSS_USER_TIMEZONE`

This value represents the user's current local timezone. If the user travels, they should update this value.

## Scope

Keep the change small.

In scope:

- read `CYBERBOSS_USER_TIMEZONE` from `.env`
- validate it as an IANA timezone
- use it when formatting inbound message timestamps for runtime prompt text
- replace the current implicit hardcoded timezone behavior

Out of scope:

- changing queue storage formats
- changing scheduling algorithms
- changing reminder timing behavior
- broader timeline refactors

## Prompt Format

Use a human-readable offset-based stamp in runtime-bound inbound text:

- `[2026-04-11 14:23 UTC+08:00]`

This keeps the time easy for the model to reason about while avoiding location anchoring from strings like `Asia/Shanghai`.

## Implementation Shape

1. Add `userTimezone` to config in `src/core/config.js`.
2. Validate the timezone once during config loading.
3. Add a small helper for formatting runtime-facing local timestamps.
4. Replace the hardcoded `Asia/Shanghai` formatting in `src/core/app.js` with the configured timezone.

## Travel Handling

`CYBERBOSS_USER_TIMEZONE` means the user's current timezone, not a permanent home timezone. When the user travels, they should update the config and restart or refresh the running session as needed.

## Success Criteria

- inbound runtime text shows local time with UTC offset
- no hardcoded Asia/Shanghai assumption remains in timestamp formatting
- the behavior is configured in one place
