import type { AnyEntity as Entity } from "../data/entities.ts";

const weekdays = ["0", "1", "2", "3", "4", "5", "6"];
const newest = (a: Entity, b: Entity) =>
  Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.version - a.version ||
  a.id.localeCompare(b.id);

export function habitRule(habit: Entity, day: string, all: Entity[]) {
  return all.filter((e) => e.type === "habitRule" && !e.deleted &&
    e.data.habitId === habit.id && typeof e.data.effectiveFrom === "string" && e.data.effectiveFrom <= day)
    .sort((a, b) => String(b.data.effectiveFrom).localeCompare(String(a.data.effectiveFrom)) ||
      newest(a, b))[0];
}

export function latestHabitLogs(habitId: string, all: Entity[]) {
  const byDay = new Map<string, Entity>();
  for (const row of all) {
    if (row.type !== "habitLog" || row.deleted || row.data.habitId !== habitId ||
        typeof row.data.day !== "string") continue;
    const current = byDay.get(row.data.day);
    if (!current || newest(row, current) < 0) byDay.set(row.data.day, row);
  }
  return byDay;
}

export function habitWeekdays(rule: Entity | undefined) {
  return Array.isArray(rule?.data.weekdays) ? rule.data.weekdays : weekdays;
}

export function habitScheduled(rule: Entity | undefined, day: string) {
  const weekday = new Date(day + "T12:00:00Z").getUTCDay();
  return habitWeekdays(rule).includes(String(weekday));
}

export function habitTarget(rule: Entity | undefined) {
  const target = Number(rule?.data.target);
  return Number.isFinite(target) && target > 0 ? target : 1;
}

export function habitDone(habit: Entity, log: Entity | undefined, rule: Entity | undefined) {
  if (!log) return false;
  switch (rule?.data.kind ?? habit.data.kind) {
    case "binary":
      return Number(log.data.value) > 0;
    case "checklist": {
      const items = rule?.data.items ?? habit.data.items;
      const checked = log.data.items;
      return Array.isArray(items) && items.length > 0 && Array.isArray(checked) &&
        items.every((item) => checked.includes(item));
    }
    default:
      return Number(log.data.value) >= habitTarget(rule);
  }
}
