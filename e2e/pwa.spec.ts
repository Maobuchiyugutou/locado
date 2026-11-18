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

test("无 Web Locks 时 IndexedDB 串行化双页并发新增", async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
  });
  const second = await context.newPage();
  await Promise.all([
    page.goto("/", { waitUntil: "networkidle" }),
    second.goto("/", { waitUntil: "networkidle" }),
  ]);
  await page.locator(".add-input").fill("IndexedDB 页面 A");
  await second.locator(".add-input").fill("IndexedDB 页面 B");
  await Promise.all([
    page.locator(".add-input").press("Enter"),
    second.locator(".add-input").press("Enter"),
  ]);

  await expect.poll(async () => {
    const snapshot = await readSnapshot(page);
    return snapshot.tasks.map((task) => task.title).filter((title) => title.startsWith("IndexedDB 页面")).sort();
  }).toEqual(["IndexedDB 页面 A", "IndexedDB 页面 B"]);
  await second.close();
});

test.describe("本地日期边界", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("今天和最近七天使用本地日历半开区间", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-11-01T07:00:00Z") });
    await page.addInitScript(({ key }) => {
      localStorage.setItem(key, JSON.stringify({
        schemaVersion: 2,
        projects: [{ id: "inbox", name: "收集箱", color: "#3e63dd" }],
        tags: [], filters: [], habits: [], focusRecords: [],
        tasks: [
          { id: "today", projectId: "inbox", title: "今日内", dueDate: Date.parse("2026-11-02T07:30:00Z"), hasTime: true },
          { id: "tomorrow", projectId: "inbox", title: "明日零点", dueDate: Date.parse("2026-11-02T08:00:00Z"), hasTime: true },
          { id: "week", projectId: "inbox", title: "七日内", dueDate: Date.parse("2026-11-08T07:59:00Z"), hasTime: true },
          { id: "day-eight", projectId: "inbox", title: "第八天零点", dueDate: Date.parse("2026-11-08T08:00:00Z"), hasTime: true },
        ],
      }));
    }, { key: SNAPSHOT_KEY });
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator(".task-title", { hasText: "今日内" })).toBeVisible();
    await expect(page.locator(".task-title", { hasText: "明日零点" })).toHaveCount(0);

    await page.getByRole("button", { name: /^最近 7 天/ }).click();
    await expect(page.locator(".task-title", { hasText: "七日内" })).toBeVisible();
    await expect(page.locator(".task-title", { hasText: "第八天零点" })).toHaveCount(0);
  });
});

test("番茄钟到期临界暂停仍完成记录并进入休息", async ({ page }) => {
  const startedAt = new Date("2026-11-01T12:00:00Z");
  await page.clock.install({ time: startedAt });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByTitle("专注", { exact: true }).click();
  await page.getByRole("button", { name: "15 分", exact: true }).click();
  await page.getByRole("button", { name: "开始专注", exact: true }).click();
  await page.clock.setSystemTime(new Date(startedAt.getTime() + 16 * 60_000));
  await page.getByRole("button", { name: "暂停", exact: true }).click();

  await expect(page.locator(".focus-mode")).toHaveText("休息");
  await expect.poll(async () => (await readSnapshot(page)).focusRecords.length).toBe(1);
  const snapshot = await readSnapshot(page);
  expect(snapshot.focusRecords[0].minutes).toBe(15);
});
