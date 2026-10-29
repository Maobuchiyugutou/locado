// 从滴答清单 / TickTick 导入。
// 支持其官方 CSV 导出(设置 → 备份 → 导出)。表头为:
// Folder Name, List Name, Title, Tags, Content, Is Check list, Start Date, Due Date,
// Reminder, Repeat, Priority, Status, Completed Time, Order, Timezone, Is All Day,
// Is Floating, Column Name, Column Order, View Mode, taskId, parentId

import type { Priority, Project, Tag, Task } from "./types.ts";
import { uid } from "./db.ts";
import { PROJECT_COLORS } from "./types.ts";

// 一个容错的 CSV 解析器:支持引号包裹、字段内逗号/换行、"" 转义。
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* 跳过 */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export interface ImportResult {
  projects: Project[];
  tags: Tag[];
  tasks: Task[];
}

function toPriority(v: string): Priority {
  const n = Number(v);
  return (n === 5 || n === 3 || n === 1) ? (n as Priority) : 0;
}

function toEpoch(v: string): number | null {
  if (!v || !v.trim()) return null;
  const t = Date.parse(v.trim());
  return Number.isNaN(t) ? null : t;
}

function hasExplicitTime(v: string): boolean {
  if (toEpoch(v) == null) return false;
  return /(?:^|[T\s])([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?:\.\d+)?(?:\s*[AP]M)?(?:Z|[+-]\d{2}:?\d{2})?\s*$/i.test(v.trim());
}

export function importFromTickTickCsv(text: string): ImportResult {
  const rows = parseCsv(text);

  // 定位表头行(包含 Title 且包含 List Name / Folder Name)
  let h = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.includes("Title") && (r.includes("List Name") || r.includes("Folder Name"))) { h = i; break; }
  }
  if (h < 0) throw new Error("无法识别的 CSV:没找到 TickTick/滴答 的表头行。");

  const cols = rows[h];
  const at = (name: string) => cols.indexOf(name);
  const iList = at("List Name");
  const iTitle = at("Title");
  const iTags = at("Tags");
  const iContent = at("Content");
  const iDue = at("Due Date");
  const iCompleted = at("Completed Time");
  const iPrio = at("Priority");
  const iStatus = at("Status");
  const iTaskId = at("taskId");
  const iParent = at("parentId");
  if (iTitle < 0) throw new Error("CSV 缺少 Title 列。");

  const projects = new Map<string, Project>();
  const tags = new Map<string, Tag>();
  const tasksById = new Map<string, Task>(); // key: 原 taskId
  const children: { parent: string; title: string; done: boolean }[] = [];

  const getProject = (name: string): string => {
    const key = (name || "收集箱").trim() || "收集箱";
    let p = projects.get(key);
    if (!p) {
      p = { id: uid(), name: key, color: PROJECT_COLORS[projects.size % PROJECT_COLORS.length], sortOrder: projects.size, createdAt: Date.now() };
      projects.set(key, p);
    }
    return p.id;
  };
  const getTag = (name: string): string => {
    const key = name.trim();
    let t = tags.get(key);
    if (!t) {
      t = { id: uid(), name: key, color: PROJECT_COLORS[tags.size % PROJECT_COLORS.length] };
      tags.set(key, t);
    }
    return t.id;
  };

  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.length || (r.length === 1 && !r[0].trim())) continue;
    const title = (r[iTitle] ?? "").trim();
    if (!title) continue;

    const status = iStatus >= 0 ? (r[iStatus] ?? "").trim() : "0";
    const done = status !== "" && status !== "0";
    const parentId = iParent >= 0 ? (r[iParent] ?? "").trim() : "";
    const taskId = iTaskId >= 0 ? (r[iTaskId] ?? "").trim() : "";

    if (parentId) {
      children.push({ parent: parentId, title, done });
      continue;
    }

    const tagIds = (iTags >= 0 ? (r[iTags] ?? "") : "")
      .split(/[,，]/).map((s) => s.trim()).filter(Boolean).map(getTag);

    const task: Task = {
      id: uid(),
      projectId: getProject(iList >= 0 ? r[iList] : ""),
      title,
      note: iContent >= 0 ? (r[iContent] ?? "") : "",
      priority: iPrio >= 0 ? toPriority(r[iPrio]) : 0,
      completed: done,
      completedAt: done ? ((iCompleted >= 0 ? toEpoch(r[iCompleted]) : null) ?? Date.now()) : null,
      dueDate: iDue >= 0 ? toEpoch(r[iDue]) : null,
      hasTime: iDue >= 0 ? hasExplicitTime(r[iDue]) : false,
      pinned: false,
      tags: tagIds,
      subtasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    tasksById.set(taskId || task.id, task);
  }

  // 把子项挂到父任务下
  for (const c of children) {
    const parent = tasksById.get(c.parent);
    if (parent) parent.subtasks.push({ id: uid(), title: c.title, completed: c.done });
  }

  return {
    projects: [...projects.values()],
    tags: [...tags.values()],
    tasks: [...tasksById.values()],
  };
}
