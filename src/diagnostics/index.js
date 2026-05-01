const { getDoctorCheckGroups, runCheckGroup } = require("./registry");
const { summarizeGroups } = require("./schema");

async function runDoctor(config, options = {}) {
  const context = {
    config: config || {},
    options: {
      json: Boolean(options.json),
      network: Boolean(options.network),
      unsafeVerbose: Boolean(options.unsafeVerbose),
      reportFile: typeof options.reportFile === "string" ? options.reportFile : "",
    },
    now: typeof options.now === "function" ? options.now : () => new Date(),
    networkProbe: typeof options.networkProbe === "function" ? options.networkProbe : null,
  };
  const groups = [];
  const specs = Array.isArray(options.checkGroups) ? options.checkGroups : getDoctorCheckGroups();
  for (const spec of specs) {
    groups.push(await runCheckGroup(spec, context));
  }

  return {
    schemaVersion: 1,
    generatedAt: context.now().toISOString(),
    options: {
      network: context.options.network,
      unsafeVerbose: context.options.unsafeVerbose,
    },
    summary: summarizeGroups(groups),
    environment: {},
    groups,
  };
}

module.exports = { runDoctor };
