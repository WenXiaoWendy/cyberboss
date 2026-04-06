const STREAM_INTERVAL_MS = 1500;
const STREAM_MIN_DELTA_CHARS = 8;
const STREAM_TAIL_BUFFER_CHARS = 8;

class StreamDelivery {
  constructor({ channelAdapter, sessionStore }) {
    this.channelAdapter = channelAdapter;
    this.sessionStore = sessionStore;
    this.replyTargetByBindingKey = new Map();
    this.stateByThreadId = new Map();
  }

  setReplyTarget(bindingKey, target) {
    if (!bindingKey || !target?.userId || !target?.contextToken) {
      return;
    }
    this.replyTargetByBindingKey.set(bindingKey, {
      userId: String(target.userId).trim(),
      contextToken: String(target.contextToken).trim(),
    });
  }

  async handleRuntimeEvent(event) {
    const threadId = normalizeText(event?.payload?.threadId);
    if (!threadId) {
      return;
    }
    const state = this.ensureThreadState(threadId);
    switch (event.type) {
      case "runtime.turn.started":
        state.turnId = normalizeText(event.payload.turnId) || state.turnId;
        this.refreshBinding(state);
        return;
      case "runtime.reply.delta":
        this.upsertItem(state, {
          itemId: normalizeText(event.payload.itemId) || `item-${state.itemOrder.length + 1}`,
          text: normalizeText(event.payload.text),
          completed: false,
        });
        this.scheduleFlush(state);
        return;
      case "runtime.reply.completed":
        this.upsertItem(state, {
          itemId: normalizeText(event.payload.itemId) || `item-${state.itemOrder.length + 1}`,
          text: normalizeText(event.payload.text),
          completed: true,
        });
        this.scheduleFlush(state);
        return;
      case "runtime.turn.completed":
        state.turnId = normalizeText(event.payload.turnId) || state.turnId;
        return;
      case "runtime.turn.failed":
        this.disposeThreadState(threadId);
        return;
      default:
        return;
    }
  }

  async finishTurn({ threadId, finalText }) {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedFinalText = normalizeText(finalText);
    if (!normalizedThreadId || !normalizedFinalText) {
      return;
    }
    const state = this.ensureThreadState(normalizedThreadId);
    this.refreshBinding(state);
    if (!state.itemOrder.length) {
      this.upsertItem(state, {
        itemId: "final",
        text: normalizedFinalText,
        completed: true,
      });
    } else {
      const itemId = state.itemOrder[state.itemOrder.length - 1] || "final";
      this.setItemText(state, itemId, normalizedFinalText, true);
      for (const candidateId of state.itemOrder) {
        const item = state.items.get(candidateId);
        if (item) {
          item.completed = true;
        }
      }
    }
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    await this.flush(state, { force: true });
    this.disposeThreadState(normalizedThreadId);
  }

  ensureThreadState(threadId) {
    const existing = this.stateByThreadId.get(threadId);
    if (existing) {
      return existing;
    }
    const created = {
      threadId,
      bindingKey: "",
      replyTarget: null,
      turnId: "",
      itemOrder: [],
      items: new Map(),
      sentText: "",
      lastSentAt: 0,
      timer: null,
      sendChain: Promise.resolve(),
      streamingDisabled: false,
    };
    this.stateByThreadId.set(threadId, created);
    this.refreshBinding(created);
    return created;
  }

  refreshBinding(state) {
    const linked = this.sessionStore.findBindingForThreadId(state.threadId);
    if (!linked?.bindingKey) {
      return;
    }
    state.bindingKey = linked.bindingKey;
    const target = this.replyTargetByBindingKey.get(linked.bindingKey);
    if (target) {
      state.replyTarget = target;
    }
  }

  upsertItem(state, { itemId, text, completed }) {
    if (!text) {
      return;
    }
    if (!state.items.has(itemId)) {
      state.itemOrder.push(itemId);
      state.items.set(itemId, {
        text: "",
        completed: false,
      });
    }
    const current = state.items.get(itemId);
    current.text = mergeText(current.text, text);
    if (completed) {
      current.completed = true;
    }
  }

  setItemText(state, itemId, text, completed) {
    if (!text) {
      return;
    }
    if (!state.items.has(itemId)) {
      state.itemOrder.push(itemId);
      state.items.set(itemId, {
        text: "",
        completed: false,
      });
    }
    const current = state.items.get(itemId);
    current.text = text;
    current.completed = Boolean(completed);
  }

  scheduleFlush(state) {
    if (!state.replyTarget || state.streamingDisabled) {
      return;
    }
    if (state.timer) {
      return;
    }
    const elapsed = Date.now() - state.lastSentAt;
    const delay = state.lastSentAt ? Math.max(STREAM_INTERVAL_MS - elapsed, 200) : 300;
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.flush(state, { force: false });
    }, delay);
  }

  async flush(state, { force }) {
    if (!state.replyTarget || state.streamingDisabled) {
      return;
    }
    const stableText = buildStableText(state, { force });
    if (!stableText) {
      return;
    }
    if (state.sentText && !stableText.startsWith(state.sentText)) {
      state.streamingDisabled = true;
      return;
    }
    const delta = stableText.slice(state.sentText.length);
    if (!delta) {
      return;
    }
    if (!force && Array.from(delta).length < STREAM_MIN_DELTA_CHARS) {
      this.scheduleFlush(state);
      return;
    }
    state.sendChain = state.sendChain.then(async () => {
      await this.channelAdapter.sendText({
        userId: state.replyTarget.userId,
        text: delta,
        contextToken: state.replyTarget.contextToken,
      });
      state.sentText = stableText;
      state.lastSentAt = Date.now();
    }).catch(() => {});
    await state.sendChain;
  }

  disposeThreadState(threadId) {
    const state = this.stateByThreadId.get(threadId);
    if (!state) {
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
    }
    this.stateByThreadId.delete(threadId);
  }
}

function buildStableText(state, { force }) {
  const parts = [];
  for (const itemId of state.itemOrder) {
    const item = state.items.get(itemId);
    if (!item?.text) {
      continue;
    }
    if (item.completed || force) {
      parts.push(item.text.trim());
      continue;
    }
    const stablePrefix = extractStablePrefix(item.text);
    if (stablePrefix) {
      parts.push(stablePrefix.trim());
    }
    break;
  }
  return parts.filter(Boolean).join("\n\n").trim();
}

function extractStablePrefix(text) {
  const value = normalizeText(text);
  if (!value) {
    return "";
  }
  const runes = Array.from(value);
  if (runes.length <= STREAM_MIN_DELTA_CHARS) {
    return "";
  }
  const cutoff = Math.max(0, runes.length - STREAM_TAIL_BUFFER_CHARS);
  const candidate = runes.slice(0, cutoff).join("");
  const boundaryIndex = findLastStableBoundary(candidate);
  if (boundaryIndex <= 0) {
    return "";
  }
  return candidate.slice(0, boundaryIndex).trim();
}

function findLastStableBoundary(text) {
  const matches = [...String(text || "").matchAll(/[\n。！？!?；;]\s*/g)];
  if (!matches.length) {
    return 0;
  }
  const last = matches[matches.length - 1];
  return last.index + last[0].length;
}

function mergeText(previous, incoming) {
  const left = normalizeText(previous);
  const right = normalizeText(incoming);
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (right.startsWith(left)) {
    return right;
  }
  if (left.startsWith(right)) {
    return left;
  }
  const maxOverlap = Math.min(left.length, right.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) {
      return left + right.slice(size);
    }
  }
  return left + right;
}

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

module.exports = { StreamDelivery };
