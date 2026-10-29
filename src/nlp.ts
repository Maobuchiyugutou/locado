// 中文自然语言快速添加:从一句话里解析出日期、时间、提醒,并剥离出干净标题。
// 纯规则实现,无第三方依赖。属于"尽力而为":解析结果会填进任务,用户可在详情里再改。

export interface ParsedTask {
  title: string;
  dueDate: number | null;
  hasTime: boolean;
  reminderMinutesBefore: number | null;
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

interface DateHit { date: Date | null; hits: string[]; }
function detectDate(text: string): DateHit {
  const hits: string[] = [];
  const today = () => midnight(new Date());

  for (const [w, off] of [["大后天", 3], ["后天", 2], ["明天", 1], ["明日", 1], ["今天", 0], ["今晚", 0], ["今日", 0], ["昨天", -1]] as [string, number][]) {
    if (text.includes(w)) { const d = today(); d.setDate(d.getDate() + off); hits.push(w); return { date: d, hits }; }
  }

  let m = text.match(new RegExp(`(${NUM})\\s*天后`));
  if (m) { const n = cnToNum(m[1]); if (n != null) { const d = today(); d.setDate(d.getDate() + n); hits.push(m[0]); return { date: d, hits }; } }

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

  // X月X[日号]
  m = text.match(new RegExp(`(${NUM})\\s*月\\s*(${NUM})\\s*[日号]`));
  if (m) {
    const mo = cnToNum(m[1]), da = cnToNum(m[2]);
    if (mo && da) { const t = today(); const d = new Date(t.getFullYear(), mo - 1, da); if (d.getTime() < t.getTime()) d.setFullYear(d.getFullYear() + 1); hits.push(m[0]); return { date: midnight(d), hits }; }
  }

  // X[日号](仅日)
  m = text.match(new RegExp(`(${NUM})\\s*[日号]`));
  if (m) {
    const da = cnToNum(m[1]);
    if (da && da >= 1 && da <= 31) { const t = today(); const d = new Date(t.getFullYear(), t.getMonth(), da); if (d.getTime() < t.getTime()) d.setMonth(d.getMonth() + 1); hits.push(m[0]); return { date: midnight(d), hits }; }
  }

  return { date: null, hits };
}

interface TimeHit { h: number; mi: number; strong: boolean; hits: string[]; }
function detectTime(text: string): TimeHit | null {
  const hits: string[] = [];
  let h: number | null = null, mi = 0, strong = false;

  // 时段词
  let mer: "am" | "pm" | "noon" | null = null;
  for (const [w, v] of [["凌晨", "am"], ["早上", "am"], ["早晨", "am"], ["上午", "am"], ["中午", "noon"], ["下午", "pm"], ["傍晚", "pm"], ["晚上", "pm"], ["今晚", "pm"], ["夜里", "pm"]] as [string, "am" | "pm" | "noon"][]) {
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
  if (h < 0 || h > 23) return null;
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

export function parseTask(input: string): ParsedTask {
  const text = input.trim();
  const strip: string[] = [];

  const dt = detectDate(text);
  if (dt.date) strip.push(...dt.hits);
  const tmRaw = detectTime(text);
  const rm = detectReminder(text);

  // 弱时间(纯中文「X点」无后缀/时段)只有在有日期时才采信,避免「有一点问题」误判
  const useTime = tmRaw && (tmRaw.strong || !!dt.date);
  if (useTime && tmRaw) strip.push(...tmRaw.hits);
  if (rm.min != null) strip.push(...rm.hits);

  let dueDate: number | null = null;
  let hasTime = false;
  if (dt.date || useTime) {
    const base = dt.date ? new Date(dt.date) : midnight(new Date());
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

  return { title, dueDate, hasTime, reminderMinutesBefore };
}
