export type TaskStatus = "pending" | "completed" | "discarded";
export type Task = Readonly<{
  id: string;
  title: string;
  status: TaskStatus;
  version: number;
}>;
export type TaskAction = "complete" | "reopen" | "discard";
// Pure state transition. Persistence, actor permissions and operation deduplication belong to the application layer.
export function transitionTask(
  task: Task,
  action: TaskAction,
  expectedVersion: number,
): Task {
  if (task.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
  const status: TaskStatus =
    action === "complete"
      ? "completed"
      : action === "discard"
        ? "discarded"
        : "pending";
  if (!["complete", "discard", "reopen"].includes(action))
    throw new Error("INVALID_ACTION");
  if (status === task.status) return task;
  if (task.status === "discarded" && action === "complete")
    throw new Error("REOPEN_REQUIRED");
  return { ...task, status, version: task.version + 1 };
}

type Lifecycle = {
  status: TaskStatus;
  createdAt?: string;
  completedAt?: string;
};
/**
 * Server-owned lifecycle facts of a task write.
 * Creation time never changes. The completion instant is recorded when the task
 * first becomes completed and is kept as history afterwards: re-planning or
 * re-saving a completed task cannot rewrite when it was actually done.
 */
export function settleLifecycle<T extends Lifecycle>(
  next: T,
  current: Lifecycle | null,
  occurredAt: string,
): T {
  if (current?.status === "discarded" && next.status === "completed")
    throw new Error("REOPEN_REQUIRED");
  const createdAt = current
    ? current.createdAt
    : (next.createdAt ?? occurredAt);
  const completedAt =
    next.status === "completed" && current?.status !== "completed"
      ? (next.completedAt ?? occurredAt)
      : current?.completedAt;
  const settled = { ...next, createdAt, completedAt };
  if (createdAt === undefined) delete settled.createdAt;
  if (completedAt === undefined) delete settled.completedAt;
  return settled;
}
