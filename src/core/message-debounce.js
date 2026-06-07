const fs = require("fs");

/**
 * 消息防抖：同一 userId 的消息进入队列，静默 timeoutMs 后将队列内
 * 所有文本换行拼接，作为一条消息交给 onFlush 处理。
 *
 * - 每条新消息重置计时
 * - 从第一条消息入队开始计时，超过 maxWaitMs 强制 flush 不再重置
 * - setTimeout 回调内包 try-catch，异常写 crashLogPath
 * - destroy() 清理所有 timer（shutdown 时调用）
 *
 * 带有 attachments 或以 "/" 开头（命令）的消息不进入队列，
 * 返回 { enqueued: false } 让调用方透传；如果此时队列非空则先 flush 积压文本。
 */
function createMessageDebouncer({ timeoutMs, maxWaitMs, onFlush, crashLogPath }) {
  const pending = new Map();

  function destroy() {
    for (const entry of pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    pending.clear();
  }

  function startTimer(userId) {
    const entry = pending.get(userId);
    if (!entry) return;

    console.log(`[cyberboss] debounce startTimer userId=${userId} queueLen=${entry.queue.length} timeoutMs=${timeoutMs}`);

    entry.timer = setTimeout(async () => {
      try {
        const { queue, normalized } = entry;
        pending.delete(userId);
        const mergedText = queue.join("\n");
        console.log(`[cyberboss] debounce FIRE userId=${userId} queueLen=${queue.length} text="${mergedText.slice(0, 80)}"`);
        await onFlush({ ...normalized, text: mergedText, attachments: [] });
      } catch (error) {
        const message = error?.stack || error?.message || String(error);
        console.error(`[cyberboss] debounce timer error: ${message}`);
        try {
          fs.appendFileSync(
            crashLogPath,
            `[${new Date().toISOString()}] message-debounce timer: ${message}\n`
          );
        } catch {
          // 写 crash.log 失败只能吞掉
        }
      }
    }, timeoutMs);
  }

  /**
   * 将一条消息入队或立即透传。
   *
   * @param {string} userId
   * @param {object} normalized
   * @returns {Promise<{ enqueued: boolean }>}
   */
  async function enqueue(userId, normalized) {
    if (!userId || !normalized) {
      console.log(`[cyberboss] debounce enqueue SKIP: userId=${userId} normalized=${!!normalized}`);
      return { enqueued: false };
    }

    const hasAttachments =
      Array.isArray(normalized.attachments) && normalized.attachments.length > 0;

    const rawText = String(normalized.text || "").trim();
    const isCommand = rawText.startsWith("/");

    if (hasAttachments || isCommand) {
      console.log(`[cyberboss] debounce enqueue ATTACH/CMD userId=${userId} hasAttach=${hasAttachments} isCmd=${isCommand} text="${rawText.slice(0, 40)}"`);
      const existing = pending.get(userId);
      if (existing) {
        clearTimeout(existing.timer);
        const merged = {
          ...existing.normalized,
          text: existing.queue.join("\n"),
          attachments: [],
        };
        pending.delete(userId);
        console.log(`[cyberboss] debounce FLUSH-PENDING userId=${userId} flushedQueueLen=${existing.queue.length}`);
        await onFlush(merged);
      }
      return { enqueued: false };
    }

    if (!rawText) {
      console.log(`[cyberboss] debounce enqueue SKIP: empty text userId=${userId}`);
      return { enqueued: false };
    }

    const existing = pending.get(userId);

    if (!existing) {
      console.log(`[cyberboss] debounce enqueue FIRST userId=${userId} text="${rawText.slice(0, 40)}"`);
      const entry = { queue: [rawText], timer: null, firstAt: Date.now(), normalized };
      pending.set(userId, entry);
      startTimer(userId);
      return { enqueued: true };
    }

    if (Date.now() - existing.firstAt > maxWaitMs) {
      console.log(`[cyberboss] debounce enqueue MAXWAIT userId=${userId} elapsed=${Date.now() - existing.firstAt}ms`);
      clearTimeout(existing.timer);
      existing.queue.push(rawText);
      const merged = {
        ...normalized,
        text: existing.queue.join("\n"),
        attachments: [],
      };
      pending.delete(userId);
      await onFlush(merged);
      return { enqueued: true };
    }

    console.log(`[cyberboss] debounce enqueue RESET userId=${userId} queueLen=${existing.queue.length + 1} text="${rawText.slice(0, 40)}"`);
    existing.queue.push(rawText);
    existing.normalized = normalized;
    clearTimeout(existing.timer);
    startTimer(userId);
    return { enqueued: true };
  }

  return { enqueue, destroy };
}

module.exports = { createMessageDebouncer };
