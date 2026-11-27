import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Schedule, Task } from "../data/tasks.ts";
import { inPeriod } from "../scheduling.ts";
import { Icon } from "../ui/Icon.tsx";
import { daysInMonth } from "../ui/shared.tsx";

export function TaskPopover({
  open,
  label,
  active = false,
  className = "",
  trigger,
  onToggle,
  onClose,
  children,
}: {
  open: boolean;
  label: string;
  active?: boolean;
  className?: string;
  trigger: ReactNode;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const element = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!element.current?.contains(event.target as Node)) onClose();
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      onClose();
      button.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, onClose]);

  return (
    <div className={"task-popover " + className} ref={element}>
      <button
        type="button"
        className="task-control"
        ref={button}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        aria-haspopup="dialog"
        data-active={active || undefined}
        onClick={onToggle}
      >
        {trigger}
      </button>
      {open && (
        <div id={id} className="task-popup" role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

export function taskMonthLabel(month: string) {
  return month.slice(0, 4) + "年" + Number(month.slice(5)) + "月";
}

function dateLabel(day: string) {
  return Number(day.slice(5, 7)) + "月" + Number(day.slice(8, 10)) + "日";
}

function TaskCalendar({
  month,
  today,
  label,
  pickMonth,
  pickDay,
  selected,
  range,
  tasks,
}: {
  month: string;
  today: string;
  label: string;
  pickMonth: (value: string) => void;
  pickDay: (value: string) => void;
  selected?: string;
  range?: { start: string; end: string };
  tasks?: Task[];
}) {
  const [jumpYear, setJumpYear] = useState<string | null>(null);
  const jumping = jumpYear !== null;
  const validYear =
    jumping && /^\d{4}$/.test(jumpYear) && Number(jumpYear) >= 1900;
  const dates = daysInMonth(month);
  const lead = new Date(month + "-01T12:00:00Z").getUTCDay();
  function step(offset: number) {
    const [year, index] = month.split("-").map(Number);
    const next = new Date(Date.UTC(year!, index! - 1 + offset, 1));
    pickMonth(next.toISOString().slice(0, 7));
  }

  return (
    <>
      <div className="task-calendar-head">
        <button
          type="button"
          aria-label={jumping ? "上一年" : "上个月"}
          disabled={
            jumping ? !validYear || jumpYear === "1900" : month <= "1900-01"
          }
          onClick={() =>
            jumping ? setJumpYear(String(Number(jumpYear) - 1)) : step(-1)
          }
        >
          ‹
        </button>
        {jumping ? (
          <div className="task-calendar-year">
            <input
              type="text"
              inputMode="numeric"
              aria-label="跳转年份"
              value={jumpYear}
              maxLength={4}
              onChange={(event) =>
                setJumpYear(event.target.value.replace(/[^0-9]/g, ""))
              }
            />
            <button
              type="button"
              aria-label="返回日历"
              className="ghost"
              onClick={() => setJumpYear(null)}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        ) : (
          <button
            className="task-calendar-month ghost"
            type="button"
            aria-label={label + " · " + taskMonthLabel(month)}
            onClick={() => setJumpYear(month.slice(0, 4))}
          >
            {taskMonthLabel(month)} <span className="task-caret" />
          </button>
        )}
        <button
          type="button"
          aria-label={jumping ? "下一年" : "下个月"}
          disabled={
            jumping ? !validYear || jumpYear === "9999" : month >= "9999-12"
          }
          onClick={() =>
            jumping ? setJumpYear(String(Number(jumpYear) + 1)) : step(1)
          }
        >
          ›
        </button>
      </div>
      {jumping ? (
        <div className="task-month-grid">
          {Array.from({ length: 12 }, (_, index) => {
            const key = jumpYear + "-" + String(index + 1).padStart(2, "0");
            return (
              <button
                type="button"
                key={index}
                disabled={!validYear}
                aria-pressed={key === month}
                onClick={() => {
                  pickMonth(key);
                  setJumpYear(null);
                }}
              >
                {index + 1}月
              </button>
            );
          })}
        </div>
      ) : (
        <div className="task-calendar">
          {["日", "一", "二", "三", "四", "五", "六"].map((weekday) => (
            <span key={weekday} className="weekday">
              周{weekday}
            </span>
          ))}
          {Array.from({ length: lead }, (_, index) => (
            <span key={index} />
          ))}
          {dates.map((date) => {
            const hasTask = tasks?.some((task) => inPeriod(task, "", date));
            return (
              <button
                key={date}
                type="button"
                aria-label={date}
                aria-current={date === today ? "date" : undefined}
                aria-pressed={date === selected}
                className={[
                  date === today && "today",
                  range &&
                    date >= range.start &&
                    date <= range.end &&
                    "in-range",
                  range &&
                    (date === range.start || date === range.end) &&
                    "range-end",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => pickDay(date)}
              >
                <span>{Number(date.slice(8))}</span>
                {hasTask && <i aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export function TaskCalendarFilter({
  month,
  day,
  today,
  tasks,
  onChange,
}: {
  month: string;
  day: string;
  today: string;
  tasks: Task[];
  onChange: (month: string, day?: string) => void;
}) {
  const [display, setDisplay] = useState(month || today.slice(0, 7));
  return (
    <>
      <TaskCalendar
        month={display}
        today={today}
        label="查看月份"
        pickMonth={setDisplay}
        pickDay={(date) => onChange(display, date)}
        selected={day}
        tasks={tasks}
      />
      <footer className="task-popup-actions">
        <button type="button" className="ghost" onClick={() => onChange("")}>
          全部时间
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => onChange(today.slice(0, 7), today)}
        >
          今天
        </button>
        <button type="button" onClick={() => onChange(display)}>
          查看整月
        </button>
      </footer>
    </>
  );
}

const scheduleKinds = [
  ["unscheduled", "不设日期"],
  ["recent", "近期"],
  ["day", "指定日期"],
  ["deadline", "截止"],
  ["range", "起止日期"],
] as const;

export function TaskSchedulePicker({
  schedule,
  time,
  today,
  onChange,
  onTime,
  onDone,
}: {
  schedule: Schedule;
  time: string;
  today: string;
  onChange: (value: Schedule) => void;
  onTime: (value: string) => void;
  onDone: () => void;
}) {
  const [display, setDisplay] = useState(
    ("date" in schedule
      ? schedule.date
      : schedule.kind === "range"
        ? schedule.start
        : today
    ).slice(0, 7),
  );
  const [boundary, setBoundary] = useState<"start" | "end">("start");
  const hasDay = "date" in schedule;
  function pickKind(kind: Schedule["kind"]) {
    if (kind === schedule.kind) return;
    const date = hasDay
      ? schedule.date
      : schedule.kind === "range"
        ? schedule.start
        : today;
    if (kind === "range") {
      setBoundary("start");
      onChange({ kind, start: date, end: date });
    } else if (kind === "day" || kind === "deadline") {
      onChange({ kind, date });
    } else {
      onChange({ kind });
      onDone();
    }
    setDisplay(date.slice(0, 7));
  }
  function pickDay(date: string) {
    if ("date" in schedule) onChange({ ...schedule, date });
    if (schedule.kind !== "range") {
      if (!("date" in schedule)) onChange({ kind: "day", date });
      return;
    }
    if (boundary === "start") {
      onChange({
        ...schedule,
        start: date,
        end: date > schedule.end ? date : schedule.end,
      });
      setBoundary("end");
    } else {
      onChange({
        ...schedule,
        end: date,
        start: date < schedule.start ? date : schedule.start,
      });
    }
  }
  return (
    <>
      <div className="task-schedule-kinds" role="group" aria-label="安排方式">
        {scheduleKinds.map(([kind, label]) => (
          <button
            type="button"
            key={kind}
            aria-pressed={schedule.kind === kind}
            onClick={() => pickKind(kind)}
          >
            {label}
          </button>
        ))}
      </div>
      {schedule.kind === "range" && (
        <div className="task-schedule-range" role="group" aria-label="起止日期">
          <button
            type="button"
            aria-pressed={boundary === "start"}
            onClick={() => {
              setBoundary("start");
              setDisplay(schedule.start.slice(0, 7));
            }}
          >
            开始 · {dateLabel(schedule.start)}
          </button>
          <button
            type="button"
            aria-pressed={boundary === "end"}
            onClick={() => {
              setBoundary("end");
              setDisplay(schedule.end.slice(0, 7));
            }}
          >
            结束 · {dateLabel(schedule.end)}
          </button>
        </div>
      )}
      <TaskCalendar
        month={display}
        today={today}
        label="排期月份"
        pickMonth={setDisplay}
        pickDay={pickDay}
        selected={hasDay ? schedule.date : undefined}
        range={schedule.kind === "range" ? schedule : undefined}
      />
      <footer className="task-popup-actions">
        {hasDay && (
          <label className="task-schedule-clock">
            <Icon name="days" size={15} />
            时间
            <input
              type="time"
              aria-label="任务时间（可选）"
              value={time}
              onChange={(event) => onTime(event.target.value)}
            />
          </label>
        )}
        <button type="button" className="primary" onClick={onDone}>
          完成
        </button>
      </footer>
    </>
  );
}
