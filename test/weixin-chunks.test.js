const test = require("node:test");
const assert = require("node:assert/strict");

const {
  splitUtf8,
  normalizeWeixinReplyText,
  finalizeWeixinDeliveryChunk,
  stripChunkTailChineseFullStops,
  chunkReplyText,
  chunkReplyTextForWeixin,
  mergeShortChunks,
  packChunksForWeixinDelivery,
  splitTextAtBoundaries,
  findLastPreferredBoundary,
  collectStreamingBoundaries,
  findBoundaryPunctuationEnd,
  trimOuterBlankLines,
} = require("../src/adapters/channel/weixin/index");

test("normalizeWeixinReplyText trims outer blank lines but preserves internal blank lines", () => {
  const text = "line1\r\n\r\n\nline2\n\n\nline3";
  assert.equal(normalizeWeixinReplyText(text), "line1\n\n\nline2\n\n\nline3");
});

test("stripChunkTailChineseFullStops only removes a chunk-ending Chinese full stop", () => {
  assert.equal(stripChunkTailChineseFullStops("你好。"), "你好");
  assert.equal(stripChunkTailChineseFullStops("你好。。。"), "你好。。。");
  assert.equal(stripChunkTailChineseFullStops("你好。\n世界。"), "你好。\n世界");
  assert.equal(stripChunkTailChineseFullStops("你好。\""), "你好\"");
  assert.equal(stripChunkTailChineseFullStops("“dddd。”"), "“dddd”");
  assert.equal(stripChunkTailChineseFullStops("a。b。c。"), "a。b。c");
  assert.equal(stripChunkTailChineseFullStops("“无语。。。”"), "“无语。。。”");
});

test("finalizeWeixinDeliveryChunk preserves internal newlines and strips only the final Chinese full stop", () => {
  assert.equal(finalizeWeixinDeliveryChunk("A。\n\nB。"), "A。\n\nB");
  assert.equal(finalizeWeixinDeliveryChunk("A。\n\n"), "A");
  assert.equal(finalizeWeixinDeliveryChunk("真的吗???"), "真的吗???");
  assert.equal(finalizeWeixinDeliveryChunk("无语..."), "无语...");
  assert.equal(finalizeWeixinDeliveryChunk("救命……"), "救命……");
  assert.equal(finalizeWeixinDeliveryChunk("行吧。。。"), "行吧。。。");
});

test("collectStreamingBoundaries finds paragraph, list and punctuation breaks", () => {
  const text = "第一段。\n\n第二段\n- list1\n- list2\n最后！对吧？";
  const boundaries = collectStreamingBoundaries(text);
  assert.ok(boundaries.length > 0, "should find boundaries");
  assert.ok(boundaries.some((b) => b > 0), "should have positive boundaries");
  // paragraph break comes after the double newline
  assert.ok(boundaries.some((b) => b >= 6), "should break after paragraph");
  // list breaks
  assert.ok(boundaries.some((b) => b >= 10 && b < 17), "should break before first list item");
  assert.ok(boundaries.some((b) => b >= 17 && b < 24), "should break before second list item");
});

test("findBoundaryPunctuationEnd keeps repeated punctuation together", () => {
  assert.equal(findBoundaryPunctuationEnd("真的???下一句", 2), 5);
  assert.equal(findBoundaryPunctuationEnd("无语...下一句", 2), 5);
  assert.equal(findBoundaryPunctuationEnd("救命……下一句", 2), 4);
  assert.equal(findBoundaryPunctuationEnd("行吧。。。下一句", 2), 5);
});

test("findLastPreferredBoundary keeps the closing quote with a sentence-ending full stop", () => {
  const text = "1234567890“dddd。”\n12";
  assert.equal(findLastPreferredBoundary(text, 20, 8), 18);
});

test("findLastPreferredBoundary keeps repeated punctuation together", () => {
  assert.equal(findLastPreferredBoundary("1234567890???\n12", 20, 8), 14);
  assert.equal(findLastPreferredBoundary("1234567890...\n12", 20, 8), 14);
  assert.equal(findLastPreferredBoundary("1234567890。。。\n12", 20, 8), 14);
});

test("splitTextAtBoundaries preserves the original separators", () => {
  const text = "A。\n\nB。\nC。";
  const chunks = splitTextAtBoundaries(text, collectStreamingBoundaries(text));
  assert.deepEqual(chunks, ["A。\n\n", "B。\n", "C。"]);
});

test("chunkReplyText keeps the closing quote and newline when splitting near a quoted full stop", () => {
  const text = "1234567890“dddd。”\n1234567890";
  const chunks = chunkReplyText(text, 20);
  assert.deepEqual(chunks, ["1234567890“dddd。”\n", "1234567890"]);
});

test("chunkReplyText keeps repeated punctuation together when splitting", () => {
  assert.deepEqual(chunkReplyText("1234567890???\n1234567890", 20), ["1234567890???\n", "1234567890"]);
  assert.deepEqual(chunkReplyText("1234567890...\n1234567890", 20), ["1234567890...\n", "1234567890"]);
  assert.deepEqual(chunkReplyText("1234567890。。。\n1234567890", 20), ["1234567890。。。\n", "1234567890"]);
});

test("chunkReplyTextForWeixin merges short natural boundaries", () => {
  // Each unit is below MIN_WEIXIN_CHUNK (20), so they get merged
  const text = "A。\n\nB。\n\nC。";
  const chunks = chunkReplyTextForWeixin(text);
  assert.deepEqual(chunks, ["A。\n\nB。\n\nC。"]);
});

test("chunkReplyTextForWeixin does not merge chunks above min length", () => {
  const longA = "A".repeat(25) + "。";
  const longB = "B".repeat(25) + "。";
  const text = `${longA}\n\n${longB}`;
  const chunks = chunkReplyTextForWeixin(text);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], `${longA}\n\n`);
  assert.equal(chunks[1], longB);
});

test("chunkReplyTextForWeixin merges short adjacent chunks", () => {
  const text = ["短1", "短2", "这是一段比较长的话，不应该和前面的短句合并在一起"].join("\n\n");
  const chunks = chunkReplyTextForWeixin(text);
  assert.equal(chunks[0], "短1\n\n短2\n\n");
  assert.ok(!chunks[1].startsWith("短2"));
});

test("mergeShortChunks only merges when both sides are short", () => {
  const chunks = [`${"a".repeat(15)}\n\n`, `${"b".repeat(15)}\n`, "c".repeat(100)];
  const merged = mergeShortChunks(chunks, 3800, 20);
  assert.equal(merged[0], `${"a".repeat(15)}\n\n${"b".repeat(15)}\n`);
  assert.equal(merged[1], "c".repeat(100));
});

test("mergeShortChunks does not merge when one side is long", () => {
  const chunks = ["短", "c".repeat(100)];
  const merged = mergeShortChunks(chunks, 3800, 20);
  assert.equal(merged.length, 2);
  assert.equal(merged[0], "短");
  assert.equal(merged[1], "c".repeat(100));
});

test("packChunksForWeixinDelivery limits to maxMessages", () => {
  const chunks = Array.from({ length: 15 }, (_, i) => `chunk-${i}`);
  const packed = packChunksForWeixinDelivery(chunks, 10, 3800);
  assert.equal(packed.length, 10);
});

test("packChunksForWeixinDelivery groups tail when over limit", () => {
  const chunks = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
  const packed = packChunksForWeixinDelivery(chunks, 10, 3800);
  assert.equal(packed.length, 10);
  assert.equal(packed[0], "1");
  assert.ok(packed[9].includes("11") || packed[9].includes("12"));
});

test("splitUtf8 hard-truncates oversized text", () => {
  const text = "a".repeat(10_000);
  const chunks = splitUtf8(text, 3800);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 3800);
  assert.equal(chunks[1].length, 3800);
  assert.equal(chunks[2].length, 2400);
});

test("trimOuterBlankLines strips leading and trailing blank lines", () => {
  assert.equal(trimOuterBlankLines("\n\nhello\n\n"), "hello");
});
