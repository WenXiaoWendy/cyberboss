const TEXT_ITEM_TYPE = 1;
const VOICE_ITEM_TYPE = 3;
const BOT_MESSAGE_TYPE = 2;

function normalizeWeixinIncomingMessage(message, config, accountId) {
  if (!message || typeof message !== "object") {
    return null;
  }
  if (Number(message.message_type) === BOT_MESSAGE_TYPE) {
    return null;
  }

  const senderId = normalizeText(message.from_user_id);
  if (!senderId) {
    return null;
  }

  const text = extractTextBody(message.item_list);
  if (!text) {
    return null;
  }

  return {
    provider: "weixin",
    accountId,
    workspaceId: config.workspaceId,
    senderId,
    chatId: senderId,
    messageId: normalizeText(message.message_id),
    threadKey: normalizeText(message.session_id),
    text,
    contextToken: normalizeText(message.context_token),
    receivedAt: new Date().toISOString(),
  };
}

function extractTextBody(itemList) {
  if (!Array.isArray(itemList) || !itemList.length) {
    return "";
  }

  for (const item of itemList) {
    if (Number(item?.type) === TEXT_ITEM_TYPE && typeof item?.text_item?.text === "string") {
      return item.text_item.text.trim();
    }
    if (Number(item?.type) === VOICE_ITEM_TYPE && typeof item?.voice_item?.text === "string") {
      return item.voice_item.text.trim();
    }
  }

  return "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  normalizeWeixinIncomingMessage,
};
