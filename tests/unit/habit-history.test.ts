import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnyEntity } from "../../packages/contracts/entities.ts";
import { MemoryStore, SyncService } from "../../modules/kernel/server.ts";
import { composeRules } from "../../services/api/compose.ts";
import { habitDone, habitScheduled, latestHabitLogs } from "../../apps/web/src/features/habit-model.ts";
import { client } from "../support.ts";

test("server assigns the business day's effective habit rule and rejects new duplicates", async () => {
  const c = client(new SyncService(new MemoryStore(), composeRules()), "habit-test");
  const habit = await c.create("habit", { name: "阅读", kind: "quantity", status: "active" });
  const first = await c.create("habitRule", { habitId: habit.id, effectiveFrom: "2026-01-01", kind: "quantity", target: 1 });
  const later = await c.create("habitRule", { habitId: habit.id, effectiveFrom: "2026-01-10", kind: "quantity", target: 5 });
  await assert.rejects(c.create("habitRule", { ...first.data }), /DUPLICATE_HABIT_RULE/);
  await assert.rejects(c.create("habitRule", { ...first.data, target: 0 }), /INVALID_HABIT_TARGET/);
  const data = { habitId: habit.id, day: "2026-01-07", value: 0 };
  await assert.rejects(c.create("habitLog", { ...data, ruleId: later.id }), /INVALID_HABIT_RULE/);
  const logged = await c.create("habitLog", data);
  assert.equal(logged.data.ruleId, first.id);
  await assert.rejects(c.create("habitLog", { ...data, value: 5 }), /DUPLICATE_HABIT_LOG/);
  assert.equal((await c.update(logged, { ruleId: undefined, value: 2 })).data.ruleId, first.id);
  assert.equal((await c.create("habitLog", { ...data, day: "2026-01-10" })).data.ruleId, later.id);
});

test("web habit schedules distinguish absent from empty, and history counts one record a day", () => {
  const row = (id: string, type: AnyEntity["type"], data: AnyEntity["data"], hour = "01"): AnyEntity => ({
    id, type, data, updatedAt: `2026-01-04T${hour}:00:00Z`, version: 1, deleted: false,
  });
  const habit = row("h", "habit", { kind: "checklist", items: [] });
  const rule = row("r", "habitRule", { weekdays: [] });
  const day = "2026-01-04";
  const first = row("a", "habitLog", { habitId: habit.id, day, value: 12 });
  const latest = row("b", "habitLog", { habitId: habit.id, day, value: 0, items: [] }, "02");
  assert.equal(habitScheduled(undefined, day), true);
  assert.equal(habitScheduled(rule, day), false);
  assert.equal(habitScheduled(row("s", "habitRule", { weekdays: ["0"] }), day), true);
  assert.equal(habitDone(habit, latest, undefined), false);
  assert.deepEqual([...latestHabitLogs(habit.id, [first, latest]).values()], [latest]);
});
