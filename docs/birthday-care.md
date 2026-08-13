# Birthday Care

Birthday Care is a recurring relationship-care feature inside CyberBoss. It does not create a second notification channel. The bridge loop evaluates birthdays, writes deterministic internal triggers to the existing system-message queue, and lets the active agent/persona decide the final WeChat wording.

## Storage and privacy

The default store is `~/.cyberboss/birthday-care.json`, configurable through the normal `CYBERBOSS_STATE_DIR`. `CYBERBOSS_BIRTHDAY_TIMEZONE` defaults to `Asia/Shanghai`.

Friends and annual cycles are separate records. A friend contains the stable calendar date and care offsets. Each resolved solar occurrence has its own cycle with completion fields and per-stage `triggeredAt` / `sentAt` timestamps. Birthday Care never stores a delivery address; it stores only `addressAskedAt` for the annual cycle.

## Calendar policies

- Solar February 29 resolves to February 28 in non-leap years.
- Other impossible solar dates are rejected when saved.
- Lunar conversion uses `lunar-javascript`; every occurrence is recalculated for the target solar year.
- A lunar leap-month birthday uses the leap instance when that lunar year contains the requested leap month. In years without that leap month, it uses the regular instance of the same lunar month.
- Lunar day 30 in a 29-day month resolves to that month's final day. The annual cycle records the resolved solar date so the adjustment stays inspectable.
- A lunar occurrence that falls in January or February is associated with its resolved solar year, even when its source lunar year is the previous year.

## Due stages and catch-up

The default stages are preparation at T-7, gift follow-up at T-4, logistics/pickup at T-2, birthday at T0, and a light fallback after 18:00 local time on T0. Completed actions suppress their related stages.

When the app was offline, the due check chooses one currently useful stage per friend. It never emits all missed historical stages together. Trigger ids are deterministic:

`birthday:<friendId>:<resolvedSolarYear>:<stage>`

The system-message queue deduplicates ids, and the annual cycle persists trigger delivery state. This keeps repeated loops and process restarts idempotent.
