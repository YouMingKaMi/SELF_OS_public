import React, { useMemo, useState } from "react";
import "./life.css";
import { Lunar, Solar } from "lunar-typescript";
import { metricDays } from "../../../../modules/metrics/index.ts";
import { checklistItems, runFields, runState, type ChecklistItem } from "../../../../modules/tasks/index.ts";
import {
  useDatedEntities,
  useEntities,
  put,
  putKey,
  remove,
  type AnyEntity as Entity,
} from "../data/entities.ts";
import {
  Heading,
  Panel,
  Empty,
  RecordForm,
  Stats,
  Chart,
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
import { useMobileDetail } from "../ui/mobile-detail.ts";
/** 14-day sparkline. Missing days are gaps, never zeros. */
function Spark({
  values,
  min,
  max,
}: {
  values: (number | null)[];
  min: number;
  max: number;
}) {
  const w = 84,
    h = 20,
    span = max - min || 1;
  const x = (i: number) => (i / Math.max(values.length - 1, 1)) * (w - 4) + 2;
  const y = (v: number) => h - 2 - ((v - min) / span) * (h - 4);
  let path = "",
    open = false;
  values.forEach((v, i) => {
    if (v === null) {
      open = false;
      return;
    }
    path += (open ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1);
    open = true;
  });
  const last = values.findLastIndex((v) => v !== null);
  return (
    <svg className="spark" width={w} height={h} aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.3" />
      {values.map((v, i) =>
        v === null ? null : (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r={i === last ? 2.2 : 1.1}
            fill="currentColor"
          />
        ),
      )}
    </svg>
  );
}
export function Metrics() {
  const { entities } = useEntities("metric", "metricLog");
  const metrics = entities.filter((e) => e.type === "metric");
  const [selected, setSelected] = useState("");
  const metric = metrics.find((e) => e.id === selected) ?? metrics[0];
  const [day, setDay] = useState(today());
  const [month, setMonth] = useState(monthNow());
  const [period, setPeriod] = useState("month");
  const [form, setForm] = useState(false);
  const [editing, setEditing] = useState<Entity>();
  const readings = useMemo(
    () => metricDays(entities.filter((e) => e.type === "metricLog")),
    [entities],
  );
  const logs = metric ? readings.get(metric.id) : undefined;
  const days =
    period === "month"
      ? daysInMonth(month)
      : Array.from({ length: 90 }, (_, i) => {
          const date = new Date(today() + "T00:00:00Z");
          date.setUTCDate(date.getUTCDate() - 89 + i);
          return date.toISOString().slice(0, 10);
        });
  const visible = days.map((d) => logs?.get(d));
  const values = visible.flatMap((entry) => entry?.value == null ? [] : [entry.value]);
  const monthly = new Map<string, { sum: number; count: number }>();
  for (const [day, entry] of logs ?? []) {
    if (entry.value === null) continue;
    const month = day.slice(0, 7);
    const stats = monthly.get(month) ?? { sum: 0, count: 0 };
    monthly.set(month, { sum: stats.sum + entry.value, count: stats.count + 1 });
  }
  async function record(m: Entity, value: number) {
    const candidates = readings.get(m.id)?.get(day)?.candidates ?? [];
    if (candidates.length > 1 || !Number.isFinite(value)) return;
    const [existing] = candidates;
    const data = { metricId: m.id, day, value };
    if (existing) await put("metricLog", { ...existing.data, value }, existing);
    else await putKey("metricLog", m.id + ":" + day, data);
  }
  const recent = useMemo(() => {
    const window = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(day + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - 13 + i);
      return d.toISOString().slice(0, 10);
    });
    const byMetric = new Map<string, (number | null)[]>();
    for (const m of metrics)
      byMetric.set(
        m.id,
        window.map((d) => readings.get(m.id)?.get(d)?.value ?? null),
      );
    return byMetric;
  }, [entities, readings, day]);
  const average = values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
  const mobileDetail = useMobileDetail(
    metric ? str(metric, "name") : "统计趋势",
  );
  return (
    <>
      {mobileDetail.showList && (
      <Heading
        eyebrow="DAILY SIGNALS"
        title="每日指标"
        description="每天几秒钟，长期看见自己的状态。缺失的日子不计入平均。"
      >
        <button
          className="primary"
          onClick={() => {
            setEditing(undefined);
            setForm(true);
          }}
        >
          ＋ 自定义指标
        </button>
      </Heading>
      )}
      <div className="columns metrics">
        {mobileDetail.showList && (
        <Panel
          title="当日记录"
          aside={<DayPicker label="记录日期" value={day} onChange={setDay} />}
        >
          <div className="metric-list">
            {metrics.map((m) => {
              const reading = readings.get(m.id)?.get(day);
              const duplicate = (reading?.candidates.length ?? 0) > 1;
              const lower = num(m, "minimum", -100_000);
              const upper = num(m, "maximum", 1e12);
              return (
                <div
                  key={m.id}
                  className={
                    "metric-row" + (m.id === metric?.id ? " selected" : "")
                  }
                >
                  <button
                    className="row-main"
                    onClick={() => {
                      setSelected(m.id);
                      mobileDetail.openDetail();
                    }}
                  >
                    <strong>{str(m, "name")}</strong>
                    <small>
                      {num(m, "minimum")}–{num(m, "maximum", 100)}{" "}
                      {str(m, "unit")}
                    </small>
                  </button>
                  <Spark
                    values={recent.get(m.id) ?? []}
                    min={lower}
                    max={upper}
                  />
                  <input
                    aria-label={str(m, "name")}
                    type="number"
                    min={lower}
                    max={upper}
                    step="any"
                    placeholder="—"
                    defaultValue={reading?.value ?? ""}
                    key={m.id + day + (reading?.candidates[0]?.version ?? 0)}
                    disabled={duplicate}
                    onFocus={() => setSelected(m.id)}
                    onBlur={(e) => {
                      if (e.target.value !== "" && Number(e.target.value) !== reading?.value)
                        perform(record(m, Number(e.target.value)));
                    }}
                  />
                  <button
                    className="muted"
                    onClick={() => {
                      setEditing(m);
                      setForm(true);
                    }}
                  >
                    编辑
                  </button>
                </div>
              );
            })}
            {!metrics.length && <Empty text="添加睡眠、心情或你关心的指标" />}
          </div>
          <p className="muted-note">
            输入后离开即保存；右侧小图是最近 14 天，空白表示没有记录。
          </p>
        </Panel>
        )}
        {mobileDetail.showDetail && (
        <Panel
          title={str(metric, "name", "统计")}
          aside={
            <>
              <div className="segmented">
                {[
                  ["month", "按月"],
                  ["quarter", "近 90 天"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={period === key ? "active" : ""}
                    onClick={() => setPeriod(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {period === "month" && (
                <Month value={month} onChange={setMonth} />
              )}
            </>
          }
        >
          <Stats
            items={[
              ["有记录天数", values.length + " / " + days.length],
              [
                "平均",
                average === null
                  ? "—"
                  : average.toFixed(2) + " " + str(metric, "unit"),
              ],
              ["最高", values.length ? String(Math.max(...values)) : "—"],
              ["最低", values.length ? String(Math.min(...values)) : "—"],
            ]}
          />
          <Chart
            label={str(metric, "name")}
            unit={str(metric, "unit")}
            points={days.map((day, index) => ({
              x: day,
              y: visible[index]?.value ?? null,
            }))}
          />
          {visible.some((entry) => (entry?.candidates.length ?? 0) > 1) && (
            <div className="dense-list">
              <div className="label">待核对的重复记录</div>
              {visible.flatMap((entry) => (entry?.candidates.length ?? 0) > 1 ? entry!.candidates : []).map((row) => (
                <div key={row.id}>
                  <span>{row.data.day} · {row.data.value ?? "未填数值"}</span>
                  <small>{row.data.note || row.id}</small>
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="label">月均</div>
            <div className="dense-list">
              {[...monthly].sort(([a], [b]) => b.localeCompare(a))
                .map(([month, stats]) => {
                  return (
                    <div key={month}>
                      <span className="mono">{month}</span>
                      <small>{stats.count} 天</small>
                      <strong>
                        {(stats.sum / stats.count).toFixed(2)}{" "}
                        {str(metric, "unit")}
                      </strong>
                    </div>
                  );
                })}
            </div>
          </div>
        </Panel>
        )}
      </div>
      {form && (
        <div className="modal-backdrop">
          <div className="modal">
            <header>
              <h2>指标定义</h2>
              <button onClick={() => setForm(false)}>×</button>
            </header>
            <RecordForm
              type="metric"
              entity={editing}
              defaults={{ name: "", unit: "分", minimum: 0, maximum: 10 }}
              fields={[
                { key: "name", label: "名称", required: true },
                { key: "unit", label: "单位" },
                { key: "minimum", label: "最小值", type: "number" },
                { key: "maximum", label: "最大值", type: "number" },
              ]}
              onSaved={() => setForm(false)}
              onCancel={() => setForm(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
import { nextOccurrence } from "./calendar-model.ts";
export function ImportantDays() {
  const { entities } = useEntities("importantDay");
  const [editing, setEditing] = useState<Entity>();
  const [form, setForm] = useState(false);
  const [scope, setScope] = useState<"upcoming" | "all">("upcoming");
  const ordered = entities
    .map((e) => {
      const next = nextOccurrence(e);
      const days = next ? Math.round((Date.parse(next) - Date.parse(today())) / 86400000) : null;
      return { e, next, days };
    })
    .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
  const shown = scope === "upcoming" ? ordered.filter((row) => row.days !== null && row.days >= 0) : ordered;
  const repeatName: Record<string, string> = {
    once: "仅一次",
    weekly: "每周",
    monthly: "每月",
    yearly: "每年",
    custom: "自定义",
  };
  const original = (e: Entity) =>
    e.data.calendar === "lunar"
      ? `农历 ${e.data.leap ? "闰" : ""}${lunarMonths[num(e, "lunarMonth") - 1] ?? ""}${lunarDays[num(e, "lunarDay") - 1] ?? ""}`
      : `公历 ${str(e, "date").slice(0, 4)}年${Number(str(e, "date").slice(5, 7))}月${Number(str(e, "date").slice(8, 10))}日`;
  const open = (e?: Entity) => {
    setEditing(e);
    setForm(true);
  };
  return (
    <>
      <Heading eyebrow="DAYS THAT MATTER" title="重要日子">
        <button className="primary" onClick={() => open()}>
          ＋ 添加日子
        </button>
      </Heading>
      <div className="days-toolbar">
        <div className="segmented">
          <button className={scope === "upcoming" ? "active" : ""} onClick={() => setScope("upcoming")}>
            即将到来
          </button>
          <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>
            全部 {entities.length}
          </button>
        </div>
      </div>
      <div className="day-cards">
        {shown.map(({ e, next, days }) => {
          const once = e.data.repeat === "once";
          return (
            <article key={e.id} className={"day-card" + (days !== null && days <= num(e, "remindDays") ? " soon" : "")}>
              <header>
                <h3>{str(e, "name")}</h3>
                <button className="ghost" aria-label="编辑" onClick={() => open(e)}>
                  ···
                </button>
              </header>
              <button className="day-count" onClick={() => open(e)}>
                {days === null ? (
                  <span>日期待确认</span>
                ) : days === 0 ? (
                  <strong>就是今天</strong>
                ) : days < 0 ? (
                  <span>
                    已过 <strong>{-days}</strong> 天
                  </span>
                ) : (
                  <span>
                    还有 <strong>{days}</strong> 天
                  </span>
                )}
              </button>
              <div className="day-meta">
                <span>
                  {original(e)}
                  {once ? "" : " · " + (repeatName[str(e, "repeat")] ?? str(e, "repeat"))}
                </span>
                <span>提前 {num(e, "remindDays")} 天提醒</span>
              </div>
              <footer>{(once ? "日期 · " : "下次 · ") + (next ?? "—")}</footer>
              {str(e, "note") && <p className="day-card-note">{str(e, "note")}</p>}
            </article>
          );
        })}
        {!shown.length && <Empty text={scope === "upcoming" ? "近期没有要到来的日子" : "生日、纪念日与想记住的日子"} />}
      </div>
      {form && (
        <div className="modal-backdrop">
          <div className="modal">
            <header>
              <h2>重要日子</h2>
              <button onClick={() => setForm(false)}>×</button>
            </header>
            <DayEditor entity={editing} onClose={() => setForm(false)} />
            {editing && (
              <div className="form-actions">
                <button
                  className="danger"
                  onClick={() => {
                    perform(remove(editing));
                    setForm(false);
                  }}
                >
                  删除这个日子
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
const lunarMonths = [
  "正月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "冬月",
  "腊月",
];
const lunarDays = [
  "初一",
  "初二",
  "初三",
  "初四",
  "初五",
  "初六",
  "初七",
  "初八",
  "初九",
  "初十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
  "廿一",
  "廿二",
  "廿三",
  "廿四",
  "廿五",
  "廿六",
  "廿七",
  "廿八",
  "廿九",
  "三十",
];
function DayEditor({
  entity,
  onClose,
}: {
  entity?: Entity;
  onClose: () => void;
}) {
  const [name, setName] = useState(str(entity, "name"));
  const [calendar, setCalendar] = useState(str(entity, "calendar", "solar"));
  const [date, setDate] = useState(str(entity, "date", today()));
  const [view, setView] = useState(str(entity, "date", today()).slice(0, 7));
  const [repeat, setRepeat] = useState(str(entity, "repeat", "yearly"));
  const [interval, setInterval] = useState(num(entity, "interval", 1));
  const [unit, setUnit] = useState(str(entity, "intervalUnit", "year"));
  const [remind, setRemind] = useState(num(entity, "remindDays", 3));
  const [note, setNote] = useState(str(entity, "note"));
  const [error, setError] = useState("");
  let lunar: Lunar | undefined;
  try {
    const [y, m, d] = date.split("-").map(Number);
    lunar = Solar.fromYmd(y, m, d).getLunar();
  } catch {}
  const [year, month] = view.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const cells = Array.from({ length: 42 }, (_, index) => {
    const cell = new Date(start);
    cell.setUTCDate(start.getUTCDate() + index);
    const day = cell.toISOString().slice(0, 10);
    let label = "";
    try {
      const l = Solar.fromYmd(
        cell.getUTCFullYear(),
        cell.getUTCMonth() + 1,
        cell.getUTCDate(),
      ).getLunar();
      label =
        l.getDay() === 1 ? l.getMonthInChinese() + "月" : l.getDayInChinese();
    } catch {}
    return { day, date: cell, label };
  });
  function shift(amount: number) {
    const d = new Date(Date.UTC(year, month - 1 + amount, 1));
    setView(d.toISOString().slice(0, 7));
  }
  return (
    <form
      className="record-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!lunar) {
          setError("请在日历中选择有效日期");
          return;
        }
        perform(
          put(
            "importantDay",
            {
              name,
              calendar,
              date,
              repeat,
              interval,
              intervalUnit: unit,
              remindDays: remind,
              note,
              lunarYear: lunar.getYear(),
              lunarMonth: Math.abs(lunar.getMonth()),
              lunarDay: lunar.getDay(),
              leap: lunar.getMonth() < 0,
            },
            entity,
          ).then(onClose),
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
        按哪种历法记录
        <select value={calendar} onChange={(e) => setCalendar(e.target.value)}>
          <option value="solar">公历</option>
          <option value="lunar">农历</option>
        </select>
      </label>
      <div className="date-picker">
        <header>
          <button type="button" aria-label="上个月" onClick={() => shift(-1)}>
            ‹
          </button>
          <input
            type="month"
            aria-label="日历月份"
            value={view}
            min="1900-01"
            max="2100-12"
            onChange={(e) => {
              if (e.target.value) setView(e.target.value);
            }}
          />
          <button type="button" aria-label="下个月" onClick={() => shift(1)}>
            ›
          </button>
        </header>
        <div className="calendar-week">
          {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="calendar-days">
          {cells.map((cell) => (
            <button
              type="button"
              key={cell.day}
              className={
                (cell.day === date ? "selected " : "") +
                (cell.day.slice(0, 7) !== view ? "outside" : "")
              }
              onClick={() => setDate(cell.day)}
            >
              <strong>{cell.date.getUTCDate()}</strong>
              <small>{cell.label}</small>
            </button>
          ))}
        </div>
        <p>
          {calendar === "lunar" && lunar
            ? `农历 ${lunar.getYear()}年 ${lunar.getMonthInChinese()}月${lunar.getDayInChinese()} · `
            : ""}
          公历 {date}
        </p>
      </div>
      <label>
        也可直接选择公历日期
        <input
          type="date"
          required
          value={date}
          min="1900-01-01"
          max="2100-12-31"
          onChange={(e) => {
            setDate(e.target.value);
            if (e.target.value) setView(e.target.value.slice(0, 7));
          }}
        />
      </label>
      <label>
        重复
        <select value={repeat} onChange={(e) => setRepeat(e.target.value)}>
          <option value="once">仅这一次</option>
          <option value="weekly">每周</option>
          <option value="monthly">每月</option>
          <option value="yearly">每年</option>
          <option value="custom">自定义间隔</option>
        </select>
      </label>
      {repeat === "custom" && (
        <div className="date-range">
          <label>
            每隔
            <input
              type="number"
              min="1"
              max="1000"
              required
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            />
          </label>
          <label>
            单位
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="day">天</option>
              <option value="week">周</option>
              <option value="month">月</option>
              <option value="year">年</option>
            </select>
          </label>
        </div>
      )}
      <p className="muted-note">
        月末缺日按该月最后一天；农历闰月年份不存在时跳过该次。
      </p>
      <label>
        提前几天在首页提醒
        <input
          type="number"
          min="0"
          max="3650"
          value={remind}
          onChange={(e) => setRemind(Number(e.target.value))}
        />
      </label>
      <label>
        备注
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="inline-error">{error}</p>}
      <button className="primary">保存日子</button>
    </form>
  );
}
export function Checklists() {
  const { entities: templates } = useEntities("checklist");
  const [selected, setSelected] = useState("");
  const current = templates.find((e) => e.id === selected) ?? templates[0];
  const [form, setForm] = useState(false);
  const [editing, setEditing] = useState<Entity>();
  const day = today();
  const todayRuns = useDatedEntities(day, day, "checklistRun");
  const run = todayRuns.reduce<Entity | undefined>((latest, row) => {
    if (row.data.checklistId !== current?.id) return latest;
    if (!latest) return row;
    const order = Date.parse(row.updatedAt) - Date.parse(latest.updatedAt) ||
      row.version - latest.version || latest.id.localeCompare(row.id);
    return order > 0 ? row : latest;
  }, undefined);
  const state = runState(
    { items: arr(current, "items"), itemIds: arr(current, "itemIds") },
    run && {
      checked: arr(run, "checked"),
      itemIds: Array.isArray(run.data.itemIds) ? arr(run, "itemIds") : undefined,
      itemLabels: Array.isArray(run.data.itemLabels) ? arr(run, "itemLabels") : undefined,
      checkedItemIds: Array.isArray(run.data.checkedItemIds) ? arr(run, "checkedItemIds") : undefined,
      ambiguousChecked: arr(run, "ambiguousChecked"),
    },
  );
  async function saveChecks(checked: Set<string>) {
    if (!current) return;
    const data = { checklistId: current.id, day, ...runFields(state.items, checked, state.ambiguous) };
    if (run) await put("checklistRun", data, run);
    else await putKey("checklistRun", current.id + ":" + day, data);
  }
  function toggle(id: string) {
    const checked = new Set(state.checked);
    if (!checked.delete(id)) checked.add(id);
    return saveChecks(checked);
  }
  const mobileDetail = useMobileDetail(
    current ? str(current, "name") : "准备清单",
  );
  return (
    <>
      {mobileDetail.showList && (
      <Heading
        eyebrow="READY TO GO"
        title="准备清单"
        description="出门、洗澡、睡前。勾选只属于今天这一次，不会改动清单本身。"
      >
        <button
          className="primary"
          onClick={() => {
            setEditing(undefined);
            setForm(true);
          }}
        >
          ＋ 新场景
        </button>
      </Heading>
      )}
      <div className="columns reader checklists">
        {mobileDetail.showList && (
        <Panel title="场景">
          <div className="article-list">
            {templates.map((e) => (
              <button
                key={e.id}
                className={current?.id === e.id ? "selected" : ""}
                onClick={() => {
                  setSelected(e.id);
                  mobileDetail.openDetail();
                }}
              >
                <strong>{str(e, "name")}</strong>
                <small>{arr(e, "items").length} 项</small>
                {current?.id === e.id && (
                  <span
                    className="progress-bar"
                    style={
                      {
                        "--value":
                          state.checked.size / Math.max(state.items.length, 1),
                      } as React.CSSProperties
                    }
                  />
                )}
              </button>
            ))}
          </div>
        </Panel>
        )}
        {mobileDetail.showDetail && (
        <Panel
          title={
            current
              ? str(current, "name") +
                " · " +
                state.checked.size +
                " / " +
                state.items.length
              : "选择一个场景"
          }
          aside={
            current && (
              <div>
                <button
                  onClick={() => {
                    setEditing(current);
                    setForm(true);
                  }}
                >
                  编辑清单
                </button>
                <button
                  disabled={!state.checked.size}
                  onClick={() => perform(saveChecks(new Set()))}
                >
                  重置本次
                </button>
              </div>
            )
          }
        >
          {!!state.ambiguous.size && (
            <p className="muted-note">旧记录需核对，请确认当时勾选的是哪一项。{[...state.ambiguous].join("、")}</p>
          )}
          {current ? (
            state.items.map((item) => (
              <button
                className="checklist-item"
                key={item.id}
                aria-pressed={state.checked.has(item.id)}
                onClick={() => perform(toggle(item.id))}
              >
                <span
                  className={
                    state.checked.has(item.id) ? "box checked" : "box"
                  }
                >
                  {state.checked.has(item.id) ? "✓" : ""}
                </span>
                {item.label}
              </button>
            ))
          ) : (
            <Empty text="创建出门、洗澡或睡前清单" />
          )}
        </Panel>
        )}
      </div>
      {form && (
        <div className="modal-backdrop">
          <div className="modal">
            <header>
              <h2>准备清单</h2>
              <button onClick={() => setForm(false)}>×</button>
            </header>
            <ChecklistEditor
              entity={editing}
              onSaved={(id) => {
                setSelected(id);
                setForm(false);
                mobileDetail.openDetail();
              }}
              onCancel={() => setForm(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}

function ChecklistEditor({ entity, onSaved, onCancel }: {
  entity?: Entity;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(str(entity, "name"));
  const [text, setText] = useState("");
  const [items, setItems] = useState<ChecklistItem[]>(() =>
    checklistItems({ items: arr(entity, "items"), itemIds: arr(entity, "itemIds") }),
  );
  const [saving, setSaving] = useState(false);
  return (
    <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      if (saving || !name.trim()) return;
      const rows = entity ? items.map((item) => ({ ...item, label: item.label.trim() })).filter((item) => item.label)
        : text.split(/\r?\n/).map((label) => label.trim()).filter(Boolean)
          .map((label) => ({ id: crypto.randomUUID(), label }));
      if (!rows.length) return;
      setSaving(true);
      perform(put("checklist", {
        name: name.trim(), items: rows.map((item) => item.label), itemIds: rows.map((item) => item.id),
      }, entity).then(onSaved).finally(() => setSaving(false)));
    }}>
      <label>
        场景名称
        <input required value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {entity ? (
        <>
          {items.map((item, index) => (
            <label key={item.id}>
              项目 {index + 1}
              <input value={item.label} onChange={(event) => {
                const label = event.target.value;
                setItems((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, label } : entry));
              }} />
            </label>
          ))}
          <button type="button" onClick={() => setItems((previous) => [
            ...previous, { id: crypto.randomUUID(), label: "" },
          ])}>添加项目</button>
        </>
      ) : (
        <label>
          每行一个要准备的东西
          <textarea required value={text} onChange={(event) => setText(event.target.value)} />
        </label>
      )}
      <button type="button" onClick={onCancel}>取消</button>
      <button className="primary" disabled={saving || (entity ? !items.some((item) => item.label.trim()) : !text.trim())}>保存</button>
    </form>
  );
}
