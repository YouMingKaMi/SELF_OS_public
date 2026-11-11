import type { Rules } from "../kernel/index.ts";

const definingFields = [
  "habitId",
  "effectiveFrom",
  "target",
  "weekdays",
  "kind",
  "unit",
  "items",
] as const;

export const rules: Rules = {
  habitRule: {
    validate(data) {
      if (data.weekdays?.some((day) => !/^[0-6]$/.test(day)))
        throw new Error("INVALID_WEEKDAYS");
    },
    /**
     * History keeps the rule version that applied on the day it was recorded.
     * A rule may therefore not start on, or be redefined over, days that already have records.
     */
    async check({ data, current }, reader) {
      const redefined =
        !current ||
        definingFields.some(
          (key) =>
            JSON.stringify(current.data[key]) !== JSON.stringify(data[key]),
        );
      if (
        redefined &&
        (await reader.count("habitLog", {
          eq: { habitId: data.habitId },
          gte: { day: data.effectiveFrom },
        })) > 0
      )
        throw new Error("INVALID_RULE_RECORDED_DATES");
    },
  },
  habitLog: {
    async check({ data, refs }) {
      if (refs.ruleId && refs.ruleId.data.habitId !== data.habitId)
        throw new Error("INVALID_HABIT_RULE");
    },
  },
};
