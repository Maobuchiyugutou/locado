import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("同源静态资源缓存匹配忽略 Vary，避免冷安装首次离线 503", () => {
  const source = readFileSync("public/sw.js", "utf8");
  const originGuardAt = source.indexOf("if (url.origin !== self.location.origin) return;");
  const matchAt = source.indexOf("caches.match(request, { ignoreVary: true })");
  assert.ok(originGuardAt >= 0, "静态缓存必须先限制同源请求");
  assert.ok(matchAt > originGuardAt, "同源静态资源必须忽略 Vary 差异以命中预缓存");
});
