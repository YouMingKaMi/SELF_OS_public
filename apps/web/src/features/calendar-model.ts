import { Lunar, Solar, LunarMonth } from "lunar-typescript";
import type { AnyEntity as Entity } from "../data/entities.ts";
import { today, str, num } from "../ui/shared.tsx";
function solarDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
export function nextOccurrence(e: Entity, from = today()): string | null {
  try {
    const base = str(e, "date");
    const repeat = str(e, "repeat", "once");
    const fromDate = new Date(from + "T00:00:00Z");
    if (e.data.calendar === "lunar") {
      const initial = Lunar.fromYmd(
        num(e, "lunarYear"),
        num(e, "lunarMonth") * (e.data.leap ? -1 : 1),
        num(e, "lunarDay"),
      );
      if (repeat === "once") return initial.getSolar().toYmd();
      const unit =
        repeat === "weekly"
          ? "week"
          : repeat === "monthly"
            ? "month"
            : repeat === "yearly"
              ? "year"
              : str(e, "intervalUnit", "day");
      const interval = repeat === "custom" ? num(e, "interval", 1) : 1;
      if (unit === "day" || unit === "week") {
        const step = interval * (unit === "week" ? 7 : 1);
        const elapsed = Math.max(
          0,
          Math.ceil(
            (Date.parse(from) - Date.parse(initial.getSolar().toYmd())) /
              86400000,
          ),
        );
        return initial
          .next(Math.ceil(elapsed / step) * step)
          .getSolar()
          .toYmd();
      }
      const first = LunarMonth.fromYm(initial.getYear(), initial.getMonth());
      if (!first) return null;
      for (let i = 0; i < 5000; i++) {
        const target =
          unit === "month"
            ? first.next(i * interval)
            : LunarMonth.fromYm(
                initial.getYear() + i * interval,
                initial.getMonth(),
              );
        if (!target) continue;
        const result = Lunar.fromYmd(
          target.getYear(),
          target.getMonth(),
          Math.min(initial.getDay(), target.getDayCount()),
        )
          .getSolar()
          .toYmd();
        if (result >= from) return result;
      }
      return null;
    }
    if (!base) return null;
    if (repeat === "once") return base;
    const initial = new Date(base + "T00:00:00Z");
    const unit =
      repeat === "weekly"
        ? "week"
        : repeat === "monthly"
          ? "month"
          : repeat === "yearly"
            ? "year"
            : str(e, "intervalUnit", "day");
    const interval = repeat === "custom" ? num(e, "interval", 1) : 1;
    for (let i = 0; i < 20000; i++) {
      const date = new Date(initial);
      if (unit === "day" || unit === "week")
        date.setUTCDate(
          date.getUTCDate() + i * interval * (unit === "week" ? 7 : 1),
        );
      else if (unit === "month") {
        date.setUTCDate(1);
        date.setUTCMonth(initial.getUTCMonth() + i * interval);
        const last = new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
        ).getUTCDate();
        date.setUTCDate(Math.min(initial.getUTCDate(), last));
      } else {
        date.setUTCDate(1);
        date.setUTCFullYear(initial.getUTCFullYear() + i * interval);
        date.setUTCMonth(initial.getUTCMonth());
        date.setUTCDate(
          Math.min(
            initial.getUTCDate(),
            new Date(
              Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
            ).getUTCDate(),
          ),
        );
      }
      if (solarDate(date) >= from) return solarDate(date);
    }
    return null;
  } catch {
    return null;
  }
}
