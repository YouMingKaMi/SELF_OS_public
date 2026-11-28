import React, { useEffect, useMemo, useState } from "react";
import { Lunar, LunarMonth, Solar } from "lunar-typescript";
import { metricDays } from "../../../../../modules/metrics/index.ts";
import {
  checklistItems,
  runFields,
  runState,
  type ChecklistItem,
} from "../../../../../modules/tasks/index.ts";
import {
  put,
  putKey,
  remove,
  useDatedEntities,
  useEntities,
  type AnyEntity as Entity,
} from "../../data/entities.ts";
import { Icon } from "../../ui/Icon.tsx";
import { arr, num, perform, str, today } from "../../ui/shared.tsx";
import { nextOccurrence } from "../calendar-model.ts";
import {
  InkActionSheet,
  InkCard,
  InkDayStrip,
  InkEmpty,
  InkHairline,
  InkLineChart,
  InkMeter,
  InkNavIcon,
  InkRing,
  InkScreen,
  InkSectionLabel,
  InkSegmented,
  InkSheet,
  InkSpark,
  InkStatRow,
  InkSwitch,
  MobileSubPage,
  MobileToolbar,
  shiftDay,
  type ActionSheetItem,
} from "./MobileKit.tsx";
import "./mobile-screens.css";

/* ─────────────────────────── Shared Format Helpers ─────────────────────────── */

const LUNAR_MONTHS = [
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

const LUNAR_DAYS = [
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

const REPEAT_LABELS: Record<string, string> = {
  once: "仅一次",
  weekly: "每周",
  monthly: "每月",
  yearly: "每年",
  custom: "自定义",
};

const UNIT_LABELS: Record<string, string> = {
  day: "天",
  week: "周",
  month: "月",
  year: "年",
};

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  return Number(n.toFixed(2)).toString();
}

function solarToLunarLabel(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return "";
    const l = Solar.fromYmd(y, m, d).getLunar();
    return `农历${l.getMonthInChinese()}月${l.getDayInChinese()}`;
  } catch {
    return "";
  }
}

function entityLunarLabel(e: Entity): string {
  const m = num(e, "lunarMonth");
  const d = num(e, "lunarDay");
  const monthText = LUNAR_MONTHS[m - 1] ?? "";
  const dayText = LUNAR_DAYS[d - 1] ?? "";
  if (!monthText || !dayText) return "农历";
  return `农历${e.data.leap ? "闰" : ""}${monthText}${dayText}`;
}

function repeatBadge(e: Entity): string {
  const rep = str(e, "repeat", "once");
  if (rep === "custom") {
    const iv = num(e, "interval", 1);
    const u = UNIT_LABELS[str(e, "intervalUnit", "day")] ?? "天";
    return `每${iv}${u}`;
  }
  return REPEAT_LABELS[rep] ?? rep;
}

/* ═══════════════════════════ 1. MobileImportantDays ═══════════════════════════ */

export function MobileImportantDays() {
  const { entities } = useEntities("importantDay");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Entity | undefined>(undefined);
  const nowDay = today();

  const { upcoming, past } = useMemo(() => {
    const rows = entities.map((e) => {
      const next = nextOccurrence(e, nowDay);
      const days = next
        ? Math.round((Date.parse(next) - Date.parse(nowDay)) / 86400000)
        : null;
      return { e, next, days };
    });

    const up = rows
      .filter((r) => r.days !== null && r.days >= 0)
      .sort(
        (a, b) =>
          (a.days ?? 1e9) - (b.days ?? 1e9) ||
          str(a.e, "name").localeCompare(str(b.e, "name"), "zh-CN"),
      );

    const old = rows
      .filter((r) => r.days === null || r.days < 0)
      .sort((a, b) => {
        if (a.days === null && b.days === null) return 0;
        if (a.days === null) return 1;
        if (b.days === null) return -1;
        return b.days - a.days;
      });

    return { upcoming: up, past: old };
  }, [entities, nowDay]);

  function openAdd() {
    setEditing(undefined);
    setSheetOpen(true);
  }

  function openEdit(entity: Entity) {
    setEditing(entity);
    setSheetOpen(true);
  }

  const hero = upcoming[0];
  const restUpcoming = upcoming.slice(1);

  return (
    <InkScreen>
      <MobileToolbar>
        <InkNavIcon icon="plus" label="添加重要日子" onClick={openAdd} />
      </MobileToolbar>

      {hero && hero.days !== null && (
        <InkCard className="mfx-hero-card" onClick={() => openEdit(hero.e)}>
          <div className="mfx-hero-eyebrow">下一个</div>
          <div className="mfx-hero-title">{str(hero.e, "name")}</div>
          <div className="mfx-hero-count">
            <span
              className={
                "mfx-hero-num" + (hero.days === 0 ? " today" : "")
              }
            >
              {hero.days === 0 ? "今天" : hero.days}
            </span>
            {hero.days > 0 && <span className="mfx-hero-unit">天后</span>}
          </div>
          <div className="mfx-hero-meta">
            {hero.next ?? "日期待检查"}
            {hero.next ? ` · ${solarToLunarLabel(hero.next)}` : ""}
            {hero.e.data.calendar === "lunar"
              ? ` · ${entityLunarLabel(hero.e)}`
              : ""}
            {` · ${repeatBadge(hero.e)}`}
          </div>
          {str(hero.e, "note") && (
            <div className="mfx-hero-note">{str(hero.e, "note")}</div>
          )}
        </InkCard>
      )}

      {restUpcoming.length > 0 && (
        <>
          <InkSectionLabel
            title="即将到来"
            aside={`${upcoming.length} 个`}
          />
          <InkCard variant="compact">
            {restUpcoming.map(({ e, next, days }, index) => {
              const remind = num(e, "remindDays", 0);
              const isSoon = days !== null && (days === 0 || days <= remind);
              const isLunar = e.data.calendar === "lunar";
              return (
                <React.Fragment key={e.id}>
                  {index > 0 && <InkHairline />}
                  <button
                    type="button"
                    className="mk-row"
                    onClick={() => openEdit(e)}
                  >
                    <div className="mk-row-main">
                      <div className="mk-row-title clamp-1">
                        {str(e, "name")}
                      </div>
                      <div className="mk-row-sub">
                        {next ?? "日期待检查"}
                        {isLunar ? ` · ${entityLunarLabel(e)}` : ""}
                        {` · ${repeatBadge(e)}`}
                      </div>
                    </div>
                    <div className="mk-row-right">
                      <span className="mfx-countdown">
                        <strong className={isSoon ? "warn" : ""}>
                          {days === 0 ? "今天" : days}
                        </strong>
                        {days !== null && days > 0 && <span>天</span>}
                      </span>
                    </div>
                  </button>
                </React.Fragment>
              );
            })}
          </InkCard>
        </>
      )}

      {past.length > 0 && (
        <>
          <InkSectionLabel
            title="已过 / 一次性"
            aside={`${past.length} 个`}
          />
          <InkCard variant="compact">
            {past.map(({ e, next, days }, index) => {
              const isLunar = e.data.calendar === "lunar";
              return (
                <React.Fragment key={e.id}>
                  {index > 0 && <InkHairline />}
                  <button
                    type="button"
                    className="mk-row"
                    onClick={() => openEdit(e)}
                  >
                    <div className="mk-row-main">
                      <div className="mk-row-title clamp-1">
                        {str(e, "name")}
                      </div>
                      <div className="mk-row-sub">
                        {next ?? str(e, "date", "日期待检查")}
                        {isLunar ? ` · ${entityLunarLabel(e)}` : ""}
                        {` · ${repeatBadge(e)}`}
                      </div>
                    </div>
                    <div className="mk-row-right">
                      <span className="mfx-countdown">
                        <strong className="muted">
                          {days === null ? "待检查" : `已过 ${Math.abs(days)} 天`}
                        </strong>
                      </span>
                    </div>
                  </button>
                </React.Fragment>
              );
            })}
          </InkCard>
        </>
      )}

      {entities.length === 0 && (
        <InkCard>
          <InkEmpty text="生日、纪念日与想记住的日子" />
        </InkCard>
      )}

      <ImportantDaySheet
        open={sheetOpen}
        entity={editing}
        onClose={() => setSheetOpen(false)}
      />
    </InkScreen>
  );
}

function ImportantDaySheet({
  open,
  entity,
  onClose,
}: {
  open: boolean;
  entity?: Entity;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [calendar, setCalendar] = useState<"solar" | "lunar">("solar");
  const [date, setDate] = useState(today());
  const [lunarYear, setLunarYear] = useState(2000);
  const [lunarMonth, setLunarMonth] = useState(1);
  const [lunarDay, setLunarDay] = useState(1);
  const [leap, setLeap] = useState(false);
  const [repeat, setRepeat] = useState<
    "once" | "weekly" | "monthly" | "yearly" | "custom"
  >("yearly");
  const [interval, setInterval] = useState(1);
  const [unit, setUnit] = useState<"day" | "week" | "month" | "year">("day");
  const [remindDays, setRemindDays] = useState(3);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    const baseDate = str(entity, "date", today());
    const cal = entity?.data.calendar === "lunar" ? "lunar" : "solar";
    setName(str(entity, "name"));
    setCalendar(cal);
    setDate(baseDate);
    setRepeat(
      (str(entity, "repeat", "yearly") as
        | "once"
        | "weekly"
        | "monthly"
        | "yearly"
        | "custom") || "yearly",
    );
    setInterval(Math.max(1, num(entity, "interval", 1)));
    setUnit(
      (str(entity, "intervalUnit", "day") as
        | "day"
        | "week"
        | "month"
        | "year") || "day",
    );
    setRemindDays(Math.max(0, num(entity, "remindDays", 3)));
    setNote(str(entity, "note"));
    setConfirmDelete(false);
    setSaving(false);

    if (entity && num(entity, "lunarYear") >= 1900) {
      setLunarYear(num(entity, "lunarYear"));
      setLunarMonth(Math.min(12, Math.max(1, num(entity, "lunarMonth", 1))));
      setLunarDay(Math.min(30, Math.max(1, num(entity, "lunarDay", 1))));
      setLeap(Boolean(entity.data.leap));
    } else {
      try {
        const [y, m, d] = baseDate.split("-").map(Number);
        const l = Solar.fromYmd(y, m, d).getLunar();
        setLunarYear(l.getYear());
        setLunarMonth(Math.abs(l.getMonth()));
        setLunarDay(l.getDay());
        setLeap(l.getMonth() < 0);
      } catch {
        const yNow = Number(today().slice(0, 4)) || 2026;
        setLunarYear(yNow);
        setLunarMonth(1);
        setLunarDay(1);
        setLeap(false);
      }
    }
  }, [open, entity]);

  const resolved = useMemo(() => {
    if (calendar === "solar") {
      try {
        const [y, m, d] = date.split("-").map(Number);
        if (!y || !m || !d || y < 1900 || y > 2100) {
          return { ok: false as const, error: "请选择 1900–2100 之间的公历日期" };
        }
        const l = Solar.fromYmd(y, m, d).getLunar();
        return {
          ok: true as const,
          solarDate: date,
          lunarYear: l.getYear(),
          lunarMonth: Math.abs(l.getMonth()),
          lunarDay: l.getDay(),
          leap: l.getMonth() < 0,
          preview: `农历 ${l.getYear()}年 ${l.getMonthInChinese()}月${l.getDayInChinese()}`,
        };
      } catch {
        return { ok: false as const, error: "公历日期无效" };
      }
    }

    if (lunarYear < 1900 || lunarYear > 2100) {
      return { ok: false as const, error: "农历年份需在 1900–2100 之间" };
    }
    const signedMonth = leap ? -lunarMonth : lunarMonth;
    const lm = LunarMonth.fromYm(lunarYear, signedMonth);
    if (!lm) {
      return {
        ok: false as const,
        error: leap
          ? `${lunarYear} 农历年没有闰${LUNAR_MONTHS[lunarMonth - 1] ?? lunarMonth + "月"}`
          : "农历日期无效",
      };
    }
    const maxDays = lm.getDayCount();
    const clampedDay = Math.min(Math.max(1, lunarDay), maxDays);
    try {
      const l = Lunar.fromYmd(lunarYear, signedMonth, clampedDay);
      const s = l.getSolar().toYmd();
      return {
        ok: true as const,
        solarDate: s,
        lunarYear,
        lunarMonth,
        lunarDay: clampedDay,
        leap,
        maxDays,
        preview: `公历 ${s}`,
      };
    } catch {
      return { ok: false as const, error: "农历日期无效" };
    }
  }, [calendar, date, lunarYear, lunarMonth, lunarDay, leap]);

  const lunarMaxDays = useMemo(() => {
    if (lunarYear < 1900 || lunarYear > 2100) return 30;
    const lm = LunarMonth.fromYm(lunarYear, leap ? -lunarMonth : lunarMonth);
    return lm ? lm.getDayCount() : 30;
  }, [lunarYear, lunarMonth, leap]);

  function handleCalendarChange(nextCal: "solar" | "lunar") {
    if (nextCal === calendar) return;
    if (nextCal === "lunar" && resolved.ok) {
      setLunarYear(resolved.lunarYear);
      setLunarMonth(resolved.lunarMonth);
      setLunarDay(resolved.lunarDay);
      setLeap(resolved.leap);
    } else if (nextCal === "solar" && resolved.ok) {
      setDate(resolved.solarDate);
    }
    setCalendar(nextCal);
  }

  const trimmedName = name.trim();
  const canSave = !saving && trimmedName.length > 0 && resolved.ok;

  function handleSave() {
    if (!canSave || !resolved.ok) return;
    setSaving(true);
    const payload = {
      ...(entity?.data.dismissedDate
        ? { dismissedDate: str(entity, "dismissedDate") }
        : {}),
      name: trimmedName,
      calendar,
      date: resolved.solarDate,
      lunarYear: resolved.lunarYear,
      lunarMonth: resolved.lunarMonth,
      lunarDay: resolved.lunarDay,
      leap: resolved.leap,
      repeat,
      interval: Math.max(1, Math.min(10000, Math.round(interval || 1))),
      intervalUnit: unit,
      remindDays: Math.max(0, Math.min(3650, Math.round(remindDays || 0))),
      note: note.trim(),
    };
    perform(
      put("importantDay", payload, entity)
        .then(() => onClose())
        .finally(() => setSaving(false)),
    );
  }

  return (
    <>
      <InkSheet
        open={open}
        title={entity ? "编辑日子" : "添加日子"}
        onClose={() => {
          if (!saving) onClose();
        }}
        rightLabel={saving ? "保存中" : "保存"}
        rightDisabled={!canSave}
        onRight={handleSave}
      >
        <div className="mk-form-group">
          <div className="mk-form-row">
            <span className="mk-form-label">名称</span>
            <input
              className="mk-form-input right"
              placeholder="如：妈妈生日、结婚纪念日"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="mk-form-row">
            <span className="mk-form-label">历法</span>
            <div style={{ width: 156 }}>
              <InkSegmented
                onCard
                value={calendar}
                onChange={handleCalendarChange}
                options={[
                  { value: "solar", label: "公历" },
                  { value: "lunar", label: "农历" },
                ]}
              />
            </div>
          </div>

          {calendar === "solar" ? (
            <>
              <div className="mk-form-row">
                <span className="mk-form-label">公历日期</span>
                <input
                  type="date"
                  className="mk-form-input right"
                  min="1900-01-01"
                  max="2100-12-31"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              {resolved.ok && (
                <div className="mk-form-row">
                  <span className="mk-form-label">对应农历</span>
                  <span className="mk-row-sub">{resolved.preview}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mk-form-row">
                <span className="mk-form-label">农历年</span>
                <input
                  type="number"
                  inputMode="numeric"
                  className="mk-form-input right"
                  min={1900}
                  max={2100}
                  value={lunarYear || ""}
                  onChange={(e) => setLunarYear(Number(e.target.value))}
                />
              </div>
              <div className="mk-form-row">
                <span className="mk-form-label">农历月</span>
                <select
                  className="mk-form-select"
                  value={lunarMonth}
                  onChange={(e) => setLunarMonth(Number(e.target.value))}
                >
                  {LUNAR_MONTHS.map((label, idx) => (
                    <option key={label} value={idx + 1}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mk-form-row">
                <span className="mk-form-label">农历日</span>
                <select
                  className="mk-form-select"
                  value={Math.min(lunarDay, lunarMaxDays)}
                  onChange={(e) => setLunarDay(Number(e.target.value))}
                >
                  {LUNAR_DAYS.slice(0, lunarMaxDays).map((label, idx) => (
                    <option key={label} value={idx + 1}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mk-form-row">
                <span className="mk-form-label">闰月</span>
                <InkSwitch checked={leap} onChange={setLeap} label="闰月" />
              </div>
              {resolved.ok && (
                <div className="mk-form-row">
                  <span className="mk-form-label">对应公历</span>
                  <span className="mk-row-sub">{resolved.preview}</span>
                </div>
              )}
            </>
          )}
        </div>

        {!resolved.ok && <p className="mfx-error">{resolved.error}</p>}

        <div className="mk-form-group">
          <div className="mk-form-row">
            <span className="mk-form-label">重复</span>
            <select
              className="mk-form-select"
              value={repeat}
              onChange={(e) =>
                setRepeat(
                  e.target.value as
                    | "once"
                    | "weekly"
                    | "monthly"
                    | "yearly"
                    | "custom",
                )
              }
            >
              <option value="once">仅一次</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
              <option value="yearly">每年</option>
              <option value="custom">自定义间隔</option>
            </select>
          </div>

          {repeat === "custom" && (
            <>
              <div className="mk-form-row">
                <span className="mk-form-label">间隔</span>
                <div className="mfx-stepper">
                  <button
                    type="button"
                    aria-label="减少间隔"
                    disabled={interval <= 1}
                    onClick={() => setInterval((v) => Math.max(1, v - 1))}
                  >
                    −
                  </button>
                  <span>{interval}</span>
                  <button
                    type="button"
                    aria-label="增加间隔"
                    onClick={() => setInterval((v) => Math.min(10000, v + 1))}
                  >
                    ＋
                  </button>
                </div>
              </div>
              <div className="mk-form-row col">
                <span className="mk-form-label">单位</span>
                <InkSegmented
                  onCard
                  value={unit}
                  onChange={setUnit}
                  options={[
                    { value: "day", label: "天" },
                    { value: "week", label: "周" },
                    { value: "month", label: "月" },
                    { value: "year", label: "年" },
                  ]}
                />
              </div>
            </>
          )}

          <div className="mk-form-row">
            <span className="mk-form-label">提前提醒</span>
            <div className="mfx-stepper">
              <button
                type="button"
                aria-label="减少提前天数"
                disabled={remindDays <= 0}
                onClick={() => setRemindDays((v) => Math.max(0, v - 1))}
              >
                −
              </button>
              <span>{remindDays} 天</span>
              <button
                type="button"
                aria-label="增加提前天数"
                onClick={() => setRemindDays((v) => Math.min(3650, v + 1))}
              >
                ＋
              </button>
            </div>
          </div>

          <div className="mk-form-row col">
            <span className="mk-form-label">备注</span>
            <textarea
              className="mk-form-textarea"
              placeholder="可选备注…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <p className="mfx-footnote">
          月末缺日按该月最后一天；农历闰月年份不存在时跳过该次。
        </p>

        {entity && (
          <button
            type="button"
            className="mk-pill danger lg full"
            onClick={() => setConfirmDelete(true)}
          >
            移入回收站
          </button>
        )}
      </InkSheet>

      <InkActionSheet
        open={confirmDelete}
        title={`将「${str(entity, "name")}」移入回收站？`}
        onClose={() => setConfirmDelete(false)}
        items={[
          {
            label: "移入回收站",
            icon: "trash",
            danger: true,
            onClick: () => {
              if (!entity) return;
              perform(remove(entity).then(() => onClose()));
            },
          },
        ]}
      />
    </>
  );
}

/* ═══════════════════════════ 2. MobileMetrics ═══════════════════════════ */

export function MobileMetrics() {
  const { entities } = useEntities("metric", "metricLog");
  const metrics = useMemo(
    () => entities.filter((e) => e.type === "metric"),
    [entities],
  );
  const allLogs = useMemo(
    () => entities.filter((e) => e.type === "metricLog"),
    [entities],
  );
  const readings = useMemo(() => metricDays(allLogs), [allLogs]);

  const [day, setDay] = useState(today());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [metricSheetOpen, setMetricSheetOpen] = useState(false);
  const [editingMetric, setEditingMetric] = useState<Entity | undefined>(
    undefined,
  );

  const markedDays = useMemo(() => {
    const set = new Set<string>();
    for (const log of allLogs) {
      const d = str(log, "day");
      if (d) set.add(d);
    }
    return set;
  }, [allLogs]);

  const recent14 = useMemo(() => {
    const window = Array.from({ length: 14 }, (_, i) => shiftDay(day, i - 13));
    const map = new Map<string, number[]>();
    for (const m of metrics) {
      const vals: number[] = [];
      for (const d of window) {
        const v = readings.get(m.id)?.get(d)?.value;
        if (v !== null && v !== undefined && Number.isFinite(v)) vals.push(v);
      }
      map.set(m.id, vals);
    }
    return map;
  }, [metrics, readings, day]);

  async function saveDayValue(metric: Entity, rawValue: number) {
    const candidates = readings.get(metric.id)?.get(day)?.candidates ?? [];
    if (candidates.length > 1 || !Number.isFinite(rawValue)) return;
    const [existing] = candidates;
    if (existing) {
      await put("metricLog", { ...existing.data, value: rawValue }, existing);
    } else {
      await putKey("metricLog", `${metric.id}:${day}`, {
        metricId: metric.id,
        day,
        value: rawValue,
      });
    }
  }

  const detailMetric = detailId
    ? metrics.find((m) => m.id === detailId)
    : undefined;

  if (detailMetric) {
    return (
      <>
        <MobileMetricDetail
          metric={detailMetric}
          allLogs={allLogs}
          readings={readings}
          onBack={() => setDetailId(null)}
          onEditMetric={() => {
            setEditingMetric(detailMetric);
            setMetricSheetOpen(true);
          }}
        />
        <MetricDefinitionSheet
          open={metricSheetOpen}
          entity={editingMetric}
          onClose={() => setMetricSheetOpen(false)}
          onDeleted={() => {
            setMetricSheetOpen(false);
            setDetailId(null);
          }}
        />
      </>
    );
  }

  return (
    <InkScreen>
      <MobileToolbar>
        <InkNavIcon
          icon="plus"
          label="添加指标"
          onClick={() => {
            setEditingMetric(undefined);
            setMetricSheetOpen(true);
          }}
        />
      </MobileToolbar>

      <InkDayStrip day={day} onChange={setDay} markedDays={markedDays} />

      <InkCard variant="compact">
        {metrics.map((m, index) => {
          const reading = readings.get(m.id)?.get(day);
          const duplicate = (reading?.candidates.length ?? 0) > 1;
          const lower = num(m, "minimum", 0);
          const upper = num(m, "maximum", 10);
          const unit = str(m, "unit");
          const sparkValues = recent14.get(m.id) ?? [];

          return (
            <React.Fragment key={m.id}>
              {index > 0 && <InkHairline />}
              <div className="mfx-metric-row">
                <button
                  type="button"
                  className="mfx-metric-hit"
                  onClick={() => setDetailId(m.id)}
                >
                  <div className="mk-row-main">
                    <div className="mk-row-title clamp-1">
                      {str(m, "name")}
                    </div>
                    <div className="mk-row-sub">
                      {formatNumber(lower)}–{formatNumber(upper)}
                      {unit ? ` ${unit}` : ""}
                    </div>
                  </div>
                  {sparkValues.length >= 2 && (
                    <div className="mfx-metric-spark">
                      <InkSpark values={sparkValues} width={52} height={22} />
                    </div>
                  )}
                </button>

                {duplicate ? (
                  <button
                    type="button"
                    className="mfx-badge warn"
                    onClick={() => setDetailId(m.id)}
                  >
                    待核对
                  </button>
                ) : (
                  <MetricQuickInput
                    key={`${m.id}:${day}:${reading?.candidates[0]?.version ?? 0}:${reading?.value ?? ""}`}
                    label={str(m, "name")}
                    value={reading?.value ?? null}
                    min={lower}
                    max={upper}
                    onCommit={(val) => perform(saveDayValue(m, val))}
                  />
                )}

                <button
                  type="button"
                  className="mfx-metric-chevron"
                  aria-label={`查看 ${str(m, "name")} 趋势`}
                  onClick={() => setDetailId(m.id)}
                >
                  <Icon name="chevron-right" size={16} />
                </button>
              </div>
            </React.Fragment>
          );
        })}

        {metrics.length === 0 && (
          <InkEmpty text="添加睡眠、心情或你关心的每日指标" />
        )}
      </InkCard>

      {metrics.length > 0 && (
        <p className="mfx-footnote">
          点击右侧数字直接录入，离开即保存；点名称或箭头查看 90 天趋势与记录明细。
        </p>
      )}

      <MetricDefinitionSheet
        open={metricSheetOpen}
        entity={editingMetric}
        onClose={() => setMetricSheetOpen(false)}
      />
    </InkScreen>
  );
}

function MetricQuickInput({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : formatNumber(value));

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(value === null ? "" : formatNumber(value));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < -100000) {
      setDraft(value === null ? "" : formatNumber(value));
      return;
    }
    if (value === null || Math.abs(parsed - value) > 1e-9) {
      onCommit(parsed);
    }
  }

  return (
    <input
      className="mfx-metric-input"
      aria-label={label}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step="any"
      placeholder="—"
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function MobileMetricDetail({
  metric,
  allLogs,
  readings,
  onBack,
  onEditMetric,
}: {
  metric: Entity;
  allLogs: Entity[];
  readings: ReturnType<typeof metricDays>;
  onBack: () => void;
  onEditMetric: () => void;
}) {
  const nowDay = today();
  const unit = str(metric, "unit");
  const metricDayMap = readings.get(metric.id);

  const [logSheetOpen, setLogSheetOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<Entity | undefined>(undefined);
  const [showAllLogs, setShowAllLogs] = useState(false);

  const days90 = useMemo(
    () => Array.from({ length: 90 }, (_, i) => shiftDay(nowDay, i - 89)),
    [nowDay],
  );
  const days30 = useMemo(() => days90.slice(-30), [days90]);

  const metricLogs = useMemo(
    () =>
      allLogs
        .filter((l) => l.data.metricId === metric.id)
        .sort(
          (a, b) =>
            str(b, "day").localeCompare(str(a, "day")) ||
            b.updatedAt.localeCompare(a.updatedAt),
        ),
    [allLogs, metric.id],
  );

  const stats = useMemo(() => {
    let latestValue: number | null = null;
    for (const log of metricLogs) {
      const v = log.data.value;
      if (typeof v === "number" && Number.isFinite(v)) {
        latestValue = v;
        break;
      }
    }

    const vals30: number[] = [];
    for (const d of days30) {
      const v = metricDayMap?.get(d)?.value;
      if (v !== null && v !== undefined && Number.isFinite(v)) vals30.push(v);
    }
    const avg30 = vals30.length
      ? vals30.reduce((sum, x) => sum + x, 0) / vals30.length
      : null;

    const vals90: number[] = [];
    for (const d of days90) {
      const v = metricDayMap?.get(d)?.value;
      if (v !== null && v !== undefined && Number.isFinite(v)) vals90.push(v);
    }

    return {
      latest: latestValue,
      avg30,
      max: vals90.length ? Math.max(...vals90) : null,
      min: vals90.length ? Math.min(...vals90) : null,
    };
  }, [metricLogs, days30, days90, metricDayMap]);

  const chartPoints = useMemo(
    () =>
      days90.map((d) => ({
        x: d,
        y: metricDayMap?.get(d)?.value ?? null,
      })),
    [days90, metricDayMap],
  );

  const fmtVal = (v: number | null) =>
    v === null ? "—" : `${formatNumber(v)}${unit ? ` ${unit}` : ""}`;

  const visibleLogs = showAllLogs ? metricLogs : metricLogs.slice(0, 30);

  return (
    <MobileSubPage
      title={str(metric, "name")}
      onBack={onBack}
      right={
        <InkNavIcon icon="edit" label="编辑指标" onClick={onEditMetric} />
      }
    >
      <InkScreen>
        <InkCard>
          <InkStatRow
            items={[
              { label: "最新", value: fmtVal(stats.latest) },
              {
                label: "30日均值",
                value:
                  stats.avg30 === null
                    ? "—"
                    : `${stats.avg30.toFixed(2)}${unit ? ` ${unit}` : ""}`,
              },
              { label: "最高", value: fmtVal(stats.max) },
              { label: "最低", value: fmtVal(stats.min) },
            ]}
          />
        </InkCard>

        <InkCard>
          <InkLineChart
            label="近 90 天趋势"
            unit={unit ? ` ${unit}` : ""}
            points={chartPoints}
          />
          <p className="mfx-footnote" style={{ padding: 0 }}>
            缺失的日子不计入平均；按住或滑动图表可查看每日数值。
          </p>
        </InkCard>

        <InkSectionLabel
          title="最近记录"
          aside={
            <button
              type="button"
              className="mk-text-btn accent"
              onClick={() => {
                setEditingLog(undefined);
                setLogSheetOpen(true);
              }}
            >
              ＋ 记一笔
            </button>
          }
        />

        <InkCard variant="compact">
          {visibleLogs.map((log, index) => {
            const logDay = str(log, "day");
            const note = str(log, "note");
            const val =
              typeof log.data.value === "number" &&
              Number.isFinite(log.data.value)
                ? log.data.value
                : null;
            const isDup =
              (metricDayMap?.get(logDay)?.candidates.length ?? 0) > 1;
            return (
              <React.Fragment key={log.id}>
                {index > 0 && <InkHairline />}
                <button
                  type="button"
                  className="mk-row"
                  onClick={() => {
                    setEditingLog(log);
                    setLogSheetOpen(true);
                  }}
                >
                  <div className="mk-row-main">
                    <div className="mk-row-title clamp-1">{logDay}</div>
                    {(note || isDup) && (
                      <div
                        className={"mk-row-sub" + (isDup ? " warn" : "")}
                      >
                        {isDup ? "同日重复待核对" : ""}
                        {isDup && note ? " · " : ""}
                        {note}
                      </div>
                    )}
                  </div>
                  <div className="mk-row-right">
                    <span className="mk-row-val">{fmtVal(val)}</span>
                    <span className="mk-row-chevron">
                      <Icon name="chevron-right" size={15} />
                    </span>
                  </div>
                </button>
              </React.Fragment>
            );
          })}
          {metricLogs.length === 0 && (
            <InkEmpty text="还没有记录，点击右上角或「＋ 记一笔」添加" />
          )}
        </InkCard>

        {metricLogs.length > 30 && !showAllLogs && (
          <button
            type="button"
            className="mk-pill full"
            onClick={() => setShowAllLogs(true)}
          >
            显示全部 {metricLogs.length} 条记录
          </button>
        )}

        <MetricLogSheet
          open={logSheetOpen}
          metric={metric}
          log={editingLog}
          existingForDay={(d) => metricDayMap?.get(d)?.candidates ?? []}
          onClose={() => setLogSheetOpen(false)}
        />
      </InkScreen>
    </MobileSubPage>
  );
}

function MetricDefinitionSheet({
  open,
  entity,
  onClose,
  onDeleted,
}: {
  open: boolean;
  entity?: Entity;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("分");
  const [minimum, setMinimum] = useState("0");
  const [maximum, setMaximum] = useState("10");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(str(entity, "name"));
    setUnit(str(entity, "unit", entity ? "" : "分"));
    setMinimum(String(num(entity, "minimum", 0)));
    setMaximum(String(num(entity, "maximum", 10)));
    setSaving(false);
    setConfirmDelete(false);
  }, [open, entity]);

  const minNum = Number(minimum);
  const maxNum = Number(maximum);
  const validRange =
    minimum.trim() !== "" &&
    maximum.trim() !== "" &&
    Number.isFinite(minNum) &&
    Number.isFinite(maxNum) &&
    minNum >= -100000 &&
    maxNum >= minNum;
  const canSave = !saving && name.trim().length > 0 && validRange;

  function handleSave() {
    if (!canSave) return;
    setSaving(true);
    perform(
      put(
        "metric",
        {
          name: name.trim(),
          unit: unit.trim(),
          minimum: minNum,
          maximum: maxNum,
        },
        entity,
      )
        .then(() => onClose())
        .finally(() => setSaving(false)),
    );
  }

  return (
    <>
      <InkSheet
        open={open}
        title={entity ? "编辑指标" : "添加指标"}
        onClose={() => {
          if (!saving) onClose();
        }}
        rightLabel={saving ? "保存中" : "保存"}
        rightDisabled={!canSave}
        onRight={handleSave}
      >
        <div className="mk-form-group">
          <div className="mk-form-row">
            <span className="mk-form-label">名称</span>
            <input
              className="mk-form-input right"
              placeholder="如：睡眠、精力、体重"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="mk-form-row">
            <span className="mk-form-label">单位</span>
            <input
              className="mk-form-input right"
              placeholder="如：分、小时、kg"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
          <div className="mk-form-row">
            <span className="mk-form-label">最小值</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              className="mk-form-input right"
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
            />
          </div>
          <div className="mk-form-row">
            <span className="mk-form-label">最大值</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              className="mk-form-input right"
              value={maximum}
              onChange={(e) => setMaximum(e.target.value)}
            />
          </div>
        </div>

        {!validRange && (
          <p className="mfx-error">请填写有效范围，最大值需大于等于最小值。</p>
        )}

        {entity && (
          <button
            type="button"
            className="mk-pill danger lg full"
            onClick={() => setConfirmDelete(true)}
          >
            移入回收站
          </button>
        )}
      </InkSheet>

      <InkActionSheet
        open={confirmDelete}
        title={`将指标「${str(entity, "name")}」移入回收站？`}
        onClose={() => setConfirmDelete(false)}
        items={[
          {
            label: "移入回收站",
            icon: "trash",
            danger: true,
            onClick: () => {
              if (!entity) return;
              perform(
                remove(entity).then(() => {
                  onDeleted?.();
                  onClose();
                }),
              );
            },
          },
        ]}
      />
    </>
  );
}

function MetricLogSheet({
  open,
  metric,
  log,
  existingForDay,
  onClose,
}: {
  open: boolean;
  metric: Entity;
  log?: Entity;
  existingForDay: (day: string) => Entity[];
  onClose: () => void;
}) {
  const [logDay, setLogDay] = useState(today());
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLogDay(str(log, "day", today()));
    setValue(
      typeof log?.data.value === "number" && Number.isFinite(log.data.value)
        ? formatNumber(log.data.value)
        : "",
    );
    setNote(str(log, "note"));
    setSaving(false);
    setConfirmDelete(false);
  }, [open, log]);

  const parsed = Number(value);
  const canSave =
    !saving &&
    Boolean(logDay) &&
    value.trim() !== "" &&
    Number.isFinite(parsed) &&
    parsed >= -100000;

  function handleSave() {
    if (!canSave) return;
    setSaving(true);
    const payload = {
      metricId: metric.id,
      day: logDay,
      value: parsed,
      note: note.trim(),
    };
    const op = (() => {
      if (log) return put("metricLog", payload, log);
      const existing = existingForDay(logDay);
      if (existing.length === 1) return put("metricLog", payload, existing[0]);
      return putKey("metricLog", `${metric.id}:${logDay}`, payload);
    })();
    perform(
      op
        .then(() => onClose())
        .finally(() => setSaving(false)),
    );
  }

  return (
    <>
      <InkSheet
        open={open}
        title={log ? "编辑记录" : "添加记录"}
        onClose={() => {
          if (!saving) onClose();
        }}
        rightLabel={saving ? "保存中" : "保存"}
        rightDisabled={!canSave}
        onRight={handleSave}
      >
        <div className="mk-form-group">
          <div className="mk-form-row">
            <span className="mk-form-label">日期</span>
            <input
              type="date"
              className="mk-form-input right"
              value={logDay}
              onChange={(e) => setLogDay(e.target.value)}
            />
          </div>
          <div className="mk-form-row">
            <span className="mk-form-label">
              数值{str(metric, "unit") ? `（${str(metric, "unit")}）` : ""}
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              className="mk-form-input right"
              placeholder={`${formatNumber(num(metric, "minimum", 0))}–${formatNumber(num(metric, "maximum", 10))}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="mk-form-row col">
            <span className="mk-form-label">备注</span>
            <textarea
              className="mk-form-textarea"
              placeholder="可选记录当时的状态或原因…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        {log && (
          <button
            type="button"
            className="mk-pill danger lg full"
            onClick={() => setConfirmDelete(true)}
          >
            删除这条记录
          </button>
        )}
      </InkSheet>

      <InkActionSheet
        open={confirmDelete}
        title={`删除 ${logDay} 的这条记录？`}
        onClose={() => setConfirmDelete(false)}
        items={[
          {
            label: "删除记录",
            icon: "trash",
            danger: true,
            onClick: () => {
              if (!log) return;
              perform(remove(log).then(() => onClose()));
            },
          },
        ]}
      />
    </>
  );
}

/* ═══════════════════════════ 3. MobileChecklists ═══════════════════════════ */

function pickLatestRun(runs: Entity[], checklistId: string): Entity | undefined {
  return runs.reduce<Entity | undefined>((latest, row) => {
    if (row.data.checklistId !== checklistId) return latest;
    if (!latest) return row;
    const order =
      Date.parse(row.updatedAt) - Date.parse(latest.updatedAt) ||
      row.version - latest.version ||
      latest.id.localeCompare(row.id);
    return order > 0 ? row : latest;
  }, undefined);
}

function checklistStateOf(template: Entity | undefined, run: Entity | undefined) {
  return runState(
    { items: arr(template, "items"), itemIds: arr(template, "itemIds") },
    run && {
      checked: arr(run, "checked"),
      itemIds: Array.isArray(run.data.itemIds) ? arr(run, "itemIds") : undefined,
      itemLabels: Array.isArray(run.data.itemLabels)
        ? arr(run, "itemLabels")
        : undefined,
      checkedItemIds: Array.isArray(run.data.checkedItemIds)
        ? arr(run, "checkedItemIds")
        : undefined,
      ambiguousChecked: arr(run, "ambiguousChecked"),
    },
  );
}

export function MobileChecklists() {
  const { entities: templates } = useEntities("checklist");
  const day = today();
  const todayRuns = useDatedEntities(day, day, "checklistRun");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Entity | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const active = activeId
    ? templates.find((t) => t.id === activeId)
    : undefined;
  const activeRun = active ? pickLatestRun(todayRuns, active.id) : undefined;
  const activeState = useMemo(
    () => (active ? checklistStateOf(active, activeRun) : undefined),
    [active, activeRun],
  );

  async function saveChecks(
    list: Entity,
    run: Entity | undefined,
    state: ReturnType<typeof checklistStateOf>,
    checked: Set<string>,
  ) {
    const data = {
      checklistId: list.id,
      day,
      ...runFields(state.items, checked, state.ambiguous),
    };
    if (run) await put("checklistRun", data, run);
    else await putKey("checklistRun", `${list.id}:${day}`, data);
  }

  function toggleItem(itemId: string) {
    if (!active || !activeState) return;
    const next = new Set(activeState.checked);
    if (!next.delete(itemId)) next.add(itemId);
    perform(saveChecks(active, activeRun, activeState, next));
  }

  if (active && activeState) {
    const total = activeState.items.length;
    const doneCount = activeState.checked.size;
    const allReady = total > 0 && doneCount >= total;

    const menuItems: ActionSheetItem[] = [
      {
        label: "编辑清单",
        icon: "edit",
        onClick: () => {
          setEditing(active);
          setEditorOpen(true);
        },
      },
      ...(doneCount > 0
        ? [
            {
              label: "重置本次勾选",
              icon: "undo",
              onClick: () =>
                perform(saveChecks(active, activeRun, activeState, new Set())),
            },
          ]
        : []),
      {
        label: "删除清单",
        icon: "trash",
        danger: true,
        onClick: () => setConfirmDelete(true),
      },
    ];

    return (
      <>
        <MobileSubPage
          title={str(active, "name")}
          onBack={() => setActiveId(null)}
          right={
            <InkNavIcon
              icon="ellipsis"
              label="清单操作"
              onClick={() => setMenuOpen(true)}
            />
          }
        >
          <InkScreen>
            <InkCard>
              <div className="mfx-progress-head">
                <div className="mfx-progress-nums">
                  <strong>{doneCount}</strong>
                  <span>/ {total} 已就绪</span>
                </div>
                {doneCount > 0 && (
                  <button
                    type="button"
                    className="mk-pill sm"
                    onClick={() =>
                      perform(
                        saveChecks(active, activeRun, activeState, new Set()),
                      )
                    }
                  >
                    重置本次
                  </button>
                )}
              </div>
              <InkMeter
                progress={total > 0 ? doneCount / total : 0}
                tone={allReady ? "live" : "default"}
              />
              {activeState.ambiguous.size > 0 && (
                <p className="mfx-error" style={{ padding: 0 }}>
                  旧记录需核对 · {[...activeState.ambiguous].join("、")}
                </p>
              )}
            </InkCard>

            <InkCard variant="compact">
              {activeState.items.map((item, index) => {
                const on = activeState.checked.has(item.id);
                return (
                  <React.Fragment key={item.id}>
                    {index > 0 && <InkHairline inset={34} />}
                    <div
                      role="button"
                      tabIndex={0}
                      className="mfx-check-row"
                      aria-pressed={on}
                      onClick={() => toggleItem(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleItem(item.id);
                        }
                      }}
                    >
                      <InkRing
                        done={on}
                        label={item.label}
                        onClick={() => toggleItem(item.id)}
                      />
                      <div className="mk-row-main">
                        <div
                          className={
                            "mk-row-title" + (on ? " mfx-strike" : "")
                          }
                        >
                          {item.label}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              {activeState.items.length === 0 && (
                <InkEmpty text="这份清单还没有项目，点右上角编辑添加" />
              )}
            </InkCard>

            <p className="mfx-footnote">
              勾选只属于今天这一次，不会改动清单本身。
            </p>
          </InkScreen>
        </MobileSubPage>

        <InkActionSheet
          open={menuOpen}
          title={str(active, "name")}
          items={menuItems}
          onClose={() => setMenuOpen(false)}
        />

        <InkActionSheet
          open={confirmDelete}
          title={`将清单「${str(active, "name")}」移入回收站？`}
          onClose={() => setConfirmDelete(false)}
          items={[
            {
              label: "移入回收站",
              icon: "trash",
              danger: true,
              onClick: () => {
                perform(remove(active).then(() => setActiveId(null)));
              },
            },
          ]}
        />

        <ChecklistEditorSheet
          open={editorOpen}
          entity={editing}
          onClose={() => setEditorOpen(false)}
          onSaved={(id) => {
            setEditorOpen(false);
            setActiveId(id);
          }}
        />
      </>
    );
  }

  return (
    <InkScreen>
      <MobileToolbar>
        <InkNavIcon
          icon="plus"
          label="新建清单"
          onClick={() => {
            setEditing(undefined);
            setEditorOpen(true);
          }}
        />
      </MobileToolbar>

      <InkCard variant="compact">
        {templates.map((list, index) => {
          const run = pickLatestRun(todayRuns, list.id);
          const st = checklistStateOf(list, run);
          const total = st.items.length;
          const done = st.checked.size;
          const allReady = total > 0 && done >= total;
          return (
            <React.Fragment key={list.id}>
              {index > 0 && <InkHairline />}
              <button
                type="button"
                className="mk-row"
                onClick={() => setActiveId(list.id)}
              >
                <div className="mk-row-main">
                  <div className="mk-row-title clamp-1">
                    {str(list, "name")}
                  </div>
                  <div className="mk-row-sub">
                    共 {total} 项 · 今日 {done}/{total}
                  </div>
                </div>
                <div className="mk-row-right">
                  <span className={"mfx-badge" + (allReady ? " live" : "")}>
                    {done}/{total}
                  </span>
                  <span className="mk-row-chevron">
                    <Icon name="chevron-right" size={16} />
                  </span>
                </div>
              </button>
            </React.Fragment>
          );
        })}
        {templates.length === 0 && (
          <InkEmpty text="创建出门、洗澡或睡前清单" />
        )}
      </InkCard>

      {templates.length > 0 && (
        <p className="mfx-footnote">
          点击任意场景进入今日勾选，勾选仅记录在今天。
        </p>
      )}

      <ChecklistEditorSheet
        open={editorOpen}
        entity={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={(id) => {
          setEditorOpen(false);
          setActiveId(id);
        }}
      />
    </InkScreen>
  );
}

function ChecklistEditorSheet({
  open,
  entity,
  onClose,
  onSaved,
}: {
  open: boolean;
  entity?: Entity;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [lines, setLines] = useState("");
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(str(entity, "name"));
    setLines("");
    setItems(
      entity
        ? checklistItems({
            items: arr(entity, "items"),
            itemIds: arr(entity, "itemIds"),
          })
        : [],
    );
    setSaving(false);
  }, [open, entity]);

  const hasValidItems = entity
    ? items.some((it) => it.label.trim().length > 0)
    : lines
        .split(/\r?\n/)
        .map((s) => s.trim())
        .some(Boolean);
  const canSave = !saving && name.trim().length > 0 && hasValidItems;

  function handleSave() {
    if (!canSave) return;
    const rows = entity
      ? items
          .map((item) => ({ ...item, label: item.label.trim() }))
          .filter((item) => item.label)
      : lines
          .split(/\r?\n/)
          .map((label) => label.trim())
          .filter(Boolean)
          .map((label) => ({ id: crypto.randomUUID(), label }));
    if (!rows.length) return;
    setSaving(true);
    perform(
      put(
        "checklist",
        {
          name: name.trim(),
          items: rows.map((r) => r.label),
          itemIds: rows.map((r) => r.id),
        },
        entity,
      )
        .then(onSaved)
        .finally(() => setSaving(false)),
    );
  }

  return (
    <InkSheet
      open={open}
      title={entity ? "编辑清单" : "新清单"}
      onClose={() => {
        if (!saving) onClose();
      }}
      rightLabel={saving ? "保存中" : "保存"}
      rightDisabled={!canSave}
      onRight={handleSave}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">场景名称</span>
          <input
            className="mk-form-input right"
            placeholder="如：出门、出差、睡前"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>

      {entity ? (
        <>
          <div className="mk-form-group">
            {items.map((item, idx) => (
              <div className="mk-form-row" key={item.id}>
                <input
                  className="mk-form-input"
                  placeholder={`项目 ${idx + 1}`}
                  value={item.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    setItems((prev) =>
                      prev.map((row) =>
                        row.id === item.id ? { ...row, label } : row,
                      ),
                    );
                  }}
                />
                <button
                  type="button"
                  className="mfx-icon-btn danger"
                  aria-label="删除项目"
                  onClick={() =>
                    setItems((prev) => prev.filter((row) => row.id !== item.id))
                  }
                >
                  <Icon name="minus" size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mk-pill full"
            onClick={() =>
              setItems((prev) => [
                ...prev,
                { id: crypto.randomUUID(), label: "" },
              ])
            }
          >
            <Icon name="plus" size={15} />
            <span>添加项目</span>
          </button>
        </>
      ) : (
        <div className="mk-form-group">
          <div className="mk-form-row col">
            <span className="mk-form-label">每行一个要准备的东西</span>
            <textarea
              className="mk-form-textarea"
              style={{ minHeight: 140 }}
              placeholder={"钥匙\n手机\n充电宝\n耳机"}
              value={lines}
              onChange={(e) => setLines(e.target.value)}
            />
          </div>
        </div>
      )}
    </InkSheet>
  );
}
