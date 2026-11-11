export type Schedule =
  | { kind: "unscheduled" | "recent" }
  | { kind: "day" | "deadline"; date: string }
  | { kind: "range"; start: string; end: string };
export function validDay(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "1900-01-01" ||
    value > "9999-12-31"
  )
    return false;
  const date = new Date(value + "T00:00:00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function validateSchedule(value: Schedule): Schedule {
  if (!value || typeof value !== "object") throw new Error("INVALID_SCHEDULE");
  if (value.kind === "unscheduled" || value.kind === "recent")
    return { kind: value.kind };
  if (value.kind === "day" || value.kind === "deadline") {
    if (!validDay(value.date)) throw new Error("INVALID_DATE");
    return { kind: value.kind, date: value.date };
  }
  if (value.kind === "range") {
    if (
      !validDay(value.start) ||
      !validDay(value.end) ||
      value.start > value.end
    )
      throw new Error("INVALID_RANGE");
    return { kind: "range", start: value.start, end: value.end };
  }
  throw new Error("INVALID_SCHEDULE");
}
export function scheduleBounds(schedule: Schedule): [string, string] | null {
  if (schedule.kind === "unscheduled" || schedule.kind === "recent")
    return null;
  if (schedule.kind === "range") return [schedule.start, schedule.end];
  return "date" in schedule ? [schedule.date, schedule.date] : null;
}
export function overlaps(
  schedule: Schedule,
  start: string,
  end: string,
): boolean {
  const bounds = scheduleBounds(schedule);
  return !!bounds && bounds[0] <= end && bounds[1] >= start;
}
/** Flat, queryable form of a schedule as stored on the task entity. */
export type ScheduleFields = {
  scheduleKind: Schedule["kind"];
  scheduleDate?: string;
  scheduleStart?: string;
  scheduleEnd?: string;
};
export function toSchedule(fields: Partial<ScheduleFields>): Schedule {
  const kind = fields.scheduleKind ?? "unscheduled";
  if (kind === "day" || kind === "deadline")
    return { kind, date: fields.scheduleDate ?? "" };
  if (kind === "range")
    return {
      kind,
      start: fields.scheduleStart ?? "",
      end: fields.scheduleEnd ?? "",
    };
  return { kind };
}
/** Validates, and keeps only the fields that belong to the kind. */
export function fromSchedule(value: Schedule): ScheduleFields {
  const schedule = validateSchedule(value);
  if (schedule.kind === "day" || schedule.kind === "deadline")
    return { scheduleKind: schedule.kind, scheduleDate: schedule.date };
  if (schedule.kind === "range")
    return {
      scheduleKind: "range",
      scheduleStart: schedule.start,
      scheduleEnd: schedule.end,
    };
  return { scheduleKind: schedule.kind };
}
