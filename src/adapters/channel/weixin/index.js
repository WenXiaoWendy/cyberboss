const crypto = require("crypto");
const { listWeixinAccounts, resolveSelectedAccount } = require("./account-store");
const { loadPersistedContextTokens, persistContextToken } = require("./context-token-store");
const { runLoginFlow } = require("./login");
const { getConfig, sendTyping } = require("./api");
const { getUpdatesV2, sendTextV2 } = require("./api-v2");
const { createLegacyWeixinChannelAdapter } = require("./legacy");
const { createInboundFilter } = require("./message-utils-v2");
const { sendWeixinMediaFile } = require("./media-send");
const { loadSyncBuffer, saveSyncBuffer } = require("./sync-buffer-store");

const LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_WEIXIN_CHUNK = 3800;
const SEND_MESSAGE_CHUNK_INTERVAL_MS = 350;
const WEIXIN_MAX_DELIVERY_MESSAGES = 10;

function createWeixinChannelAdapter(config) {
  const variant = normalizeAdapterVariant(config.weixinAdapterVariant);
  if (variant === "legacy") {
    return createLegacyWeixinChannelAdapter(config);
  }

  let selectedAccount = null;
  let contextTokenCache = null;
  const inboundFilter = createInboundFilter();

  function ensureAccount() {
    if (!selectedAccount) {
      selectedAccount = resolveSelectedAccount(config);
      contextTokenCache = loadPersistedContextTokens(config, selectedAccount.accountId);
    }
    return selectedAccount;
  }

  function ensureContextTokenCache() {
    if (!contextTokenCache) {
      const account = ensureAccount();
      contextTokenCache = loadPersistedContextTokens(config, account.accountId);
    }
    return contextTokenCache;
  }

  function rememberContextToken(userId, contextToken) {
    const account = ensureAccount();
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    const normalizedToken = typeof contextToken === "string" ? contextToken.trim() : "";
    if (!normalizedUserId || !normalizedToken) {
      return "";
    }
    contextTokenCache = persistContextToken(config, account.accountId, normalizedUserId, normalizedToken);
    return normalizedToken;
  }

  function resolveContextToken(userId, explicitToken = "") {
    const normalizedExplicitToken = typeof explicitToken === "string" ? explicitToken.trim() : "";
    if (normalizedExplicitToken) {
      return normalizedExplicitToken;
    }
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    if (!normalizedUserId) {
      return "";
    }
    return ensureContextTokenCache()[normalizedUserId] || "";
  }

  function sendTextChunks({ userId, text, contextToken = "", preserveBlock = false }) {
    const account = ensureAccount();
    const resolvedToken = resolveContextToken(userId, contextToken);
    if (!resolvedToken) {
      throw new Error(`Missing context_token. Cannot reply to user ${userId}.`);
    }
    const content = String(text || "");
    if (!content.trim()) {
      return Promise.resolve();
    }
    const sendChunks = preserveBlock
      ? splitUtf8(compactPlainTextForWeixin(content) || "Completed.", MAX_WEIXIN_CHUNK)
      : packChunksForWeixinDelivery(
        chunkReplyTextForWeixin(content).length
          ? chunkReplyTextForWeixin(content)
          : ["Completed."],
        WEIXIN_MAX_DELIVERY_MESSAGES,
        MAX_WEIXIN_CHUNK
      );
    return sendChunks.reduce((promise, chunk, index) => promise
      .then(() => {
        const compactChunk = stripSentenceTailChineseFullStops(compactPlainTextForWeixin(chunk)) || "Completed.";
        return sendTextV2({
          baseUrl: account.baseUrl,
          token: account.token,
          toUserId: userId,
          text: compactChunk,
          contextToken: resolvedToken,
          clientId: `cb-${crypto.randomUUID()}`,
        });
      })
      .then(() => {
        if (index < sendChunks.length - 1) {
          return sleep(SEND_MESSAGE_CHUNK_INTERVAL_MS);
        }
        return null;
      }), Promise.resolve());
  }

  return {
    describe() {
      return {
        id: "weixin",
        variant: "v2",
        kind: "channel",
        stateDir: config.stateDir,
        baseUrl: config.weixinBaseUrl,
        accountsDir: config.accountsDir,
        syncBufferDir: config.syncBufferDir,
      };
    },
    async login() {
      await runLoginFlow(config);
    },
    printAccounts() {
      const accounts = listWeixinAccounts(config);
      if (!accounts.length) {
        console.log("No saved WeChat account found. Run `npm run login` first.");
        return;
      }
      console.log("Saved accounts:");
      for (const account of accounts) {
        console.log(`- ${account.accountId}`);
        console.log(`  userId: ${account.userId || "(unknown)"}`);
        console.log(`  baseUrl: ${account.baseUrl || config.weixinBaseUrl}`);
        console.log(`  savedAt: ${account.savedAt || "(unknown)"}`);
      }
    },
    resolveAccount() {
      return ensureAccount();
    },
    getKnownContextTokens() {
      return { ...ensureContextTokenCache() };
    },
    loadSyncBuffer() {
      const account = ensureAccount();
      return loadSyncBuffer(config, account.accountId);
    },
    saveSyncBuffer(buffer) {
      const account = ensureAccount();
      saveSyncBuffer(config, account.accountId, buffer);
    },
    rememberContextToken,
    async getUpdates({ syncBuffer = "", timeoutMs = LONG_POLL_TIMEOUT_MS } = {}) {
      const account = ensureAccount();
      const response = await getUpdatesV2({
        baseUrl: account.baseUrl,
        token: account.token,
        getUpdatesBuf: syncBuffer,
        timeoutMs,
      });
      if (typeof response?.get_updates_buf === "string" && response.get_updates_buf.trim()) {
        this.saveSyncBuffer(response.get_updates_buf.trim());
      }
      const messages = Array.isArray(response?.msgs) ? response.msgs : [];
      for (const message of messages) {
        const userId = typeof message?.from_user_id === "string" ? message.from_user_id.trim() : "";
        const contextToken = typeof message?.context_token === "string" ? message.context_token.trim() : "";
        if (userId && contextToken) {
          rememberContextToken(userId, contextToken);
        }
      }
      return response;
    },
    normalizeIncomingMessage(message) {
      const account = ensureAccount();
      return inboundFilter.normalize(message, config, account.accountId);
    },
    async sendText({ userId, text, contextToken = "", preserveBlock = false }) {
      await sendTextChunks({ userId, text, contextToken, preserveBlock });
    },
    async sendTyping({ userId, status = 1, contextToken = "" }) {
      const account = ensureAccount();
      const resolvedToken = resolveContextToken(userId, contextToken);
      if (!resolvedToken) {
        return;
      }
      const configResponse = await getConfig({
        baseUrl: account.baseUrl,
        token: account.token,
        ilinkUserId: userId,
        contextToken: resolvedToken,
      }).catch(() => null);
      const typingTicket = typeof configResponse?.typing_ticket === "string"
        ? configResponse.typing_ticket.trim()
        : "";
      if (!typingTicket) {
        return;
      }
      await sendTyping({
        baseUrl: account.baseUrl,
        token: account.token,
        body: {
          ilink_user_id: userId,
          typing_ticket: typingTicket,
          status,
        },
      });
    },
    async sendFile({ userId, filePath, contextToken = "" }) {
      const account = ensureAccount();
      const resolvedToken = resolveContextToken(userId, contextToken);
      if (!resolvedToken) {
        throw new Error(`Missing context_token. Cannot send a file to user ${userId}.`);
      }
      return sendWeixinMediaFile({
        filePath,
        to: userId,
        contextToken: resolvedToken,
        baseUrl: account.baseUrl,
        token: account.token,
        cdnBaseUrl: config.weixinCdnBaseUrl,
      });
    },
  };
}

function normalizeAdapterVariant(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "legacy" ? "legacy" : "v2";
}

function splitUtf8(text, maxRunes) {
  const runes = Array.from(String(text || ""));
  if (!runes.length || runes.length <= maxRunes) {
    return [String(text || "")];
  }
  const chunks = [];
  while (runes.length) {
    chunks.push(runes.splice(0, maxRunes).join(""));
  }
  return chunks;
}

function compactPlainTextForWeixin(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  return trimOuterBlankLines(normalized.replace(/\n\s*\n+/g, "\n"));
}

function stripSentenceTailChineseFullStops(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.replace(/。+(?=(?:\s*["'”’）)\]」』】])*\s*$)/u, ""))
    .join("\n");
}

function chunkReplyText(text, limit = 3500) {
  const normalized = trimOuterBlankLines(String(text || "").replace(/\r\n/g, "\n"));
  if (!normalized.trim()) {
    return [];
  }

  const chunks = [];
  let remaining = normalized;
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit);
    const splitIndex = Math.max(
      candidate.lastIndexOf("\n\n"),
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf(" ")
    );
    const cut = splitIndex > limit * 0.4 ? splitIndex + (candidate[splitIndex] === "\n" ? 0 : 1) : limit;
    const chunk = trimOuterBlankLines(remaining.slice(0, cut));
    if (chunk.trim()) {
      chunks.push(chunk);
    }
    remaining = trimOuterBlankLines(remaining.slice(cut));
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks.filter(Boolean);
}

function chunkReplyTextForWeixin(text) {
  const normalized = trimOuterBlankLines(String(text || "").replace(/\r\n/g, "\n"));
  if (!normalized.trim()) {
    return [];
  }

  const boundaries = collectStreamingBoundaries(normalized);
  if (!boundaries.length) {
    return chunkReplyText(normalized, MAX_WEIXIN_CHUNK);
  }

  const units = [];
  let start = 0;
  for (const boundary of boundaries) {
    if (boundary <= start) {
      continue;
    }
    const unit = trimOuterBlankLines(normalized.slice(start, boundary));
    if (unit) {
      units.push(unit);
    }
    start = boundary;
  }

  const tail = trimOuterBlankLines(normalized.slice(start));
  if (tail) {
    units.push(tail);
  }

  if (!units.length) {
    return chunkReplyText(normalized, MAX_WEIXIN_CHUNK);
  }

  const chunks = [];
  for (const unit of units) {
    if (unit.length <= MAX_WEIXIN_CHUNK) {
      chunks.push(unit);
      continue;
    }
    chunks.push(...chunkReplyText(unit, MAX_WEIXIN_CHUNK));
  }
  return chunks.filter(Boolean);
}

function packChunksForWeixinDelivery(chunks, maxMessages = 10, maxChunkChars = 3800) {
  const normalizedChunks = Array.isArray(chunks)
    ? chunks.map((chunk) => compactPlainTextForWeixin(chunk)).filter(Boolean)
    : [];
  if (!normalizedChunks.length || normalizedChunks.length <= maxMessages) {
    return normalizedChunks;
  }

  const packed = normalizedChunks.slice(0, Math.max(0, maxMessages - 1));
  const tailChunks = normalizedChunks.slice(Math.max(0, maxMessages - 1));
  if (!tailChunks.length) {
    return packed;
  }

  const tailText = compactPlainTextForWeixin(tailChunks.join("\n")) || "Completed.";
  if (tailText.length <= maxChunkChars) {
    packed.push(tailText);
    return packed;
  }

  const tailHardChunks = splitUtf8(tailText, maxChunkChars);
  if (tailHardChunks.length === 1) {
    packed.push(tailHardChunks[0]);
    return packed;
  }

  const preserveCount = Math.max(0, maxMessages - tailHardChunks.length);
  const preserved = normalizedChunks.slice(0, preserveCount);
  const rebundledTail = normalizedChunks.slice(preserveCount);
  const groupedTail = [];
  let current = "";
  for (const chunk of rebundledTail) {
    const joined = current ? `${current}\n${chunk}` : chunk;
    if (current && joined.length > maxChunkChars) {
      groupedTail.push(current);
      current = chunk;
      continue;
    }
    current = joined;
  }
  if (current) {
    groupedTail.push(current);
  }

  return preserved.concat(groupedTail.map((item) => compactPlainTextForWeixin(item) || "Completed.")).slice(0, maxMessages);
}

function collectStreamingBoundaries(text) {
  const boundaries = new Set();

  const regex = /\n\s*\n+/g;
  let match = regex.exec(text);
  while (match) {
    boundaries.add(match.index + match[0].length);
    match = regex.exec(text);
  }

  const listRegex = /\n(?:(?:[-*])\s+|(?:\d+\.)\s+)/g;
  match = listRegex.exec(text);
  while (match) {
    boundaries.add(match.index + 1);
    match = listRegex.exec(text);
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!/[。！？!?]/.test(char)) {
      continue;
    }

    let end = index + 1;
    while (end < text.length && /["'”’）)\]」』】]/.test(text[end])) {
      end += 1;
    }
    while (end < text.length && /[\t \n]/.test(text[end])) {
      end += 1;
    }
    boundaries.add(end);
  }

  return Array.from(boundaries).sort((left, right) => left - right);
}

function trimOuterBlankLines(text) {
  return String(text || "")
    .replace(/^\s*\n+/g, "")
    .replace(/\n+\s*$/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { createWeixinChannelAdapter };
