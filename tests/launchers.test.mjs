import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cases = [
  {
    file: "scripts/run-windows.cmd",
    pull: "git pull --ff-only",
    build: "call npm run build",
    guard: "if errorlevel 1 goto fail",
  },
  {
    file: "scripts/run-linux.sh",
    pull: "git pull --ff-only",
    build: "npm run build",
    guard: "set -euo pipefail",
  },
  {
    file: "scripts/run-macos.sh",
    pull: "git pull --ff-only",
    build: "npm run build",
    guard: "set -euo pipefail",
  },
  {
    file: "scripts/wsl-serve.sh",
    pull: 'git -C "$SRC" pull --ff-only',
    build: "npm run build",
    guard: 'pull --ff-only || exit 1',
  },
];

for (const item of cases) {
  test(`${item.file} 先安全更新再构建，更新失败会停止`, () => {
    const source = readFileSync(item.file, "utf8");
    const pullAt = source.indexOf(item.pull);
    const buildAt = source.indexOf(item.build);
    assert.ok(pullAt >= 0, "缺少 git pull --ff-only");
    assert.ok(buildAt > pullAt, "构建必须发生在更新之后");
    assert.ok(source.includes(item.guard), "缺少更新失败保护");
  });
}

test("Windows 一键入口使用带自动更新的 WSL 启动脚本", () => {
  const launcher = readFileSync("start-locado.cmd", "utf8");
  assert.ok(launcher.includes("scripts/wsl-serve.sh"));
});
