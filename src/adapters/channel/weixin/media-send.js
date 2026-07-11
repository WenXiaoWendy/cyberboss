const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");

const { getUploadUrl, sendMessage } = require("./api");
const { getMimeFromFilename } = require("./media-mime");
const { redactSensitiveText } = require("./redact");

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
  const normalizedBaseUrl = String(cdnBaseUrl || "").trim().replace(/\/+$/g, "");
  if (!normalizedBaseUrl) {
    return "";
  }
  return `${normalizedBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
}

function appendUploadQueryParams(url, { uploadParam, filekey }) {
  const parsed = new URL(url);
  if (!parsed.searchParams.has("encrypted_query_param")) {
    parsed.searchParams.set("encrypted_query_param", uploadParam);
  }
  if (!parsed.searchParams.has("filekey")) {
    parsed.searchParams.set("filekey", filekey);
  }
  return parsed.toString();
}

function normalizeUploadUrlCandidate(value, { uploadParam, filekey }) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || !/^https?:\/\//i.test(text)) {
    return "";
  }
  try {
    return appendUploadQueryParams(text, { uploadParam, filekey });
  } catch {
    return "";
  }
}

function collectUploadUrlCandidates(uploadUrlResp, { cdnBaseUrl, uploadParam, filekey }) {
  const candidates = [];
  const push = (value) => {
    if (typeof value !== "string" || !value.trim()) {
      return;
    }
    candidates.push(value.trim());
  };

  for (const candidate of collectUploadUrlFields(uploadUrlResp)) {
    push(candidate);
  }

  for (const baseUrl of String(cdnBaseUrl || "").split(",")) {
    push(buildCdnUploadUrl({ cdnBaseUrl: baseUrl, uploadParam, filekey }));
  }

  return Array.from(new Set(candidates
    .map((candidate) => normalizeUploadUrlCandidate(candidate, { uploadParam, filekey }))
    .filter(Boolean)));
}

function collectUploadUrlFields(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 3) {
    return [];
  }
  const results = [];
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && /(?:^|_)(?:upload_?)?url$/i.test(key)) {
      results.push(item);
      continue;
    }
    if (item && typeof item === "object") {
      results.push(...collectUploadUrlFields(item, depth + 1));
    }
  }
  return results;
}

function summarizeUploadUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "(invalid-url)";
  }
}

function summarizeUploadResponseKeys(value, prefix = "", depth = 0) {
  if (!value || typeof value !== "object" || depth > 2) {
    return [];
  }
  const keys = [];
  for (const [key, item] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.push(fullKey);
    if (item && typeof item === "object" && !Array.isArray(item)) {
      keys.push(...summarizeUploadResponseKeys(item, fullKey, depth + 1));
    }
  }
  return keys;
}

async function uploadBufferToCdn({ buf, uploadUrls, aeskey }) {
  const ciphertext = encryptAesEcb(buf, aeskey);
  const urls = Array.isArray(uploadUrls) ? uploadUrls.filter(Boolean) : [];
  if (!urls.length) {
    throw new Error("No CDN upload URL candidates available");
  }

  const errors = [];
  for (const cdnUrl of urls) {
    try {
      const response = await fetch(cdnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
      });
      if (response.status !== 200) {
        const errMsg = response.headers.get("x-error-message") || await response.text();
        throw new Error(`http ${response.status}: ${redactSensitiveText(errMsg || "")}`);
      }
      const downloadParam = response.headers.get("x-encrypted-param") || "";
      if (!downloadParam) {
        throw new Error("missing x-encrypted-param header");
      }
      return { downloadParam };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${summarizeUploadUrl(cdnUrl)} => ${redactSensitiveText(message)}`);
    }
  }

  throw new Error(`CDN upload failed after ${urls.length} candidate(s): ${errors.join("; ")}`);
}

async function uploadMediaToWeixin({ filePath, toUserId, opts, cdnBaseUrl, mediaType }) {
  const plaintext = await fs.readFile(filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);

  const uploadUrlResp = await getUploadUrl({
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

  const uploadUrls = collectUploadUrlCandidates(uploadUrlResp, {
    cdnBaseUrl,
    uploadParam,
    filekey,
  });
  console.log(
    `[cyberboss] weixin upload candidates=${uploadUrls.map(summarizeUploadUrl).join(",") || "(none)"} responseKeys=${summarizeUploadResponseKeys(uploadUrlResp).join(",") || "(none)"}`
  );

  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadUrls,
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

async function sendMediaItem({ to, item, contextToken, baseUrl, token }) {
  await sendMessage({
    baseUrl,
    token,
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

async function sendWeixinMediaFile({ filePath, to, contextToken, baseUrl, token, cdnBaseUrl }) {
  if (!contextToken) {
    throw new Error("sendWeixinMediaFile requires contextToken");
  }

  const mime = getMimeFromFilename(filePath);
  const uploadOpts = { baseUrl, token };

  if (mime.startsWith("image/")) {
    const uploaded = await uploadMediaToWeixin({
      filePath,
      toUserId: to,
      opts: uploadOpts,
      cdnBaseUrl,
      mediaType: WEIXIN_MEDIA_TYPE.IMAGE,
    });
    await sendMediaItem({
      to,
      contextToken,
      baseUrl,
      token,
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
    });
    await sendMediaItem({
      to,
      contextToken,
      baseUrl,
      token,
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
  });
  await sendMediaItem({
    to,
    contextToken,
    baseUrl,
    token,
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

module.exports = {
  sendWeixinMediaFile,
  buildCdnUploadUrl,
  collectUploadUrlCandidates,
  collectUploadUrlFields,
};
