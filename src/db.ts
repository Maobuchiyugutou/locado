// 存储层抽象。
// 现在:浏览器 localStorage(单 JSON 快照),方便立即预览 UI。
// 以后:检测到运行在 Tauri 中时,切换为调用 Rust 侧的 SQLite 命令(invoke),
//       前端业务代码无需改动——只要实现同一个 Database 接口即可。

import type {
  DueFilter,
  Filter,
  FocusRecord,
  Habit,
  Priority,
  Project,
  Snapshot,
  Subtask,
  Tag,
  Task,
} from "./types";
import { defaultSnapshot, INBOX_ID } from "./seed";

export interface Database {
  load(): Promise<Snapshot>;
  reload(): Promise<Snapshot>;
  replaceAll(s: Snapshot): Promise<void>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  saveTag(t: Tag): Promise<void>;
  deleteTag(id: string): Promise<void>;
  saveFilter(f: Filter): Promise<void>;
  deleteFilter(id: string): Promise<void>;
  saveHabit(h: Habit): Promise<void>;
  deleteHabit(id: string): Promise<void>;
  saveFocusRecord(r: FocusRecord): Promise<void>;
  saveTask(t: Task): Promise<void>;
  deleteTask(id: string): Promise<void>;
}

export const SNAPSHOT_KEY = "locado.snapshot.v1";
const CORRUPT_PREFIX = SNAPSHOT_KEY + ".corrupt.";

/* ============ 快照规整 ============ */
// 所有进入存储的数据(本机旧数据、导入的 JSON)都先过这里:
// 缺字段补默认值、类型不对的丢弃、悬空引用归位。这样坏数据不会让应用白屏。

export interface NormalizeResult {
  snap: Snapshot;
  warnings: string[];
}

function asArray(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function asString(v: unknown, def = ""): string { return typeof v === "string" ? v : def; }
function asNumber(v: unknown, def: number): number { return typeof v === "number" && Number.isFinite(v) ? v : def; }
function asBool(v: unknown, def = false): boolean { return typeof v === "boolean" ? v : def; }
function asTime(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  return null;
}
function asPriority(v: unknown): Priority {
  if (v === 5) return 5;
  if (v === 3) return 3;
  if (v === 1) return 1;
  return 0;
}
function uniqueTags(v: unknown, valid: Set<string>): { list: string[]; dropped: number } {
  const list: string[] = [];
  let dropped = 0;
  for (const x of asArray(v)) {
    if (typeof x === "string" && valid.has(x)) { if (!list.includes(x)) list.push(x); }
    else dropped++;
  }
  return { list, dropped };
}

const DUE_VALUES: DueFilter[] = ["any", "overdue", "today", "next7", "nodate"];
function asDue(v: unknown): DueFilter {
  return typeof v === "string" && (DUE_VALUES as string[]).includes(v) ? (v as DueFilter) : "any";
}

export function normalizeSnapshot(raw: unknown): NormalizeResult {
  const src = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const warnings: string[] = [];

  const projects: Project[] = [];
  const projectIds = new Set<string>();
  for (const item of asArray(src.projects)) {
    if (item === null || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const id = asString(p.id).trim() || uid();
    if (projectIds.has(id)) continue;
    projectIds.add(id);
    projects.push({
      id,
      name: asString(p.name, "未命名清单").trim() || "未命名清单",
      color: asString(p.color, "#6e7681"),
      sortOrder: asNumber(p.sortOrder, projects.length),
      createdAt: asNumber(p.createdAt, Date.now()),
    });
  }
  // 收集箱是内置清单,任何快照都必须有,否则新建的任务会无处可放。
  if (!projectIds.has(INBOX_ID)) {
    projects.unshift({ id: INBOX_ID, name: "收集箱", color: "#3e63dd", sortOrder: 0, createdAt: Date.now() });
    projectIds.add(INBOX_ID);
  }

  const tags: Tag[] = [];
  const tagIds = new Set<string>();
  for (const item of asArray(src.tags)) {
    if (item === null || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    const id = asString(t.id).trim() || uid();
    if (tagIds.has(id)) continue;
    tagIds.add(id);
    tags.push({ id, name: asString(t.name, "未命名标签").trim() || "未命名标签", color: asString(t.color, "#6e7681") });
  }

  const filters: Filter[] = [];
  const filterIds = new Set<string>();
  for (const item of asArray(src.filters)) {
    if (item === null || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const id = asString(f.id).trim() || uid();
    if (filterIds.has(id)) continue;
    filterIds.add(id);
    const rule = (f.rule !== null && typeof f.rule === "object" ? f.rule : {}) as Record<string, unknown>;
    filters.push({
      id,
      name: asString(f.name, "未命名筛选器").trim() || "未命名筛选器",
      color: asString(f.color, "#6e7681"),
      rule: {
        projectIds: asArray(rule.projectIds).filter((x): x is string => typeof x === "string" && projectIds.has(x)),
        tagIds: asArray(rule.tagIds).filter((x): x is string => typeof x === "string" && tagIds.has(x)),
        priorities: asArray(rule.priorities)
          .filter((x): x is 0 | 1 | 3 | 5 => x === 0 || x === 1 || x === 3 || x === 5)
          .filter((x, i, arr) => arr.indexOf(x) === i),
        due: asDue(rule.due),
      },
    });
  }

  const habits: Habit[] = [];
  const habitIds = new Set<string>();
  for (const item of asArray(src.habits)) {
    if (item === null || typeof item !== "object") continue;
    const h = item as Record<string, unknown>;
    const id = asString(h.id).trim() || uid();
    if (habitIds.has(id)) continue;
    habitIds.add(id);
    const checkins = asArray(h.checkins)
      .filter((x): x is string => typeof x === "string")
      .filter((x, i, arr) => arr.indexOf(x) === i);
    habits.push({
      id,
      name: asString(h.name, "未命名习惯").trim() || "未命名习惯",
      icon: asString(h.icon, "🎯"),
      color: asString(h.color, "#0091ff"),
      checkins,
      sortOrder: asNumber(h.sortOrder, habits.length),
      createdAt: asNumber(h.createdAt, Date.now()),
    });
  }

  const focusRecords: FocusRecord[] = [];
  const recordIds = new Set<string>();
  for (const item of asArray(src.focusRecords)) {
    if (item === null || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = asString(r.id).trim() || uid();
    if (recordIds.has(id)) continue;
    recordIds.add(id);
    focusRecords.push({
      id,
      startedAt: asNumber(r.startedAt, Date.now()),
      minutes: Math.max(0, asNumber(r.minutes, 0)),
      taskId: typeof r.taskId === "string" && r.taskId ? r.taskId : null,
    });
  }

  const tasks: Task[] = [];
  const taskIds = new Set<string>();
  let orphanProjects = 0;
  let droppedTags = 0;
  for (const item of asArray(src.tasks)) {
    if (item === null || typeof item !== "object") continue;
    const x = item as Record<string, unknown>;
    let id = asString(x.id).trim();
    if (!id || taskIds.has(id)) id = uid();
    taskIds.add(id);

    let projectId = asString(x.projectId, INBOX_ID);
    if (!projectIds.has(projectId)) { projectId = INBOX_ID; orphanProjects++; }

    const tagRefs = uniqueTags(x.tags, tagIds);
    droppedTags += tagRefs.dropped;

    const subtasks: Subtask[] = [];
    for (const sv of asArray(x.subtasks)) {
      if (sv === null || typeof sv !== "object") continue;
      const s = sv as Record<string, unknown>;
      subtasks.push({ id: asString(s.id).trim() || uid(), title: asString(s.title), completed: asBool(s.completed) });
    }

    const completed = asBool(x.completed);
    const createdAt = asNumber(x.createdAt, Date.now());
    const remind = x.reminderMinutesBefore;
    tasks.push({
      id,
      projectId,
      title: asString(x.title),
      note: asString(x.note),
      priority: asPriority(x.priority),
      completed,
      completedAt: completed ? (asTime(x.completedAt) ?? Date.now()) : null,
      dueDate: asTime(x.dueDate),
      hasTime: asBool(x.hasTime),
      reminderMinutesBefore: typeof remind === "number" && Number.isFinite(remind) && remind >= 0 ? remind : null,
      reminded: asBool(x.reminded),
      pinned: asBool(x.pinned),
      tags: tagRefs.list,
      subtasks,
      createdAt,
      updatedAt: asNumber(x.updatedAt, createdAt),
    });
  }
  if (orphanProjects) warnings.push(`${orphanProjects} 个任务的原清单不存在,已移入收集箱`);
  if (droppedTags) warnings.push(`${droppedTags} 个标签引用失效,已忽略`);

  return { snap: { projects, tags, tasks, filters, habits, focusRecords }, warnings };
}

/* ============ localStorage 实现 ============ */

type StorageErrorHandler = (message: string) => void;
let errorHandler: StorageErrorHandler | null = null;
let lastErrorAt = 0;

// 让 UI 能收到"存不下/存不了"的提示;不注册则只写 console。
export function onStorageError(fn: StorageErrorHandler): void { errorHandler = fn; }

class LocalStore implements Database {
  // 内存里只保留一份快照,避免每次保存都重新解析整个 JSON。
  private cache: Snapshot | null = null;

  private data(): Snapshot {
    if (!this.cache) this.cache = this.loadFromDisk();
    return this.cache;
  }

  private loadFromDisk(): Snapshot {
    let raw: string | null = null;
    try { raw = localStorage.getItem(SNAPSHOT_KEY); } catch { /* 存储被禁用 */ }
    if (raw) {
      try {
        const { snap, warnings } = normalizeSnapshot(JSON.parse(raw));
        if (warnings.length) console.warn("[Locado] 数据已自动修复:", warnings.join(";"));
        return snap;
      } catch {
        // 解析失败:先把原文另存一份,再回退,避免直接覆盖掉唯一的数据。
        try { localStorage.setItem(CORRUPT_PREFIX + Date.now(), raw); } catch { /* 空间不足时放弃备份 */ }
        this.report("本地数据损坏,已另存原文并重置为示例数据。");
      }
    }
    const seed = defaultSnapshot();
    this.write(seed);
    return seed;
  }

  private write(s: Snapshot): void {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(s));
    } catch {
      this.report("保存失败:浏览器存储已满或被禁用。请立即用「导入 / 导出」导出 JSON 备份。");
    }
  }

  private report(msg: string): void {
    if (Date.now() - lastErrorAt < 4000) return; // 连续失败时不刷屏
    lastErrorAt = Date.now();
    if (errorHandler) errorHandler(msg);
    else console.error("[Locado] " + msg);
  }

  async load(): Promise<Snapshot> { return this.data(); }
  async reload(): Promise<Snapshot> { this.cache = null; return this.data(); }
  async replaceAll(s: Snapshot): Promise<void> { this.cache = s; this.write(s); }

  async saveProject(p: Project): Promise<void> {
    const s = this.data();
    const i = s.projects.findIndex((x) => x.id === p.id);
    if (i >= 0) s.projects[i] = p; else s.projects.push(p);
    this.write(s);
  }
  async deleteProject(id: string): Promise<void> {
    const s = this.data();
    s.projects = s.projects.filter((x) => x.id !== id);
    s.tasks = s.tasks.filter((t) => t.projectId !== id);
    this.write(s);
  }

  async saveTag(t: Tag): Promise<void> {
    const s = this.data();
    const i = s.tags.findIndex((x) => x.id === t.id);
    if (i >= 0) s.tags[i] = t; else s.tags.push(t);
    this.write(s);
  }
  async deleteTag(id: string): Promise<void> {
    const s = this.data();
    s.tags = s.tags.filter((x) => x.id !== id);
    for (const t of s.tasks) t.tags = t.tags.filter((x) => x !== id);
    this.write(s);
  }

  async saveFilter(f: Filter): Promise<void> {
    const s = this.data();
    const i = s.filters.findIndex((x) => x.id === f.id);
    if (i >= 0) s.filters[i] = f; else s.filters.push(f);
    this.write(s);
  }
  async deleteFilter(id: string): Promise<void> {
    const s = this.data();
    s.filters = s.filters.filter((x) => x.id !== id);
    this.write(s);
  }

  async saveHabit(h: Habit): Promise<void> {
    const s = this.data();
    const i = s.habits.findIndex((x) => x.id === h.id);
    if (i >= 0) s.habits[i] = h; else s.habits.push(h);
    this.write(s);
  }
  async deleteHabit(id: string): Promise<void> {
    const s = this.data();
    s.habits = s.habits.filter((x) => x.id !== id);
    this.write(s);
  }

  async saveFocusRecord(r: FocusRecord): Promise<void> {
    const s = this.data();
    // 调用方可能已经把记录放进快照;按 id 幂等写入,避免一次番茄记成两条。
    const i = s.focusRecords.findIndex((x) => x.id === r.id);
    if (i >= 0) s.focusRecords[i] = r; else s.focusRecords.push(r);
    this.write(s);
  }

  async saveTask(t: Task): Promise<void> {
    const s = this.data();
    const i = s.tasks.findIndex((x) => x.id === t.id);
    if (i >= 0) s.tasks[i] = t; else s.tasks.push(t);
    this.write(s);
  }
  async deleteTask(id: string): Promise<void> {
    const s = this.data();
    s.tasks = s.tasks.filter((x) => x.id !== id);
    this.write(s);
  }
}

// 预留:Tauri/SQLite 实现(装好工具链接入后再填充 invoke 调用)。
function isTauri(): boolean {
  return typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";
}

let instance: Database | null = null;
export function getDB(): Database {
  if (instance) return instance;
  void isTauri;
  instance = new LocalStore();
  return instance;
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
