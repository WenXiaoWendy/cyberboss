const { createCheck, createGroup } = require("../schema");

const TOOL_FAMILIES = [
  {
    id: "core",
    title: "Core project tools",
    required: true,
    tools: [
      "cyberboss_diary_append",
      "cyberboss_reminder_create",
      "cyberboss_system_send",
      "cyberboss_channel_send_file",
    ],
    active: () => true,
  },
  {
    id: "timeline",
    title: "Timeline project tools",
    tools: [
      "cyberboss_timeline_read",
      "cyberboss_timeline_categories",
      "cyberboss_timeline_proposals",
      "cyberboss_timeline_write",
      "cyberboss_timeline_build",
      "cyberboss_timeline_serve",
      "cyberboss_timeline_dev",
      "cyberboss_timeline_screenshot",
    ],
    active: ({ config, names }) => Boolean(config.timelineCommand) || names.some((name) => name.startsWith("cyberboss_timeline_")),
  },
  {
    id: "whereabouts",
    title: "Whereabouts project tools",
    tools: [
      "whereabouts_current_stay",
      "whereabouts_recent_stays",
      "whereabouts_recent_moves",
      "whereabouts_snapshot",
      "whereabouts_summary",
    ],
    active: ({ config, names }) => Boolean(config.startWithLocationServer || config.locationToken || config.locationStoreFile)
      || names.some((name) => name.startsWith("whereabouts_")),
  },
  {
    id: "stickers",
    title: "Sticker project tools",
    tools: [
      "cyberboss_sticker_tags",
      "cyberboss_sticker_pick",
      "cyberboss_sticker_send",
      "cyberboss_sticker_delete",
      "cyberboss_sticker_save_from_inbox",
      "cyberboss_sticker_update",
    ],
    active: ({ config, names }) => hasStickerConfig(config) || names.some((name) => name.startsWith("cyberboss_sticker_")),
  },
];

function runToolsChecks(context = {}) {
  const config = context.config || {};
  const loaded = loadToolNames(context);
  if (!loaded.ok) {
    return createGroup({
      id: "tools",
      title: "Project Tools",
      checks: [
        createCheck({
          id: "tools.registry.load_failed",
          title: "Project tool registry",
          status: "fail",
          category: "capability",
          evidence: { errorName: loaded.errorName, errorCode: loaded.errorCode },
        }),
      ],
    });
  }
  const names = loaded.names;
  const checks = TOOL_FAMILIES.map((family) => checkToolFamily(family, config, names));
  return createGroup({
    id: "tools",
    title: "Project Tools",
    checks,
  });
}

function loadToolNames(context) {
  if (Array.isArray(context.toolNames)) {
    return { ok: true, names: context.toolNames.filter((name) => typeof name === "string") };
  }
  try {
    const { listProjectToolNames } = require("../../tools/tool-host");
    return { ok: true, names: listProjectToolNames() };
  } catch (error) {
    return {
      ok: false,
      names: [],
      errorName: error?.name || "Error",
      errorCode: error?.code || "",
    };
  }
}

function checkToolFamily(family, config, names) {
  const active = Boolean(family.required || family.active({ config, names }));
  const missing = active ? family.tools.filter((name) => !names.includes(name)) : [];
  if (!active) {
    return createCheck({
      id: `tools.${family.id}.not_applicable`,
      title: family.title,
      status: "skip",
      category: "capability",
      evidence: { totalToolCount: names.length, expectedToolCount: family.tools.length },
    });
  }
  return createCheck({
    id: missing.length ? `tools.${family.id}.expected_missing` : `tools.${family.id}.expected_present`,
    title: family.title,
    status: missing.length ? "fail" : "ok",
    category: "capability",
    evidence: { totalToolCount: names.length, missing },
    recommendation: missing.length ? "Update tool registration or the active diagnostics capability profile." : "",
  });
}

function hasStickerConfig(config = {}) {
  return Boolean(
    config.stickersDir
      || config.stickerAssetsDir
      || config.stickersIndexFile
      || config.stickerTagsFile
      || config.stickersTemplateDir
      || config.stickersTemplateIndexFile
      || config.stickerTagsTemplateFile
  );
}

module.exports = { runToolsChecks };
