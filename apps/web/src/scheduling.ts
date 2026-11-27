import type { Task, Schedule } from "./data/tasks.ts";
import { overlaps, validDay } from "../../../modules/tasks/index.ts";
export function localDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function sameSchedule(a?: Schedule, b?: Schedule) {
  return (
    JSON.stringify(a ?? { kind: "unscheduled" }) ===
    JSON.stringify(b ?? { kind: "unscheduled" })
  );
}
export function scheduleLabel(s: Schedule = { kind: "unscheduled" }) {
  switch (s.kind) {
    case "unscheduled":
      return "未定日期";
    case "recent":
      return "近期完成";
    case "day":
      return s.date;
    case "deadline":
      return "截止 " + s.date;
    case "range":
      return s.start + " — " + s.end;
  }
}
export function completionDay(task: Task) {
  return task.completedAt ? localDay(new Date(task.completedAt)) : null;
}
export function inPeriod(task: Task, month: string, day: string) {
  if (!month && !day) return true;
  const completed = task.status === "completed" ? completionDay(task) : null;
  if (completed) return day ? completed === day : completed.startsWith(month);
  const s = task.schedule ?? { kind: "unscheduled" };
  if (s.kind === "unscheduled" || s.kind === "recent") return false;
  const start = day || month + "-01";
  const end =
    day ||
    month +
      "-" +
      new Date(
        Number(month.slice(0, 4)),
        Number(month.slice(5, 7)),
        0,
      ).getDate();
  return validDay(start) && validDay(end) && overlaps(s, start, end);
}
export function groupTasks(tasks: Task[], today = localDay()) {
  const groups = new Map<
    string,
    { label: string; tasks: Task[]; sort: string }
  >();
  for (const task of tasks) {
    const completed = task.status === "completed" ? completionDay(task) : null;
    const s = task.schedule;
    const overdue =
      task.status === "pending" && s.kind === "deadline" && s.date < today;
    const todayGroup = task.status === "pending" && inPeriod(task, "", today);
    const label = completed
      ? "完成于 " + completed
      : overdue
        ? "已过截止"
        : todayGroup
          ? "今天"
          : scheduleLabel(s);
    const sort = completed
      ? "0-" + String(99_999_999 - Number(completed.replaceAll("-", "")))
      : overdue
        ? "1"
        : todayGroup
          ? "2"
          : s.kind === "unscheduled"
            ? "6"
            : s.kind === "recent"
              ? "4"
              : (s.kind === "range" ? s.start : "date" in s ? s.date : "") <=
                  today
                ? "3" + label
                : "5" + label;
    const group = groups.get(label) ?? { label, tasks: [], sort };
    group.tasks.push(task);
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => a.sort.localeCompare(b.sort));
}
