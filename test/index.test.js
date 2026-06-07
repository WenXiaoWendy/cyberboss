const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const child_process = require("child_process");
const { mock } = require("node:test");

const { killStalePidIfSafe } = require("../src/index");

const FAKE_PID = 99999;

function restoreAll() {
  mock.restoreAll();
}

function mockConsole() {
  mock.method(console, "log", () => {});
  mock.method(console, "warn", () => {});
}

test("killStalePidIfSafe", async (t) => {
  // 每个子测试前恢复所有 mock，确保测试隔离
  await t.test("1. PID 文件不存在 → 直接返回不报错", () => {
    restoreAll();
    mockConsole();

    // fs.readFileSync 抛出 ENOENT 模拟文件不存在
    mock.method(fs, "readFileSync", () => {
      throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    });

    assert.doesNotThrow(() => killStalePidIfSafe("/nonexistent/pid"));

    restoreAll();
  });

  await t.test("2. 旧 PID 等于当前进程 PID → 跳过", () => {
    restoreAll();
    mockConsole();

    // 读到的 PID 是当前进程自己的 PID
    mock.method(fs, "readFileSync", () => String(process.pid));
    const killMock = mock.method(process, "kill", () => {});

    killStalePidIfSafe("/fake/pid");

    // process.kill 不应该被调用，因为旧 PID == 自身直接跳过了
    assert.strictEqual(killMock.mock.calls.length, 0);

    restoreAll();
  });

  await t.test("3. 旧 PID 等于父进程 PID → 跳过不杀", () => {
    restoreAll();
    mockConsole();

    // 读到的 PID 是父进程的 PID
    mock.method(fs, "readFileSync", () => String(process.ppid));
    const killMock = mock.method(process, "kill", () => {});

    killStalePidIfSafe("/fake/pid");

    // process.kill 不应该被调用，因为旧 PID == 父进程直接跳过了
    assert.strictEqual(killMock.mock.calls.length, 0);

    restoreAll();
  });

  await t.test("4. 旧 PID 进程已死 (ESRCH) → 跳过", () => {
    restoreAll();
    mockConsole();

    mock.method(fs, "readFileSync", () => String(FAKE_PID));
    // process.kill 抛出 ESRCH 表示进程不存在
    mock.method(process, "kill", () => {
      throw Object.assign(new Error("ESRCH: no such process"), { code: "ESRCH" });
    });
    const execMock = mock.method(child_process, "execFileSync", () => {});

    killStalePidIfSafe("/fake/pid");

    // process.kill 被调用了一次用于探测
    // execFileSync 不应该被调用，因为进程已死直接跳过
    assert.strictEqual(execMock.mock.calls.length, 0);

    restoreAll();
  });

  await t.test("5. 旧 PID 进程存在无权限 (EPERM) → 视为活着，执行 taskkill", () => {
    restoreAll();
    mockConsole();

    mock.method(fs, "readFileSync", () => String(FAKE_PID));
    // Windows: 对非父子进程抛 EPERM 表示进程存在
    mock.method(process, "kill", () => {
      throw Object.assign(new Error("EPERM: permission denied"), { code: "EPERM" });
    });
    const execMock = mock.method(child_process, "execFileSync", () => {});

    killStalePidIfSafe("/fake/pid");

    // execFileSync 被调用，EPERM 在 Windows 上说明进程存在 → 杀掉
    assert.ok(execMock.mock.calls.length >= 1, "execFileSync should be called for EPERM");
    assert.strictEqual(execMock.mock.calls[0].arguments[0], "taskkill");

    restoreAll();
  });

  await t.test("6. 旧 PID 进程活着且不是父进程 → 执行 taskkill", () => {
    restoreAll();
    mockConsole();

    mock.method(fs, "readFileSync", () => String(FAKE_PID));
    mock.method(process, "kill", () => {}); // 探测成功，进程活着
    const execMock = mock.method(child_process, "execFileSync", () => {});

    killStalePidIfSafe("/fake/pid");

    // 确认 execFileSync 被调用，且参数正确
    assert.ok(execMock.mock.calls.length >= 1, "execFileSync should be called");
    const callArgs = execMock.mock.calls[0].arguments;
    assert.strictEqual(callArgs[0], "taskkill");
    assert.deepStrictEqual(callArgs[1], ["/F", "/T", "/PID", String(FAKE_PID)]);
    assert.deepStrictEqual(callArgs[2], { stdio: "ignore" });

    restoreAll();
  });
});
