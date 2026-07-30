# Safe Beta mode

`CYBERBOSS_SAFE_BETA=true` enables the restricted text-only WeChat bridge profile.
Only the normalized string `true` enables it.

The profile is enforced in code:

- `start` and `shared:start` fail when `CYBERBOSS_ALLOWED_USER_IDS` is empty.
  `login` is the only allowlist exception.
- inbound senders are checked before message items are inspected; non-allowlisted
  senders, known group/public conversations, and every non-text item are dropped;
- check-in, random wake, location, system messages, reminders, diary, timeline,
  file send, stickers, whereabouts, and `cyberboss_tools` are disabled;
- Codex turns use `approvalPolicy=on-request` and
  `sandboxPolicy={type:"readOnly"}`. Read-only policy has no writable roots or
  network access; unexpected approval requests are declined instead of being
  auto-approved or forwarded to WeChat;
- the only MCP server is required `xingxing-memory`, with exactly `breath`,
  `recall`, `get_source`, `memory_trigger`, and `ferry` enabled. `handoff` is
  excluded. `ferry` is auto-approved only after the copy-based boundary check
  confirms that it does not change memory rows, source cache, handoff rows, the
  SQLite file, or auxiliary files;
- Memory MCP startup fails closed when the configured Python executable, Memory
  Agent source, MCP module, or SQLite database is missing. Its child environment
  is rebuilt from a small system allowlist and does not inherit Notion or Memory
  Agent environment variables.

## Local state and configuration

Set `CYBERBOSS_STATE_DIR` outside the repository. Its `.env` is loaded after the
repository `.env` and therefore has higher file priority; explicit process
environment variables remain highest priority. When a custom state directory is
configured, the default home `.cyberboss` directory is neither created nor
written by environment loading or command dispatch.

Required safe-Beta values:

```dotenv
CYBERBOSS_SAFE_BETA=true
CYBERBOSS_STATE_DIR=<absolute state directory>
CYBERBOSS_ALLOWED_USER_IDS=<single allowed sender id>
CYBERBOSS_MEMORY_PYTHON=<absolute python executable>
CYBERBOSS_MEMORY_AGENT_ROOT=<absolute memory-agent checkout>
CYBERBOSS_MEMORY_SQLITE=<absolute recall sqlite database>
CYBERBOSS_VISION_MODE=off
```

Do not place a Notion token, Memory Agent `.env`, account token, session, cookie,
or QR data in Cyberboss configuration.

## Offline validation

The following command validates paths and renders a redacted configuration and
process plan. It starts no process and opens no network connection:

```bash
npm run safe-beta:dry-run
```

The dry-run is not a login or bridge command. It is safe to run before the
operator reviews the configuration. Actual `login`, `start`, and `shared:start`
remain separate operator actions.
