import type { RecurrenceRule, Task } from "./types.ts";

export interface TaskChangePlan {
  upserts: Task[];
  deleteIds: string[];
  nextPreserved?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function normalizeRecurrence(value: unknown): RecurrenceRule | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "daily") return { kind: "daily" };
  if (value.kind === "weekly") {
    const weekdays = Array.isArray(value.weekdays)
      ? [...new Set(value.weekdays.filter((day): day is number => isIntegerIn(day, 0, 6)))].sort((a, b) => a - b)
      : [];
    return weekdays.length ? { kind: "weekly", weekdays } : null;
  }
  if (value.kind === "monthly") {
    if (value.day === "last") return { kind: "monthly", day: "last" };
    return isIntegerIn(value.day, 1, 31) ? { kind: "monthly", day: value.day } : null;
  }
  if (value.kind === "yearly") {
    if (!isIntegerIn(value.month, 1, 12) || !isIntegerIn(value.day, 1, 31)) return null;
    const maxDay = new Date(2024, value.month, 0).getDate();
    return value.day <= maxDay ? { kind: "yearly", month: value.month, day: value.day } : null;
  }
  if (value.kind === "afterCompletion") {
    return isIntegerIn(value.days, 1, Number.MAX_SAFE_INTEGER) ? { kind: "afterCompletion", days: value.days } : null;
  }
  return null;
}

type FixedRule = Exclude<RecurrenceRule, { kind: "afterCompletion" }>;

function dateInMonth(template: Date, year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const result = new Date(template);
  result.setDate(1);
  result.setFullYear(year, month, Math.min(day, lastDay));
  return result;
}

function nextFixedOccurrence(rule: FixedRule, current: Date): Date | null {
  if (rule.kind === "daily") {
    const next = new Date(current); next.setDate(next.getDate() + 1); return next;
  }
  if (rule.kind === "weekly") {
    for (let offset = 1; offset <= 7; offset++) {
      const next = new Date(current); next.setDate(next.getDate() + offset);
      if (rule.weekdays.includes(next.getDay())) return next;
    }
    return null;
  }
  if (rule.kind === "monthly") {
    const nextMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    const day = rule.day === "last" ? new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate() : rule.day;
    return dateInMonth(current, nextMonth.getFullYear(), nextMonth.getMonth(), day);
  }
  const year = current.getFullYear() + 1;
  return dateInMonth(current, year, rule.month - 1, rule.day);
}

export function nextRecurringDue(rule: RecurrenceRule, currentDue: number, completedAt: number): number | null {
  if (!Number.isFinite(currentDue) || !Number.isFinite(completedAt)) return null;
  const current = new Date(currentDue);
  if (rule.kind === "afterCompletion") {
    const next = new Date(completedAt);
    next.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds());
    next.setDate(next.getDate() + rule.days);
    return next.getTime();
  }

  let candidate = nextFixedOccurrence(rule, current);
  while (candidate && candidate.getTime() <= completedAt) {
    const next = nextFixedOccurrence(rule, candidate);
    if (!next || next.getTime() <= candidate.getTime()) return null;
    candidate = next;
  }
  return candidate?.getTime() ?? null;
}

export function firstRecurringDue(rule: RecurrenceRule, from: number): number | null {
  if (!Number.isFinite(from)) return null;
  const current = new Date(from);
  if (rule.kind === "daily" || rule.kind === "afterCompletion") return from;
  if (rule.kind === "weekly") {
    for (let offset = 0; offset <= 6; offset++) {
      const candidate = new Date(current); candidate.setDate(candidate.getDate() + offset);
      if (rule.weekdays.includes(candidate.getDay())) return candidate.getTime();
    }
    return null;
  }

  const candidate = rule.kind === "monthly"
    ? dateInMonth(current, current.getFullYear(), current.getMonth(), rule.day === "last" ? new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate() : rule.day)
    : dateInMonth(current, current.getFullYear(), rule.month - 1, rule.day);
  const dayStart = (value: Date) => { const day = new Date(value); day.setHours(0, 0, 0, 0); return day.getTime(); };
  if (dayStart(candidate) >= dayStart(current)) return candidate.getTime();
  return nextFixedOccurrence(rule, current)?.getTime() ?? null;
}

export function recurrenceSummary(rule: RecurrenceRule): string {
  if (rule.kind === "daily") return "每天";
  if (rule.kind === "weekly") {
    const names = ["日", "一", "二", "三", "四", "五", "六"];
    return `每周${[...rule.weekdays].sort((a, b) => a - b).map((day) => names[day]).join("、")}`;
  }
  if (rule.kind === "monthly") return rule.day === "last" ? "每月最后一天" : `每月${rule.day}日`;
  if (rule.kind === "yearly") return `每年${rule.month}月${rule.day}日`;
  return `完成后${rule.days}天`;
}

function cloneRule(rule: RecurrenceRule): RecurrenceRule | undefined {
  return normalizeRecurrence(rule) ?? undefined;
}

export function planRecurringToggle(
  tasks: Task[],
  taskId: string,
  now: number,
  newId: () => string,
): TaskChangePlan {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return { upserts: [], deleteIds: [] };

  const completing = !task.completed;
  const base: Task = {
    ...task,
    completed: completing,
    completedAt: completing ? now : null,
    updatedAt: now,
  };
  if (!task.recurrence) {
    base.recurrenceNextId = undefined;
    return { upserts: [base], deleteIds: [] };
  }

  if (completing) {
    const linked = task.recurrenceNextId
      ? tasks.find((item) => item.id === task.recurrenceNextId && item.recurrenceSourceId === task.id)
      : undefined;
    if (linked) return { upserts: [base], deleteIds: [] };

    base.recurrenceNextId = undefined;
    if (task.dueDate == null) return { upserts: [base], deleteIds: [] };
    const dueDate = nextRecurringDue(task.recurrence, task.dueDate, now);
    if (dueDate == null) return { upserts: [base], deleteIds: [] };

    const next: Task = {
      ...task,
      id: newId(),
      completed: false,
      completedAt: null,
      dueDate,
      reminded: false,
      tags: [...task.tags],
      subtasks: task.subtasks.map((subtask) => ({ ...subtask, completed: false })),
      createdAt: now,
      updatedAt: now,
      recurrence: cloneRule(task.recurrence),
      recurrenceSourceId: task.id,
      recurrenceNextId: undefined,
    };
    base.recurrenceNextId = next.id;
    return { upserts: [base, next], deleteIds: [] };
  }

  base.recurrenceNextId = undefined;
  if (!task.recurrenceNextId) return { upserts: [base], deleteIds: [] };
  const next = tasks.find((item) => item.id === task.recurrenceNextId && item.recurrenceSourceId === task.id);
  if (!next) return { upserts: [base], deleteIds: [] };

  const pristine = !next.completed && next.createdAt === next.updatedAt;
  if (pristine) return { upserts: [base], deleteIds: [next.id] };

  base.recurrence = undefined;
  return { upserts: [base], deleteIds: [], nextPreserved: true };
}
