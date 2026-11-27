/** Task view model and user intents over the one entity stream. */
import { useMemo } from "react";
import {
  fromSchedule,
  outstandingPrerequisites,
  toSchedule,
  type Schedule,
} from "../../../../modules/tasks/index.ts";
import type {
  AnyEntity,
  EntityData,
} from "../../../../packages/contracts/entities.ts";
import { database, project, type Pending } from "./db.ts";
import { useEntities, usePending } from "./entities.ts";
import { enqueue as write, settle, undoPending } from "./sync.ts";

export type { Schedule };
export type Task = {
  id: string;
  title: string;
  status: "pending" | "completed" | "discarded";
  version: number;
  schedule: Schedule;
  createdAt?: string;
  completedAt?: string;
  note: string;
  scheduleTime: string;
  listId: string;
  prerequisiteIds: string[];
};
export type TaskAction =
  "create" | "rename" | "complete" | "discard" | "reopen" | "schedule" | "edit";
export type TaskDetails = Pick<
  Task,
  "note" | "listId" | "prerequisiteIds" | "scheduleTime"
>;
export type TaskPending = Omit<Pending, "server"> & { server?: Task | null };

export function toTask(entity: AnyEntity): Task {
  const data = entity.data as EntityData<"task">;
  return {
    id: entity.id,
    title: data.title,
    status: data.status,
    version: entity.version,
    schedule: toSchedule(data),
    createdAt: data.createdAt,
    completedAt: data.completedAt,
    note: data.note ?? "",
    scheduleTime: data.scheduleTime ?? "",
    listId: data.listId ?? "",
    prerequisiteIds: data.prerequisiteIds ?? [],
  };
}

export function useTasks(): { tasks: Task[]; pending: TaskPending[] } {
  const { entities } = useEntities("task");
  const all = usePending();
  const tasks = useMemo(() => entities.map(toTask), [entities]);
  const pending = useMemo(
    () =>
      all
        .filter((op) => op.entityType === "task")
        .map((op) => ({
          ...op,
          server: op.server ? toTask(op.server) : op.server,
        })),
    [all],
  );
  return { tasks, pending };
}

async function currentTask(id: string) {
  const db = await database;
  const current = project(
    await db.get("confirmed", id),
    (await db.getAllFromIndex("pending", "entityId", id)).sort(
      (a, b) => a.sequence - b.sequence,
    ),
  );
  return current?.type === "task" && !current.deleted
    ? (current.data as EntityData<"task">)
    : undefined;
}

export async function editDependency(
  from: string,
  to: string,
  remove: boolean,
) {
  const current = await currentTask(to);
  if (!current || current.status !== "pending")
    throw new Error("只能调整待完成任务的连线");
  const before = current.prerequisiteIds ?? [];
  if (before.includes(from) === !remove) return;
  const prerequisiteIds = remove
    ? before.filter((id) => id !== from)
    : [...before, from];
  await write("task", to, "put", { ...current, prerequisiteIds });
}

/** Apply one user intent to the task as this device currently sees it. */
export async function enqueue(
  action: TaskAction,
  id: string,
  title?: string,
  schedule?: Schedule,
  details?: Partial<TaskDetails>,
) {
  const current = await currentTask(id);
  if (!current && action !== "create") throw new Error("这件事已经不在本机");
  if (action === "complete" && current) {
    const db = await database;
    if (current.status === "discarded") throw new Error("请先恢复待办");
    for (const key of current.prerequisiteIds ?? []) {
      const parent = project(
        await db.get("confirmed", key),
        (await db.getAllFromIndex("pending", "entityId", key)).sort(
          (a, b) => a.sequence - b.sequence,
        ),
      );
      if (!parent || parent.deleted || toTask(parent).status !== "completed")
        throw new Error("请先完成前置任务");
    }
  }
  const now = new Date().toISOString();
  const base: EntityData<"task"> = current ?? {
    title: title!,
    status: "pending",
    scheduleKind: "unscheduled",
    createdAt: now,
  };
  const {
    scheduleKind: _kind,
    scheduleDate: _date,
    scheduleStart: _start,
    scheduleEnd: _end,
    ...rest
  } = base;
  const next: EntityData<"task"> = {
    ...rest,
    ...details,
    ...fromSchedule(
      action === "create" || action === "schedule" || action === "edit"
        ? (schedule ?? { kind: "unscheduled" })
        : toSchedule(base),
    ),
    title:
      action === "create" || action === "rename" || action === "edit"
        ? title!.trim()
        : base.title,
    status:
      action === "complete"
        ? "completed"
        : action === "discard"
          ? "discarded"
          : action === "reopen"
            ? "pending"
            : base.status,
  };
  if (action === "complete" && base.status !== "completed")
    next.completedAt = now;
  await write("task", id, "put", next);
}
export function taskBlockers(tasks: Task[]) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return new Map(
    tasks.map((task) => [task.id, outstandingPrerequisites(task, byId)]),
  );
}

export const undo = undoPending;
export const resolve = settle;
