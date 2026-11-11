import React, { useState } from "react";
import "./habits.css";
import {
  useEntities,
  put,
  putKey,
  type AnyEntity as Entity,
} from "../data/entities.ts";
import {
  Heading,
  Panel,
  Empty,
  Chart,
  BarChart,
  Stats,
  Month,
  DayPicker,
  monthNow,
  today,
  str,
  num,
  arr,
  perform,
  daysInMonth,
} from "../ui/shared.tsx";
export function habitRule(habit: Entity, day: string, all: Entity[]) {
  return all
    .filter(
      (e) =>
        e.type === "habitRule" &&
        e.data.habitId === habit.id &&
        str(e, "effectiveFrom") <= day,
    )
    .sort(
      (a, b) =>
        str(b, "effectiveFrom").localeCompare(str(a, "effectiveFrom")) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )[0];
}
export function habitDone(
  habit: Entity,
  log: Entity | undefined,
  rule: Entity | undefined,
) {
  if (!log) return false;
  if ((rule?.data.kind ?? habit.data.kind) === "binary")
    return num(log, "value") > 0;
  if ((rule?.data.kind ?? habit.data.kind) === "checklist")
    return (rule?.data.items ? arr(rule, "items") : arr(habit, "items")).every(
      (item) => arr(log, "items").includes(item),
    );
  return num(log, "value") >= num(rule, "target", 1);
}
export function HabitRow({
  habit,
  day,
  all,
  home = false,
}: {
  habit: Entity;
  day: string;
  all: Entity[];
  home?: boolean;
}) {
  const logs = all.filter(
    (e) =>
      e.type === "habitLog" &&
      e.data.habitId === habit.id &&
      e.data.day === day &&
      !e.deleted,
  );
  const log = logs[0];
  const rule = log?.data.ruleId
    ? all.find((e) => e.id === log.data.ruleId)
    : habitRule(habit, day, all);
  const kind = String(rule?.data.kind ?? habit.data.kind),
    items = rule?.data.items ? arr(rule, "items") : arr(habit, "items");
  const done = habitDone(habit, log, rule);
  async function save(value: number, items = arr(log, "items")) {
    const data = {
      habitId: habit.id,
      day,
      ...(rule ? { ruleId: rule.id } : {}),
      value,
      items,
      hidden: Boolean(log?.data.hidden),
    };
    if (log) await put("habitLog", data, log);
    else await putKey("habitLog", habit.id + ":" + day, data);
  }
  if (home && (log?.data.hidden || (done && kind === "binary"))) return null;
  const ratio =
    kind === "quantity"
      ? Math.min(
          num(log, "value") / Math.max(num(rule, "target", 1), 0.0001),
          1,
        )
      : kind === "checklist"
        ? arr(log, "items").filter((x) => items.includes(x)).length /
          Math.max(items.length, 1)
        : done
          ? 1
          : 0;
  return (
    <div className={"habit-line" + (done ? " done" : "")}>
      <span
        className="habit-ring"
        style={{ "--value": ratio } as React.CSSProperties}
        aria-hidden="true"
      />
      <div className="habit-name">
        <strong>{str(habit, "name")}</strong>
        <small>
          {kind === "quantity"
            ? `${num(log, "value")} / ${num(rule, "target", 1)} ${str(habit, "unit")}`
            : done
              ? "已完成"
              : habit.data.status === "paused"
                ? "计划暂停 · 可随手记录"
                : "待记录"}
        </small>
      </div>
      <div className="habit-controls">
        {kind === "binary" ? (
          <button
            className={done ? "checked-button" : ""}
            onClick={() => perform(save(done ? 0 : 1))}
          >
            {done ? "已打卡" : "打卡"}
          </button>
        ) : kind === "checklist" ? (
          items.map((item) => (
            <button
              className={
                arr(log, "items").includes(item) ? "checked-button" : ""
              }
              key={item}
              onClick={() => {
                const selected = arr(log, "items");
                const next = selected.includes(item)
                  ? selected.filter((x) => x !== item)
                  : [...selected, item];
                perform(save(next.length, next));
              }}
            >
              {arr(log, "items").includes(item) ? "✓" : "＋"} {item}
            </button>
          ))
        ) : (
          <>
            <button
              aria-label={"减少 " + str(habit, "name")}
              onClick={() => perform(save(Math.max(0, num(log, "value") - 1)))}
            >
              −
            </button>
            <input
              aria-label={"数量 " + str(habit, "name")}
              type="number"
              min="0"
              step="any"
              value={num(log, "value")}
              onChange={(e) => {
                if (e.target.value !== "")
                  perform(save(Number(e.target.value)));
              }}
            />
            <button
              aria-label={"增加 " + str(habit, "name")}
              onClick={() => perform(save(num(log, "value") + 1))}
            >
              ＋
            </button>
            {home && done && log && (
              <button
                onClick={() =>
                  perform(put("habitLog", { ...log.data, hidden: true }, log))
                }
              >
                收起
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
export function Habits() {
  const { entities } = useEntities("habit", "habitRule", "habitLog");
  const [day, setDay] = useState(today());
  const [month, setMonth] = useState(monthNow());
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState<Entity | null | undefined>(undefined);
  const habits = entities.filter(
    (e) => e.type === "habit" && (archived || e.data.status !== "archived"),
  );
  const habit = habits.find((e) => e.id === selected) ?? habits[0];
  const logs = entities.filter(
    (e) =>
      e.type === "habitLog" &&
      e.data.habitId === habit?.id &&
      str(e, "day").startsWith(month),
  );
  const values = logs.map((e) => num(e, "value"));
  const days = daysInMonth(month);
  const lead = days.length ? new Date(days[0] + "T12:00:00Z").getUTCDay() : 0;
  const ruleFor = (log: Entity) =>
    entities.find((e) => e.id === log.data.ruleId) ??
    (habit ? habitRule(habit, str(log, "day"), entities) : undefined);
  const completed = logs.filter(
    (log) => habit && habitDone(habit, log, ruleFor(log)),
  ).length;
  const kind = str(habit, "kind", "binary");
  const recordedDays = new Set(logs.map((e) => e.data.day)).size;
  // Days of this month that have already begun; the rate is never diluted by the future.
  const elapsed = days.filter((d) => d <= today()).length || days.length;
  const doneDays = new Set(
    entities
      .filter((e) => e.type === "habitLog" && e.data.habitId === habit?.id && habit && habitDone(habit, e, ruleFor(e)))
      .map((e) => str(e, "day")),
  );
  const streaks = (() => {
    const sorted = [...doneDays].sort();
    let longest = 0,
      run = 0,
      previous = "";
    for (const d of sorted) {
      run = previous && Date.parse(d) - Date.parse(previous) === 86400000 ? run + 1 : 1;
      longest = Math.max(longest, run);
      previous = d;
    }
    let current = 0;
    for (let cursor = doneDays.has(today()) ? today() : shiftDay(today(), -1); doneDays.has(cursor); cursor = shiftDay(cursor, -1))
      current++;
    return { current, longest };
  })();
  // The month's latest plan lists the items; anything checked earlier in the month stays visible.
  const monthRule = habit ? habitRule(habit, days.at(-1) ?? today(), entities) : undefined;
  const checklistItems = habit
    ? [
        ...new Set([
          ...(monthRule?.data.items ? arr(monthRule, "items") : arr(habit, "items")),
          ...logs.flatMap((log) => arr(log, "items")),
        ]),
      ]
    : [];
  const total = values.reduce((a, b) => a + b, 0);
  const monthStats: [string, string][] =
    kind === "quantity"
      ? [
          ["记录天数", recordedDays + " / " + days.length],
          ["完成天数", String(completed)],
          ["合计", total + " " + str(habit, "unit")],
          ["有记录日均", values.length ? (total / values.length).toFixed(2) : "—"],
        ]
      : kind === "checklist"
        ? [
            ["有记录天数", recordedDays + " / " + elapsed],
            ["全部完成", completed + " 天"],
            ["完成率", Math.round((completed / elapsed) * 100) + "%"],
            ["当前连续", streaks.current + " 天"],
          ]
        : [
            ["打卡天数", completed + " / " + elapsed],
            ["完成率", Math.round((completed / elapsed) * 100) + "%"],
            ["当前连续", streaks.current + " 天"],
            ["最长连续", streaks.longest + " 天"],
          ];
  const scheduleText = (e: Entity) => {
    const rule = habitRule(e, day, entities);
    const weekdays = arr(rule, "weekdays");
    const plan =
      weekdays.length === 7 || !rule
        ? "每天"
        : weekdays.length
          ? "周" +
            ["0", "1", "2", "3", "4", "5", "6"]
              .filter((d) => weekdays.includes(d))
              .map((d) => "日一二三四五六"[Number(d)])
              .join("")
          : "未安排";
    return e.data.status === "paused"
      ? "计划暂停"
      : e.data.status === "optional"
        ? "随手记录"
        : e.data.status === "archived"
          ? "已停用"
          : plan;
  };
  return (
    <>
      <Heading
        eyebrow="SMALL THINGS, OVER TIME"
        title="习惯记录库"
        description="左边记录某一天，右边看这个习惯的整个月。历史按当时的规则计算。"
      >
        <button onClick={() => setArchived(!archived)}>
          {archived ? "隐藏停用" : "查看停用"}
        </button>
        <button className="primary" onClick={() => setEditing(null)}>
          ＋ 添加习惯
        </button>
      </Heading>
      <div className="columns habits">
        <Panel
          title="记录与计划"
          aside={
            <DayPicker label="习惯记录日期" value={day} onChange={setDay} />
          }
        >
          <div className="habit-list">
            {habits.length === 0 && <Empty text="添加一个希望留下记录的习惯" />}
            {habits.map((e) => (
              <section
                className={
                  habit?.id === e.id
                    ? "habit-section selected"
                    : "habit-section"
                }
                key={e.id}
                onClick={(event) => {
                  if (
                    !(event.target as HTMLElement).closest(
                      "button,input,select,textarea",
                    )
                  )
                    setSelected(e.id);
                }}
              >
                <HabitRow habit={e} day={day} all={entities} />
                <div className="habit-section-heading">
                  <span className="pill">{scheduleText(e)}</span>
                  {e.data.showHome ? <span className="pill">首页</span> : null}
                  <span className="row-tools">
                    <button onClick={() => setSelected(e.id)}>统计</button>
                    <button onClick={() => setEditing(e)}>编辑计划</button>
                    <button
                      onClick={() =>
                        perform(
                          put(
                            "habit",
                            {
                              ...e.data,
                              status:
                                e.data.status === "paused"
                                  ? "active"
                                  : "paused",
                            },
                            e,
                          ),
                        )
                      }
                    >
                      {e.data.status === "paused" ? "恢复计划" : "暂停计划"}
                    </button>
                  </span>
                </div>
              </section>
            ))}
          </div>
        </Panel>
        <Panel
          title={habit ? str(habit, "name") + " · 本月" : "月度统计"}
          aside={<Month value={month} onChange={setMonth} />}
        >
          <Stats items={monthStats} />
          <div className="habit-calendar">
            {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
              <span key={d} className="weekday">
                {d}
              </span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <span key={"lead" + i} />
            ))}
            {days.map((date) => {
              const log = logs.find((e) => e.data.day === date);
              const done = !!(
                log &&
                habit &&
                habitDone(habit, log, ruleFor(log))
              );
              return (
                <button
                  onClick={() => setDay(date)}
                  className={
                    (done ? "done " : log ? "recorded " : "") +
                    (date === day ? "current " : "") +
                    (date === today() ? "today" : "")
                  }
                  key={date}
                  title={date}
                >
                  <span>{Number(date.slice(-2))}</span>
                  <small>
                    {log
                      ? habit?.data.kind === "quantity"
                        ? num(log, "value")
                        : done
                          ? "✓"
                          : "·"
                      : ""}
                  </small>
                </button>
              );
            })}
          </div>
          {kind === "quantity" && (
          <BarChart
              label="每日记录"
              unit={habit?.data.kind === "quantity" ? " " + str(habit, "unit") : ""}
              note="未记录按 0 显示；亮色为当天达成，灰色为有记录但未达成。"
              points={days.map((date) => {
                const log = logs.find((e) => e.data.day === date);
                const done = !!(log && habit && habitDone(habit, log, ruleFor(log)));
                const value = log
                  ? habit?.data.kind === "checklist"
                    ? (Array.isArray(log.data.items) ? log.data.items.length : num(log, "value"))
                    : log.data.value !== undefined
                      ? num(log, "value")
                      : done
                        ? 1
                        : 0
                  : null;
                return { x: date, y: value, done };
              })}
            />
          )}
          {kind === "checklist" && habit && (
            <ItemMatrix items={checklistItems} days={days} logs={logs} />
          )}
        </Panel>
      </div>
      {editing !== undefined && (
        <div className="modal-backdrop">
          <div className="modal">
            <header>
              <h2>{editing ? "编辑习惯与安排" : "添加习惯"}</h2>
              <button onClick={() => setEditing(undefined)}>×</button>
            </header>
            <HabitEditor
              habit={editing ?? undefined}
              all={entities}
              onClose={() => setEditing(undefined)}
            />
          </div>
        </div>
      )}
    </>
  );
}
function HabitEditor({
  habit,
  all,
  onClose,
}: {
  habit?: Entity;
  all: Entity[];
  onClose: () => void;
}) {
  const current = habit ? habitRule(habit, today(), all) : undefined;
  const [name, setName] = useState(str(habit, "name"));
  const [kind, setKind] = useState(
    str(current, "kind", str(habit, "kind", "binary")),
  );
  const [unit, setUnit] = useState(str(habit, "unit"));
  const [items, setItems] = useState(arr(habit, "items").join("\n"));
  const [status, setStatus] = useState(str(habit, "status", "active"));
  const [show, setShow] = useState(habit?.data.showHome ?? true);
  const [target, setTarget] = useState(num(current, "target", 1));
  const [weekdays, setWeekdays] = useState<string[]>(
    current ? arr(current, "weekdays") : ["1", "2", "3", "4", "5", "6", "0"],
  );
  const [effective, setEffective] = useState(today());
  const [error, setError] = useState("");
  return (
    <form
      className="record-form"
      onSubmit={(event) => {
        event.preventDefault();
        perform(
          (async () => {
            if (!name.trim()) throw new Error("请填写名称");
            const ruleChanged =
              !habit ||
              kind !== (current?.data.kind ?? habit.data.kind) ||
              target !== num(current, "target", 1) ||
              JSON.stringify([...weekdays].sort()) !==
                JSON.stringify([...arr(current, "weekdays")].sort()) ||
              unit !== (current?.data.unit ?? habit.data.unit) ||
              items !==
                (current?.data.items
                  ? arr(current, "items")
                  : arr(habit, "items")
                ).join("\n");
            if (
              habit &&
              ruleChanged &&
              all.some(
                (e) =>
                  e.type === "habitLog" &&
                  e.data.habitId === habit.id &&
                  str(e, "day") >= effective,
              )
            )
              throw new Error(
                "生效日及之后已有记录，请选尚未记录的日期；历史规则不会被覆盖",
              );
            const id = await put(
              "habit",
              {
                name,
                kind,
                unit,
                items: items.split("\n").filter(Boolean),
                status,
                showHome: Boolean(show),
                order: num(
                  habit,
                  "order",
                  all.filter((e) => e.type === "habit").length,
                ),
              },
              habit,
            );
            if (ruleChanged)
              await put("habitRule", {
                habitId: id,
                effectiveFrom: effective,
                target,
                weekdays,
                kind,
                unit,
                items: items.split("\n").filter(Boolean),
              });
            onClose();
          })().catch((e) => setError(e.message)),
        );
      }}
    >
      <label>
        名称
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        记录方式
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="binary">打卡</option>
          <option value="quantity">数量</option>
          <option value="checklist">多项清单</option>
        </select>
      </label>
      {kind === "quantity" && (
        <>
          <label>
            最低目标
            <input
              type="number"
              min="0.01"
              step="any"
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
          </label>
          <label>
            单位
            <input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
        </>
      )}
      {kind === "checklist" && (
        <label>
          每行一项
          <textarea
            required
            value={items}
            onChange={(e) => setItems(e.target.value)}
          />
        </label>
      )}
      <label>
        状态
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">按计划进行</option>
          <option value="paused">暂停计划（仍可记录）</option>
          <option value="optional">随手记录</option>
          <option value="archived">停用</option>
        </select>
      </label>
      <label className="check-field">
        今日主页显示
        <input
          type="checkbox"
          checked={Boolean(show)}
          onChange={(e) => setShow(e.target.checked)}
        />
      </label>
      <div className="weekdays">
        {["日", "一", "二", "三", "四", "五", "六"].map((label, i) => (
          <button
            type="button"
            key={i}
            className={weekdays.includes(String(i)) ? "selected" : ""}
            onClick={() =>
              setWeekdays(
                weekdays.includes(String(i))
                  ? weekdays.filter((x) => x !== String(i))
                  : [...weekdays, String(i)],
              )
            }
          >
            周{label}
          </button>
        ))}
      </div>
      <label>
        从哪天生效
        <input
          type="date"
          required
          value={effective}
          onChange={(e) => setEffective(e.target.value)}
        />
      </label>
      {error && <p className="inline-error">{error}</p>}
      <button className="primary">保存计划</button>
    </form>
  );
}

const shiftDay = (day: string, by: number) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

/** Checklist habits: one row per item, one cell per day, so each item's own rhythm is visible. */
function ItemMatrix({ items, days, logs }: { items: string[]; days: string[]; logs: Entity[] }) {
  const byDay = new Map(logs.map((log) => [str(log, "day"), arr(log, "items")]));
  const now = today();
  if (!items.length) return null;
  return (
    <div className="item-matrix">
      <div className="item-matrix-caption">
        <span>各项打卡</span>
        <small>本月每一项单独看</small>
      </div>
      <div className="item-matrix-grid" style={{ "--days": days.length } as React.CSSProperties}>
        <span />
        {days.map((d) => (
          <small key={d} className={d === now ? "today" : ""}>
            {Number(d.slice(-2)) % 5 === 0 || d === days[0] ? Number(d.slice(-2)) : ""}
          </small>
        ))}
        <span />
        {items.map((item) => {
          const count = days.filter((d) => byDay.get(d)?.includes(item)).length;
          const elapsed = days.filter((d) => d <= now).length || days.length;
          return (
            <React.Fragment key={item}>
              <strong title={item}>{item}</strong>
              {days.map((d) => (
                <i
                  key={d}
                  title={d + " · " + item + (byDay.get(d)?.includes(item) ? " ✓" : "")}
                  className={(byDay.get(d)?.includes(item) ? "on" : "") + (d > now ? " future" : "")}
                />
              ))}
              <em>
                {count}
                <small> / {elapsed} 天</small>
              </em>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
