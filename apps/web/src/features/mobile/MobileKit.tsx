import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../ui/Icon.tsx";
import { today } from "../../ui/shared.tsx";
import "./mobile-kit.css";

/* ─────────────────────────── Date & Format Helpers ─────────────────────────── */

export function shiftDay(iso: string, delta: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}

export function shortDate(iso: string): string {
  return `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
}

export function weekdayChar(iso: string): string {
  return "日一二三四五六"[new Date(iso + "T12:00:00Z").getUTCDay()] ?? "";
}

export function daysInMonth(month: string): string[] {
  const [year, m] = month.split("-").map(Number);
  if (!year || !m) return [];
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}

export function formatSpan(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins}分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}小时` : `${h}小时${m}分`;
}

/* ─────────────────────────── Mobile Navigation & Toolbar Slot Context ─────────────────────────── */

type SubPageEntry = {
  id: string;
  title: string;
  backLabel?: string;
  onBackRef: React.MutableRefObject<() => void>;
};

type BackHandlerEntry = {
  id: string;
  handlerRef: React.MutableRefObject<() => void>;
};

type MobileNavContextValue = {
  portalEl: HTMLDivElement | null;
  subPages: SubPageEntry[];
  registerSubPage: (entry: SubPageEntry) => () => void;
  updateSubPage: (id: string, title: string, backLabel?: string) => void;
  registerBackHandler: (entry: BackHandlerEntry) => () => void;
  consumeBack: () => boolean;
};

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

export function MobileNavProvider({
  portalEl,
  children,
}: {
  portalEl: HTMLDivElement | null;
  children: ReactNode;
}) {
  const [subPages, setSubPages] = useState<SubPageEntry[]>([]);
  const backHandlersRef = useRef<BackHandlerEntry[]>([]);
  const subPagesRef = useRef<SubPageEntry[]>([]);
  subPagesRef.current = subPages;

  const registerSubPage = useCallback((entry: SubPageEntry) => {
    setSubPages((prev) => [...prev.filter((p) => p.id !== entry.id), entry]);
    const scroller = document.querySelector(".ms-scroll");
    if (scroller) scroller.scrollTop = 0;
    return () => {
      setSubPages((prev) => prev.filter((p) => p.id !== entry.id));
    };
  }, []);

  const updateSubPage = useCallback((id: string, title: string, backLabel?: string) => {
    setSubPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, title, backLabel } : p)),
    );
  }, []);

  const registerBackHandler = useCallback((entry: BackHandlerEntry) => {
    backHandlersRef.current = [
      ...backHandlersRef.current.filter((h) => h.id !== entry.id),
      entry,
    ];
    return () => {
      backHandlersRef.current = backHandlersRef.current.filter(
        (h) => h.id !== entry.id,
      );
    };
  }, []);

  const consumeBack = useCallback(() => {
    const topModal = backHandlersRef.current.at(-1);
    if (topModal) {
      topModal.handlerRef.current();
      return true;
    }
    const topSub = subPagesRef.current.at(-1);
    if (topSub) {
      topSub.onBackRef.current();
      return true;
    }
    return false;
  }, []);

  const value = useMemo<MobileNavContextValue>(
    () => ({
      portalEl,
      subPages,
      registerSubPage,
      updateSubPage,
      registerBackHandler,
      consumeBack,
    }),
    [portalEl, subPages, registerSubPage, updateSubPage, registerBackHandler, consumeBack],
  );

  return (
    <MobileNavContext.Provider value={value}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNavState() {
  return useContext(MobileNavContext);
}

/**
 * Renders trailing top-bar action buttons into MobileStudio's native navbar via React Portal.
 * Automatically yields to any pushed MobileSubPage when a detail view is open.
 */
export function MobileToolbar({
  children,
  forSubPageId,
}: {
  children: ReactNode;
  forSubPageId?: string;
}) {
  const nav = useContext(MobileNavContext);
  if (!nav?.portalEl) return null;
  const topSub = nav.subPages.at(-1);
  if (forSubPageId) {
    if (topSub?.id !== forSubPageId) return null;
  } else if (nav.subPages.length > 0) {
    return null;
  }
  return createPortal(children, nav.portalEl);
}

/**
 * Declares a pushed detail view inside a mobile feature screen (e.g. Box Detail, Article Reader).
 * Updates the native top navbar title, Back action, Android back button, and optional trailing buttons.
 */
export function MobileSubPage({
  title,
  backLabel,
  onBack,
  right,
  children,
}: {
  title: string;
  backLabel?: string;
  onBack: () => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  const nav = useContext(MobileNavContext);
  const id = useId();
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!nav) return;
    return nav.registerSubPage({ id, title, backLabel, onBackRef });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, id]);

  useEffect(() => {
    nav?.updateSubPage(id, title, backLabel);
  }, [nav, id, title, backLabel]);

  return (
    <>
      {right !== undefined && (
        <MobileToolbar forSubPageId={id}>{right}</MobileToolbar>
      )}
      {children}
    </>
  );
}

/** Registers a dismiss callback for open bottom sheets so Android Back dismisses them first. */
export function useBackDismiss(open: boolean, onClose: () => void) {
  const nav = useContext(MobileNavContext);
  const id = useId();
  const ref = useRef(onClose);
  ref.current = onClose;

  useEffect(() => {
    if (!open || !nav) return;
    return nav.registerBackHandler({ id, handlerRef: ref });
  }, [open, nav, id]);
}

/* ─────────────────────────── Navbar Action Buttons ─────────────────────────── */

export function InkNavIcon({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="mk-nav-icon"
      aria-label={label}
      onClick={onClick}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}

export function InkNavText({
  label,
  solid = false,
  disabled = false,
  onClick,
}: {
  label: string;
  solid?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"mk-nav-text" + (solid ? " solid" : "")}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/* ─────────────────────────── Ink Visual Primitives (Theme.swift 1:1) ─────────────────────────── */

export function InkScreen({
  hasComposer = false,
  children,
}: {
  hasComposer?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={"mk-root" + (hasComposer ? " has-composer" : "")}>
      {children}
    </div>
  );
}

export function InkCard({
  variant = "default",
  className = "",
  onClick,
  children,
}: {
  variant?: "default" | "compact" | "tight" | "raised";
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const cls =
    "mk-card" +
    (variant !== "default" ? " " + variant : "") +
    (className ? " " + className : "");
  return (
    <section className={cls} onClick={onClick}>
      {children}
    </section>
  );
}

export function InkSectionLabel({
  title,
  aside,
}: {
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mk-section-label">
      <span>{title}</span>
      {aside !== undefined && (
        typeof aside === "string" ? <small>{aside}</small> : aside
      )}
    </div>
  );
}

export function InkHairline({ inset }: { inset?: 34 | 44 }) {
  return <div className={"mk-hairline" + (inset ? ` inset-${inset}` : "")} />;
}

export function InkFigure({
  value,
  caption,
  size = "lg",
}: {
  value: string;
  caption?: string;
  size?: "lg" | "md" | "sm";
}) {
  return (
    <div className="mk-figure">
      <div className={"mk-figure-num" + (size !== "lg" ? " " + size : "")}>
        {value}
      </div>
      {caption && <div className="mk-figure-cap">{caption}</div>}
    </div>
  );
}

export function InkStatRow({
  items,
}: {
  items: { label: string; value: string; tone?: "normal" | "warn" | "danger" | "live" }[];
}) {
  return (
    <div
      className="mk-stat-row"
      style={{ "--cols": Math.max(1, items.length) } as React.CSSProperties}
    >
      {items.map((item) => (
        <div className="mk-stat-cell" key={item.label}>
          <small>{item.label}</small>
          <strong className={item.tone && item.tone !== "normal" ? item.tone : ""}>
            {item.value}
          </strong>
        </div>
      ))}
    </div>
  );
}

export function InkMeter({
  progress,
  tone = "default",
}: {
  progress: number;
  tone?: "default" | "danger" | "live" | "warn";
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) * 100;
  return (
    <div className="mk-meter">
      <div
        className={"mk-meter-fill" + (tone !== "default" ? " " + tone : "")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Exact Theme.swift Ring: circular checkbox or partial progress ring (0..1).
 */
export function InkRing({
  progress,
  done,
  disabled,
  label,
  onClick,
}: {
  progress?: number;
  done?: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
}) {
  const isDone = done ?? (progress !== undefined && progress >= 1);
  const p = isDone ? 1 : Math.max(0, Math.min(1, progress ?? 0));
  const r = 9.5;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      className="mk-ring-btn"
      disabled={disabled}
      aria-label={label}
      style={{ opacity: disabled ? 0.35 : 1 }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <svg className="mk-ring-svg" viewBox="0 0 24 24" aria-hidden="true">
        {isDone ? (
          <>
            <circle cx="12" cy="12" r="10.5" fill="var(--solid)" />
            <path
              d="M7.5 12.2 10.6 15.2 16.6 9.2"
              fill="none"
              stroke="var(--solid-text)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <>
            <circle
              cx="12"
              cy="12"
              r={r}
              fill="none"
              stroke="var(--line-3)"
              strokeWidth="2"
            />
            {p > 0 && (
              <circle
                cx="12"
                cy="12"
                r={r}
                fill="none"
                stroke="var(--text)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeDasharray={`${c * p} ${c}`}
                transform="rotate(-90 12 12)"
              />
            )}
          </>
        )}
      </svg>
    </button>
  );
}

export function InkSegmented<T extends string>({
  options,
  value,
  onChange,
  onCard = false,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  onCard?: boolean;
}) {
  return (
    <div className={"mk-segmented" + (onCard ? " on-card" : "")} role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={"mk-seg-btn" + (value === opt.value ? " active" : "")}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function InkChipBar<T extends string>({
  items,
  value,
  onChange,
  size = "md",
}: {
  items: readonly { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  size?: "md" | "sm";
}) {
  return (
    <div className="mk-chip-bar">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={
            "mk-chip" +
            (size === "sm" ? " sm" : "") +
            (value === item.value ? " active" : "")
          }
          onClick={() => onChange(item.value)}
        >
          <span>{item.label}</span>
          {item.count !== undefined && item.count > 0 && (
            <span className="mk-chip-count">{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function InkMonthBar({
  month,
  onChange,
  currentMonth,
}: {
  month: string;
  onChange: (month: string) => void;
  currentMonth?: string;
}) {
  const nowM = currentMonth ?? today().slice(0, 7);
  return (
    <div className="mk-month-bar">
      <button
        type="button"
        className="mk-month-nav"
        aria-label="上一月"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <Icon name="chevron-left" size={16} />
      </button>
      <span className="mk-month-title">{monthTitle(month)}</span>
      <button
        type="button"
        className="mk-month-nav"
        aria-label="下一月"
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <Icon name="chevron-right" size={16} />
      </button>
      {month !== nowM && (
        <button
          type="button"
          className="mk-month-today"
          onClick={() => onChange(nowM)}
        >
          本月
        </button>
      )}
    </div>
  );
}

/**
 * Exact Theme.swift DayStrip: header with < DatePicker > + "今天", plus horizontally scrollable 28-day pills.
 */
export function InkDayStrip({
  day,
  onChange,
  markedDays,
}: {
  day: string;
  onChange: (day: string) => void;
  markedDays?: Set<string>;
}) {
  const nowDay = today();
  const stripRef = useRef<HTMLDivElement>(null);

  const pills = useMemo(() => {
    // 28 days centered/anchored around selected day (or ending at today if near today)
    const anchor = day > nowDay ? day : nowDay;
    const end = shiftDay(anchor, 3);
    const list = Array.from({ length: 28 }, (_, i) => shiftDay(end, i - 27));
    if (!list.includes(day)) {
      return Array.from({ length: 28 }, (_, i) => shiftDay(day, i - 20));
    }
    return list;
  }, [day, nowDay]);

  useEffect(() => {
    const activeEl = stripRef.current?.querySelector<HTMLElement>(".mk-day-pill.active");
    activeEl?.scrollIntoView({ behavior: "instant", inline: "center", block: "nearest" });
  }, [day]);

  return (
    <div className="mk-day-strip">
      <div className="mk-day-head">
        <button
          type="button"
          className="mk-month-nav"
          aria-label="前一天"
          onClick={() => onChange(shiftDay(day, -1))}
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <span className="mk-day-date-btn">
          <span>
            {shortDate(day)} · 周{weekdayChar(day)}
          </span>
          <input
            type="date"
            aria-label="选择日期"
            value={day}
            onChange={(e) => {
              if (e.target.value) onChange(e.target.value);
            }}
          />
        </span>
        <button
          type="button"
          className="mk-month-nav"
          aria-label="后一天"
          onClick={() => onChange(shiftDay(day, 1))}
        >
          <Icon name="chevron-right" size={16} />
        </button>
        {day !== nowDay && (
          <button
            type="button"
            className="mk-month-today"
            onClick={() => onChange(nowDay)}
          >
            今天
          </button>
        )}
      </div>
      <div className="mk-day-pills" ref={stripRef}>
        {pills.map((iso) => {
          const isActive = iso === day;
          const isToday = iso === nowDay;
          const marked = markedDays?.has(iso);
          return (
            <button
              key={iso}
              type="button"
              className={"mk-day-pill" + (isActive ? " active" : "")}
              onClick={() => onChange(iso)}
            >
              <small>{isToday ? "今" : weekdayChar(iso)}</small>
              <strong>{Number(iso.slice(8, 10))}</strong>
              {marked && <span className="mk-day-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Exact Theme.swift Composer: bottom-pinned translucent pill with circular ↑ send button.
 */
export function InkComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  leftSlot,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
  leftSlot?: ReactNode;
}) {
  const canSend = !disabled && value.trim().length > 0;
  return (
    <div className="mk-composer-wrap">
      <form
        className="mk-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) onSubmit();
        }}
      >
        {leftSlot}
        <textarea
          rows={1}
          className="mk-composer-input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSubmit();
            }
          }}
        />
        <button
          type="submit"
          className="mk-composer-send"
          aria-label="发送"
          disabled={!canSend}
        >
          <Icon name="arrow-up" size={17} />
        </button>
      </form>
    </div>
  );
}

export function InkSearch({
  value,
  onChange,
  placeholder = "搜索…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="mk-search">
      <Icon name="discover" size={15} />
      <input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="mk-search-clear"
          aria-label="清空搜索"
          onClick={() => onChange("")}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  );
}

export function InkEmpty({ text }: { text: string }) {
  return <div className="mk-empty">{text}</div>;
}

export function InkSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={"mk-switch" + (checked ? " on" : "")}
      onClick={() => onChange(!checked)}
    >
      <span className="mk-switch-thumb" />
    </button>
  );
}

/* ─────────────────────────── Native Bottom Sheet & Action Sheet ─────────────────────────── */

export function InkSheet({
  open,
  title,
  onClose,
  leftLabel = "取消",
  rightLabel,
  rightDisabled = false,
  onRight,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  leftLabel?: string;
  rightLabel?: string;
  rightDisabled?: boolean;
  onRight?: () => void;
  children: ReactNode;
}) {
  useBackDismiss(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="mk-sheet-backdrop" onClick={onClose}>
      <div className="mk-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mk-sheet-handle" />
        <div className="mk-sheet-header">
          <button
            type="button"
            className="mk-sheet-nav-btn mk-sheet-left"
            onClick={onClose}
          >
            {leftLabel}
          </button>
          <div className="mk-sheet-title">{title}</div>
          {rightLabel && onRight ? (
            <button
              type="button"
              className="mk-sheet-nav-btn primary mk-sheet-right"
              disabled={rightDisabled}
              onClick={onRight}
            >
              {rightLabel}
            </button>
          ) : (
            <span />
          )}
        </div>
        <div className="mk-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export type ActionSheetItem = {
  label: string;
  icon?: string;
  danger?: boolean;
  active?: boolean;
  onClick: () => void;
};

export function InkActionSheet({
  open,
  title,
  items,
  onClose,
}: {
  open: boolean;
  title?: string;
  items: ActionSheetItem[];
  onClose: () => void;
}) {
  useBackDismiss(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="mk-action-backdrop" onClick={onClose}>
      <div className="mk-action-stack" onClick={(e) => e.stopPropagation()}>
        <div className="mk-action-group">
          {title && <div className="mk-action-title">{title}</div>}
          {items.map((item, idx) => (
            <button
              key={idx}
              type="button"
              className={
                "mk-action-item" +
                (item.danger ? " danger" : "") +
                (item.active ? " active" : "")
              }
              onClick={() => {
                onClose();
                item.onClick();
              }}
            >
              {item.icon && <Icon name={item.icon} size={17} />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="mk-action-cancel" onClick={onClose}>
          取消
        </button>
      </div>
    </div>,
    document.body,
  );
}

/* ─────────────────────────── Crisp Mobile SVG Charts (360px safe) ─────────────────────────── */

export function InkSpark({
  values,
  height = 24,
  width = 68,
}: {
  values: number[];
  height?: number;
  width?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 4) + 2;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline
        fill="none"
        stroke="var(--text-2)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
}

export function InkBarChart({
  points,
  label,
  unit = "",
  formatValue,
  height = 128,
}: {
  points: { x: string; y: number; highlight?: boolean; label?: string }[];
  label?: string;
  unit?: string;
  formatValue?: (v: number) => string;
  height?: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  if (points.length === 0) return <InkEmpty text="暂无数据" />;
  const max = Math.max(1, ...points.map((p) => p.y));
  const vbW = 300;
  const padL = 4;
  const padR = 4;
  const padT = 8;
  const padB = 18;
  const plotW = vbW - padL - padR;
  const plotH = height - padT - padB;
  const step = plotW / points.length;
  const barW = Math.max(3, Math.min(12, step * 0.56));
  const active =
    selected !== null
      ? points[selected]
      : points.findLast((p) => p.y > 0) ?? points.at(-1);
  const fmt = (v: number) =>
    formatValue
      ? formatValue(v)
      : v.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + unit;

  return (
    <div className="mk-chart-wrap">
      {(label || active) && (
        <div className="mk-chart-head">
          <span>{label ?? ""}</span>
          {active && (
            <strong>
              {active.label ?? active.x.slice(-5)} · {fmt(active.y)}
            </strong>
          )}
        </div>
      )}
      <svg
        className="mk-chart-svg"
        viewBox={`0 0 ${vbW} ${height}`}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
          const idx = Math.max(
            0,
            Math.min(points.length - 1, Math.floor(ratio * points.length)),
          );
          setSelected(idx);
        }}
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
          const idx = Math.max(
            0,
            Math.min(points.length - 1, Math.floor(ratio * points.length)),
          );
          setSelected(idx);
        }}
      >
        <line
          x1={padL}
          x2={vbW - padR}
          y1={padT + plotH}
          y2={padT + plotH}
          stroke="var(--line)"
          strokeWidth="0.75"
        />
        {points.map((p, i) => {
          const cx = padL + step * (i + 0.5);
          const h = p.y > 0 ? Math.max(3, (p.y / max) * plotH) : 2.5;
          const showLabel =
            i === 0 ||
            i === points.length - 1 ||
            (points.length > 10 && (i + 1) % 7 === 0);
          return (
            <g key={p.x + i}>
              <rect
                x={cx - barW / 2}
                y={padT + plotH - h}
                width={barW}
                height={h}
                rx={Math.min(4, barW / 2)}
                fill={
                  p.y <= 0
                    ? "var(--surface-3)"
                    : selected === i || p.highlight
                      ? "var(--text)"
                      : "var(--text-2)"
                }
                opacity={selected !== null && selected !== i ? 0.55 : 1}
              />
              {showLabel && (
                <text
                  x={cx}
                  y={height - 3}
                  textAnchor="middle"
                  fill="var(--text-3)"
                  fontSize="9.5"
                >
                  {p.label ?? Number(p.x.slice(-2))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function InkLineChart({
  points,
  label,
  unit = "",
  formatValue,
  height = 136,
}: {
  points: { x: string; y: number | null; label?: string }[];
  label?: string;
  unit?: string;
  formatValue?: (v: number) => string;
  height?: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const valid = points.filter((p): p is { x: string; y: number; label?: string } => p.y !== null && Number.isFinite(p.y));
  if (valid.length === 0) return <InkEmpty text="有记录后，这里会显示趋势" />;

  const min = Math.min(...valid.map((p) => p.y));
  const max = Math.max(...valid.map((p) => p.y));
  const pad = max === min ? Math.max(Math.abs(max) * 0.1, 1) : (max - min) * 0.08;
  const lo = min - pad;
  const hi = max + pad;
  const span = hi - lo || 1;
  const vbW = 300;
  const padL = 6;
  const padR = 6;
  const padT = 10;
  const padB = 20;
  const plotW = vbW - padL - padR;
  const plotH = height - padT - padB;
  const xAt = (i: number) =>
    padL + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yAt = (v: number) => padT + plotH - ((v - lo) / span) * plotH;

  let path = "";
  let open = false;
  points.forEach((p, i) => {
    if (p.y === null || !Number.isFinite(p.y)) {
      open = false;
      return;
    }
    path += `${open ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(p.y).toFixed(1)} `;
    open = true;
  });

  const active =
    (selected !== null ? points[selected] : undefined) ??
    points.findLast((p) => p.y !== null);
  const fmt = (v: number) =>
    formatValue
      ? formatValue(v)
      : v.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + unit;

  return (
    <div className="mk-chart-wrap">
      {(label || active) && (
        <div className="mk-chart-head">
          <span>{label ?? ""}</span>
          {active && (
            <strong>
              {active.label ?? active.x.slice(5, 10)} ·{" "}
              {active.y === null ? "未记录" : fmt(active.y)}
            </strong>
          )}
        </div>
      )}
      <svg
        className="mk-chart-svg"
        viewBox={`0 0 ${vbW} ${height}`}
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
          setSelected(
            Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))),
          );
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0 && e.pointerType === "mouse") return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
          setSelected(
            Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))),
          );
        }}
      >
        {[0, 0.5, 1].map((t) => {
          const y = padT + plotH * t;
          return (
            <line
              key={t}
              x1={padL}
              x2={vbW - padR}
              y1={y}
              y2={y}
              stroke="var(--line)"
              strokeDasharray="2 3"
              strokeWidth="0.75"
            />
          );
        })}
        <path
          d={path}
          fill="none"
          stroke="var(--text)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.length <= 35 &&
          points.map((p, i) =>
            p.y === null ? null : (
              <circle
                key={i}
                cx={xAt(i)}
                cy={yAt(p.y)}
                r={selected === i ? 4 : 2.3}
                fill="var(--text)"
              />
            ),
          )}
        {selected !== null && points[selected]?.y !== null && (
          <line
            x1={xAt(selected)}
            x2={xAt(selected)}
            y1={padT}
            y2={padT + plotH}
            stroke="var(--line-3)"
            strokeWidth="1"
          />
        )}
        <text x={padL} y={height - 3} fill="var(--text-3)" fontSize="9.5">
          {points[0]?.label ?? points[0]?.x.slice(5, 10)}
        </text>
        <text
          x={vbW - padR}
          y={height - 3}
          textAnchor="end"
          fill="var(--text-3)"
          fontSize="9.5"
        >
          {points.at(-1)?.label ?? points.at(-1)?.x.slice(5, 10)}
        </text>
      </svg>
    </div>
  );
}
