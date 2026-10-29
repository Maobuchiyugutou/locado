// 数据模型 —— 对齐滴答清单的核心概念,但保持精简、可本地化。
// priority 沿用滴答的取值:0 无 / 1 低 / 3 中 / 5 高(便于将来导入数据对齐)。

export type Priority = 0 | 1 | 3 | 5;

export interface Project {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  note: string;
  priority: Priority;
  important?: boolean; // 四象限手工分类;缺省时按原优先级映射
  urgent?: boolean;
  completed: boolean;
  completedAt: number | null;
  dueDate: number | null; // epoch ms;null 表示无日期
  hasTime?: boolean; // dueDate 是否带具体时刻(否则按全天)
  reminderMinutesBefore?: number | null; // 提前多少分钟提醒;0=准时;null=不提醒
  reminded?: boolean; // 本次提醒是否已触发(避免重复弹)
  pinned: boolean;
  tags: string[]; // tag id 列表
  subtasks: Subtask[];
  createdAt: number;
  updatedAt: number;
}

// 自定义智能清单(筛选器):按条件自动聚合任务。对应滴答会员的"自定义清单/筛选器"。
export type DueFilter = "any" | "overdue" | "today" | "next7" | "nodate";
export interface FilterRule {
  projectIds: string[];
  tagIds: string[];
  priorities: Priority[];
  due: DueFilter;
}
export interface Filter {
  id: string;
  name: string;
  color: string;
  rule: FilterRule;
}

// 习惯打卡:每天可打卡一次,checkins 存已打卡的日期键(dayKey)。
export interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string;
  checkins: string[];
  sortOrder: number;
  createdAt: number;
}

// 番茄钟专注记录(每完成一个专注番茄记一条)。
export interface FocusRecord {
  id: string;
  startedAt: number;
  minutes: number;
  taskId: string | null;
}

// 整个应用的持久化数据快照(本地存储实现用它,Tauri/SQLite 版按表拆分)。
export interface Snapshot {
  projects: Project[];
  tags: Tag[];
  tasks: Task[];
  filters: Filter[];
  habits: Habit[];
  focusRecords: FocusRecord[];
}

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  5: { label: "高", color: "var(--p-high)" },
  3: { label: "中", color: "var(--p-mid)" },
  1: { label: "低", color: "var(--p-low)" },
  0: { label: "无", color: "var(--p-none)" },
};

// 预设清单/筛选器/习惯配色
export const PROJECT_COLORS = [
  "#e5484d", "#f76808", "#ffb224", "#30a46c",
  "#0091ff", "#3e63dd", "#8e4ec6", "#d6409f",
  "#6e7681",
];

export const HABIT_ICONS = ["💧", "🏃", "📖", "🧘", "💊", "🌙", "🍎", "✍️", "🎯", "☀️"];
