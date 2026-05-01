function parseDoctorOptions(argv = []) {
  const args = Array.isArray(argv) ? argv.slice(1) : [];
  const options = { json: false, network: false, unsafeVerbose: false, reportFile: "" };

  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim();
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--network") {
      options.network = true;
    } else if (arg === "--unsafe-verbose") {
      options.unsafeVerbose = true;
    } else if (arg === "--report") {
      options.reportFile = String(args[index + 1] || "").trim();
      index += 1;
    }
  }

  return options;
}

module.exports = { parseDoctorOptions };
