/** Task view model and user intents over the one entity stream. */
import { useMemo } from "react";
import {
  fromSchedule,
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
};
export type TaskAction =
  "create" | "rename" | "complete" | "discard" | "reopen" | "schedule";
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

/** Apply one user intent to the task as this device currently sees it. */
export async function enqueue(
  action: TaskAction,
  id: string,
  title?: string,
  schedule?: Schedule,
) {
  const db = await database;
  const current = project(
    await db.get("confirmed", id),
    (await db.getAllFromIndex("pending", "entityId", id)).sort(
      (a, b) => a.sequence - b.sequence,
    ),
  )?.data as EntityData<"task"> | undefined;
  if (!current && action !== "create") throw new Error("这件事已经不在本机");
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
    ...fromSchedule(
      action === "create" || action === "schedule"
        ? (schedule ?? { kind: "unscheduled" })
        : toSchedule(base),
    ),
    title:
      action === "create" || action === "rename" ? title!.trim() : base.title,
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
export const undo = undoPending;
export const resolve = settle;
