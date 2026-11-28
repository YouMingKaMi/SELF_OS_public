import React, { useMemo, useRef, useState } from "react";
import {
  enqueueTogether,
  put,
  putKey,
  saveEdit,
  useEntities,
  type AnyEntity as Entity,
} from "../../data/entities.ts";
import { Icon } from "../../ui/Icon.tsx";
import { arr, monthNow, num, perform, str, today } from "../../ui/shared.tsx";
import {
  habitDone,
  habitRule,
  habitScheduled,
  habitTarget,
  habitWeekdays,
  latestHabitLogs,
} from "../habit-model.ts";
import {
  daysInMonth,
  InkActionSheet,
  InkBarChart,
  InkCard,
  InkDayStrip,
  InkEmpty,
  InkHairline,
  InkMonthBar,
  InkNavIcon,
  InkRing,
  InkScreen,
  InkSegmented,
  InkSheet,
  InkStatRow,
  InkSwitch,
  MobileToolbar,
  shiftDay,
} from "./MobileKit.tsx";
import "./mobile-habits.css";

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "0";
  return Math.abs(v - Math.round(v)) < 1e-6
    ? String(Math.round(v))
    : String(Math.round(v * 100) / 100);
}

/**
 * Exact 1:1 port of iPhone `HabitLine` (Habits.swift lines 6-124).
 * Zero inline edit/stats/pause buttons; zero `打卡` button clutter on binary habits.
 * Long-press opens the native context action sheet.
 */
export function MobileHabitLine({
  habit,
  day,
  all,
  onSelect,
  onContext,
}: {
  habit: Entity;
  day: string;
  all: Entity[];
  onSelect?: () => void;
  onContext?: () => void;
}) {
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const log = useMemo(
    () => latestHabitLogs(habit.id, all).get(day),
    [habit.id, all, day],
  );
  const rule =
    (log?.data.ruleId &&
      all.find(
        (e) =>
          e.type === "habitRule" &&
          !e.deleted &&
          e.id === log.data.ruleId &&
          e.data.habitId === habit.id,
      )) ||
    habitRule(habit, day, all);

  const kind = String(rule?.data.kind ?? habit.data.kind ?? "binary");
  const items = rule?.data.items ? arr(rule, "items") : arr(habit, "items");
  const target = habitTarget(rule);
  const unit = str(rule, "unit", str(habit, "unit"));
  const value = log && typeof log.data.value === "number" ? num(log, "value") : null;
  const checked = arr(log, "items");
  const done = habitDone(habit, log, rule);

  const progress =
    kind === "quantity"
      ? (value ?? 0) / Math.max(target, 0.0001)
      : kind === "checklist"
        ? checked.filter((x) => items.includes(x)).length /
          Math.max(items.length, 1)
        : done
          ? 1
          : 0;

  async function save(nextVal: number, nextItems?: string[]) {
    const data = {
      habitId: habit.id,
      day,
      ...(rule ? { ruleId: rule.id } : {}),
      value: nextVal,
      items: nextItems ?? checked,
      hidden: Boolean(log?.data.hidden),
    };
    if (log) await put("habitLog", data, log);
    else await putKey("habitLog", habit.id + ":" + day, data);
  }

  const caption =
    kind === "quantity"
      ? `${fmtNum(value ?? 0)} / ${fmtNum(target)}${unit ? " " + unit : ""}${done ? " · 已达成" : ""}`
      : habit.data.status === "paused"
        ? "计划暂停 · 可随手记录"
        : done
          ? "已完成"
          : "待记录";

  function clearPress() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  return (
    <div
      className="mh-line"
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        onSelect?.();
      }}
      onContextMenu={(e) => {
        if (!onContext) return;
        e.preventDefault();
        onContext();
      }}
      onTouchStart={() => {
        if (!onContext) return;
        longPressed.current = false;
        clearPress();
        pressTimer.current = window.setTimeout(() => {
          longPressed.current = true;
          onContext();
        }, 480);
      }}
      onTouchEnd={clearPress}
      onTouchMove={clearPress}
      onTouchCancel={clearPress}
    >
      <div className="mh-line-top">
        <InkRing
          progress={progress}
          done={done}
          label={str(habit, "name")}
          onClick={() => {
            if (kind === "binary") perform(save(done ? 0 : 1));
            else if (kind === "quantity" && !done) perform(save(target));
            else if (kind === "checklist" && !done && items.length > 0) {
              perform(save(items.length, items));
            }
          }}
        />
        <div className="mh-line-info">
          <span className="mh-line-title">{str(habit, "name")}</span>
          <span className="mh-line-cap">{caption}</span>
        </div>
        {kind === "quantity" && (
          <div
            className="mh-stepper"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="mh-step-btn"
              aria-label={"减少 " + str(habit, "name")}
              onClick={() => perform(save(Math.max(0, (value ?? 0) - 1)))}
            >
              <Icon name="minus" size={14} />
            </button>
            <button
              type="button"
              className="mh-step-val"
              aria-label={"输入 " + str(habit, "name") + " 数值"}
              onClick={() => {
                setTyped(value !== null ? fmtNum(value) : "");
                setTyping(true);
              }}
            >
              {fmtNum(value ?? 0)}
            </button>
            <button
              type="button"
              className="mh-step-btn"
              aria-label={"增加 " + str(habit, "name")}
              onClick={() => perform(save((value ?? 0) + 1))}
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
        )}
      </div>

      {kind === "checklist" && items.length > 0 && (
        <div
          className="mh-check-strip"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => {
            const on = checked.includes(item);
            return (
              <button
                key={item}
                type="button"
                className={"mh-check-pill" + (on ? " on" : "")}
                onClick={() => {
                  const next = on
                    ? checked.filter((x) => x !== item)
                    : [...checked, item];
                  perform(save(next.length, next));
                }}
              >
                <Icon name={on ? "check" : "plus"} size={11} />
                <span>{item}</span>
              </button>
            );
          })}
        </div>
      )}

      <InkSheet
        open={typing}
        title={str(habit, "name")}
        onClose={() => setTyping(false)}
        rightLabel="保存"
        onRight={() => {
          const parsed = Number(typed.replace(/[，,]/g, ".").trim());
          if (Number.isFinite(parsed) && parsed >= 0) {
            perform(save(parsed));
            setTyping(false);
          }
        }}
      >
        <div className="mk-form-group">
          <div className="mk-form-row">
            <span className="mk-form-label">
              今日数值{unit ? `（${unit}）` : ""}
            </span>
            <input
              className="mk-form-input right"
              inputMode="decimal"
              placeholder="0"
              value={typed}
              autoFocus
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        </div>
      </InkSheet>
    </div>
  );
}

/**
 * Exact 1:1 port of iPhone `HabitsScreen` (Habits.swift lines 126-187).
 */
export function MobileHabits() {
  const { entities } = useEntities("habit", "habitRule", "habitLog");
  const [day, setDay] = useState(today());
  const [month, setMonth] = useState(monthNow());
  const [selectedId, setSelectedId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Entity | null>(null);
  const [menuHabit, setMenuHabit] = useState<Entity | null>(null);

  const habits = useMemo(
    () =>
      entities
        .filter(
          (e) =>
            e.type === "habit" &&
            !e.deleted &&
            (showArchived || e.data.status !== "archived"),
        )
        .sort((a, b) => num(a, "order") - num(b, "order")),
    [entities, showArchived],
  );

  const focus = habits.find((h) => h.id === selectedId) ?? habits[0];

  const handleDayChange = (nextDay: string) => {
    setDay(nextDay);
    if (nextDay.slice(0, 7) !== month) setMonth(nextDay.slice(0, 7));
  };

  return (
    <InkScreen>
      <MobileToolbar>
        <InkNavIcon icon="plus" label="添加习惯" onClick={() => setAdding(true)} />
      </MobileToolbar>

      <InkDayStrip day={day} onChange={handleDayChange} />

      <InkCard variant="compact">
        {habits.map((h, idx) => (
          <React.Fragment key={h.id}>
            {idx > 0 && <InkHairline inset={34} />}
            <MobileHabitLine
              habit={h}
              day={day}
              all={entities}
              onSelect={() => setSelectedId(h.id)}
              onContext={() => setMenuHabit(h)}
            />
          </React.Fragment>
        ))}
        {habits.length === 0 && (
          <InkEmpty text="添加一个希望留下记录的习惯" />
        )}
      </InkCard>

      {focus && (
        <MonthCard
          habit={focus}
          all={entities}
          month={month}
          day={day}
          onMonthChange={setMonth}
          onDayChange={handleDayChange}
          onOpenMenu={() => setMenuHabit(focus)}
        />
      )}

      <button
        type="button"
        className="mk-text-btn"
        style={{ width: "100%" }}
        onClick={() => setShowArchived((v) => !v)}
      >
        {showArchived ? "隐藏已停用" : "查看已停用"}
      </button>

      <InkActionSheet
        open={menuHabit !== null}
        title={menuHabit ? str(menuHabit, "name") : undefined}
        onClose={() => setMenuHabit(null)}
        items={
          menuHabit
            ? [
                {
                  label: "查看本月",
                  icon: "calendar",
                  onClick: () => setSelectedId(menuHabit.id),
                },
                {
                  label: "编辑计划",
                  icon: "sliders",
                  onClick: () => setEditing(menuHabit),
                },
                {
                  label:
                    menuHabit.data.status === "paused" ? "恢复计划" : "暂停计划",
                  icon: menuHabit.data.status === "paused" ? "play" : "pause",
                  onClick: () => {
                    const nextStatus =
                      menuHabit.data.status === "paused" ? "active" : "paused";
                    perform(
                      saveEdit("habit", menuHabit.id, menuHabit.data, {
                        ...menuHabit.data,
                        status: nextStatus,
                      }),
                    );
                  },
                },
                {
                  label: menuHabit.data.showHome
                    ? "不在首页显示"
                    : "在首页显示",
                  icon: menuHabit.data.showHome ? "eye-off" : "eye",
                  onClick: () => {
                    perform(
                      saveEdit("habit", menuHabit.id, menuHabit.data, {
                        ...menuHabit.data,
                        showHome: !menuHabit.data.showHome,
                      }),
                    );
                  },
                },
              ]
            : []
        }
      />

      <HabitPlanSheet
        open={adding || editing !== null}
        habit={editing}
        all={entities}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />
    </InkScreen>
  );
}

function MonthCard({
  habit,
  all,
  month,
  day,
  onMonthChange,
  onDayChange,
  onOpenMenu,
}: {
  habit: Entity;
  all: Entity[];
  month: string;
  day: string;
  onMonthChange: (m: string) => void;
  onDayChange: (d: string) => void;
  onOpenMenu: () => void;
}) {
  const nowDay = today();
  const days = useMemo(() => daysInMonth(month), [month]);
  const logsByDay = useMemo(() => latestHabitLogs(habit.id, all), [habit.id, all]);

  const ruleFor = (d: string) => {
    const log = logsByDay.get(d);
    if (log?.data.ruleId) {
      const found = all.find(
        (e) =>
          e.type === "habitRule" &&
          !e.deleted &&
          e.id === log.data.ruleId &&
          e.data.habitId === habit.id,
      );
      if (found) return found;
    }
    return habitRule(habit, d, all);
  };

  const latestRule = ruleFor(days.at(-1) ?? nowDay);
  const kind = String(latestRule?.data.kind ?? habit.data.kind ?? "binary");
  const lead = useMemo(() => {
    const first = days[0];
    if (!first) return 0;
    return new Date(first + "T12:00:00Z").getUTCDay();
  }, [days]);

  const {
    recordedDays,
    completedDays,
    quantityTotals,
    quantityDays,
    elapsedRate,
    plannedRate,
    streak,
  } = useMemo(() => {
    let rec = 0;
    let comp = 0;
    let qDays = 0;
    const totals = new Map<string, number>();

    for (const d of days) {
      const log = logsByDay.get(d);
      const r = ruleFor(d);
      const k = String(r?.data.kind ?? habit.data.kind ?? "binary");
      if (log) {
        const hasVal =
          k === "checklist"
            ? arr(log, "items").length > 0
            : typeof log.data.value === "number" && num(log, "value") > 0;
        if (hasVal) rec++;
        if (habitDone(habit, log, r)) comp++;
        if (k === "quantity" && typeof log.data.value === "number" && num(log, "value") > 0) {
          qDays++;
          const u = str(r, "unit", str(habit, "unit"));
          totals.set(u, (totals.get(u) ?? 0) + num(log, "value"));
        }
      }
    }

    const elapsed = days.filter((d) => d <= nowDay);
    const planned = elapsed.filter((d) => habitScheduled(ruleFor(d), d));
    const calcRate = (dates: string[]) => {
      if (dates.length === 0) return "—";
      const ok = dates.filter((d) =>
        habitDone(habit, logsByDay.get(d), ruleFor(d)),
      ).length;
      return `${Math.round((ok / dates.length) * 100)}%`;
    };

    let cur = habitDone(habit, logsByDay.get(nowDay), ruleFor(nowDay))
      ? nowDay
      : shiftDay(nowDay, -1);
    let st = 0;
    while (
      st < 3660 &&
      habitDone(habit, logsByDay.get(cur), ruleFor(cur))
    ) {
      st++;
      cur = shiftDay(cur, -1);
    }

    return {
      recordedDays: rec,
      completedDays: comp,
      quantityTotals: [...totals.entries()],
      quantityDays: qDays,
      elapsedRate: calcRate(elapsed),
      plannedRate: calcRate(planned),
      streak: st,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, logsByDay, habit, all, nowDay]);

  const mixedUnits = quantityTotals.length > 1;
  const firstQty = quantityTotals[0];

  const stats =
    kind === "quantity"
      ? [
          { label: "记录", value: `${recordedDays}/${days.length}` },
          { label: "完成", value: `${completedDays}` },
          {
            label: "合计",
            value: mixedUnits
              ? "单位变更"
              : `${fmtNum(firstQty?.[1] ?? 0)}${firstQty?.[0] ? " " + firstQty[0] : ""}`,
          },
          {
            label: "有记录日均",
            value:
              mixedUnits || quantityDays === 0
                ? "—"
                : fmtNum((firstQty?.[1] ?? 0) / quantityDays),
          },
        ]
      : [
          {
            label: kind === "checklist" ? "全部完成" : "打卡",
            value: `${completedDays}/${days.length}`,
          },
          { label: "日历日", value: elapsedRate },
          { label: "计划日", value: plannedRate },
          { label: "连续", value: `${streak} 天` },
        ];

  const checklistItems = useMemo(() => {
    if (kind !== "checklist") return [];
    const planned = latestRule?.data.items
      ? arr(latestRule, "items")
      : arr(habit, "items");
    const extra = new Set<string>();
    for (const d of days) {
      const log = logsByDay.get(d);
      for (const it of arr(log, "items")) {
        if (!planned.includes(it)) extra.add(it);
      }
    }
    return [...planned, ...[...extra].sort()];
  }, [kind, latestRule, habit, days, logsByDay]);

  const barPoints = useMemo(() => {
    if (kind !== "quantity" || mixedUnits) return [];
    return days.map((d) => {
      const log = logsByDay.get(d);
      const r = ruleFor(d);
      const val =
        log && typeof log.data.value === "number" ? num(log, "value") : 0;
      return {
        x: d,
        y: val,
        highlight: habitDone(habit, log, r),
        label: String(Number(d.slice(-2))),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, mixedUnits, days, logsByDay, habit, all]);

  const elapsedCount = Math.max(1, days.filter((d) => d <= nowDay).length);

  return (
    <InkCard>
      <div className="mh-card-head">
        <span style={{ color: "var(--text-2)", display: "inline-flex" }}>
          <Icon name="calendar" size={15} />
        </span>
        <span className="mh-card-head-title">{str(habit, "name")}</span>
        <button
          type="button"
          className="mh-card-more"
          aria-label="习惯选项"
          onClick={onOpenMenu}
        >
          <Icon name="ellipsis" size={16} />
        </button>
      </div>

      <InkMonthBar month={month} onChange={onMonthChange} />
      <InkStatRow items={stats} />

      <div className="mh-cal-grid">
        {"日一二三四五六".split("").map((w) => (
          <span key={w} className="mh-cal-wday">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={"pad-" + i} />
        ))}
        {days.map((d) => {
          const log = logsByDay.get(d);
          const r = ruleFor(d);
          const done = habitDone(habit, log, r);
          const recorded =
            !done &&
            Boolean(
              log &&
                ((typeof log.data.value === "number" && num(log, "value") > 0) ||
                  arr(log, "items").length > 0),
            );
          return (
            <button
              key={d}
              type="button"
              className={
                "mh-cal-cell" +
                (done ? " done" : recorded ? " recorded" : "") +
                (d === day ? " selected" : "")
              }
              onClick={() => onDayChange(d)}
            >
              {Number(d.slice(-2))}
            </button>
          );
        })}
      </div>

      {kind === "checklist" && checklistItems.length > 0 && (
        <div className="mh-matrix">
          <div className="mh-matrix-label">各项打卡</div>
          {checklistItems.map((item) => {
            const count = days.filter((d) =>
              arr(logsByDay.get(d), "items").includes(item),
            ).length;
            return (
              <div className="mh-matrix-row" key={item}>
                <div className="mh-matrix-head">
                  <strong>{item}</strong>
                  <span>
                    <b>{count}</b> / {elapsedCount} 天
                  </span>
                </div>
                <div className="mh-matrix-bars">
                  {days.map((d) => {
                    const on = arr(logsByDay.get(d), "items").includes(item);
                    return (
                      <span
                        key={d}
                        className={
                          "mh-matrix-seg" +
                          (on ? " on" : "") +
                          (d > nowDay ? " future" : "")
                        }
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {kind === "quantity" &&
        !mixedUnits &&
        barPoints.some((p) => p.y > 0) && (
          <InkBarChart
            points={barPoints}
            label="每日数值"
            unit={firstQty?.[0] ? " " + firstQty[0] : ""}
            height={116}
          />
        )}
    </InkCard>
  );
}

function HabitPlanSheet({
  open,
  habit,
  all,
  onClose,
}: {
  open: boolean;
  habit: Entity | null;
  all: Entity[];
  onClose: () => void;
}) {
  const currentRule = habit ? habitRule(habit, today(), all) : undefined;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"binary" | "quantity" | "checklist">("binary");
  const [unit, setUnit] = useState("");
  const [items, setItems] = useState("");
  const [target, setTarget] = useState("1");
  const [weekdays, setWeekdays] = useState<string[]>([
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
  ]);
  const [status, setStatus] = useState("active");
  const [showHome, setShowHome] = useState(true);
  const [effective, setEffective] = useState(today());
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (!open) return;
    setError("");
    setEffective(today());
    if (!habit) {
      setName("");
      setKind("binary");
      setUnit("");
      setItems("");
      setTarget("1");
      setWeekdays(["0", "1", "2", "3", "4", "5", "6"]);
      setStatus("active");
      setShowHome(true);
      return;
    }
    const r = habitRule(habit, today(), all);
    setName(str(habit, "name"));
    setKind(
      (str(r, "kind", str(habit, "kind", "binary")) as
        | "binary"
        | "quantity"
        | "checklist"),
    );
    setUnit(str(r, "unit", str(habit, "unit")));
    setItems((r?.data.items ? arr(r, "items") : arr(habit, "items")).join("\n"));
    setTarget(String(habitTarget(r)));
    setWeekdays(habitWeekdays(r));
    setStatus(str(habit, "status", "active"));
    setShowHome(Boolean(habit.data.showHome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, habit?.id]);

  function toggleWeekday(k: string) {
    setWeekdays((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k].sort(),
    );
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const targetNum = Number(target);
    if (kind === "quantity" && (!Number.isFinite(targetNum) || targetNum <= 0)) {
      setError("最低目标必须大于 0");
      return;
    }
    const list = items
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const actualTarget = kind === "quantity" ? targetNum : 1;
    const sortedDays = [...weekdays].sort();
    const ruleChanged =
      !habit ||
      !currentRule ||
      kind !== String(currentRule.data.kind ?? habit.data.kind) ||
      actualTarget !== habitTarget(currentRule) ||
      JSON.stringify(sortedDays) !==
        JSON.stringify([...habitWeekdays(currentRule)].sort()) ||
      unit !== str(currentRule, "unit", str(habit, "unit")) ||
      list.join("\n") !==
        (currentRule.data.items ? arr(currentRule, "items") : arr(habit, "items")).join("\n");

    if (
      habit &&
      ruleChanged &&
      all.some(
        (e) =>
          e.type === "habitLog" &&
          !e.deleted &&
          e.data.habitId === habit.id &&
          str(e, "day") >= effective,
      )
    ) {
      setError("生效日及之后已有记录，请选尚未记录的日期");
      return;
    }

    const id = habit?.id ?? crypto.randomUUID();
    const definition = {
      ...habit?.data,
      name: trimmed,
      kind,
      unit,
      items: list,
      status,
      showHome,
      order: num(
        habit ?? undefined,
        "order",
        all.filter((e) => e.type === "habit").length,
      ),
    };

    perform(
      (async () => {
        if (ruleChanged) {
          const matching = habit ? habitRule(habit, effective, all) : undefined;
          const existing =
            matching?.data.effectiveFrom === effective ? matching : undefined;
          await enqueueTogether([
            {
              type: "habit",
              id,
              action: "put",
              data: definition,
              baseVersion: habit?.version ?? 0,
            },
            {
              type: "habitRule",
              id: existing?.id ?? crypto.randomUUID(),
              action: "put",
              baseVersion: existing?.version ?? 0,
              data: {
                ...existing?.data,
                habitId: id,
                effectiveFrom: effective,
                target: actualTarget,
                weekdays: sortedDays,
                kind,
                unit,
                items: list,
              },
            },
          ]);
        } else if (habit) {
          await saveEdit("habit", id, habit.data, definition);
        }
        onClose();
      })().catch((e) => setError(e instanceof Error ? e.message : "保存失败")),
    );
  }

  return (
    <InkSheet
      open={open}
      title={habit ? "编辑计划" : "添加习惯"}
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={!name.trim()}
      onRight={save}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <input
            className="mk-form-input"
            placeholder="习惯名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ fontSize: 17, fontWeight: 500 }}
          />
        </div>
        <div className="mk-form-row">
          <InkSegmented
            onCard
            options={[
              { value: "binary", label: "打卡" },
              { value: "quantity", label: "数量" },
              { value: "checklist", label: "多项" },
            ]}
            value={kind}
            onChange={setKind}
          />
        </div>
        {kind === "quantity" && (
          <>
            <div className="mk-form-row">
              <span className="mk-form-label">最低目标</span>
              <input
                className="mk-form-input right"
                inputMode="decimal"
                placeholder="1"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
            <div className="mk-form-row">
              <span className="mk-form-label">单位</span>
              <input
                className="mk-form-input right"
                placeholder="如 km / 分钟"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
          </>
        )}
        {kind === "checklist" && (
          <div className="mk-form-row col">
            <span className="mk-form-label">包含项目（每行一项）</span>
            <textarea
              className="mk-form-textarea"
              placeholder={"水果\n坚果\n鱼油"}
              value={items}
              onChange={(e) => setItems(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="mk-section-label">安排</div>
      <div className="mk-form-group">
        <div className="mk-form-row">
          <div className="mh-wdays">
            {"日一二三四五六".split("").map((lbl, idx) => {
              const k = String(idx);
              const on = weekdays.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  className={"mh-wday-btn" + (on ? " on" : "")}
                  onClick={() => toggleWeekday(k)}
                >
                  {lbl}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">状态</span>
          <select
            className="mk-form-select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="active">按计划</option>
            <option value="paused">暂停计划</option>
            <option value="optional">随手记录</option>
            <option value="archived">停用</option>
          </select>
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">在今日显示</span>
          <InkSwitch
            checked={showHome}
            onChange={setShowHome}
            label="在今日显示"
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">新规则从</span>
          <input
            type="date"
            className="mk-form-input right"
            value={effective}
            onChange={(e) => setEffective(e.target.value || today())}
          />
        </div>
      </div>

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 13, padding: "0 4px" }}>
          {error}
        </div>
      )}
    </InkSheet>
  );
}
