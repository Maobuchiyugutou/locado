// 中文自然语言快速添加:从一句话里解析出日期、时间、清单、标签、优先级和提醒。
// 纯规则实现,无第三方依赖。属于"尽力而为":解析结果会填进任务,用户可在详情里再改。

import { firstRecurringDue, normalizeRecurrence } from "./recurrence.ts";
import type { Priority, Project, RecurrenceRule, Tag } from "./types.ts";

export type QuickAddPartKind = "date" | "time" | "recurrence" | "project" | "tag" | "priority" | "reminder";
export interface QuickAddPart {
  key: string;
  kind: QuickAddPartKind;
  text: string;
  value?: string;
  fallbackDate?: { text: string; dueDate: number };
}

export interface ParsedTask {
  title: string;
  dueDate: number | null;
  hasTime: boolean;
  reminderMinutesBefore: number | null;
  projectName: string | null;
  tagNames: string[];
  priority: Priority;
  prioritySpecified: boolean;
  recurrence: RecurrenceRule | null;
  parts: QuickAddPart[];
}

const CN: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function cnToNum(s: string): number | null {
  s = s.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (!s) return null;
  if (s === "十") return 10;
  if (s.includes("十")) {
    const [a, b] = s.split("十");
    const tens = a ? (CN[a] ?? 1) : 1;
    const ones = b ? (CN[b] ?? 0) : 0;
    return tens * 10 + ones;
  }
  let n = 0;
  for (const ch of s) { const v = CN[ch]; if (v == null) return null; n = n * 10 + v; }
  return n;
}

const NUM = "[0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3}";

function midnight(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function calendarDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return midnight(d);
}

interface DateHit { date: Date | null; hits: string[]; }
function detectSingleDate(text: string): DateHit {
  const hits: string[] = [];
  const today = () => midnight(new Date());

  for (const [w, off] of [["大后天", 3], ["后天", 2], ["明天", 1], ["明日", 1], ["明晚", 1], ["明早", 1], ["今天", 0], ["今晚", 0], ["今日", 0], ["昨天", -1]] as [string, number][]) {
    if (text.includes(w)) { const d = today(); d.setDate(d.getDate() + off); hits.push(w); return { date: d, hits }; }
  }

  let m = text.match(new RegExp(`(${NUM})\\s*天后`));
  if (m) { const n = cnToNum(m[1]); if (n != null) { const d = today(); d.setDate(d.getDate() + n); hits.push(m[0]); return { date: d, hits }; } }

  m = text.match(/(本|这|下)?\s*(?:个)?\s*月底/);
  if (m) {
    const t = today();
    const d = new Date(t.getFullYear(), t.getMonth() + (m[1] === "下" ? 2 : 1), 0);
    hits.push(m[0]); return { date: midnight(d), hits };
  }

  // 周X / 星期X / 礼拜X(可带 下/本/这)
  m = text.match(/(下|本|这周|这)?\s*(?:周|星期|礼拜)\s*([一二三四五六天日\d])/);
  if (m) {
    const WD: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
    let target = /\d/.test(m[2]) ? Number(m[2]) % 7 : WD[m[2]];
    if (target != null) {
      const base = today(); const cur = base.getDay() || 7;
      target = target || 7;
      let add = (target - cur + 7) % 7;
      if (m[1] === "下") add = 7 - cur + target;
      else if (m[1] === "本" || m[1] === "这" || m[1] === "这周") add = target - cur;
      base.setDate(base.getDate() + add);
      hits.push(m[0]); return { date: base, hits };
    }
  }

  // X年X月X[日号]
  m = text.match(new RegExp(`(\\d{4})\\s*年\\s*(${NUM})\\s*月\\s*(${NUM})\\s*[日号]?`));
  if (m) {
    const mo = cnToNum(m[2]), da = cnToNum(m[3]);
    const d = mo && da ? calendarDate(Number(m[1]), mo, da) : null;
    if (d) { hits.push(m[0]); return { date: d, hits }; }
    return { date: null, hits };
  }

  // X月X[日号]
  m = text.match(new RegExp(`(${NUM})\\s*月\\s*(${NUM})\\s*[日号]`));
  if (m) {
    const mo = cnToNum(m[1]), da = cnToNum(m[2]);
    const t = today();
    if (mo && da) {
      for (let year = t.getFullYear(); year <= t.getFullYear() + 4; year++) {
        const d = calendarDate(year, mo, da);
        if (d && d.getTime() >= t.getTime()) { hits.push(m[0]); return { date: d, hits }; }
      }
    }
    return { date: null, hits };
  }

  // X[日号](仅日)
  m = text.match(new RegExp(`(${NUM})\\s*[日号]`));
  if (m) {
    const da = cnToNum(m[1]);
    const t = today();
    if (da) {
      for (let offset = 0; offset <= 13; offset++) {
        const month = new Date(t.getFullYear(), t.getMonth() + offset, 1);
        const d = calendarDate(month.getFullYear(), month.getMonth() + 1, da);
        if (d && d.getTime() >= t.getTime()) { hits.push(m[0]); return { date: d, hits }; }
      }
    }
    return { date: null, hits };
  }

  return { date: null, hits };
}

const DATE_EXPRESSION = new RegExp([
  "大后天|后天|明天|明日|明晚|明早|今天|今晚|今日|昨天",
  `(?:${NUM})\\s*天后`,
  "(?:本|这|下)?\\s*(?:个)?\\s*月底",
  "(?:下|本|这周|这)?\\s*(?:周|星期|礼拜)\\s*[一二三四五六天日\\d]",
  `\\d{4}\\s*年\\s*(?:${NUM})\\s*月\\s*(?:${NUM})\\s*[日号]?`,
  `(?:${NUM})\\s*月\\s*(?:${NUM})\\s*[日号]`,
  `(?:${NUM})\\s*[日号]`,
].join("|"), "g");

function detectDate(text: string): DateHit {
  // 按文本顺序采用第一个有效日期;后续冲突日期不进入 strip,保留在标题中。
  for (const match of text.matchAll(DATE_EXPRESSION)) {
    const candidate = detectSingleDate(match[0]);
    if (candidate.date) return candidate;
  }
  return { date: null, hits: [] };
}

interface TimeHit { h: number; mi: number; strong: boolean; hits: string[]; }
function detectTime(text: string): TimeHit | null {
  const hits: string[] = [];
  let h: number | null = null, mi = 0, strong = false;

  // 时段词
  let mer: "am" | "pm" | "noon" | null = null;
  for (const [w, v] of [["凌晨", "am"], ["早上", "am"], ["早晨", "am"], ["上午", "am"], ["明早", "am"], ["中午", "noon"], ["下午", "pm"], ["傍晚", "pm"], ["晚上", "pm"], ["今晚", "pm"], ["明晚", "pm"], ["夜里", "pm"]] as [string, "am" | "pm" | "noon"][]) {
    if (text.includes(w)) { mer = v; hits.push(w); break; }
  }

  // HH:MM
  let m = text.match(/([01]?\d|2[0-3])\s*[:：]\s*([0-5]?\d)/);
  if (m) { h = Number(m[1]); mi = Number(m[2]); strong = true; hits.push(m[0]); }
  else {
    m = text.match(new RegExp(`(${NUM})\\s*[点时]\\s*(钟|整)?\\s*(半|(?:${NUM})\\s*分?)?`));
    if (m) {
      h = cnToNum(m[1]); hits.push(m[0]);
      if (/\d/.test(m[1])) strong = true;
      if (m[2]) strong = true; // 点钟 / 点整:明确是时间表述
      const r = m[3];
      if (r === "半") { mi = 30; strong = true; }
      else if (r) { mi = cnToNum(r.replace("分", "").trim()) ?? 0; strong = true; }
    }
  }

  if (h == null) { if (mer === "noon") { return { h: 12, mi: 0, strong: true, hits }; } return null; }

  if (mer === "pm" && h < 12) h += 12;
  else if ((mer === "am") && h === 12) h = 0;
  else if (mer === "noon") h = 12;
  if (mer) strong = true;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, mi, strong, hits };
}

interface RemHit { min: number | null; hits: string[]; }
function detectReminder(text: string): RemHit {
  const hits: string[] = [];
  let min: number | null = null;

  const m = text.match(new RegExp(`提前\\s*(半|${NUM})\\s*(个)?\\s*(小时|钟头|分钟|分|天)`));
  if (m) {
    const val = m[1] === "半" ? 0.5 : (cnToNum(m[1]) ?? 0);
    const unit = m[3];
    min = unit.includes("小时") || unit === "钟头" ? Math.round(val * 60) : unit === "天" ? Math.round(val * 1440) : Math.round(val);
    hits.push(m[0]);
  }
  // 提醒 / 准时 / 到点
  const mr = text.match(/(准时提醒|到点提醒|提醒我|提醒一下|提醒)/);
  if (mr) { hits.push(mr[0]); if (min == null) min = 0; }
  return { min, hits };
}

interface ProjectHit { name: string | null; hit: string | null; }
function detectProject(text: string): ProjectHit {
  const m = text.match(/(?:^|\s)(#[\p{L}\p{N}_-]+)/u);
  return { name: m ? m[1].slice(1) : null, hit: m?.[1] ?? null };
}

interface TagsHit { names: string[]; hits: string[]; }
function detectTags(text: string): TagsHit {
  const names = new Set<string>();
  const hits: string[] = [];
  for (const m of text.matchAll(/(?:^|\s)(@[\p{L}\p{N}_-]+)/gu)) {
    names.add(m[1].slice(1)); hits.push(m[1]);
  }
  return { names: [...names], hits };
}

interface PriorityHit { value: Priority; hit: string | null; }
function detectPriority(text: string): PriorityHit {
  const m = text.match(/(高|中|低|无)\s*优先级|优先级\s*[:：]?\s*(高|中|低|无)/);
  if (!m) return { value: 0, hit: null };
  const values: Record<string, Priority> = { 高: 5, 中: 3, 低: 1, 无: 0 };
  return { value: values[m[1] ?? m[2]], hit: m[0] };
}

interface RecurrenceHit {
  rule: RecurrenceRule | null;
  hit: string | null;
  fallbackText?: string;
  multiple: boolean;
  blocked: string[];
}

function detectRecurrence(text: string): RecurrenceHit {
  const hits: { rule: RecurrenceRule; hit: string; fallbackText?: string }[] = [];
  const blocked: string[] = [];
  const collect = (pattern: RegExp, build: (m: RegExpMatchArray) => { rule: RecurrenceRule; fallbackText?: string } | null) => {
    for (const m of text.matchAll(pattern)) {
      const result = build(m);
      if (result) hits.push({ rule: result.rule, hit: m[0], fallbackText: result.fallbackText });
    }
  };

  collect(new RegExp(`完成后\\s*(${NUM})\\s*天`, "g"), (m) => {
    const rule = normalizeRecurrence({ kind: "afterCompletion", days: cnToNum(m[1]) });
    return rule ? { rule } : null;
  });
  collect(new RegExp(`每年\\s*(${NUM})\\s*月\\s*(${NUM})\\s*[日号]`, "g"), (m) => {
    const month = cnToNum(m[1]), day = cnToNum(m[2]);
    const rule = normalizeRecurrence({ kind: "yearly", month, day });
    return rule ? { rule, fallbackText: `${m[1]}月${m[2]}${m[0].slice(-1)}` } : null;
  });
  collect(/每月(?:最后一天|月末)|(?<!每)月末/g, () => ({ rule: { kind: "monthly", day: "last" } }));
  collect(new RegExp(`每月\\s*(${NUM})\\s*([日号])`, "g"), (m) => {
    const day = cnToNum(m[1]);
    const rule = normalizeRecurrence({ kind: "monthly", day });
    return rule ? { rule, fallbackText: `${m[1]}${m[2]}` } : null;
  });
  collect(/每(?:周|星期|礼拜)\s*([一二三四五六天日](?:(?:\s*[、,，]\s*)(?:周|星期|礼拜)?\s*[一二三四五六天日])*)/g, (m) => {
    const next = text[(m.index ?? 0) + m[0].length];
    if (next && /[一二三四五六天日]/.test(next)) { blocked.push(m[0]); return null; }
    const names: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
    const parts = m[1].split(/\s*[、,，]\s*/).map((part) => part.replace(/^(?:周|星期|礼拜)\s*/, ""));
    const weekdays = parts.map((part) => names[part]).filter((day): day is number => day != null);
    const rule = normalizeRecurrence({ kind: "weekly", weekdays });
    return rule ? { rule, fallbackText: weekdays.length === 1 ? `周${parts[0]}` : undefined } : null;
  });
  collect(/每天|每日/g, () => ({ rule: { kind: "daily" } }));

  if (hits.length !== 1) return { rule: null, hit: null, multiple: hits.length > 1, blocked };
  return { ...hits[0], multiple: false, blocked };
}

export function parseTask(input: string): ParsedTask {
  const text = input.trim();
  const strip: string[] = [];

  const recurrence = detectRecurrence(text);
  let dateText = recurrence.hit ? text.replace(recurrence.hit, "") : text;
  for (const blocked of recurrence.blocked) dateText = dateText.replace(blocked, "");
  const dt = recurrence.multiple ? { date: null, hits: [] } : detectDate(dateText);
  if (dt.date) strip.push(...dt.hits);
  if (recurrence.hit) strip.push(recurrence.hit);
  const tmRaw = detectTime(text);
  const rm = detectReminder(text);
  const project = detectProject(text);
  const tags = detectTags(text);
  const priority = detectPriority(text);
  if (project.hit) strip.push(project.hit);
  strip.push(...tags.hits);
  if (priority.hit) strip.push(priority.hit);

  // 弱时间(纯中文「X点」无后缀/时段)只有在有日期时才采信,避免「有一点问题」误判
  const useTime = tmRaw && (tmRaw.strong || !!dt.date || !!recurrence.rule);
  if (useTime && tmRaw) strip.push(...tmRaw.hits);
  if (rm.min != null) strip.push(...rm.hits);

  let dueDate: number | null = null;
  let hasTime = false;
  if (dt.date || recurrence.rule || useTime) {
    const firstDue = recurrence.rule ? firstRecurringDue(recurrence.rule, midnight(new Date()).getTime()) : null;
    const base = dt.date ? new Date(dt.date) : firstDue != null ? new Date(firstDue) : midnight(new Date());
    if (useTime && tmRaw) { base.setHours(tmRaw.h, tmRaw.mi, 0, 0); hasTime = true; }
    else base.setHours(9, 0, 0, 0);
    dueDate = base.getTime();
  }

  let reminderMinutesBefore: number | null = rm.min;
  // 只说了提醒但没日期没时间 → 无意义,置空
  if (reminderMinutesBefore != null && dueDate == null) reminderMinutesBefore = null;

  // 剥离命中词(长的先删,避免子串残留)
  let title = text;
  for (const s of [...new Set(strip)].sort((a, b) => b.length - a.length)) {
    if (s) title = title.replace(s, "");
  }
  title = title
    .replace(/(在|于|到|,|，|。|、|的)+\s*$/g, "")
    .replace(/^\s*(,|，|。|、)+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!title) title = text;

  const parts: QuickAddPart[] = [];
  if (dt.date) parts.push({ key: "date", kind: "date", text: dt.hits.join(" ") });
  if (useTime && tmRaw) parts.push({ key: "time", kind: "time", text: tmRaw.hits.join(" ") });
  if (recurrence.rule && recurrence.hit) {
    const part: QuickAddPart = { key: "recurrence", kind: "recurrence", text: recurrence.hit };
    if (recurrence.fallbackText) {
      const fallback = detectDate(recurrence.fallbackText);
      if (fallback.date) part.fallbackDate = { text: fallback.hits.join(" "), dueDate: fallback.date.getTime() };
    }
    parts.push(part);
  }
  if (project.hit && project.name) parts.push({ key: "project", kind: "project", text: project.hit, value: project.name });
  for (const name of tags.names) parts.push({ key: `tag:${name}`, kind: "tag", text: `@${name}`, value: name });
  if (priority.hit) parts.push({ key: "priority", kind: "priority", text: priority.hit });
  if (reminderMinutesBefore != null) parts.push({ key: "reminder", kind: "reminder", text: rm.hits.join(" ") });

  return {
    title,
    dueDate,
    hasTime,
    reminderMinutesBefore,
    projectName: project.name,
    tagNames: tags.names,
    priority: priority.value,
    prioritySpecified: priority.hit !== null,
    recurrence: recurrence.rule,
    parts,
  };
}

export function applyQuickAddCorrections(parsed: ParsedTask, ignoredKeys: ReadonlySet<string>): ParsedTask {
  const ignored = parsed.parts.filter((part) => ignoredKeys.has(part.key));
  if (!ignored.length) return parsed;

  const next: ParsedTask = {
    ...parsed,
    recurrence: ignoredKeys.has("recurrence") ? null : parsed.recurrence,
    tagNames: parsed.tagNames.filter((name) => !ignoredKeys.has(`tag:${name}`)),
    parts: parsed.parts.filter((part) => !ignoredKeys.has(part.key)),
  };
  const recurrencePart = parsed.parts.find((part) => part.kind === "recurrence");
  const fallback = recurrencePart?.fallbackDate;
  const restoreFallback = !!fallback && ignoredKeys.has("recurrence") && !ignoredKeys.has("date")
    && !next.parts.some((part) => part.kind === "date");
  if (restoreFallback && fallback) {
    next.parts.unshift({ key: "date", kind: "date", text: fallback.text });
  }

  const hasDate = next.parts.some((part) => part.kind === "date");
  const hasTime = next.parts.some((part) => part.kind === "time");
  const previous = parsed.dueDate != null ? new Date(parsed.dueDate) : null;
  const blockTimeOnlyDate = ignoredKeys.has("recurrence") && !fallback && !hasDate;
  let base: number | null = null;
  if (hasDate) base = restoreFallback && fallback ? fallback.dueDate : parsed.dueDate;
  else if (next.recurrence) base = firstRecurringDue(next.recurrence, midnight(new Date()).getTime());
  else if (hasTime && !blockTimeOnlyDate) base = midnight(new Date()).getTime();

  if (base != null) {
    const date = new Date(base);
    if (hasTime && previous) {
      date.setHours(previous.getHours(), previous.getMinutes(), 0, 0);
      next.hasTime = true;
    } else {
      date.setHours(9, 0, 0, 0);
      next.hasTime = false;
    }
    next.dueDate = date.getTime();
  } else {
    next.dueDate = null;
    next.hasTime = false;
  }

  if (ignoredKeys.has("project")) next.projectName = null;
  if (ignoredKeys.has("priority")) { next.priority = 0; next.prioritySpecified = false; }
  if (ignoredKeys.has("reminder") || next.dueDate == null) next.reminderMinutesBefore = null;
  if (next.reminderMinutesBefore == null) next.parts = next.parts.filter((part) => part.kind !== "reminder");

  const titleParts = [parsed.title];
  for (const part of ignored) {
    const text = part.kind === "recurrence" && part.fallbackDate ? part.fallbackDate.text : part.text;
    if (text && !titleParts.join(" ").includes(text)) titleParts.push(text);
  }
  next.title = titleParts.join(" ").replace(/\s{2,}/g, " ").trim();
  return next;
}

export interface ResolvedQuickAddMetadata {
  projectId: string | null;
  tagIds: string[];
  missingProject: string | null;
  missingTags: string[];
}

function nameKey(name: string): string { return name.trim().toLocaleLowerCase(); }

export function resolveQuickAddMetadata(
  projectName: string | null,
  tagNames: string[],
  projects: Project[],
  tags: Tag[],
): ResolvedQuickAddMetadata {
  const project = projectName ? projects.find((p) => nameKey(p.name) === nameKey(projectName)) : undefined;
  const tagIds: string[] = [];
  const missingTags: string[] = [];
  for (const name of tagNames) {
    const tag = tags.find((t) => nameKey(t.name) === nameKey(name));
    if (tag) { if (!tagIds.includes(tag.id)) tagIds.push(tag.id); }
    else missingTags.push(name);
  }
  return {
    projectId: project?.id ?? null,
    tagIds,
    missingProject: projectName && !project ? projectName : null,
    missingTags,
  };
}
