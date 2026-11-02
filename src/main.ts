import "./styles.css";
import { isTauri } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  isPermissionGranted as hasNativeNotificationPermission,
  requestPermission as requestNativeNotificationPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { createSafetyBackup, flushAutoBackup, listBackups, onBackupError, readBackupSnapshot } from "./backups";
import { assertSnapshotImport, getDB, normalizeSnapshot, onStorageError, SNAPSHOT_KEY, uid } from "./db";
import { INBOX_ID } from "./seed";
import { FOCUS_STORAGE_KEY, focusRecordId, idleFocus, parseFocusState, serializeFocusState, type FocusState } from "./focus";
import { importFromTickTickCsv } from "./importers";
import { applyQuickAddCorrections, parseTask, resolveQuickAddMetadata, type ParsedTask } from "./nlp";
import { setupPWA } from "./pwa";
import { nextRecurringDue, normalizeRecurrence, planRecurringToggle, recurrenceSummary } from "./recurrence";
import {
  HABIT_ICONS,
  PROJECT_COLORS,
  type DueFilter,
  type Filter,
  type FocusRecord,
  type Habit,
  type Priority,
  type RecurrenceRule,
  type Snapshot,
  type Task,
} from "./types";

const db = getDB();
let snap: Snapshot = { projects: [], tags: [], tasks: [], filters: [], habits: [], focusRecords: [] };
let view = "smart:today";
let selectedId: string | null = null;
let calMonth = firstOfMonth(new Date());

/* ============ 工具 ============ */
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

type Props = Record<string, unknown>;
function el(tag: string, props: Props = {}, ...kids: (Node | string)[]): HTMLElement {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = String(v);
    else if (k === "style") n.setAttribute("style", String(v));
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, String(v));
  }
  for (const c of kids) n.append(c);
  return n;
}

function keyboardActivate(node: HTMLElement, action: () => void): void {
  node.addEventListener("keydown", (e) => {
    if (e.target !== node || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    action();
  });
}

// 统一的线性图标,替代导航和控件里混用的 emoji/符号。
const ICONS: Record<string, string> = {
  sun: "M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z",
  "calendar-week": "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01",
  calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  layers: "M12 2 2 7l10 5 10-5-10-5ZM2 12l10 5 10-5M2 17l10 5 10-5",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  flame: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 8v4l3 2",
  "check-circle": "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 12l3 3 6-6",
  "check-square": "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 12l3 3 6-6",
  check: "M5 12.5 10 17.5 19.5 7",
  chevron: "m6 9 6 6 6-6",
  sync: "M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21a2 2 0 0 0 4 0",
  pin: "M12 17v5M9 10.76V7a3 3 0 0 1 6 0v3.76M5 9h14l-2 5H7L5 9Z",
};

function icon(name: string, className = ""): HTMLElement {
  const span = el("span", { class: "app-icon" + (className ? " " + className : ""), "aria-hidden": "true" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  span.append(svg);
  return span;
}

interface SelectOption { value: string; label: string }
interface SelectControl { el: HTMLElement; getValue: () => string }
let closeOpenSelect: (() => void) | null = null;

// 自绘下拉:原生 select 的弹出层无法按玻璃风格统一,这里保留按钮/菜单、
// 键盘方向键、Escape、点外部关闭和边界向上展开。
function selectControl(options: SelectOption[], initial: string, onChange: (value: string) => void = () => {}): SelectControl {
  let value = options.some((o) => o.value === initial) ? initial : (options[0]?.value ?? "");
  const label = el("span", { class: "select-label" });
  const btn = el("button", { class: "select", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false" });
  const menu = el("div", { class: "select-menu", role: "listbox" });
  const wrap = el("div", { class: "select-wrap" }, btn, menu);
  const updateLabel = () => { label.textContent = options.find((o) => o.value === value)?.label ?? "请选择"; };
  btn.append(label, icon("chevron", "select-chevron"));
  updateLabel();

  let open = false;
  const onDocClick = (ev: Event) => { if (!wrap.contains(ev.target as Node)) closeMenu(); };
  const onDocKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    closeMenu(); btn.focus();
  };

  function closeMenu(): void {
    if (!open) return;
    open = false;
    wrap.classList.remove("open", "up");
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onDocKey, true);
    if (closeOpenSelect === closeMenu) closeOpenSelect = null;
  }

  function choose(v: string): void {
    value = v;
    updateLabel();
    closeMenu();
    btn.focus();
    onChange(v);
  }

  function openMenu(): void {
    if (open) { closeMenu(); return; }
    closeOpenSelect?.();
    open = true;
    const rect = btn.getBoundingClientRect();
    if (window.innerHeight - rect.bottom < 280 && rect.top > 280) wrap.classList.add("up");
    wrap.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    menu.innerHTML = "";
    let selectedBtn: HTMLElement | null = null;
    for (const opt of options) {
      const selected = opt.value === value;
      const b = el("button", {
        class: "select-option" + (selected ? " on" : ""), type: "button", role: "option",
        "aria-selected": selected ? "true" : "false",
        onClick: (ev: Event) => { ev.stopPropagation(); choose(opt.value); },
      }, el("span", { class: "option-label" }, opt.label), selected ? icon("check", "option-check") : el("span"));
      if (selected) selectedBtn = b;
      menu.append(b);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onDocKey, true);
    closeOpenSelect = closeMenu;
    setTimeout(() => { (selectedBtn ?? menu.querySelector("button"))?.focus(); }, 0);
  }

  btn.addEventListener("click", (ev) => { ev.stopPropagation(); openMenu(); });
  menu.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    ev.preventDefault();
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button")];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const delta = ev.key === "ArrowDown" ? 1 : -1;
    const next = current < 0 ? (delta > 0 ? 0 : buttons.length - 1) : (current + delta + buttons.length) % buttons.length;
    buttons[next].focus();
  });

  return { el: wrap, getValue: () => value };
}

const DAY = 86400000;
function startOfToday(): number { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function firstOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function dayKey(d: Date): string { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function toDateInput(ts: number | null): string {
  if (ts == null) return "";
  const d = new Date(ts); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fromDateInput(v: string): number | null {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d, 9, 0, 0, 0).getTime();
}
function dueLabel(ts: number): string {
  const day = new Date(ts); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - startOfToday()) / DAY);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === -1) return "昨天";
  if (diff < 0) return `逾期 ${-diff} 天`;
  if (diff < 7) return `${diff} 天后`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function isOverdue(ts: number): boolean {
  const day = new Date(ts); day.setHours(0, 0, 0, 0);
  return day.getTime() < startOfToday();
}
function fmtTime(ts: number): string { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}`; }
function remindLabel(min: number): string { if (min === 0) return "准时"; if (min % 1440 === 0) return `提前${min / 1440}天`; if (min % 60 === 0) return `提前${min / 60}小时`; return `提前${min}分`; }

/* ============ 视图与过滤 ============ */
const SMART = [
  { id: "smart:today", name: "今天", ico: "sun" },
  { id: "smart:next7", name: "最近 7 天", ico: "calendar-week" },
  { id: "smart:all", name: "全部", ico: "layers" },
  { id: "calendar", name: "日历", ico: "calendar" },
  { id: "matrix", name: "四象限", ico: "grid" },
];

const QUADRANTS = [
  { important: true, urgent: true, title: "重要且紧急", sub: "马上做", color: "var(--p-high)" },
  { important: true, urgent: false, title: "重要不紧急", sub: "安排做", color: "var(--p-mid)" },
  { important: false, urgent: true, title: "紧急不重要", sub: "可委托", color: "var(--p-low)" },
  { important: false, urgent: false, title: "不重要不紧急", sub: "少做", color: "var(--p-none)" },
];
function isImportant(t: Task): boolean { return t.important ?? (t.priority === 5 || t.priority === 3); }
function isUrgent(t: Task): boolean { return t.urgent ?? (t.priority === 5 || t.priority === 1); }
let dragTaskId: string | null = null;

function matchesRule(t: Task, r: Filter["rule"]): boolean {
  if (r.projectIds.length && !r.projectIds.includes(t.projectId)) return false;
  if (r.tagIds.length && !r.tagIds.some((id) => t.tags.includes(id))) return false;
  if (r.priorities.length && !r.priorities.includes(t.priority)) return false;
  if (r.due === "overdue" && !(t.dueDate != null && isOverdue(t.dueDate))) return false;
  if (r.due === "today" && !(t.dueDate != null && t.dueDate <= startOfToday() + DAY)) return false;
  if (r.due === "next7" && !(t.dueDate != null && t.dueDate <= startOfToday() + 7 * DAY)) return false;
  if (r.due === "nodate" && t.dueDate != null) return false;
  return true;
}

function matchView(t: Task, v: string): boolean {
  if (v === "smart:completed") return t.completed;
  if (t.completed) return false;
  if (v === "smart:all") return true;
  if (v === "smart:today") return t.dueDate != null && t.dueDate <= startOfToday() + DAY;
  if (v === "smart:next7") return t.dueDate != null && t.dueDate <= startOfToday() + 7 * DAY;
  if (v.startsWith("project:")) return t.projectId === v.slice(8);
  if (v.startsWith("tag:")) return t.tags.includes(v.slice(4));
  if (v.startsWith("filter:")) {
    const f = snap.filters.find((x) => x.id === v.slice(7));
    return f ? matchesRule(t, f.rule) : false;
  }
  return false;
}

function activeCount(v: string): number {
  return snap.tasks.filter((t) => !t.completed && matchView(t, v)).length;
}

/* 手动排序按视图分别记录,避免在"今天"拖一次就改掉"全部"的顺序。
   任务本身不存排序号,默认顺序永远是:置顶 → 优先级 → 截止日期 → 创建时间。 */
const ORDER_PREFIX = "locado.order.";
const orderMemo = new Map<string, string[]>();

function viewOrder(v: string): string[] {
  if (!orderMemo.has(v)) {
    let ids: string[] = [];
    try {
      const raw = localStorage.getItem(ORDER_PREFIX + v);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
    } catch { /* 存储被禁用时退化为默认排序 */ }
    orderMemo.set(v, ids);
  }
  return orderMemo.get(v)!;
}

function sortTasks(a: Task, b: Task): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  const ad = a.dueDate ?? Infinity, bd = b.dueDate ?? Infinity;
  if (ad !== bd) return ad - bd;
  return a.createdAt - b.createdAt;
}

function sortForView(v: string, items: Task[]): Task[] {
  const ids = viewOrder(v);
  if (!ids.length) return items.sort(sortTasks);
  const rank = new Map(ids.map((id, i) => [id, i] as [string, number]));
  return items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ra = rank.get(a.id), rb = rank.get(b.id);
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return sortTasks(a, b);
  });
}

function viewName(v: string): string {
  if (v === "smart:completed") return "已完成";
  if (v === "calendar") return "日历";
  if (v === "matrix") return "四象限";
  if (v === "habits") return "习惯打卡";
  if (v === "focus") return "专注番茄钟";
  const s = SMART.find((x) => x.id === v);
  if (s) return s.name;
  if (v.startsWith("project:")) return snap.projects.find((p) => p.id === v.slice(8))?.name ?? "清单";
  if (v.startsWith("tag:")) return "#" + (snap.tags.find((t) => t.id === v.slice(4))?.name ?? "");
  if (v.startsWith("filter:")) return snap.filters.find((f) => f.id === v.slice(7))?.name ?? "筛选器";
  return "任务";
}

/* ============ 侧边栏 ============ */
function renderSidebar(): void {
  const bar = $("#sidebar");
  bar.innerHTML = "";
  bar.append(el("div", { class: "brand" }, el("div", { class: "logo" }, icon("check", "logo-icon")), el("div", { class: "name" }, "Locado")));

  for (const s of SMART) {
    const noCount = s.id === "calendar" || s.id === "matrix";
    bar.append(navItem({ id: s.id, ico: s.ico, label: s.name, count: noCount ? 0 : activeCount(s.id) }));
  }

  const lc = isCollapsed("projects", false);
  bar.append(groupHeader("projects", "清单", lc, () => addProject()));
  if (!lc) for (const p of [...snap.projects].sort((a, b) => a.sortOrder - b.sortOrder)) {
    bar.append(navItem({ id: "project:" + p.id, dot: p.color, label: p.name, count: activeCount("project:" + p.id), onDel: p.id === INBOX_ID ? undefined : () => removeProject(p.id) }));
  }

  {
    const tc = isCollapsed("tags", true);
    bar.append(groupHeader("tags", "标签", tc, () => addTag()));
    if (!tc) for (const t of snap.tags) bar.append(navItem({
      id: "tag:" + t.id,
      dot: t.color,
      label: t.name,
      count: activeCount("tag:" + t.id),
      onEdit: () => renameTag(t.id),
      onDel: () => removeTag(t.id),
    }));
  }

  {
    const fc = isCollapsed("filters", true);
    bar.append(groupHeader("filters", "筛选器", fc, () => openFilterEditor()));
    if (!fc) for (const f of snap.filters) {
      bar.append(navItem({ id: "filter:" + f.id, dot: f.color, label: f.name, count: activeCount("filter:" + f.id), onEdit: () => openFilterEditor(f) }));
    }
  }

  const tray = el("div", { class: "tray" });
  for (const [id, ico, label] of [["habits", "flame", "习惯"], ["focus", "clock", "专注"], ["smart:completed", "check-circle", "已完成"]] as [string, string, string][]) {
    tray.append(el("button", { class: "tray-btn" + (view === id ? " active" : ""), title: label, onClick: () => { view = id; render(); } }, icon(ico)));
  }
  tray.append(el("button", { class: "tray-btn", title: "导入 / 导出", onClick: openDataModal }, icon("sync")));
  bar.append(el("div", { class: "sidebar-foot" }, tray));
}

function isCollapsed(key: string, def: boolean): boolean {
  try { const v = localStorage.getItem("locado.collapse." + key); return v == null ? def : v === "1"; } catch { return def; }
}
function setCollapsed(key: string, v: boolean): void {
  try { localStorage.setItem("locado.collapse." + key, v ? "1" : "0"); } catch { /* ignore */ }
}
function groupHeader(key: string, text: string, collapsed: boolean, onAdd?: () => void): HTMLElement {
  const h = el("div", { class: "nav-group-label collapsible" });
  const toggle = el("button", {
    class: "group-toggle",
    type: "button",
    "aria-expanded": String(!collapsed),
    "aria-label": `${collapsed ? "展开" : "折叠"}${text}分组`,
    onClick: () => { setCollapsed(key, !collapsed); renderSidebar(); },
  }, el("span", { class: "gl-text" }, text), icon("chevron", "nav-chevron" + (collapsed ? " collapsed" : "")));
  h.append(toggle);
  if (onAdd) h.append(el("button", { class: "group-add", type: "button", title: `新建${text}`, onClick: onAdd }, "+"));
  return h;
}

function navItem(o: { id: string; ico?: string; dot?: string; label: string; count: number; onDel?: () => void; onEdit?: () => void }): HTMLElement {
  const kids: (Node | string)[] = [];
  if (o.ico) kids.push(icon(o.ico, "ico"));
  if (o.dot) kids.push(el("span", { class: "dot", style: `background:${o.dot}` }));
  kids.push(el("span", { class: "label" }, o.label));
  if (o.count > 0) kids.push(el("span", { class: "count" }, String(o.count)));
  const wrap = el("div", { class: "nav-item" + (view === o.id ? " active" : "") });
  wrap.append(el("button", {
    class: "nav-select",
    type: "button",
    "aria-current": view === o.id ? "page" : null,
    onClick: () => { view = o.id; render(); },
  }, ...kids));
  if (o.onEdit) wrap.append(el("button", { class: "del", type: "button", title: `编辑${o.label}`, onClick: o.onEdit }, "✎"));
  if (o.onDel) wrap.append(el("button", { class: "del", type: "button", title: `删除${o.label}`, onClick: o.onDel }, "×"));
  return wrap;
}

/* ============ 主区 ============ */
function renderMain(): void {
  $("#view-title").textContent = viewName(view);
  const addRow = $("#add-row");
  const list = $("#list");
  list.innerHTML = "";

  if (view === "calendar") { addRow.style.display = "none"; $("#view-sub").textContent = ""; renderCalendar(list); return; }
  if (view === "matrix") { addRow.style.display = "none"; $("#view-sub").textContent = ""; renderMatrix(list); return; }
  if (view === "habits") { addRow.style.display = "none"; $("#view-sub").textContent = ""; renderHabits(list); return; }
  if (view === "focus") { addRow.style.display = "none"; $("#view-sub").textContent = ""; renderFocus(list); return; }

  addRow.style.display = view === "smart:completed" ? "none" : "";
  $("#view-sub").textContent = view === "smart:completed" ? "" : `${activeCount(view)} 个任务`;

  const inner = el("div", { class: "list-inner" });
  const items = snap.tasks.filter((t) => matchView(t, view));
  if (view === "smart:completed") items.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  else sortForView(view, items);

  if (!items.length) inner.append(el("div", { class: "empty" }, el("div", { class: "big" }, "🌿"), el("div", {}, "这里还没有任务")));
  else for (const t of items) inner.append(taskRow(t));

  // 拖拽排序(已完成视图不参与)
  if (view !== "smart:completed") enableDrag(inner);
  list.append(inner);
}

function taskRow(t: Task): HTMLElement {
  const check = el("button", { class: `check p${t.priority}` + (t.completed ? " done" : ""), title: "完成", onClick: (e: Event) => { e.stopPropagation(); toggleDone(t); } });
  const meta = el("div", { class: "task-meta" });
  if (t.dueDate != null) meta.append(el("span", { class: "chip due" + (!t.completed && isOverdue(t.dueDate) ? " overdue" : "") }, icon("calendar", "chip-icon"), dueLabel(t.dueDate) + (t.hasTime ? " " + fmtTime(t.dueDate) : "")));
  if (t.recurrence) meta.append(el("span", { class: "chip", title: recurrenceSummary(t.recurrence) }, icon("sync", "chip-icon"), recurrenceSummary(t.recurrence)));
  if (t.reminderMinutesBefore != null) meta.append(el("span", { class: "chip" }, icon("bell", "chip-icon"), remindLabel(t.reminderMinutesBefore)));
  const doneSubs = t.subtasks.filter((s) => s.completed).length;
  if (t.subtasks.length) meta.append(el("span", { class: "chip" }, icon("check-square", "chip-icon"), `${doneSubs}/${t.subtasks.length}`));
  for (const tagId of t.tags) {
    const tag = snap.tags.find((x) => x.id === tagId);
    if (tag) meta.append(el("span", { class: "chip tag", style: `color:${tag.color}` }, tag.name));
  }
  const body = el("div", { class: "task-body" }, el("div", { class: "task-title" }, t.title || "无标题"));
  if (meta.childElementCount) body.append(meta);
  const row = el("div", {
    class: "task" + (t.completed ? " done" : "") + (selectedId === t.id ? " selected" : ""),
    draggable: "true",
    role: "button",
    tabIndex: "0",
    "aria-label": `编辑任务 ${t.title || "无标题"}`,
    onClick: () => openDetail(t.id),
  }, check, body);
  row.dataset.id = t.id;
  keyboardActivate(row, () => openDetail(t.id));
  if (t.pinned) row.append(el("span", { class: "pin", title: "已置顶" }, icon("pin", "pin-icon")));
  return row;
}

/* ---- 拖拽排序 ---- */
function enableDrag(inner: HTMLElement): void {
  inner.addEventListener("dragstart", (e) => {
    const row = (e.target as HTMLElement).closest(".task") as HTMLElement | null;
    if (row) setTimeout(() => row.classList.add("dragging"), 0);
  });
  inner.addEventListener("dragend", (e) => {
    const row = (e.target as HTMLElement).closest(".task") as HTMLElement | null;
    if (row) { row.classList.remove("dragging"); commitOrder(inner); }
  });
  inner.addEventListener("dragover", (e) => {
    e.preventDefault();
    const dragging = inner.querySelector(".task.dragging") as HTMLElement | null;
    if (!dragging) return;
    const after = dragAfter(inner, (e as DragEvent).clientY);
    if (after == null) inner.appendChild(dragging);
    else inner.insertBefore(dragging, after);
  });
}

function dragAfter(container: HTMLElement, y: number): HTMLElement | null {
  const els = [...container.querySelectorAll<HTMLElement>(".task:not(.dragging)")];
  let closest: { offset: number; el: HTMLElement | null } = { offset: -Infinity, el: null };
  for (const e of els) {
    const box = e.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, el: e };
  }
  return closest.el;
}

function commitOrder(inner: HTMLElement): void {
  const ids = [...inner.querySelectorAll<HTMLElement>(".task")]
    .map((e) => e.dataset.id)
    .filter((id): id is string => !!id);
  orderMemo.set(view, ids);
  try { localStorage.setItem(ORDER_PREFIX + view, JSON.stringify(ids)); }
  catch { /* 排序保存失败不影响数据本身 */ }
}

/* ============ 日历月视图 ============ */
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

function renderCalendar(list: HTMLElement): void {
  const wrap = el("div", { class: "cal" });
  const head = el("div", { class: "cal-head" },
    el("button", { class: "icon-btn", title: "上个月", onClick: () => { calMonth = addMonths(calMonth, -1); renderMain(); } }, "‹"),
    el("div", { class: "cal-title" }, `${calMonth.getFullYear()} 年 ${calMonth.getMonth() + 1} 月`),
    el("button", { class: "icon-btn", title: "下个月", onClick: () => { calMonth = addMonths(calMonth, 1); renderMain(); } }, "›"),
    el("button", { class: "text-btn", onClick: () => { calMonth = firstOfMonth(new Date()); renderMain(); } }, "今天"),
  );
  const dow = el("div", { class: "cal-dow" });
  for (const d of ["一", "二", "三", "四", "五", "六", "日"]) dow.append(el("div", {}, d));

  const grid = el("div", { class: "cal-grid" });
  const first = firstOfMonth(calMonth);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(first.getDate() - offset);
  const todayKey = dayKey(new Date());

  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const inMonth = d.getMonth() === calMonth.getMonth();
    const cell = el("div", { class: "cal-cell" + (inMonth ? "" : " out") + (dayKey(d) === todayKey ? " today" : "") });
    const theDay = new Date(d);
    cell.append(el("button", {
      class: "cal-date",
      type: "button",
      title: `在 ${d.getMonth() + 1} 月 ${d.getDate()} 日新建任务`,
      onClick: (e: Event) => { e.stopPropagation(); void quickAddOn(theDay); },
    }, String(d.getDate())));
    const dayTasks = snap.tasks.filter((t) => !t.completed && t.dueDate != null && dayKey(new Date(t.dueDate)) === dayKey(d)).sort(sortTasks);
    for (const t of dayTasks.slice(0, 3)) {
      const event = el("div", {
        class: "cal-ev",
        role: "button",
        tabIndex: "0",
        title: t.title || "无标题",
        onClick: (e: Event) => { e.stopPropagation(); openDetail(t.id); },
      }, el("span", { class: `evdot p${t.priority}` }), el("span", { class: "evtitle" }, t.title || "无标题"));
      keyboardActivate(event, () => openDetail(t.id));
      cell.append(event);
    }
    if (dayTasks.length > 3) {
      cell.append(el("button", {
        class: "cal-more",
        type: "button",
        title: `查看当天全部 ${dayTasks.length} 个任务`,
        onClick: (e: Event) => { e.stopPropagation(); openDayTasks(theDay, dayTasks); },
      }, `+${dayTasks.length - 3}`));
    }
    cell.addEventListener("click", () => quickAddOn(theDay));
    grid.append(cell);
  }
  wrap.append(head, dow, grid);
  list.append(wrap);
}

function openDayTasks(d: Date, tasks: Task[]): void {
  const body = el("div", { class: "day-task-list" });
  const m = modal(`${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${tasks.length} 个任务`, body, []);
  for (const t of tasks) {
    body.append(el("button", {
      class: "day-task",
      type: "button",
      onClick: () => { m.close(); openDetail(t.id); },
    }, el("span", { class: `evdot p${t.priority}` }), el("span", { class: "day-task-title" }, t.title || "无标题"), t.hasTime && t.dueDate != null ? el("span", { class: "chip" }, fmtTime(t.dueDate)) : el("span")));
  }
}

async function quickAddOn(d: Date): Promise<void> {
  const title = await promptModal(`在 ${d.getMonth() + 1} 月 ${d.getDate()} 日新建任务`, "任务标题");
  if (!title || !title.trim()) return;
  const due = new Date(d); due.setHours(9, 0, 0, 0);
  const t: Task = { id: uid(), projectId: INBOX_ID, title: title.trim(), note: "", priority: 0, completed: false, completedAt: null, dueDate: due.getTime(), pinned: false, tags: [], subtasks: [], createdAt: Date.now(), updatedAt: Date.now() };
  snap.tasks.push(t);
  if (!(await persist(() => db.saveTask(t)))) return;
  render();
}

/* ============ 四象限(艾森豪威尔矩阵) ============ */
function renderMatrix(list: HTMLElement): void {
  const wrap = el("div", { class: "matrix" });
  for (const q of QUADRANTS) {
    const cell = el("div", { class: "mx-cell" });
    cell.style.setProperty("--qc", q.color);
    cell.append(el("div", { class: "mx-head" }, el("span", { class: "mx-dot" }), el("span", { class: "mx-title" }, q.title), el("span", { class: "mx-sub" }, q.sub)));
    const body = el("div", { class: "mx-body" });
    const tasks = snap.tasks.filter((t) => !t.completed && isImportant(t) === q.important && isUrgent(t) === q.urgent).sort(sortTasks);
    if (!tasks.length) body.append(el("div", { class: "mx-empty" }, "拖任务到这里"));
    for (const t of tasks) {
      const chk = el("button", { class: "mx-check", type: "button", title: "完成任务", onClick: (e: Event) => { e.stopPropagation(); toggleDone(t); } });
      const card = el("div", {
        class: "mx-task",
        draggable: "true",
        role: "button",
        tabIndex: "0",
        "aria-label": `编辑任务 ${t.title || "无标题"}`,
        onClick: () => openDetail(t.id),
      }, chk, el("span", { class: "mx-tt" }, t.title || "无标题"));
      card.dataset.id = t.id;
      keyboardActivate(card, () => openDetail(t.id));
      card.addEventListener("dragstart", () => { dragTaskId = t.id; setTimeout(() => card.classList.add("dragging"), 0); });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      body.append(card);
    }
    cell.addEventListener("dragover", (e) => { e.preventDefault(); cell.classList.add("over"); });
    cell.addEventListener("dragleave", () => cell.classList.remove("over"));
    cell.addEventListener("drop", async (e) => {
      e.preventDefault(); cell.classList.remove("over");
      if (!dragTaskId) return;
      const t = snap.tasks.find((x) => x.id === dragTaskId); dragTaskId = null;
      if (t && (isImportant(t) !== q.important || isUrgent(t) !== q.urgent)) {
        t.important = q.important;
        t.urgent = q.urgent;
        t.updatedAt = Date.now();
        if (!(await persist(() => db.updateTask(t)))) return;
      }
      render();
    });
    cell.append(body);
    wrap.append(cell);
  }
  list.append(wrap);
}

/* ============ 习惯打卡 ============ */
function habitStreak(h: Habit): number {
  const set = new Set(h.checkins);
  const d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderHabits(list: HTMLElement): void {
  const inner = el("div", { class: "list-inner" });
  inner.append(el("div", { class: "section-head between" }, el("span", {}, "每日习惯"), el("button", { class: "text-btn", onClick: addHabit }, "＋ 新建习惯")));
  if (!snap.habits.length) inner.append(el("div", { class: "empty" }, el("div", { class: "big" }, "🔥"), el("div", {}, "还没有习惯,新建一个开始坚持吧")));
  for (const h of [...snap.habits].sort((a, b) => a.sortOrder - b.sortOrder)) inner.append(habitCard(h));
  list.append(inner);
}

function habitCard(h: Habit): HTMLElement {
  const todayKey = dayKey(new Date());
  const checked = h.checkins.includes(todayKey);
  const strip = el("div", { class: "hb-strip" });
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const on = h.checkins.includes(key);
    const cell = el("button", { class: "hb-day" + (on ? " on" : "") + (i === 0 ? " today" : ""), type: "button", "aria-pressed": String(on), title: `${d.getMonth() + 1}/${d.getDate()} · ${on ? "已打卡,点击取消" : "点击打卡"}`, style: on ? `background:${h.color};border-color:${h.color};color:#fff` : "" }, String(d.getDate()));
    cell.addEventListener("click", () => toggleCheckin(h, key));
    strip.append(cell);
  }
  const btn = el("button", { class: "hb-check" + (checked ? " done" : ""), style: checked ? `background:${h.color};border-color:${h.color};color:#fff` : `border-color:${h.color};color:${h.color}`, onClick: () => toggleCheckin(h) }, checked ? "今日已打卡 ✓" : "打卡");
  const del = el("button", { class: "hb-del", title: "删除", onClick: () => removeHabit(h) }, "×");
  return el("div", { class: "hb-card" },
    el("div", { class: "hb-top" }, el("span", { class: "hb-icon", style: `background:${h.color}22;color:${h.color}` }, h.icon), el("div", { class: "hb-name" }, h.name), el("span", { class: "hb-streak" }, icon("flame", "streak-icon"), String(habitStreak(h))), del),
    strip, btn);
}

async function toggleCheckin(h: Habit, key: string = dayKey(new Date())): Promise<void> {
  h.checkins = h.checkins.includes(key) ? h.checkins.filter((x) => x !== key) : [...h.checkins, key];
  if (!(await persist(() => db.saveHabit(h)))) return;
  render();
}
async function addHabit(): Promise<void> {
  const name = await promptModal("新建习惯", "习惯名称");
  if (!name || !name.trim()) return;
  const h: Habit = { id: uid(), name: name.trim(), icon: HABIT_ICONS[snap.habits.length % HABIT_ICONS.length], color: PROJECT_COLORS[snap.habits.length % PROJECT_COLORS.length], checkins: [], sortOrder: snap.habits.length, createdAt: Date.now() };
  snap.habits.push(h);
  if (!(await persist(() => db.saveHabit(h)))) return;
  render();
}
async function removeHabit(h: Habit): Promise<void> {
  if (!(await confirmModal(`删除习惯「${h.name}」?`))) return;
  snap.habits = snap.habits.filter((x) => x.id !== h.id);
  if (!(await persist(() => db.deleteHabit(h.id)))) return;
  render();
}

/* ============ 番茄钟专注 ============ */
function minPref(key: string, def: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 ? v : def;
  } catch { return def; }
}
function workMin(): number { return minPref("locado.work", 25); }
function breakMin(): number { return minPref("locado.break", 5); }

function loadFocus(): FocusState {
  try { return parseFocusState(localStorage.getItem(FOCUS_STORAGE_KEY), Date.now(), workMin() * 60, breakMin() * 60); }
  catch { return idleFocus(workMin() * 60); }
}
let focusStorageWarningShown = false;
function persistFocus(): void {
  try {
    localStorage.setItem(FOCUS_STORAGE_KEY, serializeFocusState(focus));
    focusStorageWarningShown = false;
  } catch {
    if (focusStorageWarningShown) return;
    focusStorageWarningShown = true;
    toast("番茄钟状态无法保存，刷新后可能丢失。请检查浏览器存储空间。", { ms: 10000 });
  }
}
const focus: FocusState = loadFocus();
function fmt(sec: number): string { const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; }

let tickDay = dayKey(new Date());
function tick(): void {
  checkReminders();
  const currentDay = dayKey(new Date());
  if (currentDay !== tickDay) { tickDay = currentDay; render(); }
  if (!focus.running) return;
  const rem = Math.max(0, Math.round((focus.endsAt - Date.now()) / 1000));
  focus.remaining = rem;
  if (rem <= 0) { focusComplete(); return; }
  if (view === "focus") updateFocusTime();
}

/* ============ 提醒投递 ============ */
function applyTime(t: Task, val: string): void {
  if (!val) {
    t.hasTime = false;
    if (t.dueDate != null) { const date = new Date(t.dueDate); date.setHours(9, 0, 0, 0); t.dueDate = date.getTime(); }
    return;
  }
  const [h, mi] = val.split(":").map(Number);
  const base = t.dueDate != null ? new Date(t.dueDate) : new Date();
  base.setHours(h, mi, 0, 0);
  t.dueDate = base.getTime(); t.hasTime = true;
}
let notificationWarningShown = false;
function warnNotification(message = "系统通知权限未开启，将仅显示应用内提醒。"): void {
  if (notificationWarningShown) return;
  notificationWarningShown = true;
  toast(message, { ms: 10000 });
}
async function ensureNotifyPermission(): Promise<void> {
  try {
    let granted: boolean;
    if (isTauri()) {
      granted = await hasNativeNotificationPermission();
      if (!granted) {
        await requestNativeNotificationPermission();
        granted = await hasNativeNotificationPermission();
      }
    } else {
      if (!("Notification" in window)) { warnNotification("当前环境不支持系统通知，将仅显示应用内提醒。"); return; }
      let permission = Notification.permission;
      if (permission === "default") permission = await Notification.requestPermission();
      granted = permission === "granted";
    }
    if (granted) notificationWarningShown = false;
    else warnNotification();
  } catch {
    warnNotification("无法获取系统通知权限，将仅显示应用内提醒。");
  }
}
function fireReminder(t: Task): void {
  const body = t.title + (t.dueDate != null ? `  ·  ${dueLabel(t.dueDate)}${t.hasTime ? " " + fmtTime(t.dueDate) : ""}` : "");
  if (isTauri()) {
    void (async () => {
      if (await hasNativeNotificationPermission()) sendNotification({ title: "⏰ Locado 提醒", body });
      else warnNotification();
    })().catch(() => warnNotification("系统通知发送失败，已保留应用内提醒。"));
  } else {
    try {
      if (!("Notification" in window) || Notification.permission !== "granted") warnNotification();
      else new Notification("⏰ Locado 提醒", { body });
    } catch { warnNotification("系统通知发送失败，已保留应用内提醒。"); }
  }
  toast("⏰ " + body);
}
const reminderClaims = new Set<string>();
const missedReminders = new Map<string, Task>();
let missedReminderTimer: number | null = null;
function queueMissedReminder(task: Task): void {
  missedReminders.set(task.id, task);
  if (missedReminderTimer != null) return;
  missedReminderTimer = window.setTimeout(() => {
    missedReminderTimer = null;
    const tasks = [...missedReminders.values()];
    missedReminders.clear();
    const titles = tasks.slice(0, 3).map((item) => `「${item.title || "无标题"}」`).join("、");
    const more = tasks.length > 3 ? " 等" : "";
    toast(`已补记 ${tasks.length} 条较早的遗漏提醒：${titles}${more}。未发送过期系统通知。`, { ms: 12000 });
  }, 300);
}
function checkReminders(): void {
  const now = Date.now();
  for (const t of snap.tasks) {
    if (reminderClaims.has(t.id) || t.completed || t.reminded || t.dueDate == null || t.reminderMinutesBefore == null) continue;
    const at = t.dueDate - t.reminderMinutesBefore * 60000;
    if (now < at) continue;
    reminderClaims.add(t.id);
    void (async () => {
      try {
        const claim = await db.claimReminder(t.id, at, now);
        if (!claim) return;
        const current = snap.tasks.find((task) => task.id === claim.task.id);
        if (current) Object.assign(current, claim.task);
        if (claim.notify) fireReminder(claim.task);
        else queueMissedReminder(claim.task);
      } catch {
        await recoverPersistence();
      } finally {
        reminderClaims.delete(t.id);
      }
    })();
  }
}
// 统一提示:嵌入式 WebView 不支持 alert,所有反馈都走这里。
function toast(msg: string, opts: { ms?: number; action?: { label: string; run: () => void } } = {}): void {
  let box = document.querySelector(".toast-box") as HTMLElement | null;
  if (!box) { box = el("div", { class: "toast-box" }); document.body.append(box); }
  const node = el("div", { class: "toast" }, el("span", { class: "toast-msg" }, msg));
  if (opts.action) {
    const act = opts.action;
    node.append(el("button", { class: "toast-act", onClick: () => { act.run(); node.remove(); } }, act.label));
  }
  box.append(node);
  setTimeout(() => { node.classList.add("hide"); setTimeout(() => node.remove(), 300); }, opts.ms ?? 4500);
}
function focusStart(): void {
  if (focus.mode === "idle") {
    focus.mode = "work";
    focus.total = workMin() * 60;
    focus.remaining = focus.total;
    focus.startedAt = Date.now();
    focus.sessionId = uid();
  } else if (!focus.startedAt) focus.startedAt = Date.now() - (focus.total - focus.remaining) * 1000;
  focus.endsAt = Date.now() + focus.remaining * 1000;
  focus.running = true;
  persistFocus();
  if (view === "focus") renderMain();
}
function focusPause(): void {
  focus.remaining = Math.max(0, Math.round((focus.endsAt - Date.now()) / 1000));
  focus.running = false;
  focus.endsAt = 0;
  persistFocus();
  if (view === "focus") renderMain();
}
function focusReset(): void {
  focus.running = false;
  focus.mode = "idle";
  focus.total = workMin() * 60;
  focus.remaining = focus.total;
  focus.endsAt = 0;
  focus.startedAt = 0;
  focus.sessionId = "";
  persistFocus();
  if (view === "focus") renderMain();
}
async function focusComplete(): Promise<void> {
  focus.running = false;
  focus.remaining = 0;
  focus.endsAt = 0;
  if (focus.mode === "work") {
    const rec: FocusRecord = {
      id: focusRecordId(focus) ?? uid(),
      startedAt: focus.startedAt || Date.now() - focus.total * 1000,
      minutes: Math.round(focus.total / 60),
      taskId: focus.taskId,
    };
    const existing = snap.focusRecords.findIndex((record) => record.id === rec.id);
    if (existing >= 0) snap.focusRecords[existing] = rec; else snap.focusRecords.push(rec);
    if (!(await persist(() => db.saveFocusRecord(rec)))) return;
    focus.mode = "break";
    focus.total = breakMin() * 60;
    focus.remaining = focus.total;
    focus.startedAt = 0;
    focus.sessionId = "";
  } else {
    focus.mode = "idle";
    focus.total = workMin() * 60;
    focus.remaining = focus.total;
    focus.startedAt = 0;
    focus.sessionId = "";
  }
  persistFocus();
  if (view === "focus") renderMain();
}

function updateFocusTime(): void {
  const te = document.querySelector("#focus-time"); if (te) te.textContent = fmt(focus.remaining);
  const ring = document.querySelector("#focus-ring") as HTMLElement | null;
  if (ring) {
    const done = focus.mode === "idle" ? 0 : (1 - focus.remaining / focus.total);
    ring.style.background = `conic-gradient(var(--accent) ${done * 360}deg, var(--bg-hover) 0)`;
  }
}

function renderFocus(list: HTMLElement): void {
  const inner = el("div", { class: "list-inner focus-wrap" });
  const modeLabel = focus.mode === "break" ? "休息" : focus.mode === "work" ? "专注中" : "准备开始";
  const done = focus.mode === "idle" ? 0 : (1 - focus.remaining / focus.total);

  const ring = el("div", { class: "focus-ring", id: "focus-ring", style: `background:conic-gradient(var(--accent) ${done * 360}deg, var(--bg-hover) 0)` },
    el("div", { class: "focus-inner" }, el("div", { class: "focus-time", id: "focus-time" }, fmt(focus.remaining)), el("div", { class: "focus-mode" }, modeLabel)));

  const startBtn = el("button", { class: "btn-primary big", onClick: () => (focus.running ? focusPause() : focusStart()) }, focus.running ? "暂停" : focus.mode === "idle" ? "开始专注" : "继续");
  const resetBtn = el("button", { class: "btn-ghost big", onClick: focusReset }, "重置");

  // 时长预设
  const durRow = el("div", { class: "chk-row center" });
  for (const m of [15, 25, 45]) {
    const locked = focus.mode !== "idle";
    durRow.append(el("button", {
      class: "chk" + (workMin() === m ? " on" : ""),
      type: "button",
      disabled: locked,
      title: locked ? "本次计时结束后可修改时长" : `设为 ${m} 分钟`,
      onClick: () => {
        if (focus.mode !== "idle") return;
        try { localStorage.setItem("locado.work", String(m)); } catch { /* ignore */ }
        focus.total = m * 60;
        focus.remaining = focus.total;
        persistFocus();
        renderMain();
      },
    }, `${m} 分`));
  }

  // 关联任务
  const sel = selectControl(
    [{ value: "", label: "不关联任务" }, ...snap.tasks.filter((x) => !x.completed).map((t) => ({ value: t.id, label: t.title || "无标题" }))],
    focus.taskId ?? "",
    (v) => { focus.taskId = v || null; persistFocus(); },
  );

  // 今日统计
  const tk = dayKey(new Date());
  const today = snap.focusRecords.filter((r) => dayKey(new Date(r.startedAt)) === tk);
  const mins = today.reduce((a, r) => a + r.minutes, 0);
  const stats = el("div", { class: "focus-stats" },
    el("div", { class: "fs-item" }, el("div", { class: "fs-num" }, String(today.length)), el("div", { class: "fs-label" }, "今日番茄")),
    el("div", { class: "fs-item" }, el("div", { class: "fs-num" }, `${mins}`), el("div", { class: "fs-label" }, "专注分钟")),
  );

  inner.append(ring, el("div", { class: "focus-ctrl" }, startBtn, resetBtn), durRow, el("div", { class: "focus-task" }, sel.el), stats);
  list.append(inner);
}

/* ============ 详情抽屉 ============ */
let detailState: { id: string; bodyEl: HTMLElement; close: () => void } | null = null;

function defaultRecurrence(kind: RecurrenceRule["kind"], dueDate: number | null): RecurrenceRule {
  const date = new Date(dueDate ?? Date.now());
  if (kind === "daily") return { kind: "daily" };
  if (kind === "weekly") return { kind: "weekly", weekdays: [date.getDay()] };
  if (kind === "monthly") return { kind: "monthly", day: date.getDate() };
  if (kind === "yearly") return { kind: "yearly", month: date.getMonth() + 1, day: date.getDate() };
  return { kind: "afterCompletion", days: 3 };
}

async function updateRecurrence(t: Task, candidate: RecurrenceRule | null, id: string): Promise<void> {
  const rule = candidate ? normalizeRecurrence(candidate) : null;
  if (candidate && !rule) { toast("请输入有效的重复规则"); openDetail(id); return; }
  if (rule && t.dueDate == null) { toast("请先设置日期"); openDetail(id); return; }

  const now = Date.now();
  const upserts: Task[] = [t];
  t.recurrence = rule ?? undefined;
  t.updatedAt = now;
  if (t.recurrenceNextId) {
    const next = snap.tasks.find((item) => item.id === t.recurrenceNextId && item.recurrenceSourceId === t.id);
    t.recurrenceNextId = undefined;
    if (next) {
      next.recurrence = undefined;
      next.recurrenceSourceId = undefined;
      next.recurrenceNextId = undefined;
      next.updatedAt = now;
      upserts.push(next);
    }
  }
  if (!(await persist(async () => {
    for (const task of upserts) await db.updateTask(task);
  }))) return;
  openDetail(id);
}

function recurrenceEditor(t: Task, id: string): HTMLElement {
  if (t.completed) return el("div", { class: "recurrence-preview" }, t.recurrence ? recurrenceSummary(t.recurrence) : "不重复");

  const wrap = el("div", { class: "recurrence-editor" });
  const kind = t.recurrence?.kind ?? "";
  const type = selectControl([
    { value: "", label: "不重复" },
    { value: "daily", label: "每天" },
    { value: "weekly", label: "每周" },
    { value: "monthly", label: "每月" },
    { value: "yearly", label: "每年" },
    { value: "afterCompletion", label: "完成后 N 天" },
  ], kind, (value) => {
    void updateRecurrence(t, value ? defaultRecurrence(value as RecurrenceRule["kind"], t.dueDate) : null, id);
  });
  wrap.append(type.el);

  const rule = t.recurrence;
  if (rule?.kind === "weekly") {
    const row = el("div", { class: "chk-row" });
    ["日", "一", "二", "三", "四", "五", "六"].forEach((label, day) => {
      row.append(toggleChip(label, rule.weekdays.includes(day), (on) => {
        const weekdays = new Set(rule.weekdays);
        if (on) weekdays.add(day); else weekdays.delete(day);
        if (!weekdays.size) { toast("每周至少选择一天"); openDetail(id); return; }
        void updateRecurrence(t, { kind: "weekly", weekdays: [...weekdays] }, id);
      }));
    });
    wrap.append(row);
  } else if (rule?.kind === "monthly") {
    const options = [{ value: "last", label: "最后一天" }, ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 日` }))];
    wrap.append(selectControl(options, String(rule.day), (value) => {
      void updateRecurrence(t, { kind: "monthly", day: value === "last" ? "last" : Number(value) }, id);
    }).el);
  } else if (rule?.kind === "yearly") {
    const month = el("input", { class: "date-input", type: "number", min: "1", max: "12", value: String(rule.month), "aria-label": "月份" }) as HTMLInputElement;
    const day = el("input", { class: "date-input", type: "number", min: "1", max: "31", value: String(rule.day), "aria-label": "日期" }) as HTMLInputElement;
    const commit = () => { void updateRecurrence(t, { kind: "yearly", month: Number(month.value), day: Number(day.value) }, id); };
    month.addEventListener("change", commit); day.addEventListener("change", commit);
    wrap.append(el("div", { class: "dt-row" }, month, day));
  } else if (rule?.kind === "afterCompletion") {
    const days = el("input", { class: "date-input", type: "number", min: "1", step: "1", value: String(rule.days), "aria-label": "完成后的天数" }) as HTMLInputElement;
    days.addEventListener("change", () => { void updateRecurrence(t, { kind: "afterCompletion", days: Number(days.value) }, id); });
    wrap.append(days);
  }

  if (rule) {
    const linked = t.recurrenceNextId ? snap.tasks.find((item) => item.id === t.recurrenceNextId) : undefined;
    const nextDue = linked?.dueDate ?? (t.dueDate != null ? nextRecurringDue(rule, t.dueDate, Date.now()) : null);
    const text = t.dueDate == null ? "请先设置日期" : nextDue != null ? `若现在完成，下一次：${dueLabel(nextDue)}${rule && t.hasTime ? " " + fmtTime(nextDue) : ""}` : "暂无下一次日期";
    wrap.append(el("div", { class: "recurrence-preview" }, text));
  }
  return wrap;
}

function detailContent(t: Task, id: string): HTMLElement {
  const wrap = el("div", {});

  const title = el("textarea", { class: "d-title", rows: "1", placeholder: "任务标题" }) as HTMLTextAreaElement;
  title.value = t.title;
  const autosize = () => { title.style.height = "auto"; title.style.height = title.scrollHeight + "px"; };
  title.addEventListener("input", () => { t.title = title.value; t.updatedAt = Date.now(); queueSave(t); });
  title.addEventListener("blur", flushSaves);
  setTimeout(autosize, 0);

  const note = el("textarea", { class: "d-note", placeholder: "备注…" }) as HTMLTextAreaElement;
  note.value = t.note;
  note.addEventListener("input", () => { t.note = note.value; t.updatedAt = Date.now(); queueSave(t); });
  note.addEventListener("blur", flushSaves);

  const prioSeg = el("div", { class: "seg" });
  ([[5, "高"], [3, "中"], [1, "低"], [0, "无"]] as [Priority, string][]).forEach(([p, lbl]) => {
    prioSeg.append(el("button", { class: `p${p}` + (t.priority === p ? ` on p${p}` : ""), onClick: () => { t.priority = p; t.updatedAt = Date.now(); save(t); openDetail(id); } }, lbl));
  });
  const quadRow = el("div", { class: "chk-row" });
  quadRow.append(
    toggleChip("重要", isImportant(t), (v) => { t.important = v; t.updatedAt = Date.now(); save(t); }),
    toggleChip("紧急", isUrgent(t), (v) => { t.urgent = v; t.updatedAt = Date.now(); save(t); }),
  );

  const date = el("input", { class: "date-input", type: "date", value: toDateInput(t.dueDate) }) as HTMLInputElement;
  const time = el("input", { class: "date-input", type: "time", value: t.hasTime && t.dueDate != null ? fmtTime(t.dueDate) : "" }) as HTMLInputElement;
  date.addEventListener("change", () => {
    const base = fromDateInput(date.value);
    if (base != null && t.hasTime && t.dueDate != null) { const d = new Date(t.dueDate); const nd = new Date(base); nd.setHours(d.getHours(), d.getMinutes(), 0, 0); t.dueDate = nd.getTime(); }
    else t.dueDate = base;
    t.reminded = false; t.updatedAt = Date.now(); save(t);
  });
  time.addEventListener("change", () => { applyTime(t, time.value); t.reminded = false; t.updatedAt = Date.now(); save(t); openDetail(id); });
  const remindSel = selectControl(
    [["", "无提醒"], ["0", "准时"], ["5", "提前 5 分钟"], ["15", "提前 15 分钟"], ["30", "提前 30 分钟"], ["60", "提前 1 小时"], ["1440", "提前 1 天"]].map(([v, l]) => ({ value: v, label: l })),
    String(t.reminderMinutesBefore ?? ""),
    (v) => { t.reminderMinutesBefore = v === "" ? null : Number(v); t.reminded = false; t.updatedAt = Date.now(); if (t.reminderMinutesBefore != null) ensureNotifyPermission(); save(t); },
  );

  const sel = selectControl(
    snap.projects.map((p) => ({ value: p.id, label: p.name })),
    t.projectId,
    (v) => { t.projectId = v; t.updatedAt = Date.now(); save(t); },
  );

  const tagWrap = el("div", { class: "tag-pick" });
  for (const tag of snap.tags) {
    const on = t.tags.includes(tag.id);
    tagWrap.append(el("button", { class: on ? "on" : "", style: on ? `background:${tag.color}` : "", onClick: () => { t.tags = on ? t.tags.filter((x) => x !== tag.id) : [...t.tags, tag.id]; t.updatedAt = Date.now(); save(t); openDetail(id); } }, tag.name));
  }

  const subWrap = el("div", {});
  t.subtasks.forEach((s) => {
    const mini = el("button", { class: "mini" + (s.completed ? " done" : ""), type: "button", title: s.completed ? "标记子任务为未完成" : "完成子任务", "aria-pressed": String(s.completed) });
    mini.addEventListener("click", () => { s.completed = !s.completed; save(t); openDetail(id); });
    const inp = el("input", { value: s.title, placeholder: "子任务" }) as HTMLInputElement;
    inp.addEventListener("input", () => { s.title = inp.value; queueSave(t); });
    inp.addEventListener("blur", flushSaves);
    const x = el("button", { class: "x", onClick: () => { t.subtasks = t.subtasks.filter((q) => q.id !== s.id); save(t); openDetail(id); } }, "×");
    subWrap.append(el("div", { class: "sub" + (s.completed ? " done" : "") }, mini, inp, x));
  });
  const addSub = el("button", { class: "sub-add", onClick: () => { t.subtasks.push({ id: uid(), title: "", completed: false }); save(t); openDetail(id); } }, el("span", {}, "＋"), el("span", {}, "添加子任务"));

  const pinBtn = el("button", { class: "text-btn", onClick: () => { t.pinned = !t.pinned; t.updatedAt = Date.now(); save(t); openDetail(id); } }, t.pinned ? "已置顶" : "置顶");
  const delBtn = el("button", { class: "text-btn danger", onClick: () => removeTask(t.id) }, "删除任务");

  wrap.append(
    title,
    field("优先级", prioSeg),
    field("四象限", quadRow),
    field("日期与时间", el("div", { class: "dt-row" }, date, time)),
    field("重复", recurrenceEditor(t, id)),
    field("提醒", remindSel.el),
    field("清单", sel.el),
    snap.tags.length ? field("标签", tagWrap) : el("div"),
    field("子任务", el("div", {}, subWrap, addSub)),
    field("备注", note),
    el("div", { class: "detail-actions" }, pinBtn, delBtn),
  );
  return wrap;
}

function openDetail(id: string): void {
  selectedId = id;
  const t = snap.tasks.find((x) => x.id === id);
  if (!t) { closeDetail(); return; }
  if (detailState && detailState.id === id && document.body.contains(detailState.bodyEl)) {
    detailState.bodyEl.replaceChildren(detailContent(t, id));
  } else {
    if (detailState) { const c = detailState.close; detailState = null; c(); }
    const bodyEl = el("div", { class: "form" }, detailContent(t, id));
    const m = modal("任务详情", bodyEl, [], () => { detailState = null; selectedId = null; renderMain(); });
    detailState = { id, bodyEl, close: m.close };
  }
  renderMain();
}

function field(label: string, control: Node): HTMLElement {
  return labelControl(label, control);
}

function closeDetail(rerender = true): void {
  if (detailState) { const c = detailState.close; detailState = null; c(); }
  selectedId = null;
  if (rerender) renderMain();
}

/* ============ 数据操作 ============ */
// 连续输入时不必每个字符都落盘:停顿 300ms 或失焦再写一次。
const pendingSaves = new Map<string, Task>();
let saveTimer: number | null = null;

async function recoverPersistence(): Promise<void> {
  pendingSaves.clear();
  if (saveTimer != null) { clearTimeout(saveTimer); saveTimer = null; }
  try { snap = await db.reload(); }
  catch { toast("无法重新读取本地数据，请刷新页面后再试。", { ms: 12000 }); }
  closeDetail(false);
  render();
}

async function persist(operation: () => Promise<unknown>): Promise<boolean> {
  try { await operation(); return true; }
  catch {
    await recoverPersistence();
    return false;
  }
}

async function flushSaves(): Promise<boolean> {
  if (saveTimer != null) { clearTimeout(saveTimer); saveTimer = null; }
  if (!pendingSaves.size) return true;
  const edits = [...pendingSaves.values()].map((task) => structuredClone(task));
  pendingSaves.clear();
  return persist(async () => {
    for (const task of edits) await db.updateTask(task);
  });
}

function queueSave(t: Task): void {
  t.updatedAt = Date.now();
  pendingSaves.set(t.id, t);
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void flushSaves(); }, 300);
}

async function save(t: Task, rerender = true): Promise<void> {
  t.updatedAt = Date.now();
  pendingSaves.delete(t.id);
  if (!(await persist(() => db.updateTask(t)))) return;
  if (rerender) render(); else renderSidebar();
}
const togglingTasks = new Set<string>();
async function toggleDone(t: Task): Promise<void> {
  if (togglingTasks.has(t.id)) return;
  togglingTasks.add(t.id);
  pendingSaves.delete(t.id);
  try {
    const plan = planRecurringToggle(snap.tasks, t.id, Date.now(), uid);
    if (!(await persist(() => db.saveTasks(plan.upserts, plan.deleteIds)))) return;
    if (plan.deleteIds.length) snap.tasks = snap.tasks.filter((task) => !plan.deleteIds.includes(task.id));
    for (const task of plan.upserts) {
      const i = snap.tasks.findIndex((item) => item.id === task.id);
      if (i >= 0) snap.tasks[i] = task; else snap.tasks.push(task);
    }
    if (plan.nextPreserved) toast("下一次任务已保留，原任务已转为普通任务");
    const current = snap.tasks.find((task) => task.id === t.id);
    if (selectedId === t.id && current?.completed) closeDetail(); else render();
  } finally {
    togglingTasks.delete(t.id);
  }
}
async function addTask(title: string, corrected?: ParsedTask, skipDateDefault = false): Promise<void> {
  const raw = title.trim(); if (!raw) return;
  const parsed = corrected ?? parseTask(raw);
  const metadata = resolveQuickAddMetadata(parsed.projectName, parsed.tagNames, snap.projects, snap.tags);
  const filter = view.startsWith("filter:") ? snap.filters.find((f) => f.id === view.slice(7)) : undefined;
  const rule = filter?.rule;
  const inheritedProjectId = view.startsWith("project:") ? view.slice(8) : rule?.projectIds.length === 1 ? rule.projectIds[0] : INBOX_ID;
  const projectId = parsed.projectName ? metadata.projectId ?? INBOX_ID : inheritedProjectId;
  let dueDate = parsed.dueDate;
  if (!skipDateDefault) {
    if (dueDate == null && (view === "smart:today" || view === "smart:next7" || rule?.due === "today" || rule?.due === "next7")) dueDate = fromDateInput(toDateInput(Date.now()));
    if (dueDate == null && rule?.due === "overdue") dueDate = fromDateInput(toDateInput(Date.now() - DAY));
  }
  const inheritedTags = view.startsWith("tag:") ? [view.slice(4)] : rule?.tagIds.length ? [...rule.tagIds] : [];
  const tags = parsed.tagNames.length ? metadata.tagIds : inheritedTags;
  const inheritedPriority = rule?.priorities.length === 1 ? rule.priorities[0] : 0;
  const priority = parsed.prioritySpecified ? parsed.priority : inheritedPriority;
  const t: Task = { id: uid(), projectId, title: parsed.title, note: "", priority, completed: false, completedAt: null, dueDate, hasTime: parsed.hasTime, reminderMinutesBefore: parsed.reminderMinutesBefore, reminded: false, pinned: false, tags, subtasks: [], createdAt: Date.now(), updatedAt: Date.now(), recurrence: parsed.recurrence ?? undefined };
  const visibleInCurrentView = matchView(t, view);
  snap.tasks.push(t);
  if (!(await persist(() => db.saveTask(t)))) return;
  if (t.reminderMinutesBefore != null) ensureNotifyPermission();
  render();
  const notices: string[] = [];
  if (metadata.missingProject) notices.push(`未找到清单「${metadata.missingProject}」，已放入收集箱`);
  if (metadata.missingTags.length) notices.push(`未找到标签：${metadata.missingTags.join("、")}`);
  if (!visibleInCurrentView) notices.push(`已创建「${t.title || "无标题"}」，但它不符合当前筛选条件`);
  if (notices.length) toast(notices.join("；"), { ms: 8000 });
}
async function removeTask(id: string): Promise<void> {
  const t = snap.tasks.find((x) => x.id === id);
  pendingSaves.delete(id);
  snap.tasks = snap.tasks.filter((x) => x.id !== id);
  if (!(await persist(() => db.deleteTask(id)))) return;
  closeDetail(); render();
  if (t) {
    const backup: Task = JSON.parse(JSON.stringify(t)) as Task;
    toast(`已删除「${backup.title || "无标题"}」`, {
      ms: 12000,
      action: {
        label: "撤销",
        run: () => {
          snap.tasks.push(backup);
          void persist(() => db.saveTask(backup)).then((ok) => { if (ok) render(); });
        },
      },
    });
  }
}
async function addProject(): Promise<void> {
  const name = await promptModal("新建清单", "清单名称"); if (!name || !name.trim()) return;
  const color = PROJECT_COLORS[snap.projects.length % PROJECT_COLORS.length];
  const p = { id: uid(), name: name.trim(), color, sortOrder: snap.projects.length, createdAt: Date.now() };
  snap.projects.push(p);
  if (!(await persist(() => db.saveProject(p)))) return;
  view = "project:" + p.id; render();
}
function tagNameExists(name: string, exceptId?: string): boolean {
  const key = name.trim().toLocaleLowerCase();
  return snap.tags.some((t) => t.id !== exceptId && t.name.trim().toLocaleLowerCase() === key);
}
async function addTag(): Promise<void> {
  const name = await promptModal("新建标签", "标签名称");
  if (!name || !name.trim()) return;
  if (tagNameExists(name)) { toast("已存在同名标签"); return; }
  const tag = { id: uid(), name: name.trim(), color: PROJECT_COLORS[snap.tags.length % PROJECT_COLORS.length] };
  snap.tags.push(tag);
  if (!(await persist(() => db.saveTag(tag)))) return;
  view = "tag:" + tag.id;
  setCollapsed("tags", false);
  render();
}
async function renameTag(id: string): Promise<void> {
  const tag = snap.tags.find((t) => t.id === id);
  if (!tag) return;
  const name = await promptModal("重命名标签", "标签名称", tag.name);
  if (!name || !name.trim() || name.trim() === tag.name) return;
  if (tagNameExists(name, id)) { toast("已存在同名标签"); return; }
  tag.name = name.trim();
  if (!(await persist(() => db.saveTag(tag)))) return;
  render();
}
async function removeTag(id: string): Promise<void> {
  const tag = snap.tags.find((t) => t.id === id);
  if (!tag) return;
  const count = snap.tasks.filter((t) => t.tags.includes(id)).length;
  if (!(await confirmModal(`删除标签「${tag.name}」？将从 ${count} 个任务中移除，但不会删除任务。`))) return;
  snap.tags = snap.tags.filter((t) => t.id !== id);
  for (const t of snap.tasks) t.tags = t.tags.filter((tagId) => tagId !== id);
  if (!(await persist(() => db.deleteTag(id)))) return;
  if (view === "tag:" + id) view = "smart:all";
  render();
  toast(`已删除标签「${tag.name}」`);
}

async function removeProject(id: string): Promise<void> {
  const p = snap.projects.find((x) => x.id === id); if (!p) return;
  const doomed = snap.tasks.filter((t) => t.projectId === id);
  if (!(await confirmModal(`删除清单「${p.name}」及其中的 ${doomed.length} 个任务?`))) return;
  if (selectedId && doomed.some((t) => t.id === selectedId)) closeDetail(false);
  for (const t of doomed) pendingSaves.delete(t.id);
  snap.projects = snap.projects.filter((x) => x.id !== id);
  snap.tasks = snap.tasks.filter((t) => t.projectId !== id);
  if (!(await persist(() => db.deleteProject(id)))) return;
  if (view === "project:" + id) view = "smart:today";
  render();
  toast(`已删除清单「${p.name}」及 ${doomed.length} 个任务`, {
    ms: 15000,
    action: {
      label: "撤销",
      run: () => {
        snap.projects.push(p);
        snap.tasks.push(...doomed);
        void persist(async () => {
          await db.saveProject(p);
          await db.saveTasks(doomed);
        }).then((ok) => { if (ok) render(); });
      },
    },
  });
}

/* ============ 弹窗 ============ */
interface ModalEntry { overlay: HTMLElement; box: HTMLElement; close: () => void }
const modalStack: ModalEntry[] = [];
const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
let modalSeq = 0;

function modal(titleText: string, bodyNode: Node, footNodes: Node[], onClose?: () => void, returnFocus?: HTMLElement | null): { close: () => void } {
  const previousFocus = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const previousTaskId = previousFocus?.dataset.id;
  const previousTitle = previousFocus?.getAttribute("title");
  const titleId = `modal-title-${++modalSeq}`;
  const title = el("div", { class: "modal-title", id: titleId }, titleText);
  const closeBtn = el("button", { class: "icon-btn", type: "button", title: "关闭", "aria-label": "关闭弹窗", onClick: () => close() }, "✕");
  const box = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabIndex: "-1" },
    el("div", { class: "modal-head" }, title, closeBtn),
    el("div", { class: "modal-body" }, bodyNode),
    el("div", { class: "modal-foot" }, ...footNodes));
  const ov = el("div", { class: "modal-overlay", onClick: (e: Event) => { if (e.target === ov) close(); } }, box);
  let closed = false;
  const entry: ModalEntry = { overlay: ov, box, close };
  function close(): void {
    if (closed) return;
    closed = true;
    closeOpenSelect?.();
    const i = modalStack.indexOf(entry);
    if (i >= 0) modalStack.splice(i, 1);
    ov.remove();
    onClose?.();
    if (previousFocus?.isConnected) previousFocus.focus();
    else if (previousTaskId) document.querySelector<HTMLElement>(`[data-id="${CSS.escape(previousTaskId)}"]`)?.focus();
    else if (previousTitle) document.querySelector<HTMLElement>(`button[title="${CSS.escape(previousTitle)}"]`)?.focus();
    else modalStack[modalStack.length - 1]?.box.focus();
  }
  document.body.append(ov);
  modalStack.push(entry);
  setTimeout(() => {
    const target = box.querySelector<HTMLElement>("input:not([type='file']):not([disabled]), textarea:not([disabled]), .btn-primary:not([disabled]), button:not([disabled])");
    (target ?? box).focus();
  }, 0);
  return { close };
}

function visibleFocusable(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
}

document.addEventListener("focusin", (e) => {
  const top = modalStack[modalStack.length - 1];
  if (!top || top.box.contains(e.target as Node)) return;
  (visibleFocusable(top.box)[0] ?? top.box).focus();
}, true);

document.addEventListener("keydown", (e) => {
  const top = modalStack[modalStack.length - 1];
  if (!top) return;
  if (e.key === "Escape") {
    if (top.box.querySelector(".select-wrap.open")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    top.close();
    return;
  }
  if (e.key !== "Tab") return;
  const items = visibleFocusable(top.box);
  if (!items.length) { e.preventDefault(); top.box.focus(); return; }
  const first = items[0], last = items[items.length - 1];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const trapped = e.shiftKey ? index <= 0 : index < 0 || index === items.length - 1;
  if (trapped) {
    e.preventDefault(); e.stopPropagation();
    (e.shiftKey ? last : first).focus();
  }
}, true);

// prompt()/confirm() 在嵌入式 WebView 里不受支持,统一用自绘弹窗代替。
function promptModal(title: string, placeholder = "", value = ""): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string | null) => { if (settled) return; settled = true; m.close(); resolve(v); };
    const inp = el("input", { class: "date-input", placeholder, value }) as HTMLInputElement;
    inp.addEventListener("keydown", (e) => {
      const k = e as KeyboardEvent;
      if (k.key === "Enter" && !k.isComposing) { e.preventDefault(); done(inp.value); }
    });
    const cancel = el("button", { class: "btn-ghost", onClick: () => done(null) }, "取消");
    const ok = el("button", { class: "btn-primary", onClick: () => done(inp.value) }, "确定");
    const m = modal(title, el("div", { class: "form" }, inp), [cancel, ok], () => done(null));
    setTimeout(() => inp.focus(), 40);
  });
}
function confirmModal(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean) => { if (settled) return; settled = true; m.close(); resolve(v); };
    const cancel = el("button", { class: "btn-ghost", onClick: () => done(false) }, "取消");
    const ok = el("button", { class: "btn-primary", onClick: () => done(true) }, "确定");
    const m = modal("确认", el("div", { class: "confirm-msg" }, message), [cancel, ok], () => done(false));
  });
}
function labelControl(label: string, control: Node): HTMLElement {
  if (control instanceof HTMLElement) {
    const target = control.matches("input, textarea, .select") ? control : control.querySelector<HTMLElement>("input, textarea, .select");
    target?.setAttribute("aria-label", label);
  }
  return el("div", { class: "field" }, el("div", { class: "flabel" }, label), control);
}
function field2(label: string, control: Node): HTMLElement {
  return labelControl(label, control);
}
function toggleChip(label: string, on: boolean, cb: (v: boolean) => void): HTMLElement {
  let state = on;
  const b = el("button", {
    class: "chk" + (state ? " on" : ""),
    type: "button",
    "aria-pressed": String(state),
    onClick: () => {
      state = !state;
      b.classList.toggle("on", state);
      b.setAttribute("aria-pressed", String(state));
      cb(state);
    },
  }, label);
  return b;
}

function openFilterEditor(existing?: Filter): void {
  const isNew = !existing;
  let color = existing ? existing.color : PROJECT_COLORS[1];
  const nameInp = el("input", { class: "date-input", placeholder: "筛选器名称", value: existing ? existing.name : "" }) as HTMLInputElement;

  const colorRow = el("div", { class: "swatches" });
  const swatches: HTMLElement[] = [];
  for (const c of PROJECT_COLORS) {
    const b = el("button", { class: "swatch" + (c === color ? " on" : ""), style: `background:${c}`, onClick: () => { color = c; swatches.forEach((x) => x.classList.remove("on")); b.classList.add("on"); } });
    swatches.push(b); colorRow.append(b);
  }

  const prios = new Set<Priority>(existing ? existing.rule.priorities : []);
  const prioRow = el("div", { class: "chk-row" });
  ([[5, "高"], [3, "中"], [1, "低"], [0, "无"]] as [Priority, string][]).forEach(([p, l]) => prioRow.append(toggleChip(l, prios.has(p), (v) => { v ? prios.add(p) : prios.delete(p); })));

  const tagSet = new Set<string>(existing ? existing.rule.tagIds : []);
  const tagRow = el("div", { class: "chk-row" });
  for (const t of snap.tags) tagRow.append(toggleChip(t.name, tagSet.has(t.id), (v) => { v ? tagSet.add(t.id) : tagSet.delete(t.id); }));

  const projSet = new Set<string>(existing ? existing.rule.projectIds : []);
  const projRow = el("div", { class: "chk-row" });
  for (const p of snap.projects) projRow.append(toggleChip(p.name, projSet.has(p.id), (v) => { v ? projSet.add(p.id) : projSet.delete(p.id); }));

  const dueSel = selectControl(
    [["any", "不限"], ["overdue", "已逾期"], ["today", "今天及以前"], ["next7", "未来 7 天"], ["nodate", "无日期"]].map(([v, l]) => ({ value: v, label: l })),
    existing ? existing.rule.due : "any",
  );

  const body = el("div", { class: "form" },
    field2("名称", nameInp), field2("颜色", colorRow), field2("优先级(满足其一)", prioRow),
    snap.tags.length ? field2("标签(含其一)", tagRow) : el("div"),
    field2("清单(属其一)", projRow), field2("日期", dueSel.el));

  const saveBtn = el("button", { class: "btn-primary", onClick: async () => {
    const f: Filter = { id: existing ? existing.id : uid(), name: nameInp.value.trim() || "未命名筛选器", color, rule: { projectIds: [...projSet], tagIds: [...tagSet], priorities: [...prios], due: dueSel.getValue() as DueFilter } };
    if (!(await persist(() => db.saveFilter(f)))) return;
    const i = snap.filters.findIndex((x) => x.id === f.id);
    if (i >= 0) snap.filters[i] = f; else snap.filters.push(f);
    view = "filter:" + f.id; m.close(); render();
  } }, "保存");

  const foot: Node[] = [];
  if (!isNew) foot.push(el("button", { class: "text-btn danger", onClick: async () => {
    if (!(await persist(() => db.deleteFilter(existing!.id)))) return;
    snap.filters = snap.filters.filter((x) => x.id !== existing!.id);
    if (view === "filter:" + existing!.id) view = "smart:today";
    m.close(); render();
  } }, "删除"));
  foot.push(saveBtn);

  const m = modal(isNew ? "新建筛选器" : "编辑筛选器", body, foot);
}

async function download(name: string, text: string): Promise<void> {
  if (isTauri()) {
    const path = await saveDialog({
      defaultPath: name,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (path) await writeTextFile(path, text);
    return;
  }
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importCsvText(text: string): Promise<{ tasks: number; projects: number; tags: number; warnings: string[] }> {
  const res = importFromTickTickCsv(text);
  const warnings: string[] = [];
  if (!(await flushSaves())) throw new Error("当前修改未保存，已取消导入");
  snap = await db.reload();
  createSafetyBackup(JSON.stringify(snap));

  // 同名清单/标签复用已有的,避免重复导入产生一堆副本。
  const projByName = new Map(snap.projects.map((p) => [p.name, p.id] as [string, string]));
  const projectMap = new Map<string, string>();
  let newProjects = 0;
  for (const p of res.projects) {
    const hit = projByName.get(p.name);
    if (hit) projectMap.set(p.id, hit);
    else {
      snap.projects.push(p); projByName.set(p.name, p.id); projectMap.set(p.id, p.id); newProjects++;
    }
  }

  const tagByName = new Map(snap.tags.map((t) => [t.name, t.id] as [string, string]));
  const tagMap = new Map<string, string>();
  let newTags = 0;
  for (const t of res.tags) {
    const hit = tagByName.get(t.name);
    if (hit) tagMap.set(t.id, hit);
    else {
      snap.tags.push(t); tagByName.set(t.name, t.id); tagMap.set(t.id, t.id); newTags++;
    }
  }

  let orphan = 0;
  for (const t of res.tasks) {
    const pid = projectMap.get(t.projectId);
    if (pid) t.projectId = pid; else { t.projectId = INBOX_ID; orphan++; }
    t.tags = t.tags.map((id) => tagMap.get(id)).filter((x): x is string => !!x);
    snap.tasks.push(t);
  }
  if (orphan) warnings.push(`${orphan} 个任务未找到所属清单,已放入收集箱`);

  if (!(await persist(() => db.replaceAll(snap)))) throw new Error("导入未保存，已恢复原数据");
  return { tasks: res.tasks.length, projects: newProjects, tags: newTags, warnings };
}

async function restoreWithProtection(data: Record<string, unknown>): Promise<{ snap: Snapshot; warnings: string[] }> {
  assertSnapshotImport(data);
  const { snap: restored, warnings } = normalizeSnapshot(data);
  if (!(await flushSaves())) throw new Error("当前修改未保存，已取消恢复");
  snap = await db.reload();
  createSafetyBackup(JSON.stringify(snap));
  if (!(await persist(() => db.replaceAll(restored)))) throw new Error("恢复未保存，已保留原数据");
  closeDetail(false);
  snap = restored;
  render();
  return { snap: restored, warnings };
}

function openDataModal(ev?: Event): void {
  const trigger = ev?.currentTarget instanceof HTMLElement ? ev.currentTarget : null;
  const exportBtn = el("button", { class: "btn-primary", onClick: () => {
    void download("locado-backup.json", JSON.stringify(snap, null, 2))
      .catch((e) => toast("导出失败:" + ((e as Error)?.message ?? e), { ms: 9000 }));
  } }, "导出为 JSON 备份");

  const jsonInp = el("input", { type: "file", accept: ".json", class: "file" }) as HTMLInputElement;
  jsonInp.addEventListener("change", async () => {
    const f = jsonInp.files?.[0]; if (!f) return;
    jsonInp.value = "";
    try {
      const data: unknown = JSON.parse(await f.text());
      assertSnapshotImport(data);
      if (!(await confirmModal("导入备份会替换当前所有数据,继续?"))) return;
      const { snap: restored, warnings } = await restoreWithProtection(data);
      m.close();
      const fixed = warnings.length ? ` · 已修复:${warnings.join(";")}` : "";
      toast(`已导入 ${restored.tasks.length} 个任务、${restored.projects.length} 个清单${fixed}`, { ms: 8000 });
    } catch (e) { toast("❌ 导入失败:" + ((e as Error)?.message ?? e), { ms: 9000 }); }
  });

  const backupList = el("div", { class: "backup-list" });
  let backups: ReturnType<typeof listBackups> = [];
  try { backups = listBackups(); } catch { backupList.append(el("div", { class: "hint" }, "无法读取自动备份")); }
  if (!backups.length && !backupList.childElementCount) backupList.append(el("div", { class: "hint" }, "还没有自动备份"));
  for (const backup of backups) {
    const time = `${toDateInput(backup.createdAt)} ${fmtTime(backup.createdAt)}`;
    const reason = backup.reason === "before-restore" ? "恢复前保护" : "自动备份";
    const text = backup.valid
      ? `${time} · ${reason} · ${backup.tasks} 个任务 / ${backup.projects} 个清单 / ${backup.tags} 个标签`
      : `${time} · 备份损坏，无法恢复`;
    const button = el("button", { class: "backup-item", type: "button" }, text) as HTMLButtonElement;
    if (!backup.valid) button.disabled = true;
    else button.addEventListener("click", async () => {
      if (!(await confirmModal("恢复此备份会替换当前所有数据，当前数据会先保存为恢复前保护。继续？"))) return;
      try {
        const data = readBackupSnapshot(backup.key);
        const { snap: restored, warnings } = await restoreWithProtection(data.data);
        m.close();
        const fixed = warnings.length ? ` · 已修复:${warnings.join(";")}` : "";
        toast(`已恢复 ${restored.tasks.length} 个任务、${restored.projects.length} 个清单${fixed}`, { ms: 8000 });
      } catch (e) { toast("恢复失败:" + ((e as Error)?.message ?? e), { ms: 9000 }); }
    });
    backupList.append(button);
  }

  const csvInp = el("input", { type: "file", accept: ".csv", class: "file" }) as HTMLInputElement;
  csvInp.addEventListener("change", async () => {
    const f = csvInp.files?.[0]; if (!f) return;
    csvInp.value = "";
    try {
      const r = await importCsvText(await f.text());
      m.close(); render();
      const fixed = r.warnings.length ? ` · ${r.warnings.join(";")}` : "";
      toast(`已导入 ${r.tasks} 个任务(新增 ${r.projects} 个清单、${r.tags} 个标签)${fixed}`, { ms: 8000 });
    } catch (e) { toast("❌ 导入失败:" + ((e as Error)?.message ?? e), { ms: 9000 }); }
  });

  const body = el("div", { class: "form" },
    field2("备份", el("div", {}, exportBtn)),
    field2("自动备份（最多 5 份）", backupList),
    field2("导入 Locado 备份(.json)", jsonInp),
    field2("从滴答清单导入(.csv)", csvInp),
    el("div", { class: "hint" }, "滴答导出方法:滴答清单 → 设置 → 备份与导出 → 导出,得到 CSV 后在此选择。导入为追加,不会覆盖现有任务。"));
  const m = modal("数据导入 / 导出", body, [], undefined, trigger);
}

/* ============ 主题 ============ */
function applyTheme(dark: boolean): void {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try { localStorage.setItem("locado.theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  $("#theme-btn").replaceChildren(icon(dark ? "sun" : "moon"));
}

/* ============ 装配 ============ */
function render(): void { renderSidebar(); renderMain(); }

function buildShell(): void {
  const app = $("#app");
  app.append(
    el("div", { class: "layout" },
      el("aside", { class: "sidebar", id: "sidebar" }),
      el("section", { class: "main" },
        el("div", { class: "topbar" },
          el("h1", { id: "view-title" }, "今天"),
          el("span", { class: "sub", id: "view-sub" }),
          el("span", { class: "spacer" }),
          el("button", { class: "icon-btn", id: "theme-btn", title: "深浅色", onClick: () => applyTheme(document.documentElement.dataset.theme !== "dark") }, icon("moon")),
        ),
        el("div", { class: "add-row", id: "add-row" }, elAddInput()),
        el("div", { class: "list", id: "list" }),
      ),
    ),
  );
}

function elAddInput(): HTMLElement {
  const input = el("input", { class: "add-input", placeholder: "＋ 添加任务,如「每周五18点提交周报」" }) as HTMLInputElement;
  const preview = el("div", { class: "quick-add-preview", role: "group", "aria-label": "自然语言识别结果" });
  const ignored = new Set<string>();
  let parsed = parseTask("");
  const corrected = () => applyQuickAddCorrections(parsed, ignored);

  const renderPreview = () => {
    preview.innerHTML = "";
    const show = !!input.value.trim() && parsed.parts.length > 0;
    preview.style.display = show ? "flex" : "none";
    if (!show) return;
    const current = corrected();
    preview.append(el("span", { class: "quick-add-title" }, `标题：${current.title || "无标题"}`));
    for (const part of current.parts) {
      const button = el("button", {
        type: "button",
        class: "quick-add-chip",
        title: "取消识别并保留为普通标题",
        "aria-label": `取消识别 ${part.text}，保留为普通标题`,
      }, part.text, el("span", { class: "quick-add-chip-x", "aria-hidden": "true" }, "×"));
      button.addEventListener("click", () => { ignored.add(part.key); renderPreview(); input.focus(); });
      preview.append(button);
    }
  };

  input.addEventListener("input", () => {
    ignored.clear();
    parsed = parseTask(input.value);
    renderPreview();
  });
  input.addEventListener("keydown", (e) => {
    const k = e as KeyboardEvent;
    if (k.key === "Enter" && !k.isComposing) {
      e.preventDefault();
      const current = corrected();
      const skipDateDefault = ignored.has("date") || ignored.has("recurrence");
      void addTask(input.value, current, skipDateDefault);
      input.value = ""; ignored.clear(); parsed = parseTask(""); renderPreview();
    }
  });
  return el("div", { class: "quick-add" }, input, preview);
}

async function boot(): Promise<void> {
  setupPWA();
  onStorageError((msg) => toast("⚠️ " + msg, { ms: 12000 }));
  onBackupError((msg) => toast(msg, { ms: 10000 }));
  snap = await db.load();
  buildShell();
  try { applyTheme(localStorage.getItem("locado.theme") === "dark"); } catch { /* ignore */ }
  render();
  window.setInterval(tick, 1000);
  tick();
  window.addEventListener("beforeunload", () => { void flushSaves(); persistFocus(); flushAutoBackup(); });

  // 跨标签页只刷新界面;未落盘编辑仍由 updateTask 在写锁内合并,
  // 已被其它标签页删除的任务直接丢弃,不得重新插回快照。
  let syncTimer: number | null = null;
  window.addEventListener("storage", (e) => {
    if (e.key !== SNAPSHOT_KEY) return;
    if (syncTimer != null) clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      void (async () => {
        try {
          const fresh = await db.reload();
          for (const [id, task] of pendingSaves) {
            const i = fresh.tasks.findIndex((item) => item.id === id);
            if (i >= 0) fresh.tasks[i] = task;
            else pendingSaves.delete(id);
          }
          snap = fresh;
          closeDetail(false);
          render();
          toast("已同步其它标签页的修改", { ms: 2500 });
        } catch { /* 保留当前界面,等待下一次同步 */ }
      })();
    }, 300);
  });
}

boot();
