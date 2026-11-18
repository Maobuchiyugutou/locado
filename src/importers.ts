// 从滴答清单 / TickTick 导入。
// 支持其官方 CSV 导出(设置 → 备份 → 导出)。表头为:
// Folder Name, List Name, Title, Tags, Content, Is Check list, Start Date, Due Date,
// Reminder, Repeat, Priority, Status, Completed Time, Order, Timezone, Is All Day,
// Is Floating, Column Name, Column Order, View Mode, taskId, parentId

import type { Priority, Project, RecurrenceRule, Tag, Task } from "./types.ts";
import { uid } from "./db.ts";
import { PROJECT_COLORS } from "./types.ts";
import { normalizeRecurrence } from "./recurrence.ts";

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
  warnings: string[];
}

function toPriority(v: string): Priority {
  const n = Number(v);
  return (n === 5 || n === 3 || n === 1) ? (n as Priority) : 0;
}

function toEpoch(v: string): number | null {
  const value = v?.trim();
  if (!value) return null;

  // Date.parse 会把纯日期当成 UTC，并自动进位 2 月 30 日等不存在的日期。
  const pureDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (pureDate) {
    const year = Number(pureDate[1]);
    const month = Number(pureDate[2]);
    const day = Number(pureDate[3]);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(9, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== 9) return null;
    return date.getTime();
  }

  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function hasExplicitTime(v: string): boolean {
  if (toEpoch(v) == null) return false;
  return /(?:^|[T\s])([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?:\.\d+)?(?:\s*[AP]M)?(?:Z|[+-]\d{2}:?\d{2})?\s*$/i.test(v.trim());
}

function toReminderMinutes(v: string, dueDate: number | null): number | null {
  const value = v.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const minutes = Number(value);
    return Number.isSafeInteger(minutes) ? minutes : null;
  }

  if (dueDate == null || !hasExplicitTime(value)) return null;
  const reminderAt = toEpoch(value);
  if (reminderAt == null) return null;
  const minutes = (dueDate - reminderAt) / 60000;
  return Number.isSafeInteger(minutes) && minutes >= 0 ? minutes : null;
}

function calendarNumber(value: string): number | null {
  if (/^\d{1,2}$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (digits[value] != null) return digits[value];
  let match = /^十([一二两三四五六七八九])?$/.exec(value);
  if (match) return 10 + (match[1] ? digits[match[1]] : 0);
  match = /^([一二三])十([一二两三四五六七八九])?$/.exec(value);
  return match ? digits[match[1]] * 10 + (match[2] ? digits[match[2]] : 0) : null;
}

function parseChineseRepeat(value: string): RecurrenceRule | null {
  if (/^(?:每天|每日)$/.test(value)) return normalizeRecurrence({ kind: "daily" });

  const weekly = /^每\s*(?:周|星期|礼拜)\s*([一二三四五六日天](?:\s*[、,，]\s*(?:(?:周|星期|礼拜)\s*)?[一二三四五六日天])*)$/.exec(value);
  if (weekly) {
    const weekdays: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
    const days = weekly[1].split(/\s*[、,，]\s*/).map((part) => weekdays[part.trim().slice(-1)]);
    return normalizeRecurrence({ kind: "weekly", weekdays: days });
  }

  if (/^每\s*月\s*(?:最后一天|月末)$/.test(value)) return normalizeRecurrence({ kind: "monthly", day: "last" });
  const monthly = /^每\s*月\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[日号]$/.exec(value);
  if (monthly) return normalizeRecurrence({ kind: "monthly", day: calendarNumber(monthly[1]) });

  const yearly = /^每\s*年\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*月\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[日号]$/.exec(value);
  if (yearly) return normalizeRecurrence({ kind: "yearly", month: calendarNumber(yearly[1]), day: calendarNumber(yearly[2]) });
  return null;
}

function parseRRule(value: string, dueDate: number | null): RecurrenceRule | null {
  const fields = new Map<string, string>();
  for (const part of value.replace(/^RRULE:/i, "").split(";")) {
    const equals = part.indexOf("=");
    if (equals <= 0) return null;
    const key = part.slice(0, equals).trim().toUpperCase();
    const fieldValue = part.slice(equals + 1).trim().toUpperCase();
    if (!/^[A-Z]+$/.test(key) || !fieldValue || fields.has(key)) return null;
    fields.set(key, fieldValue);
  }

  const frequency = fields.get("FREQ");
  const interval = fields.get("INTERVAL") ?? "1";
  if (interval !== "1") return null;
  const allows = (names: string[]) => [...fields.keys()].every((name) => names.includes(name));
  const oneInteger = (name: string): number | null => {
    const raw = fields.get(name);
    if (raw == null) return null;
    if (!/^-?\d+$/.test(raw)) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };

  if (frequency === "DAILY") {
    return allows(["FREQ", "INTERVAL"]) ? normalizeRecurrence({ kind: "daily" }) : null;
  }
  if (frequency === "WEEKLY") {
    if (!allows(["FREQ", "INTERVAL", "BYDAY"])) return null;
    const byDay = fields.get("BYDAY");
    if (!byDay) return null;
    const dayNumbers: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const weekdays = byDay.split(",").map((day) => dayNumbers[day]);
    return weekdays.every((day) => day != null) ? normalizeRecurrence({ kind: "weekly", weekdays }) : null;
  }
  if (frequency === "MONTHLY") {
    if (!allows(["FREQ", "INTERVAL", "BYMONTHDAY"]) || !fields.has("BYMONTHDAY")) return null;
    const day = oneInteger("BYMONTHDAY");
    return normalizeRecurrence({ kind: "monthly", day: day === -1 ? "last" : day });
  }
  if (frequency === "YEARLY") {
    if (!allows(["FREQ", "INTERVAL", "BYMONTH", "BYMONTHDAY"])) return null;
    let month = oneInteger("BYMONTH");
    let day = oneInteger("BYMONTHDAY");
    if ((fields.has("BYMONTH") && month == null) || (fields.has("BYMONTHDAY") && day == null)) return null;
    if (month == null || day == null) {
      if (dueDate == null) return null;
      const due = new Date(dueDate);
      month ??= due.getMonth() + 1;
      day ??= due.getDate();
    }
    return normalizeRecurrence({ kind: "yearly", month, day });
  }
  return null;
}

function parseRepeat(v: string, dueDate: number | null): RecurrenceRule | null {
  const value = v.trim();
  if (/^(?:RRULE:)?FREQ=/i.test(value)) return parseRRule(value, dueDate);
  return parseChineseRepeat(value);
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
  const iReminder = at("Reminder");
  const iRepeat = at("Repeat");
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
  let ignoredReminders = 0;
  let ignoredRepeats = 0;

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

    const tagIds = [...new Set((iTags >= 0 ? (r[iTags] ?? "") : "")
      .split(/[,，]/).map((s) => s.trim()).filter(Boolean).map(getTag))];

    const dueDate = iDue >= 0 ? toEpoch(r[iDue] ?? "") : null;
    const reminderText = iReminder >= 0 ? (r[iReminder] ?? "").trim() : "";
    const reminderMinutesBefore = toReminderMinutes(reminderText, dueDate);
    if (reminderText && reminderMinutesBefore == null) ignoredReminders++;
    const repeatText = iRepeat >= 0 ? (r[iRepeat] ?? "").trim() : "";
    const recurrence = parseRepeat(repeatText, dueDate) ?? undefined;
    if (repeatText && !recurrence) ignoredRepeats++;

    const task: Task = {
      id: uid(),
      projectId: getProject(iList >= 0 ? r[iList] : ""),
      title,
      note: iContent >= 0 ? (r[iContent] ?? "") : "",
      priority: iPrio >= 0 ? toPriority(r[iPrio]) : 0,
      completed: done,
      completedAt: done ? ((iCompleted >= 0 ? toEpoch(r[iCompleted] ?? "") : null) ?? Date.now()) : null,
      dueDate,
      hasTime: iDue >= 0 ? hasExplicitTime(r[iDue] ?? "") : false,
      reminderMinutesBefore,
      recurrence,
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

  const warnings: string[] = [];
  if (ignoredReminders) warnings.push(`已忽略 ${ignoredReminders} 个任务的提醒：Reminder 格式不受支持或无法与 Due Date 无损换算，任务已保留。`);
  if (ignoredRepeats) warnings.push(`已忽略 ${ignoredRepeats} 个任务的重复规则：Repeat 格式不受支持或无法无损映射，任务已保留。`);

  return {
    projects: [...projects.values()],
    tags: [...tags.values()],
    tasks: [...tasksById.values()],
    warnings,
  };
}
