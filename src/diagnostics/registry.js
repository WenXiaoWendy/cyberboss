const { createGroup } = require("./schema");
const { createCheck } = require("./schema");

const GROUPS = [
  ["environment", "Environment", () => require("./checks/environment").runEnvironmentChecks],
  ["configuration", "Configuration", () => require("./checks/configuration").runConfigurationChecks],
  ["state", "State", () => require("./checks/state").runStateChecks],
  ["weixin", "WeChat", () => require("./checks/weixin").runWeixinChecks],
  ["shared", "Shared Mode", () => require("./checks/shared").runSharedChecks],
  ["runtime", "Runtime", () => require("./checks/runtime").runRuntimeChecks],
  ["threads", "Threads", () => require("./checks/threads").runThreadChecks],
  ["instructions", "Instructions", () => require("./checks/instructions").runInstructionsChecks],
  ["capabilities.timeline", "Timeline", () => require("./checks/capabilities").runTimelineCapabilityChecks],
  ["capabilities.whereabouts", "Whereabouts", () => require("./checks/capabilities").runWhereaboutsCapabilityChecks],
  ["capabilities.stickers", "Stickers", () => require("./checks/capabilities").runStickerCapabilityChecks],
  ["capabilities.checkin", "Check-in", () => require("./checks/capabilities").runCheckinCapabilityChecks],
  ["capabilities.diary_reminder_system", "Diary, Reminders, And System Queue", () => require("./checks/capabilities").runDiaryReminderSystemCapabilityChecks],
  ["tools", "Project Tools", () => require("./checks/tools").runToolsChecks],
  ["commands", "Commands", () => require("./checks/commands").runCommandChecks],
];

function getDoctorCheckGroups() {
  return GROUPS.map(([id, title, load]) => ({
    id,
    title,
    load,
  }));
}

async function runCheckGroup(spec, context) {
  const id = normalizeText(spec?.id) || "diagnostics";
  const title = normalizeText(spec?.title) || id;
  try {
    const runner = typeof spec?.run === "function"
      ? spec.run
      : typeof spec?.load === "function"
        ? spec.load()
        : null;
    if (typeof runner !== "function") {
      return createGroup({ id, title, checks: [] });
    }
    return await runner(context);
  } catch (error) {
    return createGroup({
      id,
      title,
      checks: [
        createCheck({
          id: "diagnostics.group.crashed",
          title: "Diagnostics group crashed",
          status: "fail",
          category: "diagnostics",
          evidence: {
            groupId: id,
            errorName: error?.name || "Error",
            errorCode: error?.code || "",
          },
          recommendation: "Inspect this diagnostics check implementation; other groups were still reported.",
        }),
      ],
    });
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { getDoctorCheckGroups, runCheckGroup };
