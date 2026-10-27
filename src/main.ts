import "./styles.css";
import { getDB, normalizeSnapshot, onStorageError, SNAPSHOT_KEY, uid } from "./db";
import { INBOX_ID } from "./seed";
import { importFromTickTickCsv } from "./importers";
import { parseTask } from "./nlp";
import { setupPWA } from "./pwa";
import {
  HABIT_ICONS,
  PROJECT_COLORS,
  type DueFilter,
  type Filter,
  type FocusRecord,
  type Habit,
  type Priority,
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
  return new Date(y, m - 1, d, 18, 0, 0, 0).getTime();
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
  { id: "smart:today", name: "今天", ico: "☀️" },
  { id: "smart:next7", name: "最近 7 天", ico: "🗓️" },
  { id: "smart:all", name: "全部", ico: "🗂️" },
  { id: "calendar", name: "日历", ico: "📅" },
  { id: "matrix", name: "四象限", ico: "⊞" },
];

const QUADRANTS: { p: Priority; title: string; sub: string; color: string }[] = [
  { p: 5, title: "重要且紧急", sub: "马上做", color: "var(--p-high)" },
  { p: 3, title: "重要不紧急", sub: "安排做", color: "var(--p-mid)" },
  { p: 1, title: "紧急不重要", sub: "可委托", color: "var(--p-low)" },
  { p: 0, title: "不重要不紧急", sub: "少做", color: "var(--p-none)" },
];
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
  bar.append(el("div", { class: "brand" }, el("div", { class: "logo" }, "L"), el("div", { class: "name" }, "Locado")));

  for (const s of SMART) {
    const noCount = s.id === "calendar" || s.id === "matrix";
    bar.append(navItem({ id: s.id, ico: s.ico, label: s.name, count: noCount ? 0 : activeCount(s.id) }));
  }

  const lc = isCollapsed("projects", false);
  bar.append(groupHeader("projects", "清单", lc, () => addProject()));
  if (!lc) for (const p of [...snap.projects].sort((a, b) => a.sortOrder - b.sortOrder)) {
    bar.append(navItem({ id: "project:" + p.id, dot: p.color, label: p.name, count: activeCount("project:" + p.id), onDel: p.id === INBOX_ID ? undefined : () => removeProject(p.id) }));
  }

  if (snap.tags.length) {
    const tc = isCollapsed("tags", true);
    bar.append(groupHeader("tags", "标签", tc));
    if (!tc) for (const t of snap.tags) bar.append(navItem({ id: "tag:" + t.id, dot: t.color, label: t.name, count: activeCount("tag:" + t.id) }));
  }

  {
    const fc = isCollapsed("filters", true);
    bar.append(groupHeader("filters", "筛选器", fc, () => openFilterEditor()));
    if (!fc) for (const f of snap.filters) {
      bar.append(navItem({ id: "filter:" + f.id, dot: f.color, label: f.name, count: activeCount("filter:" + f.id), onEdit: () => openFilterEditor(f) }));
    }
  }

  const tray = el("div", { class: "tray" });
  for (const [id, ico, label] of [["habits", "🔥", "习惯"], ["focus", "🍅", "专注"], ["smart:completed", "✅", "已完成"]] as [string, string, string][]) {
    tray.append(el("button", { class: "tray-btn" + (view === id ? " active" : ""), title: label, onClick: () => { view = id; render(); } }, ico));
  }
  tray.append(el("button", { class: "tray-btn", title: "导入 / 导出", onClick: openDataModal }, "⇄"));
  bar.append(el("div", { class: "sidebar-foot" }, tray));
}

function isCollapsed(key: string, def: boolean): boolean {
  try { const v = localStorage.getItem("locado.collapse." + key); return v == null ? def : v === "1"; } catch { return def; }
}
function setCollapsed(key: string, v: boolean): void {
  try { localStorage.setItem("locado.collapse." + key, v ? "1" : "0"); } catch { /* ignore */ }
}
function groupHeader(key: string, text: string, collapsed: boolean, onAdd?: () => void): HTMLElement {
  const h = el("div", { class: "nav-group-label collapsible", onClick: () => { setCollapsed(key, !collapsed); renderSidebar(); } },
    el("span", { class: "nav-chevron" + (collapsed ? " collapsed" : "") }, "⌄"),
    el("span", { class: "gl-text" }, text));
  if (onAdd) h.append(el("button", { class: "group-add", title: "新建", onClick: (e: Event) => { e.stopPropagation(); onAdd(); } }, "+"));
  return h;
}

function navItem(o: { id: string; ico?: string; dot?: string; label: string; count: number; onDel?: () => void; onEdit?: () => void }): HTMLElement {
  const kids: (Node | string)[] = [];
  if (o.ico) kids.push(el("span", { class: "ico" }, o.ico));
  if (o.dot) kids.push(el("span", { class: "dot", style: `background:${o.dot}` }));
  kids.push(el("span", { class: "label" }, o.label));
  if (o.count > 0) kids.push(el("span", { class: "count" }, String(o.count)));
  if (o.onEdit) kids.push(el("button", { class: "del", title: "编辑", onClick: (e: Event) => { e.stopPropagation(); o.onEdit!(); } }, "✎"));
  if (o.onDel) kids.push(el("button", { class: "del", title: "删除", onClick: (e: Event) => { e.stopPropagation(); o.onDel!(); } }, "×"));
  return el("button", { class: "nav-item" + (view === o.id ? " active" : ""), onClick: () => { view = o.id; render(); } }, ...kids);
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

  addRow.style.display = "";
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
  if (t.dueDate != null) meta.append(el("span", { class: "chip due" + (!t.completed && isOverdue(t.dueDate) ? " overdue" : "") }, "📅 " + dueLabel(t.dueDate) + (t.hasTime ? " " + fmtTime(t.dueDate) : "")));
  if (t.reminderMinutesBefore != null) meta.append(el("span", { class: "chip" }, "⏰ " + remindLabel(t.reminderMinutesBefore)));
  const doneSubs = t.subtasks.filter((s) => s.completed).length;
  if (t.subtasks.length) meta.append(el("span", { class: "chip" }, `☑ ${doneSubs}/${t.subtasks.length}`));
  for (const tagId of t.tags) {
    const tag = snap.tags.find((x) => x.id === tagId);
    if (tag) meta.append(el("span", { class: "chip tag", style: `color:${tag.color}` }, tag.name));
  }
  const body = el("div", { class: "task-body" }, el("div", { class: "task-title" }, t.title || "无标题"));
  if (meta.childElementCount) body.append(meta);
  const row = el("div", { class: "task" + (t.completed ? " done" : "") + (selectedId === t.id ? " selected" : ""), draggable: "true", onClick: () => openDetail(t.id) }, check, body);
  row.dataset.id = t.id;
  if (t.pinned) row.append(el("span", { class: "pin" }, "📌"));
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
    cell.append(el("div", { class: "cal-date" }, String(d.getDate())));
    const dayTasks = snap.tasks.filter((t) => !t.completed && t.dueDate != null && dayKey(new Date(t.dueDate)) === dayKey(d)).sort(sortTasks);
    for (const t of dayTasks.slice(0, 3)) {
      cell.append(el("div", { class: "cal-ev", onClick: (e: Event) => { e.stopPropagation(); openDetail(t.id); } }, el("span", { class: `evdot p${t.priority}` }), el("span", { class: "evtitle" }, t.title || "无标题")));
    }
    if (dayTasks.length > 3) cell.append(el("div", { class: "cal-more" }, `+${dayTasks.length - 3}`));
    const theDay = new Date(d);
    cell.addEventListener("click", () => quickAddOn(theDay));
    grid.append(cell);
  }
  wrap.append(head, dow, grid);
  list.append(wrap);
}

async function quickAddOn(d: Date): Promise<void> {
  const title = await promptModal(`在 ${d.getMonth() + 1} 月 ${d.getDate()} 日新建任务`, "任务标题");
  if (!title || !title.trim()) return;
  const due = new Date(d); due.setHours(18, 0, 0, 0);
  const t: Task = { id: uid(), projectId: INBOX_ID, title: title.trim(), note: "", priority: 0, completed: false, completedAt: null, dueDate: due.getTime(), pinned: false, tags: [], subtasks: [], createdAt: Date.now(), updatedAt: Date.now() };
  snap.tasks.push(t); await db.saveTask(t); render();
}

/* ============ 四象限(艾森豪威尔矩阵) ============ */
function renderMatrix(list: HTMLElement): void {
  const wrap = el("div", { class: "matrix" });
  for (const q of QUADRANTS) {
    const cell = el("div", { class: "mx-cell" });
    cell.style.setProperty("--qc", q.color);
    cell.append(el("div", { class: "mx-head" }, el("span", { class: "mx-dot" }), el("span", { class: "mx-title" }, q.title), el("span", { class: "mx-sub" }, q.sub)));
    const body = el("div", { class: "mx-body" });
    const tasks = snap.tasks.filter((t) => !t.completed && t.priority === q.p).sort(sortTasks);
    if (!tasks.length) body.append(el("div", { class: "mx-empty" }, "拖任务到这里"));
    for (const t of tasks) {
      const chk = el("span", { class: "mx-check", onClick: (e: Event) => { e.stopPropagation(); toggleDone(t); } });
      const card = el("div", { class: "mx-task", draggable: "true", onClick: () => openDetail(t.id) }, chk, el("span", { class: "mx-tt" }, t.title || "无标题"));
      card.dataset.id = t.id;
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
      if (t && t.priority !== q.p) { t.priority = q.p; t.updatedAt = Date.now(); await db.saveTask(t); }
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
    const cell = el("div", { class: "hb-day" + (on ? " on" : "") + (i === 0 ? " today" : ""), title: `${d.getMonth() + 1}/${d.getDate()} · ${on ? "已打卡,点击取消" : "点击打卡"}`, style: on ? `background:${h.color};border-color:${h.color};color:#fff` : "" }, String(d.getDate()));
    cell.addEventListener("click", () => toggleCheckin(h, key));
    strip.append(cell);
  }
  const btn = el("button", { class: "hb-check" + (checked ? " done" : ""), style: checked ? `background:${h.color};border-color:${h.color};color:#fff` : `border-color:${h.color};color:${h.color}`, onClick: () => toggleCheckin(h) }, checked ? "今日已打卡 ✓" : "打卡");
  const del = el("button", { class: "hb-del", title: "删除", onClick: () => removeHabit(h) }, "×");
  return el("div", { class: "hb-card" },
    el("div", { class: "hb-top" }, el("span", { class: "hb-icon", style: `background:${h.color}22;color:${h.color}` }, h.icon), el("div", { class: "hb-name" }, h.name), el("span", { class: "hb-streak" }, `🔥 ${habitStreak(h)}`), del),
    strip, btn);
}

async function toggleCheckin(h: Habit, key: string = dayKey(new Date())): Promise<void> {
  h.checkins = h.checkins.includes(key) ? h.checkins.filter((x) => x !== key) : [...h.checkins, key];
  await db.saveHabit(h); render();
}
async function addHabit(): Promise<void> {
  const name = await promptModal("新建习惯", "习惯名称");
  if (!name || !name.trim()) return;
  const h: Habit = { id: uid(), name: name.trim(), icon: HABIT_ICONS[snap.habits.length % HABIT_ICONS.length], color: PROJECT_COLORS[snap.habits.length % PROJECT_COLORS.length], checkins: [], sortOrder: snap.habits.length, createdAt: Date.now() };
  snap.habits.push(h); await db.saveHabit(h); render();
}
async function removeHabit(h: Habit): Promise<void> {
  if (!(await confirmModal(`删除习惯「${h.name}」?`))) return;
  snap.habits = snap.habits.filter((x) => x.id !== h.id);
  await db.deleteHabit(h.id); render();
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

type FocusMode = "idle" | "work" | "break";
const focus: { mode: FocusMode; running: boolean; remaining: number; endsAt: number; startedAt: number; taskId: string | null } =
  { mode: "idle", running: false, remaining: workMin() * 60, endsAt: 0, startedAt: 0, taskId: null };

function focusTotal(mode: FocusMode): number { return (mode === "break" ? breakMin() : workMin()) * 60; }
function fmt(sec: number): string { const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; }

function tick(): void {
  checkReminders();
  if (!focus.running) return;
  const rem = Math.max(0, Math.round((focus.endsAt - Date.now()) / 1000));
  focus.remaining = rem;
  if (rem <= 0) { focusComplete(); return; }
  if (view === "focus") updateFocusTime();
}

/* ============ 提醒投递 ============ */
function applyTime(t: Task, val: string): void {
  if (!val) { t.hasTime = false; return; }
  const [h, mi] = val.split(":").map(Number);
  const base = t.dueDate != null ? new Date(t.dueDate) : new Date();
  base.setHours(h, mi, 0, 0);
  t.dueDate = base.getTime(); t.hasTime = true;
}
function ensureNotifyPermission(): void {
  try { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); } catch { /* ignore */ }
}
function fireReminder(t: Task): void {
  const body = t.title + (t.dueDate != null ? `  ·  ${dueLabel(t.dueDate)}${t.hasTime ? " " + fmtTime(t.dueDate) : ""}` : "");
  try { if ("Notification" in window && Notification.permission === "granted") new Notification("⏰ Locado 提醒", { body }); } catch { /* ignore */ }
  toast("⏰ " + body);
}
function checkReminders(): void {
  const now = Date.now();
  for (const t of snap.tasks) {
    if (t.completed || t.reminded || t.dueDate == null || t.reminderMinutesBefore == null) continue;
    const at = t.dueDate - t.reminderMinutesBefore * 60000;
    if (now < at) continue;
    t.reminded = true; void db.saveTask(t);
    if (now - at < 12 * 3600000) fireReminder(t); // 太久以前的只标记不弹
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
  if (focus.mode === "idle") { focus.mode = "work"; focus.remaining = workMin() * 60; focus.startedAt = Date.now(); }
  else if (!focus.startedAt) focus.startedAt = Date.now() - (focusTotal(focus.mode) - focus.remaining) * 1000;
  focus.endsAt = Date.now() + focus.remaining * 1000;
  focus.running = true;
  if (view === "focus") renderMain();
}
function focusPause(): void {
  focus.running = false;
  focus.remaining = Math.max(0, Math.round((focus.endsAt - Date.now()) / 1000));
  if (view === "focus") renderMain();
}
function focusReset(): void {
  focus.running = false; focus.mode = "idle"; focus.remaining = workMin() * 60; focus.startedAt = 0;
  if (view === "focus") renderMain();
}
async function focusComplete(): Promise<void> {
  focus.running = false;
  if (focus.mode === "work") {
    const rec: FocusRecord = { id: uid(), startedAt: focus.startedAt || Date.now() - workMin() * 60000, minutes: workMin(), taskId: focus.taskId };
    snap.focusRecords.push(rec); await db.saveFocusRecord(rec);
    focus.mode = "break"; focus.remaining = breakMin() * 60; focus.startedAt = 0;
  } else {
    focus.mode = "idle"; focus.remaining = workMin() * 60; focus.startedAt = 0;
  }
  if (view === "focus") renderMain();
}

function updateFocusTime(): void {
  const te = document.querySelector("#focus-time"); if (te) te.textContent = fmt(focus.remaining);
  const ring = document.querySelector("#focus-ring") as HTMLElement | null;
  if (ring) {
    const total = focusTotal(focus.mode === "idle" ? "work" : focus.mode);
    const done = focus.mode === "idle" ? 0 : (1 - focus.remaining / total);
    ring.style.background = `conic-gradient(var(--accent) ${done * 360}deg, var(--bg-hover) 0)`;
  }
}

function renderFocus(list: HTMLElement): void {
  const inner = el("div", { class: "list-inner focus-wrap" });
  const modeLabel = focus.mode === "break" ? "休息" : focus.mode === "work" ? "专注中" : "准备开始";
  const total = focusTotal(focus.mode === "idle" ? "work" : focus.mode);
  const done = focus.mode === "idle" ? 0 : (1 - focus.remaining / total);

  const ring = el("div", { class: "focus-ring", id: "focus-ring", style: `background:conic-gradient(var(--accent) ${done * 360}deg, var(--bg-hover) 0)` },
    el("div", { class: "focus-inner" }, el("div", { class: "focus-time", id: "focus-time" }, fmt(focus.remaining)), el("div", { class: "focus-mode" }, modeLabel)));

  const startBtn = el("button", { class: "btn-primary big", onClick: () => (focus.running ? focusPause() : focusStart()) }, focus.running ? "暂停" : focus.mode === "idle" ? "开始专注" : "继续");
  const resetBtn = el("button", { class: "btn-ghost big", onClick: focusReset }, "重置");

  // 时长预设
  const durRow = el("div", { class: "chk-row center" });
  for (const m of [15, 25, 45]) {
    durRow.append(el("button", { class: "chk" + (workMin() === m ? " on" : ""), onClick: () => { try { localStorage.setItem("locado.work", String(m)); } catch { /* ignore */ } if (!focus.running && focus.mode === "idle") focus.remaining = m * 60; renderMain(); } }, `${m} 分`));
  }

  // 关联任务
  const sel = el("select", { class: "select", onChange: (e: Event) => { focus.taskId = (e.target as HTMLSelectElement).value || null; } }) as HTMLSelectElement;
  sel.append(el("option", { value: "" }, "不关联任务"));
  for (const t of snap.tasks.filter((x) => !x.completed)) {
    const o = el("option", { value: t.id }, t.title || "无标题") as HTMLOptionElement;
    if (focus.taskId === t.id) o.selected = true;
    sel.append(o);
  }

  // 今日统计
  const tk = dayKey(new Date());
  const today = snap.focusRecords.filter((r) => dayKey(new Date(r.startedAt)) === tk);
  const mins = today.reduce((a, r) => a + r.minutes, 0);
  const stats = el("div", { class: "focus-stats" },
    el("div", { class: "fs-item" }, el("div", { class: "fs-num" }, `🍅 ${today.length}`), el("div", { class: "fs-label" }, "今日番茄")),
    el("div", { class: "fs-item" }, el("div", { class: "fs-num" }, `${mins}`), el("div", { class: "fs-label" }, "专注分钟")),
  );

  inner.append(ring, el("div", { class: "focus-ctrl" }, startBtn, resetBtn), durRow, el("div", { class: "focus-task" }, sel), stats);
  list.append(inner);
}

/* ============ 详情抽屉 ============ */
let detailState: { id: string; bodyEl: HTMLElement; close: () => void } | null = null;

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

  const date = el("input", { class: "date-input", type: "date", value: toDateInput(t.dueDate) }) as HTMLInputElement;
  const time = el("input", { class: "date-input", type: "time", value: t.hasTime && t.dueDate != null ? fmtTime(t.dueDate) : "" }) as HTMLInputElement;
  date.addEventListener("change", () => {
    const base = fromDateInput(date.value);
    if (base != null && t.hasTime && t.dueDate != null) { const d = new Date(t.dueDate); const nd = new Date(base); nd.setHours(d.getHours(), d.getMinutes(), 0, 0); t.dueDate = nd.getTime(); }
    else t.dueDate = base;
    t.reminded = false; t.updatedAt = Date.now(); save(t);
  });
  time.addEventListener("change", () => { applyTime(t, time.value); t.reminded = false; t.updatedAt = Date.now(); save(t); openDetail(id); });
  const remindSel = el("select", { class: "select" }) as HTMLSelectElement;
  ([["", "无提醒"], ["0", "准时"], ["5", "提前 5 分钟"], ["15", "提前 15 分钟"], ["30", "提前 30 分钟"], ["60", "提前 1 小时"], ["1440", "提前 1 天"]] as [string, string][]).forEach(([v, l]) => { const o = el("option", { value: v }, l) as HTMLOptionElement; if (String(t.reminderMinutesBefore ?? "") === v) o.selected = true; remindSel.append(o); });
  remindSel.addEventListener("change", () => { t.reminderMinutesBefore = remindSel.value === "" ? null : Number(remindSel.value); t.reminded = false; t.updatedAt = Date.now(); if (t.reminderMinutesBefore != null) ensureNotifyPermission(); save(t); });

  const sel = el("select", { class: "select" }) as HTMLSelectElement;
  for (const p of snap.projects) {
    const op = el("option", { value: p.id }, p.name) as HTMLOptionElement;
    if (p.id === t.projectId) op.selected = true;
    sel.append(op);
  }
  sel.addEventListener("change", () => { t.projectId = sel.value; t.updatedAt = Date.now(); save(t); });

  const tagWrap = el("div", { class: "tag-pick" });
  for (const tag of snap.tags) {
    const on = t.tags.includes(tag.id);
    tagWrap.append(el("button", { class: on ? "on" : "", style: on ? `background:${tag.color}` : "", onClick: () => { t.tags = on ? t.tags.filter((x) => x !== tag.id) : [...t.tags, tag.id]; t.updatedAt = Date.now(); save(t); openDetail(id); } }, tag.name));
  }

  const subWrap = el("div", {});
  t.subtasks.forEach((s) => {
    const mini = el("span", { class: "mini" + (s.completed ? " done" : "") });
    mini.addEventListener("click", () => { s.completed = !s.completed; save(t); openDetail(id); });
    const inp = el("input", { value: s.title, placeholder: "子任务" }) as HTMLInputElement;
    inp.addEventListener("input", () => { s.title = inp.value; queueSave(t); });
    inp.addEventListener("blur", flushSaves);
    const x = el("button", { class: "x", onClick: () => { t.subtasks = t.subtasks.filter((q) => q.id !== s.id); save(t); openDetail(id); } }, "×");
    subWrap.append(el("div", { class: "sub" + (s.completed ? " done" : "") }, mini, inp, x));
  });
  const addSub = el("button", { class: "sub-add", onClick: () => { t.subtasks.push({ id: uid(), title: "", completed: false }); save(t); openDetail(id); } }, el("span", {}, "＋"), el("span", {}, "添加子任务"));

  const pinBtn = el("button", { class: "text-btn", onClick: () => { t.pinned = !t.pinned; t.updatedAt = Date.now(); save(t); openDetail(id); } }, t.pinned ? "📌 已置顶" : "📍 置顶");
  const delBtn = el("button", { class: "text-btn danger", onClick: () => removeTask(t.id) }, "🗑 删除任务");

  wrap.append(
    title,
    field("优先级", prioSeg),
    field("日期与时间", el("div", { class: "dt-row" }, date, time)),
    field("提醒", remindSel),
    field("清单", sel),
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
  return el("div", { class: "field" }, el("div", { class: "flabel" }, label), control);
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

function flushSaves(): void {
  if (saveTimer != null) { clearTimeout(saveTimer); saveTimer = null; }
  for (const t of pendingSaves.values()) void db.saveTask(t);
  pendingSaves.clear();
}

function queueSave(t: Task): void {
  pendingSaves.set(t.id, t);
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSaves, 300);
}

async function save(t: Task, rerender = true): Promise<void> {
  pendingSaves.delete(t.id);
  await db.saveTask(t);
  if (rerender) render(); else renderSidebar();
}
async function toggleDone(t: Task): Promise<void> {
  t.completed = !t.completed; t.completedAt = t.completed ? Date.now() : null; t.updatedAt = Date.now();
  await db.saveTask(t);
  if (selectedId === t.id && t.completed) closeDetail(); else render();
}
async function addTask(title: string): Promise<void> {
  const raw = title.trim(); if (!raw) return;
  const parsed = parseTask(raw);
  const projectId = view.startsWith("project:") ? view.slice(8) : INBOX_ID;
  let dueDate = parsed.dueDate;
  if (dueDate == null && (view === "smart:today" || view === "smart:next7")) dueDate = fromDateInput(toDateInput(Date.now()));
  const tags = view.startsWith("tag:") ? [view.slice(4)] : [];
  const t: Task = { id: uid(), projectId, title: parsed.title, note: "", priority: 0, completed: false, completedAt: null, dueDate, hasTime: parsed.hasTime, reminderMinutesBefore: parsed.reminderMinutesBefore, reminded: false, pinned: false, tags, subtasks: [], createdAt: Date.now(), updatedAt: Date.now() };
  snap.tasks.push(t); await db.saveTask(t);
  if (t.reminderMinutesBefore != null) ensureNotifyPermission();
  render();
}
async function removeTask(id: string): Promise<void> {
  const t = snap.tasks.find((x) => x.id === id);
  pendingSaves.delete(id);
  snap.tasks = snap.tasks.filter((x) => x.id !== id);
  await db.deleteTask(id); closeDetail(); render();
  if (t) {
    const backup: Task = JSON.parse(JSON.stringify(t)) as Task;
    toast(`已删除「${backup.title || "无标题"}」`, {
      ms: 12000,
      action: { label: "撤销", run: () => { snap.tasks.push(backup); void db.saveTask(backup); render(); } },
    });
  }
}
async function addProject(): Promise<void> {
  const name = await promptModal("新建清单", "清单名称"); if (!name || !name.trim()) return;
  const color = PROJECT_COLORS[snap.projects.length % PROJECT_COLORS.length];
  const p = { id: uid(), name: name.trim(), color, sortOrder: snap.projects.length, createdAt: Date.now() };
  snap.projects.push(p); await db.saveProject(p); view = "project:" + p.id; render();
}
async function removeProject(id: string): Promise<void> {
  const p = snap.projects.find((x) => x.id === id); if (!p) return;
  const doomed = snap.tasks.filter((t) => t.projectId === id);
  if (!(await confirmModal(`删除清单「${p.name}」及其中的 ${doomed.length} 个任务?`))) return;
  if (selectedId && doomed.some((t) => t.id === selectedId)) closeDetail(false);
  for (const t of doomed) pendingSaves.delete(t.id);
  snap.projects = snap.projects.filter((x) => x.id !== id);
  snap.tasks = snap.tasks.filter((t) => t.projectId !== id);
  await db.deleteProject(id);
  if (view === "project:" + id) view = "smart:today";
  render();
  toast(`已删除清单「${p.name}」及 ${doomed.length} 个任务`, {
    ms: 15000,
    action: {
      label: "撤销",
      run: () => {
        snap.projects.push(p);
        snap.tasks.push(...doomed);
        void db.saveProject(p);
        for (const t of doomed) void db.saveTask(t);
        render();
      },
    },
  });
}

/* ============ 弹窗 ============ */
function modal(titleText: string, bodyNode: Node, footNodes: Node[], onClose?: () => void): { close: () => void } {
  const box = el("div", { class: "modal" },
    el("div", { class: "modal-head" }, el("div", { class: "modal-title" }, titleText), el("button", { class: "icon-btn", onClick: () => close() }, "✕")),
    el("div", { class: "modal-body" }, bodyNode),
    el("div", { class: "modal-foot" }, ...footNodes));
  const ov = el("div", { class: "modal-overlay", onClick: (e: Event) => { if (e.target === ov) close(); } }, box);
  let closed = false;
  function close() { if (closed) return; closed = true; ov.remove(); onClose?.(); }
  document.body.append(ov);
  return { close };
}

// prompt()/confirm() 在嵌入式 WebView 里不受支持,统一用自绘弹窗代替。
function promptModal(title: string, placeholder = "", value = ""): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string | null) => { if (settled) return; settled = true; m.close(); resolve(v); };
    const inp = el("input", { class: "date-input", placeholder, value }) as HTMLInputElement;
    inp.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") done(inp.value); });
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
function field2(label: string, control: Node): HTMLElement {
  return el("div", { class: "field" }, el("div", { class: "flabel" }, label), control);
}
function toggleChip(label: string, on: boolean, cb: (v: boolean) => void): HTMLElement {
  let state = on;
  const b = el("button", { class: "chk" + (state ? " on" : ""), onClick: () => { state = !state; b.classList.toggle("on", state); cb(state); } }, label);
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

  const dueSel = el("select", { class: "select" }) as HTMLSelectElement;
  ([["any", "不限"], ["overdue", "已逾期"], ["today", "今天及以前"], ["next7", "未来 7 天"], ["nodate", "无日期"]] as [DueFilter, string][]).forEach(([v, l]) => {
    const o = el("option", { value: v }, l) as HTMLOptionElement;
    if (existing && existing.rule.due === v) o.selected = true;
    dueSel.append(o);
  });

  const body = el("div", { class: "form" },
    field2("名称", nameInp), field2("颜色", colorRow), field2("优先级(满足其一)", prioRow),
    snap.tags.length ? field2("标签(含其一)", tagRow) : el("div"),
    field2("清单(属其一)", projRow), field2("日期", dueSel));

  const saveBtn = el("button", { class: "btn-primary", onClick: async () => {
    const f: Filter = { id: existing ? existing.id : uid(), name: nameInp.value.trim() || "未命名筛选器", color, rule: { projectIds: [...projSet], tagIds: [...tagSet], priorities: [...prios], due: dueSel.value as DueFilter } };
    await db.saveFilter(f);
    const i = snap.filters.findIndex((x) => x.id === f.id);
    if (i >= 0) snap.filters[i] = f; else snap.filters.push(f);
    view = "filter:" + f.id; m.close(); render();
  } }, "保存");

  const foot: Node[] = [];
  if (!isNew) foot.push(el("button", { class: "text-btn danger", onClick: async () => {
    await db.deleteFilter(existing!.id);
    snap.filters = snap.filters.filter((x) => x.id !== existing!.id);
    if (view === "filter:" + existing!.id) view = "smart:today";
    m.close(); render();
  } }, "删除"));
  foot.push(saveBtn);

  const m = modal(isNew ? "新建筛选器" : "编辑筛选器", body, foot);
}

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importCsvText(text: string): Promise<{ tasks: number; projects: number; tags: number; warnings: string[] }> {
  const res = importFromTickTickCsv(text);
  const warnings: string[] = [];

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

  await db.replaceAll(snap);
  return { tasks: res.tasks.length, projects: newProjects, tags: newTags, warnings };
}

function openDataModal(): void {
  const exportBtn = el("button", { class: "btn-primary", onClick: () => download("locado-backup.json", JSON.stringify(snap, null, 2)) }, "导出为 JSON 备份");

  const jsonInp = el("input", { type: "file", accept: ".json", class: "file" }) as HTMLInputElement;
  jsonInp.addEventListener("change", async () => {
    const f = jsonInp.files?.[0]; if (!f) return;
    try {
      const data: unknown = JSON.parse(await f.text());
      const rec = (data !== null && typeof data === "object" ? data : null) as Record<string, unknown> | null;
      if (!rec || (!Array.isArray(rec.tasks) && !Array.isArray(rec.projects))) throw new Error("不是有效的备份");
      if (!(await confirmModal("导入备份会替换当前所有数据,继续?"))) return;
      const { snap: s, warnings } = normalizeSnapshot(rec);
      flushSaves();
      await db.replaceAll(s);
      closeDetail(false);
      snap = s; m.close(); render();
      const fixed = warnings.length ? ` · 已修复:${warnings.join(";")}` : "";
      toast(`已导入 ${s.tasks.length} 个任务、${s.projects.length} 个清单${fixed}`, { ms: 8000 });
    } catch (e) { toast("❌ 导入失败:" + ((e as Error)?.message ?? e), { ms: 9000 }); }
  });

  const csvInp = el("input", { type: "file", accept: ".csv", class: "file" }) as HTMLInputElement;
  csvInp.addEventListener("change", async () => {
    const f = csvInp.files?.[0]; if (!f) return;
    try {
      const r = await importCsvText(await f.text());
      m.close(); render();
      const fixed = r.warnings.length ? ` · ${r.warnings.join(";")}` : "";
      toast(`已导入 ${r.tasks} 个任务(新增 ${r.projects} 个清单、${r.tags} 个标签)${fixed}`, { ms: 8000 });
    } catch (e) { toast("❌ 导入失败:" + ((e as Error)?.message ?? e), { ms: 9000 }); }
  });

  const body = el("div", { class: "form" },
    field2("备份", el("div", {}, exportBtn)),
    field2("导入 Locado 备份(.json)", jsonInp),
    field2("从滴答清单导入(.csv)", csvInp),
    el("div", { class: "hint" }, "滴答导出方法:滴答清单 → 设置 → 备份与导出 → 导出,得到 CSV 后在此选择。导入为追加,不会覆盖现有任务。"));
  const m = modal("数据导入 / 导出", body, []);
}

/* ============ 主题 ============ */
function applyTheme(dark: boolean): void {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try { localStorage.setItem("locado.theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  $("#theme-btn").textContent = dark ? "☀️" : "🌙";
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
          el("button", { class: "icon-btn", id: "theme-btn", title: "深浅色", onClick: () => applyTheme(document.documentElement.dataset.theme !== "dark") }, "🌙"),
        ),
        el("div", { class: "add-row", id: "add-row" }, elAddInput()),
        el("div", { class: "list", id: "list" }),
      ),
    ),
  );
}

function elAddInput(): HTMLElement {
  const input = el("input", { class: "add-input", placeholder: "＋ 添加任务,如「明天9点开会 提前30分钟提醒」" }) as HTMLInputElement;
  input.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") { addTask(input.value); input.value = ""; } });
  return input;
}

async function boot(): Promise<void> {
  setupPWA();
  onStorageError((msg) => toast("⚠️ " + msg, { ms: 12000 }));
  snap = await db.load();
  buildShell();
  try { applyTheme(localStorage.getItem("locado.theme") === "dark"); } catch { /* ignore */ }
  render();
  window.setInterval(tick, 1000);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });
  window.addEventListener("beforeunload", flushSaves);

  // 另一个标签页改了数据时,先读对方最新快照,再把自己的未落盘修改合并进去,
  // 避免拿着旧快照整份写回、把对方刚加的任务覆盖掉。
  let syncTimer: number | null = null;
  window.addEventListener("storage", (e) => {
    if (e.key !== SNAPSHOT_KEY) return;
    if (syncTimer != null) clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      void (async () => {
        const fresh = await db.reload();
        if (pendingSaves.size) {
          for (const t of pendingSaves.values()) {
            const i = fresh.tasks.findIndex((x) => x.id === t.id);
            if (i >= 0) fresh.tasks[i] = t; else fresh.tasks.push(t);
          }
          pendingSaves.clear();
          await db.replaceAll(fresh);
        }
        snap = fresh;
        closeDetail(false);
        render();
        toast("已同步其它标签页的修改", { ms: 2500 });
      })();
    }, 300);
  });
}

boot();
