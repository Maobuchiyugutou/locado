export type FocusMode = "idle" | "work" | "break";

export interface FocusState {
  mode: FocusMode;
  running: boolean;
  remaining: number;
  total: number;
  endsAt: number;
  startedAt: number;
  taskId: string | null;
  sessionId: string;
}

export const FOCUS_STORAGE_KEY = "locado.focus.v1";

export function idleFocus(total: number): FocusState {
  return { mode: "idle", running: false, remaining: total, total, endsAt: 0, startedAt: 0, taskId: null, sessionId: "" };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parseFocusState(raw: string | null, now: number, workTotal: number, breakTotal: number): FocusState {
  if (!raw) return idleFocus(workTotal);
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return idleFocus(workTotal);
    const state = value as Partial<FocusState>;
    if (state.mode !== "work" && state.mode !== "break") return idleFocus(workTotal);

    const fallbackTotal = state.mode === "work" ? workTotal : breakTotal;
    const savedTotal = finite(state.total, fallbackTotal);
    const total = savedTotal > 0 ? Math.round(savedTotal) : fallbackTotal;
    const startedAt = Math.max(0, finite(state.startedAt, 0));
    let endsAt = Math.max(0, finite(state.endsAt, 0));
    let running = state.running === true && endsAt > 0;
    let remaining = Math.min(total, Math.max(0, Math.round(finite(state.remaining, total))));
    if (running) remaining = Math.min(total, Math.max(0, Math.round((endsAt - now) / 1000)));
    if (!running) endsAt = 0;

    return {
      mode: state.mode,
      running,
      remaining,
      total,
      endsAt,
      startedAt,
      taskId: typeof state.taskId === "string" && state.taskId ? state.taskId : null,
      sessionId: typeof state.sessionId === "string" ? state.sessionId : startedAt ? `legacy-${startedAt}` : "",
    };
  } catch {
    return idleFocus(workTotal);
  }
}

export function serializeFocusState(state: FocusState): string {
  return JSON.stringify(state);
}

export function focusRecordId(state: FocusState): string | null {
  const id = state.sessionId || (state.startedAt ? `legacy-${state.startedAt}` : "");
  return id ? `focus-${id}` : null;
}
