const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { buildCliLaunchSpec } = require("../scripts/cli-launch");
const { loadCyberbossEnv } = require("../src/core/env-loader");

const ROOT = path.resolve(__dirname, "..");
const NPM_CLI = process.env.npm_execpath
  || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

function createFixture(t, label = "state with spaces 星星") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-state-launch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, label);
  const defaultHome = path.join(root, "home");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(defaultHome, { recursive: true });
  fs.writeFileSync(path.join(stateDir, ".env"), [
    "CYBERBOSS_SAFE_BETA=true",
    `CYBERBOSS_STATE_DIR=${stateDir}`,
    "CYBERBOSS_ALLOWED_USER_IDS=test-user",
  ].join("\n"));
  fs.writeFileSync(path.join(root, ".env"), `CYBERBOSS_STATE_DIR=${stateDir}\n`);
  const launcher = path.join(ROOT, "scripts", "cli-launch.js").replace(/\\/g, "/");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    private: true,
    scripts: {
      login: `node "${launcher}" login`,
      accounts: `node "${launcher}" accounts`,
      start: `node "${launcher}" start`,
      "shared:start": `node "${launcher}" shared:start`,
    },
  }));
  return {
    root,
    stateDir,
    defaultHome,
    defaultStateDir: path.join(defaultHome, ".cyberboss"),
  };
}

function safeEnv(fixture, overrides = {}) {
  const env = {
    ...process.env,
    HOME: fixture.defaultHome,
    USERPROFILE: fixture.defaultHome,
    CYBERBOSS_SAFE_BETA: "true",
    CYBERBOSS_STATE_DIR: fixture.stateDir,
    CYBERBOSS_ALLOWED_USER_IDS: "test-user",
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) {
      delete env[name];
    }
  }
  return env;
}

function runNpmPreflight(script, fixture, overrides = {}) {
  return spawnSync(
    process.execPath,
    [NPM_CLI, "run", script, "--", "--state-dir-preflight-only"],
    {
      cwd: fixture.root,
      env: safeEnv(fixture, overrides),
      encoding: "utf8",
      timeout: 30_000,
    },
  );
}

test("real npm login preflight passes the normalized state directory to its child", (t) => {
  const fixture = createFixture(t);
  const result = runNpmPreflight("login", fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /state directory preflight passed/i);
  assert.equal(fs.existsSync(fixture.defaultStateDir), false);
});

test("login, accounts, start, and shared:start resolve the same absolute state directory", (t) => {
  const fixture = createFixture(t);
  for (const script of ["login", "accounts", "start", "shared:start"]) {
    const result = runNpmPreflight(script, fixture);
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
    assert.match(result.stdout, /state directory preflight passed/i);
  }
  assert.equal(fs.existsSync(fixture.defaultStateDir), false);
});

test("CLI launch spec explicitly includes the canonical child state variable", (t) => {
  const fixture = createFixture(t);
  const spec = buildCliLaunchSpec({
    command: "login",
    args: ["--state-dir-preflight-only"],
    cwd: fixture.root,
    baseEnv: safeEnv(fixture),
  });
  assert.equal(spec.env.CYBERBOSS_STATE_DIR, path.resolve(fixture.stateDir));
  assert.equal(spec.env.CYBERBOSS_SAFE_BETA, "true");
});

test("custom state directory env file is loaded before CLI dispatch", (t) => {
  const fixture = createFixture(t);
  const loaded = loadCyberbossEnv({
    cwd: fixture.root,
    defaultStateDir: fixture.defaultStateDir,
    baseEnv: {
      CYBERBOSS_STATE_DIR: fixture.stateDir,
    },
  });
  assert.equal(loaded.CYBERBOSS_SAFE_BETA, "true");
  assert.equal(loaded.CYBERBOSS_STATE_DIR, path.resolve(fixture.stateDir));
  assert.equal(fs.existsSync(fixture.defaultStateDir), false);
});

test("missing inherited child state variable fails before login can generate a QR code", (t) => {
  const fixture = createFixture(t);
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "bin", "cyberboss.js"), "login", "--state-dir-preflight-only"],
    {
      cwd: fixture.root,
      env: safeEnv(fixture, { CYBERBOSS_STATE_DIR: undefined }),
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /state directory.*inherited/i);
  assert.doesNotMatch(result.stdout, /scan this qr code/i);
  assert.equal(fs.existsSync(fixture.defaultStateDir), false);
});

test("tampered child state variable fails before login can generate a QR code", (t) => {
  const fixture = createFixture(t);
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "bin", "cyberboss.js"), "login", "--state-dir-preflight-only"],
    {
      cwd: fixture.root,
      env: safeEnv(fixture, {
        CYBERBOSS_STATE_DIR: path.join(fixture.root, "tampered"),
      }),
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /state directory/i);
  assert.doesNotMatch(result.stdout, /scan this qr code/i);
  assert.equal(fs.existsSync(fixture.defaultStateDir), false);
});

test("default or unavailable custom state directory fails closed without fallback", (t) => {
  const fixture = createFixture(t);
  for (const invalidStateDir of [
    fixture.defaultStateDir,
    path.join(fixture.root, "missing"),
  ]) {
    const result = runNpmPreflight("login", fixture, {
      CYBERBOSS_STATE_DIR: invalidStateDir,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /state directory/i);
    assert.doesNotMatch(result.stdout, /scan this qr code/i);
  }
  assert.equal(fs.existsSync(fixture.defaultStateDir), false);
});

test("non-ASCII Windows-style state paths survive the real launch preflight", (t) => {
  const fixture = createFixture(t, "状态 目录 xingxing");
  const result = runNpmPreflight("login", fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(fixture.defaultStateDir), false);
});
