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
import { defaultSnapshot, INBOX_ID } from "./seed.ts";
import { normalizeRecurrence } from "./recurrence.ts";
import { createSafetyBackup, scheduleAutoBackup } from "./backups.ts";
import { CURRENT_SCHEMA_VERSION, migrateSnapshotRecord, UnsupportedSchemaVersionError } from "./migrations.ts";

export interface ReminderClaim {
  task: Task;
  notify: boolean;
}

export interface TaskSaveOptions {
  restore?: boolean;
}

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
  saveTask(t: Task, options?: TaskSaveOptions): Promise<void>;
  updateTask(t: Task): Promise<void>;
  saveTasks(upserts: Task[], deleteIds?: string[], options?: TaskSaveOptions): Promise<void>;
  deleteTask(id: string): Promise<void>;
  claimReminder(id: string, at: number, now: number): Promise<ReminderClaim | null>;
}

export const SNAPSHOT_KEY = "locado.snapshot.v1";
const CORRUPT_PREFIX = SNAPSHOT_KEY + ".corrupt.";

/* ============ 快照规整 ============ */
// 所有进入存储的数据(本机旧数据、导入的 JSON)都先过这里:
// 缺字段补默认值、类型不对的丢弃、悬空引用归位。这样坏数据不会让应用白屏。

export interface NormalizeResult {
  snap: Snapshot;
  warnings: string[];
  sourceVersion: number;
  migrated: boolean;
}

function asArray(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function asString(v: unknown, def = ""): string { return typeof v === "string" ? v : def; }
function asNumber(v: unknown, def: number): number { return typeof v === "number" && Number.isFinite(v) ? v : def; }
function asBool(v: unknown, def = false): boolean { return typeof v === "boolean" ? v : def; }
function asColor(v: unknown, def: string): string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def;
}
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

export function assertSnapshotImport(raw: unknown): asserts raw is Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("备份必须是 JSON 对象");
  const source = raw as Record<string, unknown>;
  for (const key of ["tasks", "projects", "tags"]) {
    if (!Array.isArray(source[key])) throw new Error(`备份缺少有效的 ${key} 数组`);
  }
  for (const key of ["filters", "habits", "focusRecords"]) {
    if (source[key] !== undefined && !Array.isArray(source[key])) throw new Error(`备份中的 ${key} 格式无效`);
  }
  for (const key of ["tasks", "projects", "tags", "filters", "habits", "focusRecords"]) {
    const items = source[key];
    if (!Array.isArray(items)) continue;
    const ids = new Set<string>();
    for (const item of items) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error(`备份中的 ${key} 含有无效记录`);
      const id = (item as Record<string, unknown>).id;
      if (typeof id !== "string" || !id.trim()) throw new Error(`备份中的 ${key} 含有缺失 ID 的记录`);
      if (ids.has(id)) throw new Error(`备份中的 ${key} 含有重复 ID`);
      ids.add(id);
    }
  }
}

export function normalizeSnapshot(raw: unknown): NormalizeResult {
  const { data: src, sourceVersion, migrated } = migrateSnapshotRecord(raw);
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
      color: asColor(p.color, "#6e7681"),
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
    tags.push({ id, name: asString(t.name, "未命名标签").trim() || "未命名标签", color: asColor(t.color, "#6e7681") });
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
      color: asColor(f.color, "#6e7681"),
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
      color: asColor(h.color, "#0091ff"),
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
    const recurrence = normalizeRecurrence(x.recurrence) ?? undefined;
    tasks.push({
      id,
      projectId,
      title: asString(x.title),
      note: asString(x.note),
      priority: asPriority(x.priority),
      important: typeof x.important === "boolean" ? x.important : undefined,
      urgent: typeof x.urgent === "boolean" ? x.urgent : undefined,
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
      recurrence,
      recurrenceSourceId: asString(x.recurrenceSourceId).trim() || undefined,
      recurrenceNextId: recurrence ? asString(x.recurrenceNextId).trim() || undefined : undefined,
    });
  }
  if (orphanProjects) warnings.push(`${orphanProjects} 个任务的原清单不存在,已移入收集箱`);
  if (droppedTags) warnings.push(`${droppedTags} 个标签引用失效,已忽略`);

  return {
    snap: { schemaVersion: CURRENT_SCHEMA_VERSION, projects, tags, tasks, filters, habits, focusRecords },
    warnings,
    sourceVersion,
    migrated,
  };
}

/* ============ localStorage 实现 ============ */

type StorageErrorHandler = (message: string) => void;
let errorHandler: StorageErrorHandler | null = null;
let lastErrorAt = 0;

// 让 UI 能收到"存不下/存不了"的提示;不注册则只写 console。
export function onStorageError(fn: StorageErrorHandler): void { errorHandler = fn; }

type LockManagerLike = { request<T>(name: string, callback: () => T | Promise<T>): Promise<T> };

function cloneSnapshot<T>(value: T): T { return structuredClone(value); }

class LocalStore implements Database {
  private cache: Snapshot | null = null;
  private queue: Promise<void> = Promise.resolve();
  private knownTaskIds = new Set<string>();

  private data(): Snapshot {
    if (!this.cache) this.cache = this.loadFromDisk();
    return this.cache;
  }

  private rememberTasks(snapshot: Snapshot): void {
    for (const task of snapshot.tasks) this.knownTaskIds.add(task.id);
  }

  private protectCorrupt(raw: string): void {
    try { localStorage.setItem(CORRUPT_PREFIX + Date.now(), raw); }
    catch {
      this.report("本地数据损坏，原文备份失败，已停止覆盖原始数据。");
      throw new Error("本地数据损坏且无法备份原文");
    }
  }

  private resetCorrupt(raw: string): Snapshot {
    this.protectCorrupt(raw);
    this.report("本地数据损坏,已另存原文并重置为示例数据。");
    const seed = defaultSnapshot();
    this.write(seed);
    this.rememberTasks(seed);
    return seed;
  }

  private loadFromDisk(): Snapshot {
    let raw: string | null = null;
    try { raw = localStorage.getItem(SNAPSHOT_KEY); }
    catch {
      this.report("读取本地数据失败，已停止写入以保护现有数据。");
      throw new Error("读取本地数据失败");
    }
    if (raw) {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { return this.resetCorrupt(raw); }

      let structurallyCorrupt = false;
      try { assertSnapshotImport(parsed); }
      catch { structurallyCorrupt = true; }

      let result: NormalizeResult;
      try { result = normalizeSnapshot(parsed); }
      catch (error) {
        if (error instanceof UnsupportedSchemaVersionError) {
          this.report("数据由更新版本的 Locado 创建，当前版本已停止写入。请升级应用后再使用。");
          throw error;
        }
        return this.resetCorrupt(raw);
      }
      if (result.warnings.length) console.warn("[Locado] 数据已自动修复:", result.warnings.join(";"));
      if (structurallyCorrupt) {
        this.protectCorrupt(raw);
        this.report("本地数据损坏,已另存原文并修复数据。");
        this.write(result.snap);
        this.rememberTasks(result.snap);
        return result.snap;
      }
      if (result.migrated) {
        try {
          createSafetyBackup(raw, "before-migration");
          this.write(result.snap);
        } catch (error) {
          this.report("数据迁移未完成，原始数据未被替换。请先导出备份并检查存储空间。");
          throw error;
        }
      }
      this.rememberTasks(result.snap);
      return result.snap;
    }
    const seed = defaultSnapshot();
    this.write(seed);
    this.rememberTasks(seed);
    return seed;
  }

  private write(s: Snapshot): void {
    const raw = JSON.stringify(s);
    try {
      localStorage.setItem(SNAPSHOT_KEY, raw);
    } catch {
      this.report("保存失败:浏览器存储已满或被禁用。请立即用「导入 / 导出」导出 JSON 备份。");
      throw new Error("保存失败，数据未写入本地存储");
    }
    scheduleAutoBackup(raw);
  }

  private report(msg: string): void {
    if (Date.now() - lastErrorAt < 4000) return;
    lastErrorAt = Date.now();
    if (errorHandler) errorHandler(msg);
    else console.error("[Locado] " + msg);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private withIndexedDBLock<T>(operation: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        this.report("浏览器事务锁不可用，已停止写入以保护本地数据。");
        reject(new Error("IndexedDB 不可用，无法锁定本地数据"));
        return;
      }

      let database: IDBDatabase | null = null;
      let transaction: IDBTransaction | null = null;
      let settled = false;
      let operationFailed = false;
      let operationError: unknown;
      let lockError: unknown;
      let result: T;

      const close = () => {
        if (database) database.close();
        database = null;
      };
      const rejectLock = (error: unknown) => {
        if (settled) return;
        settled = true;
        close();
        this.report("浏览器事务锁执行失败，已停止写入以保护本地数据。");
        reject(error instanceof Error ? error : new Error("IndexedDB 事务锁失败"));
      };
      const rejectOperation = (error: unknown) => {
        if (settled) return;
        settled = true;
        close();
        reject(error);
      };

      let openRequest: IDBOpenDBRequest;
      try { openRequest = indexedDB.open("locado.snapshot.locks", 1); }
      catch (error) { rejectLock(error); return; }

      openRequest.onupgradeneeded = () => {
        const db = openRequest.result;
        if (!db.objectStoreNames.contains("writes")) db.createObjectStore("writes");
      };
      openRequest.onerror = () => rejectLock(openRequest.error);
      openRequest.onblocked = () => rejectLock(new Error("IndexedDB 事务锁打开被阻塞"));
      openRequest.onsuccess = () => {
        database = openRequest.result;
        if (settled) { close(); return; }
        try { transaction = database.transaction("writes", "readwrite"); }
        catch (error) { rejectLock(error); return; }
        const tx = transaction;

        tx.oncomplete = () => {
          if (operationFailed) rejectOperation(operationError);
          else if (lockError) rejectLock(lockError);
          else if (!settled) { settled = true; close(); resolve(result); }
        };
        tx.onabort = () => {
          if (operationFailed) rejectOperation(operationError);
          else rejectLock(lockError ?? tx.error ?? new Error("IndexedDB 事务锁已中止"));
        };
        tx.onerror = () => { lockError ??= tx.error; };

        let request: IDBRequest;
        try { request = tx.objectStore("writes").get("snapshot"); }
        catch (error) {
          lockError = error;
          try { tx.abort(); } catch { rejectLock(error); }
          return;
        }
        request.onerror = () => { lockError ??= request.error; };
        request.onsuccess = () => {
          try { result = operation(); }
          catch (error) {
            operationFailed = true;
            operationError = error;
            try { tx.abort(); } catch { rejectOperation(error); }
          }
        };
      };
    });
  }

  private withWriteLock<T>(operation: () => T): Promise<T> {
    return this.enqueue(() => {
      if (typeof navigator !== "undefined") {
        const locks = (navigator as unknown as { locks?: LockManagerLike }).locks;
        if (locks) return locks.request("locado.snapshot.write", () => operation());
      }
      return this.withIndexedDBLock(operation);
    });
  }

  private mutate<T>(operation: (snapshot: Snapshot) => T, shouldWrite: (result: T) => boolean = () => true): Promise<T> {
    return this.withWriteLock(() => {
      const latest = this.loadFromDisk();
      const result = operation(latest);
      if (shouldWrite(result)) this.write(latest);
      this.cache = latest;
      return result;
    });
  }

  async load(): Promise<Snapshot> {
    return this.withWriteLock(() => cloneSnapshot(this.data()));
  }
  async reload(): Promise<Snapshot> {
    return this.withWriteLock(() => {
      const fresh = this.loadFromDisk();
      this.cache = fresh;
      return cloneSnapshot(fresh);
    });
  }
  async replaceAll(next: Snapshot): Promise<void> {
    const replacement = cloneSnapshot(next);
    await this.mutate((snapshot) => {
      createSafetyBackup(JSON.stringify(snapshot));
      Object.assign(snapshot, replacement);
    });
    this.rememberTasks(replacement);
  }

  async saveProject(p: Project): Promise<void> {
    const value = cloneSnapshot(p);
    return this.mutate((snapshot) => {
      const i = snapshot.projects.findIndex((x) => x.id === value.id);
      if (i >= 0) snapshot.projects[i] = value; else snapshot.projects.push(value);
    });
  }
  async deleteProject(id: string): Promise<void> {
    return this.mutate((snapshot) => {
      snapshot.projects = snapshot.projects.filter((x) => x.id !== id);
      snapshot.tasks = snapshot.tasks.filter((t) => t.projectId !== id);
    });
  }

  async saveTag(t: Tag): Promise<void> {
    const value = cloneSnapshot(t);
    return this.mutate((snapshot) => {
      const i = snapshot.tags.findIndex((x) => x.id === value.id);
      if (i >= 0) snapshot.tags[i] = value; else snapshot.tags.push(value);
    });
  }
  async deleteTag(id: string): Promise<void> {
    return this.mutate((snapshot) => {
      snapshot.tags = snapshot.tags.filter((x) => x.id !== id);
      for (const t of snapshot.tasks) t.tags = t.tags.filter((x) => x !== id);
    });
  }

  async saveFilter(f: Filter): Promise<void> {
    const value = cloneSnapshot(f);
    return this.mutate((snapshot) => {
      const i = snapshot.filters.findIndex((x) => x.id === value.id);
      if (i >= 0) snapshot.filters[i] = value; else snapshot.filters.push(value);
    });
  }
  async deleteFilter(id: string): Promise<void> {
    return this.mutate((snapshot) => { snapshot.filters = snapshot.filters.filter((x) => x.id !== id); });
  }

  async saveHabit(h: Habit): Promise<void> {
    const value = cloneSnapshot(h);
    return this.mutate((snapshot) => {
      const i = snapshot.habits.findIndex((x) => x.id === value.id);
      if (i >= 0) snapshot.habits[i] = value; else snapshot.habits.push(value);
    });
  }
  async deleteHabit(id: string): Promise<void> {
    return this.mutate((snapshot) => { snapshot.habits = snapshot.habits.filter((x) => x.id !== id); });
  }

  async saveFocusRecord(r: FocusRecord): Promise<void> {
    const value = cloneSnapshot(r);
    return this.mutate((snapshot) => {
      const i = snapshot.focusRecords.findIndex((x) => x.id === value.id);
      if (i >= 0) snapshot.focusRecords[i] = value; else snapshot.focusRecords.push(value);
    });
  }

  async saveTask(t: Task, options: TaskSaveOptions = {}): Promise<void> {
    return this.saveTasks([t], [], options);
  }
  async updateTask(t: Task): Promise<void> {
    const value = cloneSnapshot(t);
    return this.mutate((snapshot) => {
      const i = snapshot.tasks.findIndex((x) => x.id === value.id);
      if (i < 0) return;
      const current = snapshot.tasks[i];
      if (current.dueDate === value.dueDate && current.reminderMinutesBefore === value.reminderMinutesBefore) {
        value.reminded = current.reminded;
      }
      snapshot.tasks[i] = value;
    });
  }
  async saveTasks(upserts: Task[], deleteIds: string[] = [], options: TaskSaveOptions = {}): Promise<void> {
    const values = cloneSnapshot(upserts);
    const deleted = new Set(deleteIds);
    await this.mutate((snapshot) => {
      const currentIds = new Set(snapshot.tasks.map((task) => task.id));
      const hasStaleUpsert = !options.restore && values.some((task) => !currentIds.has(task.id) && this.knownTaskIds.has(task.id));
      if (hasStaleUpsert) return false;
      if (deleted.size) snapshot.tasks = snapshot.tasks.filter((task) => !deleted.has(task.id));
      for (const task of values) {
        const i = snapshot.tasks.findIndex((x) => x.id === task.id);
        if (i >= 0) snapshot.tasks[i] = task;
        else if (options.restore || !this.knownTaskIds.has(task.id)) snapshot.tasks.push(task);
      }
      return true;
    }, (applied) => applied);
    for (const task of values) this.knownTaskIds.add(task.id);
  }
  async deleteTask(id: string): Promise<void> {
    return this.mutate((snapshot) => { snapshot.tasks = snapshot.tasks.filter((x) => x.id !== id); });
  }
  async claimReminder(id: string, at: number, now: number): Promise<ReminderClaim | null> {
    return this.mutate((snapshot) => {
      const task = snapshot.tasks.find((item) => item.id === id);
      if (!task || task.completed || task.reminded || task.dueDate == null || task.reminderMinutesBefore == null) return null;
      const currentAt = task.dueDate - task.reminderMinutesBefore * 60000;
      if (currentAt !== at || now < at) return null;
      task.reminded = true;
      return { task: cloneSnapshot(task), notify: now - at < 12 * 3600000 };
    }, (claim) => claim !== null);
  }
}

// 预留:Tauri/SQLite 实现(装好工具链接入后再填充 invoke 调用)。
function isTauri(): boolean {
  return typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";
}

export function createLocalStore(): Database { return new LocalStore(); }

let instance: Database | null = null;
export function getDB(): Database {
  if (instance) return instance;
  void isTauri;
  instance = createLocalStore();
  return instance;
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
