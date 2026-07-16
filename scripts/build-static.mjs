import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const vinextCli = resolve("node_modules/vinext/dist/cli.js");
const result = spawnSync(process.execPath, [vinextCli, "build"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, STATIC_EXPORT: "1" },
});

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";
const combinedOutput = `${stdout}\n${stderr}`;
const staticOutputExists = existsSync(resolve("dist/client/index.html"));
const expectedWindowsCleanupFailure =
  process.platform === "win32" &&
  staticOutputExists &&
  stdout.includes("Build complete.") &&
  combinedOutput.includes("UV_HANDLE_CLOSING");

process.stdout.write(stdout);

if (expectedWindowsCleanupFailure) {
  console.warn(
    "[static-build] vinext 已完成静态文件生成；已忽略 Windows 清理阶段的 Node/libuv 断言。",
  );
  process.exit(0);
}

process.stderr.write(stderr);
process.exit(result.status ?? 1);
