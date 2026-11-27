import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, SyncService } from "../../modules/kernel/server.ts";
import { composeRules } from "../../services/api/compose.ts";
import { client } from "../support.ts";

// Every module's rules, composed exactly as the server composes them, over an in-memory store.
const setup = () =>
  client(new SyncService(new MemoryStore(), composeRules()), "owner");

test("WeChat expense titles keep merchant identity and only change defaults on confirmation", async () => {
  const c = setup();
  const category = await c.create("category", { name: "订阅" });
  const merchant = "示例小铺";
  const date = "2026-11-17T01:00:00.000Z";
  const expense = await c.create("expense", {
    title: merchant, wechatMerchant: merchant, mode: "immediate",
    amountMinor: "1200", day: "2026-11-17",
  });
  const renamed = await c.update(expense, { title: "本次打印" });
  assert.equal(renamed.data.wechatMerchant, merchant);
  assert.equal(renamed.data.wechatMerchantRule, undefined);
  const rule = [merchant, category.id, date, "会员充值"];
  const remembered = await c.update(renamed, {
    title: rule[3], categoryId: category.id, wechatMerchantRule: rule,
  });
  const edited = await c.update(remembered, {
    title: "本次会员升级", wechatMerchant: undefined, wechatMerchantRule: undefined,
  });
  assert.equal(edited.data.title, "本次会员升级");
  assert.equal(edited.data.wechatMerchant, merchant);
  assert.deepEqual(edited.data.wechatMerchantRule, rule);
  assert.equal(edited.data.amountMinor, "1200");
  const legacy = await c.update(edited, { wechatMerchantRule: [edited.data.title, category.id, date] });
  assert.deepEqual(legacy.data.wechatMerchantRule, rule.slice(0, 3));
});

test("tasks: completion instant is recorded once and survives re-planning", async () => {
  const c = setup();
  const task = await c.create("task", {
    title: " 排期模拟 ",
    status: "pending",
    scheduleKind: "range",
    scheduleStart: "2026-11-28",
    scheduleEnd: "2026-12-03",
    scheduleDate: "2026-01-01",
  });
  assert.equal(task.data.title, "排期模拟");
  assert.equal(task.data.scheduleDate, undefined);
  assert.ok(task.data.createdAt);
  await assert.rejects(
    c.update(task, { scheduleKind: "day", scheduleDate: "2026-02-29" }),
    /INVALID_DATE/,
  );
  await assert.rejects(
    c.update(task, { scheduleStart: "2026-12-04" }),
    /INVALID_RANGE/,
  );
  const done = await c.update(task, {
    status: "completed",
    completedAt: "2026-10-20T02:15:00.000Z",
  });
  assert.equal(done.data.completedAt, "2026-10-20T02:15:00.000Z");
  const moved = await c.update(done, {
    scheduleKind: "day",
    scheduleDate: "2027-01-10",
    completedAt: "2030-01-01T00:00:00Z",
    createdAt: "2000-01-01T00:00:00Z",
  });
  assert.equal(moved.data.completedAt, done.data.completedAt);
  assert.equal(moved.data.createdAt, task.data.createdAt);
  assert.equal(moved.data.scheduleStart, undefined);
});
test("tasks: a discarded task must be reopened before it can be completed", async () => {
  const c = setup();
  const task = await c.create("task", {
    title: "t",
    status: "pending",
    scheduleKind: "recent",
  });
  const dropped = await c.update(task, { status: "discarded" });
  await assert.rejects(
    c.update(dropped, { status: "completed" }),
    /REOPEN_REQUIRED/,
  );
  const reopened = await c.update(dropped, { status: "pending" });
  assert.ok(
    (await c.update(reopened, { status: "completed" })).data.completedAt,
  );
});
test("practice: records sit on one consistent branch and solutions form a tree", async () => {
  const c = setup();
  const a = await c.create("domain", { name: "A" }),
    b = await c.create("domain", { name: "B" });
  const activity = await c.create("activity", { domainId: a.id, name: "跑步" });
  await assert.rejects(
    c.create("problem", {
      domainId: b.id,
      activityId: activity.id,
      title: "q",
      status: "active",
    }),
    /INVALID_ACTIVITY_DOMAIN/,
  );
  const problem = await c.create("problem", {
    domainId: a.id,
    title: "q",
    status: "active",
  });
  const other = await c.create("problem", {
    domainId: a.id,
    title: "q2",
    status: "active",
  });
  const parent = await c.create("solution", {
    problemId: problem.id,
    title: "p",
    status: "active",
  });
  const child = await c.create("solution", {
    problemId: problem.id,
    parentId: parent.id,
    title: "c",
    status: "active",
  });
  await assert.rejects(c.update(parent, { parentId: child.id }), /CYCLE/);
  await assert.rejects(
    c.create("solution", {
      problemId: other.id,
      parentId: parent.id,
      title: "x",
      status: "active",
    }),
    /INVALID_PARENT/,
  );
  await assert.rejects(
    c.create("session", {
      domainId: b.id,
      problemId: problem.id,
      title: "s",
      day: "2026-11-07",
      status: "finished",
    }),
    /INVALID_PROBLEM_DOMAIN/,
  );
  await assert.rejects(
    c.create("progress", {
      domainId: a.id,
      problemId: other.id,
      solutionId: child.id,
      day: "2026-11-07",
      body: "x",
    }),
    /INVALID_SOLUTION_PROBLEM/,
  );
});
test("habits: a rule cannot be redefined over days that already have records", async () => {
  const c = setup();
  const habit = await c.create("habit", {
    name: "阅读",
    kind: "quantity",
    status: "active",
  });
  const rule = await c.create("habitRule", {
    habitId: habit.id,
    effectiveFrom: "2026-11-01",
    target: 20,
    weekdays: ["1", "3"],
  });
  await assert.rejects(
    c.create("habitRule", {
      habitId: habit.id,
      effectiveFrom: "2026-11-01",
      weekdays: ["7"],
    }),
    /INVALID_WEEKDAYS/,
  );
  await c.create("habitLog", {
    habitId: habit.id,
    ruleId: rule.id,
    day: "2026-11-07",
    value: 25,
  });
  await assert.rejects(
    c.update(rule, { target: 30 }),
    /INVALID_RULE_RECORDED_DATES/,
  );
  await assert.rejects(
    c.create("habitRule", {
      habitId: habit.id,
      effectiveFrom: "2026-11-05",
      target: 30,
    }),
    /INVALID_RULE_RECORDED_DATES/,
  );
  await c.create("habitRule", {
    habitId: habit.id,
    effectiveFrom: "2026-11-08",
    target: 30,
  });
  const second = await c.create("habit", {
    name: "跑步",
    kind: "binary",
    status: "active",
  });
  await assert.rejects(
    c.create("habitLog", {
      habitId: second.id,
      ruleId: rule.id,
      day: "2026-11-07",
    }),
    /INVALID_HABIT_RULE/,
  );
});
test("finance: ledger invariants and two-level categories", async () => {
  const c = setup();
  await assert.rejects(
    c.create("expense", {
      title: "x",
      day: "2026-11-07",
      amountMinor: "-1",
      mode: "fixed",
      startDay: "2026-11-07",
      endDay: "2026-12-07",
    }),
    /INVALID_AMOUNT/,
  );
  await assert.rejects(
    c.create("expense", {
      title: "x",
      day: "2026-11-07",
      amountMinor: "100",
      mode: "estimated",
    }),
    /INVALID_TERM/,
  );
  await assert.rejects(
    c.create("expense", {
      title: "x",
      day: "2026-11-07",
      amountMinor: "100",
      mode: "fixed",
      startDay: "2026-11-07",
      endDay: "2026-12-07",
      endedDay: "2026-11-01",
    }),
    /INVALID_TERM/,
  );
  const food = await c.create("category", { name: "餐饮" }),
    travel = await c.create("category", { name: "交通" });
  const meal = await c.create("category", { name: "正餐", parentId: food.id });
  await assert.rejects(
    c.create("category", { name: "太深", parentId: meal.id }),
    /INVALID_CATEGORY_PARENT/,
  );
  await assert.rejects(
    c.update(travel, { defaultChildId: meal.id }),
    /INVALID_DEFAULT_CHILD/,
  );
  await c.update(food, { defaultChildId: meal.id });
  await assert.rejects(
    c.create("expense", {
      title: "x",
      day: "2026-11-07",
      amountMinor: "100",
      mode: "immediate",
      categoryId: travel.id,
      subcategoryId: meal.id,
    }),
    /INVALID_SUBCATEGORY/,
  );
  await c.create("expense", {
    title: "退款",
    day: "2026-11-07",
    amountMinor: "-100",
    mode: "immediate",
    categoryId: food.id,
    subcategoryId: meal.id,
  });
});
test("metrics, calendar and documents keep their own invariants", async () => {
  const c = setup();
  await assert.rejects(
    c.create("metric", { name: "x", minimum: 5, maximum: 1 }),
    /INVALID_METRIC_RANGE/,
  );
  const sleep = await c.create("metric", {
    name: "睡眠",
    minimum: 0,
    maximum: 24,
  });
  await assert.rejects(
    c.create("metricLog", { metricId: sleep.id, day: "2026-11-07", value: 30 }),
    /INVALID_METRIC_VALUE/,
  );
  await c.create("metricLog", {
    metricId: sleep.id,
    day: "2026-11-07",
    value: 0,
  });
  const day = { name: "生日", repeat: "yearly", intervalUnit: "year" } as const;
  await assert.rejects(
    c.create("importantDay", { ...day, calendar: "solar" }),
    /REQUIRED:date/,
  );
  await assert.rejects(
    c.create("importantDay", { ...day, calendar: "lunar", lunarYear: 1990 }),
    /INVALID_LUNAR_DATE/,
  );
  await assert.rejects(
    c.create("importantDay", {
      ...day,
      calendar: "solar",
      date: "2026-11-07",
      repeat: "custom",
    }),
    /INVALID_INTERVAL/,
  );
  await assert.rejects(
    c.create("document", { title: "t", kind: "thought", source: "ai" }),
    /INVALID_SOURCE_CONTEXT/,
  );
  const domain = await c.create("domain", { name: "AI" });
  await c.create("document", {
    title: "t",
    kind: "note",
    domainId: domain.id,
    source: "ai",
  });
});

test("task planning: two devices cannot create a cycle, and completion unlocks the next task", async () => {
  const service = new SyncService(new MemoryStore(), composeRules());
  const a = client(service, "owner", "phone");
  const b = client(service, "owner", "web");
  const create = (title: string) =>
    a.create("task", {
      title,
      status: "pending",
      scheduleKind: "recent",
    });
  const first = await create("收集资料");
  const second = await create("写提纲");
  const results = await Promise.allSettled([
    a.update(second, { prerequisiteIds: [first.id] }),
    b.update(first, { prerequisiteIds: [second.id] }),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  if (results[1].status === "rejected")
    assert.match(String(results[1].reason), /TASK_DEPENDENCY_CYCLE/);
  const waiting = results[0].value;
  await assert.rejects(
    a.update(waiting, { status: "completed" }),
    /TASK_PREREQUISITES_OPEN/,
  );
  const done = await a.update(first, { status: "completed" });
  const third = await create("提交提纲");
  await assert.rejects(
    b.update(third, { prerequisiteIds: [done.id] }),
    /TASK_PREREQUISITE_NOT_PENDING/,
  );
  const edited = await b.update(waiting, { note: "已完成的前置仍保留" });
  assert.deepEqual(edited.data.prerequisiteIds, [done.id]);
  const secondDone = await b.update(edited, { status: "completed" });
  assert.equal(secondDone.data.status, "completed");
  const reopened = await a.update(done, { status: "pending" });
  const secondOpen = await b.update(secondDone, { status: "pending" });
  await assert.rejects(
    b.update(secondOpen, { status: "completed" }),
    /TASK_PREREQUISITES_OPEN/,
  );
  assert.equal(reopened.data.status, "pending");
});

test("task planning: old task edits preserve notes, list and prerequisite fields", async () => {
  const c = setup();
  const list = await c.create("taskList", { name: "学习" });
  const prerequisite = await c.create("task", {
    title: "先读题",
    status: "pending",
    scheduleKind: "recent",
  });
  const task = await c.create("task", {
    title: "写作业",
    status: "pending",
    scheduleKind: "recent",
    listId: list.id,
    note: "测试备注",
    prerequisiteIds: [prerequisite.id],
  });
  const result = await c.send(
    c.command("task", task.id, task.version, {
      title: "交作业",
      status: "pending",
      scheduleKind: "unscheduled",
    }),
  );
  assert.equal(result.outcome, "accepted");
  if (result.outcome !== "accepted" || result.entity.type !== "task")
    throw new Error("Expected task");
  assert.equal(result.entity.data.listId, list.id);
  assert.equal(result.entity.data.note, "测试备注");
  assert.deepEqual(result.entity.data.prerequisiteIds, [prerequisite.id]);
  const cleared = await c.update<"task">(result.entity, {
    listId: "",
    note: "",
    prerequisiteIds: [],
  });
  assert.equal(cleared.data.listId, "");
  assert.equal(cleared.data.note, "");
  assert.deepEqual(cleared.data.prerequisiteIds, []);
});

test("task folders preserve their parent on legacy edits and reject cycles", async () => {
  const c = setup();
  const root = await c.create("taskList", { name: "工作" });
  const child = await c.create("taskList", { name: "网站", parentId: root.id });
  const edit = await c.send(
    c.command("taskList", child.id, child.version, { name: "官网改版" }),
  );
  assert.equal(edit.outcome, "accepted");
  if (edit.outcome !== "accepted" || edit.entity.type !== "taskList")
    throw new Error("Expected task folder");
  assert.equal(edit.entity.data.parentId, root.id);
  await assert.rejects(
    c.update(root, { parentId: child.id }),
    /TASK_LIST_CYCLE/,
  );
});

test("task time survives an older client's title edit and can be cleared", async () => {
  const c = setup();
  const data = {
    title: "交稿",
    status: "pending",
    scheduleKind: "deadline",
    scheduleDate: "2026-11-19",
  } as const;
  const task = await c.create("task", { ...data, scheduleTime: "18:15" });
  const edit = await c.send(
    c.command("task", task.id, task.version, { ...data, title: "交最终稿" }),
  );
  assert.equal(edit.outcome, "accepted");
  if (edit.outcome !== "accepted" || edit.entity.type !== "task")
    throw new Error("Expected task");
  assert.equal(edit.entity.data.scheduleTime, "18:15");
  await assert.rejects(
    c.update<"task">(edit.entity, { scheduleTime: "25:00" }),
    /INVALID_TASK_TIME/,
  );
  const cleared = await c.update<"task">(edit.entity, { scheduleTime: "" });
  assert.equal(cleared.data.scheduleTime, undefined);
});
