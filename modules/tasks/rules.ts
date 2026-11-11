import type { Rules } from "../kernel/index.ts";
import { fromSchedule, toSchedule } from "./domain/schedule.ts";
import { settleLifecycle } from "./domain/task.ts";

export const rules: Rules = {
  task: {
    validate(data) {
      fromSchedule(toSchedule(data));
    },
    prepare({ data, current, occurredAt }) {
      const { scheduleDate, scheduleStart, scheduleEnd, ...rest } = data;
      return settleLifecycle(
        {
          ...rest,
          title: data.title.trim(),
          ...fromSchedule(toSchedule(data)),
        },
        current?.data ?? null,
        occurredAt,
      );
    },
  },
};
