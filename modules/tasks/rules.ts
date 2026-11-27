import type { Rules } from "../kernel/index.ts";
import { fromSchedule, toSchedule } from "./domain/schedule.ts";
import { settleLifecycle } from "./domain/task.ts";
import { checklistItems, reconcileChecklistItems, runState, runFields } from "./domain/checklist.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const maxPrerequisites = 40;

export const rules: Rules = {
  checklist: {
    prepare({ data, current }) {
      const items = data.items ?? [];
      const previous = current?.data ?? {};
      const itemIds = data.itemIds ??
        reconcileChecklistItems(items, checklistItems(previous), (current?.version ?? 0) + 1);
      if (items.length !== itemIds.length || new Set(itemIds).size !== itemIds.length || itemIds.some((id) => !id))
        throw new Error("INVALID_CHECKLIST_ITEMS");
      return { ...data, items, itemIds };
    },
  },
  checklistRun: {
    async resolve({ data, current }, reader) {
      if (current && (current.data.checklistId !== data.checklistId || current.data.day !== data.day))
        throw new Error("INVALID_CHECKLIST_RUN");
      const template = await reader.get("checklist", data.checklistId);
      if (!template || template.deleted) throw new Error("MISSING_REFERENCE:checklistId");
      if (data.itemIds !== undefined || data.itemLabels !== undefined) {
        if (!data.itemIds || !data.itemLabels || data.itemIds.length !== data.itemLabels.length ||
            new Set(data.itemIds).size !== data.itemIds.length || data.itemIds.some((id) => !id))
          throw new Error("INVALID_CHECKLIST_ITEMS");
      }
      const existing = current?.data;
      const snapshot = existing?.itemIds && existing.itemLabels
        ? { itemIds: existing.itemIds, itemLabels: existing.itemLabels }
        : { itemIds: data.itemIds, itemLabels: data.itemLabels };
      const state = runState(template.data, { ...snapshot, checked: data.checked, checkedItemIds: data.checkedItemIds });
      if (data.checkedItemIds?.some((id) => !state.items.some((item) => item.id === id)))
        throw new Error("INVALID_CHECKLIST_SELECTION");
      const prior = runState(template.data, existing);
      if (existing?.checkedItemIds && data.checkedItemIds === undefined) {
        const checkedLabels = new Set(data.checked);
        // v1 can express unchecked labels but cannot choose one of two equal labels.
        for (const item of state.items) {
          if (checkedLabels.has(item.label) && prior.checked.has(item.id)) {
            state.checked.add(item.id);
            state.ambiguous.delete(item.label);
          }
        }
      }
      const ambiguous = new Set([...prior.ambiguous, ...state.ambiguous, ...(data.ambiguousChecked ?? [])]);
      return { ...data, ...runFields(state.items, state.checked, ambiguous) };
    },
    async check({ data, current }, reader) {
      if ((!current || current.deleted) &&
          await reader.count("checklistRun", { eq: { checklistId: data.checklistId, day: data.day } }))
        throw new Error("DUPLICATE_CHECKLIST_RUN");
    },
  },
  taskList: {
    async checkDelete(list, reader) {
      if (await reader.count("taskList", { eq: { parentId: list.id } }) ||
          await reader.count("task", { eq: { listId: list.id } }))
        throw new Error("TASK_LIST_NOT_EMPTY");
    },
    prepare({ data, current }) {
      return {
        name: data.name.trim(),
        parentId: data.parentId ?? current?.data.parentId,
      };
    },
    async check({ id, data, current }, reader) {
      if (!data.parentId || (data.parentId === current?.data.parentId && !current.deleted)) return;
      let parentId: string | undefined = data.parentId;
      const seen = new Set([id]);
      while (parentId) {
        if (seen.has(parentId)) throw new Error("TASK_LIST_CYCLE");
        seen.add(parentId);
        const nextId: string = parentId;
        const parent = await reader.get("taskList", nextId);
        if (!parent || parent.deleted) throw new Error("INVALID_TASK_LIST");
        parentId = parent.data.parentId;
      }
    },
  },
  task: {
    validate(data) {
      fromSchedule(toSchedule(data));
      if (
        data.scheduleTime &&
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.scheduleTime)
      )
        throw new Error("INVALID_TASK_TIME");
      const ids = data.prerequisiteIds ?? [];
      if (
        ids.length > maxPrerequisites ||
        ids.some((id) => !uuid.test(id)) ||
        new Set(ids).size !== ids.length
      )
        throw new Error("INVALID_TASK_PREREQUISITES");
      if (data.listId && !uuid.test(data.listId))
        throw new Error("INVALID_TASK_LIST");
    },
    prepare({ data, current, occurredAt }) {
      const {
        scheduleDate,
        scheduleStart,
        scheduleEnd,
        scheduleTime,
        ...rest
      } = data;
      const schedule = fromSchedule(toSchedule(data));
      const time = schedule.scheduleDate
        ? (scheduleTime ??
          (schedule.scheduleDate === current?.data.scheduleDate &&
          schedule.scheduleKind === current?.data.scheduleKind
            ? current?.data.scheduleTime
            : undefined))
        : undefined;
      return settleLifecycle(
        {
          ...rest,
          // Older clients can replace the task without sending these optional fields.
          note: rest.note ?? current?.data.note,
          listId: rest.listId ?? current?.data.listId,
          prerequisiteIds:
            rest.prerequisiteIds ?? current?.data.prerequisiteIds,
          title: data.title.trim(),
          ...schedule,
          scheduleTime: time || undefined,
        },
        current?.data ?? null,
        occurredAt,
      );
    },
    async check({ id, data, current }, reader) {
      if (data.listId && (data.listId !== current?.data.listId || current.deleted)) {
        const list = await reader.get("taskList", data.listId);
        if (!list || list.deleted) throw new Error("INVALID_TASK_LIST");
      }
      const before = new Set(
        current?.deleted ? [] : (current?.data.prerequisiteIds ?? []),
      );
      const after = data.prerequisiteIds ?? [];
      const added = after.filter((parent) => !before.has(parent));
      const completes =
        data.status === "completed" && current?.data.status !== "completed";
      if (!added.length && !completes) return;

      const tasks = new Map<string, Awaited<ReturnType<typeof getTask>>>();
      async function getTask(key: string) {
        const task = await reader.get("task", key);
        return task && !task.deleted ? task.data : null;
      }
      async function lookup(key: string) {
        if (!tasks.has(key)) tasks.set(key, await getTask(key));
        return tasks.get(key);
      }

      // Runs inside the owner's serialized write transaction.
      const seen = new Set<string>();
      const stack = [...added];
      for (const parent of added) {
        if (parent === id) throw new Error("TASK_DEPENDENCY_CYCLE");
        const prerequisite = await lookup(parent);
        if (!prerequisite) throw new Error("TASK_PREREQUISITE_MISSING");
        if (prerequisite.status !== "pending")
          throw new Error("TASK_PREREQUISITE_NOT_PENDING");
      }
      while (stack.length) {
        const key = stack.pop()!;
        if (key === id) throw new Error("TASK_DEPENDENCY_CYCLE");
        if (seen.has(key)) continue;
        seen.add(key);
        stack.push(...((await lookup(key))?.prerequisiteIds ?? []));
      }
      if (completes) {
        for (const key of after) {
          if ((await lookup(key))?.status !== "completed")
            throw new Error("TASK_PREREQUISITES_OPEN");
        }
      }
    },
  },
};
