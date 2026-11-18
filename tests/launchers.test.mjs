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

test("Windows 一键入口始终先构建，再按版本复用或启动预览", () => {
  const launcher = readFileSync("start-locado.cmd", "utf8");
  const buildAt = launcher.indexOf("scripts/wsl-serve.sh --build-only");
  const probeAt = launcher.indexOf("function Up");
  const serveAt = launcher.indexOf("scripts/wsl-serve.sh','--serve-only");
  const openAt = launcher.indexOf("Start-Process $u");
  const guardAt = launcher.indexOf("if errorlevel 1 goto fail", buildAt);
  assert.ok(buildAt >= 0, "缺少独立更新构建阶段");
  assert.ok(guardAt > buildAt && guardAt < probeAt, "构建失败时不得继续探测或打开页面");
  assert.ok(buildAt < probeAt, "必须先构建，再检查现有服务");
  assert.ok(launcher.includes(".build -eq $expected"), "必须核对构建 ID，不能只检查 HTTP 200");
  assert.ok(launcher.includes("if (Responding)"), "端口被其他构建占用时必须停止");
  assert.ok(serveAt > probeAt, "仅在需要时启动仅预览模式");
  assert.ok(openAt > serveAt, "打开浏览器前必须完成版本校验");
});

test("WSL 启动脚本支持独立构建和仅预览模式", () => {
  const source = readFileSync("scripts/wsl-serve.sh", "utf8");
  const buildAt = source.indexOf("npm run build");
  const buildOnlyAt = source.indexOf('if [ "$MODE" = "--build-only" ]');
  const previewAt = source.indexOf("exec npm run preview");
  assert.ok(source.includes('if [ "$MODE" != "--serve-only" ]'), "仅预览模式不得重复拉取和构建");
  assert.ok(buildOnlyAt > buildAt && buildOnlyAt < previewAt, "独立构建模式必须在启动预览前退出");
});

test("WSL 同步保留启动脚本以满足完整回归测试", () => {
  for (const file of ["scripts/wsl-run.sh", "scripts/wsl-serve.sh"]) {
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes("rsync -a --delete"), `${file} 必须保留镜像同步`);
    assert.ok(!source.includes("--exclude 'wsl-*.sh'"), `${file} 不得排除 WSL 脚本`);
    assert.ok(!source.includes("--exclude 'start-locado.cmd'"), `${file} 不得排除 Windows 入口`);
  }
});

test("WSL 准备脚本始终安装并启用 Node 24", () => {
  const source = readFileSync("scripts/wsl-build.sh", "utf8");
  assert.ok(source.includes("nvm install 24"));
  assert.ok(source.includes("nvm use 24"));
  assert.ok(!source.includes("--lts"));
  assert.ok(!source.includes("|| true"));
});

test("Pages 仅在完整 CI 成功后部署", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const demo = readFileSync(".github/workflows/demo.yml", "utf8");
  assert.ok(ci.includes("workflow_dispatch:"));
  assert.ok(ci.includes("needs: test-and-build"));
  assert.ok(ci.includes("if: github.event_name != 'pull_request'"));
  assert.ok(ci.includes("uses: ./.github/workflows/demo.yml"));
  assert.ok(demo.includes("workflow_call:"));
  assert.ok(!demo.includes("branches: [main]"));
  assert.ok(!demo.includes("run: npm test"));
});
