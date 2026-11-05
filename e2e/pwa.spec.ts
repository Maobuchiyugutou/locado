import { expect, test, type Page } from "@playwright/test";

const SNAPSHOT_KEY = "locado.snapshot.v1";
const BACKUP_PREFIX = `${SNAPSHOT_KEY}.backup.`;

async function readSnapshot(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), SNAPSHOT_KEY);
}

test("冷安装后首次离线也能加载完整应用壳", async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByTitle("使用统计")).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(async () => {
    if (!(await caches.keys()).includes("locado-shell-v6")) return false;
    const cache = await caches.open("locado-shell-v6");
    const cached = await cache.keys();
    const assets = [...document.querySelectorAll("script[src], link[rel='stylesheet']")]
      .map((element) => (element as HTMLScriptElement | HTMLLinkElement).src || (element as HTMLLinkElement).href);
    return assets.every((url) => cached.some((request) => request.url === url));
  });

  expect(await page.evaluate(() => caches.keys())).toEqual(["locado-shell-v6"]);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTitle("使用统计")).toBeVisible();
  const resources = await page.evaluate(() => performance.getEntriesByType("resource")
    .filter((entry) => entry.name.includes("/assets/"))
    .map((entry) => ({ url: entry.name, status: (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus })));
  expect(resources).toHaveLength(2);
  expect(resources.every((entry) => entry.status === 200)).toBe(true);
  expect(await page.locator("#app").evaluate((element) => element.innerHTML.length)).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});

test("旧快照迁移保留任务并创建迁移前保护备份", async ({ page }) => {
  const legacy = {
    projects: [{ id: "inbox", name: "收集箱" }],
    tags: [],
    tasks: [{ id: "legacy-task", projectId: "inbox", title: "旧快照任务" }],
  };
  await page.addInitScript(({ key, snapshot }) => {
    localStorage.setItem(key, JSON.stringify(snapshot));
  }, { key: SNAPSHOT_KEY, snapshot: legacy });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^全部/ }).click();
  await expect(page.locator(".task-title", { hasText: "旧快照任务" }).first()).toBeVisible();

  const result = await page.evaluate(({ key, prefix }) => {
    const snapshot = JSON.parse(localStorage.getItem(key) ?? "null");
    const backups = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const storageKey = localStorage.key(i);
      if (!storageKey?.startsWith(prefix)) continue;
      const record = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      backups.push({ reason: record.reason, raw: record.raw });
    }
    return { schemaVersion: snapshot.schemaVersion, backups };
  }, { key: SNAPSHOT_KEY, prefix: BACKUP_PREFIX });
  expect(result.schemaVersion).toBe(2);
  expect(result.backups.some((backup) => backup.reason === "before-migration" && backup.raw.includes("旧快照任务"))).toBe(true);
});

test("PWA 更新提示先保存待写修改再刷新", async ({ page }) => {
  await page.route("**/version.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ version: "0.2.0", build: "e2e-next-build" }),
  }));
  await page.goto("/", { waitUntil: "networkidle" });
  const input = page.locator(".add-input");
  await input.fill("E2E 更新前任务");
  await input.press("Enter");
  await expect(page.locator(".task-title", { hasText: "E2E 更新前任务" }).first()).toBeVisible();
  await page.getByRole("button", { name: "编辑任务 E2E 更新前任务", exact: true }).click();
  await page.locator(".d-title").fill("E2E 已保存的编辑");

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.getByRole("button", { name: "立即更新", exact: true }).click(),
  ]);
  await expect(page.locator(".task-title", { hasText: "E2E 已保存的编辑" }).first()).toBeVisible();
  const snapshot = await readSnapshot(page);
  expect(snapshot.tasks.some((task) => task.title === "E2E 已保存的编辑")).toBe(true);
});

test("JSON 恢复替换当前数据前创建恢复前保护备份", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const original = await readSnapshot(page);
  const restored = structuredClone(original);
  restored.tasks = [{ ...original.tasks[0], id: "restored-task", title: "来自备份的任务" }];

  await page.getByTitle("导入 / 导出").click();
  await page.locator('input[accept=".json"]').setInputFiles({
    name: "restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(restored)),
  });
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByText(/已导入 1 个任务/).first()).toBeVisible();

  const current = await readSnapshot(page);
  expect(current.tasks.map((task) => task.id)).toEqual(["restored-task"]);
  const backups = await page.evaluate((prefix) => {
    const result = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const record = JSON.parse(localStorage.getItem(key) ?? "null");
      if (record.reason === "before-restore") result.push(JSON.parse(record.raw));
    }
    return result;
  }, BACKUP_PREFIX);
  expect(backups.some((backup) => backup.tasks.some((task) => task.id === original.tasks[0].id))).toBe(true);
});

test("关闭时仍有写入会提示，停留后完成落盘", async ({ page }) => {
  await page.addInitScript(() => {
    const request = navigator.locks.request.bind(navigator.locks);
    navigator.locks.request = ((name, callback) => request(name, async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return callback();
    })) as LockManager["request"];
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /编辑任务 欢迎使用 Locado/ }).click();
  await page.locator(".d-title").fill("关闭前保存任务");

  const prevented = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await page.waitForFunction((key) => {
    const snapshot = JSON.parse(localStorage.getItem(key) ?? "null");
    return snapshot.tasks.some((task) => task.title === "关闭前保存任务");
  }, SNAPSHOT_KEY);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".task-title", { hasText: "关闭前保存任务" }).first()).toBeVisible();
});
