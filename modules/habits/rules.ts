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
  habit: {
    async checkDelete(habit, reader) {
      if (await reader.count("habitLog", { eq: { habitId: habit.id } }) ||
          await reader.count("habitRule", { eq: { habitId: habit.id } }))
        throw new Error("HABIT_HAS_HISTORY");
    },
  },
  habitRule: {
    async checkDelete(rule, reader) {
      if (await reader.count("habitLog", { eq: { ruleId: rule.id } }))
        throw new Error("HABIT_RULE_HAS_HISTORY");
    },
    validate(data) {
      if (data.weekdays?.some((day) => !/^[0-6]$/.test(day)))
        throw new Error("INVALID_WEEKDAYS");
      if (data.target !== undefined && data.target <= 0)
        throw new Error("INVALID_HABIT_TARGET");
    },
    /**
     * History keeps the rule version that applied on the day it was recorded.
     * A rule may therefore not start on, or be redefined over, days that already have records.
     */
    async check({ data, current }, reader) {
      if (
        (current?.deleted || current?.data.habitId !== data.habitId ||
          current?.data.effectiveFrom !== data.effectiveFrom) &&
        (await reader.count("habitRule", {
          eq: { habitId: data.habitId, effectiveFrom: data.effectiveFrom },
        })) > 0
      )
        throw new Error("DUPLICATE_HABIT_RULE");
      const redefined =
        !current || current.deleted ||
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
    async resolve({ data, current }, reader) {
      if (current?.data.habitId === data.habitId && current.data.day === data.day &&
          current.data.ruleId) {
        if (data.ruleId && data.ruleId !== current.data.ruleId)
          throw new Error("INVALID_HABIT_RULE");
        return { ...data, ruleId: current.data.ruleId };
      }
      const rule = await reader.latest(
        "habitRule",
        { eq: { habitId: data.habitId }, lte: { effectiveFrom: data.day } },
        "effectiveFrom",
      );
      if (data.ruleId && rule?.id !== data.ruleId)
        throw new Error("INVALID_HABIT_RULE");
      return { ...data, ruleId: rule?.id };
    },
    async check({ data, refs, current }, reader) {
      if (refs.ruleId && refs.ruleId.data.habitId !== data.habitId)
        throw new Error("INVALID_HABIT_RULE");
      if (
        (current?.deleted || current?.data.habitId !== data.habitId || current?.data.day !== data.day) &&
        (await reader.count("habitLog", {
          eq: { habitId: data.habitId, day: data.day },
        })) > 0
      )
        throw new Error("DUPLICATE_HABIT_LOG");
    },
  },
};
