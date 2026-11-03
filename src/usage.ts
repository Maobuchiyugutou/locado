// 本机使用统计：只保存每日计数，不记录任务内容，也不发送网络请求。
export const USAGE_KEY = "locado.usage.v1";
const MAX_DAILY_RECORDS = 400;

export interface UsageDay {
  opens: number;
  created: number;
  completed: number;
  quickAdds: number;
  quickAddClean: number;
}

export interface UsageData {
  v: 1;
  firstSeenAt: number;
  lastSeenAt: number;
  exports: number;
  days: Record<string, UsageDay>;
}

export type UsageEvent =
  | { type: "open" | "create" | "complete" | "export" }
  | { type: "quick-add"; clean: boolean };

function emptyDay(): UsageDay {
  return { opens: 0, created: 0, completed: 0, quickAdds: 0, quickAddClean: 0 };
}

export function emptyUsage(now = Date.now()): UsageData {
  return { v: 1, firstSeenAt: now, lastSeenAt: now, exports: 0, days: {} };
}

function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayAt(now: number, offset: number): Date {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))
    : 0;
}

function timestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function normalizeUsage(raw: unknown, now = Date.now()): UsageData {
  if (raw === null || typeof raw !== "object" || (raw as { v?: unknown }).v !== 1) return emptyUsage(now);
  const source = raw as Partial<UsageData>;
  const entries: [string, UsageDay][] = [];
  if (source.days !== null && typeof source.days === "object") {
    for (const [key, value] of Object.entries(source.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || value === null || typeof value !== "object") continue;
      const day = value as Partial<UsageDay>;
      const quickAdds = count(day.quickAdds);
      entries.push([key, {
        opens: count(day.opens),
        created: count(day.created),
        completed: count(day.completed),
        quickAdds,
        quickAddClean: Math.min(quickAdds, count(day.quickAddClean)),
      }]);
    }
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return {
    v: 1,
    firstSeenAt: timestamp(source.firstSeenAt, now),
    lastSeenAt: timestamp(source.lastSeenAt, now),
    exports: count(source.exports),
    days: Object.fromEntries(entries.slice(-MAX_DAILY_RECORDS)),
  };
}

export function applyUsageEvent(data: UsageData, event: UsageEvent, now = Date.now()): UsageData {
  const next: UsageData = { ...data, lastSeenAt: now, days: { ...data.days } };
  if (event.type === "export") {
    next.exports += 1;
    return next;
  }
  const key = dayKey(new Date(now));
  const day = { ...(next.days[key] ?? emptyDay()) };
  if (event.type === "open") day.opens += 1;
  else if (event.type === "create") day.created += 1;
  else if (event.type === "complete") day.completed += 1;
  else if (event.type === "quick-add") {
    day.quickAdds += 1;
    if (event.clean) day.quickAddClean += 1;
  }
  next.days[key] = day;
  return next;
}

export function readUsage(now = Date.now()): UsageData {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    return normalizeUsage(raw ? JSON.parse(raw) : null, now);
  } catch {
    return emptyUsage(now);
  }
}

export function recordUsage(event: UsageEvent, now = Date.now()): void {
  try {
    const next = applyUsageEvent(readUsage(now), event, now);
    localStorage.setItem(USAGE_KEY, JSON.stringify(next));
  } catch {
    // 统计失败不能影响任务数据或正常操作。
  }
}

export function clearUsage(): void {
  try { localStorage.removeItem(USAGE_KEY); } catch { /* 忽略受限存储 */ }
}

export function summarizeUsage(data: UsageData, now = Date.now()) {
  const days = Object.values(data.days);
  const total = (field: keyof UsageDay) => days.reduce((sum, day) => sum + day[field], 0);
  const quickAdds = total("quickAdds");
  const quickAddClean = total("quickAddClean");

  let streakDays = 0;
  const today = data.days[dayKey(dayAt(now, 0))];
  for (let offset = today?.opens ? 0 : 1; ; offset += 1) {
    if (!data.days[dayKey(dayAt(now, offset))]?.opens) break;
    streakDays += 1;
  }

  const recent = (length: number) => {
    const result = { openDays: 0, created: 0, completed: 0 };
    for (let offset = 0; offset < length; offset += 1) {
      const day = data.days[dayKey(dayAt(now, offset))];
      if (!day) continue;
      if (day.opens > 0) result.openDays += 1;
      result.created += day.created;
      result.completed += day.completed;
    }
    return result;
  };

  const activity = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = dayAt(now, offset);
    const key = dayKey(date);
    activity.push({
      key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      completed: data.days[key]?.completed ?? 0,
    });
  }

  const last7 = recent(7);
  return {
    activeDays: days.filter((day) => day.opens > 0).length,
    streakDays,
    created: total("created"),
    completed: total("completed"),
    exports: data.exports,
    quickAdds,
    quickAddClean,
    quickAddCleanRate: quickAdds ? quickAddClean / quickAdds : null,
    last7,
    weeklyGoalMet: last7.openDays >= 2 && last7.completed >= 3,
    activity,
  };
}
