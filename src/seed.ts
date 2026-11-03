import { CURRENT_SCHEMA_VERSION } from "./migrations.ts";
import type { Snapshot, Task } from "./types.ts";

export const INBOX_ID = "inbox";

function now(): number { return Date.now(); }

function daysFromNow(d: number): number {
  const dt = new Date();
  dt.setHours(9, 0, 0, 0);
  dt.setDate(dt.getDate() + d);
  return dt.getTime();
}

// 与 main.ts 的 dayKey 保持一致:年-月(0基)-日
function dayKeyAgo(back: number): string {
  const d = new Date();
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// 首次启动的示例数据,帮助理解界面;用户可随意删除。
export function defaultSnapshot(): Snapshot {
  const t = now();
  const mk = (over: Partial<Task>): Task => ({
    id: Math.random().toString(36).slice(2, 10),
    projectId: INBOX_ID,
    title: "",
    note: "",
    priority: 0,
    completed: false,
    completedAt: null,
    dueDate: null,
    pinned: false,
    tags: [],
    subtasks: [],
    createdAt: t,
    updatedAt: t,
    ...over,
  });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projects: [
      { id: INBOX_ID, name: "收集箱", color: "#3e63dd", sortOrder: 0, createdAt: t },
      { id: "work", name: "工作", color: "#e5484d", sortOrder: 1, createdAt: t },
      { id: "life", name: "生活", color: "#30a46c", sortOrder: 2, createdAt: t },
    ],
    tags: [
      { id: "urgent", name: "紧急", color: "#e5484d" },
      { id: "read", name: "阅读", color: "#8e4ec6" },
    ],
    filters: [
      { id: "important", name: "重要任务", color: "#f76808", rule: { projectIds: [], tagIds: [], priorities: [5, 3], due: "any" } },
    ],
    habits: [
      { id: "water", name: "喝 8 杯水", icon: "💧", color: "#0091ff", sortOrder: 0, createdAt: t, checkins: [dayKeyAgo(2), dayKeyAgo(1), dayKeyAgo(0)] },
      { id: "run", name: "运动 30 分钟", icon: "🏃", color: "#30a46c", sortOrder: 1, createdAt: t, checkins: [dayKeyAgo(3), dayKeyAgo(1)] },
      { id: "read", name: "阅读", icon: "📖", color: "#8e4ec6", sortOrder: 2, createdAt: t, checkins: [dayKeyAgo(1)] },
    ],
    focusRecords: [],
    tasks: [
      mk({
        title: "欢迎使用 Locado 👋",
        note: "这是一个完全本地、数据归你所有的待办工具。\n点击任务可在右侧编辑详情、子任务和标签。",
        priority: 3,
        dueDate: daysFromNow(0),
        subtasks: [
          { id: "s1", title: "试着新建一个任务", completed: false },
          { id: "s2", title: "去「习惯」打个卡、用「专注」计个番茄钟", completed: false },
          { id: "s3", title: "拖动任务可以手动排序", completed: true },
        ],
      }),
      mk({ projectId: "work", title: "整理本周工作计划", priority: 5, dueDate: daysFromNow(1), tags: ["urgent"] }),
      mk({ projectId: "work", title: "回复合作邮件", priority: 1, dueDate: daysFromNow(2) }),
      mk({ projectId: "life", title: "读完《深度工作》第 3 章", tags: ["read"], dueDate: daysFromNow(4) }),
      mk({ projectId: "life", title: "周末采购清单", dueDate: daysFromNow(3) }),
    ],
  };
}
