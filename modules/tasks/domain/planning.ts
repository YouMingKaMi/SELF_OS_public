import type { Schedule } from "./schedule.ts";
import type { TaskStatus } from "./task.ts";

export type PlannedTask = {
  id: string;
  status: TaskStatus;
  listId: string;
  schedule: Schedule;
  prerequisiteIds: readonly string[];
};

export function outstandingPrerequisites(
  task: PlannedTask,
  byId: ReadonlyMap<string, PlannedTask>,
): string[] {
  return task.prerequisiteIds.filter(
    (id) => byId.get(id)?.status !== "completed",
  );
}

export function isNextTask(
  task: PlannedTask,
  byId: ReadonlyMap<string, PlannedTask>,
  today: string,
): boolean {
  if (task.status !== "pending" || outstandingPrerequisites(task, byId).length)
    return false;
  const schedule = task.schedule;
  if (schedule.kind === "day") return schedule.date <= today;
  if (schedule.kind === "range") return schedule.start <= today;
  return true;
}

/** A candidate is invalid if following its own prerequisites leads back to this task. */
export function reachesTask(
  start: string,
  target: string,
  prerequisites: (id: string) => readonly string[],
): boolean {
  const stack = [start];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...prerequisites(id));
  }
  return false;
}
