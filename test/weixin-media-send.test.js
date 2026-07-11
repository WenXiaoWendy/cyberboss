const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCdnUploadUrl,
  collectUploadUrlFields,
  collectUploadUrlCandidates,
} = require("../src/adapters/channel/weixin/media-send");

test("buildCdnUploadUrl trims trailing slashes from the configured CDN base", () => {
  assert.equal(
    buildCdnUploadUrl({
      cdnBaseUrl: "https://cdn.example.com/c2c///",
      uploadParam: "a/b+c",
      filekey: "file key",
    }),
    "https://cdn.example.com/c2c/upload?encrypted_query_param=a%2Fb%2Bc&filekey=file%20key",
  );
});

test("collectUploadUrlCandidates prefers response upload URLs and supports comma-separated CDN fallbacks", () => {
  const candidates = collectUploadUrlCandidates({
    upload_url: "https://fresh.example.com/upload",
  }, {
    cdnBaseUrl: "https://old-a.example.com/c2c, https://old-b.example.com/c2c",
    uploadParam: "param",
    filekey: "key",
  });

  assert.deepEqual(candidates, [
    "https://fresh.example.com/upload?encrypted_query_param=param&filekey=key",
    "https://old-a.example.com/c2c/upload?encrypted_query_param=param&filekey=key",
    "https://old-b.example.com/c2c/upload?encrypted_query_param=param&filekey=key",
  ]);
});

test("collectUploadUrlFields finds nested response upload URL fields", () => {
  assert.deepEqual(
    collectUploadUrlFields({
      ret: 0,
      data: {
        cdn_upload_url: "https://nested.example.com/upload",
      },
    }),
    ["https://nested.example.com/upload"],
  );
});
