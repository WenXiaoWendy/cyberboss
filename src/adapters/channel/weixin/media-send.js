const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");

const { getUploadUrl, sendMessage } = require("./api");
const { getUploadUrlV2, sendMessageV2 } = require("./api-v2");
const { getMimeFromFilename } = require("./media-mime");

const WEIXIN_MEDIA_TYPE = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
};

function encryptAesEcb(plaintext, key) {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function aesEcbPaddedSize(plaintextSize) {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

function buildCdnUploadUrl({ cdnBaseUrl, uploadParam, filekey }) {
  return `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
}

async function uploadBufferToCdn({ buf, uploadParam, filekey, cdnBaseUrl, aeskey }) {
  const ciphertext = encryptAesEcb(buf, aeskey);
  const cdnUrl = buildCdnUploadUrl({ cdnBaseUrl, uploadParam, filekey });
  const response = await fetch(cdnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(ciphertext),
  });
  if (response.status !== 200) {
    const errMsg = response.headers.get("x-error-message") || await response.text();
    throw new Error(`CDN upload failed: ${errMsg || response.status}`);
  }
  const downloadParam = response.headers.get("x-encrypted-param") || "";
  if (!downloadParam) {
    throw new Error("CDN upload response missing x-encrypted-param header");
  }
  return { downloadParam };
}

async function uploadMediaToWeixin({ filePath, toUserId, opts, cdnBaseUrl, mediaType, getUploadUrlImpl }) {
  const plaintext = await fs.readFile(filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);

  const uploadUrlResp = await getUploadUrlImpl({
    ...opts,
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
  });

  const uploadParam = uploadUrlResp?.upload_param || "";
  if (!uploadParam) {
    throw new Error("getUploadUrl returned no upload_param");
  }

  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadParam,
    filekey,
    cdnBaseUrl,
    aeskey,
  });

  return {
    downloadEncryptedQueryParam: downloadParam,
    aeskey: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}

function buildMediaRef(uploaded) {
  return {
    encrypt_query_param: uploaded.downloadEncryptedQueryParam,
    aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
    encrypt_type: 1,
  };
}

async function sendMediaItem({ to, item, contextToken, baseUrl, token, routeTag = "", clientVersion = "", sendMessageImpl }) {
  await sendMessageImpl({
    baseUrl,
    token,
    routeTag,
    clientVersion,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: crypto.randomUUID(),
        message_type: 2,
        message_state: 2,
        item_list: [item],
        context_token: contextToken,
      },
    },
  });
}

function resolveWeixinMediaApi(apiVariant) {
  if (String(apiVariant || "").trim().toLowerCase() === "v2") {
    // Upload URL lookup and the final sendmessage call must stay on the same
    // v2 header stack as text polling/sending, or routed sessions may split
    // across gateways after login and fail only on attachments.
    return {
      getUploadUrlImpl: getUploadUrlV2,
      sendMessageImpl: sendMessageV2,
    };
  }
  return {
    getUploadUrlImpl: getUploadUrl,
    sendMessageImpl: sendMessage,
  };
}

async function sendWeixinMediaFile({
  filePath,
  to,
  contextToken,
  baseUrl,
  token,
  cdnBaseUrl,
  apiVariant = "legacy",
  routeTag = "",
  clientVersion = "",
}) {
  if (!contextToken) {
    throw new Error("sendWeixinMediaFile requires contextToken");
  }

  const mime = getMimeFromFilename(filePath);
  const uploadOpts = { baseUrl, token, routeTag, clientVersion };
  const { getUploadUrlImpl, sendMessageImpl } = resolveWeixinMediaApi(apiVariant);

  if (mime.startsWith("image/")) {
    const uploaded = await uploadMediaToWeixin({
      filePath,
      toUserId: to,
      opts: uploadOpts,
      cdnBaseUrl,
      mediaType: WEIXIN_MEDIA_TYPE.IMAGE,
      getUploadUrlImpl,
    });
    await sendMediaItem({
      to,
      contextToken,
      baseUrl,
      token,
      routeTag,
      clientVersion,
      sendMessageImpl,
      item: {
        type: 2,
        image_item: {
          media: buildMediaRef(uploaded),
          aeskey: uploaded.aeskey,
          mid_size: uploaded.fileSizeCiphertext,
          hd_size: uploaded.fileSizeCiphertext,
        },
      },
    });
    return { kind: "image", fileName: path.basename(filePath) };
  }

  if (mime.startsWith("video/")) {
    const uploaded = await uploadMediaToWeixin({
      filePath,
      toUserId: to,
      opts: uploadOpts,
      cdnBaseUrl,
      mediaType: WEIXIN_MEDIA_TYPE.VIDEO,
      getUploadUrlImpl,
    });
    await sendMediaItem({
      to,
      contextToken,
      baseUrl,
      token,
      routeTag,
      clientVersion,
      sendMessageImpl,
      item: {
        type: 5,
        video_item: {
          media: buildMediaRef(uploaded),
          video_size: uploaded.fileSizeCiphertext,
        },
      },
    });
    return { kind: "video", fileName: path.basename(filePath) };
  }

  const uploaded = await uploadMediaToWeixin({
    filePath,
    toUserId: to,
    opts: uploadOpts,
    cdnBaseUrl,
    mediaType: WEIXIN_MEDIA_TYPE.FILE,
    getUploadUrlImpl,
  });
  await sendMediaItem({
    to,
    contextToken,
    baseUrl,
    token,
    routeTag,
    clientVersion,
    sendMessageImpl,
    item: {
      type: 4,
      file_item: {
        media: buildMediaRef(uploaded),
        file_name: path.basename(filePath),
        len: String(uploaded.fileSize),
      },
    },
  });
  return { kind: "file", fileName: path.basename(filePath) };
}

module.exports = { sendWeixinMediaFile };
