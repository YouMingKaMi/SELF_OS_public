import React, { useMemo, useState } from "react";
import "./finance.css";
import {
  useEntities,
  put,
  putKey,
  remove,
  type AnyEntity as Entity,
  type Data,
} from "../data/entities.ts";
import {
  Heading,
  Panel,
  Empty,
  RecordForm,
  Month,
  Stats,
  Chart,
  today,
  monthNow,
  str,
  perform,
  daysInMonth,
} from "../ui/shared.tsx";
import {
  minor,
  money,
  net,
  daily,
  usage,
  add,
  round,
  effectiveEnd,
  isHistory,
  longTerm,
  dayCount,
} from "./finance-model.ts";
export function Finance() {
  const { entities } = useEntities(
    "expense",
    "category",
    "recurringExpense",
    "budget",
  );
  const expenses = useMemo(
    () => entities.filter((e) => e.type === "expense"),
    [entities],
  );
  const categories = entities.filter((e) => e.type === "category");
  const recurring = entities.filter((e) => e.type === "recurringExpense");
  const [month, setMonth] = useState(monthNow());
  const [tab, setTab] = useState("actual");
  const [current, setCurrent] = useState(false);
  const [history, setHistory] = useState(false);
  const [form, setForm] = useState<
    "expense" | "category" | "recurring" | "budget" | null
  >(null);
  const [editing, setEditing] = useState<Entity>();
  const [category, setCategory] = useState("");
  const [necessity, setNecessity] = useState("all");
  const [budget, setBudget] = useState("1400");
  // Derived figures are recomputed only when their inputs change, not on every render.
  const asOf = today();
  const { filtered, monthly, total, cost, costTotal } = useMemo(() => {
    const filtered = expenses.filter(
      (e) =>
        (!category ||
          e.data.categoryId === category ||
          e.data.subcategoryId === category) &&
        (necessity === "all" ||
          Boolean(e.data.necessary) === (necessity === "yes")),
    );
    const monthly = filtered.filter((e) => str(e, "day").startsWith(month));
    const zero = { n: 0n, d: 1n };
    const exact = daysInMonth(month)
      .filter((day) => day <= asOf)
      .map((day) => ({
        day,
        value: filtered.reduce(
          (sum, e) => add(sum, usage(e, day, asOf, current)),
          zero,
        ),
      }));
    return {
      filtered,
      monthly,
      total: monthly.reduce((n, e) => n + net(e), 0n),
      cost: exact.map(({ day, value }) => ({ day, value: round(value) })),
      // Sum exact daily shares first, round once: the total never drifts from the days.
      costTotal: round(exact.reduce((sum, d) => add(sum, d.value), zero)),
    };
  }, [expenses, category, necessity, month, current, asOf]);
  const budgetRecord = entities.find(
    (e) => e.type === "budget" && e.data.month === month,
  );
  const budgetMinor = BigInt(str(budgetRecord, "amountMinor", "140000"));
  function open(type: typeof form, e?: Entity) {
    setEditing(e);
    setForm(type);
  }
  const name = (id: unknown) =>
    str(
      categories.find((e) => e.id === id),
      "name",
      "未分类",
    );
  const exportMonth = () => {
    const text =
      "日期,内容,金额,用途,必要性\n" +
      monthly
        .map((e) =>
          [
            str(e, "day"),
            str(e, "title"),
            (Number(net(e)) / 100).toFixed(2),
            name(e.data.categoryId),
            e.data.necessary ? "必要" : "非必要",
          ]
            .map((v) => '"' + v.replaceAll('"', '""') + '"')
            .join(","),
        )
        .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob(["\ufeff" + text], { type: "text/csv" }),
    );
    a.download = month + "账本.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const weekday = (day: string) =>
    "日一二三四五六"[new Date(day + "T12:00:00Z").getUTCDay()];
  const necessary = monthly
    .filter((e) => e.data.necessary)
    .reduce((n, e) => n + net(e), 0n);
  const percent =
    budgetMinor > 0n ? Number((total * 1000n) / budgetMinor) / 10 : 0;
  const elapsed = Math.max(cost.length, 1);
  const monthDays = daysInMonth(month).length;
  // Where spending is heading if the rest of the month looks like the days so far.
  const projected =
    month === monthNow()
      ? (total * BigInt(monthDays)) / BigInt(elapsed)
      : total;
  const parents = categories.filter((c) => !c.data.parentId);
  const byCategory = parents
    .map((c) => ({
      c,
      sum: monthly
        .filter(
          (e) =>
            e.data.categoryId === c.id ||
            categories.find((x) => x.id === e.data.categoryId)?.data
              .parentId === c.id,
        )
        .reduce((n, e) => n + net(e), 0n),
    }))
    .filter((row) => row.sum !== 0n)
    .sort((a, b) => (b.sum > a.sum ? 1 : -1));
  const unclassified = monthly
    .filter((e) => !e.data.categoryId)
    .reduce((n, e) => n + net(e), 0n);
  const top = byCategory[0]?.sum ?? 1n;
  return (
    <>
      <Heading
        eyebrow="FINANCE · EVERYDAY"
        title="花销"
        description="左边是这个月的每一笔，右边是它们加起来的样子。"
      >
        <Month value={month} onChange={setMonth} />
        <button onClick={() => open("budget")}>月度预算</button>
        <button onClick={() => open("category")}>分类与默认</button>
        <button onClick={exportMonth}>导出本月</button>
        <button className="primary" onClick={() => open("expense")}>
          ＋ 记一笔
        </button>
      </Heading>
      <div className="columns finance">
        <Panel
          className="ledger"
          title={"账本 · " + monthly.length + " 笔"}
          aside={
            <>
              <select
                aria-label="消费分类"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">全部用途</option>
                {categories.map((e) => (
                  <option key={e.id} value={e.id}>
                    {name(e.data.parentId) !== "未分类"
                      ? name(e.data.parentId) + " / "
                      : ""}
                    {str(e, "name")}
                  </option>
                ))}
              </select>
              <select
                aria-label="必要性筛选"
                value={necessity}
                onChange={(e) => setNecessity(e.target.value)}
              >
                <option value="all">全部必要性</option>
                <option value="yes">必要</option>
                <option value="no">非必要</option>
              </select>
            </>
          }
        >
          {[...new Set(monthly.map((e) => str(e, "day")))]
            .sort()
            .reverse()
            .map((day) => (
              <section className="day-block" key={day}>
                <header>
                  <h3>{day.slice(8)}</h3>
                  <small>周{weekday(day)}</small>
                  <strong>
                    {money(
                      monthly
                        .filter((e) => e.data.day === day)
                        .reduce((n, e) => n + net(e), 0n),
                    )}
                  </strong>
                </header>
                <div className="ledger-rows">
                  {monthly
                    .filter((e) => e.data.day === day)
                    .map((e) => (
                      <button
                        key={e.id}
                        className="ledger-row"
                        onClick={() => open("expense", e)}
                      >
                        <span className="row-main">
                          <strong>{str(e, "title")}</strong>
                          <small>
                            {name(e.data.categoryId)}
                            {e.data.subcategoryId
                              ? " / " + name(e.data.subcategoryId)
                              : ""}
                            {e.data.mode !== "immediate" ? " · 长期使用" : ""}
                          </small>
                        </span>
                        {!e.data.necessary && (
                          <span className="pill">非必要</span>
                        )}
                        <span
                          className={
                            "amount" + (net(e) < 0n ? " negative" : "")
                          }
                        >
                          {money(net(e))}
                        </span>
                      </button>
                    ))}
                </div>
              </section>
            ))}
          {!monthly.length && <Empty text="记录这个月的第一笔消费" />}
        </Panel>
        <div className="stack">
          <section className="finance-summary">
            <div className="figure">
              <small>本月实际净付款</small>
              <strong>{money(total)}</strong>
              <span>
                {month === monthNow()
                  ? "按目前节奏，月底约 " + money(projected)
                  : "共 " + monthly.length + " 笔"}
              </span>
            </div>
            <div className="budget">
              <div className="budget-line">
                <span>预算 {money(budgetMinor)}</span>
                <span className="mono">
                  {budgetMinor > 0n ? percent.toFixed(1) + "%" : "未设置"}
                </span>
              </div>
              <div
                className={"budget-bar" + (percent > 100 ? " over" : "")}
                style={
                  {
                    "--value": Math.min(percent, 100) / 100,
                    "--pace": Math.min(elapsed / monthDays, 1),
                  } as React.CSSProperties
                }
              >
                <i />
                <b title="按日期应花到的位置" />
              </div>
              <div className="budget-legend">
                <span>必要 {money(necessary)}</span>
                <span>非必要 {money(total - necessary)}</span>
                <span>使用成本 {money(costTotal)}</span>
              </div>
            </div>
          </section>
          <Panel
            className="grow finance-tabs"
            title={
              {
                actual: "用途分布",
                usage: "月度使用成本",
                long: "长期使用",
                recurring: "每月固定支出 · 仅作参考",
                stats: "用途分布",
              }[tab] ?? ""
            }
            aside={
              <div className="segmented">
                {[
                  ["actual", "分布与趋势"],
                  ["usage", "使用成本"],
                  ["long", "长期使用"],
                  ["recurring", "固定支出"],
                ].map(([key, label]) => (
                  <button
                    className={
                      tab === key || (key === "actual" && tab === "stats")
                        ? "active"
                        : ""
                    }
                    onClick={() => setTab(key)}
                    key={key}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {tab === "actual" || tab === "stats" ? (
              <>
                <div className="category-bars">
                  {byCategory.map(({ c, sum }) => (
                    <button
                      key={c.id}
                      className={category === c.id ? "selected" : ""}
                      onClick={() => setCategory(category === c.id ? "" : c.id)}
                    >
                      <span>{str(c, "name")}</span>
                      <i
                        style={
                          {
                            "--value": Number((sum * 1000n) / top) / 1000,
                          } as React.CSSProperties
                        }
                      />
                      <strong>{money(sum)}</strong>
                      <small>
                        {total > 0n ? Number((sum * 100n) / total) + "%" : "—"}
                      </small>
                    </button>
                  ))}
                  {unclassified !== 0n && (
                    <button disabled>
                      <span>未分类</span>
                      <i
                        style={
                          {
                            "--value":
                              Number((unclassified * 1000n) / top) / 1000,
                          } as React.CSSProperties
                        }
                      />
                      <strong>{money(unclassified)}</strong>
                      <small />
                    </button>
                  )}
                  {!byCategory.length && <Empty text="记账后显示用途分布" />}
                </div>
                <Chart
                  label="每日实际净付款"
                  unit=" 元"
                  points={daysInMonth(month)
                    .filter((day) => day <= today())
                    .map((day) => ({
                      x: day,
                      y:
                        Number(
                          monthly
                            .filter((e) => e.data.day === day)
                            .reduce((n, e) => n + net(e), 0n),
                        ) / 100,
                    }))}
                />
                <Stats
                  items={[
                    [
                      "平均日消费",
                      cost.length ? money(total / BigInt(cost.length)) : "—",
                    ],
                    ["记录笔数", String(monthly.length)],
                    [
                      "最大一笔",
                      monthly.length
                        ? money(
                            monthly.reduce(
                              (m, e) => (net(e) > m ? net(e) : m),
                              0n,
                            ),
                          )
                        : "—",
                    ],
                  ]}
                />
              </>
            ) : tab === "usage" ? (
              <>
                <div className="segmented">
                  <button
                    className={!current ? "active" : ""}
                    onClick={() => setCurrent(false)}
                  >
                    按使用期限
                  </button>
                  <button
                    className={current ? "active" : ""}
                    onClick={() => setCurrent(true)}
                  >
                    按当下平均
                  </button>
                </div>
                <Stats
                  items={[
                    ["月度成本", money(costTotal)],
                    [
                      "日均成本",
                      cost.length
                        ? money(costTotal / BigInt(cost.length))
                        : "—",
                    ],
                    ["统计天数", String(cost.length)],
                  ]}
                />
                <Chart
                  label="每日使用成本"
                  unit=" 元"
                  points={cost.map((e) => ({
                    x: e.day,
                    y: Number(e.value) / 100,
                  }))}
                />
                <p className="muted-note">
                  当次消费加长期使用成本；长期原付款不会再次计入。按当下平均仅调整预计使用类，固定期限按完整期限。
                </p>
              </>
            ) : tab === "long" ? (
              <LongTerm
                view={longTerm(filtered, month, asOf)}
                current={month >= asOf.slice(0, 7)}
                asOf={asOf}
                history={history}
                setHistory={setHistory}
                open={(e) => open("expense", e)}
              />
            ) : (
              <>
                <div className="toolbar">
                  <span className="spacer" />
                  <button onClick={() => open("recurring")}>＋ 固定支出</button>
                </div>
                <div className="dense-list">
                  {recurring.map((e) => (
                    <div key={e.id}>
                      <button
                        className="row-main ghost"
                        onClick={() => open("recurring", e)}
                      >
                        <strong>{str(e, "name")}</strong>
                        <small>{e.data.active ? "启用" : "暂停"}</small>
                      </button>
                      <strong className="mono">
                        {money(str(e, "amountMinor", "0"))} / 月
                      </strong>
                    </div>
                  ))}
                  {!recurring.length && (
                    <Empty text="订阅、房租这类每月固定的支出" />
                  )}
                </div>
                <p className="muted-note">
                  这里只列出固定支出，实际付款时再记账，不会自动增加当月消费。
                </p>
              </>
            )}
          </Panel>
        </div>
      </div>
      {form && (
        <div className="modal-backdrop">
          <div className="modal">
            <header>
              <h2>
                {form === "expense"
                  ? "记一笔"
                  : form === "category"
                    ? "分类与默认选项"
                    : form === "budget"
                      ? "月度预算"
                      : "固定支出"}
              </h2>
              <button onClick={() => setForm(null)}>×</button>
            </header>
            {form === "expense" ? (
              <ExpenseEditor
                entity={editing}
                categories={categories}
                onClose={() => setForm(null)}
              />
            ) : form === "budget" ? (
              <form
                className="record-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  perform(
                    (budgetRecord
                      ? put(
                          "budget",
                          { month, amountMinor: minor(budget) },
                          budgetRecord,
                        )
                      : putKey("budget", month, {
                          month,
                          amountMinor: minor(budget),
                        })
                    ).then(() => setForm(null)),
                  );
                }}
              >
                <label>
                  {month} 预算（元）
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                  />
                </label>
                <button className="primary">保存</button>
              </form>
            ) : form === "category" ? (
              <>
                <div className="dense-list">
                  {categories.map((e) => (
                    <div key={e.id}>
                      <button onClick={() => setEditing(e)}>
                        {e.data.parentId ? name(e.data.parentId) + " / " : ""}
                        {str(e, "name")}
                      </button>
                      <small>
                        {e.data.necessary ? "默认必要" : "默认非必要"}
                      </small>
                    </div>
                  ))}
                </div>
                <RecordForm
                  key={editing?.id ?? "new-category"}
                  type="category"
                  entity={editing}
                  defaults={{ name: "", necessary: true }}
                  fields={[
                    { key: "name", label: "分类名称", required: true },
                    {
                      key: "parentId",
                      label: "所属分类",
                      type: "select",
                      options: [
                        ["", "顶级分类"],
                        ...categories
                          .filter(
                            (e) => !e.data.parentId && e.id !== editing?.id,
                          )
                          .map(
                            (e) => [e.id, str(e, "name")] as [string, string],
                          ),
                      ],
                    },
                    { key: "necessary", label: "默认必要", type: "checkbox" },
                    {
                      key: "defaultChildId",
                      label: "默认子分类",
                      type: "select",
                      options: [
                        ["", "不细分"],
                        ...categories
                          .filter((e) => e.data.parentId === editing?.id)
                          .map(
                            (e) => [e.id, str(e, "name")] as [string, string],
                          ),
                      ],
                    },
                  ]}
                  onSaved={() => setEditing(undefined)}
                  onCancel={() => setEditing(undefined)}
                  title={editing ? "保存分类" : "新增分类"}
                />
              </>
            ) : (
              <RecurringEditor
                entity={editing}
                categories={categories}
                onClose={() => setForm(null)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
export function ExpenseEditor({
  entity,
  categories,
  onClose,
}: {
  entity?: Entity;
  categories: Entity[];
  onClose: () => void;
}) {
  const first =
    categories.find((e) => !e.data.parentId && e.data.name === "餐饮") ??
    categories.find((e) => !e.data.parentId);
  const [draft, setDraft] = useState<Data>(
    entity?.data ?? {
      title: "",
      day: today(),
      amountMinor: "",
      categoryId: first?.id ?? "",
      subcategoryId: first?.data.defaultChildId ?? "",
      necessary: first?.data.necessary ?? true,
      mode: "immediate",
    },
  );
  const [amount, setAmount] = useState(
    entity ? (Number(str(entity, "amountMinor", "0")) / 100).toFixed(2) : "",
  );
  const [recovery, setRecovery] = useState(
    entity ? (Number(str(entity, "recoveryMinor", "0")) / 100).toFixed(2) : "",
  );
  const [error, setError] = useState("");
  const set = (key: string, value: Data[string]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return (
    <form
      className="record-form"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const data: Data = { ...draft, amountMinor: minor(amount) };
          if (recovery) data.recoveryMinor = minor(recovery);
          for (const key of Object.keys(data))
            if (data[key] === "") delete data[key];
          perform(put("expense", data, entity).then(onClose));
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <label>
        消费内容
        <input
          required
          value={String(draft.title)}
          onChange={(e) => set("title", e.target.value)}
        />
      </label>
      <label>
        日期
        <input
          type="date"
          required
          value={String(draft.day)}
          onChange={(e) => set("day", e.target.value)}
        />
      </label>
      <label>
        金额（元）
        <input
          required
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label>
        用途
        <select
          value={String(draft.categoryId ?? "")}
          onChange={(e) => {
            const category = categories.find((c) => c.id === e.target.value);
            setDraft((d) => ({
              ...d,
              categoryId: e.target.value,
              subcategoryId: category?.data.defaultChildId ?? "",
              necessary: category?.data.necessary ?? true,
            }));
          }}
        >
          <option value="">未分类</option>
          {categories
            .filter((e) => !e.data.parentId)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {str(e, "name")}
              </option>
            ))}
        </select>
      </label>
      <label>
        细分类（可不选）
        <select
          value={String(draft.subcategoryId ?? "")}
          onChange={(e) => set("subcategoryId", e.target.value)}
        >
          <option value="">不细分</option>
          {categories
            .filter((e) => e.data.parentId === draft.categoryId)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {str(e, "name")}
              </option>
            ))}
        </select>
      </label>
      <label>
        必要性
        <select
          value={draft.necessary ? "yes" : "no"}
          onChange={(e) => set("necessary", e.target.value === "yes")}
        >
          <option value="yes">必要</option>
          <option value="no">非必要</option>
        </select>
      </label>
      <label>
        消费方式
        <select
          value={String(draft.mode)}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              mode: e.target.value,
              ...(e.target.value === "immediate"
                ? {}
                : {
                    startDay: d.startDay ?? today(),
                    endDay: d.endDay ?? today(),
                  }),
            }))
          }
        >
          <option value="immediate">当次消费</option>
          <option value="estimated">预计长期使用</option>
          <option value="fixed">固定期限</option>
        </select>
      </label>
      {draft.mode !== "immediate" && (
        <>
          <label>
            开始使用
            <input
              required
              type="date"
              value={String(draft.startDay ?? "")}
              onChange={(e) => set("startDay", e.target.value)}
            />
          </label>
          <label>
            {draft.mode === "fixed" ? "固定到期日期" : "预计使用到"}
            <input
              required
              type="date"
              min={String(draft.startDay ?? "")}
              value={String(draft.endDay ?? "")}
              onChange={(e) => set("endDay", e.target.value)}
            />
          </label>
          {entity && (
            <details>
              <summary>结束使用 / 出售</summary>
              <label>
                实际结束日期
                <input
                  type="date"
                  min={String(draft.startDay ?? "")}
                  value={String(draft.endedDay ?? "")}
                  onChange={(e) => set("endedDay", e.target.value)}
                />
              </label>
              <label>
                回收金额（元）
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                />
              </label>
              <label>
                实际回收日期
                <input
                  type="date"
                  value={String(draft.recoveryDay ?? "")}
                  onChange={(e) => set("recoveryDay", e.target.value)}
                />
              </label>
            </details>
          )}
        </>
      )}
      {error && <p className="inline-error">{error}</p>}
      <button className="primary">保存这笔记录</button>
      {entity && (
        <button
          type="button"
          onClick={() => perform(remove(entity).then(onClose))}
        >
          移入回收站
        </button>
      )}
    </form>
  );
}
function RecurringEditor({
  entity,
  categories,
  onClose,
}: {
  entity?: Entity;
  categories: Entity[];
  onClose: () => void;
}) {
  const [name, setName] = useState(str(entity, "name"));
  const [amount, setAmount] = useState(
    (Number(str(entity, "amountMinor", "0")) / 100).toFixed(2),
  );
  return (
    <form
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        perform(
          put(
            "recurringExpense",
            { name, amountMinor: minor(amount), active: true },
            entity,
          ).then(onClose),
        );
      }}
    >
      <label>
        固定支出名称
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        每月金额
        <input
          required
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <button className="primary">保存参考支出</button>
      {entity && (
        <button
          type="button"
          onClick={() =>
            perform(
              put(
                "recurringExpense",
                { ...entity.data, active: !entity.data.active },
                entity,
              ).then(onClose),
            )
          }
        >
          {entity.data.active ? "暂停" : "启用"}
        </button>
      )}
    </form>
  );
}

/** Long-term items seen from the selected month; every figure is as of today. */
function LongTerm({
  view,
  current,
  asOf,
  history,
  setHistory,
  open,
}: {
  view: { shown: Entity[]; hidden: Entity[] };
  current: boolean;
  asOf: string;
  history: boolean;
  setHistory: (v: boolean) => void;
  open: (e: Entity) => void;
}) {
  const inUse = view.shown.filter((e) => !isHistory(e, asOf));
  const sum = (currentBasis: boolean) =>
    money(
      round(
        inUse.reduce(
          (total, e) => add(total, daily(e, asOf, currentBasis) ?? { n: 0n, d: 1n }),
          { n: 0n, d: 1n },
        ),
      ),
    );
  const avg = (e: Entity, currentBasis: boolean) => {
    const value = daily(e, asOf, currentBasis);
    return value ? money(round(value)) : "—";
  };
  const item = (e: Entity) => {
    const ended = isHistory(e, asOf);
    const end = effectiveEnd(e, asOf);
    const used = dayCount(str(e, "startDay"), end < asOf ? end : asOf);
    const planned = dayCount(str(e, "startDay"), str(e, "endDay"));
    return (
      <div key={e.id} className={ended ? "ended" : ""}>
        <header>
          <button onClick={() => open(e)}>
            <strong>{str(e, "title")}</strong>
          </button>
          <span>{ended ? "已结束" : e.data.mode === "fixed" ? "固定期限" : "预计使用"}</span>
        </header>
        <div className="long-meter">
          <i style={{ width: `${Math.min(100, (used / Math.max(1, planned)) * 100)}%` }} />
        </div>
        <small>
          {str(e, "startDay")} — {ended ? end : str(e, "endDay")} ·{" "}
          {ended ? `用了 ${used} 天` : `已用 ${used} / ${planned} 天`}
        </small>
        <Stats
          items={[
            ["净使用成本", money(net(e))],
            ["期限日均", avg(e, false)],
            ["当下日均", avg(e, true)],
          ]}
        />
      </div>
    );
  };
  return (
    <>
      <Stats
        items={[
          ["期限日均", sum(false)],
          ["当下日均", sum(true)],
          [current ? "使用中" : "当月在用", `${view.shown.length} 件`],
        ]}
      />
      {!current && (
        <p className="muted-note">当月在用的长期物品；仍在用的按截至今天计算，已结束的保留结束时的数据。</p>
      )}
      <div className="long-list">
        {view.shown.map(item)}
        {!view.shown.length && (
          <Empty text={current ? "没有使用中的长期物品" : "这个月没有在用的长期物品"} />
        )}
      </div>
      {view.hidden.length > 0 && (
        <>
          <button className="ghost long-toggle" onClick={() => setHistory(!history)}>
            {history ? "收起" : "展开"}已结束 · {view.hidden.length}
          </button>
          {history && <div className="long-list">{view.hidden.map(item)}</div>}
        </>
      )}
    </>
  );
}
