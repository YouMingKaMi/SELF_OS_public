import React from "react";
import type { Schedule } from "./data/tasks.ts";
import { localDay } from "./scheduling.ts";
export function ScheduleFields({
  value,
  onChange,
  prefix,
  time,
  onTimeChange,
}: {
  value: Schedule;
  onChange: (value: Schedule) => void;
  prefix: string;
  time?: string;
  onTimeChange?: (value: string) => void;
}) {
  const today = localDay();
  return (
    <div className="schedule-fields">
      <label htmlFor={prefix + "-kind"}>安排方式</label>
      <select
        id={prefix + "-kind"}
        value={value.kind}
        onChange={(e) => {
          const kind = e.target.value;
          if (kind === "range") onChange({ kind, start: today, end: today });
          else if (kind === "day" || kind === "deadline")
            onChange({ kind, date: today });
          else onChange({ kind: kind as "recent" | "unscheduled" });
        }}
      >
        <option value="unscheduled">未定日期</option>
        <option value="recent">近期完成</option>
        <option value="day">指定日期</option>
        <option value="range">一段期间</option>
        <option value="deadline">截止日期</option>
      </select>
      {"date" in value && (
        <div>
          <label htmlFor={prefix + "-date"}>
            {value.kind === "deadline" ? "截止到这一天" : "安排在哪天"}
          </label>
          <input
            type="date"
            id={prefix + "-date"}
            value={value.date}
            min="1900-01-01"
            max="9999-12-31"
            required
            onChange={(e) => onChange({ ...value, date: e.target.value })}
          />
        </div>
      )}
      {"date" in value && onTimeChange && (
        <div>
          <label htmlFor={prefix + "-time"}>时间（可选）</label>
          <input
            type="time"
            id={prefix + "-time"}
            value={time ?? ""}
            onChange={(event) => onTimeChange(event.target.value)}
          />
        </div>
      )}
      {value.kind === "range" && (
        <div className="date-range">
          <div>
            <label htmlFor={prefix + "-start"}>开始日期</label>
            <input
              id={prefix + "-start"}
              type="date"
              value={value.start}
              min="1900-01-01"
              max="9999-12-31"
              required
              onChange={(e) => onChange({ ...value, start: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor={prefix + "-end"}>结束日期</label>
            <input
              id={prefix + "-end"}
              type="date"
              value={value.end}
              min={value.start}
              max="9999-12-31"
              required
              onChange={(e) => onChange({ ...value, end: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
