import type { Filter, Task } from "./types";

export function startOfToday(offset = 0, now = new Date()): number {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isOverdue(ts: number, now = new Date()): boolean {
  const day = new Date(ts);
  day.setHours(0, 0, 0, 0);
  return day.getTime() < startOfToday(0, now);
}

export function matchesRule(t: Task, r: Filter["rule"], now = new Date()): boolean {
  if (r.projectIds.length && !r.projectIds.includes(t.projectId)) return false;
  if (r.tagIds.length && !r.tagIds.some((id) => t.tags.includes(id))) return false;
  if (r.priorities.length && !r.priorities.includes(t.priority)) return false;
  if (r.due === "overdue" && !(t.dueDate != null && isOverdue(t.dueDate, now))) return false;
  if (r.due === "today" && !(t.dueDate != null && t.dueDate < startOfToday(1, now))) return false;
  if (r.due === "next7" && !(t.dueDate != null && t.dueDate < startOfToday(7, now))) return false;
  if (r.due === "nodate" && t.dueDate != null) return false;
  return true;
}

export function matchView(t: Task, v: string, filters: Filter[], now = new Date()): boolean {
  if (v === "smart:completed") return t.completed;
  if (t.completed) return false;
  if (v === "smart:all") return true;
  if (v === "smart:today") return t.dueDate != null && t.dueDate < startOfToday(1, now);
  if (v === "smart:next7") return t.dueDate != null && t.dueDate < startOfToday(7, now);
  if (v.startsWith("project:")) return t.projectId === v.slice(8);
  if (v.startsWith("tag:")) return t.tags.includes(v.slice(4));
  if (v.startsWith("filter:")) {
    const f = filters.find((x) => x.id === v.slice(7));
    return f ? matchesRule(t, f.rule, now) : false;
  }
  return false;
}

export function sortTasks(a: Task, b: Task): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  const ad = a.dueDate ?? Infinity, bd = b.dueDate ?? Infinity;
  if (ad !== bd) return ad - bd;
  return a.createdAt - b.createdAt;
}
