import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { compose } from "../services/api/compose.ts";
import type { Data, EntityType } from "../packages/contracts/entities.ts";
const id = (key: string) => {
  const hex = createHash("sha256")
    .update("fixture:" + key)
    .digest("hex");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-4" +
    hex.slice(13, 16) +
    "-8" +
    hex.slice(17, 20) +
    "-" +
    hex.slice(20, 32)
  );
};
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const month = day.slice(0, 7);
const at = (daysAgo: number) =>
  new Date(Date.parse(day + "T04:00:00Z") - daysAgo * 86400000).toISOString();
const exportOnly = process.argv.includes("--export-native");
const fixtureRecords: unknown[] = [];
// Seeds go through the same use case as any client, so they obey every rule.
const { pool, sync } = exportOnly
  ? { pool: null, sync: null }
  : await compose(process.env.DATABASE_URL);
try {
  async function seed(type: EntityType, key: string, data: Data) {
    fixtureRecords.push({
      id: id(key),
      type,
      version: 1,
      data,
      deleted: false,
      updatedAt: "2026-11-07T00:00:00Z",
    });
    if (sync)
      await sync.execute("local-demo", "system-fixtures", {
        operationId: id("operation-" + key),
        entityId: id(key),
        entityType: type,
        baseVersion: 0,
        action: "put",
        data,
        occurredAt: "2026-11-07T00:00:00Z",
      });
    return id(key);
  }
  await seed("domain", "automation", {
    name: "自动化",
    focused: true,
    order: 0,
  });
  await seed("domain", "fitness", { name: "健身", focused: true, order: 1 });
  await seed("domain", "ai", { name: "AI", focused: true, order: 2 });
  await seed("domain", "coding", { name: "编程", focused: false, order: 3 });
  await seed("activity", "running", {
    domainId: id("fitness"),
    name: "跑步",
    archived: false,
  });
  await seed("activity", "strength", {
    domainId: id("fitness"),
    name: "力量训练",
    archived: false,
  });
  await seed("activity", "plc", {
    domainId: id("automation"),
    name: "PLC",
    archived: false,
  });
  await seed("problem", "course", {
    domainId: id("automation"),
    title: "找到一门适合自己的基础课程",
    status: "active",
    focused: true,
  });
  await seed("solution", "domestic", {
    problemId: id("course"),
    title: "先找国内资源",
    status: "active",
  });
  await seed("solution", "course-a", {
    problemId: id("course"),
    parentId: id("domestic"),
    title: "课程 A",
    status: "discarded",
    reason: "演示：时间太长，暂不沿此分支推进",
  });
  await seed("solution", "course-b", {
    problemId: id("course"),
    parentId: id("domestic"),
    title: "课程 B：从第一章开始",
    status: "active",
  });
  await seed("progress", "course-progress", {
    domainId: id("automation"),
    problemId: id("course"),
    solutionId: id("course-b"),
    day,
    body: "这是一条模拟推进记录。读完第一节，整理了几个需要继续了解的概念。",
  });
  await seed("session", "session-1", {
    domainId: id("fitness"),
    activityId: id("running"),
    title: "跑步 · 演示",
    day,
    elapsedSeconds: 1800,
    manual: true,
    status: "finished",
    segments: [],
  });
  for (const [key, name, kind, unit, target, items] of [
    ["reading", "阅读", "binary", "", 1, []],
    ["run", "跑步", "quantity", "km", 1, []],
    ["diet", "饮食", "checklist", "项", 3, ["水果", "坚果", "鱼油"]],
  ] as const) {
    await seed("habit", key, {
      name,
      kind,
      unit,
      items: [...items],
      status: "active",
      showHome: true,
      order: 0,
    });
    await seed("habitRule", key + "-rule", {
      habitId: id(key),
      effectiveFrom: "2026-01-01",
      target,
      weekdays: ["0", "1", "2", "3", "4", "5", "6"],
    });
  }
  for (const [key, name, necessary] of [
    ["food", "餐饮", true],
    ["daily", "居住与日用", true],
    ["transport", "交通", true],
    ["health", "健康", true],
    ["tools", "学习与工具", true],
    ["fun", "娱乐与购物", false],
    ["social", "人情", false],
    ["other", "其他", false],
  ] as const)
    await seed("category", key, {
      name,
      necessary,
    });
  await seed("category", "meal", {
    name: "正餐",
    parentId: id("food"),
    necessary: true,
  });
  await seed("category", "coffee", {
    name: "咖啡",
    parentId: id("food"),
    necessary: true,
  });
  // A default child can only be chosen once the child exists: second version of the parent.
  fixtureRecords.find((r) => (r as { id: string }).id === id("food")) &&
    Object.assign(
      fixtureRecords.find((r) => (r as { id: string }).id === id("food")) as {
        data: Data;
      },
      {
        data: { name: "餐饮", necessary: true, defaultChildId: id("meal") },
      },
    );
  await sync?.execute("local-demo", "system-fixtures", {
    operationId: id("operation-food-default"),
    entityId: id("food"),
    entityType: "category",
    baseVersion: 1,
    action: "put",
    data: { name: "餐饮", necessary: true, defaultChildId: id("meal") },
    occurredAt: "2026-11-07T00:00:00Z",
  });
  await seed("expense", "coffee-expense", {
    title: "咖啡 · 模拟记录",
    day,
    amountMinor: "1200",
    categoryId: id("food"),
    subcategoryId: id("coffee"),
    necessary: true,
    mode: "immediate",
  });
  await seed("expense", "meal-expense", {
    title: "午餐 · 模拟记录",
    day,
    amountMinor: "1800",
    categoryId: id("food"),
    subcategoryId: id("meal"),
    necessary: true,
    mode: "immediate",
  });
  await seed("expense", "computer-expense", {
    title: "演示设备",
    day: "2026-01-01",
    amountMinor: "365000",
    categoryId: id("tools"),
    necessary: true,
    mode: "estimated",
    startDay: "2026-01-01",
    endDay: "2028-12-31",
  });
  await seed("expense", "tuition-expense", {
    title: "固定期限套餐 · 演示",
    day: "2026-09-01",
    amountMinor: "36500",
    categoryId: id("tools"),
    necessary: true,
    mode: "fixed",
    startDay: "2026-09-01",
    endDay: "2027-08-31",
  });
  await seed("budget", "budget-" + month, { month, amountMinor: "200000" });
  await seed("recurringExpense", "subscription", {
    name: "AI 会员 · 演示",
    amountMinor: "10000",
    active: true,
  });
  for (const [key, name, category, currency, asset, price, rate, quantity] of [
    ["cash", "日常账户", "cny", "CNY", "人民币", "1", "1", "5000"],
    ["reserve", "战略储备金", "cny", "CNY", "人民币", "1", "1", "15000"],
    ["external", "外部项目", "external", "CNY", "模拟项目", "1", "1", "8000"],
    ["crypto", "模拟加密钱包", "crypto", "USD", "演示代币", "2", "7", "100"],
    ["stock", "模拟证券账户", "stock", "CNY", "演示股票", "10", "1", "200"],
  ] as const) {
    await seed("wallet", key, {
      name,
      category,
      currency,
      asset,
      unitPrice: price,
      exchangeRate: rate,
    });
    await seed("walletEntry", key + "-balance", {
      walletId: id(key),
      mode: "set",
      quantity,
      at: at(10),
      unitPrice: price,
      exchangeRate: rate,
      reason: "初始模拟余额",
    });
  }
  await seed("walletEntry", "cash-add", {
    walletId: id("cash"),
    mode: "delta",
    quantity: "500",
    at: at(5),
    unitPrice: "1",
    exchangeRate: "1",
    reason: "模拟增加",
  });
  await seed("walletEntry", "cash-subtract", {
    walletId: id("cash"),
    mode: "delta",
    quantity: "-100",
    at: at(0),
    unitPrice: "1",
    exchangeRate: "1",
    reason: "模拟减少",
  });
  await seed("document", "note", {
    title: "学习资料 · 模拟笔记",
    body: "# 把资料和行动连接起来\n\n这是一篇演示文章。\n\n## 关键概念\n\n- 领域可以直接推进，也可以细分子领域。\n- 真正遇到问题时，再建立问题和方案链。\n- 每一条进展保留原文和所属分支。\n\n## 下一步\n\n选择一个很小的行动，开始。",
    kind: "note",
    day,
    domainId: id("automation"),
    source: "ai",
  });
  await seed("document", "thought", {
    title: "把注意力留给重要的事",
    body: "## 一点思考\n\n这是演示文章。工具应该减少整理的负担，让记录更自然。\n\n## 试着做什么\n\n每次只选择一个具体的行动，做完后留下事实，而不追求填满页面。",
    kind: "thought",
    day,
  });
  await seed("document", "monthly", {
    title: month + " · 月报",
    kind: "monthly",
    month,
    day,
    body: "## 这个月的关键词\n\n## 发生了什么\n\n## 做得好的与想调整的\n\n## 下个月",
  });
  await seed("journal", "chronicle", {
    kind: "chronicle",
    day,
    body: "开始体验 SELF OS。这是一条可编辑的模拟记录。",
    complete: false,
  });
  await seed("journal", "raw", {
    kind: "raw",
    day,
    body: "一个模拟的想法：把信息入口变得更轻，把真正需要思考的地方留给自己。",
    complete: false,
  });
  await seed("idea", "idea", {
    body: "找个时间试试新的记录方式。",
    day,
    status: "pending",
  });
  for (const [key, name, unit, min, max, value] of [
    ["sleep", "睡眠时长", "小时", 0, 24, 7.5],
    ["mood", "情绪评分", "分", 0, 10, 8],
    ["learning", "学习评分", "分", 0, 10, 7],
  ] as const) {
    await seed("metric", key, { name, unit, minimum: min, maximum: max });
    for (let i = 0; i < 7; i++)
      await seed("metricLog", key + "-" + i, {
        metricId: id(key),
        day: at(i).slice(0, 10),
        value: Math.max(min, Math.min(max, value + ((i % 3) - 1) * 0.5)),
      });
  }
  await seed("importantDay", "anniversary", {
    name: "一个值得期待的日子 · 演示",
    calendar: "solar",
    date: at(-3).slice(0, 10),
    repeat: "yearly",
    interval: 1,
    intervalUnit: "year",
    remindDays: 7,
  });
  await seed("checklist", "going-out", {
    name: "出门",
    items: ["手机", "钥匙", "耳机", "水杯"],
  });
  await seed("checklist", "shower", {
    name: "洗澡",
    items: ["毛巾", "换洗衣物", "洗漱用品"],
  });
  if (exportOnly)
    writeFileSync(
      new URL(
        "../apps/ios/CouncilApp/Generated/demo-fixtures.json",
        import.meta.url,
      ),
      JSON.stringify(fixtureRecords),
    );
  console.log(
    "Full-system synthetic fixtures prepared. Existing edited records preserved through version conflicts.",
  );
} finally {
  await pool?.end();
}
