import React, { useEffect, useState, useRef, type ReactNode } from "react";
import type {
  AnyEntity as Entity,
  Data,
  EntityType,
} from "../data/entities.ts";
import { put, remove } from "../data/entities.ts";
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const monthNow = () => today().slice(0, 7);
export const str = (e: Entity | undefined, key: string, fallback = "") =>
  String(e?.data[key] ?? fallback);
export const num = (e: Entity | undefined, key: string, fallback = 0) =>
  Number(e?.data[key] ?? fallback);
export const arr = (e: Entity | undefined, key: string) =>
  Array.isArray(e?.data[key]) ? (e!.data[key] as string[]) : [];
export function perform(promise: Promise<unknown>) {
  void promise.catch((error) =>
    window.dispatchEvent(
      new CustomEvent("council-error", {
        detail: error instanceof Error ? error.message : "保存失败",
      }),
    ),
  );
}
export function usePreference<T>(
  key: string,
  initial: T,
): [T, (value: T) => void] {
  const [value, set] = useState<T>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("pc-next-" + key) ?? "null") ?? initial
      );
    } catch {
      return initial;
    }
  });
  return [
    value,
    (next) => {
      localStorage.setItem("pc-next-" + key, JSON.stringify(next));
      set(next);
    },
  ];
}
export function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="feature-heading">
      <div>
        <small>{eyebrow}</small>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"panel " + className}>
      {title && (
        <header>
          <h2>{title}</h2>
          {aside}
        </header>
      )}
      <div className="panel-content">{children}</div>
    </section>
  );
}
export function Empty({ text = "这里还没有记录" }: { text?: string }) {
  return <div className="quiet-empty">{text}</div>;
}
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const shiftDay = (day: string, by: number) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};
/**
 * Month picker: ‹ 2026年11月 ›. The label opens the native picker; arrows step.
 * The native input stays in place (transparent) so keyboards and tests can type into it.
 */
export function Month({
  value,
  onChange,
  label = "选择月份",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const valid = /^\d{4}-\d{2}$/.test(value);
  return (
    <div className="stepper">
      <button
        type="button"
        aria-label="上个月"
        disabled={!valid}
        onClick={() => onChange(shiftMonth(value, -1))}
      >
        ‹
      </button>
      <label>
        <span>
          {valid
            ? value.slice(0, 4) + "年" + Number(value.slice(5)) + "月"
            : "全部月份"}
        </span>
        <input
          aria-label={label}
          type="month"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <button
        type="button"
        aria-label="下个月"
        disabled={!valid}
        onClick={() => onChange(shiftMonth(value, 1))}
      >
        ›
      </button>
    </div>
  );
}
/** Day picker in the same form: ‹ 11月10日 周二 ›. An empty value means "any day" when allowed. */
export function DayPicker({
  value,
  onChange,
  label = "选择日期",
  clearable = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  clearable?: boolean;
}) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const week = valid
    ? "日一二三四五六"[new Date(value + "T12:00:00Z").getUTCDay()]
    : "";
  return (
    <div className="stepper">
      <button
        type="button"
        aria-label="前一天"
        disabled={!valid}
        onClick={() => onChange(shiftDay(value, -1))}
      >
        ‹
      </button>
      <label>
        <span>
          {valid
            ? (value.slice(0, 4) !== today().slice(0, 4)
                ? value.slice(0, 4) + "年"
                : "") +
              Number(value.slice(5, 7)) +
              "月" +
              Number(value.slice(8)) +
              "日 · 周" +
              week +
              (value === today() ? " · 今天" : "")
            : "任意日期"}
        </span>
        <input
          aria-label={label}
          type="date"
          value={value}
          onChange={(e) =>
            onChange(e.target.value || (clearable ? "" : today()))
          }
        />
      </label>
      <button
        type="button"
        aria-label="后一天"
        disabled={!valid}
        onClick={() => onChange(shiftDay(value, 1))}
      >
        ›
      </button>
      {clearable && valid && (
        <button
          type="button"
          aria-label="清除日期"
          onClick={() => onChange("")}
        >
          ×
        </button>
      )}
    </div>
  );
}
export type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "date"
    | "datetime-local"
    | "textarea"
    | "select"
    | "checkbox"
    | "lines";
  required?: boolean;
  options?: [string, string][];
  min?: number;
  max?: number;
  step?: string;
  placeholder?: string;
};
export function RecordForm({
  type,
  entity,
  defaults = {},
  fields,
  onSaved,
  onCancel,
  title = "记录",
}: {
  type: EntityType;
  entity?: Entity;
  defaults?: Data;
  fields: Field[];
  onSaved?: (id: string) => void;
  onCancel?: () => void;
  title?: string;
}) {
  const key = type + "-" + (entity?.id ?? "new");
  const [draft, setDraft] = useState<Data>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("pc-draft-" + key) ?? "null") ?? {
          ...defaults,
          ...entity?.data,
        }
      );
    } catch {
      return { ...defaults, ...entity?.data };
    }
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  function change(key: string, value: Data[string]) {
    setDraft((old) => {
      const next = { ...old, [key]: value };
      localStorage.setItem(
        "pc-draft-" + type + "-" + (entity?.id ?? "new"),
        JSON.stringify(next),
      );
      return next;
    });
  }
  return (
    <form
      className="record-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        const data = { ...draft };
        for (const field of fields) {
          if (
            (field.type === "date" || field.type === "datetime-local") &&
            !data[field.key]
          )
            delete data[field.key];
          if (field.type === "datetime-local" && data[field.key])
            data[field.key] = new Date(String(data[field.key])).toISOString();
        }
        void put(type, data, entity)
          .then((id) => {
            localStorage.removeItem("pc-draft-" + key);
            setError("");
            if (!entity) setDraft(defaults);
            onSaved?.(id);
          })
          .catch((e) => setError(e.message))
          .finally(() => setSaving(false));
      }}
    >
      {fields.map((field) => (
        <label
          key={field.key}
          className={field.type === "checkbox" ? "check-field" : ""}
        >
          <span>{field.label}</span>
          {field.type === "select" ? (
            <select
              value={String(draft[field.key] ?? "")}
              required={field.required}
              onChange={(e) =>
                change(
                  field.key,
                  typeof (defaults[field.key] ?? entity?.data[field.key]) ===
                    "number"
                    ? Number(e.target.value)
                    : e.target.value,
                )
              }
            >
              {field.options?.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          ) : field.type === "textarea" || field.type === "lines" ? (
            <textarea
              value={
                field.type === "lines"
                  ? ((draft[field.key] as string[]) ?? []).join("\n")
                  : String(draft[field.key] ?? "")
              }
              required={field.required}
              placeholder={field.placeholder}
              onChange={(e) =>
                change(
                  field.key,
                  field.type === "lines"
                    ? e.target.value.split("\n").filter(Boolean)
                    : e.target.value,
                )
              }
            />
          ) : field.type === "checkbox" ? (
            <input
              type="checkbox"
              checked={Boolean(draft[field.key])}
              onChange={(e) => change(field.key, e.target.checked)}
            />
          ) : (
            <input
              type={field.type ?? "text"}
              value={
                field.type === "datetime-local" && draft[field.key]
                  ? localDateTime(String(draft[field.key]))
                  : String(draft[field.key] ?? "")
              }
              min={field.min}
              max={field.max}
              step={field.step}
              required={field.required}
              placeholder={field.placeholder}
              onChange={(e) =>
                change(
                  field.key,
                  field.type === "number"
                    ? e.target.value === ""
                      ? 0
                      : Number(e.target.value)
                    : e.target.value,
                )
              }
            />
          )}
        </label>
      ))}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="primary" disabled={saving}>
          {saving ? "保存中…" : title}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            取消
          </button>
        )}
        {entity && (
          <button
            type="button"
            className="muted"
            onClick={() => perform(remove(entity).then(() => onCancel?.()))}
          >
            移入回收站
          </button>
        )}
      </div>
    </form>
  );
}
export function Chart({
  points,
  label,
  unit = "",
}: {
  points: { x: string; y: number | null }[];
  label: string;
  unit?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const valid = points.filter((p) => p.y !== null && Number.isFinite(p.y));
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.round(entry.contentRect.width))),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [points.length, valid.length]);
  if (!valid.length) return <Empty text="有记录后，这里会显示趋势" />;
  const min = Math.min(...valid.map((p) => p.y!)),
    max = Math.max(...valid.map((p) => p.y!));
  const padding = max === min ? Math.max(Math.abs(max) * 0.1, 1) : 0;
  const axisMin = min - padding,
    axisMax = max + padding;
  const span = axisMax - axisMin;
  const times = points.map((p) => Date.parse(p.x));
  const temporal =
    times.every(Number.isFinite) && Math.max(...times) > Math.min(...times);
  const x = (i: number) =>
      52 +
      (temporal
        ? (times[i] - Math.min(...times)) /
          (Math.max(...times) - Math.min(...times))
        : i / Math.max(points.length - 1, 1)) *
        (width - 72),
    y = (v: number) => 165 - ((v - axisMin) / span) * 130;
  let path = "",
    open = false;
  points.forEach((p, i) => {
    if (p.y === null) {
      open = false;
      return;
    }
    path += (open ? "L" : "M") + x(i) + "," + y(p.y) + " ";
    open = true;
  });
  const current =
    selected === null
      ? points.findLast((point) => point.y !== null)
      : points[selected];
  const format = (value: number) =>
    value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  const axisFormat = (value: number) =>
    Math.abs(value) >= 10000
      ? new Intl.NumberFormat("zh-CN", {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(value)
      : format(value);
  // Days stay calendar days; instants are shown in local time.
  const dateLabel = (value = "") =>
    /^\d{4}-\d{2}-\d{2}T/.test(value)
      ? new Date(value)
          .toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
          .replace("/", "-")
      : /^\d{4}-\d{2}-\d{2}/.test(value)
        ? value.slice(5, 10)
        : value;
  return (
    <div className="chart" ref={frame}>
      <div className="chart-caption">
        <span>{label}</span>
        <strong>
          {current
            ? dateLabel(current.x) +
              " · " +
              (current.y === null ? "未记录" : format(current.y) + unit)
            : ""}
        </strong>
      </div>
      <svg viewBox={`0 0 ${width} 212`} role="img" aria-label={label}>
        {[35, 100, 165].map((position, i) => (
          <React.Fragment key={position}>
            <line
              x1="52"
              x2={width - 20}
              y1={position}
              y2={position}
              stroke="var(--line)"
              strokeDasharray="3 4"
            />
            <text
              x="44"
              y={position + 4}
              textAnchor="end"
              fill="var(--muted)"
              fontSize="11"
            >
              {axisFormat(
                i === 0 ? axisMax : i === 2 ? axisMin : (axisMin + axisMax) / 2,
              )}
            </text>
          </React.Fragment>
        ))}
        <path d={path} fill="none" stroke="var(--text)" strokeWidth="1.7" />
        {points.map((p, i) =>
          p.y === null ? null : (
            <circle
              key={i}
              cx={x(i)}
              cy={y(p.y)}
              r="3"
              fill="var(--text)"
              tabIndex={0}
              aria-label={p.x + "：" + format(p.y) + unit}
              onClick={() => setSelected(i)}
              onFocus={() => setSelected(i)}
              onMouseEnter={() => setSelected(i)}
            >
              <title>
                {p.x}：{p.y}
                {unit}
              </title>
            </circle>
          ),
        )}
        <text x="52" y="200" fill="var(--muted)" fontSize="11">
          {dateLabel(points[0]?.x)}
        </text>
        <text
          x={width - 20}
          y="200"
          textAnchor="end"
          fill="var(--muted)"
          fontSize="11"
        >
          {dateLabel(points.at(-1)?.x)}
        </text>
      </svg>
    </div>
  );
}
/**
 * One bar per day. Bright: the day met its goal; grey: recorded but short of it;
 * a short stub: nothing recorded (shown as zero, never estimated).
 */
export function BarChart({
  points,
  label,
  unit = "",
  note,
}: {
  points: { x: string; y: number | null; done?: boolean }[];
  label: string;
  unit?: string;
  note?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  if (!points.length) return <Empty text="有记录后，这里会显示每日数量" />;
  const max = Math.max(1, ...points.map((p) => p.y ?? 0));
  const top = Number.isInteger(max) ? max : Math.ceil(max);
  const left = 34,
    right = 12,
    base = 168,
    height = 140;
  const step = (width - left - right) / points.length;
  const bar = Math.max(3, Math.min(18, step * 0.58));
  const current = selected === null ? points.findLast((p) => p.y !== null) : points[selected];
  const format = (v: number) => v.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  const ticks = [0, top / 2, top];
  const labelled = (i: number) => i === 0 || i === points.length - 1 || (i + 1) % 5 === 0;
  return (
    <div className="chart bar-chart" ref={frame}>
      <div className="chart-caption">
        <span>{label}</span>
        <strong>
          {current ? current.x.slice(5) + " · " + (current.y === null ? "未记录" : format(current.y) + unit) : ""}
        </strong>
      </div>
      <svg viewBox={`0 0 ${width} 196`} role="img" aria-label={label}>
        {ticks.map((t) => {
          const y = base - (t / top) * height;
          return (
            <React.Fragment key={t}>
              <line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--line-2)" strokeDasharray="3 4" />
              <text x={left - 8} y={y + 4} textAnchor="end" fill="var(--muted)" fontSize="11">
                {format(t)}
              </text>
            </React.Fragment>
          );
        })}
        {points.map((p, i) => {
          const cx = left + step * i + step / 2;
          const value = p.y ?? 0;
          const h = value > 0 ? Math.max(3, (value / top) * height) : 3;
          return (
            <g key={p.x} onMouseEnter={() => setSelected(i)} onClick={() => setSelected(i)}>
              <rect x={cx - step / 2} y={base - height} width={step} height={height} fill="transparent" />
              <rect
                x={cx - bar / 2}
                y={base - h}
                width={bar}
                height={h}
                rx={Math.min(4, bar / 2)}
                fill={value <= 0 ? "var(--line-2)" : p.done ? "var(--text)" : "var(--text-3)"}
                opacity={selected === i ? 0.8 : 1}
              >
                <title>
                  {p.x}：{p.y === null ? "未记录" : format(p.y) + unit}
                </title>
              </rect>
              {labelled(i) && (
                <text x={cx} y={188} textAnchor="middle" fill="var(--muted)" fontSize="11">
                  {Number(p.x.slice(-2))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {note && <small className="chart-note">{note}</small>}
    </div>
  );
}
export const daysInMonth = (month: string) => {
  const [year, m] = month.split("-").map(Number);
  if (!year || !m) return [];
  return Array.from(
    { length: new Date(year, m, 0).getDate() },
    (_, i) => month + "-" + String(i + 1).padStart(2, "0"),
  );
};
export function Stats({ items }: { items: [string, string][] }) {
  return (
    <div className="stats-strip">
      {items.map(([label, value]) => (
        <div key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function localDateTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : value;
}
